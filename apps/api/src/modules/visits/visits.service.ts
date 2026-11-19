import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { decryptField, encryptField, type TenantTx, type VisitStatus } from '@yangbenbu/db';
import {
  canTransition,
  VISIT_STATUS_LABELS,
  type BoardCard,
  type BoardResponse,
  type CheckInInput,
  type ClinicalNote,
  type HandoffCreateInput,
  type StaffRef,
  type VisitDetail,
  type VisitServiceItem,
  type clinicalNoteSchema,
  type visitTransitionSchema,
  type visitUpdateSchema,
} from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { ClinicTimeService } from '../../common/clinic-time.service';
import { dbDate, isoDay } from '../../common/dates';
import { lockRow } from '../../common/locks';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ClinicService } from '../clinic/clinic.service';
import { PackagesService } from '../packages/packages.service';
import { findPatientOrThrow } from '../patients/patients.service';

const EMPTY_NOTE: ClinicalNote = {
  chiefComplaint: null,
  fourDiagnosis: null,
  pattern: null,
  treatmentPrinciple: null,
  advice: null,
};

const OPEN_STATUSES: VisitStatus[] = [
  'CHECKED_IN',
  'WAITING',
  'IN_CONSULTATION',
  'IN_TREATMENT',
  'PENDING_CHECKOUT',
];

/**
 * 就診單與今日看板。
 *
 * - 報到時建立就診單；之後依狀態機推進（不允許的轉換由後端拒絕），每次轉換寫入 VisitEvent
 * - 多台裝置同時操作：轉換時鎖定就診單，並比對前端看到的狀態，不一致回 409
 * - 醫師欄位加密儲存，只有 visit:read 的角色看得到、只有醫師能寫
 * - 登記服務項目時，若病患有可抵用的療程自動扣堂；移除服務項目自動沖銷
 */
