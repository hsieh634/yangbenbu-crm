import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  decryptField,
  encryptField,
  hashField,
  type Patient,
  type Prisma,
  type TenantTx,
} from '@yangbenbu/db';
import {
  CONSENT_VERSION,
  isValidTaiwanId,
  normalizeTaiwanId,
  type ClinicalNote,
  type Paginated,
  type PatientCreateInput,
  type PatientDetail,
  type PatientFieldGroup,
  type PatientListQuery,
  type PatientSummary,
  type PatientUpdateInput,
  type PatientVisitItem,
  patientCreateSchema,
  patientUpdateSchema,
} from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { isoDay } from '../../common/dates';
import { advisoryLock } from '../../common/locks';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';

type CreateData = z.output<typeof patientCreateSchema>;
type UpdateData = z.output<typeof patientUpdateSchema>;

const CONTACT_FIELDS = [
  'email',
  'address',
  'emergencyContactName',
  'emergencyContactPhone',
] as const;
const MEDICAL_FIELDS = ['allergies', 'medicalHistory'] as const;

function maskedId(p: Patient): string | null {
  // 列表與詳情一律只回傳遮罩後的號碼；完整號碼必須另外呼叫 reveal（會留下稽核紀錄）
  return p.nationalIdLast4 ? `*******${p.nationalIdLast4.slice(-3)}` : null;
}

export function toPatientSummary(p: Patient): PatientSummary {
  return {
    id: p.id,
    chartNo: p.chartNo,
    name: p.name,
    gender: p.gender,
    birthDate: isoDay(p.birthDate),
    phone: p.phone,
    nationalIdMasked: maskedId(p),
    hasAllergy: p.hasAllergy,
    tags: p.tags,
  };
}

const decrypt = (v: string | null) => (v ? decryptField(v) : null);

/** 讀取病患時找不到（含別家診所的病患，RLS 下根本查不到）一律 404 */
export async function findPatientOrThrow(tx: TenantTx, id: string): Promise<Patient> {
  const p = await tx.patient.findFirst({ where: { id, deletedAt: null } });
  if (!p) throw new NotFoundException({ code: 'PATIENT_NOT_FOUND', message: '找不到這位病患' });
  return p;
}

/**
 * 病患服務。
 * - 租戶隔離：所有查詢都在 withTenant 交易內，受 RLS 限制
 * - 欄位權限：依角色遮罩聯絡資料、病史；編輯病史需要額外權限
 * - 稽核：讀寫與稽核在同一個交易，稽核失敗就不回傳資料；修改只記錄「改了哪些欄位」，不記錄內容
 */
