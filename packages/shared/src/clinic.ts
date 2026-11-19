import { z } from 'zod';
import { isoDateSchema, optionalText, uuidSchema, type StaffRef } from './schemas';

export const SERVICE_CATEGORIES = [
  'CONSULTATION',
  'ACUPUNCTURE',
  'TUINA',
  'CUPPING',
  'MOXIBUSTION',
  'OTHER',
] as const;
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number];

export const SERVICE_CATEGORY_LABELS: Record<ServiceCategory, string> = {
  CONSULTATION: '看診',
  ACUPUNCTURE: '針灸',
  TUINA: '推拿',
  CUPPING: '拔罐',
  MOXIBUSTION: '艾灸',
  OTHER: '其他',
};

export const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

export interface RoomItem {
  id: string;
  name: string;
}

export interface ServiceItem {
  id: string;
  code: string;
  name: string;
  category: ServiceCategory;
  durationMinutes: number;
  isActive: boolean;
}

export interface PackagePlanItem {
  id: string;
  name: string;
  service: { id: string; name: string };
  sessions: number;
  validDays: number;
  price: number;
  isActive: boolean;
}

export interface ScheduleItem {
  id: string;
  doctorId: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  capacity: number;
  roomId: string | null;
}

export interface ClosureItem {
  id: string;
  date: string;
  doctor: StaffRef | null;
  reason: string | null;
}

/** 表單下拉選單與設定頁共用的診所設定 */
export interface ClinicConfig {
  clinic: { id: string; name: string; timezone: string; today: string };
  rooms: RoomItem[];
  services: ServiceItem[];
  packagePlans: PackagePlanItem[];
  doctors: StaffRef[];
  schedules: ScheduleItem[];
  closures: ClosureItem[];
}

export const serviceUpsertSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Z0-9_-]{1,20}$/, '代碼只能包含大寫英數字、_、-'),
  name: z.string().trim().min(1).max(30),
  category: z.enum(SERVICE_CATEGORIES),
  durationMinutes: z.coerce.number().int().min(5).max(240),
  isActive: z.boolean().default(true),
});
export type ServiceUpsertInput = z.input<typeof serviceUpsertSchema>;

export const packagePlanUpsertSchema = z.object({
  name: z.string().trim().min(1).max(50),
  serviceId: uuidSchema,
  sessions: z.coerce.number().int().min(1).max(100),
  validDays: z.coerce.number().int().min(1).max(1095),
  price: z.coerce.number().int().min(0).max(1_000_000),
  isActive: z.boolean().default(true),
});
export type PackagePlanUpsertInput = z.input<typeof packagePlanUpsertSchema>;

const scheduleSlotSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    slotMinutes: z.number().int().min(5).max(240),
    capacity: z.number().int().min(1).max(20),
    roomId: uuidSchema.nullish(),
  })
  .refine((s) => s.startMinute < s.endMinute, '結束時間必須晚於開始時間')
  .refine(
    (s) => (s.endMinute - s.startMinute) % s.slotMinutes === 0,
    '門診時段長度必須是預約間隔的整數倍',
  );

/** 以整份取代醫師的每週排班 */
export const scheduleReplaceSchema = z
  .object({ items: z.array(scheduleSlotSchema).max(28) })
  .refine((v) => {
    // 同一天的門診時段不可重疊
    const byDay = new Map<number, [number, number][]>();
    for (const s of v.items) {
      const list = byDay.get(s.weekday) ?? [];
      if (list.some(([a, b]) => s.startMinute < b && a < s.endMinute)) return false;
      list.push([s.startMinute, s.endMinute]);
      byDay.set(s.weekday, list);
    }
    return true;
  }, '同一天的門診時段不可重疊');
export type ScheduleReplaceInput = z.input<typeof scheduleReplaceSchema>;

export const closureCreateSchema = z.object({
  date: isoDateSchema,
  doctorId: uuidSchema.nullish(),
  reason: optionalText(100),
});
export type ClosureCreateInput = z.input<typeof closureCreateSchema>;
