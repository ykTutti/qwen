import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execInContainer, killInContainer, onDispose, sandboxMode, type SandboxMode } from './sandbox.js';
import type { AgentSession, AgentTool } from './types.js';
import { displayPath, requireSession, resolvePath } from './workspace.js';

const DEFAULT_WAIT_MS = 30_000;
const MAX_WAIT_MS = 10 * 60_000;
const OUTPUT_CHARS = 10_000;
const PREVIEW_CHARS = 4000;
const MAX_JOBS = 50;
const LOG_DIR = path.join(os.tmpdir(), 'qwen-agent-jobs');
/** Env vars stripped from host-mode child processes so a command like `env` can't leak server secrets to the model. */
const SECRET_ENV = /KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i;

interface Job {
  id: string;
  session: AgentSession;
  mode: SandboxMode;
  command: string;
  /** Working dir relative to the session root. */
  cwd: string;
  pid?: number;
  running: boolean;
  exitCode?: number;
  signal?: string;
  logPath: string;
  startedAt: number;
  endedAt?: number;
  exited: Promise<void>;
}

const jobs = new Map<string, Job>();
let seq = 0;

function hostEnv() {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!SECRET_ENV.test(k)) out[k] = v;
  return out;
}

async function startJob(session: AgentSession, command: string, hostCwd: string, relCwd: string): Promise<Job> {
  const mode = await sandboxMode();
  await fsp.mkdir(LOG_DIR, { recursive: true });
  const id = `cmd_${Date.now().toString(36)}_${++seq}`;
  const logPath = path.join(LOG_DIR, `${id}.log`);
  let child: ChildProcess;
  if (mode === 'docker') {
    child = await execInContainer(session, id, command, relCwd === '.' ? '/workspace' : path.posix.join('/workspace', relCwd.split(path.sep).join('/')));
  } else {
    child = spawn(process.env.SHELL || '/bin/sh', ['-c', command], {
      cwd: hostCwd,
      env: hostEnv(),
      // Own process group, so kill can take down the shell and everything it spawned.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  }
  // Output goes to a file rather than memory because its size is unbounded (think `npm run dev`).
  const log = fs.createWriteStream(logPath);
  child.stdout!.pipe(log, { end: false });
  child.stderr!.pipe(log, { end: false });

  const job: Job = {
    id, session, mode, command, cwd: relCwd, pid: child.pid, running: true, logPath, startedAt: Date.now(), exited: Promise.resolve(),
  };
  job.exited = new Promise((resolve) => {
    const finish = (code: number | null, signal: NodeJS.Signals | null) => {
      if (!job.running) return;
      job.running = false;
      job.exitCode = code ?? -1;
      if (signal) job.signal = signal;
      job.endedAt = Date.now();
      log.end(resolve);
    };
    child.on('close', finish);
    child.on('error', (err) => {
      log.write(`${err.message}\n`);
      finish(-1, null);
    });
  });
  jobs.set(id, job);
  pruneJobs();
  return job;
}

function pruneJobs() {
  for (const job of jobs.values()) {
    if (jobs.size <= MAX_JOBS) return;
    if (!job.running) dropJob(job);
  }
}

function dropJob(job: Job) {
  jobs.delete(job.id);
  fsp.rm(job.logPath, { force: true }).catch(() => undefined);
}

async function signalJob(job: Job, signal: NodeJS.Signals) {
  if (!job.running) return;
  if (job.mode === 'docker') {
    await killInContainer(job.session, job.id, signal);
    return;
  }
  if (job.pid === undefined) return;
  try {
    process.kill(-job.pid, signal);
  } catch {}
}

async function killJob(job: Job) {
  if (!job.running) return;
  const never = new AbortController().signal;
  await signalJob(job, 'SIGTERM');
  await wait(job, 2000, never);
  await signalJob(job, 'SIGKILL');
  await wait(job, 1000, never);
}

onDispose(async (session) => {
  const owned = [...jobs.values()].filter((j) => j.session.id === session.id);
  // Container jobs die with `docker rm -f`; host jobs have to be killed here.
  await Promise.all(owned.filter((j) => j.mode === 'host').map(killJob));
  owned.forEach(dropJob);
});

/** Jobs are scoped to their conversation: another conversation's command id is treated as unknown. */
function getJob(id: unknown, session: AgentSession) {
  const job = jobs.get(String(id ?? ''));
  if (!job || job.session.id !== session.id) throw new Error(`找不到命令：${String(id ?? '')}`);
  return job;
}

/** Waits for the job to exit, for at most `ms`. A timeout does not kill it — a slow build isn't a dead one. */
async function wait(job: Job, ms: number, signal: AbortSignal) {
  if (!job.running || ms <= 0 || signal.aborted) return;
  let timer: NodeJS.Timeout | undefined;
  let onAbort: (() => void) | undefined;
  await Promise.race([
    job.exited,
    new Promise<void>((r) => {
      timer = setTimeout(r, ms);
    }),
    new Promise<void>((r) => {
      onAbort = () => r();
      signal.addEventListener('abort', onAbort, { once: true });
    }),
  ]);
  clearTimeout(timer);
  if (onAbort) signal.removeEventListener('abort', onAbort);
}

async function report(job: Job, skipChars = 0) {
  const raw = await fsp.readFile(job.logPath, 'utf8').catch(() => '');
  const rest = raw.slice(Math.max(0, skipChars));
  const truncated = rest.length > OUTPUT_CHARS;
  const output = truncated ? rest.slice(-OUTPUT_CHARS) : rest;
  const seconds = (((job.endedAt ?? Date.now()) - job.startedAt) / 1000).toFixed(1);
  const status = job.running ? 'running' : 'exited';
  // `docker exec` reports a signal death as exit code 128 + signal number rather than as a signal.
  const killed = job.signal ?? (job.mode === 'docker' && (job.exitCode === 143 || job.exitCode === 137) ? (job.exitCode === 143 ? 'SIGTERM' : 'SIGKILL') : undefined);
  return {
    summary: job.running ? `运行中（${seconds}s）` : `${killed ? `已终止（${killed}）` : `退出码 ${job.exitCode}`}，用时 ${seconds}s`,
    output: (truncated ? '…\n' : '') + (output.length > PREVIEW_CHARS ? output.slice(-PREVIEW_CHARS) : output) || '（无输出）',
    content: JSON.stringify({
      command_id: job.id,
      command: job.command,
      cwd: job.cwd,
      status,
      ...(job.running ? { hint: '命令仍在后台运行，可用 check_command 查看后续输出，或用 kill_command 终止' } : { exit_code: job.exitCode }),
      ...(killed ? { signal: killed } : {}),
      total_chars: raw.length,
      ...(truncated ? { truncated: true, note: `输出过长，只保留最后 ${OUTPUT_CHARS} 个字符` } : {}),
      output,
    }),
  };
}

export const runCommandTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        '在本对话专属的 Linux 沙箱中执行 shell 命令，工作目录默认是工作区根目录 /workspace。命令会等待结束后返回输出和退出码；超过 wait_ms 仍未结束时先返回 command_id，' +
        '命令继续在后台运行，之后用 check_command 查看输出、kill_command 终止。启动开发服务器等长期运行的命令时，把 wait_ms 设小（如 3000）。' +
        '不要执行交互式命令（没有 stdin）；避免 rm -rf 等破坏性操作，除非用户明确要求。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的 shell 命令' },
          cwd: { type: 'string', description: '工作目录，相对工作区根目录；省略表示根目录' },
          wait_ms: { type: 'integer', description: `最多等待命令结束的毫秒数，默认 ${DEFAULT_WAIT_MS}，最大 ${MAX_WAIT_MS}` },
        },
        required: ['command'],
      },
    },
  },
  async execute({ command, cwd, wait_ms }, ctx) {
    const session = requireSession(ctx);
    const cmd = typeof command === 'string' ? command.trim() : '';
    if (!cmd) throw new Error('缺少要执行的命令');
    const { root, abs } = await resolvePath(cwd, session);
    if (!(await fsp.stat(abs).catch(() => undefined))?.isDirectory()) throw new Error(`工作目录不存在：${String(cwd ?? '')}`);
    const job = await startJob(session, cmd, abs, displayPath(abs, root));
    const ms = Math.min(Math.max(Number(wait_ms) || DEFAULT_WAIT_MS, 0), MAX_WAIT_MS);
    await wait(job, ms, ctx.signal);
    return report(job);
  },
};

