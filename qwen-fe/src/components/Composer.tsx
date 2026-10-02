import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { elementTitle, isWorkLike, type ChatMode, type ElementRef, type Skill, type Surface, type ToastFn } from '../types';
import { useConfig } from '../config';
import { SKILL_CREATOR, refreshSkills, useSkills } from '../skills';
import { Icon } from './Icon';
import { Popover } from './Popover';
import modelLogo from '../assets/models/qwen.png';
import { ScrollArea } from './ScrollArea';

const WORK_ENVS = [
  { value: '云端', title: '工作助理·云端电脑', desc: '无法访问本地文件', icon: 'cloud' },
  { value: '本地', title: '工作助理·本地电脑', desc: '经允许可读取和编辑本地文件', icon: 'personalComputer' },
];

export interface ComposerHandle {
  focus: () => void;
  setText: (text: string) => void;
}

interface Props {
  surface: Surface;
  temporary?: boolean;
  streaming: boolean;
  mode: ChatMode;
  workModel: string;
  skill?: string;
  placeholder?: string;
  onMode: (m: ChatMode) => void;
  onWorkModel: (key: string) => void;
  onSkill: (key?: string) => void;
  /** Design-canvas elements that will ride along with the next message. */
  elements?: ElementRef[];
  onRemoveElement?: (ref: ElementRef) => void;
  onSend: (text: string, attachments: string[]) => void;
  onStop: () => void;
  toast: ToastFn;
}

