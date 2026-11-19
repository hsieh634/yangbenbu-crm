import { z } from 'zod';
import { isoDateSchema, optionalText, uuidSchema, type StaffRef } from './schemas';

export const dispenseCreateSchema = z.object({
  name: z.string().trim().min(1, '請輸入藥品或處方名稱').max(100),
  days: z.coerce.number().int().min(1).max(90),
  dispensedOn: isoDateSchema.optional(),
  hisRxNo: optionalText(30),
  note: optionalText(200),
  visitId: uuidSchema.nullish(),
});
export type DispenseCreateInput = z.input<typeof dispenseCreateSchema>;

export const dispenseVoidSchema = z.object({
  reason: z.string().trim().min(1, '請填寫作廢原因').max(200),
});

export interface DispenseItem {
  id: string;
  name: string;
  days: number;
  dispensedOn: string;
  nextEligibleOn: string;
  hisRxNo: string | null;
  note: string | null;
  visitId: string | null;
  createdBy: StaffRef | null;
  createdAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}
