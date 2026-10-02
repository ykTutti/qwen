import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api/client';
import type { DesignComment, DesignDoc, DesignPage, ElementRef } from '../types';
import { CommentList, toThreads, type CommentThread, type ThreadKey } from './CommentList';
import { Icon } from './Icon';
import { VisualEditor, type SaveState } from './VisualEditor';

interface Props {
  conversationId: string;
  design: DesignDoc;
  /** Design mode: the selected page's clicks pick elements instead of driving the prototype. */
  designing?: boolean;
  /** Comment mode: the comment list slides in on the right and pages show comment badges. */
  commenting?: boolean;
  /** Called when the user clicks 添加到对话 under a picked element or on a comment. */
  onAttach?: (ref: ElementRef) => void;
}

type PageData = {
  page: DesignPage;
  url?: string;
  width: number;
  height: number;
  /** Header and label sizes scale with the screen so they stay legible at the zoom that fits desktop pages. */
  unit: number;
};
type PageNode = Node<PageData, 'page'>;

const HEAD = 56;
/** Gaps between nodes as a fraction of the screen size; horizontal gaps leave room for edge labels. */
const GAP_X = 0.7;
const GAP_Y = 0.15;

/** Columns by navigation depth from the entry page (first in the list); pages nobody links to start new roots. */
function layout(design: DesignDoc) {
  const { width, height } = design.viewport;
  const next = new Map<string, string[]>();
  for (const e of design.edges) next.set(e.from, [...(next.get(e.from) ?? []), e.to]);
  const rank = new Map<string, number>();
  for (const root of design.pages) {
    if (rank.has(root.id)) continue;
    rank.set(root.id, 0);
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift()!;
      for (const to of next.get(id) ?? []) {
        if (rank.has(to)) continue;
        rank.set(to, rank.get(id)! + 1);
        queue.push(to);
      }
    }
  }
  const rows = new Map<number, number>();
  const pos = new Map<string, { x: number; y: number }>();
  for (const p of design.pages) {
    const col = rank.get(p.id) ?? 0;
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    pos.set(p.id, { x: col * width * (1 + GAP_X), y: row * (height + HEAD * (width / 390)) * (1 + GAP_Y) });
  }
  return { pos, rank };
}

/** An element picked inside a page preview, as reported by the picker script the preview server injects. */
export interface PickedElement {
  selector: string;
  name: string;
  tag: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  /** Computed values of the properties the visual editor can change. */
  styles: Record<string, string>;
}

type Pick = { pageId: string; pageName: string; element: PickedElement; frame: Window };

const CanvasMode = createContext<{
  designing: boolean;
  commenting: boolean;
  threads: CommentThread[];
  /** Page id → its preview frame, so the comment list can talk to a page's picker. */
  frames: Map<string, RefObject<HTMLIFrameElement>>;
  onPick: (page: DesignPage, element: PickedElement | null, frame: Window | null) => void;
  onAttach: (page: DesignPage, element: PickedElement) => void;
  /** A page opened (selector) or closed (null) a comment popover. */
  onThread: (page: DesignPage, selector: string | null) => void;
}>({
  designing: false,
  commenting: false,
  threads: [],
  frames: new Map(),
  onPick: () => undefined,
  onAttach: () => undefined,
  onThread: () => undefined,
});

