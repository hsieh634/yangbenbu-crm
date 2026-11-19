import { z } from 'zod';
import { isoDateSchema, optionalText, uuidSchema, type StaffRef } from './schemas';

export const packagePurchaseSchema = z.object({
  planId: uuidSchema,
  purchasedOn: isoDateSchema.optional(),
  note: optionalText(200),
});
export type PackagePurchaseInput = z.input<typeof packagePurchaseSchema>;

export const packageDeductSchema = z.object({
  reason: z.string().trim().min(1, '手動扣堂請填寫原因').max(200),
});

export const usageReverseSchema = z.object({
  reason: z.string().trim().min(1, '請填寫沖銷原因').max(200),
});

/** 冪等鍵：前端每次操作產生一組，網路重送同一組不會重複扣堂 */
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,100}$/, 'Idempotency-Key 格式不正確');

export type PackageStatus = 'ACTIVE' | 'EXHAUSTED' | 'EXPIRED';
export const PACKAGE_STATUS_LABELS: Record<PackageStatus, string> = {
  ACTIVE: '使用中',
  EXHAUSTED: '已用完',
  EXPIRED: '已過期',
};

export interface PackageUsageItem {
  id: string;
  kind: 'DEDUCT' | 'REVERSAL';
  quantity: number;
  reason: string | null;
  visitId: string | null;
  actor: StaffRef | null;
  createdAt: string;
  /** 被沖銷的那筆會帶沖銷紀錄的 ID */
  reversedById: string | null;
  reversalOfId: string | null;
}

export interface PatientPackageItem {
  id: string;
  name: string;
  service: { id: string; name: string };
  totalSessions: number;
  usedSessions: number;
  remainingSessions: number;
  price: number;
  purchasedOn: string;
  expiresOn: string;
  status: PackageStatus;
  /** 剩 1 堂或 30 天內到期 */
  expiringSoon: boolean;
  note: string | null;
  usages: PackageUsageItem[];
}
