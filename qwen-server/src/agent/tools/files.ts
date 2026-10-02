import fsp from 'node:fs/promises';
import path from 'node:path';
import type { OutputFile } from '../../types.js';
import type { AgentSession, AgentTool } from './types.js';
import { displayPath, requireSession, resolvePath } from './workspace.js';

const MAX_READ_CHARS = 60_000;
const MAX_WRITE_BYTES = 2 * 1024 * 1024;
const MAX_LIST_ENTRIES = 500;
const MAX_SEARCH_RESULTS = 200;
const MAX_SCANNED_ENTRIES = 50_000;
const MAX_SEARCHABLE_BYTES = 1024 * 1024;
const SEARCH_TIMEOUT = 15_000;
const PREVIEW_CHARS = 4000;
const SKIP_DIRS = new Set(['.git', 'node_modules']);

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const preview = (s: string) => (s.length > PREVIEW_CHARS ? `${s.slice(0, PREVIEW_CHARS)}\n…` : s);

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Decodes a file as UTF-8, or returns undefined for binary content (NUL bytes). */
async function readText(abs: string, maxBytes = Infinity): Promise<string | undefined> {
  const stat = await fsp.stat(abs);
  if (stat.size > maxBytes) return undefined;
  const buf = await fsp.readFile(abs);
  return buf.includes(0) ? undefined : buf.toString('utf8');
}

async function statOrThrow(abs: string, shown: string) {
  try {
    return await fsp.stat(abs);
  } catch {
    throw new Error(`文件或目录不存在：${shown}`);
  }
}

export const listDirTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'list_dir',
      description: '列出工作区中某个目录下的文件和子目录（名称、类型、大小）。先用它了解目录结构，再读写文件。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '目录路径，相对工作区根目录；省略表示根目录' } },
      },
    },
  },
  async execute({ path: p }, ctx) {
    const { root, abs } = await resolvePath(p, requireSession(ctx));
    const shown = displayPath(abs, root);
    if (!(await statOrThrow(abs, shown)).isDirectory()) throw new Error(`不是目录：${shown}`);
    const entries = (await fsp.readdir(abs, { withFileTypes: true })).sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name),
    );
    const items = await Promise.all(
      entries.slice(0, MAX_LIST_ENTRIES).map(async (e) => {
        const isDir = e.isDirectory();
        const size = isDir ? undefined : (await fsp.stat(path.join(abs, e.name)).catch(() => undefined))?.size;
        return { name: e.name, type: isDir ? 'dir' : 'file', ...(size !== undefined ? { size } : {}) };
      }),
    );
    const truncated = entries.length > MAX_LIST_ENTRIES;
    return {
      summary: `${entries.length} 项`,
      output: items.map((i) => (i.type === 'dir' ? `${i.name}/` : i.name)).join('\n') || '（空目录）',
      content: JSON.stringify({ path: shown, total: entries.length, truncated, items }),
    };
  },
};

export const readFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取工作区中的文本文件内容。大文件可用 start_line / end_line 分段读取。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，相对工作区根目录' },
          start_line: { type: 'integer', description: '起始行号（从 1 开始，含），默认 1' },
          end_line: { type: 'integer', description: '结束行号（含），默认读到文件末尾' },
        },
        required: ['path'],
      },
    },
  },
  async execute({ path: p, start_line, end_line }, ctx) {
    const { root, abs } = await resolvePath(p, requireSession(ctx));
    const shown = displayPath(abs, root);
    if ((await statOrThrow(abs, shown)).isDirectory()) throw new Error(`这是目录，请用 list_dir：${shown}`);
    const text = await readText(abs);
    if (text === undefined) throw new Error(`二进制文件无法读取：${shown}`);
    const lines = text.split('\n');
    const start = Math.max(1, Number(start_line) || 1);
    const end = Math.min(lines.length, Number(end_line) || lines.length);
    let content = lines.slice(start - 1, end).join('\n');
    const truncated = content.length > MAX_READ_CHARS;
    if (truncated) content = content.slice(0, MAX_READ_CHARS);
    return {
      summary: `第 ${start}-${end} 行，共 ${lines.length} 行`,
      output: preview(content),
      content: JSON.stringify({
        path: shown,
        totalLines: lines.length,
        startLine: start,
        endLine: end,
        ...(truncated ? { truncated: true, hint: '内容过长已截断，请用 start_line/end_line 分段读取' } : {}),
        content,
      }),
    };
  },
};