function PageNodeView({ data, selected }: NodeProps<PageNode>) {
  const { page, url, width, height, unit } = data;
  const mode = useContext(CanvasMode);
  const ready = page.status === 'done' && !!url;
  // Only the selected page takes mouse input (its own interactions, or the element picker in design mode),
  // so the rest drag and zoom with the canvas; the header always drags.
  const live = ready && !!selected;
  const picking = live && mode.designing;
  const hint = !ready || live ? null : mode.designing ? '选中页面后可选择元素' : '选中页面后可直接操作';
  const frame = useRef<HTMLIFrameElement>(null);
  const [picked, setPicked] = useState<PickedElement | null>(null);
  const { onPick, onAttach, onThread, frames, commenting, threads } = mode;
  const pageRef = useRef(page);
  pageRef.current = page;
  const toggle = useRef({ picking, commenting, threads });
  toggle.current = { picking, commenting, threads };
  /** Sends the picker its mode and the comment threads (the picker keeps the ones for its own page). */
  const sync = (win: Window | null | undefined) => {
    win?.postMessage({ type: 'qw-picker', on: toggle.current.picking, badges: toggle.current.commenting }, '*');
    win?.postMessage({ type: 'qw-picker:threads', items: toggle.current.threads }, '*');
  };

  useEffect(() => {
    frames.set(page.id, frame);
    return () => { frames.delete(page.id); };
  }, [frames, page.id]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'qw-picker', on: picking, badges: commenting }, '*');
    if (!picking) {
      setPicked(null);
      onPick(pageRef.current, null, null);
    }
  }, [picking, commenting, onPick]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage({ type: 'qw-picker:threads', items: threads }, '*');
  }, [threads]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const win = frame.current?.contentWindow;
      if (!win || e.source !== win) return;
      if (e.data?.type === 'qw-picker:attach' && e.data.element) onAttach(pageRef.current, e.data.element);
      if (e.data?.type === 'qw-picker:thread') onThread(pageRef.current, e.data.selector ? String(e.data.selector) : null);
      if (e.data?.type !== 'qw-picker:pick') return;
      setPicked(e.data.element ?? null);
      onPick(pageRef.current, e.data.element ?? null, win);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onPick, onAttach, onThread]);
  return (
    <div className={`design-node ${selected ? 'is-selected' : ''}`} style={{ width, ['--u' as string]: unit }}>
      <Handle id="in" type="target" position={Position.Left} className="design-handle" />
      <Handle id="back-in" type="target" position={Position.Bottom} className="design-handle" style={{ left: '30%' }} />
      <Handle id="back-out" type="source" position={Position.Bottom} className="design-handle" style={{ left: '70%' }} />
      <div className="design-node-head" style={{ height: HEAD * unit }}>
        <span className="design-node-name">{page.name}</span>
        <span className="design-node-id">{page.id}</span>
        {page.status !== 'done' ? (
          <span className="design-node-status"><Icon name="loading" className="spin" size={16 * unit} />{page.agentId ?? ''} 生成中</span>
        ) : picking ? (
          <span className="design-node-picked" title={picked?.selector}>{picked ? picked.name : '点击页面中的元素'}</span>
        ) : url ? (
          <a className="design-node-open nodrag" href={url} target="_blank" rel="noreferrer" title="在新窗口打开">
            <Icon name="arrowRightUp" size={18 * unit} />
          </a>
        ) : null}
      </div>
      <div className="design-node-screen" style={{ width, height }}>
        {page.status === 'done' && url ? (
          <iframe
            ref={frame}
            className={live ? 'nodrag nowheel' : undefined}
            style={{ pointerEvents: live ? 'auto' : 'none' }}
            title={page.name}
            src={url}
            onLoad={(e) => {
              sync(e.currentTarget.contentWindow);
              setPicked(null);
              onPick(pageRef.current, null, null);
            }}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
          />
        ) : page.status === 'done' ? (
          <div className="design-node-pending is-loading"><Icon name="loading" className="spin" size={28 * unit} /></div>
        ) : (
          <div className="design-node-pending">
            <div className="design-skeleton" style={{ height: '18%' }} />
            <div className="design-skeleton" style={{ height: '8%', width: '70%' }} />
            <div className="design-skeleton" style={{ height: '26%' }} />
            <div className="design-skeleton" style={{ height: '8%', width: '50%' }} />
            {page.description && <p>{page.description}</p>}
          </div>
        )}
        {hint && <div className="design-node-hint">{hint}</div>}
      </div>
      <Handle id="out" type="source" position={Position.Right} className="design-handle" />
    </div>
  );
}

const nodeTypes = { page: PageNodeView };

