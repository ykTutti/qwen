import type { AgentBlock, AgentSkill, AppConfig, ChatMode, CloudSpaceItem, Conversation, DesignComment, DesignDoc, ElementRef, Message, OutputFile, SearchHit, SearchSource, Surface, User } from '../types';

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

/** Raw bytes of a file in the conversation's work dir; fetched with auth headers, since a plain link can't send them. */
export async function fetchOutputFile(conversationId: string, path: string): Promise<Blob> {
  const res = await fetch(
    `${BASE}/conversations/${encodeURIComponent(conversationId)}/files/download?path=${encodeURIComponent(path)}`,
    { headers: headers() },
  ).catch(() => {
    throw new ApiError(0, '网络异常，请检查服务是否已启动');
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new ApiError(res.status, data?.message ?? `下载失败（${res.status}）`);
  }
  return res.blob();
}

export async function downloadOutputFile(conversationId: string, path: string, name: string) {
  const url = URL.createObjectURL(await fetchOutputFile(conversationId, path));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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
  skills: () => request<AgentSkill[]>('/skills'),
  outputFile: (conversationId: string, path: string) =>
    request<{ file: OutputFile; content: string }>(
      `/conversations/${encodeURIComponent(conversationId)}/files?path=${encodeURIComponent(path)}`,
    ),
  /** URL serving a work-dir file so relative links (shared CSS/JS, other pages) resolve inside the preview iframe. */
  previewUrl: (conversationId: string, path: string) => previewApi(conversationScope(conversationId)).url(path),
  design: (conversationId: string) => previewApi(conversationScope(conversationId)).design(),
  /** Issues (or returns the existing) token for the public preview link. */
  share: (conversationId: string) =>
    request<{ token: string }>(`/conversations/${encodeURIComponent(conversationId)}/share`, { method: 'POST' }),
  /** Writes visual-editor edits into the page's CSS file; an empty value removes the override. */
  saveDesignStyle: (conversationId: string, body: { page: string; selector: string; styles: Record<string, string> }) =>
    request<{ file: string }>(`/conversations/${encodeURIComponent(conversationId)}/design/style`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  comments: (conversationId: string) => previewApi(conversationScope(conversationId)).comments(),
  answerQuestion: (conversationId: string, callId: string, optionId: string) =>
    request<{ id: string; label: string }>(
      `/conversations/${encodeURIComponent(conversationId)}/questions/${encodeURIComponent(callId)}`,
      { method: 'POST', body: JSON.stringify({ optionId }) },
    ),
};

const previewKeys = new Map<string, Promise<string>>();

/** API path of a design reached by its owner. */
export const conversationScope = (conversationId: string) => `/conversations/${encodeURIComponent(conversationId)}`;
/** API path of a design reached through a share link, which works for any visitor. */
export const shareScope = (token: string) => `/shares/${encodeURIComponent(token)}`;

/** Prototype preview calls, the same for the owner's conversation and a share link. */
export function previewApi(scope: string) {
  return {
    design: () => request<DesignDoc>(`${scope}/design`),
    url: async (path: string) => {
      let key = previewKeys.get(scope);
      if (!key) {
        key = request<{ key: string }>(`${scope}/preview`).then((d) => d.key);
        previewKeys.set(scope, key);
        key.catch(() => previewKeys.delete(scope));
      }
      return `${BASE}/preview/${await key}/${path.split('/').map(encodeURIComponent).join('/')}`;
    },
    comments: () => request<DesignComment[]>(`${scope}/comments`),
    addComment: (body: { pageId: string; selector: string; elementName: string; content: string }) =>
      request<DesignComment>(`${scope}/comments`, { method: 'POST', body: JSON.stringify(body) }),
    resolveComment: (commentId: string, resolved: boolean) =>
      request<DesignComment>(`${scope}/comments/${encodeURIComponent(commentId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ resolved }),
      }),
  };
}

export interface ChatRequest {
  conversationId: string;
  surface: Surface;
  temporary?: boolean;
  prompt?: string;
  mode: ChatMode;
  model: string;
  skill?: string;
  attachments?: string[];
  elements?: ElementRef[];
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
  /** Files the agent produced this turn, sent once just before `done`. */
  /** `files` get cards under the reply; `changed` is every output file the turn touched (a superset in design mode). */
  onFiles?: (files: OutputFile[], changed: OutputFile[]) => void;
  onDesign?: (design: DesignDoc) => void;
  onDone: () => void;
  onError: (err: Error) => void;
}

/** How many new characters this tool event added, so a burst is paced by text length rather than event count. */
function toolChars(event: string, data: { block?: { id?: string; args?: string; output?: string } }, seen: Map<string, number>) {
  if (event !== 'tool_call') return 1;
  const id = data.block?.id ?? '';
  const next = (data.block?.args?.length ?? 0) + (data.block?.output?.length ?? 0);
  const prev = seen.get(id) ?? 0;
  seen.set(id, next);
  return Math.max(1, next - prev);
}

/** Lets the browser paint before the next slice. The timeout covers a background tab, where animation frames don't run. */
function nextPaint() {
  return new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    requestAnimationFrame(done);
    setTimeout(done, 50);
  });
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
    const argChars = new Map<string, number>();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let sep: number;
      let shown = 0;
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
          shown += data.text?.length ?? 1;
          if (blocks) {
            blocks = applyAgentEvent(blocks, event, data);
            handlers.onBlocks?.(blocks, content);
          } else handlers.onChunk(content);
        } else if (event === 'reasoning' || event === 'tool_call' || event === 'tool_result') {
          blocks = applyAgentEvent(blocks ?? (content ? [{ type: 'text', text: content }] : []), event, data);
          handlers.onBlocks?.(blocks, content);
          shown += event === 'reasoning' ? (data.text?.length ?? 1) : toolChars(event, data, argChars);
        } else if (event === 'files') {
          handlers.onFiles?.(data.files, data.changed ?? data.files);
        } else if (event === 'design') {
          handlers.onDesign?.(data.design);
        } else if (event === 'error') {
          finished = true;
          throw new ApiError(0, data.message ?? '回答失败，请重试');
        } else if (event === 'done') {
          finished = true;
          handlers.onDone();
        }
        // A lagged link delivers many events in one read. Painting them all here
        // flashes the whole answer; spread that burst across frames instead.
        if (shown >= 24 && buffer.includes('\n\n')) {
          shown = 0;
          await nextPaint();
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
