import { streamCompletion, type LlmMessage, type LlmToolCall } from '../llm/deepseek.js';
import type { AgentBlock, Message } from '../types.js';
import { toolDefinitions, toolMap } from './tools/index.js';

const MAX_STEPS = 6;
const FINAL_NUDGE = '已达到本轮工具调用上限，请立即基于已获得的信息给出最终回答，不要再调用任何工具。';
const HISTORY_LIMIT = 20;

type ToolBlock = Extract<AgentBlock, { type: 'tool' }>;
type ReasoningBlock = Extract<AgentBlock, { type: 'reasoning' }>;

export type AgentEmit = (event: 'reasoning' | 'delta' | 'tool_call' | 'tool_result', data: unknown) => void;

/** Raw model/tool messages produced by each agent turn, keyed by assistant message id, replayed as history. */
const traces = new Map<string, LlmMessage[]>();

export const forgetTrace = (messageId: string) => traces.delete(messageId);

function systemPrompt() {
  const now = new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
  return [
    '你是千问网页版中的 AI 助手，当前由 DeepSeek 模型驱动。',
    `当前时间：${now}（北京时间）。`,
    '',
    '# 工具使用',
    '- 你可以调用 web_search 联网搜索。以下情况必须先搜索再回答：',
    '  - 涉及时效性的问题：新闻、天气、股价/金价/汇率、赛事、政策法规、产品发布、人物近况等；',
    '  - 问到具体的公司、机构、人物、产品、品牌、作品、地点或事件（例如"你知道百度吗""介绍一下特斯拉"），即使你已经了解，也要搜索补充其最新情况；',
    '  - 你不确定或需要核实的事实。',
    '- 只有纯创作（写诗、写文案）、编程、翻译、数学推理、闲聊寒暄这类不依赖外部事实的问题，才直接回答、不要搜索。',
    '- 回答具体对象时，把已有知识和搜索到的最新信息结合起来，并点明近期的新变化。',
    '- 复杂问题拆成多个子问题分别搜索；互不依赖的搜索在同一次回复中同时发起。',
    '- 大多数问题 1～2 轮搜索就足够：拿到能回答问题的信息后立即作答，不要为了细节反复搜索；确实缺少关键信息时再换关键词补充搜索，不要重复相同的查询。',
    '',
    '# 回答要求',
    '- 基于搜索结果回答时，综合多个来源，留意信息的发布时间，优先采用最新、权威的来源；结果互相矛盾时说明差异。',
    '- 不要编造数据、链接或来源；搜索不到时如实说明。',
    '- 使用简体中文和 Markdown，结构清晰、重点突出，不要复述搜索过程。',
  ].join('\n');
}

export function buildHistory(list: Message[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of list.slice(-HISTORY_LIMIT)) {
    if (m.role === 'user') out.push({ role: 'user', content: m.content });
    else if (traces.has(m.id)) out.push(...traces.get(m.id)!);
    else if (m.content) out.push({ role: 'assistant', content: m.content });
  }
  while (out[0] && out[0].role !== 'user') out.shift();
  return out;
}

const isCompleteJson = (s: string) => {
  const t = s.trim();
  if (!t.endsWith('}')) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
};

interface PendingCall {
  block: ToolBlock;
  result?: Promise<string>;
}

