/**
 * 示範站（單一容器）啟動程序：
 *   1. 套用資料庫 migration
 *   2. 載入示範資料（可重複執行；已有資料時只補上今天起一週的預約）
 *   3. 同時啟動 API（內部 4100）、Worker、前端（對外 $PORT）
 * 任何一個程序結束，整個容器就結束，交給平台重新啟動。
 */
import { spawn, spawnSync } from 'node:child_process';

const PORT = process.env.PORT ?? '3100';
// API 只在容器內部使用；前端建置時已把 /api 轉發目的地設為 127.0.0.1:4100，這裡必須一致
const API_PORT = '4100';
const env = { ...process.env, API_PORT, DEMO_MODE: 'true' };

function step(name, args) {
  console.log(`[demo] ${name}`);
  const r = spawnSync('node', args, { stdio: 'inherit', env });
  if (r.status !== 0) {
    console.error(`[demo] ${name} 失敗`);
    process.exit(r.status ?? 1);
  }
}

step('套用 migration', [
  'packages/db/node_modules/prisma/build/index.js',
  'migrate',
  'deploy',
  '--schema',
  'packages/db/prisma/schema.prisma',
]);
step('載入示範資料', ['packages/db/dist/seed.js']);

const children = [
  ['api', ['apps/api/dist/main.js']],
  ['worker', ['apps/worker/dist/main.js']],
  [
    'web',
    ['apps/web/node_modules/next/dist/bin/next', 'start', 'apps/web', '--port', PORT, '--hostname', '0.0.0.0'],
  ],
].map(([name, args]) => {
  const child = spawn('node', args, { stdio: 'inherit', env });
  child.on('exit', (code, signal) => {
    console.error(`[demo] ${name} 已結束（${signal ?? code}），容器結束`);
    shutdown(code ?? 1);
  });
  return child;
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 10_000).unref();
  Promise.all(children.map((c) => (c.exitCode !== null ? null : new Promise((r) => c.on('exit', r))))).then(
    () => process.exit(code),
  );
}
process.on('SIGTERM', () => shutdown(0));
process.on('SIGINT', () => shutdown(0));
