import { useEffect, useMemo, useRef, useState } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { api } from '../api/client';
import type { DesignDoc, DesignPage } from '../types';
import { Icon } from './Icon';

interface Props {
  conversationId: string;
  design: DesignDoc;
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

function PageNodeView({ data, selected }: NodeProps<PageNode>) {
  const { page, url, width, height, unit } = data;
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
        ) : url ? (
          <a className="design-node-open nodrag" href={url} target="_blank" rel="noreferrer" title="在新窗口打开">
            <Icon name="arrowRightUp" size={18 * unit} />
          </a>
        ) : null}
      </div>
      <div className="design-node-screen" style={{ width, height }}>
        {page.status === 'done' && url ? (
          // Pointer events only reach the page once the node is selected, so dragging and zooming the canvas still work.
          <iframe
            className={selected ? 'nodrag nowheel' : undefined}
            style={{ pointerEvents: selected ? 'auto' : 'none' }}
            title={page.name}
            src={url}
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
        {page.status === 'done' && !selected && <div className="design-node-hint">点击页面后可直接操作</div>}
      </div>
      <Handle id="out" type="source" position={Position.Right} className="design-handle" />
    </div>
  );
}

const nodeTypes = { page: PageNodeView };

export default function DesignCanvas({ conversationId, design }: Props) {
  const [base, setBase] = useState<string>();
  const [nodes, setNodes, onNodesChange] = useNodesState<PageNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const moved = useRef(new Map<string, { x: number; y: number }>());
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

  const done = design.pages.filter((p) => p.status === 'done').length;

  return (
    <div className="design-canvas">
      <div className="design-canvas-bar">
        <b>{design.title}</b>
        <span>{design.platform === 'desktop' ? '桌面端' : '移动端'} · {width}×{height}</span>
        <span className={done === design.pages.length ? 'is-done' : ''}>
          {done === design.pages.length ? `${done} 个页面` : `${done}/${design.pages.length} 个页面已完成`}
        </span>
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodesConnectable={false}
        edgesFocusable={false}
        fitView
        fitViewOptions={{ padding: 0.12 }}
        minZoom={0.05}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1.5} color="#d9dbe3" />
        <Controls showInteractive={false} position="bottom-left" />
      </ReactFlow>
    </div>
  );
}
