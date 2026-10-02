import { streamCompletion, type LlmMessage, type LlmToolCall, type ModelTarget } from '../llm/client.js';
import type { Skill } from '../skills.js';
import { isWorkLike, type AgentBlock, type Message, type Surface } from '../types.js';
import { readDesign } from './tools/design.js';
import { describeFile, snapshotOutputs } from './tools/files.js';
import { toolsFor } from './tools/index.js';
import { isSandboxed } from './tools/sandbox.js';
import type { AgentSession } from './tools/types.js';

const MAX_STEPS: Record<Surface, number> = { daily: 6, work: 30, design: 30 };
const FINAL_NUDGE = '已达到本轮工具调用上限，请立即基于已获得的信息给出最终回答，不要再调用任何工具。';
const HISTORY_LIMIT = 20;

type ToolBlock = Extract<AgentBlock, { type: 'tool' }>;
type ReasoningBlock = Extract<AgentBlock, { type: 'reasoning' }>;

export type AgentEmit = (event: 'reasoning' | 'delta' | 'tool_call' | 'tool_result' | 'files' | 'design', data: unknown) => void;

/** Raw model/tool messages produced by each agent turn, keyed by assistant message id, replayed as history. */
const traces = new Map<string, LlmMessage[]>();

export const forgetTrace = (messageId: string) => traces.delete(messageId);

function systemPrompt(surface: Surface, target: ModelTarget, skill?: Skill) {
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
    `你是千问网页版中的 AI 助手，当前由 ${target.displayName} 模型驱动。`,
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
    ...(surface === 'design' ? designPrompt() : []),
    ...(surface === 'work' ? workPrompt() : []),
    ...(isWorkLike(surface) ? agentToolsPrompt(surface) : []),
    ...(skill ? skillPrompt(skill) : []),
  ].join('\n');
}

function skillPrompt(skill: Skill) {
  return [
    '',
    `# 当前技能：${skill.title}（${skill.name}）`,
    '本对话启用了这个技能。请严格按照下面的技能说明完成任务；说明与上文的通用要求冲突时，以技能说明为准。',
    '<skill>',
    skill.body,
    '</skill>',
  ];
}

function workPrompt() {
  return ['', '# 工作模式', '你现在是千问工作助理，帮助用户处理文档、数据、调研和各类办公任务。'];
}

function designPrompt() {
  return [
    '',
    '# 设计模式',
    '你现在是千问设计助理，是用户的产品与设计搭档：帮用户发散思维、把想法落成可以直接打开体验的原型。',
    '',
    '## 发散构思',
    '- 用户想法还模糊、或者明确要求头脑风暴时，先发散：给出 3～5 个差异明显的方向，而不是同一思路的小变体。',
    '- 每个方向说清：核心概念（一句话）、目标用户与场景、关键体验或亮点、主要风险或取舍。可以用表格横向对比。',
    '- 适当用类比、反向思考、极端场景、跨行业借鉴等方法打开思路，标出你最推荐的方向和理由。',
    '- 最后给出收敛建议：下一步先验证什么、选哪个方向做原型。',
    '- 关键信息缺失（目标用户、平台、核心目标）时，用一条消息问清楚，最多 3 个问题；信息足够就直接开始。',
    '',
    '## 落地原型',
    '- 设计内容明确后，严格按照下文「设计」技能的流程落地：规划.md 与 design.json 骨架 → 公共组件 → 并行派发子 agent 实现页面并登记 → 验收 → 回复。',
    '- 所有输出都用简体中文，包括调用工具前后的过渡说明（如"先写规划""公共组件已完成，开始并行实现页面"），过渡说明一句话即可。',
    '- run_subagent 用来派发页面：子 agent 与你共享工作区，但看不到对话，prompt 必须自成一体。用户看不到子 agent 的报告，由你汇总后回复。',
    '- 原型尽量不引用外部资源；图片用 CSS 渐变、emoji 或内联 SVG 代替。design.json 会实时渲染成右侧的设计画布（每个页面一个节点，按导航关系连线），生成的文件也会以卡片形式附在回复末尾。',
  ];
}

