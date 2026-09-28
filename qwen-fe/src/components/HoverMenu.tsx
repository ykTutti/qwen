import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface Props {
  className?: string;
  menuClassName?: string;
  /** Menu left edge relative to the anchor's left edge. */
  offsetX?: number;
  gap?: number;
  trigger: ReactNode;
  children: ReactNode;
}

export function HoverMenu({ className = '', menuClassName = '', offsetX = 0, gap = 4, trigger, children }: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const [pos, setPos] = useState<{ left: number; bottom: number } | null>(null);

  const show = () => {
    window.clearTimeout(timer.current);
    const r = anchorRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left + offsetX, bottom: window.innerHeight - r.top + gap });
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPos(null), 120);
  };

  useEffect(() => {
    if (!pos) return;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <div ref={anchorRef} className={`${className} ${pos ? 'is-open' : ''}`} onMouseEnter={show} onMouseLeave={hide}>
      {trigger}
      {pos &&
        createPortal(
          <div
            className={`hover-menu ${menuClassName}`}
            role="menu"
            style={{ left: pos.left, bottom: pos.bottom }}
            onMouseEnter={show}
            onMouseLeave={hide}
            onClick={() => setPos(null)}
          >
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
