import { lazy, Suspense, useEffect, useState } from 'react';
import { api, downloadOutputFile, fetchOutputFile } from '../api/client';
import { previewPath } from './PreviewPage';
import { DESIGN_FILE, type DesignDoc, type ElementRef, type OutputFile, type ToastFn } from '../types';
import { FileIcon, isMarkdownFile } from './FileIcon';
import { Icon } from './Icon';
import { Markdown, formatSize } from './MessageList';
import { PptxPreview } from './PptxPreview';

const DesignCanvas = lazy(() => import('./DesignCanvas'));

interface Props {
  conversationId: string;
  file: OutputFile;
  /** Live design.json pushed during the current session; fetched from the server when absent. */
  design?: DesignDoc;
  /** Use the canvas width for every file, so switching between the plan and the canvas doesn't resize the panel. */
  wide?: boolean;
  onAttachElement?: (ref: ElementRef) => void;
  onClose: () => void;
  toast: ToastFn;
}

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; content: string; url?: string }
  | { status: 'ready'; deck: ArrayBuffer }
  | { status: 'ready'; design: DesignDoc };

const kindOf = (file: OutputFile) =>
  file.path === DESIGN_FILE ? 'canvas'
  : isMarkdownFile(file.name) ? 'markdown'
  : /\.html?$/i.test(file.name) ? 'html'
  : /\.pptx$/i.test(file.name) ? 'pptx'
  : 'other';

export function FilePanel({ conversationId, file, design: live, wide, onAttachElement, onClose, toast }: Props) {
  const kind = kindOf(file);
  const previewable = kind !== 'other';
  const [state, setState] = useState<State>({ status: 'loading' });
  const [source, setSource] = useState(false);
  /** Canvas mode; designing and commenting share the canvas's side panel, so only one is on at a time. */
  const [canvasMode, setCanvasMode] = useState<'design' | 'comment' | null>(null);
  const toggleMode = (m: 'design' | 'comment') => setCanvasMode((cur) => (cur === m ? null : m));
  const [downloading, setDownloading] = useState(false);
  const hasLive = !!live;
  const design = live ?? (state.status === 'ready' && 'design' in state ? state.design : undefined);
  /** Design and comment edit the finished pages, so both stay disabled until every page has been generated. */
  const pagesReady = !!design?.pages.length && design.pages.every((p) => p.status === 'done' && !!p.html);

  useEffect(() => {
    if (kind === 'other' || (kind === 'canvas' && hasLive)) return;
    let cancelled = false;
    setState({ status: 'loading' });
    const load: Promise<State> =
      kind === 'canvas'
        ? api.design(conversationId).then((d) => ({ status: 'ready', design: d }))
        : kind === 'pptx'
        ? fetchOutputFile(conversationId, file.path).then((b) => b.arrayBuffer()).then((deck) => ({ status: 'ready', deck }))
        : kind === 'html'
          ? Promise.all([api.outputFile(conversationId, file.path), api.previewUrl(conversationId, file.path)])
              .then(([d, url]) => ({ status: 'ready', content: d.content, url: `${url}?v=${file.updatedAt}` }))
          : api.outputFile(conversationId, file.path).then((d) => ({ status: 'ready', content: d.content }));
    load.then(
      (next) => !cancelled && setState(next),
      (err: Error) => !cancelled && setState({ status: 'error', message: err.message || '打开文件失败' }),
    );
    return () => { cancelled = true; };
  }, [conversationId, file.path, file.updatedAt, kind, hasLive]);

  useEffect(() => {
    if (!pagesReady) setCanvasMode(null);
  }, [pagesReady]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadOutputFile(conversationId, file.path, file.name);
    } catch (err) {
      toast(err instanceof Error ? err.message : '下载失败', 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <aside className={`file-panel ${kind === 'canvas' || wide ? 'is-wide' : ''}`} aria-label={file.name}>
      <header className="file-panel-head">
        <span className="file-panel-title" title={file.path}>{kind === 'canvas' ? '设计画布' : file.name}</span>
        <div className="file-panel-actions">
          {kind === 'canvas' && design && (
            <>
              <button className={`file-panel-btn ${canvasMode === 'design' ? 'is-on' : ''}`} disabled={!pagesReady} title={pagesReady ? undefined : '页面全部生成后可开始设计'} onClick={() => toggleMode('design')}>
                <Icon name="pen" size={18} />{canvasMode === 'design' ? '退出设计' : '开始设计'}
              </button>
              <button className={`file-panel-btn ${canvasMode === 'comment' ? 'is-on' : ''}`} disabled={!pagesReady} title={pagesReady ? undefined : '页面全部生成后可评论'} onClick={() => toggleMode('comment')}>
                <Icon name="comment" size={18} />评论
              </button>
            </>
          )}
          {(kind === 'markdown' || kind === 'html') && state.status === 'ready' && (
            <button className="file-panel-btn" onClick={() => setSource((v) => !v)}>
              <Icon name={source ? 'eye' : 'code'} size={18} />{source ? '预览' : '查看源码'}
            </button>
          )}
          {kind === 'canvas' ? (
            <button
              className="file-panel-btn"
              disabled={!pagesReady}
              title={pagesReady ? undefined : '页面全部生成后可预览'}
              onClick={() => window.open(previewPath(conversationId), '_blank')}
            >
              <Icon name="eye" size={18} />预览
            </button>
          ) : (
            <button className="file-panel-btn" disabled={downloading || (previewable && !design && state.status === 'loading')} onClick={download}>
              <Icon name={downloading ? 'loading' : 'download'} size={18} className={downloading ? 'spin' : undefined} />下载
            </button>
          )}
          <button className="icon-btn" title="收起" aria-label="收起" onClick={onClose}><Icon name="collapse" size={18} /></button>
        </div>
      </header>
      <div className={`file-panel-body ${kind === 'pptx' ? 'is-deck' : (kind === 'html' || kind === 'canvas') && !source ? 'is-frame' : ''}`}>
        {kind === 'canvas' && design ? (
          <Suspense fallback={<div className="file-panel-loading"><Icon name="loading" className="spin" size={28} /></div>}>
            <DesignCanvas conversationId={conversationId} design={design} 
              designing={canvasMode === 'design'}
              commenting={canvasMode === 'comment'}
              onAttach={onAttachElement}
            />
          </Suspense>
        ) : !previewable ? (
          <div className="file-panel-nopreview">
            <FileIcon name={file.name} size={64} />
            <h3>{file.name}</h3>
            <p>{formatSize(file.size)} · 暂不支持在线预览，请下载后查看</p>
            <button className="skills-new" disabled={downloading} onClick={download}><Icon name="download" size={16} />下载文件</button>
          </div>
        ) : state.status === 'loading' ? (
          <div className="file-panel-loading"><Icon name="loading" className="spin" size={28} /></div>
        ) : state.status === 'error' ? (
          <div className="file-panel-empty">{state.message}</div>
        ) : 'design' in state ? null : 'deck' in state ? (
          <PptxPreview data={state.deck} />
        ) : kind === 'html' && !source ? (
          // No allow-same-origin: the generated page runs in an opaque origin, isolated from the app.
          <iframe
            className="file-panel-frame"
            title={file.name}
            src={state.url}
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
          />
        ) : (
          <div className="file-panel-doc">
            {source
              ? <pre className="file-panel-source">{state.content}</pre>
              : <Markdown text={state.content} toast={toast} />}
          </div>
        )}
      </div>
    </aside>
  );
}
