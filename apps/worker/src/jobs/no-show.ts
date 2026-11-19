import { forEachClinic } from './for-each-clinic';
import type { JobDefinition } from './types';

/** 預約結束超過 1 小時仍未報到 → 標記未到（病患遲到仍可報到，報到時會記錄為遲到） */
const GRACE_MS = 60 * 60_000;

export const noShow: JobDefinition = {
  name: 'appointments.mark-no-show',
  cron: '30 22 * * *', // 每天 22:30（晚診結束後）
  async handler({ prisma, log }) {
    const cutoff = new Date(Date.now() - GRACE_MS);
    let total = 0;
    const result = await forEachClinic(prisma, async (clinic, tx) => {
      const { count } = await tx.appointment.updateMany({
        where: { status: { in: ['BOOKED', 'CONFIRMED'] }, endAt: { lt: cutoff } },
        data: { status: 'NO_SHOW' },
      });
      total += count;
      if (count) log('標記未到', { clinicId: clinic.id, count });
    });
    log('未到標記完成', { total, failed: result.failed });
  },
};
