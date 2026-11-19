/**
 * 診所當地時間的日期運算。
 *
 * 資料庫一律存 UTC；「今天」、「星期幾」、「09:00 門診」都要以診所時區解讀。
 * 台灣沒有日光節約時間，但這裡仍以 Intl 查詢時區偏移，不寫死 +08:00。
 */
export const DEFAULT_TIMEZONE = 'Asia/Taipei';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsCache.set(tz, f);
  }
  return f;
}

function zonedParts(date: Date, tz: string) {
  const parts: Record<string, number> = {};
  for (const p of formatter(tz).formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>;
}

/** 某個時間點在該時區的日期（YYYY-MM-DD） */
export function localDate(date: Date, tz = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** 某個時間點在該時區是當天的第幾分鐘 */
export function localMinuteOfDay(date: Date, tz = DEFAULT_TIMEZONE): number {
  const p = zonedParts(date, tz);
  return p.hour * 60 + p.minute;
}

/** 該時區相對 UTC 的偏移（毫秒） */
function offsetMs(date: Date, tz: string): number {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** 診所當地「某天的第 N 分鐘」對應的 UTC 時間點 */
export function zonedDateTime(isoDate: string, minuteOfDay: number, tz = DEFAULT_TIMEZONE): Date {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const guess = Date.UTC(y, m - 1, d, 0, minuteOfDay);
  const first = guess - offsetMs(new Date(guess), tz);
  // 再算一次，處理跨越日光節約時間切換點的情況
  return new Date(guess - offsetMs(new Date(first), tz));
}

/** 0 = 星期日 … 6 = 星期六 */
export function weekdayOf(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00Z`).getUTCDay();
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 兩個日期相差幾天（b − a） */
export function diffDays(a: string, b: string): number {
  return Math.round(
    (new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86_400_000,
  );
}

/** "HH:MM" ↔ 分鐘數 */
export function minuteToHHMM(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

export function hhmmToMinute(value: string): number {
  const [h, m] = value.split(':').map(Number) as [number, number];
  return h * 60 + m;
}