@Injectable()
export class VisitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: ClinicTimeService,
    private readonly clinic: ClinicService,
    private readonly packages: PackagesService,
    private readonly audit: AuditService,
  ) {}

  // ── 報到 ─────────────────────────────────────────────────────────
  async checkIn(
    auth: AuthContext,
    input: CheckInInput,
    meta: RequestMeta,
  ): Promise<{ visitId: string }> {
    const today = await this.time.today(auth.clinicId);
    const { from, to } = await this.time.dayRange(auth.clinicId, today);

    if ('appointmentId' in input) {
      return this.prisma.tenant(auth.clinicId, async (tx) => {
        if (!(await lockRow(tx, 'appointment', input.appointmentId))) throw new NotFoundException();
        const appt = await tx.appointment.findUniqueOrThrow({ where: { id: input.appointmentId } });
        if (!['BOOKED', 'CONFIRMED', 'NO_SHOW'].includes(appt.status)) {
          throw new ConflictException({
            code: 'CANNOT_CHECK_IN',
            message: '這筆預約已報到或已取消',
          });
        }
        if (appt.startAt < from || appt.startAt >= to) {
          throw new ConflictException({ code: 'NOT_TODAY', message: '只能為今天的預約報到' });
        }
        await this.assertNoOpenVisit(tx, appt.patientId, today);
        const visit = await this.createVisit(tx, auth, {
          patientId: appt.patientId,
          appointmentId: appt.id,
          doctorId: appt.doctorId,
          roomId: appt.roomId,
          visitDate: today,
        });
        await tx.appointment.update({ where: { id: appt.id }, data: { status: 'CHECKED_IN' } });
        await this.audit.log(tx, auth, meta, 'visit.check_in', {
          resourceType: 'Visit',
          resourceId: visit.id,
          patientId: appt.patientId,
          metadata: { appointmentId: appt.id, late: appt.status === 'NO_SHOW' },
        });
        return { visitId: visit.id };
      });
    }

    // 現場掛號：建立一筆「現場」預約（不佔用預約名額檢查），讓統計與看板一致
    await this.clinic.assertDoctor(auth.clinicId, input.doctorId);
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      await findPatientOrThrow(tx, input.patientId);
      await this.assertNoOpenVisit(tx, input.patientId, today);
      if (input.serviceId && !(await tx.service.findFirst({ where: { id: input.serviceId } }))) {
        throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: '找不到服務項目' });
      }
      const now = new Date();
      const appt = await tx.appointment.create({
        data: {
          patientId: input.patientId,
          doctorId: input.doctorId,
          serviceId: input.serviceId ?? null,
          startAt: now,
          endAt: new Date(now.getTime() + 15 * 60_000),
          status: 'CHECKED_IN',
          source: 'WALK_IN',
          createdById: auth.staffId,
        },
      });
      const visit = await this.createVisit(tx, auth, {
        patientId: input.patientId,
        appointmentId: appt.id,
        doctorId: input.doctorId,
        roomId: null,
        visitDate: today,
      });
      await this.audit.log(tx, auth, meta, 'visit.check_in', {
        resourceType: 'Visit',
        resourceId: visit.id,
        patientId: input.patientId,
        metadata: { walkIn: true },
      });
      return { visitId: visit.id };
    });
  }

  private async assertNoOpenVisit(tx: TenantTx, patientId: string, today: string) {
    await lockRow(tx, 'patient', patientId);
    const open = await tx.visit.findFirst({
      where: { patientId, visitDate: dbDate(today), status: { in: OPEN_STATUSES } },
    });
    if (open) {
      throw new ConflictException({
        code: 'ALREADY_CHECKED_IN',
        message: '這位病患今天已經報到，尚未完成就診',
      });
    }
  }

  private createVisit(
    tx: TenantTx,
    auth: AuthContext,
    data: {
      patientId: string;
      appointmentId: string | null;
      doctorId: string | null;
      roomId: string | null;
      visitDate: string;
    },
  ) {
    return tx.visit.create({
      data: {
        ...data,
        visitDate: dbDate(data.visitDate),
        status: 'CHECKED_IN',
        createdById: auth.staffId,
        events: { create: { toStatus: 'CHECKED_IN', actorId: auth.staffId } },
      },
    });
  }

  // ── 今日看板 ─────────────────────────────────────────────────────
  async board(
    auth: AuthContext,
    date: string | undefined,
    meta: RequestMeta,
  ): Promise<BoardResponse> {
    const day = date ?? (await this.time.today(auth.clinicId));
    const { from, to } = await this.time.dayRange(auth.clinicId, day);

    const data = await this.prisma.tenant(auth.clinicId, async (tx) => {
      const appointments = await tx.appointment.findMany({
        where: { startAt: { gte: from, lt: to } },
        include: { patient: true, doctor: { select: { id: true, name: true } } },
        orderBy: { startAt: 'asc' },
      });
      const visits = await tx.visit.findMany({
        where: { visitDate: dbDate(day), status: { not: 'CANCELLED' } },
        include: {
          patient: true,
          doctor: { select: { id: true, name: true } },
          appointment: { select: { startAt: true, serviceId: true } },
          handoffs: { where: { resolvedAt: null }, orderBy: { createdAt: 'desc' } },
          events: {
            where: { toStatus: 'IN_CONSULTATION' },
            orderBy: { createdAt: 'asc' },
            take: 1,
          },
        },
        orderBy: { checkedInAt: 'asc' },
      });
      const patientIds = [
        ...new Set([...appointments.map((a) => a.patientId), ...visits.map((v) => v.patientId)]),
      ];
      const [returning, packages, services, rooms] = await Promise.all([
        tx.visit.groupBy({
          by: ['patientId'],
          where: {
            patientId: { in: patientIds },
            status: 'COMPLETED',
            visitDate: { lt: dbDate(day) },
          },
        }),
        tx.patientPackage.findMany({
          where: {
            patientId: { in: patientIds },
            expiresOn: { gte: dbDate(day) },
            purchasedOn: { lte: dbDate(day) },
          },
          include: { usages: { select: { quantity: true } } },
          orderBy: { expiresOn: 'asc' },
        }),
        tx.service.findMany({ select: { id: true, name: true } }),
        tx.room.findMany({ select: { id: true, name: true } }),
      ]);
      await this.audit.log(tx, auth, meta, 'board.read', {
        resourceType: 'Board',
        metadata: { date: day, appointments: appointments.length, visits: visits.length },
      });
      return { appointments, visits, returning, packages, services, rooms };
    });

    const serviceName = new Map(data.services.map((s) => [s.id, s.name]));
    const roomOf = new Map(data.rooms.map((r) => [r.id, r]));
    const returning = new Set(data.returning.map((r) => r.patientId));
    const packageFor = (patientId: string, serviceId: string | null) => {
      if (!serviceId) return null;
      for (const p of data.packages) {
        if (p.patientId !== patientId || p.serviceId !== serviceId) continue;
        const remaining = p.totalSessions - p.usages.reduce((s, u) => s + u.quantity, 0);
        if (remaining > 0) return { name: p.name, remaining };
      }
      return null;
    };
    const patientRef = (p: (typeof data.visits)[number]['patient']) => ({
      id: p.id,
      name: p.name,
      chartNo: p.chartNo,
      hasAllergy: p.hasAllergy,
      tags: p.tags,
      isFirstVisit: !returning.has(p.id),
    });

    const cards: BoardCard[] = [];
    for (const a of data.appointments) {
      if (a.status !== 'BOOKED' && a.status !== 'CONFIRMED') continue;
      cards.push({
        id: a.id,
        kind: 'appointment',
        column: 'SCHEDULED',
        appointmentId: a.id,
        visitId: null,
        patient: patientRef(a.patient),
        doctor: a.doctor,
        room: a.roomId ? (roomOf.get(a.roomId) ?? null) : null,
        service: a.serviceId
          ? { id: a.serviceId, name: serviceName.get(a.serviceId) ?? '—' }
          : null,
        appointmentAt: a.startAt.toISOString(),
        checkedInAt: null,
        statusChangedAt: null,
        package: packageFor(a.patientId, a.serviceId),
        openHandoffs: 0,
        latestHandoff: null,
      });
    }
    for (const v of data.visits) {
      const serviceId = v.appointment?.serviceId ?? null;
      cards.push({
        id: v.id,
        kind: 'visit',
        column: v.status as BoardCard['column'],
        appointmentId: v.appointmentId,
        visitId: v.id,
        patient: patientRef(v.patient),
        doctor: v.doctor,
        room: v.roomId ? (roomOf.get(v.roomId) ?? null) : null,
        service: serviceId ? { id: serviceId, name: serviceName.get(serviceId) ?? '—' } : null,
        appointmentAt: v.appointment?.startAt.toISOString() ?? null,
        checkedInAt: v.checkedInAt.toISOString(),
        statusChangedAt: v.statusChangedAt.toISOString(),
        package: packageFor(v.patientId, serviceId),
        openHandoffs: v.handoffs.length,
        latestHandoff: v.handoffs[0]?.body ?? null,
      });
    }

    const waits = data.visits
      .map(
        (v) => v.events[0] && (v.events[0].createdAt.getTime() - v.checkedInAt.getTime()) / 60_000,
      )
      .filter((m): m is number => typeof m === 'number' && m >= 0);
    return {
      date: day,
      cards,
      stats: {
        appointments: data.appointments.filter((a) => a.status !== 'CANCELLED').length,
        arrived: data.visits.length,
        noShow: data.appointments.filter((a) => a.status === 'NO_SHOW').length,
        completed: data.visits.filter((v) => v.status === 'COMPLETED').length,
        avgWaitMinutes: waits.length
          ? Math.round(waits.reduce((s, m) => s + m, 0) / waits.length)
          : null,
      },
    };
  }

  // ── 就診單 ───────────────────────────────────────────────────────
  async get(auth: AuthContext, id: string, meta: RequestMeta): Promise<VisitDetail> {
    const canReadClinical = auth.permissions.has('visit:read');
    const { v, services, rooms, usages, reversed } = await this.prisma.tenant(
      auth.clinicId,
      async (tx) => {
        const v = await tx.visit.findFirst({
          where: { id },
          include: {
            patient: { select: { id: true, name: true, chartNo: true, hasAllergy: true } },
            doctor: { select: { id: true, name: true } },
            appointment: { select: { id: true, startAt: true, serviceId: true } },
            services: { where: { removedAt: null }, orderBy: { createdAt: 'asc' } },
            handoffs: { orderBy: { createdAt: 'desc' } },
            events: { orderBy: { createdAt: 'asc' } },
          },
        });
        if (!v)
          throw new NotFoundException({ code: 'VISIT_NOT_FOUND', message: '找不到這筆就診紀錄' });
        const usageIds = v.services.map((s) => s.packageUsageId).filter((x): x is string => !!x);
        const usages = await tx.packageUsage.findMany({
          where: { id: { in: usageIds } },
          include: { package: { select: { name: true } } },
        });
        const reversed = new Set(
          (
            await tx.packageUsage.findMany({
              where: { reversalOfId: { in: usageIds } },
              select: { reversalOfId: true },
            })
          ).map((u) => u.reversalOfId),
        );
        await this.audit.log(tx, auth, meta, 'visit.read', {
          resourceType: 'Visit',
          resourceId: v.id,
          patientId: v.patientId,
          metadata: { clinical: canReadClinical },
        });
        return {
          v,
          usages: new Map(usages.map((u) => [u.id, u.package.name])),
          reversed,
          services: new Map((await tx.service.findMany()).map((s) => [s.id, s.name])),
          rooms: new Map((await tx.room.findMany()).map((r) => [r.id, r])),
        };
      },
    );

    const staffIds = new Set<string>();
    for (const e of v.events) if (e.actorId) staffIds.add(e.actorId);
    for (const h of v.handoffs) {
      if (h.authorId) staffIds.add(h.authorId);
      if (h.resolvedById) staffIds.add(h.resolvedById);
    }
    if (v.clinicalNoteUpdatedById) staffIds.add(v.clinicalNoteUpdatedById);
    const staff = await this.staffMap([...staffIds]);
    const ref = (id: string | null) => (id ? (staff.get(id) ?? null) : null);

    return {
      id: v.id,
      status: v.status,
      visitDate: isoDay(v.visitDate),
      patient: v.patient,
      doctor: v.doctor,
      room: v.roomId ? (rooms.get(v.roomId) ?? null) : null,
      appointment: v.appointment
        ? {
            id: v.appointment.id,
            startAt: v.appointment.startAt.toISOString(),
            service: v.appointment.serviceId
              ? { id: v.appointment.serviceId, name: services.get(v.appointment.serviceId) ?? '—' }
              : null,
          }
        : null,
      checkedInAt: v.checkedInAt.toISOString(),
      completedAt: v.completedAt?.toISOString() ?? null,
      hisVisitNo: v.hisVisitNo,
      clinicalNote: canReadClinical
        ? v.clinicalNoteEnc
          ? {
              ...EMPTY_NOTE,
              ...(JSON.parse(decryptField(v.clinicalNoteEnc)) as Partial<ClinicalNote>),
            }
          : { ...EMPTY_NOTE }
        : null,
      clinicalNoteUpdatedAt: canReadClinical
        ? (v.clinicalNoteUpdatedAt?.toISOString() ?? null)
        : null,
      clinicalNoteUpdatedBy: canReadClinical ? ref(v.clinicalNoteUpdatedById) : null,
      clinicalRestricted: !canReadClinical,
      services: v.services.map((s) => ({
        id: s.id,
        service: { id: s.serviceId, name: services.get(s.serviceId) ?? '—' },
        packageName:
          s.packageUsageId && !reversed.has(s.packageUsageId)
            ? (usages.get(s.packageUsageId) ?? null)
            : null,
        packageUsageId: s.packageUsageId,
        createdAt: s.createdAt.toISOString(),
      })),
      handoffs: v.handoffs.map((h) => ({
        id: h.id,
        body: h.body,
        targetRole: h.targetRole,
        author: ref(h.authorId),
        createdAt: h.createdAt.toISOString(),
        resolvedAt: h.resolvedAt?.toISOString() ?? null,
        resolvedBy: ref(h.resolvedById),
      })),
      events: v.events.map((e) => ({
        id: e.id,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        actor: ref(e.actorId),
        note: e.note,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  private async staffMap(ids: string[]): Promise<Map<string, StaffRef>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.staff.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((s) => [s.id, s]));
  }

  /** 鎖定並讀取就診單；別家診所的就診單在 RLS 下鎖不到，回 404 */
  private async lockVisit(tx: TenantTx, id: string) {
    if (!(await lockRow(tx, 'visit', id))) {
      throw new NotFoundException({ code: 'VISIT_NOT_FOUND', message: '找不到這筆就診紀錄' });
    }
    return tx.visit.findUniqueOrThrow({ where: { id } });
  }

  async transition(
    auth: AuthContext,
    id: string,
    input: z.output<typeof visitTransitionSchema>,
    meta: RequestMeta,
  ): Promise<{ id: string; status: VisitStatus }> {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const v = await this.lockVisit(tx, id);
      if (input.from && input.from !== v.status) {
        throw new ConflictException({
          code: 'STALE_STATUS',
          message: `這位病患已被移到「${VISIT_STATUS_LABELS[v.status]}」，畫面已更新`,
        });
      }
      if (!canTransition(v.status, input.to)) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: `無法從「${VISIT_STATUS_LABELS[v.status]}」直接變更為「${VISIT_STATUS_LABELS[input.to]}」`,
        });
      }
      if (input.to === 'CANCELLED') {
        const hasServices = await tx.visitService.count({
          where: { visitId: id, removedAt: null },
        });
        if (hasServices) {
          throw new ConflictException({
            code: 'HAS_SERVICES',
            message: '已登記服務項目，請先移除再取消',
          });
        }
      }
      const now = new Date();
      await tx.visit.update({
        where: { id },
        data: {
          status: input.to,
          statusChangedAt: now,
          completedAt: input.to === 'COMPLETED' ? now : undefined,
          events: {
            create: {
              fromStatus: v.status,
              toStatus: input.to,
              actorId: auth.staffId,
              note: input.note ?? null,
            },
          },
        },
      });
      await this.audit.log(tx, auth, meta, 'visit.transition', {
        resourceType: 'Visit',
        resourceId: id,
        patientId: v.patientId,
        metadata: { from: v.status, to: input.to },
      });
      return { id, status: input.to };
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    input: z.output<typeof visitUpdateSchema>,
    meta: RequestMeta,
  ) {
    if (input.doctorId) await this.clinic.assertDoctor(auth.clinicId, input.doctorId);
    await this.prisma.tenant(auth.clinicId, async (tx) => {
      const v = await this.lockVisit(tx, id);
      if (input.roomId && !(await tx.room.findFirst({ where: { id: input.roomId } }))) {
        throw new NotFoundException({ code: 'ROOM_NOT_FOUND', message: '找不到診間' });
      }
      await tx.visit.update({
        where: { id },
        data: { doctorId: input.doctorId, roomId: input.roomId, hisVisitNo: input.hisVisitNo },
      });
      await this.audit.log(tx, auth, meta, 'visit.update', {
        resourceType: 'Visit',
        resourceId: id,
        patientId: v.patientId,
        metadata: {
          changed: Object.keys(input).filter((k) => input[k as keyof typeof input] !== undefined),
        },
      });
    });
  }

  /** 醫師欄位：整份覆寫（前端送出目前的全部欄位），只記錄改了哪些欄位 */
  async saveClinicalNote(
    auth: AuthContext,
    id: string,
    input: z.output<typeof clinicalNoteSchema>,
    meta: RequestMeta,
  ) {
    await this.prisma.tenant(auth.clinicId, async (tx) => {
      const v = await this.lockVisit(tx, id);
      if (v.status === 'CANCELLED') {
        throw new ConflictException({ code: 'VISIT_CANCELLED', message: '就診已取消' });
      }
      const before: ClinicalNote = v.clinicalNoteEnc
        ? {
            ...EMPTY_NOTE,
            ...(JSON.parse(decryptField(v.clinicalNoteEnc)) as Partial<ClinicalNote>),
          }
        : { ...EMPTY_NOTE };
      const after: ClinicalNote = { ...before };
      for (const k of Object.keys(EMPTY_NOTE) as (keyof ClinicalNote)[]) {
        if (input[k] !== undefined) after[k] = input[k] ?? null;
      }
      const changed = (Object.keys(EMPTY_NOTE) as (keyof ClinicalNote)[]).filter(
        (k) => before[k] !== after[k],
      );
      if (!changed.length) return;
      await tx.visit.update({
        where: { id },
        data: {
          clinicalNoteEnc: encryptField(JSON.stringify(after)),
          clinicalNoteUpdatedAt: new Date(),
          clinicalNoteUpdatedById: auth.staffId,
        },
      });
      await this.audit.log(tx, auth, meta, 'visit.clinical_note.update', {
        resourceType: 'Visit',
        resourceId: id,
        patientId: v.patientId,
        metadata: { changed },
      });
    });
  }

  // ── 服務項目與自動扣堂 ────────────────────────────────────────────
  async addService(
    auth: AuthContext,
    id: string,
    serviceId: string,
    meta: RequestMeta,
  ): Promise<VisitServiceItem> {
    const today = await this.time.today(auth.clinicId);
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const v = await this.lockVisit(tx, id);
      if (v.status === 'CANCELLED') {
        throw new ConflictException({ code: 'VISIT_CANCELLED', message: '就診已取消' });
      }
      const service = await tx.service.findFirst({ where: { id: serviceId, isActive: true } });
      if (!service)
        throw new NotFoundException({ code: 'SERVICE_NOT_FOUND', message: '找不到服務項目' });
      if (await tx.visitService.findFirst({ where: { visitId: id, serviceId, removedAt: null } })) {
        throw new ConflictException({
          code: 'DUPLICATE_SERVICE',
          message: `本次已登記「${service.name}」`,
        });
      }

      // 以就診日判斷療程是否有效（補登前幾天的就診也正確）
      const visitDay = isoDay(v.visitDate);
      const pkg = await this.packages.findUsableInTx(
        tx,
        v.patientId,
        serviceId,
        visitDay < today ? visitDay : today,
      );
      const deduction = pkg
        ? await this.packages.deductInTx(tx, {
            packageId: pkg.id,
            actorId: auth.staffId,
            date: visitDay,
            visitId: id,
          })
        : null;
      const vs = await tx.visitService.create({
        data: {
          visitId: id,
          serviceId,
          packageUsageId: deduction?.usage.id ?? null,
          createdById: auth.staffId,
        },
      });
      await this.audit.log(tx, auth, meta, 'visit.service.add', {
        resourceType: 'Visit',
        resourceId: id,
        patientId: v.patientId,
        metadata: {
          service: service.name,
          ...(deduction
            ? { packageId: pkg!.id, usageId: deduction.usage.id, remaining: deduction.remaining }
            : {}),
        },
      });
      return {
        id: vs.id,
        service: { id: service.id, name: service.name },
        packageName: pkg?.name ?? null,
        packageUsageId: deduction?.usage.id ?? null,
        packageRemaining: deduction?.remaining,
        createdAt: vs.createdAt.toISOString(),
      };
    });
  }

  async removeService(auth: AuthContext, id: string, visitServiceId: string, meta: RequestMeta) {
    await this.prisma.tenant(auth.clinicId, async (tx) => {
      const v = await this.lockVisit(tx, id);
      const vs = await tx.visitService.findFirst({
        where: { id: visitServiceId, visitId: id, removedAt: null },
      });
      if (!vs) throw new NotFoundException();
      await tx.visitService.update({
        where: { id: vs.id },
        data: { removedAt: new Date(), removedById: auth.staffId },
      });
      let reversalId: string | null = null;
      if (vs.packageUsageId) {
        const alreadyReversed = await tx.packageUsage.findFirst({
          where: { reversalOfId: vs.packageUsageId },
        });
        if (!alreadyReversed) {
          const { reversal } = await this.packages.reverseInTx(
            tx,
            vs.packageUsageId,
            auth.staffId,
            '移除服務項目',
          );
          reversalId = reversal.id;
        }
      }
      await this.audit.log(tx, auth, meta, 'visit.service.remove', {
        resourceType: 'Visit',
        resourceId: id,
        patientId: v.patientId,
        metadata: { visitServiceId, reversalId },
      });
    });
  }

  // ── 交接備註 ─────────────────────────────────────────────────────
  async addHandoff(auth: AuthContext, id: string, input: HandoffCreateInput, meta: RequestMeta) {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const v = await tx.visit.findFirst({ where: { id } });
      if (!v)
        throw new NotFoundException({ code: 'VISIT_NOT_FOUND', message: '找不到這筆就診紀錄' });
      const h = await tx.handoffNote.create({
        data: {
          visitId: id,
          body: input.body,
          targetRole: input.targetRole ?? null,
          authorId: auth.staffId,
        },
      });
      await this.audit.log(tx, auth, meta, 'visit.handoff.create', {
        resourceType: 'Visit',
        resourceId: id,
        patientId: v.patientId,
        metadata: { handoffId: h.id, targetRole: h.targetRole },
      });
      return { id: h.id };
    });
  }

  async resolveHandoff(auth: AuthContext, id: string, handoffId: string, meta: RequestMeta) {
    await this.prisma.tenant(auth.clinicId, async (tx) => {
      const h = await tx.handoffNote.findFirst({
        where: { id: handoffId, visitId: id },
        include: { visit: true },
      });
      if (!h) throw new NotFoundException();
      if (h.resolvedAt) return;
      if (
        h.targetRole &&
        h.targetRole !== auth.role &&
        auth.role !== 'ADMIN' &&
        h.authorId !== auth.staffId
      ) {
        throw new ForbiddenException({
          code: 'NOT_ADDRESSEE',
          message: '這則交接是留給其他職務的',
        });
      }
      await tx.handoffNote.update({
        where: { id: handoffId },
        data: { resolvedAt: new Date(), resolvedById: auth.staffId },
      });
      await this.audit.log(tx, auth, meta, 'visit.handoff.resolve', {
        resourceType: 'Visit',
        resourceId: id,
        patientId: h.visit.patientId,
        metadata: { handoffId },
      });
    });
  }
}
