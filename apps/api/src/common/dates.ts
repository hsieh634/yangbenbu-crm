/** Prisma 的 @db.Date 欄位以 UTC 午夜的 Date 表示；轉成 YYYY-MM-DD */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** YYYY-MM-DD → @db.Date 欄位的值 */
export function dbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}
