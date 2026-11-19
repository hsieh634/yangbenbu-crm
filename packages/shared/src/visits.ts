import { z } from 'zod';
import { optionalText, uuidSchema, type StaffRef } from './schemas';
import { ROLES, type Role } from './roles';
import { VISIT_STATUSES, type BoardColumn, type VisitStatus } from './visit-status';

/** 報到：有預約時帶 appointmentId；現場掛號帶 patientId 與醫師（會建立一筆「現場」預約） */
export const checkInSchema = z.union([
  z.object({ appointmentId: uuidSchema }),
  z.object({
    patientId: uuidSchema,
    doctorId: uuidSchema,
    serviceId: uuidSchema.nullish(),
  }),
]);
export type CheckInInput = z.input<typeof checkInSchema>;

export const visitTransitionSchema = z.object({
  /** 前端看到的目前狀態；與資料庫不同代表別台裝置已經推進過，回 409 避免互相覆蓋 */
  from: z.enum(VISIT_STATUSES).optional(),
  to: z.enum(VISIT_STATUSES),
  note: optionalText(200),
});
export type VisitTransitionInput = z.input<typeof visitTransitionSchema>;

export const visitUpdateSchema = z
  .object({
    doctorId: uuidSchema.nullish(),
    roomId: uuidSchema.nullish(),
    hisVisitNo: optionalText(30),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), '沒有要更新的欄位');

/** 醫師欄位：本系統只做服務紀錄，正式病歷仍在 HIS */
export const clinicalNoteSchema = z.object({
  chiefComplaint: optionalText(1000),
  fourDiagnosis: optionalText(2000),
  pattern: optionalText(200),
  treatmentPrinciple: optionalText(500),
  advice: optionalText(2000),
});
export type ClinicalNote = { [K in keyof z.infer<typeof clinicalNoteSchema>]: string | null };
export type ClinicalNoteInput = z.input<typeof clinicalNoteSchema>;

export const visitServiceAddSchema = z.object({ serviceId: uuidSchema });

export const handoffCreateSchema = z.object({
  body: z.string().trim().min(1, '請輸入內容').max(500),
  targetRole: z.enum(ROLES).nullish(),
});
export type HandoffCreateInput = z.input<typeof handoffCreateSchema>;

export interface HandoffItem {
  id: string;
  body: string;
  targetRole: Role | null;
  author: StaffRef | null;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: StaffRef | null;
}

export interface BoardCard {
  /** 尚未報到時是預約 ID，報到後是就診單 ID */
  id: string;
  kind: 'appointment' | 'visit';
  column: BoardColumn;
  appointmentId: string | null;
  visitId: string | null;
  patient: {
    id: string;
    name: string;
    chartNo: string;
    hasAllergy: boolean;
    tags: string[];
    /** 第一次就診（沒有已完成的就診紀錄） */
    isFirstVisit: boolean;
  };
  doctor: StaffRef | null;
  room: { id: string; name: string } | null;
  service: { id: string; name: string } | null;
  appointmentAt: string | null;
  checkedInAt: string | null;
  statusChangedAt: string | null;
  /** 可抵用本次服務的療程 */
  package: { name: string; remaining: number } | null;
  openHandoffs: number;
  latestHandoff: string | null;
}

export interface BoardStats {
  appointments: number;
  arrived: number;
  noShow: number;
  completed: number;
  /** 報到到開始看診的平均分鐘數（今日已開始看診者） */
  avgWaitMinutes: number | null;
}

export interface BoardResponse {
  date: string;
  cards: BoardCard[];
  stats: BoardStats;
}

export interface VisitEventItem {
  id: string;
  fromStatus: VisitStatus | null;
  toStatus: VisitStatus;
  actor: StaffRef | null;
  note: string | null;
  createdAt: string;
}

export interface VisitServiceItem {
  id: string;
  service: { id: string; name: string };
  /** 有扣到療程時的療程名稱 */
  packageName: string | null;
  packageUsageId: string | null;
  /** 扣堂後剩餘堂數（只在新增當下回傳） */
  packageRemaining?: number;
  createdAt: string;
}

export interface VisitDetail {
  id: string;
  status: VisitStatus;
  visitDate: string;
  patient: { id: string; name: string; chartNo: string; hasAllergy: boolean };
  doctor: StaffRef | null;
  room: { id: string; name: string } | null;
  appointment: { id: string; startAt: string; service: { id: string; name: string } | null } | null;
  checkedInAt: string;
  completedAt: string | null;
  hisVisitNo: string | null;
  /** 沒有 visit:read 權限時為 null（例如櫃檯） */
  clinicalNote: ClinicalNote | null;
  clinicalNoteUpdatedAt: string | null;
  clinicalNoteUpdatedBy: StaffRef | null;
  clinicalRestricted: boolean;
  services: VisitServiceItem[];
  handoffs: HandoffItem[];
  events: VisitEventItem[];
}

export interface PatientVisitItem {
  id: string;
  visitDate: string;
  status: VisitStatus;
  doctor: StaffRef | null;
  services: string[];
  /** 證型（沒有 visit:read 權限時為 null） */
  pattern: string | null;
  chiefComplaint: string | null;
}
