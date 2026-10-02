import type { ElementRef } from './types.js';

const MAX_REFS = 5;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0);

/** Validates element refs sent with a chat message; anything malformed is dropped. */
export function parseElementRefs(raw: unknown): ElementRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ElementRef[] = [];
  for (const item of raw.slice(0, MAX_REFS)) {
    const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
    const pageId = str(o.pageId, 100);
    const selector = str(o.selector, 500);
    if (!pageId || !selector) continue;
    const rect = (o.rect && typeof o.rect === 'object' ? o.rect : {}) as Record<string, unknown>;
    const styles: Record<string, string> = {};
    if (o.styles && typeof o.styles === 'object') {
      for (const [k, v] of Object.entries(o.styles).slice(0, 30)) {
        const value = str(v, 100);
        if (/^[a-z-]{1,40}$/.test(k) && value) styles[k] = value;
      }
    }
    out.push({
      pageId,
      pageName: str(o.pageName, 100) || pageId,
      html: str(o.html, 300) || null,
      selector,
      name: str(o.name, 200) || selector,
      tag: str(o.tag, 40),
      text: str(o.text, 200),
      rect: { x: num(rect.x), y: num(rect.y), width: num(rect.width), height: num(rect.height) },
      styles,
      ...(str(o.comment, 2000) ? { comment: str(o.comment, 2000) } : {}),
    });
  }
  return out;
}

/** The context block appended to the user's message for the model; the stored message keeps the raw text. */
export function describeElements(refs: ElementRef[]) {
  if (!refs.length) return '';
  const items = refs.map((r, i) => {
    const styles = Object.entries(r.styles).map(([k, v]) => `${k}: ${v}`).join('; ');
    return [
      `${i + 1}. 页面「${r.pageName}」（id: ${r.pageId}${r.html ? `，文件 ${r.html}` : ''}）`,
      `   元素：${r.name}，CSS 选择器 \`${r.selector}\``,
      ...(r.text ? [`   文本内容：${JSON.stringify(r.text)}`] : []),
      `   页面内位置：x=${r.rect.x} y=${r.rect.y}，尺寸 ${r.rect.width}×${r.rect.height}`,
      ...(styles ? [`   当前样式：${styles}`] : []),
      ...(r.comment ? [`   评审评论（请据此修改）：${JSON.stringify(r.comment)}`] : []),
    ].join('\n');
  });
  return [
    '',
    '',
    '【用户在设计画布上选中的元素】本次请只针对以下元素做微调，其余部分保持不变：',
    ...items,
  ].join('\n');
}
