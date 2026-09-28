import type { AgentBlock, AppConfig, ChatMode, CloudSpaceItem, Conversation, Message, SearchHit, SearchSource, Surface, User } from '../types';

const BASE = import.meta.env.VITE_API_BASE ?? '/api';
const TOKEN_KEY = 'qw-token';
const CLIENT_KEY = 'qw-client-id';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function clientId() {
  let id = localStorage.getItem(CLIENT_KEY);
  if (!id) {
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    id = `c-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
    localStorage.setItem(CLIENT_KEY, id);
  }
  return id;
}

export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

function headers(extra?: HeadersInit): Headers {
  const h = new Headers(extra);
  h.set('X-Client-Id', clientId());
  const token = tokenStore.get();
  if (token) h.set('Authorization', `Bearer ${token}`);
  return h;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: headers({ 'Content-Type': 'application/json', ...init.headers }),
    });
  } catch {
    throw new ApiError(0, '网络异常，请检查服务是否已启动');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data?.message ?? `请求失败（${res.status}）`);
  return data as T;
}

export const api = {
  config: () => request<AppConfig>('/config'),
  login: (account: string, password: string) =>
    request<{ token: string; user: User }>('/auth/login', { method: 'POST', body: JSON.stringify({ account, password }) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => request<User>('/auth/me'),
  conversations: () => request<Conversation[]>('/conversations'),
  messages: (id: string) => request<Message[]>(`/conversations/${encodeURIComponent(id)}/messages`),
  updateConversation: (id: string, patch: { title?: string; pinned?: boolean }) =>
    request<Conversation>(`/conversations/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  deleteMessage: (conversationId: string, messageId: string) =>
    request<{ removed: string[] }>(
      `/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { method: 'DELETE' },
    ),
  deleteConversation: (id: string) => request<{ ok: true }>(`/conversations/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  searchHistory: (q: string) => request<SearchHit[]>(`/search?tab=history&q=${encodeURIComponent(q)}`),
  searchCloud: (q: string) => request<CloudSpaceItem[]>(`/search?tab=cloud&q=${encodeURIComponent(q)}`),
};

export interface ChatRequest {
  conversationId: string;
  surface: Surface;
  temporary?: boolean;
  prompt?: string;
  mode: ChatMode;
  model: string;
  skill?: string;
  attachments?: string[];
  regenerate?: boolean;
  userMessageId?: string;
  assistantMessageId: string;
}

export interface ChatHandlers {
  onStart?: (data: { conversation: Conversation; assistantMessage?: Message }) => void;
  onAnalyzing: (meta: { keywords?: string[]; sources?: SearchSource[]; thinking?: string }) => void;
  onChunk: (fullText: string) => void;
  /** Agent answers stream as ordered blocks: reasoning, tool calls with results, and answer text. */
  onBlocks?: (blocks: AgentBlock[], fullText: string) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

export function streamChat(body: ChatRequest, handlers: ChatHandlers) {
  const ctrl = new AbortController();

  (async () => {
    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: headers({ 'Content-Type': 'application/json', Accept: 'text/event-stream' }),
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(res.status, data?.message ?? `请求失败（${res.status}）`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let content = '';
    let blocks: AgentBlock[] | undefined;
    let finished = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const event = /^event: (.*)$/m.exec(raw)?.[1];
        const dataLine = /^data: (.*)$/m.exec(raw)?.[1];
        if (!event || !dataLine) continue;
        const data = JSON.parse(dataLine);
        if (event === 'start') {
          if (Array.isArray(data.assistantMessage?.blocks)) blocks = [];
          handlers.onStart?.(data);
        }
        else if (event === 'analyzing') handlers.onAnalyzing(data);
        else if (event === 'delta') {
          content += data.text;
          if (blocks) {
            blocks = applyAgentEvent(blocks, event, data);
            handlers.onBlocks?.(blocks, content);
          } else handlers.onChunk(content);
        } else if (event === 'reasoning' || event === 'tool_call' || event === 'tool_result') {
          blocks = applyAgentEvent(blocks ?? (content ? [{ type: 'text', text: content }] : []), event, data);
          handlers.onBlocks?.(blocks, content);
        } else if (event === 'error') {
          finished = true;
          throw new ApiError(0, data.message ?? '回答失败，请重试');
        } else if (event === 'done') {
          finished = true;
          handlers.onDone();
        }
      }
    }
    if (!finished) throw new ApiError(0, '回答中断，请重试');
  })().catch((err: Error) => {
    if (err.name === 'AbortError') return;
    handlers.onError(err instanceof ApiError ? err : new ApiError(0, '网络异常，请检查服务是否已启动'));
  });

  return () => ctrl.abort();
}

function closeReasoning(blocks: AgentBlock[]) {
  const last = blocks[blocks.length - 1];
  if (last?.type === 'reasoning' && !last.endedAt) blocks[blocks.length - 1] = { ...last, endedAt: Date.now() };
}

function applyAgentEvent(prev: AgentBlock[], event: string, data: any): AgentBlock[] {
  const blocks = [...prev];
  const last = blocks[blocks.length - 1];
  if (event === 'reasoning') {
    if (last?.type === 'reasoning' && !last.endedAt) blocks[blocks.length - 1] = { ...last, text: last.text + data.text };
    else blocks.push({ type: 'reasoning', text: data.text, startedAt: Date.now() });
    return blocks;
  }
  closeReasoning(blocks);
  if (event === 'delta') {
    const tail = blocks[blocks.length - 1];
    if (tail?.type === 'text') blocks[blocks.length - 1] = { ...tail, text: tail.text + data.text };
    else blocks.push({ type: 'text', text: data.text });
    return blocks;
  }
  const block = data.block as Extract<AgentBlock, { type: 'tool' }>;
  const idx = blocks.findIndex((b) => b.type === 'tool' && b.id === block.id);
  if (idx >= 0) blocks[idx] = block;
  else blocks.push(block);
  return blocks;
}