export default function DesignCanvas({ conversationId, design, designing = false, commenting = false, onAttach }: Props) {
  const [base, setBase] = useState<string>();
  const [nodes, setNodes, onNodesChange] = useNodesState<PageNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const moved = useRef(new Map<string, { x: number; y: number }>());
  const flow = useRef<ReactFlowInstance<PageNode, Edge>>();
  const focus = (id: string) =>
    flow.current?.fitView({ nodes: [{ id }], padding: 0.08, maxZoom: 1, duration: 400 });
  const { width, height } = design.viewport;
  const unit = width / 390;

  useEffect(() => {
    let cancelled = false;
    api.previewUrl(conversationId, '').then((u) => !cancelled && setBase(u), () => undefined);
    return () => { cancelled = true; };
  }, [conversationId]);

  const auto = useMemo(() => layout(design), [design]);

  useEffect(() => {
    setNodes((prev) => {
      prev.forEach((n) => moved.current.set(n.id, n.position));
      return design.pages.map((page) => ({
        id: page.id,
        type: 'page' as const,
        position: moved.current.get(page.id) ?? auto.pos.get(page.id)!,
        selected: prev.find((n) => n.id === page.id)?.selected,
        data: {
          page,
          url: base && page.html ? `${base}${page.html.split('/').map(encodeURIComponent).join('/')}?v=${page.updatedAt ?? 0}` : undefined,
          width,
          height,
          unit,
        },
      }));
    });
    setEdges(
      design.edges.map((e) => {
        // Links back to an earlier column (返回 etc.) run underneath the nodes so they don't overlap forward links.
        const back = (auto.rank.get(e.to) ?? 0) <= (auto.rank.get(e.from) ?? 0);
        const color = back ? '#b4b7c9' : '#7d82ff';
        return {
          id: `${e.from}>${e.to}`,
          source: e.from,
          target: e.to,
          ...(back
            ? { sourceHandle: 'back-out', targetHandle: 'back-in', type: 'smoothstep', pathOptions: { offset: 40 * unit, borderRadius: 24 * unit } }
            : { sourceHandle: 'out', targetHandle: 'in' }),
          label: e.label,
          animated: design.pages.find((p) => p.id === e.to)?.status !== 'done',
          markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
          style: { stroke: color, strokeWidth: 3 * unit, ...(back ? { strokeDasharray: `${10 * unit} ${8 * unit}` } : {}) },
          labelStyle: { fontSize: 24 * unit, fill: '#3a3d4a', fontWeight: 500 },
          labelBgPadding: [12 * unit, 8 * unit] as [number, number],
          labelBgBorderRadius: 10 * unit,
          labelBgStyle: { fill: '#fff', stroke: '#e3e5ee', strokeWidth: unit },
        };
      }),
    );
  }, [design, base, auto, width, height, unit, setNodes, setEdges]);

  const [pick, setPick] = useState<Pick | null>(null);
  const [save, setSave] = useState<SaveState>({ status: 'idle' });
  const pending = useRef<{ target: Pick; styles: Record<string, string> } | null>(null);
  const timer = useRef<number>();

  const flush = useCallback(() => {
    window.clearTimeout(timer.current);
    const job = pending.current;
    pending.current = null;
    if (!job) return;
    setSave({ status: 'saving' });
    api
      .saveDesignStyle(conversationId, { page: job.target.pageId, selector: job.target.element.selector, styles: job.styles })
      .then(
        () => setSave((s) => (s.status === 'saving' && !pending.current ? { status: 'saved' } : s)),
        (err: Error) => setSave({ status: 'error', message: err.message || '保存失败' }),
      );
  }, [conversationId]);

  const onPick = useCallback<(page: DesignPage, element: PickedElement | null, frame: Window | null) => void>(
    (page, element, frame) => {
      setPick((cur) => {
        if (element && frame) return { pageId: page.id, pageName: page.name, element, frame };
        return cur?.pageId === page.id ? null : cur;
      });
    },
    [],
  );

  // Switching elements (or closing the sheet) saves whatever the previous one still had queued.
  useEffect(() => {
    flush();
    setSave({ status: 'idle' });
  }, [pick?.pageId, pick?.element.selector, flush]);
  useEffect(() => () => flush(), [flush]);

  const editStyle = (prop: string, value: string) => {
    if (!pick) return;
    const v = value.trim();
    if (v && !CSS.supports(prop, v)) return;
    pick.frame.postMessage({ type: 'qw-picker:style', styles: { [prop]: v } }, '*');
    if (pending.current && pending.current.target !== pick) flush();
    pending.current ??= { target: pick, styles: {} };
    pending.current.styles[prop] = v;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 500);
  };

  const attachRef = useRef(onAttach);
  attachRef.current = onAttach;
  const attach = useCallback((page: DesignPage, el: PickedElement) => {
    attachRef.current?.({
      pageId: page.id,
      pageName: page.name,
      html: page.html,
      selector: el.selector,
      name: el.name,
      tag: el.tag,
      text: el.text,
      rect: el.rect,
      styles: el.styles,
    });
  }, []);

  const [comments, setComments] = useState<DesignComment[]>([]);
  const threads = useMemo(() => toThreads(comments), [comments]);
  const [activeThread, setActiveThread] = useState<ThreadKey | null>(null);
  const frames = useRef(new Map<string, RefObject<HTMLIFrameElement>>()).current;

  useEffect(() => {
    if (!commenting) {
      setActiveThread(null);
      return;
    }
    let cancelled = false;
    api.comments(conversationId).then((list) => !cancelled && setComments(list), () => undefined);
    return () => { cancelled = true; };
  }, [conversationId, commenting]);

  const onThread = useCallback((page: DesignPage, selector: string | null) => {
    if (!page.html) return;
    const html = page.html;
    setActiveThread((cur) => (selector ? { html, selector } : cur?.html === html ? null : cur));
  }, []);

  const pageOf = (c: DesignComment) => design.pages.find((p) => p.id === c.pageId) ?? design.pages.find((p) => p.html === c.html);

  /** Selects and centres the comment's page, then has its picker scroll to the element and open the thread. */
  const openComment = (c: DesignComment) => {
    const page = pageOf(c);
    if (!page) return;
    setActiveThread({ html: c.html, selector: c.selector });
    setNodes((ns) => ns.map((n) => (n.selected === (n.id === page.id) ? n : { ...n, selected: n.id === page.id })));
    focus(page.id);
    frames.get(page.id)?.current?.contentWindow?.postMessage({ type: 'qw-picker:focus', selector: c.selector }, '*');
  };

  /** Asks the page's picker for the element's current info; null if the page or element isn't there. */
  const describe = (win: Window, selector: string) =>
    new Promise<PickedElement | null>((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const done = (el: PickedElement | null) => {
        window.removeEventListener('message', onMessage);
        window.clearTimeout(timer);
        resolve(el);
      };
      const onMessage = (e: MessageEvent) => {
        if (e.source === win && e.data?.type === 'qw-picker:described' && e.data.id === id) done(e.data.element ?? null);
      };
      const timer = window.setTimeout(() => done(null), 1000);
      window.addEventListener('message', onMessage);
      win.postMessage({ type: 'qw-picker:describe', id, selector }, '*');
    });

  const attachComment = async (c: DesignComment) => {
    const page = pageOf(c);
    const win = page && frames.get(page.id)?.current?.contentWindow;
    const el = win ? await describe(win, c.selector) : null;
    attachRef.current?.({
      pageId: c.pageId,
      pageName: page?.name ?? c.pageName,
      html: page?.html ?? c.html,
      selector: c.selector,
      name: el?.name ?? c.elementName,
      tag: el?.tag ?? '',
      text: el?.text ?? '',
      rect: el?.rect ?? { x: 0, y: 0, width: 0, height: 0 },
      styles: el?.styles ?? {},
      comment: c.content,
    });
  };

  const mode = useMemo(
    () => ({ designing, commenting, threads, frames, onPick, onAttach: attach, onThread }),
    [designing, commenting, threads, frames, onPick, attach, onThread],
  );
  const done = design.pages.filter((p) => p.status === 'done').length;

  // The side column shows the comment list in comment mode, or the visual editor for a picked element.
  const view = commenting ? 'comments' : designing && pick ? 'editor' : null;
  const open = view !== null;
  // Keeps the last content on screen while the panel slides closed.
  const lastView = useRef(view);
  if (view) lastView.current = view;
  const shownView = view ?? lastView.current;
  const lastPick = useRef<Pick | null>(null);
  if (pick) lastPick.current = pick;
  const shown = pick ?? lastPick.current;

  return (
    <div className={`design-canvas ${designing ? 'is-designing' : ''}`}>
      <div className="design-canvas-stage">
      <div className="design-canvas-bar">
        <b>{design.title}</b>
        <span>{design.platform === 'desktop' ? '桌面端' : '移动端'} · {width}×{height}</span>
        <span className={done === design.pages.length ? 'is-done' : ''}>
          {done === design.pages.length ? `${done} 个页面` : `${done}/${design.pages.length} 个页面已完成`}
        </span>
      </div>
      <CanvasMode.Provider value={mode}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onInit={(instance) => { flow.current = instance; }}
        onNodeClick={(_, node) => focus(node.id)}
        zoomOnDoubleClick={false}
        nodesConnectable={false}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={44} size={4} color="#9fd4ff" bgColor="transparent" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
      </CanvasMode.Provider>
      </div>
      <div
        className={`design-canvas-side ${open ? 'is-open' : ''}`}
        aria-hidden={!open}
        onTransitionEnd={(e) => {
          if (e.target !== e.currentTarget || e.propertyName !== 'width') return;
          const id = shownView === 'editor' ? lastPick.current?.pageId : nodes.find((n) => n.selected)?.id;
          // Wait a frame so React Flow has picked up the stage's new size before fitting.
          requestAnimationFrame(() => (id ? focus(id) : flow.current?.fitView({ padding: 0.12, duration: 400 })));
        }}
      >
        {shownView === 'comments' ? (
          <CommentList
            comments={comments}
            active={activeThread}
            interactive={open}
            emptyHint="在预览页里选中元素即可留下评论"
            onOpen={openComment}
            onAttach={onAttach ? attachComment : undefined}
          />
        ) : shown && (
          <VisualEditor
            key={`${shown.pageId}|${shown.element.selector}`}
            name={shown.element.name}
            selector={shown.element.selector}
            pageName={shown.pageName}
            initial={shown.element.styles}
            save={save}
            onChange={editStyle}
            onClose={() => pick?.frame.postMessage({ type: 'qw-picker:clear' }, '*')}
          />
        )}
      </div>
    </div>
  );
}
