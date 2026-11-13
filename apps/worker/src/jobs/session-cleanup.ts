import type { JobDefinition } from './types';

/** 保留 30 天的過期／撤銷 Session，供資安事件調查；之後刪除 */
const RETENTION_DAYS = 30;

export const sessionCleanup: JobDefinition = {
  name: 'maintenance.session-cleanup',
  cron: '15 3 * * *', // 每天 03:15
  async handler({ prisma, log }) {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000);
    const { count } = await prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] },
    });
    log('已清除過期 Session', { count });
  },
};
