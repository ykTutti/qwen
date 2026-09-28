import { useEffect, useRef, useState } from 'react';
import type { Conversation, Surface, User, ToastFn } from '../types';
import { Icon, Wordmark } from './Icon';
import { Popover } from './Popover';

interface Props {
  collapsed: boolean;
  surface: Surface;
  loading: boolean;
  user: User | null;
  inChat: boolean;
  temporary: boolean;
  conversations: Conversation[];
  activeId: string | null;
  streamingId: string | null;
  onSurface: (s: Surface) => void;
  onToggle: () => void;
  onNew: () => void;
  onTemporary: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onLogin: () => void;
  onLogout: () => void;
  onSearch: () => void;
  toast: ToastFn;
}

export function Sidebar(props: Props) {
  const { collapsed, surface, conversations, activeId, user } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const list = conversations
    .filter((c) => c.surface === surface)
    .sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);

  const commitRename = () => {
    if (editingId && editValue.trim()) props.onRename(editingId, editValue.trim());
    setEditingId(null);
  };

  const daily = surface === 'daily';
  const navs = daily
    ? [
        { icon: 'genre', label: '云空间' },
        { icon: 'aiVideo', label: '千问创作', external: true },
      ]
    : [
        { icon: 'component', label: '技能' },
        { icon: 'connector', label: '连接' },
        { icon: 'folder', label: '项目' },
        { icon: 'personalComputer', label: '本地工作助理' },
      ];

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-header">
        <button className="brand" onClick={props.onNew}><Wordmark height={20} /></button>
        <div className="sidebar-header-actions">
          {daily && user && (
            <button className="icon-btn" data-tip="搜索" onClick={props.onSearch}>
              <Icon name="search2" />
            </button>
          )}
          <button className="icon-btn" data-tip="收起侧边栏" onClick={props.onToggle}>
            <Icon name="sidebarLeft" />
          </button>
        </div>
      </div>

      <div className="surface-switch">
        <div className="segmented">
          <button className={daily ? 'is-active' : ''} onClick={() => props.onSurface('daily')}>日常</button>
          <button className={!daily ? 'is-active' : ''} onClick={() => props.onSurface('work')}>工作</button>
        </div>
      </div>

      <div className={`sidebar-scroll ${daily ? '' : 'is-work'}`}>
        <div className="side-row-wrap">
          <button className={`side-row ${!activeId && !props.temporary ? 'is-current' : ''}`} onClick={props.onNew}>
            <Icon name="add" />
            <span>{daily ? '新对话' : '新任务'}</span>
          </button>
          {daily && (
            <button
              className={`icon-btn side-row-extra ${props.temporary ? 'is-on' : ''}`}
              title="临时对话"
              onClick={props.onTemporary}
            >
              <Icon name="temporaryDialogue" />
            </button>
          )}
        </div>

        {navs.map((n) => (
          <button key={n.label} className="side-row" onClick={() => props.toast(`${n.label}（mock 功能）`)}>
            <Icon name={n.icon} />
            <span>{n.label}</span>
            {'external' in n && n.external && <Icon name="arrowRightUp2" size={16} className="side-row-tail" />}
          </button>
        ))}

        <div className="side-section is-schedule">
          <div className="side-label">定时任务</div>
          <button className="side-row" onClick={() => props.toast('新定时任务（mock 功能）')}>
            <Icon name="add" />
            <span>新定时任务</span>
          </button>
        </div>

        <div className="side-section">
          {props.loading ? (
            <div className="history-skeleton">
              {[70, 90, 60].map((w, i) => <div key={i} className="skeleton" style={{ width: `${w}%` }} />)}
            </div>
          ) : list.length === 0 ? (
            daily && <div className="side-label">暂无对话</div>
          ) : (
            <>
              <div className="side-label">最近对话</div>
              {list.map((c) => (
                <div
                  key={c.id}
                  className={`history-item ${c.id === activeId ? 'is-active' : ''}`}
                  onClick={() => editingId !== c.id && props.onSelect(c.id)}
                >
                  {editingId === c.id ? (
                    <RenameInput value={editValue} onChange={setEditValue} onCommit={commitRename} onCancel={() => setEditingId(null)} />
                  ) : (
                    <span className="history-title">
                      {c.pinned && <Icon name="pin" size={13} className="history-pin" />}
                      {c.title}
                    </span>
                  )}
                  {(c.unread || c.id === props.streamingId) && c.id !== activeId && <i className="history-dot" />}
                  {editingId !== c.id && (
                    <div className="history-more" onClick={(e) => e.stopPropagation()}>
                      <Popover
                        placement="bottom-end"
                        trigger={(open, toggle) => (
                          <button className={`icon-btn xs ${open ? 'is-open' : ''}`} onClick={toggle}><Icon name="more" /></button>
                        )}
                      >
                        {(close) => (
                          <div className="menu">
                            <button onClick={() => { props.onPin(c.id); close(); }}><Icon name="pin" size={16} />{c.pinned ? '取消置顶' : '置顶'}</button>
                            <button onClick={() => { setEditingId(c.id); setEditValue(c.title); close(); }}><Icon name="edit" />重命名</button>
                            <button onClick={() => { props.toast('分享链接已复制（mock）'); close(); }}><Icon name="share" size={16} />分享</button>
                            <div className="menu-divider" />
                            <button className="danger" onClick={() => { props.onDelete(c.id); close(); }}><Icon name="trash" size={16} />删除</button>
                          </div>
                        )}
                      </Popover>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      <div className={`sidebar-footer ${user ? 'is-user' : ''}`}>
        {!user && props.inChat ? (
          <div className="login-guide">
            <p>登录可同步历史对话，解锁更多功能</p>
            <button className="btn-primary block" onClick={props.onLogin}>登录</button>
          </div>
        ) : user ? (
          <div className="user-bar">
          <Popover
            placement="top-start"
            className="popover-user"
            trigger={(_, toggle) => (
              <button className="user-row" onClick={toggle}>
                <img className="avatar" src={user.avatar} alt="" draggable={false} />
                <span className="user-name">{user.name}</span>
              </button>
            )}
          >
            {(close) => (
              <div className="menu user-menu">
                <div className="menu-head">{user.phone || user.account}</div>
                <button onClick={() => { props.toast('个人设置（mock）'); close(); }}><Icon name="settings" size={16} />设置</button>
                <button onClick={() => { props.toast('千问 · 阿里旗下全能 AI 助手'); close(); }}><Icon name="info" />关于千问</button>
                <div className="menu-divider" />
                <button onClick={() => { props.onLogout(); close(); }}><Icon name="logout" size={16} />退出登录</button>
              </div>
            )}
          </Popover>
          </div>
        ) : (
          <div className="about-row">
            <button className="side-row" onClick={() => props.toast('千问 · 阿里旗下全能 AI 助手')}>
              <Icon name="info" />
              <span>关于千问</span>
            </button>
            <button className="icon-btn" title="下载千问 App" onClick={() => props.toast('扫码下载千问 App（mock）')}>
              <Icon name="downloadAPP" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}

function RenameInput(props: { value: string; onChange: (v: string) => void; onCommit: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="rename-input"
      value={props.value}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => props.onChange(e.target.value)}
      onBlur={props.onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') props.onCommit();
        if (e.key === 'Escape') props.onCancel();
      }}
    />
  );
}
