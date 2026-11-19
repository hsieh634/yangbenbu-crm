import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { addDays, type DispenseItem, type dispenseCreateSchema } from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { ClinicTimeService } from '../../common/clinic-time.service';
import { dbDate, isoDay } from '../../common/dates';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { findPatientOrThrow } from '../patients/patients.service';

/**
 * 領藥紀錄。處方內容以 HIS 為準，這裡記錄「領了什麼、幾天份、下次何時可以領」，
 * 供櫃檯與健管師提醒回診領藥。登記錯誤以作廢處理，不刪除。
 */
@Injectable()
export class MedicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: ClinicTimeService,
    private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, patientId: string, meta: RequestMeta): Promise<DispenseItem[]> {
    const rows = await this.prisma.tenant(auth.clinicId, async (tx) => {
      await findPatientOrThrow(tx, patientId);
      const rows = await tx.medicationDispense.findMany({
        where: { patientId },
        orderBy: [{ dispensedOn: 'desc' }, { createdAt: 'desc' }],
        take: 200,
      });
      await this.audit.log(tx, auth, meta, 'medication.list', {
        resourceType: 'MedicationDispense',
        patientId,
        metadata: { returned: rows.length },
      });
      return rows;
    });
    const staffIds = [...new Set(rows.map((r) => r.createdById).filter((v): v is string => !!v))];
    const staff = new Map(
      (
        await this.prisma.staff.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, name: true },
        })
      ).map((s) => [s.id, s]),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      days: r.days,
      dispensedOn: isoDay(r.dispensedOn),
      nextEligibleOn: isoDay(r.nextEligibleOn),
      hisRxNo: r.hisRxNo,
      note: r.note,
      visitId: r.visitId,
      createdBy: r.createdById ? (staff.get(r.createdById) ?? null) : null,
      createdAt: r.createdAt.toISOString(),
      voidedAt: r.voidedAt?.toISOString() ?? null,
      voidReason: r.voidReason,
    }));
  }

  async create(
    auth: AuthContext,
    patientId: string,
    input: z.output<typeof dispenseCreateSchema>,
    meta: RequestMeta,
  ): Promise<{ id: string; nextEligibleOn: string }> {
    const today = await this.time.today(auth.clinicId);
    const dispensedOn = input.dispensedOn ?? today;
    if (dispensedOn > today) {
      throw new ConflictException({ code: 'FUTURE_DATE', message: '領藥日期不能晚於今天' });
    }
    const nextEligibleOn = addDays(dispensedOn, input.days);
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      await findPatientOrThrow(tx, patientId);
      if (
        input.visitId &&
        !(await tx.visit.findFirst({ where: { id: input.visitId, patientId } }))
      ) {
        throw new NotFoundException({
          code: 'VISIT_NOT_FOUND',
          message: '找不到這位病患的這筆就診',
        });
      }
      const d = await tx.medicationDispense.create({
        data: {
          patientId,
          visitId: input.visitId ?? null,
          name: input.name,
          days: input.days,
          dispensedOn: dbDate(dispensedOn),
          nextEligibleOn: dbDate(nextEligibleOn),
          hisRxNo: input.hisRxNo ?? null,
          note: input.note ?? null,
          createdById: auth.staffId,
        },
      });
      await this.audit.log(tx, auth, meta, 'medication.dispense', {
        resourceType: 'MedicationDispense',
        resourceId: d.id,
        patientId,
        metadata: { days: input.days, visitId: input.visitId ?? null },
      });
      return { id: d.id, nextEligibleOn };
    });
  }

  async void(auth: AuthContext, id: string, reason: string, meta: RequestMeta): Promise<void> {
    await this.prisma.tenant(auth.clinicId, async (tx) => {
      const d = await tx.medicationDispense.findFirst({ where: { id } });
      if (!d) throw new NotFoundException();
      if (d.voidedAt)
        throw new ConflictException({ code: 'ALREADY_VOIDED', message: '這筆紀錄已作廢' });
      await tx.medicationDispense.update({
        where: { id },
        data: { voidedAt: new Date(), voidedById: auth.staffId, voidReason: reason },
      });
      await this.audit.log(tx, auth, meta, 'medication.void', {
        resourceType: 'MedicationDispense',
        resourceId: id,
        patientId: d.patientId,
      });
    });
  }
}
