import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../env.js';
import type { AgentSession, ToolContext } from './types.js';

const sessionsRoot = path.join(env.agentWorkspace, 'sessions');
const SESSION_ID_RE = /^[\w-]{1,64}$/;

export function sessionFor(id: string): AgentSession {
  if (!SESSION_ID_RE.test(id)) throw new Error(`invalid sandbox id: ${id}`);
  return { id, dir: path.join(sessionsRoot, id) };
}

export function requireSession(ctx: ToolContext): AgentSession {
  if (!ctx.session) throw new Error('该工具只能在工作模式中使用');
  return ctx.session;
}

const ready = new Map<string, Promise<string>>();

/** Creates the session's work dir on first use and returns its real path (symlinks resolved). */
export function ensureSessionDir(session: AgentSession) {
  let p = ready.get(session.id);
  if (!p) {
    p = fsp.mkdir(session.dir, { recursive: true }).then(() => fsp.realpath(session.dir));
    p.catch(() => ready.delete(session.id));
    ready.set(session.id, p);
  }
  return p;
}

export function forgetSessionDir(session: AgentSession) {
  ready.delete(session.id);
}

const inside = (root: string, target: string) => target === root || target.startsWith(root + path.sep);

/** Resolves the nearest existing ancestor through symlinks, so a link inside the work dir can't point outside it. */
async function realAncestor(target: string): Promise<string> {
  let cur = target;
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(await fsp.realpath(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return target;
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

/**
 * Maps a model-supplied path (relative to the work dir, or absolute) to an absolute host path inside the session's work dir.
 * `path.resolve` normalizes `..` segments before the prefix check; without it `a/../../etc` would slip through.
 * `/workspace/...` is accepted as an alias of the root, since that's where the model sees the dir from the terminal.
 */
export async function resolvePath(p: unknown, session: AgentSession): Promise<{ root: string; abs: string }> {
  const root = await ensureSessionDir(session);
  let raw = typeof p === 'string' ? p.trim() : '';
  if (raw === '/workspace' || raw.startsWith('/workspace/')) raw = raw.slice('/workspace'.length).replace(/^\/+/, '');
  const abs = path.resolve(root, raw || '.');
  if (!inside(root, abs) || !inside(root, await realAncestor(abs))) {
    throw new Error(`路径超出工作区范围：${raw}`);
  }
  return { root, abs };
}

/** Path relative to the work dir, as shown to the model and in the UI. */
export function displayPath(abs: string, root: string) {
  return path.relative(root, abs) || '.';
}
