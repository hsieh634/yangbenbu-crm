/**
 * 載入示範資料（可重複執行）。開發時以 tsx 執行；Docker 映像中執行編譯後的 dist/seed.js。
 *
 *   SEED_MODE=full（預設）：診所、員工、病患、診所設定、療程、過去 45 天的就診紀錄、今天起一週的預約
 *   SEED_MODE=minimal：只有診所、員工、病患、診所設定（整合測試使用，結果不受執行時間影響）
 */
import { PrismaClient } from '@prisma/client';
import { DEMO_CLINICS, DEMO_PASSWORD, DEMO_STAFF, seedDemo } from './demo';

const prisma = new PrismaClient();
const mode = process.env.SEED_MODE === 'minimal' ? 'minimal' : 'full';

async function main() {
  const started = Date.now();
  await seedDemo(prisma, { mode, log: (m) => console.log(`  ${m}`) });
  console.log(
    `✔ 示範資料完成（${mode}，${((Date.now() - started) / 1000).toFixed(1)} 秒）：` +
      `${DEMO_CLINICS.length} 家診所、${DEMO_STAFF.length} 位員工（密碼 ${DEMO_PASSWORD}）`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
