import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { PackageUsage, PatientPackage, TenantTx } from '@yangbenbu/db';
import {
  addDays,
  diffDays,
  type PackageStatus,
  type PatientPackageItem,
  type PackagePurchaseInput,
} from '@yangbenbu/shared';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { ClinicTimeService } from '../../common/clinic-time.service';
import { dbDate, isoDay } from '../../common/dates';
import { lockRow } from '../../common/locks';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { findPatientOrThrow } from '../patients/patients.service';

function sumUsed(usages: Pick<PackageUsage, 'quantity'>[]): number {
  return usages.reduce((s, u) => s + u.quantity, 0);
}

function statusOf(pkg: PatientPackage, used: number, today: string): PackageStatus {
  if (used >= pkg.totalSessions) return 'EXHAUSTED';
  if (isoDay(pkg.expiresOn) < today) return 'EXPIRED';
  return 'ACTIVE';
}

/**
 * 療程與扣堂。
 *
 * 剩餘堂數 = 總堂數 − 扣堂紀錄加總（扣堂 +1、沖銷 −1），不另存可能不一致的計數欄位。
 * 扣堂前以 SELECT … FOR UPDATE 鎖住療程，同時送出的扣堂請求會排隊，最後一堂不會被扣兩次。
 * 扣堂紀錄只能新增（資料庫 trigger 擋下修改與刪除），更正一律以沖銷處理。
 */
