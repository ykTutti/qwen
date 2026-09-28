import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatMode, Conversation, Message, Surface, ToastFn, ToastType, User } from './types';
import { api, ApiError, streamChat, tokenStore, type ChatRequest } from './api/client';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { Home } from './components/Home';
import { MessageList } from './components/MessageList';
import { Composer, type ComposerHandle } from './components/Composer';
import { LoginModal } from './components/LoginModal';
import { SearchModal } from './components/SearchModal';
import { Icon } from './components/Icon';
import { useConfig } from './config';

const TOAST_ICONS: Record<ToastType, string> = { success: 'circleCheck', error: 'attention', info: 'info' };

const uid = () => Math.random().toString(36).slice(2, 10);
const MOBILE = 750;

function draftTitle(prompt: string) {
  const t = prompt.replace(/\s+/g, ' ').trim();
  return t.length > 16 ? `${t.slice(0, 16)}…` : t || '新对话';
}

export default function App() {
  const [collapsed, setCollapsed] = useState(() => window.innerWidth < MOBILE);
  const [surface, setSurface] = useState<Surface>('daily');
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(() => !tokenStore.get());
  const [loginOpen, setLoginOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messagesMap, setMessagesMap] = useState<Record<string, Message[]>>({});
  const [msgLoading, setMsgLoading] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const { models } = useConfig();
  const [model, setModel] = useStoredState('qw-model', (v) => models.some((m) => m.key === v), models[0].key);
  const [mode, setMode] = useStoredState<ChatMode>('qw-mode', (v): v is ChatMode => v === 'fast' || v === 'research', 'fast');
  const [skill, setSkill] = useState<string | undefined>();
  const [temporary, setTemporary] = useState(false);
  const [toastState, setToastState] = useState<{ text: string; type?: ToastType; key: number } | null>(null);

  const cancelRef = useRef<(() => void) | null>(null);
  const composerRef = useRef<ComposerHandle>(null);
  const toastTimer = useRef<number>();
  const activeRef = useRef(activeId);
  activeRef.current = activeId;
  const loggedIn = !!user;

  const toast = useCallback<ToastFn>((text, type) => {
    setToastState({ text, type, key: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastState(null), 3000);
  }, []);

  const fail = useCallback((err: unknown) => toast(err instanceof Error ? err.message : '操作失败', 'error'), [toast]);

  useEffect(() => {
    if (!tokenStore.get()) return;
    api.me()
      .then(setUser)
      .catch((err) => {
        if (err instanceof ApiError && err.status === 401) tokenStore.clear();
        else fail(err);
      })
      .finally(() => setAuthReady(true));
  }, [fail]);

  useEffect(() => {
    if (!authReady) return;
    setConvLoading(true);
    api.conversations()
      .then((list) => setConversations(list))
      .catch(fail)
      .finally(() => setConvLoading(false));
  }, [authReady, user?.id, fail]);

  const closeOnMobile = () => window.innerWidth < MOBILE && setCollapsed(true);

  const stop = useCallback(() => {
    cancelRef.current?.();
    cancelRef.current = null;
    setStreamingId((convId) => {
      if (convId) {
        setMessagesMap((prev) => ({
          ...prev,
          [convId]: (prev[convId] ?? []).map((m) =>
            m.status && m.status !== 'done' && m.status !== 'stopped' ? { ...m, status: 'stopped' } : m,
          ),
        }));
      }
      return null;
    });
  }, []);

  const newChat = useCallback(() => {
    setActiveId(null);
    setSkill(undefined);
    setTemporary(false);
    closeOnMobile();
    requestAnimationFrame(() => composerRef.current?.focus());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        newChat();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [newChat]);

  const switchSurface = (s: Surface) => {
    if (s === surface) return;
    setSurface(s);
    setActiveId(null);
    setSkill(undefined);
    setTemporary(false);
  };

  const selectConv = async (id: string) => {
    closeOnMobile();
    if (id === activeId) return;
    setActiveId(id);
    setSkill(undefined);
    setTemporary(false);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unread: false } : c)));
    if (!messagesMap[id]) {
      setMsgLoading(true);
      try {
        const list = await api.messages(id);
        setMessagesMap((prev) => ({ ...prev, [id]: prev[id] ?? list }));
      } catch (err) {
        fail(err);
      } finally {
        setMsgLoading(false);
      }
    }
  };

  const updateMsg = (convId: string, msgId: string, patch: Partial<Message>) => {
    setMessagesMap((prev) => ({
      ...prev,
      [convId]: (prev[convId] ?? []).map((m) => (m.id === msgId ? { ...m, ...patch } : m)),
    }));
  };

  const runAssistant = (convId: string, req: Omit<ChatRequest, 'assistantMessageId' | 'conversationId' | 'surface'>) => {
    const aid = `am-${uid()}`;
    const assistant: Message = { id: aid, role: 'assistant', content: '', status: 'pending', createdAt: Date.now() };
    setMessagesMap((prev) => ({ ...prev, [convId]: [...(prev[convId] ?? []), assistant] }));
    setStreamingId(convId);

    const finish = () => {
      setStreamingId((cur) => (cur === convId ? null : cur));
      cancelRef.current = null;
    };

    cancelRef.current = streamChat(
      { ...req, conversationId: convId, surface, assistantMessageId: aid },
      {
        onStart: ({ conversation, assistantMessage }) => {
          setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, ...conversation, unread: c.unread } : c)));
          if (assistantMessage?.blocks) updateMsg(convId, aid, { blocks: [] });
        },
        onAnalyzing: (meta) => updateMsg(convId, aid, { ...meta, status: 'analyzing' }),
        onChunk: (c) => updateMsg(convId, aid, { content: c, status: 'streaming' }),
        onBlocks: (blocks, c) => updateMsg(convId, aid, { blocks, content: c, status: 'streaming' }),
        onDone: () => {
          updateMsg(convId, aid, { status: 'done' });
          finish();
          if (activeRef.current !== convId) {
            setConversations((prev) => prev.map((c) => (c.id === convId ? { ...c, unread: true } : c)));
          }
        },
        onError: (err) => {
          updateMsg(convId, aid, { status: 'stopped' });
          finish();
          fail(err);
        },
      },
    );
  };

  const send = (text: string, attachments: string[]) => {
    if (streamingId) {
      toast('请等待当前回答完成');
      return;
    }
    let convId = activeId;
    if (!convId) {
      convId = `n-${uid()}${uid()}`;
      const conv: Conversation = { id: convId, title: draftTitle(text), updatedAt: Date.now(), surface };
      if (!temporary) setConversations((prev) => [conv, ...prev]);
      setMessagesMap((prev) => ({ ...prev, [convId!]: [] }));
      setActiveId(convId);
    } else {
      const id = convId;
      setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, updatedAt: Date.now() } : c)));
    }
    const id = convId;
    const userMsg: Message = { id: `um-${uid()}`, role: 'user', content: text, attachments, skill, createdAt: Date.now() };
    setMessagesMap((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), userMsg] }));
    runAssistant(id, { prompt: text, mode, model, skill, attachments, temporary, userMessageId: userMsg.id });
    setSkill(undefined);
  };

  const regenerate = () => {
    if (!activeId || streamingId) return;
    const list = messagesMap[activeId] ?? [];
    if (!list.some((m) => m.role === 'user')) return;
    const trimmed = list[list.length - 1]?.role === 'assistant' ? list.slice(0, -1) : list;
    setMessagesMap((prev) => ({ ...prev, [activeId]: trimmed }));
    runAssistant(activeId, { regenerate: true, mode, model });
  };

  const patchConv = async (id: string, patch: { title?: string; pinned?: boolean }) => {
    const before = conversations.find((c) => c.id === id);
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    try {
      await api.updateConversation(id, patch);
    } catch (err) {
      if (before) setConversations((prev) => prev.map((c) => (c.id === id ? before : c)));
      fail(err);
    }
  };

  const deleteConv = async (id: string) => {
    try {
      await api.deleteConversation(id);
    } catch (err) {
      fail(err);
      return;
    }
    if (id === streamingId) stop();
    setConversations((prev) => prev.filter((c) => c.id !== id));
    setMessagesMap(({ [id]: _removed, ...rest }) => rest);
    if (id === activeId) setActiveId(null);
    toast('已删除', 'success');
  };

  const deleteMessage = async (messageId: string) => {
    if (!activeId || streamingId === activeId) return;
    const convId = activeId;
    try {
      const { removed } = await api.deleteMessage(convId, messageId);
      setMessagesMap((prev) => ({ ...prev, [convId]: (prev[convId] ?? []).filter((m) => !removed.includes(m.id)) }));
      toast('已删除', 'success');
    } catch (err) {
      fail(err);
    }
  };

  const pickSkill = (key?: string) => {
    if (key === 'agent') {
      switchSurface('work');
      requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }
    if (activeId && key) setActiveId(null);
    setSkill(key);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const resetSession = () => {
    stop();
    setMessagesMap({});
    setActiveId(null);
  };

  const onLoggedIn = (u: User) => {
    resetSession();
    setUser(u);
    setLoginOpen(false);
    toast('登录成功', 'success');
  };

  const logout = async () => {
    await api.logout().catch(() => undefined);
    tokenStore.clear();
    resetSession();
    setUser(null);
    toast('已退出登录', 'success');
  };

  const inChat = !!activeId;
  const messages = activeId ? messagesMap[activeId] ?? [] : [];

  const composer = (
    <Composer
      ref={composerRef}
      surface={surface}
      temporary={temporary && surface === 'daily'}
      streaming={!!streamingId && streamingId === activeId}
      mode={mode}
      skill={skill}
      placeholder={surface === 'work' && !inChat ? '今天一起做点什么？' : undefined}
      onMode={setMode}
      onSkill={pickSkill}
      onSend={send}
      onStop={stop}
      toast={toast}
    />
  );

  return (
    <div className="app">
      <Sidebar
        collapsed={collapsed}
        surface={surface}
        loading={convLoading}
        user={user}
        inChat={inChat}
        temporary={temporary}
        conversations={conversations}
        activeId={activeId}
        streamingId={streamingId}
        onSurface={switchSurface}
        onToggle={() => setCollapsed((v) => !v)}
        onNew={newChat}
        onTemporary={() => { setActiveId(null); setSkill(undefined); setTemporary((v) => !v); }}
        onSelect={selectConv}
        onDelete={deleteConv}
        onRename={(id, title) => patchConv(id, { title })}
        onPin={(id) => patchConv(id, { pinned: !conversations.find((c) => c.id === id)?.pinned })}
        onLogin={() => setLoginOpen(true)}
        onLogout={logout}
        onSearch={() => setSearchOpen(true)}
        toast={toast}
      />
      {!collapsed && <div className="sidebar-mask" onClick={() => setCollapsed(true)} />}

      <div className="main-shell">
        <main className="main">
          <TopBar
            surface={surface}
            model={model}
            loggedIn={loggedIn}
            inChat={inChat}
            sidebarCollapsed={collapsed}
            onModel={setModel}
            onToggleSidebar={() => setCollapsed(false)}
            onNew={newChat}
            onLogin={() => setLoginOpen(true)}
            toast={toast}
          />

          {inChat ? (
            <div className="chat">
              <MessageList
                messages={messages}
                loading={msgLoading}
                onRegenerate={regenerate}
                onEdit={(t) => composerRef.current?.setText(t)}
                onDelete={deleteMessage}
                toast={toast}
                loggedIn={loggedIn}
              />
              <div className="chat-footer">
                {composer}
                <p className="footnote">内容由AI生成，可能不准确，请注意核实</p>
              </div>
            </div>
          ) : (
            <>
              <Home
                surface={surface}
                skill={skill}
                temporary={temporary}
                composer={composer}
                onSkill={pickSkill}
                onPrompt={(t) => composerRef.current?.setText(t)}
                toast={toast}
              />
              {!loggedIn && surface === 'daily' && (
                <p className="footnote home-footnote">
                  <span className="footnote-inner">
                    <span>继续使用即表示您同意</span>
                    <a href="#" onClick={(e) => e.preventDefault()}>用户协议</a>
                    <span>和</span>
                    <a href="#" onClick={(e) => e.preventDefault()}>隐私政策</a>
                  </span>
                </p>
              )}
            </>
          )}
        </main>
      </div>

      {loginOpen && <LoginModal onClose={() => setLoginOpen(false)} onSuccess={onLoggedIn} />}
      {searchOpen && (
        <SearchModal onSelect={selectConv} onClose={() => setSearchOpen(false)} toast={toast} />
      )}
      {toastState && (
        <div key={toastState.key} className="toast" role="status">
          {toastState.type && <Icon name={TOAST_ICONS[toastState.type]} className={`toast-icon is-${toastState.type}`} />}
          {toastState.text}
        </div>
      )}
    </div>
  );
}

function useStoredState<T extends string>(key: string, valid: (v: string) => boolean, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const saved = localStorage.getItem(key);
    return saved !== null && valid(saved) ? (saved as T) : fallback;
  });
  useEffect(() => localStorage.setItem(key, value), [key, value]);
  return [value, setValue] as const;
}
