import type { TenantTx } from '@yangbenbu/db';

const LOCKABLE = ['appointment', 'visit', 'patient_package', 'patient'] as const;
type Lockable = (typeof LOCKABLE)[number];

/**
 * 以 SELECT … FOR UPDATE 鎖住一筆資料，直到交易結束。
 * 用在「先讀再寫」的地方（扣堂、狀態轉換），避免兩個請求同時通過檢查。
 * 查詢同樣受 RLS 限制：別家診所的資料鎖不到，回傳 false。
 */
export async function lockRow(tx: TenantTx, table: Lockable, id: string): Promise<boolean> {
  if (!LOCKABLE.includes(table)) throw new Error(`不允許鎖定 ${table}`);
  const rows = await tx.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "${table}" WHERE id = $1::uuid FOR UPDATE`,
    id,
  );
  return rows.length > 0;
}

/**
 * 交易層級的 advisory lock：鎖住一個「概念」而不是資料列。
 * 預約時段在預約之前不存在資料列可鎖，所以用「醫師 + 時段」當鎖的名稱，
 * 同一時段的預約請求會排隊，逐一檢查剩餘名額。
 */
export async function advisoryLock(tx: TenantTx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
