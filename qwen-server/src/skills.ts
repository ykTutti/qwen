import fsp from 'node:fs/promises';
import path from 'node:path';
import { env } from './env.js';

/**
 * Agent skills in the standard layout: one directory per skill containing a SKILL.md whose
 * YAML front matter has `name` and `description`, followed by the instructions in Markdown.
 * Optional `metadata` keys used here: `title` (display name), `hidden` ("true" keeps it out of the
 * skills list) and `source` ("custom" for skills created by users through the agent).
 */
export interface SkillInfo {
  name: string;
  title: string;
  description: string;
  source: 'builtin' | 'custom';
  hidden: boolean;
  updatedAt: number;
}

export interface Skill extends SkillInfo {
  body: string;
}

export const SKILL_CREATOR = 'skill-creator';
/** The one skill design mode runs with; it is applied automatically and never offered in the work-mode library. */
export const DESIGN_SKILL = 'design';
export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_NAME = 64;
const MAX_DESCRIPTION = 1024;
const MAX_BODY_BYTES = 200 * 1024;

const skillFile = (name: string) => path.join(env.skillsDir, name, 'SKILL.md');

function unquote(v: string) {
  const t = v.trim();
  if (t.startsWith('"')) {
    try {
      return String(JSON.parse(t));
    } catch {
      return t.slice(1, -1);
    }
  }
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).replace(/''/g, "'");
  return t;
}

/** Parses the flat subset of YAML that skill front matter uses: scalars, block scalars and one level of nesting. */
export function parseFrontMatter(text: string): { data: Record<string, string | Record<string, string>>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | Record<string, string>> = {};
  const lines = m[1].split(/\r?\n/);
  let parent: Record<string, string> | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^(\s*)([\w.-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, key, raw] = kv;
    const target = indent && parent ? parent : data;
    if (!indent) parent = undefined;
    if (raw === '' && !indent) {
      parent = {};
      data[key] = parent;
      continue;
    }
    if (raw === '>' || raw === '|' || raw === '>-' || raw === '|-') {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || !lines[i + 1].trim())) block.push(lines[++i].trim());
      target[key] = block.join(raw.startsWith('>') ? ' ' : '\n').trim();
      continue;
    }
    target[key] = unquote(raw);
  }
  return { data, body: text.slice(m[0].length) };
}

async function readSkill(name: string): Promise<Skill | undefined> {
  if (!SKILL_NAME_RE.test(name) || name.length > MAX_NAME) return undefined;
  const file = skillFile(name);
  const [text, stat] = await Promise.all([fsp.readFile(file, 'utf8'), fsp.stat(file)]).catch(() => [undefined, undefined]);
  if (text === undefined || !stat) return undefined;
  const { data, body } = parseFrontMatter(text);
  const meta = typeof data.metadata === 'object' ? data.metadata : {};
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  if (str(data.name) !== name || !str(data.description)) return undefined;
  return {
    name,
    title: meta.title || name,
    description: str(data.description),
    source: meta.source === 'custom' ? 'custom' : 'builtin',
    hidden: meta.hidden === 'true',
    updatedAt: Math.floor(stat.mtimeMs),
    body: body.trim(),
  };
}

export async function listSkills(): Promise<SkillInfo[]> {
  const entries = await fsp.readdir(env.skillsDir, { withFileTypes: true }).catch(() => []);
  const skills = await Promise.all(entries.filter((e) => e.isDirectory()).map((e) => readSkill(e.name)));
  return skills
    .filter((s): s is Skill => !!s)
    .map(({ body: _body, ...info }) => info)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const getSkill = readSkill;

export async function saveSkill(input: { name: string; title: string; description: string; instructions: string; overwrite?: boolean }) {
  const name = input.name.trim();
  const title = input.title.trim() || name;
  const description = input.description.replace(/\s+/g, ' ').trim();
  const instructions = input.instructions.trim();
  if (!SKILL_NAME_RE.test(name) || name.length > MAX_NAME) {
    throw new Error('技能 name 只能使用小写字母、数字和连字符（如 weekly-report），最长 64 个字符');
  }
  if (!description) throw new Error('技能 description 不能为空');
  if (description.length > MAX_DESCRIPTION) throw new Error(`技能 description 最长 ${MAX_DESCRIPTION} 个字符`);
  if (!instructions) throw new Error('技能 instructions 不能为空');
  if (Buffer.byteLength(instructions) > MAX_BODY_BYTES) throw new Error('技能说明过长');

  const existing = await readSkill(name);
  const occupied = existing || (await fsp.stat(path.join(env.skillsDir, name)).then(() => true, () => false));
  if (occupied) {
    if (!existing || existing.source !== 'custom') throw new Error(`「${name}」是系统保留的技能名，请换一个 name`);
    if (!input.overwrite) throw new Error(`技能「${name}」已存在；如需更新请先和用户确认，再设置 overwrite 为 true`);
  }

  const content = [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    'metadata:',
    `  title: ${JSON.stringify(title)}`,
    '  source: custom',
    '---',
    '',
    instructions,
    '',
  ].join('\n');
  await fsp.mkdir(path.dirname(skillFile(name)), { recursive: true });
  await fsp.writeFile(skillFile(name), content, 'utf8');
  return { skill: (await readSkill(name))!, content, updated: !!existing };
}