export const Composer = forwardRef<ComposerHandle, Props>(function Composer(props, ref) {
  const { modes, plusMenu, skills, toolbarSkillKeys, workModels } = useConfig();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  const workModel = workModels.some((m) => m.key === props.workModel) ? props.workModel : workModels[0].key;
  const [optionValues, setOptionValues] = useState<Record<string, string>>({});
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isWork = isWorkLike(props.surface);
  const skill = isWork ? undefined : skills.find((s) => s.key === props.skill);
  const { skills: agentSkills } = useSkills();
  const workSkill = props.surface === 'work' && props.skill
    ? agentSkills.find((s) => s.name === props.skill) ?? { name: props.skill, title: props.skill === SKILL_CREATOR ? '新建技能' : props.skill }
    : undefined;
  const placeholder = workSkill
    ? workSkill.name === SKILL_CREATOR ? '描述你想创建的技能，比如：每周根据我给的要点写一份周报' : `使用「${workSkill.title}」，描述你的任务`
    : props.placeholder ?? skill?.placeholder ?? '向千问提问';

  useEffect(() => {
    if (!localOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setLocalOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [localOpen]);

  useImperativeHandle(ref, () => ({
    focus: () => taRef.current?.focus(),
    setText: (t) => {
      setText(t);
      requestAnimationFrame(() => taRef.current?.focus());
    },
  }));

  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  }, [text]);

  const [visibleCount, setVisibleCount] = useState(toolbarSkillKeys.length);
  const scrollRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const box = scrollRef.current;
    if (!box) return;
    const fit = () => {
      const items = measureRef.current ? [...measureRef.current.children] as HTMLElement[] : [];
      if (!items.length) return;
      const gap = 12;
      const widths = items.map((el) => el.offsetWidth);
      const fixedW = widths[0];
      const moreW = widths[widths.length - 1];
      const restWs = widths.slice(1, -1);
      const alwaysMore = measureRef.current?.dataset.alwaysMore === 'true';
      const allW = restWs.reduce((sum, w) => sum + w + gap, fixedW);
      if (!alwaysMore && allW <= box.clientWidth) {
        setVisibleCount(restWs.length);
        return;
      }
      let used = fixedW + gap + moreW;
      let n = 0;
      while (n < restWs.length && used + restWs[n] + gap <= box.clientWidth) {
        used += restWs[n] + gap;
        n += 1;
      }
      setVisibleCount(n);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    if (measureRef.current) ro.observe(measureRef.current);
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
  }, [props.mode, isWork, !!skill, !!workSkill, !!props.temporary]);

  const openSkill = (s: Skill) => {
    if (s.href) window.open(s.href, '_blank', 'noopener');
    else props.onSkill(s.key);
  };

  const elements = props.elements ?? [];
  const canSend = (text.trim().length > 0 || files.length > 0 || elements.length > 0) && !props.streaming;

  const send = () => {
    if (!canSend) return;
    const fallback = files.length
      ? '请帮我分析这些文件'
      : elements.some((el) => el.comment) ? '请根据评论修改选中的元素' : '请优化选中的元素';
    props.onSend(text.trim() || fallback, files);
    setText('');
    setFiles([]);
  };

  const pickFile = (accept?: string) => {
    if (!fileRef.current) return;
    fileRef.current.accept = accept ?? '';
    fileRef.current.click();
  };

  const plus = (
    <Popover
      placement="bottom-start"
      trigger={(open, toggle) => (
        <button className={`tool-circle ${open ? 'is-open' : ''}`} title="添加附件" onClick={toggle}>
          <Icon name={open ? 'close' : 'plus'} />
        </button>
      )}
    >
      {(close) => (
        <div className="menu">
          {plusMenu.map((m) => (
            <button
              key={m.key}
              onClick={() => {
                close();
                if ('accept' in m) pickFile(m.accept);
                else props.toast(`${m.label}（需在电脑端使用）`);
              }}
            >
              <Icon name={m.icon} />
              {m.label}
              {'arrow' in m && m.arrow && <Icon name="rightMini" size={12} className="menu-tail" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );

  const dropdownTool = (label: string, icon: string, items: string[], value: string, onPick: (v: string) => void) => (
    <Popover
      key={label}
      trigger={(open, toggle) => (
        <button className={`tool ${open ? 'is-open' : ''}`} onClick={toggle}>
          <Icon name={icon} />
          <span>{value || label}</span>
          <Icon name="downMini" size={12} className={`chevron ${open ? 'is-up' : ''}`} />
        </button>
      )}
    >
      {(close) => (
        <div className="menu">
          {items.map((it) => (
            <button key={it} onClick={() => { onPick(it); close(); }}>
              {it}
              {(value || label) === it && <Icon name="qwpcicon-check" className="menu-tail menu-check" />}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );

  const renderDailyTools = () => {
    if (skill) {
      return (
        <>
          <span className="skill-chip">
            <Icon name={skill.icon} />
            {skill.name}
            <button onClick={() => props.onSkill(undefined)} title="退出技能"><Icon name="close" size={10} /></button>
          </span>
          {skill.options?.map((o) =>
            o.dropdown
              ? dropdownTool(o.label, o.icon, o.dropdown, optionValues[`${skill.key}.${o.label}`] ?? '', (v) =>
                  setOptionValues((p) => ({ ...p, [`${skill.key}.${o.label}`]: v })),
                )
              : (
                <button key={o.label} className="tool" onClick={() => pickFile()}>
                  <Icon name={o.icon} /><span>{o.label}</span>
                </button>
              ),
          )}
        </>
      );
    }
    const current = modes.find((m) => m.key === props.mode)!;
    const shownKeys = toolbarSkillKeys.slice(0, visibleCount);
    const moreSkills = skills.filter((s) => !shownKeys.includes(s.key));
    const modeButton = (open: boolean, toggle?: () => void) => (
      <button className={`tool ${open ? 'is-open' : ''} ${props.mode === 'research' ? 'is-on' : ''}`} onClick={toggle}>
        <Icon name={current.icon} />
        <span>{current.name}</span>
        <Icon name="downMini" size={12} className={`chevron ${open ? 'is-up' : ''}`} />
      </button>
    );
    const skillButton = (k: string) => {
      const s = skills.find((x) => x.key === k)!;
      return (
        <button key={k} className="tool" onClick={() => openSkill(s)}>
          <Icon name={s.icon} />
          <span>{s.name}</span>
          {s.badge && <em className="badge">{s.badge}</em>}
        </button>
      );
    };
    const moreButton = (open: boolean, toggle?: () => void) => (
      <button className={`tool ${open ? 'is-open' : ''}`} onClick={toggle}>
        <Icon name="menu" />
        <span>更多</span>
      </button>
    );
    const modePopover = (
      <Popover trigger={modeButton}>
        {(close) => (
          <div className="menu mode-menu">
            {modes.map((m) => (
              <button key={m.key} className={`menu-rich ${m.key === props.mode ? 'is-active' : ''}`} onClick={() => { props.onMode(m.key); close(); }}>
                <div>
                  <div className="menu-rich-name"><Icon name={m.icon} />{m.name}</div>
                  <div className="menu-rich-desc indent">{m.desc}</div>
                </div>
                {m.key === props.mode && <Icon name="qwpcicon-check" className="menu-check" />}
              </button>
            ))}
          </div>
        )}
      </Popover>
    );
    if (props.temporary) return modePopover;
    return (
      <>
        <div className="toolbar-measure" ref={measureRef} data-always-more="true" aria-hidden="true">
          {modeButton(false)}
          {toolbarSkillKeys.map(skillButton)}
          {moreButton(false)}
        </div>
        {modePopover}
        {shownKeys.map(skillButton)}
        <Popover trigger={moreButton}>
          {(close) => (
            <div className="menu">
              {moreSkills.map((s) => (
                <button key={s.key} onClick={() => { openSkill(s); close(); }}>
                  <Icon name={s.icon} />{s.name}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </>
    );
  };

  const renderWorkTools = () => {
    if (workSkill) {
      return (
        <span className="skill-chip">
          <Icon name="component" />
          {workSkill.title}
          <button onClick={() => props.onSkill(undefined)} title="退出技能"><Icon name="close" size={10} /></button>
        </span>
      );
    }
    const tools = [
      { key: 'work.env', label: '云端', icon: 'cloud', items: ['云端', '本地'] },
      { key: 'work.conn', label: '连接', icon: 'connector', items: ['钉钉文档', '飞书文档', '企业邮箱', '添加连接…'] },
      ...(props.surface === 'work' ? [{ key: 'work.skill', label: '技能', icon: 'component', items: [] }] : []),
    ];
    const library = agentSkills.filter((s) => !s.hidden);
    const skillItems = (close: () => void) => (
      <>
        {library.length === 0 && <div className="menu-head">技能库还没有技能</div>}
        {library.map((s) => (
          <button key={s.name} title={s.description} onClick={() => { props.onSkill(s.name); close(); }}>{s.title}</button>
        ))}
        <div className="menu-divider" />
        <button onClick={() => { props.onSkill(SKILL_CREATOR); close(); }}><Icon name="add" />新建技能</button>
      </>
    );
    const skillTool = () => (
      <Popover
        key="work.skill"
        trigger={(open, toggle) => (
          <button
            className={`tool ${open ? 'is-open' : ''}`}
            onClick={() => {
              if (!open) refreshSkills().catch(() => undefined);
              toggle();
            }}
          >
            <Icon name="component" />
            <span>技能</span>
            <Icon name="downMini" size={12} className={`chevron ${open ? 'is-up' : ''}`} />
          </button>
        )}
      >
        {(close) => <div className="menu menu-skills">{skillItems(close)}</div>}
      </Popover>
    );
    const pick = (key: string) => (v: string) => setOptionValues((p) => ({ ...p, [key]: v }));
    const env = WORK_ENVS.find((e) => e.value === optionValues['work.env']) ?? WORK_ENVS[0];
    const staticTool = (t: (typeof tools)[number]) => (
      <button key={t.key} className="tool">
        <Icon name={t.key === 'work.env' ? env.icon : t.icon} />
        <span>{optionValues[t.key] || t.label}</span>
        <Icon name="downMini" size={12} className="chevron" />
      </button>
    );
    const envTool = () => (
      <Popover
        key="work.env"
        className="popover-env"
        trigger={(open, toggle) => (
          <button className={`tool ${open ? 'is-open' : ''}`} onClick={toggle}>
            <Icon name={env.icon} />
            <span>{env.value}</span>
            <Icon name="downMini" size={12} className="chevron" />
          </button>
        )}
      >
        {(close) => (
          <div className="env-panel">
            {WORK_ENVS.map((e) => (
              <button
                key={e.value}
                className={`env-item ${e.value === env.value ? 'is-active' : ''}`}
                onClick={() => {
                  if (e.value === '本地') setLocalOpen(true);
                  else pick('work.env')(e.value);
                  close();
                }}
              >
                <span className="env-item-main">
                  <Icon name={e.icon} />
                  <span className="env-item-text">
                    <span className="env-item-title">{e.title}</span>
                    <span className="env-item-desc">{e.desc}</span>
                  </span>
                </span>
                {e.value === env.value && <Icon name="qwpcicon-checkMini" />}
              </button>
            ))}
          </div>
        )}
      </Popover>
    );
    const moreTrigger = (open: boolean, toggle?: () => void) => (
      <button className={`tool ${open ? 'is-open' : ''}`} onClick={toggle}>
        <Icon name="menu" />
        <span>更多</span>
      </button>
    );
    const shown = tools.slice(0, 1 + visibleCount);
    const hidden = tools.slice(1 + visibleCount);
    return (
      <>
        <div className="toolbar-measure" ref={measureRef} data-always-more="false" aria-hidden="true">
          {tools.map(staticTool)}
          {moreTrigger(false)}
        </div>
        {shown.map((t) =>
          t.key === 'work.env' ? envTool()
            : t.key === 'work.skill' ? skillTool()
              : dropdownTool(t.label, t.icon, t.items, optionValues[t.key] ?? '', pick(t.key)),
        )}
        {hidden.length > 0 && (
          <Popover trigger={moreTrigger}>
            {(close) => (
              <div className="menu">
                {hidden.map((t) => (
                  <div key={t.key} className="menu-group">
                    <div className="menu-head"><Icon name={t.icon} />{t.label}</div>
                    {t.key === 'work.skill' && skillItems(close)}
                    {t.items.map((it) => (
                      <button key={it} onClick={() => {
                        if (t.key === 'work.env' && it === '本地') setLocalOpen(true);
                        else pick(t.key)(it);
                        close();
                      }}>
                        {it}
                        {(optionValues[t.key] || t.label) === it && <Icon name="qwpcicon-check" className="menu-tail menu-check" />}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </Popover>
        )}
      </>
    );
  };

  const workModelName = workModels.find((m) => m.key === workModel)!.name;

  return (
    <div className="composer-wrap">
      <div className={`composer ${isWork ? 'is-work' : ''}`}>
        {(files.length > 0 || elements.length > 0) && (
          <div className="attach-list">
            {elements.map((el) => (
              <div key={`${el.pageId}|${el.selector}|${el.comment ?? ''}`} className="attach-chip is-element" title={elementTitle(el)}>
                <Icon name={el.comment ? 'comment' : 'target'} size={14} />
                <span><em>{el.pageName}</em>{el.name}{el.comment && <i>{el.comment}</i>}</span>
                <button onClick={() => props.onRemoveElement?.(el)}><Icon name="close" size={10} /></button>
              </div>
            ))}
            {files.map((f) => (
              <div key={f} className="attach-chip">
                <Icon name="fileUpload" />
                <span>{f}</span>
                <button onClick={() => setFiles(files.filter((x) => x !== f))}><Icon name="close" size={10} /></button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={placeholder}
          onChange={(e) => setText(e.target.value)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          onKeyDown={(e) => {
            if (e.key === 'Backspace' && !text && (skill || workSkill)) props.onSkill(undefined);
            if (e.key === 'Enter' && !e.shiftKey && !composing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-toolbar">
          {plus}
          <div className="toolbar-scroll" ref={scrollRef}>{isWork ? renderWorkTools() : renderDailyTools()}</div>
          <div className="toolbar-right">
            {isWork && (
              <Popover
                placement="bottom-end"
                className="popover-work-model"
                trigger={(open, toggle) => (
                  <button className={`tool model-tool ${open ? 'is-open' : ''}`} onClick={toggle}>
                    <span>{workModelName}</span>
                    <Icon name="downMini" size={12} className="chevron" />
                  </button>
                )}
              >
                {(close) => (
                  <div className="work-model-panel">
                    <ScrollArea className="work-model-list">
                      <div className="work-model-head">选择固定模型</div>
                      {workModels.map((m) => (
                        <button
                          key={m.key}
                          className={`work-model-item ${m.key === workModel ? 'is-active' : ''}`}
                          onClick={() => { props.onWorkModel(m.key); close(); }}
                        >
                          <span className="work-model-label">
                            <img src={modelLogo} width={16} height={16} alt="" />
                            <span className="work-model-name">{m.name}</span>
                          </span>
                          <span className="work-model-check">
                            {m.key === workModel && <Icon name="qwpcicon-checkMini" />}
                          </span>
                        </button>
                      ))}
                    </ScrollArea>
                    <div className="work-model-foot">
                      <button className="work-model-item is-foot" onClick={() => { close(); props.toast('添加自定义模型（mock）'); }}>
                        <span className="work-model-label is-foot">
                          <Icon name="add" />
                          <span>添加自定义模型</span>
                        </span>
                        <Icon name="rightMini" className="work-model-arrow" />
                      </button>
                    </div>
                  </div>
                )}
              </Popover>
            )}
            <button className="mic-btn" title="语音输入" onClick={() => props.toast('语音输入（mock）')}>
              <Icon name="mic" />
            </button>
            {props.streaming ? (
              <button className="send-btn is-active" title="停止生成" onClick={props.onStop}>
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button className={`send-btn ${canSend ? 'is-active' : ''}`} disabled={!canSend} title="发送" onClick={send}>
                <Icon name="sendChat" />
              </button>
            )}
          </div>
        </div>
      </div>
      {localOpen && createPortal(
        <div className="modal-mask local-modal-mask" onMouseDown={() => setLocalOpen(false)}>
          <div className="local-modal" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
            <img
              className="local-modal-hero"
              src="https://g.alicdn.com/code/npm/@ali/qianwen-web/4.8.6/web/static/image/local-computer-modal-hero.png"
              alt=""
              aria-hidden="true"
            />
            <button className="local-modal-close" title="关闭" aria-label="关闭" onClick={() => setLocalOpen(false)} />
            <div className="local-modal-body">
              <h2>本地办公助理已上线</h2>
              <p>任务助理全面升级，能整理文件、做调研、跑定时任务，全面支撑你的办公需求。</p>
              <div className="local-modal-foot">
                <a className="btn-primary" href="https://www.qianwen.com/download" target="_blank" rel="noreferrer" onClick={() => setLocalOpen(false)}>下载千问电脑版</a>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const names = Array.from(e.target.files ?? []).map((f) => f.name);
          setFiles((prev) => Array.from(new Set([...prev, ...names])));
          e.target.value = '';
        }}
      />
    </div>
  );
});
