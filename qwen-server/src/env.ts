import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const serverRoot = fileURLToPath(new URL('..', import.meta.url));

export const env = {
  port: Number(process.env.PORT ?? 3001),
  deepseekKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekBase: (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
  qwenKey: process.env.QWEN_API_KEY ?? '',
  qwenBase: (process.env.QWEN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').replace(/\/+$/, ''),
  agentWorkspace: path.resolve(serverRoot, process.env.AGENT_WORKSPACE || 'workspace'),
  skillsDir: path.resolve(serverRoot, process.env.AGENT_SKILLS_DIR || 'skills'),
  /** auto: use Docker when available, else run on the host; docker: require Docker; none: always run on the host. */
  agentSandbox: (['auto', 'docker', 'none'].includes(process.env.AGENT_SANDBOX ?? '') ? process.env.AGENT_SANDBOX : 'auto') as 'auto' | 'docker' | 'none',
  sandboxImage: process.env.AGENT_SANDBOX_IMAGE || 'qwen-sandbox',
  sandboxNetwork: process.env.AGENT_SANDBOX_NETWORK || 'none',
};