export const writeFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'write_file',
      description: '在工作区中新建文件或整体覆盖已有文件，父目录不存在时自动创建。只改动局部内容时优先用 edit_file。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，相对工作区根目录' },
          content: { type: 'string', description: '完整的文件内容' },
        },
        required: ['path', 'content'],
      },
    },
  },
  async execute({ path: p, content }, ctx) {
    const { root, abs } = await resolvePath(p, requireSession(ctx));
    const shown = displayPath(abs, root);
    const text = str(content);
    const bytes = Buffer.byteLength(text);
    if (bytes > MAX_WRITE_BYTES) throw new Error(`内容过大（${formatSize(bytes)}），单次最多写入 ${formatSize(MAX_WRITE_BYTES)}`);
    const existed = await fsp.stat(abs).then((s) => {
      if (s.isDirectory()) throw new Error(`已存在同名目录：${shown}`);
      return true;
    }, () => false);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, text, 'utf8');
    return {
      summary: `${existed ? '已覆盖' : '已创建'}，${formatSize(bytes)}`,
      output: preview(text),
      content: JSON.stringify({ path: shown, created: !existed, bytes }),
    };
  },
};

export const editFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'edit_file',
      description:
        '修改工作区中已有文件的局部内容：把 old_string 精确替换为 new_string。old_string 必须与文件内容逐字一致（含缩进和换行），' +
        '且默认必须在文件中唯一出现；不唯一时请带上更多上下文，或设置 replace_all。修改前先用 read_file 查看原文。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，相对工作区根目录' },
          old_string: { type: 'string', description: '要被替换的原文' },
          new_string: { type: 'string', description: '替换后的内容' },
          replace_all: { type: 'boolean', description: '是否替换所有出现的位置，默认 false' },
        },
        required: ['path', 'old_string', 'new_string'],
      },
    },
  },
  async execute({ path: p, old_string, new_string, replace_all }, ctx) {
    const { root, abs } = await resolvePath(p, requireSession(ctx));
    const shown = displayPath(abs, root);
    if ((await statOrThrow(abs, shown)).isDirectory()) throw new Error(`这是目录：${shown}`);
    const oldStr = str(old_string);
    const newStr = str(new_string);
    if (!oldStr) throw new Error('old_string 不能为空；新建文件请用 write_file');
    if (oldStr === newStr) throw new Error('old_string 与 new_string 相同，无需修改');
    const text = await readText(abs);
    if (text === undefined) throw new Error(`二进制文件无法编辑：${shown}`);
    const count = text.split(oldStr).length - 1;
    if (count === 0) throw new Error('文件中找不到 old_string，请先用 read_file 确认原文');
    if (count > 1 && replace_all !== true) throw new Error(`old_string 在文件中出现了 ${count} 次，请提供更多上下文使其唯一，或设置 replace_all`);
    const next = replace_all === true ? text.split(oldStr).join(newStr) : text.replace(oldStr, () => newStr);
    await fsp.writeFile(abs, next, 'utf8');
    const replaced = replace_all === true ? count : 1;
    return {
      summary: `替换 ${replaced} 处`,
      output: preview(`- ${oldStr.split('\n').join('\n- ')}\n+ ${newStr.split('\n').join('\n+ ')}`),
      content: JSON.stringify({ path: shown, replaced }),
    };
  },
};

