import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { DESIGN_FILE, elementTitle, type AgentBlock, type Message, type OutputFile, type ToastFn } from '../types';
import { copyToClipboard } from '../clipboard';
import { useConfig } from '../config';
import { useSkills } from '../skills';
import { FileIcon } from './FileIcon';
import { Icon } from './Icon';
import { HoverMenu } from './HoverMenu';

interface Props {
  messages: Message[];
  /** Path of the file currently shown in the side panel. */
  openFile?: string;
  onOpenFile: (file: OutputFile) => void;
  loading: boolean;
  onRegenerate: () => void;
  onEdit: (text: string) => void;
  onDelete: (messageId: string) => void;
  toast: ToastFn;
  loggedIn: boolean;
}

export function MessageList({ messages, openFile, onOpenFile, loading, onRegenerate, onEdit, onDelete, toast, loggedIn }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastTop = useRef(0);
  const [showDown, setShowDown] = useState(false);

  const toBottom = () => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  // Follow anything that grows the conversation (streamed text, tool cards, file cards, images) while stuck.
  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const ro = new ResizeObserver(() => stickRef.current && toBottom());
    ro.observe(inner);
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [loading]);

  // A new message (the user just sent one) always brings the view back to the latest.
  useEffect(() => {
    stickRef.current = true;
    toBottom();
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollRef.current!;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    // Content growth never moves scrollTop up, so an upward move is the user scrolling away from the bottom.
    if (el.scrollTop < lastTop.current - 2) stickRef.current = false;
    if (dist < 40) stickRef.current = true;
    lastTop.current = el.scrollTop;
    setShowDown(dist > 160);
  };

  return (
    <div className="messages-wrap">
      <div className="messages" ref={scrollRef} onScroll={onScroll}>
        <div className="messages-inner" ref={innerRef}>
          {loading ? (
            <div className="msg-loading">
              <div className="skeleton" style={{ width: '36%', marginLeft: 'auto', height: 44, borderRadius: 16 }} />
              <div className="skeleton" style={{ width: '100%' }} />
              <div className="skeleton" style={{ width: '82%' }} />
              <div className="skeleton" style={{ width: '64%' }} />
            </div>
          ) : (
            messages.map((m, i) => (
              <MessageItem key={m.id} msg={m} openFile={openFile} onOpenFile={onOpenFile} isLast={i === messages.length - 1} onRegenerate={onRegenerate} onEdit={onEdit} onDelete={onDelete} toast={toast} loggedIn={loggedIn} />
            ))
          )}
        </div>
      </div>
      {showDown && (
        <button
          className="float-bottom"
          onClick={() => {
            stickRef.current = true;
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
          }}
        >
          <Icon name="arrowDown" size={16} />
        </button>
      )}
    </div>
  );
}

const copyText = async (text: string, toast: ToastFn) => {
  try {
    await copyToClipboard(text);
    toast('复制成功', 'success');
  } catch {
    toast('复制失败', 'error');
  }
};

