import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const dateTime = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

export function ageFrom(birthDate: string): number {
  const b = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  if (
    now.getMonth() < b.getMonth() ||
    (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())
  )
    age--;
  return age;
}

const TZ = 'Asia/Taipei';
const time = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const monthDay = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
});
const longDay = new Intl.DateTimeFormat('zh-TW', {
  timeZone: TZ,
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

/** 09:30 */
export function formatTime(iso: string): string {
  return time.format(new Date(iso));
}

/** YYYY-MM-DD（日期欄位）→ 11/19（週四） */
export function formatDay(isoDate: string): string {
  return monthDay.format(new Date(`${isoDate}T12:00:00+08:00`));
}

export function formatLongDay(isoDate: string): string {
  return longDay.format(new Date(`${isoDate}T12:00:00+08:00`));
}

/** 從某個時間點到現在經過幾分鐘 */
export function minutesSince(iso: string, now = Date.now()): number {
  return Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
}

export function formatMoney(n: number): string {
  return `NT$ ${n.toLocaleString('zh-TW')}`;
}
