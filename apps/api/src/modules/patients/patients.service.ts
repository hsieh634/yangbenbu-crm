import { Injectable, NotFoundException } from '@nestjs/common';
import { decryptField, hashField, type Patient, type Prisma } from '@yangbenbu/db';
import {
  isValidTaiwanId,
  normalizeTaiwanId,
  type Paginated,
  type PatientDetail,
  type PatientListQuery,
  type PatientSummary,
} from '@yangbenbu/shared';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function maskedId(p: Patient): string | null {
  // 列表與詳情一律只回傳遮罩後的號碼；完整號碼必須另外呼叫 reveal（會留下稽核紀錄）
  return p.nationalIdLast4 ? `*******${p.nationalIdLast4.slice(-3)}` : null;
}

function toSummary(p: Patient): PatientSummary {
  return {
    id: p.id,
    chartNo: p.chartNo,
    name: p.name,
    gender: p.gender,
    birthDate: p.birthDate.toISOString().slice(0, 10),
    phone: p.phone,
    nationalIdMasked: maskedId(p),
    tags: p.tags,
  };
}

/**
 * 病患服務。Phase 0 只提供讀取，用來驗證三件事：
 * - 租戶隔離：所有查詢都在 withTenant 交易內，受 RLS 限制
 * - 欄位權限：依角色遮罩病史、身分證
 * - 稽核：讀取與稽核寫入在同一個交易，稽核失敗就不回傳資料
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private searchWhere(q?: string): Prisma.PatientWhereInput {
    const base: Prisma.PatientWhereInput = { deletedAt: null };
    if (!q) return base;
    if (isValidTaiwanId(q)) {
      return { ...base, nationalIdHash: hashField(normalizeTaiwanId(q)) };
    }
    const or: Prisma.PatientWhereInput[] = [
      { name: { contains: q } },
      { chartNo: { equals: q, mode: 'insensitive' } },
    ];
    if (/^\d{3,}$/.test(q)) or.push({ phone: { contains: q } });
    if (/^\d{4}$/.test(q)) or.push({ nationalIdLast4: q });
    return { ...base, OR: or };
  }

  async list(auth: AuthContext, query: PatientListQuery, meta: RequestMeta): Promise<Paginated<PatientSummary>> {
    const where = this.searchWhere(query.q);
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.patient.count({ where }),
        tx.patient.findMany({
          where,
          orderBy: { chartNo: 'asc' },
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
      ]);
      await this.audit.recordInTx(tx, {
        clinicId: auth.clinicId,
        actorStaffId: auth.staffId,
        actorRole: auth.role,
        action: 'patient.list',
        resourceType: 'Patient',
        outcome: 'SUCCESS',
        // 搜尋字串可能是身分證字號，只記錄長度不記錄內容
        metadata: { queryLength: query.q?.length ?? 0, page: query.page, returned: rows.length },
        meta,
      });
      return { items: rows.map(toSummary), total, page: query.page, pageSize: query.pageSize };
    });
  }

  async get(auth: AuthContext, id: string, meta: RequestMeta): Promise<PatientDetail> {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    const canReadMedical = auth.permissions.has('patient:read_medical');

    return this.prisma.tenant(auth.clinicId, async (tx) => {
      // 其他診所的病患在 RLS 下根本查不到，回應與「不存在」完全相同
      const p = await tx.patient.findFirst({ where: { id, deletedAt: null } });
      if (!p) throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: '找不到這位病患' });
      await this.audit.recordInTx(tx, {
        clinicId: auth.clinicId,
        actorStaffId: auth.staffId,
        actorRole: auth.role,
        action: 'patient.read',
        resourceType: 'Patient',
        resourceId: p.id,
        patientId: p.id,
        outcome: 'SUCCESS',
        metadata: { fields: canReadMedical ? ['basic', 'medical'] : ['basic'] },
        meta,
      });
      return {
        ...toSummary(p),
        allergies: canReadMedical ? p.allergies : null,
        medicalHistory: canReadMedical ? p.medicalHistory : null,
        createdAt: p.createdAt.toISOString(),
        updatedAt: p.updatedAt.toISOString(),
      };
    });
  }

  async revealNationalId(auth: AuthContext, id: string, meta: RequestMeta): Promise<{ nationalId: string | null }> {
    if (!UUID_RE.test(id)) throw new NotFoundException();
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const p = await tx.patient.findFirst({ where: { id, deletedAt: null } });
      if (!p) throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: '找不到這位病患' });
      await this.audit.recordInTx(tx, {
        clinicId: auth.clinicId,
        actorStaffId: auth.staffId,
        actorRole: auth.role,
        action: 'patient.reveal_national_id',
        resourceType: 'Patient',
        resourceId: p.id,
        patientId: p.id,
        outcome: 'SUCCESS',
        meta,
      });
      return { nationalId: p.nationalIdEnc ? decryptField(p.nationalIdEnc) : null };
    });
  }
}
