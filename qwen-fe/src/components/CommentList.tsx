import { useEffect, useMemo, useRef, type MouseEvent } from 'react';
import type { DesignComment } from '../types';
import { Icon } from './Icon';

/** Comments grouped per element, in the shape the picker script draws badges and popovers from. */
export interface CommentThread {
  html: string;
  selector: string;
  elementName: string;
  comments: Pick<DesignComment, 'author' | 'content' | 'createdAt'>[];
}

/** Threads of the open comments; resolved ones get no badge. */
export function toThreads(comments: DesignComment[]): CommentThread[] {
  const map = new Map<string, CommentThread>();
  for (const c of comments) {
    if (c.resolvedAt) continue;
    const key = `${c.html}\n${c.selector}`;
    const t = map.get(key) ?? { html: c.html, selector: c.selector, elementName: c.elementName, comments: [] };
    t.comments.push({ author: c.author, content: c.content, createdAt: c.createdAt });
    map.set(key, t);
  }
  return [...map.values()];
}

export type ThreadKey = { html: string; selector: string };

const formatTime = (t: number) =>
  new Date(t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

interface Props {
  comments: DesignComment[];
  /** Thread whose popover is open; its comments are highlighted and scrolled into view. */
  active?: ThreadKey | null;
  /** Page shown in a single-page view; comments on other pages are dimmed. Omit when every page is visible. */
  currentHtml?: string | null;
  /** False while the list is slid away, to keep it out of the tab order. */
  interactive?: boolean;
  emptyHint: string;
  onOpen: (c: DesignComment) => void;
  onAttach?: (c: DesignComment) => void;
  /** Marks a comment 完成 (true) or reopens it (false). */
  onResolve?: (c: DesignComment, resolved: boolean) => void;
}

/** Review comments, open ones first (newest first) and resolved ones below; clicking one jumps to its element. */
export function CommentList({ comments, active, currentHtml, interactive = true, emptyHint, onOpen, onAttach, onResolve }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [open, resolved] = useMemo(() => {
    const open = comments.filter((c) => !c.resolvedAt).sort((a, b) => b.createdAt - a.createdAt);
    const resolved = comments.filter((c) => c.resolvedAt).sort((a, b) => b.resolvedAt! - a.resolvedAt!);
    return [open, resolved];
  }, [comments]);

  useEffect(() => {
    if (active) root.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [active]);

  const tab = interactive ? 0 : -1;
  const action = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation();
    fn();
  };

  const item = (c: DesignComment) => {
    const done = !!c.resolvedAt;
    const other = currentHtml !== undefined && c.html !== currentHtml;
    const isActive = !done && active?.html === c.html && active.selector === c.selector;
    return (
      <li key={c.id}>
        <div
          role="button"
          tabIndex={tab}
          className={`comment-item ${other ? 'is-other' : ''} ${isActive ? 'is-active' : ''} ${done ? 'is-resolved' : ''}`}
          title={other ? `跳转到「${c.pageName}」并定位到元素` : '定位到元素'}
          onClick={() => onOpen(c)}
          onKeyDown={(e) => {
            if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return;
            e.preventDefault();
            onOpen(c);
          }}
        >
          <div className="comment-item-meta">
            <b>{c.author}</b>
            <span>{formatTime(c.createdAt)}</span>
            {onResolve && (
              <button
                className="comment-item-resolve"
                tabIndex={tab}
                title={done ? '重新打开这条评论' : '标记为已完成'}
                onClick={action(() => onResolve(c, !done))}
              >
                {done ? <><Icon name="refresh" size={13} />重新打开</> : <><Icon name="check" size={13} />完成</>}
              </button>
            )}
          </div>
          <p>{c.content}</p>
          <div className="comment-item-foot">
            <div className="comment-item-target" title={c.selector}>
              <span>{c.pageName}</span>
              <code>{c.elementName}</code>
            </div>
            {onAttach && !done && (
              <button
                className="comment-item-attach"
                tabIndex={tab}
                title="把评论和元素信息添加到对话，让 AI 按评论修改"
                onClick={action(() => onAttach(c))}
              >
                <Icon name="chatAdd" size={14} />添加到对话
              </button>
            )}
          </div>
        </div>
      </li>
    );
  };

  return (
    <div className="comment-panel" ref={root}>
      <div className="comment-panel-head">
        评论<span>{open.length}</span>
      </div>
      {comments.length === 0 ? (
        <div className="comment-panel-empty">
          <Icon name="comment" size={22} />
          <p>还没有评论</p>
          <span>{emptyHint}</span>
        </div>
      ) : (
        <ul className="comment-list">
          {open.map(item)}
          {resolved.length > 0 && <li className="comment-list-divider">已完成 {resolved.length}</li>}
          {resolved.map(item)}
        </ul>
      )}
    </div>
  );
}