@Injectable()
export class PackagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly time: ClinicTimeService,
    private readonly audit: AuditService,
  ) {}

  async listForPatient(
    auth: AuthContext,
    patientId: string,
    meta: RequestMeta,
  ): Promise<PatientPackageItem[]> {
    const today = await this.time.today(auth.clinicId);
    const { packages, services } = await this.prisma.tenant(auth.clinicId, async (tx) => {
      await findPatientOrThrow(tx, patientId);
      const packages = await tx.patientPackage.findMany({
        where: { patientId },
        include: { usages: { orderBy: { createdAt: 'asc' } } },
        orderBy: { purchasedOn: 'desc' },
      });
      await this.audit.log(tx, auth, meta, 'package.list', {
        resourceType: 'PatientPackage',
        patientId,
        metadata: { returned: packages.length },
      });
      return {
        packages,
        services: new Map((await tx.service.findMany()).map((s) => [s.id, s.name])),
      };
    });
    const actorIds = [
      ...new Set(
        packages.flatMap((p) => p.usages.map((u) => u.actorId)).filter((v): v is string => !!v),
      ),
    ];
    const actors = new Map(
      (
        await this.prisma.staff.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, name: true },
        })
      ).map((s) => [s.id, s]),
    );

    return packages.map((p) => {
      const used = sumUsed(p.usages);
      const remaining = p.totalSessions - used;
      const reversedBy = new Map(
        p.usages.filter((u) => u.reversalOfId).map((u) => [u.reversalOfId!, u.id]),
      );
      const status = statusOf(p, used, today);
      return {
        id: p.id,
        name: p.name,
        service: { id: p.serviceId, name: services.get(p.serviceId) ?? '—' },
        totalSessions: p.totalSessions,
        usedSessions: used,
        remainingSessions: remaining,
        price: p.price,
        purchasedOn: isoDay(p.purchasedOn),
        expiresOn: isoDay(p.expiresOn),
        status,
        expiringSoon:
          status === 'ACTIVE' && (remaining <= 1 || diffDays(today, isoDay(p.expiresOn)) <= 30),
        note: p.note,
        usages: p.usages
          .map((u) => ({
            id: u.id,
            kind: u.kind,
            quantity: u.quantity,
            reason: u.reason,
            visitId: u.visitId,
            actor: u.actorId ? (actors.get(u.actorId) ?? null) : null,
            createdAt: u.createdAt.toISOString(),
            reversedById: reversedBy.get(u.id) ?? null,
            reversalOfId: u.reversalOfId,
          }))
          .reverse(),
      };
    });
  }

  async purchase(
    auth: AuthContext,
    patientId: string,
    input: PackagePurchaseInput & { note?: string | null },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    const purchasedOn = input.purchasedOn ?? (await this.time.today(auth.clinicId));
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      await findPatientOrThrow(tx, patientId);
      const plan = await tx.packagePlan.findFirst({ where: { id: input.planId, isActive: true } });
      if (!plan)
        throw new NotFoundException({
          code: 'PLAN_NOT_FOUND',
          message: '找不到療程方案或方案已停用',
        });
      const pkg = await tx.patientPackage.create({
        data: {
          patientId,
          planId: plan.id,
          name: plan.name,
          serviceId: plan.serviceId,
          totalSessions: plan.sessions,
          price: plan.price,
          purchasedOn: dbDate(purchasedOn),
          expiresOn: dbDate(addDays(purchasedOn, plan.validDays)),
          note: input.note ?? null,
          createdById: auth.staffId,
        },
      });
      await this.audit.log(tx, auth, meta, 'package.purchase', {
        resourceType: 'PatientPackage',
        resourceId: pkg.id,
        patientId,
        metadata: { plan: plan.name, sessions: plan.sessions, price: plan.price },
      });
      return { id: pkg.id };
    });
  }

  /**
   * 扣一堂（交易內使用）。呼叫端負責稽核。
   * 回傳 null 代表冪等鍵已用過，直接回傳先前那筆。
   */
  async deductInTx(
    tx: TenantTx,
    args: {
      packageId: string;
      actorId: string;
      date: string;
      visitId?: string | null;
      reason?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<{ usage: PackageUsage; remaining: number; replayed: boolean }> {
    if (!(await lockRow(tx, 'patient_package', args.packageId))) {
      throw new NotFoundException({ code: 'PACKAGE_NOT_FOUND', message: '找不到療程' });
    }
    const pkg = await tx.patientPackage.findUniqueOrThrow({
      where: { id: args.packageId },
      include: { usages: { select: { quantity: true } } },
    });
    const used = sumUsed(pkg.usages);

    // 同一個冪等鍵再送一次（例如網路逾時後重試）：回傳第一次的結果，不重複扣堂
    if (args.idempotencyKey) {
      const prior = await tx.packageUsage.findFirst({
        where: { idempotencyKey: args.idempotencyKey },
      });
      if (prior) {
        if (prior.packageId !== pkg.id) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: '冪等鍵已用於其他療程',
          });
        }
        return { usage: prior, remaining: pkg.totalSessions - used, replayed: true };
      }
    }

    if (isoDay(pkg.expiresOn) < args.date) {
      throw new ConflictException({
        code: 'PACKAGE_EXPIRED',
        message: `「${pkg.name}」已於 ${isoDay(pkg.expiresOn)} 到期`,
      });
    }
    if (isoDay(pkg.purchasedOn) > args.date) {
      throw new ConflictException({
        code: 'PACKAGE_NOT_STARTED',
        message: `「${pkg.name}」尚未開始`,
      });
    }
    if (used >= pkg.totalSessions) {
      throw new ConflictException({
        code: 'PACKAGE_EXHAUSTED',
        message: `「${pkg.name}」已無剩餘堂數`,
      });
    }
    const usage = await tx.packageUsage.create({
      data: {
        packageId: pkg.id,
        patientId: pkg.patientId,
        visitId: args.visitId ?? null,
        kind: 'DEDUCT',
        quantity: 1,
        reason: args.reason ?? null,
        idempotencyKey: args.idempotencyKey ?? null,
        actorId: args.actorId,
      },
    });
    return { usage, remaining: pkg.totalSessions - used - 1, replayed: false };
  }

  /** 找出可抵用某服務的療程：未過期、還有堂數，優先使用最早到期的 */
  async findUsableInTx(tx: TenantTx, patientId: string, serviceId: string, date: string) {
    const day = dbDate(date);
    const candidates = await tx.patientPackage.findMany({
      where: { patientId, serviceId, purchasedOn: { lte: day }, expiresOn: { gte: day } },
      include: { usages: { select: { quantity: true } } },
      orderBy: [{ expiresOn: 'asc' }, { purchasedOn: 'asc' }],
    });
    return candidates.find((p) => sumUsed(p.usages) < p.totalSessions) ?? null;
  }

  async deductManual(
    auth: AuthContext,
    packageId: string,
    reason: string,
    idempotencyKey: string,
    meta: RequestMeta,
  ) {
    const today = await this.time.today(auth.clinicId);
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const { usage, remaining, replayed } = await this.deductInTx(tx, {
        packageId,
        actorId: auth.staffId,
        date: today,
        reason,
        idempotencyKey,
      });
      if (!replayed) {
        await this.audit.log(tx, auth, meta, 'package.deduct', {
          resourceType: 'PatientPackage',
          resourceId: packageId,
          patientId: usage.patientId,
          metadata: { usageId: usage.id, manual: true, remaining },
        });
      }
      return { usageId: usage.id, remaining, replayed };
    });
  }

  /** 沖銷一筆扣堂（交易內使用）。每筆只能沖銷一次。 */
  async reverseInTx(tx: TenantTx, usageId: string, actorId: string, reason: string) {
    const usage = await tx.packageUsage.findFirst({ where: { id: usageId } });
    if (!usage) throw new NotFoundException({ code: 'USAGE_NOT_FOUND', message: '找不到扣堂紀錄' });
    await lockRow(tx, 'patient_package', usage.packageId);
    if (usage.kind !== 'DEDUCT') {
      throw new ConflictException({ code: 'NOT_REVERSIBLE', message: '沖銷紀錄不能再沖銷' });
    }
    if (await tx.packageUsage.findFirst({ where: { reversalOfId: usage.id } })) {
      throw new ConflictException({ code: 'ALREADY_REVERSED', message: '這筆扣堂已經沖銷過' });
    }
    const reversal = await tx.packageUsage.create({
      data: {
        packageId: usage.packageId,
        patientId: usage.patientId,
        visitId: usage.visitId,
        kind: 'REVERSAL',
        quantity: -1,
        reason,
        reversalOfId: usage.id,
        actorId,
      },
    });
    return { usage, reversal };
  }

  async reverse(auth: AuthContext, usageId: string, reason: string, meta: RequestMeta) {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const { usage, reversal } = await this.reverseInTx(tx, usageId, auth.staffId, reason);
      await this.audit.log(tx, auth, meta, 'package.reverse', {
        resourceType: 'PatientPackage',
        resourceId: usage.packageId,
        patientId: usage.patientId,
        metadata: { usageId: usage.id, reversalId: reversal.id },
      });
      return { reversalId: reversal.id };
    });
  }
}