@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private restrictedGroups(auth: AuthContext): PatientFieldGroup[] {
    const r: PatientFieldGroup[] = [];
    if (!auth.permissions.has('patient:read_contact')) r.push('contact');
    if (!auth.permissions.has('patient:read_medical')) r.push('medical');
    return r;
  }

  toDetail(auth: AuthContext, p: Patient): PatientDetail {
    const restricted = this.restrictedGroups(auth);
    const contact = !restricted.includes('contact');
    const medical = !restricted.includes('medical');
    return {
      ...toPatientSummary(p),
      email: contact ? p.email : null,
      address: contact ? p.address : null,
      emergencyContactName: contact ? p.emergencyContactName : null,
      emergencyContactPhone: contact ? p.emergencyContactPhone : null,
      source: p.source,
      allergies: medical ? decrypt(p.allergiesEnc) : null,
      medicalHistory: medical ? decrypt(p.medicalHistoryEnc) : null,
      consentSignedAt: p.consentSignedAt?.toISOString() ?? null,
      consentVersion: p.consentVersion,
      consentOutdated: !!p.consentVersion && p.consentVersion !== CONSENT_VERSION,
      restricted,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    };
  }

  private searchWhere(query: PatientListQuery): Prisma.PatientWhereInput {
    const base: Prisma.PatientWhereInput = {
      deletedAt: null,
      tags: query.tag ? { has: query.tag } : undefined,
    };
    const q = query.q;
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

  async list(
    auth: AuthContext,
    query: PatientListQuery,
    meta: RequestMeta,
  ): Promise<Paginated<PatientSummary>> {
    const where = this.searchWhere(query);
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
      await this.audit.log(tx, auth, meta, 'patient.list', {
        resourceType: 'Patient',
        // 搜尋字串可能是身分證字號，只記錄長度不記錄內容
        metadata: {
          queryLength: query.q?.length ?? 0,
          tag: query.tag ?? null,
          page: query.page,
          returned: rows.length,
        },
      });
      return {
        items: rows.map(toPatientSummary),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  async get(auth: AuthContext, id: string, meta: RequestMeta): Promise<PatientDetail> {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const p = await findPatientOrThrow(tx, id);
      const restricted = this.restrictedGroups(auth);
      await this.audit.log(tx, auth, meta, 'patient.read', {
        resourceType: 'Patient',
        resourceId: p.id,
        patientId: p.id,
        metadata: {
          fields: ['basic', 'contact', 'medical'].filter(
            (g) => !restricted.includes(g as PatientFieldGroup),
          ),
        },
      });
      return this.toDetail(auth, p);
    });
  }

  /** 身分證字號重複建檔檢查（同一家診所內） */
  private async assertNationalIdFree(tx: TenantTx, hash: string, exceptId?: string) {
    const dup = await tx.patient.findFirst({
      where: { nationalIdHash: hash, id: exceptId ? { not: exceptId } : undefined },
      select: { chartNo: true },
    });
    if (dup) {
      throw new ConflictException({
        code: 'DUPLICATE_NATIONAL_ID',
        message: `此身分證字號已建檔（病歷號 ${dup.chartNo}）`,
      });
    }
  }

  /** 病歷號：未指定時取「P + 流水號」的下一號；以 advisory lock 避免兩人同時建檔拿到同一號 */
  private async nextChartNo(tx: TenantTx, clinicId: string): Promise<string> {
    await advisoryLock(tx, `chart-no:${clinicId}`);
    const rows = await tx.$queryRaw<{ max: number | null }[]>`
      SELECT max(substring(chart_no from 2)::int) AS max
      FROM patient WHERE chart_no ~ '^P[0-9]{1,9}$'`;
    return `P${String((rows[0]?.max ?? 0) + 1).padStart(5, '0')}`;
  }

  private assertFieldPermissions(
    auth: AuthContext,
    input: PatientUpdateInput | PatientCreateInput,
  ) {
    const touchesMedical = MEDICAL_FIELDS.some((f) => input[f] !== undefined && input[f] !== null);
    if (touchesMedical && !auth.permissions.has('patient:write_medical')) {
      throw new ForbiddenException({
        code: 'FIELD_FORBIDDEN',
        message: '您的角色不能編輯病史與過敏，請由醫師填寫',
      });
    }
  }

  async create(auth: AuthContext, input: CreateData, meta: RequestMeta): Promise<PatientDetail> {
    this.assertFieldPermissions(auth, input);
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const nationalIdHash = input.nationalId ? hashField(input.nationalId) : null;
      if (nationalIdHash) await this.assertNationalIdFree(tx, nationalIdHash);

      const chartNo = input.chartNo ?? (await this.nextChartNo(tx, auth.clinicId));
      if (input.chartNo && (await tx.patient.findFirst({ where: { chartNo } }))) {
        throw new ConflictException({
          code: 'DUPLICATE_CHART_NO',
          message: `病歷號 ${chartNo} 已被使用`,
        });
      }

      const p = await tx.patient.create({
        data: {
          chartNo,
          name: input.name,
          gender: input.gender,
          birthDate: new Date(`${input.birthDate}T00:00:00Z`),
          phone: input.phone,
          email: input.email ?? null,
          address: input.address ?? null,
          emergencyContactName: input.emergencyContactName ?? null,
          emergencyContactPhone: input.emergencyContactPhone ?? null,
          source: input.source ?? null,
          nationalIdEnc: input.nationalId ? encryptField(input.nationalId) : null,
          nationalIdHash,
          nationalIdLast4: input.nationalId?.slice(-4) ?? null,
          allergiesEnc: input.allergies ? encryptField(input.allergies) : null,
          hasAllergy: !!input.allergies,
          medicalHistoryEnc: input.medicalHistory ? encryptField(input.medicalHistory) : null,
          tags: input.tags ?? [],
          consentSignedAt: input.consentSigned ? new Date() : null,
          consentVersion: input.consentSigned ? CONSENT_VERSION : null,
          createdById: auth.staffId,
          updatedById: auth.staffId,
        },
      });
      await this.audit.log(tx, auth, meta, 'patient.create', {
        resourceType: 'Patient',
        resourceId: p.id,
        patientId: p.id,
        metadata: {
          chartNo,
          fields: Object.keys(input).filter((k) => input[k as keyof CreateData] != null),
        },
      });
      return this.toDetail(auth, p);
    });
  }

  async update(
    auth: AuthContext,
    id: string,
    input: UpdateData,
    meta: RequestMeta,
  ): Promise<PatientDetail> {
    this.assertFieldPermissions(auth, input);
    // 看不到聯絡資料的角色也不能修改（避免盲改）
    if (
      CONTACT_FIELDS.some((f) => input[f] !== undefined) &&
      !auth.permissions.has('patient:read_contact')
    ) {
      throw new ForbiddenException({
        code: 'FIELD_FORBIDDEN',
        message: '您的角色不能編輯聯絡資料',
      });
    }
    // 清除病史也需要權限
    if (
      MEDICAL_FIELDS.some((f) => input[f] === null) &&
      !auth.permissions.has('patient:write_medical')
    ) {
      throw new ForbiddenException({
        code: 'FIELD_FORBIDDEN',
        message: '您的角色不能編輯病史與過敏',
      });
    }

    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const before = await findPatientOrThrow(tx, id);
      const data: Record<string, unknown> = { updatedById: auth.staffId };
      const changed: string[] = [];
      const set = (field: string, value: unknown, same: boolean) => {
        if (same) return;
        data[field] = value;
        changed.push(field);
      };

      if (input.name !== undefined) set('name', input.name, input.name === before.name);
      if (input.gender !== undefined) set('gender', input.gender, input.gender === before.gender);
      if (input.birthDate !== undefined)
        set(
          'birthDate',
          new Date(`${input.birthDate}T00:00:00Z`),
          input.birthDate === isoDay(before.birthDate),
        );
      if (input.phone !== undefined) set('phone', input.phone, input.phone === before.phone);
      for (const f of [...CONTACT_FIELDS, 'source'] as const) {
        const v = input[f];
        if (v !== undefined) set(f, v, v === before[f]);
      }
      if (input.tags !== undefined) {
        const same =
          JSON.stringify([...input.tags].sort()) === JSON.stringify([...before.tags].sort());
        set('tags', input.tags, same);
      }
      if (input.nationalId !== undefined) {
        const hash = input.nationalId ? hashField(input.nationalId) : null;
        if (hash !== before.nationalIdHash) {
          if (hash) await this.assertNationalIdFree(tx, hash, id);
          Object.assign(data, {
            nationalIdEnc: input.nationalId ? encryptField(input.nationalId) : null,
            nationalIdHash: hash,
            nationalIdLast4: input.nationalId?.slice(-4) ?? null,
          });
          changed.push('nationalId');
        }
      }
      if (input.allergies !== undefined && input.allergies !== decrypt(before.allergiesEnc)) {
        Object.assign(data, {
          allergiesEnc: input.allergies ? encryptField(input.allergies) : null,
          hasAllergy: !!input.allergies,
        });
        changed.push('allergies');
      }
      if (
        input.medicalHistory !== undefined &&
        input.medicalHistory !== decrypt(before.medicalHistoryEnc)
      ) {
        Object.assign(data, {
          medicalHistoryEnc: input.medicalHistory ? encryptField(input.medicalHistory) : null,
        });
        changed.push('medicalHistory');
      }
      if (input.consentSigned && before.consentVersion !== CONSENT_VERSION) {
        Object.assign(data, { consentSignedAt: new Date(), consentVersion: CONSENT_VERSION });
        changed.push('consent');
      }

      if (changed.length === 0) return this.toDetail(auth, before);
      const p = await tx.patient.update({
        where: { id },
        data: data as Prisma.PatientUncheckedUpdateInput,
      });
      await this.audit.log(tx, auth, meta, 'patient.update', {
        resourceType: 'Patient',
        resourceId: id,
        patientId: id,
        // 只記錄欄位名稱；標籤不是個資，記錄前後值方便追查
        metadata: {
          changed,
          ...(changed.includes('tags') ? { tags: { from: before.tags, to: p.tags } } : {}),
        },
      });
      return this.toDetail(auth, p);
    });
  }

  /** 軟刪除：病歷須保存，只是不再出現在列表；未來的預約一併取消 */
  async remove(auth: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await this.prisma.tenant(auth.clinicId, async (tx) => {
      await findPatientOrThrow(tx, id);
      await tx.patient.update({
        where: { id },
        data: { deletedAt: new Date(), updatedById: auth.staffId },
      });
      const { count } = await tx.appointment.updateMany({
        where: {
          patientId: id,
          status: { in: ['BOOKED', 'CONFIRMED'] },
          startAt: { gt: new Date() },
        },
        data: { status: 'CANCELLED', cancelReason: '病患資料已刪除', cancelledAt: new Date() },
      });
      await this.audit.log(tx, auth, meta, 'patient.delete', {
        resourceType: 'Patient',
        resourceId: id,
        patientId: id,
        metadata: { cancelledAppointments: count },
      });
    });
  }

  async revealNationalId(
    auth: AuthContext,
    id: string,
    meta: RequestMeta,
  ): Promise<{ nationalId: string | null }> {
    return this.prisma.tenant(auth.clinicId, async (tx) => {
      const p = await findPatientOrThrow(tx, id);
      await this.audit.log(tx, auth, meta, 'patient.reveal_national_id', {
        resourceType: 'Patient',
        resourceId: p.id,
        patientId: p.id,
      });
      return { nationalId: decrypt(p.nationalIdEnc) };
    });
  }

  /** 就診紀錄時間軸；醫師欄位摘要只給有 visit:read 的角色 */
  async visits(auth: AuthContext, id: string, meta: RequestMeta): Promise<PatientVisitItem[]> {
    const canReadClinical = auth.permissions.has('visit:read');
    const { rows, services } = await this.prisma.tenant(auth.clinicId, async (tx) => {
      await findPatientOrThrow(tx, id);
      const rows = await tx.visit.findMany({
        where: { patientId: id },
        orderBy: { checkedInAt: 'desc' },
        take: 100,
        include: {
          services: { where: { removedAt: null } },
          doctor: { select: { id: true, name: true } },
        },
      });
      const services = new Map(
        (await tx.service.findMany({ select: { id: true, name: true } })).map((s) => [
          s.id,
          s.name,
        ]),
      );
      await this.audit.log(tx, auth, meta, 'patient.visits.read', {
        resourceType: 'Patient',
        resourceId: id,
        patientId: id,
        metadata: { returned: rows.length, clinical: canReadClinical },
      });
      return { rows, services };
    });
    return rows.map((v) => {
      const note =
        canReadClinical && v.clinicalNoteEnc
          ? (JSON.parse(decryptField(v.clinicalNoteEnc)) as ClinicalNote)
          : null;
      return {
        id: v.id,
        visitDate: isoDay(v.visitDate),
        status: v.status,
        doctor: v.doctor,
        services: v.services.map((s) => services.get(s.serviceId) ?? '—'),
        pattern: note?.pattern ?? null,
        chiefComplaint: note?.chiefComplaint ?? null,
      };
    });
  }
}
