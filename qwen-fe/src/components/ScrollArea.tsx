import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const THUMB = 63;

export function ScrollArea({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ top: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const overflow = el.scrollHeight - el.clientHeight;
      if (overflow <= 0) return setThumb(null);
      setThumb({ top: el.scrollTop + (el.scrollTop / overflow) * (el.clientHeight - THUMB) });
    };
    update();
    el.addEventListener('scroll', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  return (
    <div ref={ref} className={`scroll-area ${className ?? ''}`}>
      {children}
      {thumb && <span className="scroll-thumb" style={{ top: thumb.top, height: THUMB }} />}
    </div>
  );
}
