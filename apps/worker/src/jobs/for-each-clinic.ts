import { withTenant, type PrismaClient, type TenantTx } from '@yangbenbu/db';

/**
 * 逐一在每家診所的租戶範圍內執行（受 RLS 限制）。
 * 例如 Phase 3 的「預約前一天提醒」：每家診所各自查詢隔天的預約並發送 LINE 通知。
 * 一家診所失敗不影響其他診所。
 */
export async function forEachClinic(
  prisma: PrismaClient,
  fn: (clinic: { id: string; name: string }, tx: TenantTx) => Promise<void>,
): Promise<{ ok: number; failed: { clinicId: string; error: string }[] }> {
  const clinics = await prisma.clinic.findMany({ select: { id: true, name: true } });
  const failed: { clinicId: string; error: string }[] = [];
  for (const clinic of clinics) {
    try {
      await withTenant(prisma, clinic.id, (tx) => fn(clinic, tx));
    } catch (err) {
      failed.push({ clinicId: clinic.id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { ok: clinics.length - failed.length, failed };
}
