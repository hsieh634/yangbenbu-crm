import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

async function main() {
  // 環境變數載入後才匯入，確保設定讀到正確的值
  const { createApp } = await import('./bootstrap');
  const { env } = await import('./config/env');
  const app = await createApp();
  await app.listen({ port: env().API_PORT, host: '0.0.0.0' });
}

void main();
