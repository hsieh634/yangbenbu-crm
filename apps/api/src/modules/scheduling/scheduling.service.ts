import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, TenantTx } from '@yangbenbu/db';
import {
  ACTIVE_APPOINTMENT_STATUSES,
  localDate,
  localMinuteOfDay,
  weekdayOf,
  zonedDateTime,
  type AppointmentItem,
  type AppointmentListQuery,
  type AvailabilityQuery,
  type AvailabilityResponse,
  type appointmentCreateSchema,
  type appointmentRescheduleSchema,
} from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { ClinicTimeService } from '../../common/clinic-time.service';
import { dbDate } from '../../common/dates';
import { advisoryLock, lockRow } from '../../common/locks';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClinicService } from '../clinic/clinic.service';
import { findPatientOrThrow } from '../patients/patients.service';

const ACTIVE = [...ACTIVE_APPOINTMENT_STATUSES];

const appointmentInclude = {
  patient: { select: { id: true, name: true, chartNo: true, phone: true } },
  doctor: { select: { id: true, name: true } },
  visit: { select: { id: true } },
} satisfies Prisma.AppointmentInclude;
type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

interface Slot {
  startMinute: number;
  slotMinutes: number;
  capacity: number;
  roomId: string | null;
}

/**
 * 排班與預約。
 *
 * 可預約時段 = 醫師當天（星期幾）的排班切成固定長度，扣掉休診日。
 * 預約時以 advisory lock 鎖住「醫師 + 時段」，同一時段的請求排隊檢查名額，不會超額預約；
 * 另外鎖住病患，避免同一位病患同時被約在重疊的時段。
 */
