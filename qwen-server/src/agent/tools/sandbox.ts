import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fsp from 'node:fs/promises';
import { promisify } from 'node:util';
import { env } from '../../env.js';
import type { AgentSession } from './types.js';
import { ensureSessionDir, forgetSessionDir } from './workspace.js';

const run = promisify(execFile);

const IDLE_STOP_MS = 30 * 60_000;
const REAP_INTERVAL_MS = 5 * 60_000;
const DOCKER_TIMEOUT_MS = 60_000;
/** Inside the container; one pid file per job so kill can find the job's process group. */
const PID_DIR = '/tmp/qwen-jobs';

export type SandboxMode = 'docker' | 'host';

const docker = (args: string[], timeout = DOCKER_TIMEOUT_MS) => run('docker', args, { timeout });
const containerName = (session: AgentSession) => `qwen-sbx-${session.id}`;

let detected: SandboxMode | undefined;
let detecting: Promise<SandboxMode> | undefined;

/** Decides once per process whether commands run in Docker containers or directly on the host. */
export function sandboxMode(): Promise<SandboxMode> {
  detecting ??= (async (): Promise<SandboxMode> => {
    if (env.agentSandbox === 'none') return 'host';
    try {
      await docker(['version', '--format', '{{.Server.Version}}'], 10_000);
      await docker(['image', 'inspect', env.sandboxImage], 10_000).catch(() => {
        throw new Error(`找不到沙箱镜像 ${env.sandboxImage}，请先执行 docker build -t ${env.sandboxImage} qwen-server/sandbox`);
      });
      return 'docker';
    } catch (err) {
      const reason = err instanceof Error ? err.message.split('\n')[0] : String(err);
      if (env.agentSandbox === 'docker') throw new Error(`Docker 沙箱不可用：${reason}`);
      console.warn(`[sandbox] Docker 不可用，终端命令将直接在宿主机的对话目录中执行（没有隔离）：${reason}`);
      return 'host';
    }
  })().then((mode) => {
    detected = mode;
    console.log(`[sandbox] mode=${mode}${mode === 'docker' ? ` image=${env.sandboxImage} network=${env.sandboxNetwork}` : ''}`);
    return mode;
  });
  // A failed forced-docker check is retried on the next call, so fixing Docker doesn't need a server restart.
  detecting.catch(() => (detecting = undefined));
  return detecting;
}

/** Best guess before detection finishes; used to describe the environment in the system prompt. */
export const isSandboxed = () => (detected ? detected === 'docker' : env.agentSandbox !== 'none');

const lastUsed = new Map<string, number>();
const activeExecs = new Map<string, number>();
const starting = new Map<string, Promise<void>>();

/** Creates the session's container, or starts it again if the idle reaper stopped it. */
function ensureContainer(session: AgentSession): Promise<void> {
  let p = starting.get(session.id);
  if (!p) {
    p = (async () => {
      const name = containerName(session);
      const state = await docker(['inspect', '-f', '{{.State.Running}}', name]).then((r) => r.stdout.trim(), () => 'missing');
      if (state === 'true') return;
      if (state === 'false') {
        await docker(['start', name]);
        return;
      }
      const dir = await ensureSessionDir(session);
      const uid = process.getuid?.() ?? 1000;
      const gid = process.getgid?.() ?? 1000;
      await docker([
        'run', '-d', '--init',
        '--name', name,
        '--label', 'qwen.sandbox=1',
        '--label', `qwen.session=${session.id}`,
        '-v', `${dir}:/workspace`,
        '-w', '/workspace',
        // Same uid as the server, so files created in the container stay editable by the file tools on the host.
        '--user', `${uid}:${gid}`,
        '-e', 'HOME=/tmp',
        '--network', env.sandboxNetwork,
        '--memory', '1g',
        '--cpus', '1',
        '--pids-limit', '256',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        env.sandboxImage,
        'sleep', 'infinity',
      ]);
      console.log(`[sandbox] started ${name}`);
    })().finally(() => starting.delete(session.id));
    starting.set(session.id, p);
  }
  return p;
}

/**
 * Runs a command in the session's container. `setsid` gives it its own process group whose id is written to a pid
 * file, because killing the host-side `docker exec` client would leave the process inside the container running.
 */
export async function execInContainer(session: AgentSession, jobId: string, command: string, cwd: string): Promise<ChildProcess> {
  await ensureContainer(session);
  const script = `mkdir -p ${PID_DIR} && echo $$ > ${PID_DIR}/${jobId}.pid && exec sh -c "$1"`;
  const child = spawn('docker', ['exec', '-w', cwd, containerName(session), 'setsid', '-w', 'sh', '-c', script, 'qwen-job', command], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  lastUsed.set(session.id, Date.now());
  activeExecs.set(session.id, (activeExecs.get(session.id) ?? 0) + 1);
  child.once('close', () => {
    lastUsed.set(session.id, Date.now());
    activeExecs.set(session.id, Math.max(0, (activeExecs.get(session.id) ?? 1) - 1));
  });
  return child;
}

export async function killInContainer(session: AgentSession, jobId: string, signal: NodeJS.Signals) {
  const sig = signal.replace(/^SIG/, '');
  await docker([
    'exec', containerName(session), 'sh', '-c',
    `p=$(cat ${PID_DIR}/${jobId}.pid 2>/dev/null) && kill -${sig} -"$p" 2>/dev/null; true`,
  ]).catch(() => undefined);
}

type DisposeHook = (session: AgentSession) => void | Promise<void>;
const disposeHooks: DisposeHook[] = [];

/** Lets other modules (the terminal job registry) clean up their per-session state when a session is disposed. */
export function onDispose(hook: DisposeHook) {
  disposeHooks.push(hook);
}

/** Removes everything a conversation's agent left behind: running jobs, its container and its work dir. */
export async function disposeSession(session: AgentSession) {
  for (const hook of disposeHooks) await Promise.resolve(hook(session)).catch(() => undefined);
  if (detected === 'docker' || (await sandboxMode().catch(() => 'host')) === 'docker') {
    await docker(['rm', '-f', containerName(session)]).catch(() => undefined);
  }
  await fsp.rm(session.dir, { recursive: true, force: true }).catch(() => undefined);
  forgetSessionDir(session);
  lastUsed.delete(session.id);
  activeExecs.delete(session.id);
  console.log(`[sandbox] disposed ${session.id}`);
}

/** Stops containers that have been idle for a while; their files stay, and the next command starts them again. */
async function reapIdle() {
  const now = Date.now();
  for (const [id, at] of lastUsed) {
    if ((activeExecs.get(id) ?? 0) > 0 || now - at < IDLE_STOP_MS) continue;
    lastUsed.delete(id);
    await docker(['stop', '-t', '2', `qwen-sbx-${id}`]).catch(() => undefined);
    console.log(`[sandbox] stopped idle qwen-sbx-${id}`);
  }
}

setInterval(() => {
  if (detected === 'docker') reapIdle().catch(() => undefined);
}, REAP_INTERVAL_MS).unref();

sandboxMode().catch((err) => console.warn(`[sandbox] ${err instanceof Error ? err.message : err}`));
