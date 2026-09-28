import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

export const env = {
  port: Number(process.env.PORT ?? 3001),
  deepseekKey: process.env.DEEPSEEK_API_KEY ?? '',
  deepseekBase: (process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com').replace(/\/+$/, ''),
  deepseekModel: process.env.DEEPSEEK_MODEL ?? 'deepseek-flash',
};
