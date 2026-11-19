import { z } from 'zod';
import { isIsoDate } from './time';
import { ROLES } from './roles';

export const roleSchema = z.enum(ROLES);

// ── 認證 ───────────────────────────────────────────────
export const loginSchema = z.object({
  email: z.email('請輸入有效的 Email').transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, '請輸入密碼').max(200),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const totpCodeSchema = z.object({
  code: z.string().regex(/^\d{6}$/, '請輸入 6 位數驗證碼'),
});
export type TotpCodeInput = z.infer<typeof totpCodeSchema>;

export const switchClinicSchema = z.object({ clinicId: z.uuid() });

export type LoginResult = { status: 'ok' } | { status: 'mfa_required' };

export interface MeResponse {
  staff: { id: string; name: string; email: string; mfaEnabled: boolean };
  activeClinic: { id: string; name: string };
  role: (typeof ROLES)[number];
  permissions: string[];
  clinics: { id: string; name: string; role: (typeof ROLES)[number] }[];
  /** REQUIRE_MFA=true 且尚未啟用兩步驟驗證時為 true，前端應導向設定頁 */
  mfaEnrollmentRequired: boolean;
}

// ── 分頁 ───────────────────────────────────────────────
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

// ── 共用欄位 ───────────────────────────────────────────
export const isoDateSchema = z.string().refine(isIsoDate, '日期格式應為 YYYY-MM-DD');
export const uuidSchema = z.uuid('格式不正確');

/** 選填文字：空字串視為 null（清除），未提供（undefined）代表不修改 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `最多 ${max} 個字`)
    .transform((v) => (v === '' ? null : v))
    .nullish();

export interface StaffRef {
  id: string;
  name: string;
}

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ── 稽核 ───────────────────────────────────────────────
export const auditLogQuerySchema = paginationSchema.extend({
  action: z.string().max(100).optional(),
  patientId: z.uuid().optional(),
  actorStaffId: z.uuid().optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export interface AuditLogEntry {
  id: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
  actorRole: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  patientId: string | null;
  /** 病患姓名與病歷號（同一診所內解析，病患已刪除時為 null） */
  patient: { id: string; name: string; chartNo: string } | null;
  outcome: 'SUCCESS' | 'DENIED' | 'FAILURE';
  ip: string | null;
  metadata: Record<string, unknown> | null;
}

// ── 員工 ───────────────────────────────────────────────
export interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: (typeof ROLES)[number];
  mfaEnabled: boolean;
  isActive: boolean;
  lastLoginAt: string | null;
}

// ── 錯誤（RFC 9457 Problem Details）──────────────────────
export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code?: string;
  errors?: { path: string; message: string }[];
}