const stripMd = (md: string) =>
  md
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ''))
    .replace(/[*_`>#|]/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const MessageItem = memo(function MessageItem({
  msg, isLast, openFile, onOpenFile, onRegenerate, onEdit, onDelete, toast, loggedIn,
}: {
  msg: Message;
  openFile?: string;
  onOpenFile: (file: OutputFile) => void;
  isLast: boolean;
  onRegenerate: () => void;
  onEdit: (text: string) => void;
  onDelete: (messageId: string) => void;
  toast: ToastFn;
  loggedIn: boolean;
}) {
  const { skills } = useConfig();
  const { skills: agentSkills } = useSkills();

  if (msg.role === 'user') {
    const agentSkill = agentSkills.find((s) => s.name === msg.skill);
    const skill = agentSkill ? { icon: 'component', name: agentSkill.title } : skills.find((s) => s.key === msg.skill);
    return (
      <div className="msg-user">
        {((msg.attachments?.length ?? 0) > 0 || (msg.elements?.length ?? 0) > 0) && (
          <div className="attach-list is-right">
            {msg.elements?.map((el) => (
              <div key={`${el.pageId}|${el.selector}|${el.comment ?? ''}`} className="attach-chip is-element" title={elementTitle(el)}>
                <Icon name={el.comment ? 'comment' : 'target'} size={14} />
                <span><em>{el.pageName}</em>{el.name}{el.comment && <i>{el.comment}</i>}</span>
              </div>
            ))}
            {(msg.attachments ?? []).map((f) => (
              <div key={f} className="attach-chip"><Icon name="fileUpload" /><span>{f}</span></div>
            ))}
          </div>
        )}
        <div className="bubble">
          {skill && <span className="bubble-skill"><Icon name={skill.icon} size={14} />{skill.name}</span>}
          {msg.content}
        </div>
        <div className="msg-actions is-user">
          <button className="icon-btn sm" title="复制" onClick={() => copyText(msg.content, toast)}><Icon name="copy" /></button>
          <button className="icon-btn sm" title="编辑" onClick={() => onEdit(msg.content)}><Icon name="edit" /></button>
        </div>
      </div>
    );
  }

  const busy = msg.status === 'pending' || msg.status === 'analyzing' || msg.status === 'streaming';

  return (
    <div className="msg-assistant">
      {msg.blocks ? (
        <AgentBlocks msg={msg} toast={toast} />
      ) : (
        <>
          <AnalysisBar msg={msg} />
          {msg.content && <Markdown text={msg.content} streaming={msg.status === 'streaming'} toast={toast} />}
        </>
      )}

      {!busy && msg.files && msg.files.length > 0 && (
        <div className="file-cards">
          {msg.files.map((f) => <FileCard key={f.path} file={f} active={openFile === f.path} onOpen={onOpenFile} />)}
        </div>
      )}

      {msg.status === 'stopped' && <div className="stopped-tip">已停止生成</div>}

      {!busy && (
        <AnswerActions msg={msg} isLast={isLast} loggedIn={loggedIn} onRegenerate={onRegenerate} onDelete={onDelete} toast={toast} />
      )}
    </div>
  );
});

function AnswerActions({
  msg, isLast, loggedIn, onRegenerate, onDelete, toast,
}: {
  msg: Message;
  isLast: boolean;
  loggedIn: boolean;
  onRegenerate: () => void;
  onDelete: (messageId: string) => void;
  toast: ToastFn;
}) {
  const [feedback, setFeedback] = useState<'good' | 'bad' | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [favorited, setFavorited] = useState(false);
  const speakingRef = useRef(false);
  speakingRef.current = speaking;

  useEffect(() => () => {
    if (speakingRef.current) window.speechSynthesis?.cancel();
  }, []);

  const rate = (value: 'good' | 'bad') => {
    const next = feedback === value ? null : value;
    setFeedback(next);
    if (next) toast(next === 'good' ? '感谢您的支持' : '您的反馈已收到，千问会再接再厉', 'success');
  };

  const share = () =>
    copyToClipboard(`${location.origin}/share/${msg.id}`).then(
      () => toast('分享链接已复制', 'success'),
      () => toast('分享失败', 'error'),
    );

  const toggleSpeak = () => {
    const synth = window.speechSynthesis;
    if (!synth) return toast('当前浏览器不支持朗读');
    if (speaking) {
      synth.cancel();
      setSpeaking(false);
      return;
    }
    synth.cancel();
    const u = new SpeechSynthesisUtterance(stripMd(msg.content));
    u.lang = 'zh-CN';
    u.onend = u.onerror = () => setSpeaking(false);
    synth.speak(u);
    setSpeaking(true);
  };

  return (
    <div className={`answer-actions ${isLast ? 'is-visible' : ''}`}>
      <HoverMenu
        className="act-group"
        menuClassName="is-copy"
        offsetX={-41}
        trigger={
          <>
            <button className="act-btn" aria-label="复制" onClick={() => copyText(stripMd(msg.content), toast)}>
              <Icon name="answerCopy" />
            </button>
            <button className="act-chevron" aria-label="复制选项"><Icon name="answerChevron" /></button>
          </>
        }
      >
        <button role="menuitem" onClick={() => copyText(msg.content, toast)}>复制为Markdown</button>
        <button role="menuitem" onClick={() => copyText(stripMd(msg.content), toast)}>复制</button>
      </HoverMenu>
      <button className={`act-btn ${feedback === 'good' ? 'is-active' : ''}`} data-tip="喜欢" aria-label="喜欢" aria-pressed={feedback === 'good'} onClick={() => rate('good')}>
        <Icon name={feedback === 'good' ? 'answerLikeActive' : 'answerLike'} />
      </button>
      <button className={`act-btn ${feedback === 'bad' ? 'is-active' : ''}`} data-tip="不喜欢" aria-label="不喜欢" aria-pressed={feedback === 'bad'} onClick={() => rate('bad')}>
        <Icon name={feedback === 'bad' ? 'answerDislikeActive' : 'answerDislike'} />
      </button>
      <button className="act-btn" data-tip="分享" aria-label="分享" onClick={share}>
        <Icon name="answerShare" />
      </button>
      <button className={`act-btn ${speaking ? 'is-active' : ''}`} data-tip={speaking ? '停止朗读' : '朗读'} aria-label="朗读" onClick={toggleSpeak}>
        <Icon name="sound" />
      </button>
      {isLast && (
        <button className="act-btn" data-tip="重新生成" aria-label="重新生成" onClick={onRegenerate}>
          <Icon name="answerRegenerate" />
        </button>
      )}
      <HoverMenu
        className="act-more"
        menuClassName="is-more"
        offsetX={-12}
        gap={8}
        trigger={<button className="act-btn" aria-label="更多"><Icon name="answerMore" /></button>}
      >
        {loggedIn && (
          <button role="menuitem" onClick={() => { setFavorited(!favorited); toast(favorited ? '已取消收藏' : '已收藏', 'success'); }}>
            <Icon name="star" />{favorited ? '取消收藏' : '收藏'}
          </button>
        )}
        <button role="menuitem" onClick={() => onDelete(msg.id)}><Icon name="answerDelete" />删除</button>
        {loggedIn && (
          <button role="menuitem" onClick={() => toast('感谢你的反馈，我们会尽快处理', 'success')}><Icon name="answerReport" />举报</button>
        )}
      </HoverMenu>
    </div>
  );
}

export function Markdown({ text, streaming, toast }: { text: string; streaming?: boolean; toast: ToastFn }) {
  return (
    <div className={`markdown ${streaming ? 'is-streaming' : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: (p) => <CodeBlock toast={toast}>{p.children}</CodeBlock>,
          table: (p) => <TableBlock toast={toast}>{p.children}</TableBlock>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

type ToolBlockData = Extract<AgentBlock, { type: 'tool' }>;
type ReasoningBlockData = Extract<AgentBlock, { type: 'reasoning' }>;

function AgentBlocks({ msg, toast }: { msg: Message; toast: ToastFn }) {
  const blocks = msg.blocks ?? [];
  const live = msg.status === 'pending' || msg.status === 'analyzing' || msg.status === 'streaming';

  if (!blocks.length) {
    return live ? (
      <div className="analysis">
        <div className="analysis-head is-static"><Icon name="loading" className="spin" /><span>正在理解问题</span></div>
      </div>
    ) : null;
  }

  return (
    <div className="agent-blocks">
      {blocks.map((b, i) => {
        const isLast = i === blocks.length - 1;
        if (b.type === 'reasoning') return <ReasoningBlock key={i} block={b} active={live && isLast && !b.endedAt} />;
        if (b.type === 'tool') return <ToolBlock key={b.id} block={b} />;
        return b.text.trim() ? <Markdown key={i} text={b.text} streaming={live && isLast} toast={toast} /> : null;
      })}
      {live && blocks[blocks.length - 1].type === 'tool' && blocks.every((b) => b.type !== 'tool' || b.status === 'done' || b.status === 'error') && (
        <div className="agent-step-hint"><Icon name="loading" className="spin" size={14} />{blocks.some((b) => b.type === 'tool' && b.name !== 'web_search') ? '正在继续处理' : '正在整理搜索结果'}</div>
      )}
    </div>
  );
}

export const formatSize = (bytes: number) =>
  bytes < 1024 ? `${bytes}B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)}KB` : `${(bytes / 1024 / 1024).toFixed(1)}MB`;

function timeAgo(ts: number) {
  const sec = Math.max(0, (Date.now() - ts) / 1000);
  if (sec < 60) return '刚刚';
  if (sec < 3600) return `${Math.floor(sec / 60)}分钟前`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}小时前`;
  if (sec < 86400 * 30) return `${Math.floor(sec / 86400)}天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/** The icon already shows the file type, so the card drops the extension. */
const stripExt = (name: string) => name.replace(/\.[a-z0-9]{1,8}$/i, '') || name;

function FileCard({ file, active, onOpen }: { file: OutputFile; active: boolean; onOpen: (file: OutputFile) => void }) {
  return (
    <button className={`file-card ${active ? 'is-active' : ''}`} onClick={() => onOpen(file)} title={file.path}>
      <FileIcon name={file.name} />
      <span className="file-card-text">
        <span className="file-card-name">{file.path === DESIGN_FILE ? '设计画布' : stripExt(file.name)}</span>
        <span className="file-card-meta">创建于 {timeAgo(file.createdAt)} · {formatSize(file.size)}</span>
      </span>
    </button>
  );
}

function ReasoningBlock({ block, active }: { block: ReasoningBlockData; active: boolean }) {
  const [open, setOpen] = useState(true);
  const seconds = Math.max(1, Math.round(((block.endedAt ?? Date.now()) - block.startedAt) / 1000));
  return (
    <div className="agent-reasoning">
      <button className="agent-step-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        {active ? <Icon name="loading" className="spin" size={14} /> : <Icon name="deepResearch" size={14} />}
        <span>{active ? '深度思考中…' : `已深度思考（用时 ${seconds} 秒）`}</span>
        <Icon name="rightMini" size={12} className={`chevron-r ${open ? 'is-open' : ''}`} />
      </button>
      {open && <div className="agent-reasoning-text">{block.text.trim()}</div>}
    </div>
  );
}

/** Pulls a field out of possibly incomplete streamed JSON arguments. */
function argOf(args: string, key: string): string {
  try {
    const v = JSON.parse(args)[key];
    return Array.isArray(v) ? v.join('、') : String(v ?? '');
  } catch {
    const m = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(args);
    if (!m) return '';
    try {
      return JSON.parse(`"${m[1].replace(/\\$/, '')}"`);
    } catch {
      return m[1];
    }
  }
}

interface ToolMeta {
  label: string;
  icon: string;
  /** Argument keys tried in order for the chip next to the label. */
  args: string[];
  pending: string;
  running: string;
}

const TOOL_META: Record<string, ToolMeta> = {
  web_search: { label: '联网搜索', icon: 'search2', args: ['query'], pending: '生成搜索词', running: '搜索中' },
  list_dir: { label: '查看目录', icon: 'folder', args: ['path'], pending: '准备中', running: '读取中' },
  read_file: { label: '读取文件', icon: 'fileUpload', args: ['path'], pending: '准备中', running: '读取中' },
  write_file: { label: '写入文件', icon: 'edit', args: ['path'], pending: '生成内容', running: '写入中' },
  edit_file: { label: '修改文件', icon: 'edit', args: ['path'], pending: '生成修改', running: '修改中' },
  delete_file: { label: '删除文件', icon: 'answerDelete', args: ['paths'], pending: '准备中', running: '删除中' },
  search_files: { label: '搜索文件', icon: 'search2', args: ['query', 'glob', 'path'], pending: '准备中', running: '搜索中' },
  run_command: { label: '执行命令', icon: 'code', args: ['command'], pending: '生成命令', running: '执行中' },
  check_command: { label: '查看命令输出', icon: 'code', args: ['command_id'], pending: '准备中', running: '等待中' },
  kill_command: { label: '终止命令', icon: 'code', args: ['command_id'], pending: '准备中', running: '终止中' },
  save_skill: { label: '保存技能', icon: 'component', args: ['title', 'name'], pending: '撰写技能说明', running: '保存中' },
  update_design: { label: '登记页面', icon: 'edit', args: ['page_id'], pending: '准备中', running: '登记中' },
  run_subagent: { label: '子 agent', icon: 'connector', args: ['description', 'agent_id'], pending: '撰写任务说明', running: '执行中' },
};

function ToolBlock({ block }: { block: ToolBlockData }) {
  const [open, setOpen] = useState(false);
  const meta = TOOL_META[block.name];
  const chip = (meta?.args ?? []).map((k) => argOf(block.args, k)).find(Boolean) ?? '';
  const count = block.results?.length ?? 0;
  const busy = block.status === 'pending' || block.status === 'running';
  const status =
    block.status === 'pending' ? meta?.pending ?? '准备中'
    : block.status === 'running' ? block.summary ?? meta?.running ?? '执行中'
    : block.status === 'error' ? block.error ?? '执行失败'
    : block.summary ?? (block.name === 'web_search' ? `找到 ${count} 篇资料` : '已完成');
  const expandable = count > 0 || !!block.output;

  return (
    <div className={`agent-tool is-${block.status}`}>
      <button className={`agent-step-head ${expandable ? '' : 'is-static'}`} onClick={() => expandable && setOpen(!open)} aria-expanded={open}>
        {busy ? <Icon name="loading" className="spin" size={14} /> : <Icon name={meta?.icon ?? 'component'} size={14} />}
        <span className="agent-tool-name">{meta?.label ?? (block.name || '调用工具')}</span>
        {chip && <span className="agent-tool-query" title={chip}>{chip}</span>}
        <span className="agent-tool-status">{status}</span>
        {expandable && <Icon name="rightMini" size={12} className={`chevron-r ${open ? 'is-open' : ''}`} />}
      </button>
      {open && count > 0 && (
        <ol className="source-list agent-sources">
          {block.results!.map((s, i) => (
            <li key={s.url + i}>
              <a href={s.url} target="_blank" rel="noreferrer" title={s.snippet}>
                <b>{i + 1}</b><span className="source-title">{s.title}</span><span className="source-site">{s.site}</span>
              </a>
            </li>
          ))}
        </ol>
      )}
      {open && !count && block.output && <pre className="agent-tool-output">{block.output}</pre>}
    </div>
  );
}

function AnalysisBar({ msg }: { msg: Message }) {
  const [open, setOpen] = useState(false);
  const count = msg.sources?.length ?? 0;
  const analyzing = msg.status === 'pending' || msg.status === 'analyzing';

  let label: string;
  if (msg.status === 'pending') label = '正在理解问题';
  else if (msg.status === 'analyzing') label = msg.thinking ? '正在深度思考' : count ? `正在阅读 ${count} 篇资料` : `正在搜索 ${msg.keywords?.length ?? 0} 个关键词`;
  else if (count) label = `已完成分析，共参考 ${count} 篇资料`;
  else label = '已完成分析，相关操作已执行';

  const expandable = !!(msg.keywords?.length || msg.thinking);

  return (
    <div className="analysis">
      <button className={`analysis-head ${expandable ? '' : 'is-static'}`} onClick={() => expandable && setOpen(!open)}>
        {analyzing ? <Icon name="loading" className="spin" /> : count ? <Icon name="search2" /> : null}
        <span>{label}</span>
        {expandable && <Icon name="rightMini" size={12} className={`chevron-r ${open ? 'is-open' : ''}`} />}
      </button>
      {open && expandable && (
        <div className="analysis-body">
          {msg.keywords && (
            <div className="analysis-step">
              <div className="step-title"><Icon name="search2" />搜索 {msg.keywords.length} 个关键词，参考 {count} 篇资料</div>
              <div className="kw-list">
                {msg.keywords.map((k) => <span key={k} className="kw"><Icon name="search2" size={12} />{k}</span>)}
              </div>
              {msg.sources && (
                <ol className="source-list">
                  {msg.sources.map((s, i) => (
                    <li key={i}>
                      <a href={s.url} onClick={(e) => e.preventDefault()}>
                        <b>{i + 1}</b><span className="source-title">{s.title}</span><span className="source-site">{s.site}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          {msg.thinking && (
            <div className="analysis-step">
              <div className="step-title"><Icon name="deepResearch" />深度思考</div>
              <div className="thinking-text">{msg.thinking}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function CodeBlock({ children, toast }: { children?: ReactNode; toast: ToastFn }) {
  const ref = useRef<HTMLPreElement>(null);
  const child = Array.isArray(children) ? children[0] : children;
  const cls = (child as { props?: { className?: string } })?.props?.className ?? '';
  const lang = /language-(\w+)/.exec(cls)?.[1] ?? 'text';
  return (
    <div className="block-card">
      <div className="block-head">
        <span>{lang}</span>
        <button className="icon-btn xs" title="复制代码" onClick={() => copyText(ref.current?.innerText ?? '', toast)}><Icon name="copy" size={14} /></button>
      </div>
      <pre ref={ref}>{children}</pre>
    </div>
  );
}

function TableBlock({ children, toast }: { children?: ReactNode; toast: ToastFn }) {
  const ref = useRef<HTMLTableElement>(null);
  const toRows = () =>
    [...(ref.current?.rows ?? [])].map((r) => [...r.cells].map((c) => c.innerText.trim()));
  const download = () => {
    const csv = toRows().map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = '表格.csv';
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="block-card">
      <div className="block-head">
        <span>表格</span>
        <span className="block-actions">
          <button className="icon-btn xs" title="下载" onClick={download}><Icon name="download" size={14} /></button>
          <button className="icon-btn xs" title="复制表格" onClick={() => copyText(toRows().map((r) => r.join('\t')).join('\n'), toast)}><Icon name="copy" size={14} /></button>
        </span>
      </div>
      <div className="table-scroll"><table ref={ref}>{children}</table></div>
    </div>
  );
}