export async function runAgent(opts: {
  assistant: Message;
  history: LlmMessage[];
  thinking: boolean;
  signal: AbortSignal;
  emit: AgentEmit;
}) {
  const { assistant, history, thinking, signal, emit } = opts;
  const tag = `[agent ${assistant.id.slice(-8)}]`;
  const began = Date.now();
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  console.log(`${tag} start thinking=${thinking} query=${JSON.stringify(lastUser?.content.slice(0, 80) ?? '')}`);
  const blocks = (assistant.blocks ??= []);
  const trace: LlmMessage[] = [];
  const base: LlmMessage[] = [{ role: 'system', content: systemPrompt() }, ...history];

  const closeReasoning = () => {
    const last = blocks.at(-1);
    if (last?.type === 'reasoning' && !last.endedAt) last.endedAt = Date.now();
  };

  const appendReasoning = (text: string) => {
    const last = blocks.at(-1);
    if (last?.type === 'reasoning' && !last.endedAt) last.text += text;
    else blocks.push({ type: 'reasoning', text, startedAt: Date.now() } satisfies ReasoningBlock);
    emit('reasoning', { text });
  };

  const appendText = (text: string) => {
    closeReasoning();
    const last = blocks.at(-1);
    if (last?.type === 'text') last.text += text;
    else blocks.push({ type: 'text', text });
    assistant.content += text;
    emit('delta', { text });
  };

  const execute = async (block: ToolBlock): Promise<string> => {
    block.status = 'running';
    block.startedAt = Date.now();
    emit('tool_call', { block });
    console.log(`${tag} tool ${block.name} ${block.args}`);
    try {
      const tool = toolMap.get(block.name);
      if (!tool) throw new Error(`未知工具：${block.name}`);
      let args: Record<string, unknown>;
      try {
        args = block.args.trim() ? JSON.parse(block.args) : {};
      } catch {
        throw new Error('工具参数不是合法的 JSON');
      }
      const out = await tool.execute(args, { signal });
      block.status = 'done';
      block.results = out.sources;
      return out.content;
    } catch (err) {
      block.status = 'error';
      block.error = signal.aborted ? '已取消' : err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: block.error });
    } finally {
      block.endedAt = Date.now();
      emit('tool_result', { block });
      console.log(`${tag} tool ${block.name} ${block.status} results=${block.results?.length ?? 0} ${block.endedAt - block.startedAt!}ms${block.error ? ` error=${block.error}` : ''}`);
    }
  };

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const calls: PendingCall[] = [];
      const start = (i: number) => {
        const call = calls[i];
        if (call && !call.result) call.result = execute(call.block);
      };
      let content = '';
      let reasoning = '';
      let finishReason: string | null = null;

      const final = step === MAX_STEPS - 1;
      const stream = streamCompletion({
        messages: final ? [...base, ...trace, { role: 'system', content: FINAL_NUDGE }] : [...base, ...trace],
        tools: final ? undefined : toolDefinitions,
        thinking,
        signal,
      });

      for await (const { delta, finishReason: reason } of stream) {
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          appendReasoning(delta.reasoning_content);
        }
        if (delta.content) {
          content += delta.content;
          appendText(delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          closeReasoning();
          // Tool calls stream strictly in index order, so a new index means every earlier call is complete.
          for (let i = 0; i < tc.index; i++) start(i);
          let call = calls[tc.index];
          if (!call) {
            const block: ToolBlock = { type: 'tool', id: tc.id ?? `call_${step}_${tc.index}`, name: '', args: '', status: 'pending' };
            blocks.push(block);
            call = calls[tc.index] = { block };
          }
          const { block } = call;
          if (tc.id) block.id = tc.id;
          if (tc.function?.name) block.name += tc.function.name;
          if (tc.function?.arguments) block.args += tc.function.arguments;
          if (!call.result) {
            emit('tool_call', { block });
            if (block.name && isCompleteJson(block.args)) start(tc.index);
          }
        }
        if (reason) finishReason = reason;
      }
      closeReasoning();
      calls.forEach((_, i) => start(i));

      const toolCalls: LlmToolCall[] = calls.map(({ block }) => ({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: block.args },
      }));
      trace.push({
        role: 'assistant',
        content,
        ...(thinking ? { reasoning_content: reasoning } : {}),
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      });

      console.log(`${tag} step ${step + 1} finish=${finishReason} toolCalls=${toolCalls.length} text=${content.length}`);
      if (!toolCalls.length || finishReason === 'length') break;

      const results = await Promise.all(calls.map((c) => c.result!));
      if (signal.aborted) break;
      results.forEach((result, i) => trace.push({ role: 'tool', tool_call_id: calls[i].block.id, content: result }));
    }
  } finally {
    traces.set(assistant.id, completeTrace(trace));
    console.log(`${tag} end ${signal.aborted ? 'aborted' : 'ok'} ${Date.now() - began}ms`);
  }
}

/** Drops a trailing assistant tool-call message whose results never arrived, which the API would reject as history. */
function completeTrace(trace: LlmMessage[]) {
  const last = trace.at(-1);
  if (last?.role === 'assistant' && last.tool_calls?.length) {
    return last.content ? [...trace.slice(0, -1), { ...last, tool_calls: undefined }] : trace.slice(0, -1);
  }
  return trace;
}