export const checkCommandTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'check_command',
      description: '查看 run_command 启动的命令的状态和输出。可设置 wait_ms 等待一段时间再返回；用 skip_chars 跳过已看过的输出。',
      parameters: {
        type: 'object',
        properties: {
          command_id: { type: 'string', description: 'run_command 返回的 command_id' },
          wait_ms: { type: 'integer', description: '先等待命令结束的最长毫秒数，默认 0（立即返回）' },
          skip_chars: { type: 'integer', description: '跳过输出开头的字符数，传上次返回的 total_chars 即可只看新增输出' },
        },
        required: ['command_id'],
      },
    },
  },
  async execute({ command_id, wait_ms, skip_chars }, ctx) {
    const job = getJob(command_id, requireSession(ctx));
    await wait(job, Math.min(Math.max(Number(wait_ms) || 0, 0), MAX_WAIT_MS), ctx.signal);
    return report(job, Number(skip_chars) || 0);
  },
};

export const killCommandTool: AgentTool = {
  definition: {
    type: 'function',
    function: {
      name: 'kill_command',
      description: '终止 run_command 启动的仍在运行的命令（连同它启动的所有子进程）。',
      parameters: {
        type: 'object',
        properties: { command_id: { type: 'string', description: 'run_command 返回的 command_id' } },
        required: ['command_id'],
      },
    },
  },
  async execute({ command_id }, ctx) {
    const job = getJob(command_id, requireSession(ctx));
    await killJob(job);
    return report(job);
  },
};

export const terminalTools = [runCommandTool, checkCommandTool, killCommandTool];
