import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '@yangbenbu/db';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * 每次測試建立一個全新、名稱唯一的資料庫：
 * 套用 migration（prisma migrate deploy，不會刪資料）→ 載入示範資料 → 測試 → 刪除這個暫時資料庫。
 * 測試不會碰到任何既有的資料庫。
 */
export default async function setup(project: TestProject) {
  const rootEnv = resolve(__dirname, '../../../.env');
  if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);
  const base = process.env.TEST_DATABASE_URL;
  if (!base)
    throw new Error('請設定 TEST_DATABASE_URL（測試會在同一台資料庫伺服器上建立暫時資料庫）');

  const dbName = `yangbenbu_test_${Date.now()}_${process.pid}`;
  const admin = new URL(base);
  admin.pathname = '/postgres';
  const testUrl = new URL(base);
  testUrl.pathname = `/${dbName}`;

  const maintenance = new PrismaClient({ datasourceUrl: admin.toString() });
  await maintenance.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);

  const dbDir = resolve(__dirname, '../../../packages/db');
  // minimal：不產生依執行時間而定的示範預約，測試結果穩定
  const env = { ...process.env, DATABASE_URL: testUrl.toString(), SEED_MODE: 'minimal' };
  execSync('pnpm exec prisma migrate deploy', { cwd: dbDir, env, stdio: 'pipe' });
  execSync('pnpm exec tsx prisma/seed.ts', { cwd: dbDir, env, stdio: 'pipe' });

  project.provide('databaseUrl', testUrl.toString());

  return async () => {
    await maintenance.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await maintenance.$disconnect();
  };
}
