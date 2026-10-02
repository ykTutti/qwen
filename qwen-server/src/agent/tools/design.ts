import fsp from 'node:fs/promises';
import type { AgentTool, AgentSession } from './types.js';
import { requireSession, resolvePath } from './workspace.js';

/**
 * design.json describes a design-mode prototype as a graph for the canvas preview: one node per page (its HTML
 * file is filled in by the sub-agent that builds it) and one edge per navigation between pages.
 */
export const DESIGN_FILE = 'design.json';

export interface DesignPage {
  id: string;
  name: string;
  description?: string;
  agentId?: string;
  /** Path of the page's HTML in the work dir; null until a sub-agent has built it. */
  html: string | null;
  status: 'pending' | 'done';
  updatedAt?: number;
}

export interface DesignEdge {
  from: string;
  to: string;
  label?: string;
}

export interface DesignDoc {
  title: string;
  platform: 'mobile' | 'desktop';
  viewport: { width: number; height: number };
  pages: DesignPage[];
  edges: DesignEdge[];
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const num = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** Coerces whatever the model wrote into a well-formed doc, dropping pages without ids and dangling edges. */
export function normalizeDesign(raw: unknown): DesignDoc {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const platform = d.platform === 'desktop' ? 'desktop' : 'mobile';
  const vp = (d.viewport && typeof d.viewport === 'object' ? d.viewport : {}) as Record<string, unknown>;
  const seen = new Set<string>();
  const pages: DesignPage[] = [];
  for (const p of Array.isArray(d.pages) ? d.pages : []) {
    const o = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
    const id = str(o.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const html = str(o.html) || null;
    pages.push({
      id,
      name: str(o.name) || id,
      ...(str(o.description) ? { description: str(o.description) } : {}),
      ...(str(o.agentId) ? { agentId: str(o.agentId) } : {}),
      html,
      status: html ? 'done' : 'pending',
      ...(typeof o.updatedAt === 'number' ? { updatedAt: o.updatedAt } : {}),
    });
  }
  const edgeKeys = new Set<string>();
  const edges: DesignEdge[] = [];
  for (const e of Array.isArray(d.edges) ? d.edges : []) {
    const o = (e && typeof e === 'object' ? e : {}) as Record<string, unknown>;
    const from = str(o.from);
    const to = str(o.to);
    if (!seen.has(from) || !seen.has(to) || from === to || edgeKeys.has(`${from}>${to}`)) continue;
    edgeKeys.add(`${from}>${to}`);
    edges.push({ from, to, ...(str(o.label) ? { label: str(o.label) } : {}) });
  }
  return {
    title: str(d.title) || '设计原型',
    platform,
    viewport: {
      width: num(vp.width, 280, 1920, platform === 'desktop' ? 1440 : 390),
      height: num(vp.height, 400, 1400, platform === 'desktop' ? 900 : 844),
    },
    pages,
    edges,
  };
}

/** The parsed doc plus a change stamp, or undefined when design.json is missing or not valid JSON. */
export async function readDesign(session: AgentSession): Promise<{ design: DesignDoc; stamp: string } | undefined> {
  const { abs } = await resolvePath(DESIGN_FILE, session);
  const stat = await fsp.stat(abs).catch(() => undefined);
  if (!stat?.isFile()) return undefined;
  try {
    const design = normalizeDesign(JSON.parse(await fsp.readFile(abs, 'utf8')));
    return { design, stamp: `${stat.mtimeMs}:${stat.size}` };
  } catch {
    return undefined;
  }
}

/** Sub-agents finish in parallel, so read-modify-write of design.json is serialized per session. */
const locks = new Map<string, Promise<unknown>>();
export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn);
  locks.set(key, run);
  void run.finally(() => locks.get(key) === run && locks.delete(key)).catch(() => undefined);
  return run;
}

export const updateDesignTool: AgentTool<{ page_id?: string; html?: string; links?: unknown }> = {
  definition: {
    type: 'function',
    function: {
      name: 'update_design',
      description:
        '页面实现完成后，把它登记到 design.json：填入该页面的 HTML 路径并标记为已完成，可同时登记该页面实际跳转到的其他页面。' +
        '多个子 agent 并行时也能安全写入，不要用 write_file / edit_file 直接修改 design.json 来登记页面。',
      parameters: {
        type: 'object',
        properties: {
          page_id: { type: 'string', description: 'design.json 中的页面 ID，例如 "home"' },
          html: { type: 'string', description: '页面 HTML 文件路径，相对工作区根目录，例如 "pages/home.html"' },
          links: {
            type: 'array',
            items: { type: 'object', properties: { to: { type: 'string' }, label: { type: 'string' } }, required: ['to'] },
            description: '该页面实际跳转到的页面，to 是目标页面 ID，label 是触发方式（如"点击活动卡片"）；已存在的连线不会重复添加',
          },
        },
        required: ['page_id', 'html'],
      },
    },
  },
  async execute(args, ctx) {
    const session = requireSession(ctx);
    const pageId = str(args.page_id);
    const html = str(args.html).replace(/^\/workspace\/+/, '').replace(/^\.\//, '');
    if (!pageId || !html) throw new Error('缺少 page_id 或 html');
    const { abs } = await resolvePath(html, session);
    if (!(await fsp.stat(abs).catch(() => undefined))?.isFile()) throw new Error(`文件不存在：${html}，请先写好页面再登记`);

    return withLock(session.id, async () => {
      const current = await readDesign(session);
      if (!current) throw new Error('design.json 不存在或不是合法的 JSON，请让主 agent 先生成 design.json');
      const { design } = current;
      const page = design.pages.find((p) => p.id === pageId);
      if (!page) throw new Error(`design.json 中没有页面「${pageId}」，可用的页面 ID：${design.pages.map((p) => p.id).join('、')}`);
      page.html = html;
      page.status = 'done';
      page.updatedAt = Date.now();

      const ids = new Set(design.pages.map((p) => p.id));
      const added: string[] = [];
      const skipped: string[] = [];
      for (const l of Array.isArray(args.links) ? args.links : []) {
        const o = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
        const to = str(o.to);
        if (!to || to === pageId) continue;
        if (!ids.has(to)) {
          skipped.push(to);
          continue;
        }
        if (design.edges.some((e) => e.from === pageId && e.to === to)) continue;
        design.edges.push({ from: pageId, to, ...(str(o.label) ? { label: str(o.label) } : {}) });
        added.push(to);
      }

      await fsp.writeFile((await resolvePath(DESIGN_FILE, session)).abs, `${JSON.stringify(design, null, 2)}\n`, 'utf8');
      const done = design.pages.filter((p) => p.status === 'done').length;
      return {
        content: JSON.stringify({
          ok: true,
          page: pageId,
          html,
          addedLinks: added,
          ...(skipped.length ? { unknownPages: skipped } : {}),
          progress: `${done}/${design.pages.length}`,
        }),
        summary: `${page.name} 已登记 · ${done}/${design.pages.length}`,
      };
    });
  },
};