export const deleteFileTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'delete_file',
      description: '删除工作区中的文件或目录（目录会连同内容一起删除，不可恢复）。只在用户明确要求删除时使用。',
      parameters: {
        type: 'object',
        properties: {
          paths: { type: 'array', items: { type: 'string' }, description: '要删除的文件或目录路径列表，相对工作区根目录' },
        },
        required: ['paths'],
      },
    },
  },
  async execute({ paths }, ctx) {
    const session = requireSession(ctx);
    const list = Array.isArray(paths) ? paths.map(str).filter(Boolean) : [];
    if (!list.length) throw new Error('缺少要删除的路径');
    // Validate every path before deleting anything, so a bad path can't leave the batch half done.
    const resolved = await Promise.all(list.map((p) => resolvePath(p, session)));
    const root = resolved[0].root;
    const targets = resolved.map((r) => r.abs);
    for (const abs of targets) {
      if (abs === root) throw new Error('不能删除工作区根目录');
      await statOrThrow(abs, displayPath(abs, root));
    }
    for (const abs of targets) await fsp.rm(abs, { recursive: true, force: true });
    const shown = targets.map((abs) => displayPath(abs, root));
    return {
      summary: `已删除 ${shown.length} 项`,
      output: shown.join('\n'),
      content: JSON.stringify({ deleted: shown }),
    };
  },
};

/** Glob to regex: `**` spans directories, `*` and `?` don't. */
function globToRegExp(glob: string) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if ('\\^$.|+()[]{}'.includes(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export const searchFilesTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'search_files',
      description:
        '在工作区中搜索文件：按文件名 glob 匹配（如 "**/*.ts"），和/或按文件内容关键字匹配并返回命中的行。自动跳过 .git 和 node_modules。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '搜索的起始目录，相对工作区根目录；省略表示根目录' },
          glob: { type: 'string', description: '文件路径的 glob 模式（相对起始目录），如 "**/*.md"；省略表示所有文件' },
          query: { type: 'string', description: '要在文件内容中查找的文本；省略则只按文件名匹配' },
          regex: { type: 'boolean', description: 'query 是否为正则表达式，默认 false' },
        },
      },
    },
  },
  async execute({ path: p, glob, query, regex }, ctx) {
    const { signal } = ctx;
    const { root, abs: base } = await resolvePath(p, requireSession(ctx));
    if (!(await statOrThrow(base, displayPath(base, root))).isDirectory()) throw new Error('起始路径不是目录');
    const nameRe = str(glob) ? globToRegExp(str(glob)) : undefined;
    const q = str(query);
    let match: ((line: string) => boolean) | undefined;
    if (q && regex === true) {
      let re: RegExp;
      try {
        re = new RegExp(q);
      } catch {
        throw new Error(`正则表达式不合法：${q}`);
      }
      match = (line) => re.test(line);
    } else if (q) match = (line) => line.includes(q);

    const deadline = Date.now() + SEARCH_TIMEOUT;
    const results: { path: string; lines?: { line: number; text: string }[] }[] = [];
    const stack = [''];
    let scanned = 0;
    let incomplete = false;
    // Explicit stack instead of recursion; limits are checked inside the loop so a huge tree actually stops scanning.
    walk: while (stack.length) {
      const rel = stack.pop()!;
      const entries = await fsp.readdir(path.join(base, rel), { withFileTypes: true }).catch(() => []);
      for (const e of entries) {
        if (signal.aborted) throw new Error('已取消');
        if (++scanned > MAX_SCANNED_ENTRIES || Date.now() > deadline) {
          incomplete = true;
          break walk;
        }
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) stack.push(child);
          continue;
        }
        if (!e.isFile() || (nameRe && !nameRe.test(child))) continue;
        const shown = displayPath(path.join(base, child), root);
        if (!match) results.push({ path: shown });
        else {
          const text = await readText(path.join(base, child), MAX_SEARCHABLE_BYTES).catch(() => undefined);
          if (text === undefined) continue;
          const lines: { line: number; text: string }[] = [];
          text.split('\n').forEach((l, i) => {
            if (lines.length < 20 && match!(l)) lines.push({ line: i + 1, text: l.slice(0, 300) });
          });
          if (lines.length) results.push({ path: shown, lines });
        }
        if (results.length >= MAX_SEARCH_RESULTS) {
          incomplete = true;
          break walk;
        }
      }
    }
    return {
      summary: `${results.length} 个文件${incomplete ? '（结果不完整）' : ''}`,
      output: results.map((r) => r.lines ? r.lines.map((l) => `${r.path}:${l.line}: ${l.text}`).join('\n') : r.path).join('\n') || '（无匹配）',
      content: JSON.stringify({ total: results.length, incomplete, results }),
    };
  },
};

