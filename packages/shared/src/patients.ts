import { z } from 'zod';
import { isoDateSchema, optionalText, paginationSchema } from './schemas';
import { isValidTaiwanId, normalizeTaiwanId } from './taiwan-id';

export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export type Gender = (typeof GENDERS)[number];

/** 目前的個資同意書版本；版本更新時，舊版簽署者會顯示「需重簽」 */
export const CONSENT_VERSION = '2026-11';

export const patientListQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(50).optional(),
  tag: z.string().trim().max(20).optional(),
});
export type PatientListQuery = z.infer<typeof patientListQuerySchema>;

const phoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+\-() ]{6,20}$/, '請輸入有效的電話號碼');

const patientFields = {
  name: z.string().trim().min(1, '請輸入姓名').max(50),
  gender: z.enum(GENDERS, '請選擇性別'),
  birthDate: isoDateSchema.refine(
    (v) => v >= '1900-01-01' && v <= new Date().toISOString().slice(0, 10),
    '生日不在合理範圍',
  ),
  phone: phoneSchema,
  email: z
    .union([z.literal(''), z.email('Email 格式不正確')])
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  address: optionalText(200),
  emergencyContactName: optionalText(50),
  emergencyContactPhone: z
    .union([z.literal(''), phoneSchema])
    .transform((v) => (v === '' ? null : v))
    .nullish(),
  source: optionalText(50),
  nationalId: z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : normalizeTaiwanId(v)))
    .refine((v) => v === null || isValidTaiwanId(v), '身分證字號格式或檢查碼不正確')
    .nullish(),
  allergies: optionalText(500),
  medicalHistory: optionalText(2000),
  tags: z.array(z.string().trim().min(1).max(20)).max(10, '最多 10 個標籤').optional(),
  /** true：記錄已簽署目前版本的個資同意書 */
  consentSigned: z.boolean().optional(),
};

export const patientCreateSchema = z.object({
  /** 未填時自動編號；可填入 HIS 的病歷號方便對照 */
  chartNo: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,20}$/, '病歷號只能包含英數字與 -')
    .optional()
    .or(z.literal('').transform(() => undefined)),
  ...patientFields,
});
export type PatientCreateInput = z.input<typeof patientCreateSchema>;

export const patientUpdateSchema = z
  .object(patientFields)
  .partial()
  .refine((v) => Object.values(v).some((x) => x !== undefined), '沒有要更新的欄位');
export type PatientUpdateInput = z.input<typeof patientUpdateSchema>;

export interface PatientSummary {
  id: string;
  chartNo: string;
  name: string;
  gender: Gender;
  birthDate: string;
  phone: string;
  /** 一律遮罩，完整號碼需呼叫 reveal API（會寫入稽核紀錄） */
  nationalIdMasked: string | null;
  hasAllergy: boolean;
  tags: string[];
}

/** 因權限不足而未回傳的欄位群組，前端據此顯示「無權限」而不是「未填」 */
export type PatientFieldGroup = 'contact' | 'medical';

export interface PatientDetail extends PatientSummary {
  email: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  source: string | null;
  allergies: string | null;
  medicalHistory: string | null;
  consentSignedAt: string | null;
  consentVersion: string | null;
  /** 簽署的不是目前版本 */
  consentOutdated: boolean;
  restricted: PatientFieldGroup[];
  createdAt: string;
  updatedAt: string;
}
