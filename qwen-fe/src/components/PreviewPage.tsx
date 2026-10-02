import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import { copyToClipboard } from '../clipboard';
import type { DesignComment, DesignDoc } from '../types';
import { CommentList, toThreads, type ThreadKey } from './CommentList';
import { Icon, LogoMark } from './Icon';

/** Path of the standalone prototype preview for a design conversation. */
export const previewPath = (conversationId: string) => `/preview/${encodeURIComponent(conversationId)}`;

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; design: DesignDoc; url: string };

const decode = (path: string) => {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
};

/** Full-page preview of a design prototype, starting from its entry page (the first page in design.json). */
export function PreviewPage({ conversationId }: { conversationId: string }) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [shared, setShared] = useState<'ok' | 'fail' | null>(null);
  const sharedTimer = useRef<number>();

  const share = () => {
    copyToClipboard(location.href).then(
      () => setShared('ok'),
      () => setShared('fail'),
    );
    window.clearTimeout(sharedTimer.current);
    sharedTimer.current = window.setTimeout(() => setShared(null), 2000);
  };
  useEffect(() => () => window.clearTimeout(sharedTimer.current), []);

  const design = state.status === 'ready' ? state.design : undefined;
  const mobile = design?.platform !== 'desktop';

  // Element picking and commenting reuse the picker script the preview server injects into every page.
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<{ name: string; selector: string } | null>(null);
  const [comments, setComments] = useState<DesignComment[]>([]);
  /** HTML path (in the work dir) of the page currently shown in the frame, as reported by the picker. */
  const [currentHtml, setCurrentHtml] = useState<string | null>(null);
  const currentHtmlRef = useRef(currentHtml);
  currentHtmlRef.current = currentHtml;
  /** Thread whose popover is open in the frame; its comments are highlighted in the side sheet. */
  const [activeThread, setActiveThread] = useState<ThreadKey | null>(null);
  const pendingFocus = useRef<ThreadKey | null>(null);
  const [frameNonce, setFrameNonce] = useState(0);

  const post = (msg: unknown) => frameRef.current?.contentWindow?.postMessage(msg, '*');

  const threads = useMemo(() => toThreads(comments), [comments]);

  const latest = useRef({ picking, threads, design, conversationId });
  latest.current = { picking, threads, design, conversationId };

  const syncFrame = () => {
    post({ type: 'qw-picker', on: latest.current.picking, attach: false, comment: true });
    post({ type: 'qw-picker:threads', items: latest.current.threads });
  };

  useEffect(() => {
    post({ type: 'qw-picker', on: picking, attach: false, comment: true });
    if (!picking) setPicked(null);
  }, [picking]);

  useEffect(() => {
    post({ type: 'qw-picker:threads', items: threads });
  }, [threads]);

  useEffect(() => {
    if (!design) return;
    let cancelled = false;
    api.comments(conversationId).then((list) => !cancelled && setComments(list), () => {});
    return () => { cancelled = true; };
  }, [conversationId, design, picking]);

  useEffect(() => {
    const pageFor = (path: string) => latest.current.design?.pages.find((p) => p.html && decode(path).endsWith(`/${p.html}`));

    const submit = async (path: string, element: { selector: string; name: string }, content: string) => {
      try {
        const page = pageFor(path);
        if (!page) throw new Error('找不到当前页面，无法评论');
        const comment = await api.addComment(latest.current.conversationId, {
          pageId: page.id,
          selector: element.selector,
          elementName: element.name,
          content,
        });
        setComments((prev) => [...prev, comment]);
        post({ type: 'qw-picker:comment-saved', ok: true });
      } catch (err) {
        post({ type: 'qw-picker:comment-saved', ok: false, message: (err as Error).message || '提交失败，请重试' });
      }
    };

    const onMessage = (e: MessageEvent) => {
      if (!frameRef.current || e.source !== frameRef.current.contentWindow) return;
      const d = e.data;
      if (d?.type === 'qw-picker:pick') {
        setPicked(d.element ? { name: d.element.name, selector: d.element.selector } : null);
      } else if (d?.type === 'qw-picker:ready') {
        const html = pageFor(String(d.path))?.html ?? null;
        setCurrentHtml(html);
        const pending = pendingFocus.current;
        if (pending && (!html || pending.html === html)) {
          post({ type: 'qw-picker:focus', selector: pending.selector });
          pendingFocus.current = null;
        }
      } else if (d?.type === 'qw-picker:thread') {
        const html = currentHtmlRef.current;
        setActiveThread(d.selector && html ? { html, selector: String(d.selector) } : null);
      } else if (d?.type === 'qw-picker:comment' && d.element && typeof d.content === 'string') {
        submit(String(d.path), d.element, d.content);
      }
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setPicking(false);
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  /** Navigating inside the prototype loads a fresh page, which needs picking and comment badges sent again. */
  const onFrameLoad = () => {
    setPicked(null);
    syncFrame();
  };

  /** Jumps to a comment from the side sheet, loading its page first if the frame shows another one. */
  const openComment = async (c: DesignComment) => {
    setActiveThread({ html: c.html, selector: c.selector });
    if (c.html === currentHtml) {
      pendingFocus.current = null;
      post({ type: 'qw-picker:focus', selector: c.selector });
      return;
    }
    pendingFocus.current = { html: c.html, selector: c.selector };
    let url: string;
    try {
      url = await api.previewUrl(conversationId, c.html);
    } catch {
      pendingFocus.current = null;
      return;
    }
    if (pendingFocus.current?.selector !== c.selector || pendingFocus.current.html !== c.html) return;
    if (state.status === 'ready' && state.url === url) {
      if (!currentHtml) {
        // The frame is on this page (it just wasn't recognised), so no load event will come.
        pendingFocus.current = null;
        post({ type: 'qw-picker:focus', selector: c.selector });
        return;
      }
      // Links inside the prototype navigated the frame away without changing `url`; remount it to load the page.
      setFrameNonce((n) => n + 1);
      return;
    }
    setState((s) => (s.status === 'ready' ? { ...s, url } : s));
  };

  /** Marks a comment 完成 (or reopens it) right away, rolling back if the server refuses. */
  const resolveComment = (c: DesignComment, resolved: boolean) => {
    const patch = (resolvedAt: number | undefined) =>
      setComments((list) => list.map((x) => (x.id === c.id ? { ...x, resolvedAt } : x)));
    patch(resolved ? Date.now() : undefined);
    api.resolveComment(conversationId, c.id, resolved).then(
      (saved) => patch(saved.resolvedAt),
      () => patch(c.resolvedAt),
    );
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const design = await api.design(conversationId);
      const entry = design.pages.find((p) => p.html);
      if (!entry?.html) throw new Error('原型还没有生成好的页面');
      const url = await api.previewUrl(conversationId, entry.html);
      if (!cancelled) setState({ status: 'ready', design, url });
    })().catch((err: Error) => !cancelled && setState({ status: 'error', message: err.message || '加载预览失败' }));
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    document.title = design ? `${design.title} · 原型预览` : '原型预览';
  }, [design]);

  // Mobile prototypes keep their real viewport and shrink to fit short windows.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || !design || !mobile) return;
    const fit = () => {
      const { width, height } = design.viewport;
      setScale(Math.min(1, (stage.clientWidth - 48) / width, (stage.clientHeight - 48) / height));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [design, mobile]);

  return (
    <div className="preview-page">
      <header className="preview-head">
        <LogoMark size={24} />
        <div className="preview-title">
          <b>{design?.title ?? '原型预览'}</b>
          {design && <span>{mobile ? '移动端' : '桌面端'} · {design.viewport.width}×{design.viewport.height} · {design.pages.length} 个页面</span>}
        </div>
        {picking && (
          <span className="preview-picked" title={picked?.selector}>{picked ? picked.name : '点击页面中的元素进行评论，Esc 退出'}</span>
        )}
        <button
          className={`preview-pick ${picking ? 'is-on' : ''}`}
          disabled={!design}
          title={picking ? '退出选择元素' : '选择元素'}
          aria-label="选择元素"
          aria-pressed={picking}
          onClick={() => setPicking((v) => !v)}
        >
          <Icon name="target" size={18} />
        </button>
        <button className={`preview-share ${shared === 'ok' ? 'is-done' : ''}`} disabled={!design} onClick={share}>
          <Icon name={shared === 'ok' ? 'check' : 'share'} size={16} />
          {shared === 'ok' ? '链接已复制' : shared === 'fail' ? '复制失败，请重试' : '分享'}
        </button>
      </header>
      <div className="preview-body">
        <aside className={`preview-comments ${picking ? 'is-open' : ''}`} aria-hidden={!picking}>
          <CommentList
            comments={comments}
            active={activeThread}
            currentHtml={currentHtml}
            interactive={picking}
            emptyHint="选中页面中的元素，在下方输入框里留下评论"
            onOpen={openComment}
            onResolve={resolveComment}
          />
        </aside>
        <div className={`preview-stage ${mobile ? 'is-mobile' : ''}`} ref={stageRef}>
          {state.status === 'loading' ? (
            <div className="preview-status"><Icon name="loading" className="spin" size={28} /></div>
          ) : state.status === 'error' ? (
            <div className="preview-status"><p>{state.message}</p></div>
          ) : mobile ? (
            <div
              className="preview-device"
              style={{ width: state.design.viewport.width * scale, height: state.design.viewport.height * scale }}
            >
              <iframe
                key={frameNonce}
                ref={frameRef}
                onLoad={onFrameLoad}
                title={state.design.title}
                src={state.url}
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                style={{ width: state.design.viewport.width, height: state.design.viewport.height, transform: `scale(${scale})` }}
              />
            </div>
          ) : (
            <iframe key={frameNonce} ref={frameRef} onLoad={onFrameLoad} className="preview-full" title={state.design.title} src={state.url} sandbox="allow-scripts allow-forms allow-modals allow-popups" />
          )}
        </div>
      </div>
    </div>
  );
}
