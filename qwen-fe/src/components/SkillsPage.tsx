import { useEffect, useState } from 'react';
import { refreshSkills, useSkills } from '../skills';
import type { AgentSkill, ToastFn } from '../types';
import { Icon } from './Icon';

interface Props {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onCreate: () => void;
  onUse: (name: string) => void;
  toast: ToastFn;
}

type Tab = 'all' | 'custom' | 'builtin';
const TAB_LABELS: Record<Tab, string> = { all: '全部', custom: '我创建的', builtin: '官方' };

export function SkillsPage({ sidebarCollapsed, onToggleSidebar, onCreate, onUse, toast }: Props) {
  const { skills, loaded } = useSkills();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('all');

  useEffect(() => {
    refreshSkills().catch((err: Error) => toast(err.message || '技能加载失败', 'error'));
  }, [toast]);

  const visible = skills.filter((s) => !s.hidden);
  const counts: Record<Tab, number> = {
    all: visible.length,
    custom: visible.filter((s) => s.source === 'custom').length,
    builtin: visible.filter((s) => s.source === 'builtin').length,
  };
  const tabs = (Object.keys(TAB_LABELS) as Tab[]).filter((t) => t === 'all' || counts[t] > 0);
  const q = query.trim().toLowerCase();
  const list = visible.filter(
    (s) => (tab === 'all' || s.source === tab) && (!q || `${s.title} ${s.name} ${s.description}`.toLowerCase().includes(q)),
  );

  return (
    <div className="skills-page">
      <header className="skills-head">
        {sidebarCollapsed && (
          <button className="icon-btn" data-tip="展开侧边栏" onClick={onToggleSidebar}><Icon name="sidebarLeft" /></button>
        )}
        <h1>技能</h1>
        <label className="skills-search">
          <Icon name="search2" />
          <input value={query} placeholder="搜索" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="skills-new" onClick={onCreate}><Icon name="add" />新建</button>
      </header>

      {visible.length > 0 && (
        <div className="skills-tabs" role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'is-active' : ''} onClick={() => setTab(t)}>
              {TAB_LABELS[t]}·{counts[t]}
            </button>
          ))}
        </div>
      )}

      <div className="skills-body">
        {!loaded ? (
          <div className="skills-grid">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skill-card is-skeleton"><div className="skeleton" /><div className="skeleton" /></div>)}
          </div>
        ) : visible.length === 0 ? (
          <div className="skills-empty">
            <span className="skills-empty-icon"><Icon name="component" size={28} /></span>
            <h2>还没有技能</h2>
            <p>把常用的工作方法沉淀成技能，之后一键调用。点击「新建」，用对话的方式创建第一个技能。</p>
            <button className="skills-new" onClick={onCreate}><Icon name="add" />新建技能</button>
          </div>
        ) : list.length === 0 ? (
          <div className="skills-empty"><p>没有找到相关技能</p></div>
        ) : (
          <div className="skills-grid">
            {list.map((s) => <SkillCard key={s.name} skill={s} onUse={() => onUse(s.name)} />)}
          </div>
        )}
      </div>
    </div>
  );
}

function SkillCard({ skill, onUse }: { skill: AgentSkill; onUse: () => void }) {
  return (
    <div className="skill-card">
      <div className="skill-card-top">
        <span className="skill-card-icon"><Icon name="component" size={22} /></span>
        <div className="skill-card-title">
          <span className="skill-card-name" title={skill.name}>{skill.title}</span>
          <span className={`skill-card-tag is-${skill.source}`}>{skill.source === 'custom' ? '我创建的' : '官方'}</span>
        </div>
      </div>
      <p className="skill-card-desc">{skill.description}</p>
      <div className="skill-card-foot">
        <button className="btn-outline" onClick={onUse}>使用</button>
      </div>
    </div>
  );
}
