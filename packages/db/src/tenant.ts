import type { Prisma, PrismaClient } from '@prisma/client';

export type TenantTx = Prisma.TransactionClient;

/**
 * 在「指定診所」的範圍內執行資料庫操作。
 *
 * 開一個交易，先設定 `app.clinic_id`（只在此交易內有效），
 * 之後交易內的所有查詢都受 Row-Level Security 限制，只能讀寫該診所的資料。
 * 交易結束後設定自動失效，連線回到連線池也不會殘留。
 */
export async function withTenant<T>(
  prisma: PrismaClient,
  clinicId: string,
  fn: (tx: TenantTx) => Promise<T>,
  options?: { isolationLevel?: Prisma.TransactionIsolationLevel; timeout?: number },
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.clinic_id', ${clinicId}, true)`;
    return fn(tx);
  }, options);
}

/**
 * 確認目前連線的資料庫角色不會繞過 RLS。
 * 超級使用者或具 BYPASSRLS 的角色會讓租戶隔離失效，正式環境必須拒絕啟動。
 */
export async function checkRlsEnforced(prisma: PrismaClient): Promise<{ ok: boolean; role: string }> {
  const rows = await prisma.$queryRaw<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  const row = rows[0];
  if (!row) return { ok: false, role: 'unknown' };
  return { ok: !row.rolsuper && !row.rolbypassrls, role: row.rolname };
}
