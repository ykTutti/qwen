import type { AgentTool } from './types.js';

export interface AskOption {
  id: string;
  label: string;
}

interface Waiter {
  conversationId: string;
  options: AskOption[];
  resolve: (option: AskOption) => void;
  reject: (err: Error) => void;
}

const waiters = new Map<string, Waiter>();
const keyOf = (conversationId: string, callId: string) => `${conversationId}:${callId}`;

/** Options the model may pass either as plain labels or as `{ id, label }` objects. */
export function normalizeOptions(raw: unknown): AskOption[] {
  if (!Array.isArray(raw)) return [];
  const out: AskOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= 6) break;
    let id = '';
    let label = '';
    if (typeof item === 'string') {
      label = item.trim();
      id = label;
    } else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      label = typeof record.label === 'string' ? record.label.trim() : '';
      id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : label;
    }
    if (!label || !id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: label.slice(0, 80) });
  }
  return out;
}

function waitForAnswer(conversationId: string, callId: string, options: AskOption[], signal: AbortSignal) {
  return new Promise<AskOption>((resolve, reject) => {
    const key = keyOf(conversationId, callId);
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      waiters.delete(key);
      fn();
    };
    const onAbort = () => finish(() => reject(new Error('已取消')));
    if (signal.aborted) {
      reject(new Error('已取消'));
      return;
    }
    waiters.set(key, {
      conversationId,
      options,
      resolve: (option) => finish(() => resolve(option)),
      reject: (err) => finish(() => reject(err)),
    });
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolves the question the agent is waiting on. Throws when the question is gone or the option is not one of the ones offered. */
export function submitAnswer(conversationId: string, callId: string, optionId: string): AskOption {
  const waiter = waiters.get(keyOf(conversationId, callId));
  if (!waiter) throw new Error('这个问题已经回答过了，或已经结束');
  const option = waiter.options.find((o) => o.id === optionId);
  if (!option) throw new Error('没有这个选项');
  waiter.resolve(option);
  return option;
}

export const askUserQuestionTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'askUserQuestion',
      description:
        '需要用户在几个明确方案里做决定时调用。给出一个问题和 2～6 个互斥选项，界面会把选项展示给用户，' +
        '等用户点选后把结果返回给你，你再继续。一次只问一个问题。开放式问题、或你可以合理假设的细节，不要调用。' +
        '不要在回复正文里再列一遍选项。',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: '要用户决定的问题，一句话' },
          options: {
            type: 'array',
            description: '2～6 个互斥选项',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: '选项 id，本问题内唯一，用简短英文' },
                label: { type: 'string', description: '展示给用户的选项文字' },
              },
              required: ['id', 'label'],
            },
          },
        },
        required: ['question', 'options'],
      },
    },
  },
  async execute({ question, options }, ctx) {
    const q = typeof question === 'string' ? question.trim() : '';
    const opts = normalizeOptions(options);
    if (!q) throw new Error('缺少问题');
    if (opts.length < 2) throw new Error('至少给出 2 个选项');
    if (!ctx.conversationId || !ctx.callId) throw new Error('当前对话无法向用户提问');
    ctx.progress?.({ summary: '等待选择' });
    const picked = await waitForAnswer(ctx.conversationId, ctx.callId, opts, ctx.signal);
    return {
      summary: picked.label,
      output: picked.label,
      content: JSON.stringify({ question: q, selected: picked }),
    };
  },
};
