import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

type Placement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';

interface Props {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  placement?: Placement;
  className?: string;
}

const GAP = 4;
const EDGE_TOP = 56;
const EDGE_BOTTOM = 8;

const flipped = (p: Placement): Placement =>
  (p.startsWith('bottom') ? p.replace('bottom', 'top') : p.replace('top', 'bottom')) as Placement;

export function Popover({ trigger, children, placement = 'bottom-start', className }: Props) {
  const [open, setOpen] = useState(false);
  const [actual, setActual] = useState<Placement>(placement);
  const [maxH, setMaxH] = useState<number>();
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open) {
      setActual(placement);
      setMaxH(undefined);
      return;
    }
    const pop = popRef.current;
    const anchor = ref.current;
    if (!pop || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const h = pop.offsetHeight + 8;
    const below = window.innerHeight - a.bottom - EDGE_BOTTOM;
    const above = a.top - EDGE_TOP;
    let next = placement;
    if (placement.startsWith('bottom') && below < h && above > below) next = flipped(placement);
    else if (placement.startsWith('top') && above < h && below > above) next = flipped(placement);
    setActual(next);
    setMaxH(Math.floor((next.startsWith('top') ? above : below) - GAP));
  }, [open, placement]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="popover-anchor" ref={ref}>
      {trigger(open, () => setOpen((v) => !v))}
      {open && (
        <div
          ref={popRef}
          className={`popover popover-${actual} ${className ?? ''}`}
          style={maxH ? ({ '--popover-max-h': `${maxH}px` } as CSSProperties) : undefined}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
