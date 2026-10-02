import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { Icon } from './Icon';

const SLIDE_W = 960;
const SLIDE_H = 540;
const THUMB_W = 168;

type Previewer = ReturnType<typeof import('pptx-preview')['init']>;

// The library bundles echarts, so it's only loaded when a deck is actually opened.
const loadLib = () => import('pptx-preview');

/** Slide deck viewer: thumbnails on the left, the selected slide scaled to fit on the right. */
export function PptxPreview({ data }: { data: ArrayBuffer }) {
  const thumbsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const slideRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<Previewer | null>(null);
  const [count, setCount] = useState(0);
  const [index, setIndex] = useState(0);
  const [scale, setScale] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const thumbs = thumbsRef.current!;
    const slide = slideRef.current!;
    setError('');
    setCount(0);
    (async () => {
      try {
        const { init } = await loadLib();
        if (cancelled) return;
        thumbs.innerHTML = '';
        slide.innerHTML = '';
        // Each previewer parses its own copy: the list renders every slide small, the main one renders one at a time.
        const list = init(thumbs, { width: THUMB_W, mode: 'list' });
        const main = init(slide, { width: SLIDE_W, height: SLIDE_H, mode: 'slide' });
        await Promise.all([list.preview(data.slice(0)), main.load(data.slice(0))]);
        if (cancelled) return;
        mainRef.current = main;
        setIndex(0);
        setCount(main.slideCount);
      } catch {
        if (!cancelled) setError('PPT 解析失败，请下载后查看');
      }
    })();
    return () => {
      cancelled = true;
      mainRef.current = null;
    };
  }, [data]);

  useEffect(() => {
    if (count) mainRef.current?.renderSingleSlide(index);
    thumbsRef.current?.querySelectorAll('.pptx-preview-slide-wrapper').forEach((el, i) => {
      el.classList.toggle('is-active', i === index);
      if (i === index) el.scrollIntoView({ block: 'nearest' });
    });
  }, [index, count]);

  useLayoutEffect(() => {
    const stage = stageRef.current!;
    const fit = () => setScale(Math.min((stage.clientWidth - 48) / SLIDE_W, (stage.clientHeight - 48) / SLIDE_H));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!count) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') setIndex((i) => Math.min(i + 1, count - 1));
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') setIndex((i) => Math.max(i - 1, 0));
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [count]);

  const pick = (e: MouseEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest('.pptx-preview-slide-wrapper');
    const i = el ? [...el.parentElement!.children].indexOf(el) : -1;
    if (i >= 0) setIndex(i);
  };

  return (
    <div className="pptx-view">
      <div className="pptx-thumbs" ref={thumbsRef} onClick={pick} />
      <div className="pptx-stage" ref={stageRef}>
        <div className="pptx-slide" style={{ width: SLIDE_W * scale, height: SLIDE_H * scale }}>
          <div ref={slideRef} style={{ width: SLIDE_W, height: SLIDE_H, transform: `scale(${scale})`, transformOrigin: '0 0' }} />
        </div>
        {count > 0 && <div className="pptx-page">{index + 1} / {count}</div>}
        {!count && !error && <div className="pptx-overlay"><Icon name="loading" className="spin" size={28} /></div>}
        {error && <div className="pptx-overlay file-panel-empty">{error}</div>}
      </div>
    </div>
  );
}