export const fileTools = [listDirTool, readFileTool, writeFileTool, editFileTool, deleteFileTool, searchFilesTool];

/** Deliverable document types that get a file card when a turn creates or changes them; scripts and data files don't. */
export const OUTPUT_FILE_RE = /\.(md|markdown|html?|pptx?|docx?|xlsx?|csv|pdf)$|^design\.json$/i;
const SNAPSHOT_SKIP = new Set(['node_modules', '__pycache__', 'venv', '.venv', 'dist', 'build']);
const SNAPSHOT_MAX_DEPTH = 4;
const SNAPSHOT_MAX_ENTRIES = 5000;

/** Deliverable files in the work dir mapped to a change stamp (mtime + size), for diffing before and after a turn. */
export async function snapshotOutputs(session: AgentSession): Promise<Map<string, string>> {
  const { root } = await resolvePath('.', session);
  const out = new Map<string, string>();
  let seen = 0;
  const walk = async (dir: string, depth: number) => {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (++seen > SNAPSHOT_MAX_ENTRIES) return;
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < SNAPSHOT_MAX_DEPTH && !SNAPSHOT_SKIP.has(e.name)) await walk(abs, depth + 1);
      } else if (e.isFile() && OUTPUT_FILE_RE.test(e.name)) {
        const stat = await fsp.stat(abs).catch(() => undefined);
        if (stat) out.set(displayPath(abs, root), `${stat.mtimeMs}:${stat.size}`);
      }
    }
  };
  await walk(root, 0);
  return out;
}

/** Current metadata of a file in the session's work dir, or undefined if it no longer exists. */
export async function describeFile(session: AgentSession, rel: string): Promise<OutputFile | undefined> {
  const { root, abs } = await resolvePath(rel, session);
  const stat = await fsp.stat(abs).catch(() => undefined);
  if (!stat?.isFile()) return undefined;
  return {
    path: displayPath(abs, root),
    name: path.basename(abs),
    size: stat.size,
    // birthtime is 0 on filesystems that don't record it.
    createdAt: Math.floor(stat.birthtimeMs || stat.ctimeMs),
    updatedAt: Math.floor(stat.mtimeMs),
  };
}

const MAX_PREVIEW_BYTES = 1024 * 1024;

/** Absolute path of an existing file in the work dir, for downloads. */
export async function outputFilePath(session: AgentSession, rel: string) {
  const file = await describeFile(session, rel);
  if (!file) return undefined;
  const { abs } = await resolvePath(rel, session);
  return { file, abs };
}

export async function readOutputFile(session: AgentSession, rel: string) {
  const file = await describeFile(session, rel);
  if (!file) return undefined;
  if (file.size > MAX_PREVIEW_BYTES) throw new Error(`文件过大（${formatSize(file.size)}），无法预览`);
  const { abs } = await resolvePath(rel, session);
  const content = await readText(abs);
  if (content === undefined) throw new Error('二进制文件无法预览');
  return { file, content };
}
