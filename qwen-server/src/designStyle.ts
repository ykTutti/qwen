import fsp from 'node:fs/promises';
import path from 'node:path';
import { readDesign, withLock } from './agent/tools/design.js';
import type { AgentSession } from './agent/tools/types.js';
import { resolvePath } from './agent/tools/workspace.js';

/** Properties the canvas visual editor may change. */
export const STYLE_PROPS = new Set([
  'background-color',
  'font-size', 'font-weight', 'line-height', 'color',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-width', 'border-style', 'border-color',
]);

const START = '/* qw-visual-editor:start — 画布可视化编辑生成，请勿手动修改此区块 */';
const END = '/* qw-visual-editor:end */';
const BLOCK_RE = /\/\* qw-visual-editor:start[^*]*\*\/([\s\S]*?)\/\* qw-visual-editor:end \*\//;

export class StyleError extends Error {}

type Rules = Map<string, Map<string, string>>;

function parseBlock(body: string): Rules {
  const rules: Rules = new Map();
  for (const m of body.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const d of m[2].split(';')) {
      const i = d.indexOf(':');
      if (i > 0) decls.set(d.slice(0, i).trim(), d.slice(i + 1).replace(/!important/i, '').trim());
    }
    rules.set(m[1].trim(), decls);
  }
  return rules;
}

function printBlock(rules: Rules) {
  const body = [...rules]
    .filter(([, decls]) => decls.size)
    .map(([sel, decls]) => `${sel} {\n${[...decls].map(([p, v]) => `  ${p}: ${v} !important;`).join('\n')}\n}`)
    .join('\n');
  return `${START}\n${body}\n${END}`;
}

/**
 * Writes visual-editor changes into the page's stylesheet (pages/<id>.css next to its HTML, created and linked
 * if missing). Edits live in one marked block at the end of the file; `!important` makes them win over the
 * page's own rules no matter how specific those are. An empty value removes the override.
 */
export async function applyDesignStyle(session: AgentSession, pageId: string, selector: string, styles: Record<string, unknown>) {
  selector = selector.trim();
  // `>` is the child combinator the picker builds selectors with; only braces, comments, `;` and `<` could break out of the rule or the file.
  if (!selector || selector.length > 500 || /[{};<]|\/\*|\*\//.test(selector)) throw new StyleError('选择器不合法');
  const changes: [string, string][] = [];
  for (const [prop, raw] of Object.entries(styles ?? {})) {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!STYLE_PROPS.has(prop)) throw new StyleError(`不支持修改 ${prop}`);
    if (value.length > 100 || /[;{}<>]|\/\*|\*\//.test(value)) throw new StyleError(`${prop} 的值不合法`);
    changes.push([prop, value]);
  }
  if (!changes.length) throw new StyleError('没有要修改的样式');

  return withLock(session.id, async () => {
    const page = (await readDesign(session))?.design.pages.find((p) => p.id === pageId);
    if (!page?.html) throw new StyleError('页面不存在或还没生成');
    const htmlRel = page.html;
    const cssRel = htmlRel.replace(/\.html?$/i, '') + '.css';
    const htmlAbs = (await resolvePath(htmlRel, session)).abs;
    const cssAbs = (await resolvePath(cssRel, session)).abs;

    const css = await fsp.readFile(cssAbs, 'utf8').catch(() => '');
    const rules = BLOCK_RE.test(css) ? parseBlock(css.match(BLOCK_RE)![1]) : new Map() as Rules;
    const decls = rules.get(selector) ?? new Map<string, string>();
    for (const [prop, value] of changes) value ? decls.set(prop, value) : decls.delete(prop);
    rules.set(selector, decls);
    const block = printBlock(rules);
    const next = BLOCK_RE.test(css) ? css.replace(BLOCK_RE, () => block) : `${css.replace(/\s*$/, '')}${css.trim() ? '\n\n' : ''}${block}\n`;
    await fsp.writeFile(cssAbs, next, 'utf8');

    const cssName = path.basename(cssAbs);
    const html = await fsp.readFile(htmlAbs, 'utf8');
    if (!new RegExp(`href=["'](?:\\./)?${cssName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(html)) {
      const link = `<link rel="stylesheet" href="${cssName}">`;
      const at = html.search(/<\/head>/i);
      await fsp.writeFile(htmlAbs, at === -1 ? link + html : `${html.slice(0, at)}${link}\n${html.slice(at)}`, 'utf8');
    }
    return { file: cssRel };
  });
}
