import { runDemoTick } from '@yangbenbu/db';
import type { JobDefinition } from './types';

/**
 * 示範站專用（DEMO_MODE=true 才啟用）：補上未來一週的示範預約，
 * 並依目前時間推進今天的示範病患（報到 → 看診 → 療程 → 完成），
 * 讓訪客任何時候打開今日看板都有正在進行的就診。
 */
export const demoTick: JobDefinition = {
  name: 'demo.tick',
  cron: '*/10 * * * *',
  enabled: () => process.env.DEMO_MODE === 'true',
  async handler({ prisma, log }) {
    const { created } = await runDemoTick(prisma);
    log('示範資料已更新', { created });
  },
};
