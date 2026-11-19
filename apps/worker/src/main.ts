import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient, checkRlsEnforced } from '@yangbenbu/db';
import PgBoss from 'pg-boss';
import { JOBS } from './jobs';
import type { JobContext } from './jobs/types';

const rootEnv = resolve(__dirname, '../../../.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

function log(message: string, data?: Record<string, unknown>) {
  console.log(
    JSON.stringify({ time: new Date().toISOString(), service: 'worker', message, ...data }),
  );
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL 未設定');

  const prisma = new PrismaClient();
  const { ok, role } = await checkRlsEnforced(prisma);
  if (!ok) log('警告：資料庫角色會繞過 RLS', { role });

  // pg-boss 以 PostgreSQL 當佇列（獨立的 pgboss schema），不需要另外架 Redis
  const boss = new PgBoss({ connectionString, schema: 'pgboss' });
  boss.on('error', (err) => log('pg-boss 錯誤', { error: err.message }));
  await boss.start();

  const ctx: JobContext = { boss, prisma, log };
  const jobs = JOBS.filter((j) => j.enabled?.() ?? true);
  for (const job of jobs) {
    await boss.createQueue(job.name);
    await boss.work(job.name, async () => {
      const started = Date.now();
      await job.handler(ctx);
      log('工作完成', { job: job.name, ms: Date.now() - started });
    });
    if (job.cron) await boss.schedule(job.name, job.cron, undefined, { tz: 'Asia/Taipei' });
  }
  // 停用的排程工作要從 pg-boss 移除，否則之前註冊過的排程仍會觸發
  for (const job of JOBS.filter((j) => !jobs.includes(j) && j.cron)) {
    await boss.unschedule(job.name).catch(() => {});
  }
  log('Worker 啟動', { jobs: jobs.map((j) => j.name) });

  // 開發時可用 `pnpm --filter @yangbenbu/worker dev -- --run-now <job>` 立即執行一次
  const runNow = process.argv.indexOf('--run-now');
  if (runNow !== -1) {
    const name = process.argv[runNow + 1];
    const job = jobs.find((j) => j.name === name);
    if (!job) throw new Error(`找不到工作 ${name}`);
    await boss.send(job.name, {});
  }

  const shutdown = async () => {
    log('Worker 關閉中');
    await boss.stop({ graceful: true, timeout: 10_000 });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
