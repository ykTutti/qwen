import { useEffect, useRef, useState } from 'react';
import type { CloudSpaceItem, SearchHit, ToastFn } from '../types';
import { api } from '../api/client';
import { Icon } from './Icon';

type Tab = 'history' | 'cloud';

interface Props {
  onSelect: (id: string) => void;
  onClose: () => void;
  toast: ToastFn;
}

function Highlight({ text, keyword, className }: { text: string; keyword: string; className: string }) {
  const k = keyword.trim();
  if (!k) return <div className={className}>{text}</div>;
  const re = new RegExp(`(${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return (
    <div className={className}>
      {text.split(re).map((part, i) =>
        part.toLowerCase() === k.toLowerCase() ? <span key={i} className="hl">{part}</span> : <span key={i}>{part}</span>,
      )}
    </div>
  );
}

export function SearchModal({ onSelect, onClose, toast }: Props) {
  const [tab, setTab] = useState<Tab>('history');
  const [keyword, setKeyword] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<SearchHit[]>([]);
  const [cloud, setCloud] = useState<CloudSpaceItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    const t = setTimeout(() => setQuery(keyword.trim()), keyword.trim() ? 300 : 0);
    return () => clearTimeout(t);
  }, [keyword]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const req = tab === 'history'
      ? api.searchHistory(query).then((r) => alive && setHistory(r))
      : api.searchCloud(query).then((r) => alive && setCloud(r));
    req
      .catch((err: Error) => alive && toast(err.message || '搜索失败'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [tab, query, toast]);

  const pending = loading || keyword.trim() !== query;

  const renderBody = () => {
    if (pending) {
      return (
        <div className="search-skeleton">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" />)}
        </div>
      );
    }
    const empty = tab === 'history' ? history.length === 0 : cloud.length === 0;
    if (empty) {
      return (
        <div className="search-empty">
          <Icon name="search2" size={40} />
          <span>{query ? '搜索无结果' : '暂无内容'}</span>
        </div>
      );
    }
    if (tab === 'history') {
      return (
        <div className="search-list">
          {history.map(({ conversation, snippet }) => (
            <button key={conversation.id} className="search-item" onClick={() => { onSelect(conversation.id); onClose(); }}>
              <Highlight text={conversation.title} keyword={query} className="search-item-title" />
              {snippet && <Highlight text={snippet} keyword={query} className="search-item-snippet" />}
            </button>
          ))}
        </div>
      );
    }
    return (
      <div className="search-list">
        {cloud.map((it) => (
          <button key={it.id} className="space-item" onClick={() => toast(`打开「${it.name}」（演示）`)}>
            <img src={it.icon} alt="" />
            <Highlight text={it.name} keyword={query} className="space-item-title" />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="modal-mask" onMouseDown={onClose}>
      <div className="search-modal" role="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-head">
          <div className="search-tabs" role="tablist">
            {([['history', '历史对话'], ['cloud', '云空间']] as const).map(([key, label]) => (
              <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>
                {label}
              </button>
            ))}
          </div>
          <button className="icon-btn search-close" title="关闭" onClick={onClose}><Icon name="close" size={20} /></button>
        </div>
        <div className="search-input-wrap">
          <label className="search-input">
            {pending && keyword ? <Icon name="loading" className="spin" /> : <Icon name="search2" />}
            <input ref={inputRef} value={keyword} maxLength={50} placeholder="搜索" onChange={(e) => setKeyword(e.target.value)} />
            {keyword && (
              <button type="button" className="search-clear" title="清空" onClick={() => { setKeyword(''); inputRef.current?.focus(); }}>
                <Icon name="close" size={10} />
              </button>
            )}
          </label>
        </div>
        <div className="search-body">{renderBody()}</div>
      </div>
    </div>
  );
}
