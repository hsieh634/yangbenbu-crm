import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { TenantTx } from '@yangbenbu/db';
import type {
  ClinicConfig,
  ClosureCreateInput,
  PackagePlanItem,
  ServiceItem,
  StaffRef,
  packagePlanUpsertSchema,
  scheduleReplaceSchema,
  serviceUpsertSchema,
} from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { ClinicTimeService } from '../../common/clinic-time.service';
import { dbDate, isoDay } from '../../common/dates';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

/**
 * 診所設定：診間、服務項目、療程方案、醫師排班、休診日。
 * 讀取開放給所有登入者（預約、就診表單的下拉選單需要）；修改需要 settings:manage。
 */
@Injectable()
export class ClinicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: ClinicTimeService,
    private readonly audit: AuditService,
  ) {}

  /** 目前診所在職的醫師 */
  async doctors(clinicId: string): Promise<StaffRef[]> {
    const rows = await this.prisma.clinicMembership.findMany({
      where: { clinicId, role: 'DOCTOR', isActive: true, staff: { isActive: true } },
      include: { staff: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => r.staff);
  }

  async assertDoctor(clinicId: string, doctorId: string): Promise<StaffRef> {
    const doctor = (await this.doctors(clinicId)).find((d) => d.id === doctorId);
    if (!doctor)
      throw new NotFoundException({ code: 'DOCTOR_NOT_FOUND', message: '找不到這位醫師' });
    return doctor;
  }

  async config(auth: AuthContext): Promise<ClinicConfig> {
    const clinic = await this.prisma.clinic.findUniqueOrThrow({ where: { id: auth.clinicId } });
    const doctors = await this.doctors(auth.clinicId);
    const today = await this.time.today(auth.clinicId);
    const data = await this.prisma.tenant(auth.clinicId, async (tx) => ({
      rooms: await tx.room.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }),
      services: await tx.service.findMany({ orderBy: { sortOrder: 'asc' } }),
      plans: await tx.packagePlan.findMany({
        include: { service: true },
        orderBy: { createdAt: 'asc' },
      }),
      schedules: await tx.doctorSchedule.findMany({
        orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      }),
      closures: await tx.scheduleClosure.findMany({
        where: { date: { gte: dbDate(today) } },
        orderBy: { date: 'asc' },
      }),
    }));
    const doctorNames = new Map(doctors.map((d) => [d.id, d]));
    return {
      clinic: { id: clinic.id, name: clinic.name, timezone: clinic.timezone, today },
      rooms: data.rooms.map((r) => ({ id: r.id, name: r.name })),
      services: data.services.map(toServiceItem),
      packagePlans: data.plans.map(toPlanItem),
      doctors,
      schedules: data.schedules.map((s) => ({
        id: s.id,
        doctorId: s.doctorId,
        weekday: s.weekday,
        startMinute: s.startMinute,
        endMinute: s.endMinute,
        slotMinutes: s.slotMinutes,
        capacity: s.capacity,
        roomId: s.roomId,
      })),
      closures: data.closures.map((c) => ({
        id: c.id,
        date: isoDay(c.date),
        doctor: c.doctorId ? (doctorNames.get(c.doctorId) ?? null) : null,
        reason: c.reason,
      })),
    };
  }

  private settingsAudit(
    tx: TenantTx,
    auth: AuthContext,
    meta: RequestMeta,
    action: string,
    resourceType: string,
    resourceId: string,
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.log(tx, auth, meta, action, {
      resourceType,
      resourceId,
      metadata: metadata as never,
    });
  }

  async createService(
    auth: AuthContext,
    input: z.output<typeof serviceUpsertSchema>,
    meta: RequestMeta,
  ): Promise<ServiceItem> {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      if (await tx.service.findFirst({ where: { code: input.code } })) {
        throw new ConflictException({
          code: 'DUPLICATE_CODE',
          message: `代碼 ${input.code} 已被使用`,
        });
      }
      const s = await tx.service.create({ data: input });
      await this.settingsAudit(tx, auth, meta, 'settings.service.create', 'Service', s.id, input);
      return toServiceItem(s);
    });
  }

  async updateService(
    auth: AuthContext,
    id: string,
    input: z.output<typeof serviceUpsertSchema>,
    meta: RequestMeta,
  ): Promise<ServiceItem> {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const existing = await tx.service.findFirst({ where: { id } });
      if (!existing) throw new NotFoundException();
      if (
        input.code !== existing.code &&
        (await tx.service.findFirst({ where: { code: input.code } }))
      ) {
        throw new ConflictException({
          code: 'DUPLICATE_CODE',
          message: `代碼 ${input.code} 已被使用`,
        });
      }
      const s = await tx.service.update({ where: { id }, data: input });
      await this.settingsAudit(tx, auth, meta, 'settings.service.update', 'Service', id, input);
      return toServiceItem(s);
    });
  }

  async createPlan(
    auth: AuthContext,
    input: z.output<typeof packagePlanUpsertSchema>,
    meta: RequestMeta,
  ): Promise<PackagePlanItem> {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      await this.assertService(tx, input.serviceId);
      const p = await tx.packagePlan.create({ data: input, include: { service: true } });
      await this.settingsAudit(
        tx,
        auth,
        meta,
        'settings.package_plan.create',
        'PackagePlan',
        p.id,
        input,
      );
      return toPlanItem(p);
    });
  }

  async updatePlan(
    auth: AuthContext,
    id: string,
    input: z.output<typeof packagePlanUpsertSchema>,
    meta: RequestMeta,
  ): Promise<PackagePlanItem> {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      if (!(await tx.packagePlan.findFirst({ where: { id } }))) throw new NotFoundException();
      await this.assertService(tx, input.serviceId);
      // 已售出的療程是購買當下的快照，修改方案不影響
      const p = await tx.packagePlan.update({
        where: { id },
        data: input,
        include: { service: true },
      });
      await this.settingsAudit(
        tx,
        auth,
        meta,
        'settings.package_plan.update',
        'PackagePlan',
        id,
        input,
      );
      return toPlanItem(p);
    });
  }

  private async assertService(tx: TenantTx, serviceId: string) {
    if (!(await tx.service.findFirst({ where: { id: serviceId } }))) {
      throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: '找不到服務項目' });
    }
  }

  /** 以整份取代醫師的每週排班。已成立的預約不受影響（仍保留在原時段）。 */
  async replaceSchedule(
    auth: AuthContext,
    doctorId: string,
    input: z.output<typeof scheduleReplaceSchema>,
    meta: RequestMeta,
  ) {
    await this.assertDoctor(auth.clinicId, doctorId);
    await this.prisma.tenant(auth.clinicId, async (tx) => {
      const roomIds = new Set((await tx.room.findMany({ select: { id: true } })).map((r) => r.id));
      if (input.items.some((i) => i.roomId && !roomIds.has(i.roomId))) {
        throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: '找不到診間' });
      }
      await tx.doctorSchedule.deleteMany({ where: { doctorId } });
      await tx.doctorSchedule.createMany({
        data: input.items.map((i) => ({ ...i, roomId: i.roomId ?? null, doctorId })),
      });
      await this.settingsAudit(
        tx,
        auth,
        meta,
        'settings.schedule.replace',
        'DoctorSchedule',
        doctorId,
        {
          blocks: input.items.length,
        },
      );
    });
  }

  async createClosure(
    auth: AuthContext,
    input: ClosureCreateInput & { reason?: string | null },
    meta: RequestMeta,
  ) {
    if (input.doctorId) await this.assertDoctor(auth.clinicId, input.doctorId);
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const c = await tx.scheduleClosure.create({
        data: {
          date: dbDate(input.date),
          doctorId: input.doctorId ?? null,
          reason: input.reason ?? null,
          createdById: auth.staffId,
        },
      });
      // 休診日已有的預約不自動取消：櫃檯需要逐一聯絡病患，回傳筆數提醒
      const { from, to } = await this.time.dayRange(auth.clinicId, input.date);
      const affected = await tx.appointment.count({
        where: {
          startAt: { gte: from, lt: to },
          status: { in: ['BOOKED', 'CONFIRMED'] },
          doctorId: input.doctorId ?? undefined,
        },
      });
      await this.settingsAudit(tx, auth, meta, 'settings.closure.create', 'ScheduleClosure', c.id, {
        date: input.date,
        doctorId: input.doctorId ?? null,
        affected,
      });
      return { id: c.id, affectedAppointments: affected };
    });
  }

  async deleteClosure(auth: AuthContext, id: string, meta: RequestMeta) {
    await this.prisma.tenant(auth.clinicId, async (tx) => {
      const { count } = await tx.scheduleClosure.deleteMany({ where: { id } });
      if (!count) throw new NotFoundException();
      await this.settingsAudit(tx, auth, meta, 'settings.closure.delete', 'ScheduleClosure', id);
    });
  }
}

function toServiceItem(s: {
  id: string;
  code: string;
  name: string;
  category: ServiceItem['category'];
  durationMinutes: number;
  isActive: boolean;
}): ServiceItem {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    category: s.category,
    durationMinutes: s.durationMinutes,
    isActive: s.isActive,
  };
}

function toPlanItem(p: {
  id: string;
  name: string;
  sessions: number;
  validDays: number;
  price: number;
  isActive: boolean;
  service: { id: string; name: string };
}): PackagePlanItem {
  return {
    id: p.id,
    name: p.name,
    service: { id: p.service.id, name: p.service.name },
    sessions: p.sessions,
    validDays: p.validDays,
    price: p.price,
    isActive: p.isActive,
  };
}
