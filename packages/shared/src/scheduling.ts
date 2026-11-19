import { z } from 'zod';
import { isoDateSchema, optionalText, uuidSchema, type StaffRef } from './schemas';
import { APPOINTMENT_STATUSES, type AppointmentStatus } from './visit-status';

export const APPOINTMENT_SOURCES = ['FRONT_DESK', 'PHONE', 'LINE', 'WALK_IN'] as const;
export type AppointmentSource = (typeof APPOINTMENT_SOURCES)[number];
export const APPOINTMENT_SOURCE_LABELS: Record<AppointmentSource, string> = {
  FRONT_DESK: '櫃檯',
  PHONE: '電話',
  LINE: 'LINE',
  WALK_IN: '現場',
};

export const availabilityQuerySchema = z.object({
  date: isoDateSchema,
  doctorId: uuidSchema.optional(),
});
export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;

export interface AvailabilitySlot {
  startAt: string;
  endAt: string;
  capacity: number;
  booked: number;
  /** 已過去的時段不可預約 */
  past: boolean;
}

export interface DoctorAvailability {
  doctor: StaffRef;
  /** 休診原因；有值代表當天不看診 */
  closedReason: string | null;
  slots: AvailabilitySlot[];
}

export interface AvailabilityResponse {
  date: string;
  doctors: DoctorAvailability[];
}

export const appointmentCreateSchema = z.object({
  patientId: uuidSchema,
  doctorId: uuidSchema,
  serviceId: uuidSchema.nullish(),
  /** 必須是醫師排班中的某個時段開始時間 */
  startAt: z.iso.datetime({ offset: true }),
  source: z.enum(APPOINTMENT_SOURCES).default('FRONT_DESK'),
  note: optionalText(200),
});
export type AppointmentCreateInput = z.input<typeof appointmentCreateSchema>;

export const appointmentRescheduleSchema = z.object({
  doctorId: uuidSchema.optional(),
  startAt: z.iso.datetime({ offset: true }),
});
export type AppointmentRescheduleInput = z.input<typeof appointmentRescheduleSchema>;

export const appointmentCancelSchema = z.object({
  reason: z.string().trim().min(1, '請填寫取消原因').max(200),
});

export const appointmentListQuerySchema = z
  .object({
    from: isoDateSchema,
    to: isoDateSchema,
    doctorId: uuidSchema.optional(),
    patientId: uuidSchema.optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
  })
  .refine((v) => v.from <= v.to, '起始日期不可晚於結束日期')
  .refine(
    (v) => new Date(v.to).getTime() - new Date(v.from).getTime() <= 62 * 86_400_000,
    '查詢區間最多 62 天',
  );
export type AppointmentListQuery = z.infer<typeof appointmentListQuerySchema>;

export interface AppointmentItem {
  id: string;
  patient: { id: string; name: string; chartNo: string; phone: string };
  doctor: StaffRef;
  service: { id: string; name: string } | null;
  startAt: string;
  endAt: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  note: string | null;
  cancelReason: string | null;
  visitId: string | null;
}
