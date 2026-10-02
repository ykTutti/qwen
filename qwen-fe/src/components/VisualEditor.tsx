import { useState, type KeyboardEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

export type SaveState = { status: 'idle' | 'saving' | 'saved' } | { status: 'error'; message: string };

interface Props {
  name: string;
  selector: string;
  pageName: string;
  /** Computed values at pick time, keyed by CSS property. */
  initial: Record<string, string>;
  save: SaveState;
  onChange: (prop: string, value: string) => void;
  onClose: () => void;
}

const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
const BORDER_STYLES = ['none', 'solid', 'dashed', 'dotted', 'double'];
const SIDES = [['top', '上'], ['bottom', '下'], ['left', '左'], ['right', '右']] as const;

function toHex(color: string) {
  const m = color.match(/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (!m) return /^#[0-9a-f]{6}$/i.test(color) ? color : undefined;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  if (alpha < 1) return undefined;
  return `#${m.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

/** Computed colors come back as rgb(); show them as hex unless they are translucent. */
const readable = (prop: string, value: string) => (/color$/.test(prop) && toHex(value)) || value;

/** ArrowUp / ArrowDown nudge the number in values like "16px" by 1 (10 with Shift), keeping the unit. */
function nudge(e: KeyboardEvent<HTMLInputElement>, value: string, set: (v: string) => void) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  const m = value.trim().match(/^(-?\d*\.?\d+)([a-z%]*)$/i);
  if (!m) return;
  e.preventDefault();
  const step = (e.shiftKey ? 10 : 1) * (e.key === 'ArrowUp' ? 1 : -1);
  set(`${Math.round((parseFloat(m[1]) + step) * 100) / 100}${m[2] || 'px'}`);
}

export function VisualEditor({ name, selector, pageName, initial, save, onChange, onClose }: Props) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(Object.entries(initial).map(([p, v]) => [p, readable(p, v)])),
  );
  const set = (prop: string, value: string) => {
    setValues((v) => ({ ...v, [prop]: value }));
    onChange(prop, value);
  };

  const text = (prop: string, placeholder?: string) => (
    <input
      className="ve-input"
      value={values[prop] ?? ''}
      placeholder={placeholder}
      spellCheck={false}
      onChange={(e) => set(prop, e.target.value)}
      onKeyDown={(e) => nudge(e, values[prop] ?? '', (v) => set(prop, v))}
    />
  );
  const color = (prop: string) => (
    <div className="ve-color">
      <label className="ve-swatch">
        <span style={{ background: values[prop] || 'transparent' }} />
        <input type="color" value={toHex(values[prop] ?? '') ?? '#000000'} onChange={(e) => set(prop, e.target.value)} />
      </label>
      {text(prop)}
    </div>
  );
  const select = (prop: string, options: string[]) => (
    <select className="ve-input" value={values[prop] ?? ''} onChange={(e) => set(prop, e.target.value)}>
      {!options.includes(values[prop] ?? '') && <option value={values[prop] ?? ''}>{values[prop] || '—'}</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
  const row = (label: string, control: ReactNode) => (
    <div className="ve-row"><span>{label}</span>{control}</div>
  );
  const sides = (label: string, prefix: 'margin' | 'padding') => (
    <div className="ve-sides">
      <span className="ve-sides-label">{label}</span>
      <div className="ve-sides-grid">
        {SIDES.map(([side, short]) => (
          <label key={side} className="ve-side"><span>{short}</span>{text(`${prefix}-${side}`)}</label>
        ))}
      </div>
    </div>
  );

  return (
    <aside className="visual-editor nowheel" aria-label="样式编辑">
      <header className="ve-head">
        <div className="ve-title">
          <b title={selector}>{name}</b>
          <span>
            {pageName} ·{' '}
            {save.status === 'saving' ? '保存中…' : save.status === 'saved' ? '已写入代码' : save.status === 'error' ? <em>{save.message}</em> : '修改后自动保存'}
          </span>
        </div>
        <button className="icon-btn" title="关闭" aria-label="关闭" onClick={onClose}><Icon name="close" size={12} /></button>
      </header>
      <div className="ve-body">
        <section>
          <h4>颜色</h4>
          {row('背景颜色', color('background-color'))}
        </section>
        <section>
          <h4>字体</h4>
          {row('字体大小', text('font-size', '16px'))}
          {row('字重', select('font-weight', WEIGHTS))}
          {row('行高', text('line-height', 'normal'))}
          {row('字体颜色', color('color'))}
        </section>
        <section>
          <h4>布局</h4>
          {sides('外边距', 'margin')}
          {sides('内边距', 'padding')}
        </section>
        <section>
          <h4>边框</h4>
          {row('边框大小', text('border-width', '0px'))}
          {row('边框样式', select('border-style', BORDER_STYLES))}
          {row('边框颜色', color('border-color'))}
        </section>
      </div>
    </aside>
  );
}
