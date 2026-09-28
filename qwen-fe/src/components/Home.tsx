import { useEffect, useState, type ReactNode } from 'react';
import { starterIcon, useConfig } from '../config';
import type { Promo, Surface, ToastFn } from '../types';
import { Icon, LogoMark } from './Icon';
import workLogo from '../assets/work-logo.png';
import promoAgent from '../assets/promos/agent.png';
import promoIme from '../assets/promos/ime.png';
import promoRecord from '../assets/promos/record.png';

interface Props {
  surface: Surface;
  skill?: string;
  temporary: boolean;
  composer: ReactNode;
  onSkill: (key?: string) => void;
  onPrompt: (text: string) => void;
  toast: ToastFn;
}

export function Home({ surface, skill, temporary, composer, onSkill, onPrompt, toast }: Props) {
  const { imageExamples, pptTemplates, skills, workStarters } = useConfig();
  const s = skills.find((x) => x.key === skill);
  const [starters] = useState(() => [...workStarters].sort(() => Math.random() - 0.5).slice(0, 3));

  if (surface === 'work') {
    return (
      <div className="home is-work">
        <div className="home-center">
          <div className="hero is-work">
            <img src={workLogo} width={48} height={48} alt="" />
            <h1>千问，你的办公助理</h1>
          </div>
          <div className="project-tray">
            {composer}
            <button className="tray-btn" onClick={() => toast('选择工作项目（mock）')}>
              <Icon name="folder" />
              <span>选择工作项目</span>
              <Icon name="downMini" size={12} />
            </button>
          </div>
          <div className="starters">
            <p className="starters-title">从这里开始</p>
            {starters.map((w) => (
              <button key={w.text} className="starter" onClick={() => onPrompt(w.text)}>
                <img src={starterIcon(w.icon)} width={16} height={16} alt="" />
                <span>{w.text}</span>
                <Icon name="arrowRightUp" size={16} className="starter-arrow" />
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="home">
      <div className={`home-center ${s ? 'has-skill' : ''}`}>
        <div className="hero">
          {s ? (
            <span className="hero-skill"><Icon name={s.icon} size={22} /></span>
          ) : (
            <LogoMark size={48} />
          )}
          <h1>{s?.heroTitle ?? (temporary ? '临时对话' : '你好，我是千问')}</h1>
        </div>
        {temporary && !s && <p className="hero-sub">临时对话不会出现在历史记录中，关闭后将自动删除</p>}
        {composer}

        {!s && !temporary && (
          <div className="promo-row">
            <PromoCarousel onAction={(p) => (p.skill ? onSkill(p.skill) : toast('扫码下载（mock）'))} />
          </div>
        )}

        {s?.key === 'ppt' && (
          <div className="skill-section">
            <div className="section-tabs"><span className="is-active">热门模板</span></div>
            <div className="tpl-grid">
              {pptTemplates.map((t) => (
                <button key={t.name} className="tpl-card" onClick={() => onPrompt(`用「${t.name}」模板做一份 PPT：`)}>
                  <div className="tpl-thumb" style={{ background: `linear-gradient(135deg, ${t.from}, ${t.to})` }}>
                    <div className="tpl-lines"><i /><i /><i /></div>
                  </div>
                  <span>{t.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {s?.key === 'image' && (
          <div className="skill-section">
            <div className="section-tabs"><span className="is-active">灵感广场</span></div>
            <div className="img-grid">
              {imageExamples.map((t) => (
                <button key={t} className="img-card" onClick={() => onPrompt(t)}>
                  <img src={`https://picsum.photos/seed/${encodeURIComponent(t)}/400/300`} alt="" />
                  <span>{t}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


function PromoCarousel({ onAction }: { onAction: (p: Promo) => void }) {
  const { promos } = useConfig();
  const [index, setIndex] = useState(0);
  const [closed, setClosed] = useState(false);
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (hover) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % promos.length), 4000);
    return () => clearInterval(t);
  }, [hover, promos.length]);

  if (closed) return null;

  return (
    <div className="promo" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="promo-dots">
        {promos.map((_, i) => (
          <button key={i} className={i === index ? 'is-active' : ''} onClick={() => setIndex(i)} />
        ))}
      </div>
      <div className="promo-viewport">
        <div className="promo-track" style={{ transform: `translateY(-${index * 72}px)` }}>
          {promos.map((p) => (
            <div key={p.title} className="promo-card">
              <PromoArt kind={p.art} />
              <div className="promo-text">
                <div className="promo-title">{p.title}</div>
                <div className="promo-desc">{p.desc}</div>
              </div>
              <button className="btn-primary pill" onClick={() => onAction(p)}>{p.action}</button>
            </div>
          ))}
        </div>
      </div>
      <button className="promo-close" onClick={() => setClosed(true)} title="关闭"><Icon name="close" size={10} /></button>
    </div>
  );
}

const promoArts: Record<string, string> = { agent: promoAgent, ime: promoIme, record: promoRecord };

function PromoArt({ kind }: { kind: string }) {
  return <img className="promo-art" src={promoArts[kind]} width={148} height={72} alt="" />;
}
