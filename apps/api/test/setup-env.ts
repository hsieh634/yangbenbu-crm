import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { inject } from 'vitest';

const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
// 使用 global-setup 建立的暫時資料庫
process.env.DATABASE_URL = inject('databaseUrl');
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.WEB_ORIGIN = 'http://localhost:3000';