@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: ClinicTimeService,
    private readonly clinic: ClinicService,
    private readonly audit: AuditService,
  ) {}

  private toItem(a: AppointmentRow, services: Map<string, string>): AppointmentItem {
    return {
      id: a.id,
      patient: a.patient,
      doctor: a.doctor,
      service: a.serviceId ? { id: a.serviceId, name: services.get(a.serviceId) ?? '—' } : null,
      startAt: a.startAt.toISOString(),
      endAt: a.endAt.toISOString(),
      status: a.status,
      source: a.source,
      note: a.note,
      cancelReason: a.cancelReason,
      visitId: a.visit?.id ?? null,
    };
  }

  private async serviceNames(tx: TenantTx) {
    return new Map(
      (await tx.service.findMany({ select: { id: true, name: true } })).map((s) => [s.id, s.name]),
    );
  }

  async availability(auth: AuthContext, query: AvailabilityQuery): Promise<AvailabilityResponse> {
    const doctors = (await this.clinic.doctors(auth.clinicId)).filter(
      (d) => !query.doctorId || d.id === query.doctorId,
    );
    const { from, to, tz } = await this.time.dayRange(auth.clinicId, query.date);
    const weekday = weekdayOf(query.date);
    const now = Date.now();

    const { schedules, closures, counts } = await this.prisma.tenant(auth.clinicId, async (tx) => ({
      schedules: await tx.doctorSchedule.findMany({
        where: { weekday, doctorId: { in: doctors.map((d) => d.id) } },
        orderBy: { startMinute: 'asc' },
      }),
      closures: await tx.scheduleClosure.findMany({ where: { date: dbDate(query.date) } }),
      counts: await tx.appointment.groupBy({
        by: ['doctorId', 'startAt'],
        where: { startAt: { gte: from, lt: to }, status: { in: ACTIVE } },
        _count: { _all: true },
      }),
    }));
    const booked = new Map(
      counts.map((c) => [`${c.doctorId}|${c.startAt.toISOString()}`, c._count._all]),
    );

    return {
      date: query.date,
      doctors: doctors.map((doctor) => {
        const closure = closures.find((c) => c.doctorId === null || c.doctorId === doctor.id);
        const slots = closure
          ? []
          : schedules
              .filter((s) => s.doctorId === doctor.id)
              .flatMap((s) => expandSlots(s))
              .map((slot) => {
                const startAt = zonedDateTime(query.date, slot.startMinute, tz);
                return {
                  startAt: startAt.toISOString(),
                  endAt: new Date(startAt.getTime() + slot.slotMinutes * 60_000).toISOString(),
                  capacity: slot.capacity,
                  booked: booked.get(`${doctor.id}|${startAt.toISOString()}`) ?? 0,
                  past: startAt.getTime() < now,
                };
              });
        return { doctor, closedReason: closure ? (closure.reason ?? '休診') : null, slots };
      }),
    };
  }

  /** 確認時間落在醫師排班的某個時段開頭，且當天沒有休診 */
  private async resolveSlot(
    tx: TenantTx,
    clinicId: string,
    doctorId: string,
    startAt: Date,
  ): Promise<Slot> {
    const tz = await this.time.timezone(clinicId);
    const date = localDate(startAt, tz);
    const minute = localMinuteOfDay(startAt, tz);
    const closure = await tx.scheduleClosure.findFirst({
      where: { date: dbDate(date), OR: [{ doctorId: null }, { doctorId }] },
    });
    if (closure) {
      throw new ConflictException({
        code: 'CLINIC_CLOSED',
        message: `${date} 休診：${closure.reason ?? '休診'}`,
      });
    }
    const schedules = await tx.doctorSchedule.findMany({
      where: { doctorId, weekday: weekdayOf(date) },
    });
    const slot = schedules.flatMap((s) => expandSlots(s)).find((s) => s.startMinute === minute);
    if (!slot || startAt.getSeconds() !== 0 || startAt.getMilliseconds() !== 0) {
      throw new ConflictException({ code: 'NOT_A_SLOT', message: '這個時間不是醫師的門診時段' });
    }
    return slot;
  }

  /** 檢查名額與病患重複預約；呼叫前必須已在交易內 */
  private async assertBookable(
    tx: TenantTx,
    args: {
      doctorId: string;
      patientId: string;
      startAt: Date;
      endAt: Date;
      slot: Slot;
      excludeId?: string;
    },
  ) {
    // 鎖的順序固定（時段 → 病患），兩個請求不會互相等待造成死結
    await advisoryLock(tx, `slot:${args.doctorId}:${args.startAt.toISOString()}`);
    await advisoryLock(tx, `patient-booking:${args.patientId}`);

    const taken = await tx.appointment.count({
      where: {
        doctorId: args.doctorId,
        startAt: args.startAt,
        status: { in: ACTIVE },
        id: args.excludeId ? { not: args.excludeId } : undefined,
      },
    });
    if (taken >= args.slot.capacity) {
      throw new ConflictException({ code: 'SLOT_FULL', message: '這個時段已額滿，請選擇其他時段' });
    }
    const overlap = await tx.appointment.findFirst({
      where: {
        patientId: args.patientId,
        status: { in: ACTIVE },
        startAt: { lt: args.endAt },
        endAt: { gt: args.startAt },
        id: args.excludeId ? { not: args.excludeId } : undefined,
      },
    });
    if (overlap) {
      throw new ConflictException({
        code: 'PATIENT_DOUBLE_BOOKED',
        message: '這位病患在這個時段已有預約',
      });
    }
  }

  async create(
    auth: AuthContext,
    input: z.output<typeof appointmentCreateSchema>,
    meta: RequestMeta,
  ): Promise<AppointmentItem> {
    await this.clinic.assertDoctor(auth.clinicId, input.doctorId);
    const startAt = new Date(input.startAt);
    if (startAt.getTime() < Date.now()) {
      throw new ConflictException({ code: 'SLOT_IN_PAST', message: '不能預約已經過去的時段' });
    }
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      await findPatientOrThrow(tx, input.patientId);
      if (
        input.serviceId &&
        !(await tx.service.findFirst({ where: { id: input.serviceId, isActive: true } }))
      ) {
        throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: '找不到服務項目' });
      }
      const slot = await this.resolveSlot(tx, auth.clinicId, input.doctorId, startAt);
      const endAt = new Date(startAt.getTime() + slot.slotMinutes * 60_000);
      await this.assertBookable(tx, {
        doctorId: input.doctorId,
        patientId: input.patientId,
        startAt,
        endAt,
        slot,
      });

      const a = await tx.appointment.create({
        data: {
          patientId: input.patientId,
          doctorId: input.doctorId,
          serviceId: input.serviceId ?? null,
          roomId: slot.roomId,
          startAt,
          endAt,
          source: input.source,
          note: input.note ?? null,
          createdById: auth.staffId,
        },
        include: appointmentInclude,
      });
      await this.audit.log(tx, auth, meta, 'appointment.create', {
        resourceType: 'Appointment',
        resourceId: a.id,
        patientId: a.patientId,
        metadata: { startAt: a.startAt.toISOString(), doctorId: a.doctorId },
      });
      return this.toItem(a, await this.serviceNames(tx));
    });
  }

  async list(
    auth: AuthContext,
    query: AppointmentListQuery,
    meta: RequestMeta,
  ): Promise<AppointmentItem[]> {
    const { from } = await this.time.dayRange(auth.clinicId, query.from);
    const { to } = await this.time.dayRange(auth.clinicId, query.to);
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const rows = await tx.appointment.findMany({
        where: {
          startAt: { gte: from, lt: to },
          doctorId: query.doctorId,
          patientId: query.patientId,
          status: query.status,
        },
        include: appointmentInclude,
        orderBy: [{ startAt: 'asc' }, { createdAt: 'asc' }],
        take: 2000,
      });
      await this.audit.log(tx, auth, meta, 'appointment.list', {
        resourceType: 'Appointment',
        patientId: query.patientId,
        metadata: { from: query.from, to: query.to, returned: rows.length },
      });
      const services = await this.serviceNames(tx);
      return rows.map((a) => this.toItem(a, services));
    });
  }

  /** 狀態變更共用：鎖定、檢查目前狀態、更新、寫稽核 */
  private async changeStatus(
    auth: AuthContext,
    id: string,
    meta: RequestMeta,
    action: string,
    allowedFrom: string[],
    apply: (a: AppointmentRow, tx: TenantTx) => Promise<Prisma.AppointmentUncheckedUpdateInput>,
  ): Promise<AppointmentItem> {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      if (!(await lockRow(tx, 'appointment', id))) throw new NotFoundException();
      const a = await tx.appointment.findUniqueOrThrow({
        where: { id },
        include: appointmentInclude,
      });
      if (!allowedFrom.includes(a.status)) {
        throw new ConflictException({
          code: 'INVALID_APPOINTMENT_STATUS',
          message: '預約目前的狀態不能執行這個操作',
        });
      }
      const data = await apply(a, tx);
      const updated = await tx.appointment.update({
        where: { id },
        data,
        include: appointmentInclude,
      });
      await this.audit.log(tx, auth, meta, action, {
        resourceType: 'Appointment',
        resourceId: id,
        patientId: a.patientId,
        metadata: { from: a.status, to: updated.status },
      });
      return this.toItem(updated, await this.serviceNames(tx));
    });
  }

  confirm(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.changeStatus(auth, id, meta, 'appointment.confirm', ['BOOKED'], async () => ({
      status: 'CONFIRMED',
    }));
  }

  cancel(auth: AuthContext, id: string, reason: string, meta: RequestMeta) {
    return this.changeStatus(
      auth,
      id,
      meta,
      'appointment.cancel',
      ['BOOKED', 'CONFIRMED', 'NO_SHOW'],
      async () => ({
        status: 'CANCELLED',
        cancelReason: reason,
        cancelledAt: new Date(),
      }),
    );
  }

  markNoShow(auth: AuthContext, id: string, meta: RequestMeta) {
    return this.changeStatus(
      auth,
      id,
      meta,
      'appointment.no_show',
      ['BOOKED', 'CONFIRMED'],
      async (a) => {
        if (a.startAt.getTime() > Date.now()) {
          throw new ConflictException({ code: 'NOT_YET', message: '預約時間還沒到，不能標記未到' });
        }
        return { status: 'NO_SHOW' };
      },
    );
  }

  reschedule(
    auth: AuthContext,
    id: string,
    input: z.output<typeof appointmentRescheduleSchema>,
    meta: RequestMeta,
  ) {
    const startAt = new Date(input.startAt);
    return this.changeStatus(
      auth,
      id,
      meta,
      'appointment.reschedule',
      ['BOOKED', 'CONFIRMED'],
      async (a, tx) => {
        const doctorId = input.doctorId ?? a.doctorId;
        if (doctorId !== a.doctorId) await this.clinic.assertDoctor(auth.clinicId, doctorId);
        if (startAt.getTime() < Date.now()) {
          throw new ConflictException({ code: 'SLOT_IN_PAST', message: '不能改到已經過去的時段' });
        }
        const slot = await this.resolveSlot(tx, auth.clinicId, doctorId, startAt);
        const endAt = new Date(startAt.getTime() + slot.slotMinutes * 60_000);
        await this.assertBookable(tx, {
          doctorId,
          patientId: a.patientId,
          startAt,
          endAt,
          slot,
          excludeId: a.id,
        });
        // 改期後需要重新確認
        return { doctorId, startAt, endAt, roomId: slot.roomId, status: 'BOOKED' };
      },
    );
  }
}

function expandSlots(s: {
  startMinute: number;
  endMinute: number;
  slotMinutes: number;
  capacity: number;
  roomId: string | null;
}): Slot[] {
  const slots: Slot[] = [];
  for (let m = s.startMinute; m + s.slotMinutes <= s.endMinute; m += s.slotMinutes) {
    slots.push({
      startMinute: m,
      slotMinutes: s.slotMinutes,
      capacity: s.capacity,
      roomId: s.roomId,
    });
  }
  return slots;
}
