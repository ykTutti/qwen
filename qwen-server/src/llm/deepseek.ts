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
  tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[];
}

export interface StreamChunk {
  delta: ChunkDelta;
  finishReason: string | null;
}

export interface CompletionRequest {
  messages: LlmMessage[];
  tools?: LlmTool[];
  toolChoice?: 'auto' | 'none';
  thinking: boolean;
  signal?: AbortSignal;
}

export class LlmError extends Error {}

/** Streams an OpenAI-compatible chat completion from DeepSeek, yielding one parsed delta per SSE chunk. */
export async function* streamCompletion(req: CompletionRequest): AsyncGenerator<StreamChunk> {
  if (!env.deepseekKey) throw new LlmError('未配置 DEEPSEEK_API_KEY');
  const res = await fetch(`${env.deepseekBase}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.deepseekKey}` },
    body: JSON.stringify({
      model: env.deepseekModel,
      stream: true,
      messages: req.messages,
      ...(req.tools?.length ? { tools: req.tools, tool_choice: req.toolChoice ?? 'auto' } : {}),
      thinking: { type: req.thinking ? 'enabled' : 'disabled' },
      ...(req.thinking ? { reasoning_effort: 'high' } : {}),
    }),
    signal: req.signal,
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
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      const choice = JSON.parse(data)?.choices?.[0];
      if (choice) yield { delta: choice.delta ?? {}, finishReason: choice.finish_reason ?? null };
    }
  }
}