/** File and terminal rules shared by the agent surfaces (work and design). */
function agentToolsPrompt(surface: Surface) {
  const sandboxed = isSandboxed();
  return [
    '',
    '# 本地文件与终端',
    sandboxed
      ? '你拥有一个本对话专属的工作区，在终端里它位于 /workspace（Linux 沙箱环境，其他对话看不到这里的文件）。'
      : '你拥有一个本对话专属的工作区目录，终端命令默认在这个目录里执行，不要访问目录以外的文件。',
    '- 文件工具：list_dir 查看目录，read_file 读取，write_file 新建或覆盖，edit_file 局部修改，delete_file 删除，search_files 按文件名或内容搜索。',
    `- 终端工具：run_command 执行 shell 命令，check_command 查看后台命令输出，kill_command 终止命令。${sandboxed ? '沙箱预装了 node、npm、python3、git、curl。' : ''}`,
    `- 文件工具的路径都相对工作区根目录，不能访问工作区以外的文件${sandboxed ? '；沙箱可能没有外网，安装依赖失败时如实告诉用户' : ''}。`,
    '- 先了解再动手：修改文件前先读取原文；不确定目录结构时先 list_dir 或 search_files。',
    '- 删除文件、覆盖已有文件、执行有破坏性或不可逆的命令前，确认这是用户明确要求的。',
    '- 完成后用简洁的中文说明做了什么、改了哪些文件、命令结果如何；不要把大段文件内容原样贴回给用户。',
    '- 本轮在工作区里新建或修改的文档（.md、.html、.pptx、.docx、.xlsx、.pdf、.csv 等，无论用文件工具还是脚本生成）会自动以文件卡片的形式附在你的回复末尾，用户可以点开预览或下载。回复里只需一两句话说明，不要再写文件链接（如 [x.pptx](x.pptx)）、文件内容或路径清单。',
    ...(surface === 'work' ? ['- save_skill 会把技能保存到用户的技能库，只在用户要求创建或更新技能时使用。'] : []),
  ];
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
  surface: Surface;
  target: ModelTarget;
  /** Per-conversation sandbox for the local file and shell tools; only present in work mode. */
  session?: AgentSession;
  /** Skill the user enabled in this conversation; its instructions go into the system prompt. */
  skill?: Skill;
  thinking: boolean;
  signal: AbortSignal;
  emit: AgentEmit;
}) {
  const { assistant, history, surface, target, session, skill, thinking, signal, emit } = opts;
  const tag = `[agent ${assistant.id.slice(-8)}]`;
  const began = Date.now();
  const lastUser = [...history].reverse().find((m) => m.role === 'user');
  console.log(`${tag} start model=${target.model} surface=${surface} thinking=${thinking}${skill ? ` skill=${skill.name}` : ''} query=${JSON.stringify(lastUser?.content.slice(0, 80) ?? '')}`);
  const blocks = (assistant.blocks ??= []);
  const trace: LlmMessage[] = [];
  const base: LlmMessage[] = [{ role: 'system', content: systemPrompt(surface, target, skill) }, ...history];
  const tools = toolsFor(surface);
  const maxSteps = MAX_STEPS[surface];
  // Diffing the work dir catches deliverables however they were made: file tools, or scripts run in the terminal.
  const before = session ? await snapshotOutputs(session).catch(() => undefined) : undefined;

  // Pushes design.json to the canvas whenever it changes; checks are chained so emits stay in order.
  let designStamp = surface === 'design' && session ? (await readDesign(session).catch(() => undefined))?.stamp : undefined;
  let designCheck = Promise.resolve();
  const syncDesign = () => {
    if (surface !== 'design' || !session) return;
    designCheck = designCheck.then(async () => {
      const current = await readDesign(session).catch(() => undefined);
      if (!current || current.stamp === designStamp) return;
      designStamp = current.stamp;
      emit('design', { design: current.design });
    });
  };

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
      const tool = tools.map.get(block.name);
      if (!tool) throw new Error(`未知工具：${block.name}`);
      let args: Record<string, unknown>;
      try {
        args = block.args.trim() ? JSON.parse(block.args) : {};
      } catch {
        throw new Error('工具参数不是合法的 JSON');
      }
      const progress = (update: { summary?: string; output?: string }) => {
        if (block.status !== 'running') return;
        if (update.summary !== undefined) block.summary = update.summary;
        if (update.output !== undefined) block.output = update.output;
        emit('tool_call', { block });
      };
      const out = await tool.execute(args, { signal, session, progress, changed: syncDesign, model: target });
      block.status = 'done';
      block.results = out.sources;
      block.summary = out.summary;
      block.output = out.output;
      return out.content;
    } catch (err) {
      block.status = 'error';
      block.error = signal.aborted ? '已取消' : err instanceof Error ? err.message : String(err);
      return JSON.stringify({ error: block.error });
    } finally {
      block.endedAt = Date.now();
      emit('tool_result', { block });
      syncDesign();
      console.log(`${tag} tool ${block.name} ${block.status} results=${block.results?.length ?? 0} ${block.endedAt - block.startedAt!}ms${block.error ? ` error=${block.error}` : ''}`);
    }
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      const calls: PendingCall[] = [];
      const start = (i: number) => {
        const call = calls[i];
        if (call && !call.result) call.result = execute(call.block);
      };
      let content = '';
      let reasoning = '';
      let finishReason: string | null = null;

      const final = step === maxSteps - 1;
      const stream = streamCompletion({
        target,
        messages: final ? [...base, ...trace, { role: 'system', content: FINAL_NUDGE }] : [...base, ...trace],
        tools: final ? undefined : tools.definitions,
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
    syncDesign();
    await designCheck;
    traces.set(assistant.id, completeTrace(trace));
    const after = session && before ? await snapshotOutputs(session).catch(() => undefined) : undefined;
    const changed = after ? [...after].filter(([p, stamp]) => before!.get(p) !== stamp).map(([p]) => p) : [];
    if (session && changed.length) {
      const files = (await Promise.all(changed.map((p) => describeFile(session, p).catch(() => undefined))))
        .filter((f) => !!f)
        .sort((a, b) => a.updatedAt - b.updatedAt);
      if (files.length) {
        assistant.files = files;
        emit('files', { files });
      }
    }
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
