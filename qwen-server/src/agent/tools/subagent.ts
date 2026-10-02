import { streamCompletion, type LlmMessage, type LlmToolCall } from '../../llm/client.js';
import { updateDesignTool } from './design.js';
import { fileTools } from './files.js';
import { isSandboxed } from './sandbox.js';
import { terminalTools } from './terminal.js';
import type { AgentTool, ToolContext } from './types.js';
import { webSearchTool } from './webSearch.js';

const MAX_STEPS = 20;
const MAX_REPORT = 8000;
const MAX_PARALLEL = 6;
/** Running sub-agents per conversation sandbox. */
const inFlight = new Map<string, number>();
const FINAL_NUDGE = '已达到工具调用上限，请立即基于已完成的工作给出最终报告，不要再调用任何工具。';

/** Sub-agents get the regular work tools but never run_subagent itself, so delegation stays one level deep. */
const subTools: AgentTool<any>[] = [webSearchTool, ...fileTools, ...terminalTools, updateDesignTool];
const toolMap = new Map(subTools.map((t) => [t.definition.function.name, t]));
const definitions = subTools.map((t) => t.definition);

function subSystemPrompt() {
  const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  return [
    '你是千问设计助理派出的子 agent，负责独立完成主 agent 交给你的一个子任务。',
    `当前时间：${now}（北京时间）。`,
    '',
    '# 工作方式',
    '- 你看不到用户与主 agent 的对话，任务说明就是你的全部上下文；不能向用户提问，信息不足时做出合理假设并在报告里写明。',
    '- 可以用 web_search 联网搜索；用文件工具（list_dir、read_file、write_file、edit_file、delete_file、search_files）和终端工具（run_command、check_command、kill_command）操作工作区。',
    isSandboxed()
      ? '- 工作区与主 agent 共享，在终端里位于 /workspace；文件工具的路径相对工作区根目录。'
      : '- 工作区与主 agent 共享，终端命令默认在工作区目录执行；文件工具的路径相对工作区根目录，不要访问工作区以外的文件。',
    '- 只做任务要求的事，不要修改或删除任务没有提到的已有文件；任务指定了文件名就严格使用该文件名。',
    '- 实现页面时严格遵循任务说明里的文件结构和公共组件用法（HTML、CSS、JS 分文件，按说明引用公共组件），不要修改公共组件和其他页面的文件。',
    '- 页面要视觉干净现代、核心交互真的能点、使用合理的中文假数据；不引用外部资源，图片用 CSS 渐变、emoji 或内联 SVG 代替。',
    '- 写完后用 `node --check` 检查自己的 JS 文件语法。',
    '- 任务要求登记到 design.json 时，页面完成后调用 update_design（page_id、html 路径、实际实现的跳转 links）；不要直接用文件工具改 design.json。',
    '',
    '# 最终报告',
    '完成后直接输出给主 agent 的报告（不是给用户看的），用简体中文 Markdown，简明扼要：',
    '- 结论或产出的核心内容（发散类任务给出完整的方案要点，调研类任务给出关键发现与来源）；',
    '- 新建或修改的文件路径；',
    '- 做出的假设、未完成的部分或风险。',
  ].join('\n');
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

const VERBS: Record<string, string> = {
  web_search: '搜索',
  list_dir: '查看目录',
  read_file: '读取',
  write_file: '写入',
  edit_file: '修改',
  delete_file: '删除',
  search_files: '搜索文件',
  run_command: '执行',
  check_command: '查看命令输出',
  kill_command: '终止命令',
  update_design: '登记页面',
};

function describeCall(name: string, args: string) {
  const verb = VERBS[name] ?? name;
  try {
    const a = JSON.parse(args) as Record<string, unknown>;
    const v = ['query', 'path', 'command', 'glob', 'page_id'].map((k) => a[k]).find((x) => typeof x === 'string' && x);
    return v ? `${verb} ${clip(String(v).split('\n')[0], 48)}` : verb;
  } catch {
    return verb;
  }
}

async function runSubagent(task: { description: string; prompt: string }, ctx: ToolContext) {
  const { signal, session, progress, model } = ctx;
  if (!model) throw new Error('子 agent 缺少模型配置');
  const tag = `[subagent ${task.description}]`;
  const began = Date.now();
  const log: string[] = [];
  const report = (summary: string) => progress?.({ summary, output: log.join('\n') });
  const messages: LlmMessage[] = [
    { role: 'system', content: subSystemPrompt() },
    { role: 'user', content: task.prompt },
  ];
  let toolCount = 0;
  let final = '';
  console.log(`${tag} start ${JSON.stringify(clip(task.prompt, 80))}`);
  report('启动中');

  for (let step = 0; step < MAX_STEPS; step++) {
    const last = step === MAX_STEPS - 1;
    const calls: LlmToolCall[] = [];
    let content = '';
    let finishReason: string | null = null;
    for await (const { delta, finishReason: reason } of streamCompletion({
      target: model,
      messages: last ? [...messages, { role: 'system', content: FINAL_NUDGE }] : messages,
      tools: last ? undefined : definitions,
      thinking: false,
      signal,
    })) {
      if (delta.content) content += delta.content;
      for (const tc of delta.tool_calls ?? []) {
        const call = (calls[tc.index] ??= { id: tc.id ?? `sub_${step}_${tc.index}`, type: 'function', function: { name: '', arguments: '' } });
        if (tc.id) call.id = tc.id;
        if (tc.function?.name) call.function.name += tc.function.name;
        if (tc.function?.arguments) call.function.arguments += tc.function.arguments;
      }
      if (reason) finishReason = reason;
    }
    messages.push({ role: 'assistant', content, ...(calls.length ? { tool_calls: calls } : {}) });
    if (!calls.length || finishReason === 'length') {
      final = content;
      break;
    }

    report(`正在${calls.map((c) => describeCall(c.function.name, c.function.arguments)).join('、')}`);
    const results = await Promise.all(calls.map(async (call) => {
      const line = log.push(`… ${describeCall(call.function.name, call.function.arguments)}`) - 1;
      try {
        const tool = toolMap.get(call.function.name);
        if (!tool) throw new Error(`未知工具：${call.function.name}`);
        const args = call.function.arguments.trim() ? JSON.parse(call.function.arguments) : {};
        const out = await tool.execute(args, { signal, session });
        log[line] = `✓ ${describeCall(call.function.name, call.function.arguments)}${out.summary ? ` — ${out.summary}` : ''}`;
        return out.content;
      } catch (err) {
        const message = signal.aborted ? '已取消' : err instanceof Error ? err.message : String(err);
        log[line] = `✗ ${describeCall(call.function.name, call.function.arguments)} — ${message}`;
        return JSON.stringify({ error: message });
      } finally {
        ctx.changed?.();
      }
    }));
    toolCount += calls.length;
    if (signal.aborted) throw new Error('已取消');
    results.forEach((content, i) => messages.push({ role: 'tool', tool_call_id: calls[i].id, content }));
  }

  const seconds = Math.round((Date.now() - began) / 1000);
  console.log(`${tag} end tools=${toolCount} ${seconds}s`);
  return { final: final.trim() || '子 agent 没有给出报告。', toolCount, seconds, log };
}

export const subagentTool: AgentTool<{ agent_id?: string; description?: string; prompt?: string }> = {
  definition: {
    type: 'function',
    function: {
      name: 'run_subagent',
      description:
        '派出一个子 agent 独立完成一个子任务（例如实现规划中的一个页面），完成后返回它的报告。子 agent 与你共享工作区，拥有联网搜索、文件和终端工具，但看不到当前对话，所以 prompt 必须自成一体。' +
        `同一次回复中发起多个调用会并行执行，最多同时 ${MAX_PARALLEL} 个。`,
      parameters: {
        type: 'object',
        properties: {
          agent_id: { type: 'string', description: '规划.md 中分配给该任务的子 agent ID，例如 "agent-1"' },
          description: { type: 'string', description: '子任务的简短标题，展示给用户，例如 "home：首页"' },
          prompt: {
            type: 'string',
            description: '完整的任务说明：背景与目标、具体要求、约束、需要产出的文件名（并行任务务必使用不同的文件名）、报告里要包含什么。',
          },
        },
        required: ['description', 'prompt'],
      },
    },
  },
  async execute(args, ctx) {
    const prompt = args.prompt?.trim();
    if (!prompt) throw new Error('缺少任务说明 prompt');
    const agentId = args.agent_id?.trim();
    const description = [agentId, args.description?.trim()].filter(Boolean).join(' ') || '子任务';
    const key = ctx.session?.id ?? '';
    const running = inFlight.get(key) ?? 0;
    if (running >= MAX_PARALLEL) throw new Error(`同时运行的子 agent 已达上限（${MAX_PARALLEL} 个），请等前面的完成后再派`);
    inFlight.set(key, running + 1);
    let result: Awaited<ReturnType<typeof runSubagent>>;
    try {
      result = await runSubagent({ description, prompt }, ctx);
    } finally {
      const left = (inFlight.get(key) ?? 1) - 1;
      if (left > 0) inFlight.set(key, left);
      else inFlight.delete(key);
    }
    const { final, toolCount, seconds, log } = result;
    return {
      content: clip(final, MAX_REPORT),
      summary: `已完成 · ${toolCount} 次工具调用 · ${seconds}s`,
      output: [...log, ...(log.length ? [''] : []), final].join('\n'),
    };
  },
};
