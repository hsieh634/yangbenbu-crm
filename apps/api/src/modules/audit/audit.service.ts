import { Injectable, Logger } from '@nestjs/common';
import { type AuditOutcome, type Prisma, type Role, type TenantTx } from '@yangbenbu/db';
import type { AuditLogEntry, AuditLogQuery, Paginated } from '@yangbenbu/shared';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { PrismaService } from '../../common/prisma.service';

export interface AuditEntry {
  clinicId: string | null;
  actorStaffId?: string | null;
  actorRole?: Role | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  patientId?: string;
  outcome: AuditOutcome;
  metadata?: Prisma.InputJsonValue;
  meta?: RequestMeta;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toData(e: AuditEntry): Prisma.AuditLogUncheckedCreateInput {
    return {
      clinicId: e.clinicId,
      actorStaffId: e.actorStaffId ?? null,
      actorRole: e.actorRole ?? null,
      action: e.action,
      resourceType: e.resourceType ?? null,
      resourceId: e.resourceId ?? null,
      patientId: e.patientId ?? null,
      outcome: e.outcome,
      metadata: e.metadata,
      ip: e.meta?.ip ?? null,
      userAgent: e.meta?.userAgent ?? null,
      requestId: e.meta?.requestId ?? null,
    };
  }

  /**
   * 在既有的租戶交易內寫入。讀取病患資料時使用：
   * 稽核寫入失敗，整個讀取就失敗——沒有留下紀錄，就不給資料。
   */
  async recordInTx(tx: TenantTx, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({ data: this.toData(entry) });
  }

  /** 以目前登入者身分寫入（業務操作的常用寫法） */
  async log(
    tx: TenantTx,
    auth: AuthContext,
    meta: RequestMeta,
    action: string,
    data: {
      resourceType: string;
      resourceId?: string;
      patientId?: string;
      metadata?: Prisma.InputJsonValue;
      outcome?: AuditOutcome;
    },
  ): Promise<void> {
    await this.recordInTx(tx, {
      clinicId: auth.clinicId,
      actorStaffId: auth.staffId,
      actorRole: auth.role,
      action,
      outcome: data.outcome ?? 'SUCCESS',
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      patientId: data.patientId,
      metadata: data.metadata,
      meta,
    });
  }

  /** 獨立寫入（登入事件、權限拒絕等），失敗只記錄錯誤、不影響回應 */
  async record(entry: AuditEntry): Promise<void> {
    try {
      if (entry.clinicId) {
        await this.prisma.tenant(entry.clinicId, (tx) => this.recordInTx(tx, entry));
      } else {
        await this.prisma.auditLog.create({ data: this.toData(entry) });
      }
    } catch (err) {
      this.logger.error({ err, action: entry.action }, '稽核紀錄寫入失敗');
    }
  }

  async list(clinicId: string, query: AuditLogQuery): Promise<Paginated<AuditLogEntry>> {
    const where: Prisma.AuditLogWhereInput = {
      action: query.action ? { startsWith: query.action } : undefined,
      patientId: query.patientId,
      actorStaffId: query.actorStaffId,
    };
    const { total, rows, patients } = await this.prisma.tenant(clinicId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.auditLog.count({ where }),
        tx.auditLog.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      // 病患姓名在同一個租戶交易內查詢，只會解析出本診所的病患
      const patientIds = [...new Set(rows.map((r) => r.patientId).filter((v): v is string => !!v))];
      const patients = await tx.patient.findMany({
        where: { id: { in: patientIds } },
        select: { id: true, name: true, chartNo: true },
      });
      return { total, rows, patients: new Map(patients.map((p) => [p.id, p])) };
    });

    const actorIds = [...new Set(rows.map((r) => r.actorStaffId).filter((v): v is string => !!v))];
    const actors = await this.prisma.staff.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, name: true },
    });
    const names = new Map(actors.map((a) => [a.id, a.name]));

    return {
      page: query.page,
      pageSize: query.pageSize,
      total,
      items: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actor: r.actorStaffId
          ? { id: r.actorStaffId, name: names.get(r.actorStaffId) ?? '（已刪除）' }
          : null,
        actorRole: r.actorRole,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        patientId: r.patientId,
        patient: r.patientId ? (patients.get(r.patientId) ?? null) : null,
        outcome: r.outcome,
        ip: r.ip,
        metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      })),
    };
  }
}
