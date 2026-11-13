import { z } from 'zod';
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

export type LoginResult =
  | { status: 'ok' }
  | { status: 'mfa_required' };

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

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

// ── 病患 ───────────────────────────────────────────────
export const patientListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(50).optional(),
});
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;

export interface PatientSummary {
  id: string;
  chartNo: string;
  name: string;
  gender: (typeof GENDERS)[number];
  birthDate: string;
  phone: string;
  /** 一律遮罩，完整號碼需呼叫 reveal API（會寫入稽核紀錄） */
  nationalIdMasked: string | null;
  tags: string[];
}

export interface PatientDetail extends PatientSummary {
  /** 沒有 patient:read_medical 權限時為 null */
  allergies: string | null;
  medicalHistory: string | null;
  createdAt: string;
  updatedAt: string;
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
