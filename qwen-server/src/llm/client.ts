import { env } from '../env.js';

export interface LlmToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type LlmMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string; reasoning_content?: string; tool_calls?: LlmToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface LlmTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChunkDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: { index: number; id?: string | null; function?: { name?: string; arguments?: string } }[];
}

export interface StreamChunk {
  delta: ChunkDelta;
  finishReason: string | null;
}

/** A concrete model behind one of the model picker's entries. */
export interface ModelTarget {
  provider: 'deepseek' | 'qwen';
  /** Model id sent to the provider's API. */
  model: string;
  /** How the assistant introduces the model it runs on. */
  displayName: string;
}

/** Picker keys that don't name a DashScope model id directly. */
const QWEN_ALIASES: Record<string, string> = { 'qwen3.7': 'qwen3.7-plus' };

/**
 * Maps a model picker key to a real model. Qwen keys resolve only when QWEN_API_KEY is set; otherwise
 * (and for unknown keys) this returns undefined and the chat falls back to the demo replies.
 */
export function resolveModel(key: string): ModelTarget | undefined {
  if (key === 'deepseek') return { provider: 'deepseek', model: env.deepseekModel, displayName: 'DeepSeek' };
  if (/^qwen[\w.-]*$/.test(key) && env.qwenKey) {
    const model = QWEN_ALIASES[key] ?? key;
    return { provider: 'qwen', model, displayName: `通义千问 ${model}` };
  }
  return undefined;
}

export interface CompletionRequest {
  target: ModelTarget;
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: 'auto' | 'none';
  thinking: boolean;
  signal?: AbortSignal;
}

export class LlmError extends Error {}

/**
 * When a provider is overloaded it can hold the stream open with keep-alive comments and never send a token,
 * so give up after this long without any data line (keep-alives don't count) instead of hanging forever.
 */
const IDLE_TIMEOUT_MS = 60_000;

function endpoint(target: ModelTarget) {
  return target.provider === 'qwen'
    ? { base: env.qwenBase, key: env.qwenKey, keyName: 'QWEN_API_KEY' }
    : { base: env.deepseekBase, key: env.deepseekKey, keyName: 'DEEPSEEK_API_KEY' };
}

/** The two APIs are OpenAI-compatible but switch thinking on differently. */
function providerParams(req: CompletionRequest) {
  if (req.target.provider === 'qwen') {
    return {
      enable_thinking: req.thinking,
      // DashScope only returns several tool calls in one turn when asked to, which parallel sub-agents rely on.
      ...(req.tools?.length ? { parallel_tool_calls: true } : {}),
    };
  }
  return { thinking: { type: req.thinking ? 'enabled' : 'disabled' }, ...(req.thinking ? { reasoning_effort: 'high' } : {}) };
}

/** Streams an OpenAI-compatible chat completion, yielding one parsed delta per SSE chunk. */
export async function* streamCompletion(req: CompletionRequest): AsyncGenerator<StreamChunk> {
  const { key, keyName } = endpoint(req.target);
  if (!key) throw new LlmError(`未配置 ${keyName}`);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (req.signal?.aborted) ctrl.abort();
  req.signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, IDLE_TIMEOUT_MS);
  };
  arm();
  try {
    yield* readStream(req, ctrl.signal, arm);
  } catch (err) {
    if (timedOut && !req.signal?.aborted) {
      throw new LlmError(`模型服务繁忙，${IDLE_TIMEOUT_MS / 1000} 秒内没有响应，请稍后重试`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    req.signal?.removeEventListener('abort', onAbort);
  }
}

async function* readStream(req: CompletionRequest, signal: AbortSignal, onData: () => void): AsyncGenerator<StreamChunk> {
  const { base, key } = endpoint(req.target);
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: req.target.model,
      stream: true,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: req.toolChoice ?? 'auto' } : {}),
      ...providerParams(req),
    }),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let message = `模型服务异常（${res.status}）`;
    try {
      message = JSON.parse(text)?.error?.message ?? message;
    } catch {}
    throw new LlmError(message);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      onData();
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      const choice = JSON.parse(data)?.choices?.[0];
      if (choice) yield { delta: choice.delta ?? {}, finishReason: choice.finish_reason ?? null };
    }
  }
}
