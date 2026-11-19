/**
 * 示範資料產生器。所有人名、診所、身分證字號皆為虛構（身分證字號只符合檢查碼規則）。
 *
 * - `seed.ts` 用它建立初始資料
 * - Worker 在示範模式（DEMO_MODE=true）每 10 分鐘呼叫 `runDemoTick`：
 *   補上未來幾天的預約，並依照現在時間推進「今天」的示範預約（報到 → 看診 → 療程 → 完成），
 *   讓公開的 Demo 站任何時候打開，今日看板都有正在進行的病患。
 *
 * 只會動到示範產生器自己建立的資料（appointment.is_demo = true，且沒有被真人操作過），
 * 使用者在 Demo 站上的操作不會被覆蓋。所有寫入都經過 withTenant，同樣受 RLS 限制。
 */
import type {
  Gender,
  Prisma,
  PrismaClient,
  Role,
  ServiceCategory,
  VisitStatus,
} from '@prisma/client';
import {
  addDays,
  localDate,
  weekdayOf,
  zonedDateTime,
  CONSENT_VERSION,
  DEFAULT_TIMEZONE,
} from '@yangbenbu/shared';
import { encryptField, hashField } from './field-crypto';
import { hashPassword } from './password';
import { withTenant, type TenantTx } from './tenant';

export const DEMO_PASSWORD = 'Demo1234!';

// ── 亂數：固定種子，讓每次產生的資料一致（測試與截圖可重現）──────────────
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

type Rng = () => number;
const pick = <T>(rng: Rng, arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)]!;
const int = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

// ── 素材 ────────────────────────────────────────────────────────────
const SURNAMES = '陳林黃張李王吳劉蔡楊許鄭謝郭洪曾邱廖賴周'.split('');
const GIVEN_F = [
  '淑芬',
  '美玲',
  '雅婷',
  '怡君',
  '佳穎',
  '詩涵',
  '宜蓁',
  '欣怡',
  '惠美',
  '靜宜',
  '筱婷',
  '思妤',
];
const GIVEN_M = [
  '志明',
  '俊傑',
  '建宏',
  '冠宇',
  '家豪',
  '承恩',
  '宗翰',
  '柏宇',
  '文雄',
  '國華',
  '彥廷',
  '士豪',
];
const ALLERGIES = [null, null, null, null, '盤尼西林', '花生', '海鮮', '阿斯匹靈'];
const HISTORIES = [
  null,
  null,
  '高血壓',
  '第二型糖尿病',
  '偏頭痛',
  '慢性胃炎',
  '失眠',
  '過敏性鼻炎',
  '甲狀腺機能低下',
];
const TAGS = ['針灸療程', 'VIP', '長期調理', '產後調理', '失眠調理', '體重管理'];
const SOURCES = ['親友介紹', 'Google 搜尋', '路過', 'LINE 官方帳號', 'Facebook', null];
const DISTRICTS = ['台北市大安區', '台北市中山區', '新北市板橋區', '新北市永和區', '台北市信義區'];
const ID_LETTERS = 'ABCDEFGHJKLMNPQRSTUVXYWZIO';
const ID_CODES: Record<string, number> = {
  A: 10,
  B: 11,
  C: 12,
  D: 13,
  E: 14,
  F: 15,
  G: 16,
  H: 17,
  I: 34,
  J: 18,
  K: 19,
  L: 20,
  M: 21,
  N: 22,
  O: 35,
  P: 23,
  Q: 24,
  R: 25,
  S: 26,
  T: 27,
  U: 28,
  V: 29,
  W: 32,
  X: 30,
  Y: 31,
  Z: 33,
};

const COMPLAINTS = [
  '肩頸痠痛兩週，低頭工作後加劇',
  '失眠、多夢一個月，易醒',
  '經期不規律，經前腹脹',
  '腰痠，久坐後明顯',
  '胃脹、食慾差，飯後明顯',
  '容易疲倦、手腳冰冷',
  '過敏性鼻炎發作，晨起噴嚏',
  '頭痛反覆，壓力大時加重',
];
const PATTERNS: [string, string][] = [
  ['肝鬱氣滯', '疏肝理氣'],
  ['心脾兩虛', '補益心脾'],
  ['腎陽虛', '溫補腎陽'],
  ['脾胃虛弱', '健脾和胃'],
  ['氣血兩虛', '益氣養血'],
  ['痰濕內阻', '化痰祛濕'],
  ['肝陽上亢', '平肝潛陽'],
];
const TONGUE = ['舌淡紅苔薄白', '舌淡胖有齒痕', '舌紅少苔', '舌暗有瘀點', '舌淡苔白膩'];
const PULSE = ['脈弦細', '脈沉細', '脈細弱', '脈滑', '脈弦'];
const ADVICE = [
  '避免生冷飲食，晚上 11 點前就寢',
  '每日溫水泡腳 15 分鐘',
  '減少久坐，每小時起身活動 5 分鐘',
  '少油炸辛辣，三餐定時',
  '睡前一小時避免使用手機',
];
const DISPENSES: [string, number][] = [
  ['科學中藥 7 日份', 7],
  ['科學中藥 14 日份', 14],
  ['水煎藥 5 帖', 5],
];
const HANDOFFS: [string, Role | null][] = [
  ['左肩針灸後請熱敷 10 分鐘', 'CLINICAL_ASSISTANT'],
  ['初診，請協助確認個資同意書', 'FRONT_DESK'],
  ['病患表示今天趕時間，請優先處理', null],
  ['療程剩 1 堂，結帳時請詢問是否續購', 'FRONT_DESK'],
  ['拔罐後請提醒 4 小時內不要洗澡', 'CLINICAL_ASSISTANT'],
];

// ── 診所、員工、診所設定 ──────────────────────────────────────────────
export const DEMO_CLINICS = [
  { slug: 'demo-yangben', name: '養本堂中醫診所（示範）', patientCount: 80 },
  { slug: 'demo-qinghe', name: '青禾中醫診所（示範）', patientCount: 20 },
] as const;
type ClinicSlug = (typeof DEMO_CLINICS)[number]['slug'];

export const DEMO_STAFF: {
  email: string;
  name: string;
  roles: Partial<Record<ClinicSlug, Role>>;
}[] = [
  { email: 'admin@yangbenbu.demo', name: '林雅文', roles: { 'demo-yangben': 'ADMIN' } },
  {
    email: 'doctor@yangbenbu.demo',
    name: '陳柏翰',
    roles: { 'demo-yangben': 'DOCTOR', 'demo-qinghe': 'DOCTOR' },
  },
  { email: 'doctor2@yangbenbu.demo', name: '許心怡', roles: { 'demo-yangben': 'DOCTOR' } },
  { email: 'frontdesk@yangbenbu.demo', name: '張曉芸', roles: { 'demo-yangben': 'FRONT_DESK' } },
  {
    email: 'assistant@yangbenbu.demo',
    name: '黃志明',
    roles: { 'demo-yangben': 'CLINICAL_ASSISTANT' },
  },
  { email: 'health@yangbenbu.demo', name: '吳佩珊', roles: { 'demo-yangben': 'HEALTH_MANAGER' } },
  { email: 'admin.qinghe@yangbenbu.demo', name: '李俊宏', roles: { 'demo-qinghe': 'ADMIN' } },
];

const ROOMS = ['診間一', '診間二', '針灸室', '推拿室'];

const SERVICES: {
  code: string;
  name: string;
  category: ServiceCategory;
  durationMinutes: number;
}[] = [
  { code: 'CONSULT', name: '看診', category: 'CONSULTATION', durationMinutes: 10 },
  { code: 'ACU', name: '針灸', category: 'ACUPUNCTURE', durationMinutes: 30 },
  { code: 'TUINA', name: '推拿', category: 'TUINA', durationMinutes: 30 },
  { code: 'CUP', name: '拔罐', category: 'CUPPING', durationMinutes: 20 },
  { code: 'MOXA', name: '艾灸', category: 'MOXIBUSTION', durationMinutes: 20 },
];
const TREATMENT_CODES = ['ACU', 'TUINA', 'CUP', 'MOXA'];

const PLANS = [
  { name: '針灸 10 堂', serviceCode: 'ACU', sessions: 10, validDays: 180, price: 8000 },
  { name: '推拿 6 堂', serviceCode: 'TUINA', sessions: 6, validDays: 120, price: 6000 },
  { name: '拔罐 5 堂', serviceCode: 'CUP', sessions: 5, validDays: 90, price: 2500 },
];

/** [星期幾, 開始, 結束]（分鐘）；每 15 分鐘一個時段，每時段 2 人 */
type Block = [number, number, number];
const MORNING = (d: number): Block => [d, 9 * 60, 12 * 60];
const AFTERNOON = (d: number): Block => [d, 14 * 60 + 30, 17 * 60 + 30];
const EVENING = (d: number): Block => [d, 18 * 60, 21 * 60];
const SCHEDULES: Record<string, Record<string, { room: string; blocks: Block[] }>> = {
  'demo-yangben': {
    'doctor@yangbenbu.demo': {
      room: '診間一',
      blocks: [1, 2, 3, 4, 5, 6].map(MORNING).concat([1, 3, 5].map(AFTERNOON), [2, 4].map(EVENING)),
    },
    'doctor2@yangbenbu.demo': {
      room: '診間二',
      blocks: [0, 1, 2, 3, 4, 5].map(MORNING).concat([2, 4].map(AFTERNOON), [1, 3, 5].map(EVENING)),
    },
  },
  'demo-qinghe': {
    'doctor@yangbenbu.demo': { room: '診間一', blocks: [0, 2, 4, 6].map(MORNING) },
  },
};
const SLOT_MINUTES = 15;
const SLOT_CAPACITY = 2;

// ── 產生病患 ─────────────────────────────────────────────────────────
function fakeNationalId(rng: Rng, gender: Gender): string {
  const letter = pick(rng, ID_LETTERS.split(''));
  const body = `${gender === 'MALE' ? 1 : 2}${Array.from({ length: 7 }, () => int(rng, 0, 9)).join('')}`;
  const code = ID_CODES[letter]!;
  const digits = [Math.floor(code / 10), code % 10, ...body.split('').map(Number)];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0);
  return `${letter}${body}${(10 - (sum % 10)) % 10}`;
}

function fakePatient(rng: Rng, index: number) {
  const gender: Gender = rng() < 0.62 ? 'FEMALE' : 'MALE';
  const nationalId = fakeNationalId(rng, gender);
  const allergies = pick(rng, ALLERGIES);
  const history = pick(rng, HISTORIES);
  const tags = Array.from(new Set([pick(rng, TAGS), ...(rng() < 0.3 ? [pick(rng, TAGS)] : [])]));
  const name = pick(rng, SURNAMES) + pick(rng, gender === 'FEMALE' ? GIVEN_F : GIVEN_M);
  const consented = rng() < 0.85;
  return {
    chartNo: `P${String(index).padStart(5, '0')}`,
    name,
    gender,
    birthDate: new Date(Date.UTC(int(rng, 1950, 2005), int(rng, 0, 11), int(rng, 1, 28))),
    phone: `09${String(int(rng, 10000000, 99999999))}`,
    email: rng() < 0.5 ? `patient${index}@example.com` : null,
    address: `${pick(rng, DISTRICTS)}示範路 ${int(rng, 1, 300)} 號`,
    emergencyContactName: rng() < 0.6 ? `${name.slice(0, 1)}先生／小姐` : null,
    emergencyContactPhone: rng() < 0.6 ? `09${String(int(rng, 10000000, 99999999))}` : null,
    source: pick(rng, SOURCES),
    nationalIdEnc: encryptField(nationalId),
    nationalIdHash: hashField(nationalId),
    nationalIdLast4: nationalId.slice(-4),
    allergiesEnc: allergies ? encryptField(allergies) : null,
    hasAllergy: !!allergies,
    medicalHistoryEnc: history ? encryptField(history) : null,
    tags,
    consentSignedAt: consented ? new Date(Date.now() - int(rng, 30, 400) * 86_400_000) : null,
    consentVersion: consented ? CONSENT_VERSION : null,
  };
}

// ── 診所情境 ─────────────────────────────────────────────────────────
interface ClinicCtx {
  id: string;
  slug: string;
  tz: string;
  services: Map<string, { id: string; code: string }>;
  serviceById: Map<string, string>;
  rooms: Map<string, string>;
  doctors: { id: string; email: string; room: string; blocks: Block[] }[];
  staffByRole: Partial<Record<Role, string>>;
}

async function loadClinicCtx(prisma: PrismaClient, slug: string): Promise<ClinicCtx> {
  const clinic = await prisma.clinic.findUniqueOrThrow({ where: { slug } });
  const memberships = await prisma.clinicMembership.findMany({
    where: { clinicId: clinic.id },
    include: { staff: true },
  });
  const { services, rooms } = await withTenant(prisma, clinic.id, async (tx) => ({
    services: await tx.service.findMany(),
    rooms: await tx.room.findMany(),
  }));
  const schedules = SCHEDULES[slug] ?? {};
  const staffByRole: Partial<Record<Role, string>> = {};
  for (const m of memberships) staffByRole[m.role] ??= m.staffId;
  return {
    id: clinic.id,
    slug,
    tz: clinic.timezone || DEFAULT_TIMEZONE,
    services: new Map(services.map((s) => [s.code, { id: s.id, code: s.code }])),
    serviceById: new Map(services.map((s) => [s.id, s.code])),
    rooms: new Map(rooms.map((r) => [r.name, r.id])),
    doctors: memberships
      .filter((m) => m.role === 'DOCTOR' && schedules[m.staff.email])
      .map((m) => ({ id: m.staffId, email: m.staff.email, ...schedules[m.staff.email]! })),
    staffByRole,
  };
}

async function ensureCatalog(
  tx: TenantTx,
  clinicId: string,
  slug: string,
  doctorIds: Map<string, string>,
) {
  for (const [i, name] of ROOMS.entries()) {
    await tx.room.upsert({
      where: { clinicId_name: { clinicId, name } },
      update: {},
      create: { name, sortOrder: i },
    });
  }
  const serviceIds = new Map<string, string>();
  for (const [i, s] of SERVICES.entries()) {
    const row = await tx.service.upsert({
      where: { clinicId_code: { clinicId, code: s.code } },
      update: {},
      create: { ...s, sortOrder: i },
    });
    serviceIds.set(s.code, row.id);
  }
  if ((await tx.packagePlan.count()) === 0) {
    await tx.packagePlan.createMany({
      data: PLANS.map(({ serviceCode, ...p }) => ({
        ...p,
        serviceId: serviceIds.get(serviceCode)!,
      })),
    });
  }
  if ((await tx.doctorSchedule.count()) === 0) {
    const rooms = new Map((await tx.room.findMany()).map((r) => [r.name, r.id]));
    for (const [email, def] of Object.entries(SCHEDULES[slug] ?? {})) {
      const doctorId = doctorIds.get(email);
      if (!doctorId) continue;
      await tx.doctorSchedule.createMany({
        data: def.blocks.map(([weekday, startMinute, endMinute]) => ({
          doctorId,
          weekday,
          startMinute,
          endMinute,
          slotMinutes: SLOT_MINUTES,
          capacity: SLOT_CAPACITY,
          roomId: rooms.get(def.room) ?? null,
        })),
      });
    }
  }
}

/** 為部分病患建立療程（購買於 50–90 天前，歷史就診會從這裡扣堂） */
async function ensurePackages(tx: TenantTx, ctx: ClinicCtx, today: string, rng: Rng) {
  if ((await tx.patientPackage.count()) > 0) return;
  const plans = await tx.packagePlan.findMany();
  const patients = await tx.patient.findMany({
    select: { id: true, tags: true },
    orderBy: { chartNo: 'asc' },
  });
  for (const p of patients) {
    const wants = p.tags.includes('針灸療程') || p.tags.includes('長期調理') ? 0.9 : 0.3;
    if (rng() > wants) continue;
    const plan = p.tags.includes('針灸療程')
      ? plans.find((x) => x.name.startsWith('針灸'))!
      : pick(rng, plans);
    const purchasedOn = addDays(today, -int(rng, 50, 90));
    await tx.patientPackage.create({
      data: {
        patientId: p.id,
        planId: plan.id,
        name: plan.name,
        serviceId: plan.serviceId,
        totalSessions: plan.sessions,
        price: plan.price,
        purchasedOn: new Date(purchasedOn),
        expiresOn: new Date(addDays(purchasedOn, plan.validDays)),
        createdById: ctx.staffByRole.FRONT_DESK ?? null,
      },
    });
  }
}

// ── 一天的示範預約 ───────────────────────────────────────────────────
async function generateDay(tx: TenantTx, ctx: ClinicCtx, date: string, fill: number) {
  const dayStart = zonedDateTime(date, 0, ctx.tz);
  const dayEnd = zonedDateTime(addDays(date, 1), 0, ctx.tz);
  const exists = await tx.appointment.count({
    where: { isDemo: true, startAt: { gte: dayStart, lt: dayEnd } },
  });
  if (exists > 0) return 0;

  const rng = mulberry32(hashString(`${ctx.slug}:${date}`));
  const weekday = weekdayOf(date);
  const patients = await tx.patient.findMany({
    where: { deletedAt: null },
    select: { id: true, packages: { select: { serviceId: true, expiresOn: true } } },
    orderBy: { chartNo: 'asc' },
  });
  // 同一位病患一天只排一次
  const pool = [...patients].sort(() => rng() - 0.5);
  const booked = new Set(
    (
      await tx.appointment.findMany({
        where: { startAt: { gte: dayStart, lt: dayEnd }, status: { not: 'CANCELLED' } },
        select: { patientId: true },
      })
    ).map((a) => a.patientId),
  );

  const consult = ctx.services.get('CONSULT')!.id;
  const rows: Prisma.AppointmentCreateManyInput[] = [];
  for (const doctor of ctx.doctors) {
    for (const [wd, start, end] of doctor.blocks) {
      if (wd !== weekday) continue;
      for (let m = start; m < end; m += SLOT_MINUTES) {
        for (let seat = 0; seat < SLOT_CAPACITY; seat++) {
          if (rng() > fill) continue;
          const patient = pool.find((p) => !booked.has(p.id));
          if (!patient) break;
          booked.add(patient.id);
          const pkg = patient.packages.find((x) => x.expiresOn.toISOString().slice(0, 10) >= date);
          const serviceId =
            pkg && rng() < 0.75
              ? pkg.serviceId
              : rng() < 0.7
                ? consult
                : ctx.services.get(pick(rng, TREATMENT_CODES))!.id;
          const startAt = zonedDateTime(date, m, ctx.tz);
          rows.push({
            patientId: patient.id,
            doctorId: doctor.id,
            serviceId,
            roomId: ctx.rooms.get(doctor.room) ?? null,
            startAt,
            endAt: new Date(startAt.getTime() + SLOT_MINUTES * 60_000),
            status: rng() < 0.4 ? 'CONFIRMED' : 'BOOKED',
            source: pick(rng, ['FRONT_DESK', 'PHONE', 'PHONE', 'LINE'] as const),
            isDemo: true,
            createdById: ctx.staffByRole.FRONT_DESK ?? null,
            createdAt: new Date(startAt.getTime() - int(rng, 1, 14) * 86_400_000),
          });
        }
      }
    }
  }
  if (rows.length) await tx.appointment.createMany({ data: rows });
  return rows.length;
}

// ── 依照現在時間推進示範預約 ─────────────────────────────────────────
const FLOW: VisitStatus[] = [
  'CHECKED_IN',
  'WAITING',
  'IN_CONSULTATION',
  'IN_TREATMENT',
  'PENDING_CHECKOUT',
  'COMPLETED',
];

/** 每個狀態相對預約時間的開始分鐘（加上每位病患的隨機延遲） */
function stageOffsets(hasTreatment: boolean, jitter: number): Record<VisitStatus, number> {
  return {
    CHECKED_IN: -10 + jitter,
    WAITING: -6 + jitter,
    IN_CONSULTATION: 2 + jitter,
    IN_TREATMENT: 12 + jitter,
    PENDING_CHECKOUT: (hasTreatment ? 42 : 14) + jitter,
    COMPLETED: (hasTreatment ? 50 : 22) + jitter,
    CANCELLED: Number.POSITIVE_INFINITY,
  };
}

type DemoAppointment = Awaited<ReturnType<typeof loadDemoAppointments>>[number];
function loadDemoAppointments(tx: TenantTx, from: Date, to: Date) {
  return tx.appointment.findMany({
    where: {
      isDemo: true,
      startAt: { gte: from, lt: to },
      status: { in: ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] },
    },
    include: {
      visit: { include: { events: { select: { actorId: true } }, services: true } },
      patient: { select: { id: true, hasAllergy: true } },
    },
    orderBy: { startAt: 'asc' },
  });
}

async function progressAppointment(tx: TenantTx, ctx: ClinicCtx, appt: DemoAppointment, now: Date) {
  // 真人操作過（事件有操作人）就不再自動推進
  if (appt.visit?.events.some((e) => e.actorId)) return;
  if (appt.visit && (appt.visit.status === 'COMPLETED' || appt.visit.status === 'CANCELLED'))
    return;

  const rng = mulberry32(hashString(appt.id));
  const noShow = rng() < 0.07;
  const jitter = int(rng, -3, 8);
  const serviceCode = appt.serviceId ? ctx.serviceById.get(appt.serviceId) : undefined;
  const hasTreatment = !!serviceCode && TREATMENT_CODES.includes(serviceCode);
  const offsets = stageOffsets(hasTreatment, jitter);
  const at = (status: VisitStatus) => new Date(appt.startAt.getTime() + offsets[status] * 60_000);

  if (!appt.visit) {
    if (noShow) {
      if (now.getTime() > appt.startAt.getTime() + 30 * 60_000) {
        await tx.appointment.update({ where: { id: appt.id }, data: { status: 'NO_SHOW' } });
      }
      return;
    }
    if (now < at('CHECKED_IN')) return;
  }

  const flow = FLOW.filter((s) => hasTreatment || s !== 'IN_TREATMENT');
  const target = [...flow].reverse().find((s) => now >= at(s));
  if (!target) return;

  let visit = appt.visit;
  if (!visit) {
    const checkedInAt = at('CHECKED_IN');
    const created = await tx.visit.create({
      data: {
        patientId: appt.patientId,
        appointmentId: appt.id,
        doctorId: appt.doctorId,
        roomId: appt.roomId,
        visitDate: new Date(localDate(appt.startAt, ctx.tz)),
        status: 'CHECKED_IN',
        checkedInAt,
        statusChangedAt: checkedInAt,
        events: { create: { toStatus: 'CHECKED_IN', createdAt: checkedInAt } },
      },
      include: { events: { select: { actorId: true } }, services: true },
    });
    await tx.appointment.update({ where: { id: appt.id }, data: { status: 'CHECKED_IN' } });
    visit = created;
  }

  let current = visit.status;
  const targetIndex = flow.indexOf(target);
  while (flow.indexOf(current) < targetIndex) {
    const next = flow[flow.indexOf(current) + 1]!;
    const when = at(next);
    await tx.visitEvent.create({
      data: { visitId: visit.id, fromStatus: current, toStatus: next, createdAt: when },
    });
    if (next === 'PENDING_CHECKOUT')
      await recordClinicalWork(tx, ctx, visit.id, appt, rng, when, hasTreatment);
    if (next === 'IN_CONSULTATION' && rng() < 0.3) {
      const [body, targetRole] = pick(rng, HANDOFFS);
      await tx.handoffNote.create({
        data: { visitId: visit.id, body, targetRole, authorId: appt.doctorId, createdAt: when },
      });
    }
    current = next;
    await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: current,
        statusChangedAt: when,
        completedAt: current === 'COMPLETED' ? when : undefined,
      },
    });
  }
}

/** 醫師欄位、服務項目、自動扣堂、領藥（進入待批價時一次寫入） */
async function recordClinicalWork(
  tx: TenantTx,
  ctx: ClinicCtx,
  visitId: string,
  appt: DemoAppointment,
  rng: Rng,
  when: Date,
  hasTreatment: boolean,
) {
  const [pattern, principle] = pick(rng, PATTERNS);
  const note = {
    chiefComplaint: pick(rng, COMPLAINTS),
    fourDiagnosis: `${pick(rng, TONGUE)}，${pick(rng, PULSE)}。面色略淡，語聲正常。`,
    pattern,
    treatmentPrinciple: principle,
    advice: pick(rng, ADVICE),
  };
  await tx.visit.update({
    where: { id: visitId },
    data: {
      clinicalNoteEnc: encryptField(JSON.stringify(note)),
      clinicalNoteUpdatedAt: when,
      clinicalNoteUpdatedById: appt.doctorId,
    },
  });

  const serviceIds = [ctx.services.get('CONSULT')!.id];
  if (hasTreatment && appt.serviceId) serviceIds.push(appt.serviceId);
  for (const serviceId of serviceIds) {
    let packageUsageId: string | null = null;
    const pkg = await findUsablePackage(tx, appt.patientId, serviceId, localDate(when, ctx.tz));
    if (pkg) {
      const usage = await tx.packageUsage.create({
        data: {
          packageId: pkg.id,
          patientId: appt.patientId,
          visitId,
          kind: 'DEDUCT',
          quantity: 1,
          idempotencyKey: `demo-${visitId}-${serviceId}`,
          actorId: ctx.staffByRole.CLINICAL_ASSISTANT ?? null,
          createdAt: when,
        },
      });
      packageUsageId = usage.id;
    }
    await tx.visitService.create({
      data: { visitId, serviceId, packageUsageId, createdById: appt.doctorId, createdAt: when },
    });
  }

  if (rng() < 0.55) {
    const [name, days] = pick(rng, DISPENSES);
    const dispensedOn = localDate(when, ctx.tz);
    await tx.medicationDispense.create({
      data: {
        patientId: appt.patientId,
        visitId,
        name,
        days,
        dispensedOn: new Date(dispensedOn),
        nextEligibleOn: new Date(addDays(dispensedOn, days)),
        createdById: ctx.staffByRole.FRONT_DESK ?? null,
        createdAt: when,
      },
    });
  }
}

async function findUsablePackage(tx: TenantTx, patientId: string, serviceId: string, date: string) {
  const day = new Date(date);
  const candidates = await tx.patientPackage.findMany({
    where: { patientId, serviceId, purchasedOn: { lte: day }, expiresOn: { gte: day } },
    include: { usages: { select: { quantity: true } } },
    orderBy: { expiresOn: 'asc' },
  });
  return (
    candidates.find((p) => p.usages.reduce((s, u) => s + u.quantity, 0) < p.totalSessions) ?? null
  );
}

// ── 對外入口 ─────────────────────────────────────────────────────────
const LONG_TX = { timeout: 120_000, maxWait: 30_000 };

export interface SeedOptions {
  /** full：含歷史就診與今天起一週的預約；minimal：只有診所、員工、病患、診所設定（測試用） */
  mode: 'full' | 'minimal';
  now?: Date;
  historyDays?: number;
  log?: (message: string) => void;
}

export async function seedDemo(prisma: PrismaClient, opts: SeedOptions): Promise<void> {
  const now = opts.now ?? new Date();
  const log = opts.log ?? (() => {});
  const clinicIds = new Map<string, string>();
  for (const c of DEMO_CLINICS) {
    const clinic = await prisma.clinic.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: { slug: c.slug, name: c.name },
    });
    clinicIds.set(c.slug, clinic.id);
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const staffIds = new Map<string, string>();
  for (const s of DEMO_STAFF) {
    const staff = await prisma.staff.upsert({
      where: { email: s.email },
      update: { name: s.name },
      create: { email: s.email, name: s.name, passwordHash },
    });
    staffIds.set(s.email, staff.id);
    for (const [slug, role] of Object.entries(s.roles)) {
      const clinicId = clinicIds.get(slug)!;
      await prisma.clinicMembership.upsert({
        where: { clinicId_staffId: { clinicId, staffId: staff.id } },
        update: { role },
        create: { clinicId, staffId: staff.id, role },
      });
    }
  }

  // 病患編號跨診所連號，固定種子讓每次產生的資料相同
  const rng = mulberry32(20261113);
  let index = 1;
  for (const c of DEMO_CLINICS) {
    const clinicId = clinicIds.get(c.slug)!;
    const patients = Array.from({ length: c.patientCount }, () => fakePatient(rng, index++));
    await withTenant(
      prisma,
      clinicId,
      async (tx) => {
        await ensureCatalog(tx, clinicId, c.slug, staffIds);
        await tx.patient.createMany({ data: patients, skipDuplicates: true });
      },
      LONG_TX,
    );
  }
  log(`診所 ${DEMO_CLINICS.length} 家、員工 ${DEMO_STAFF.length} 位、病患與診所設定完成`);
  if (opts.mode === 'minimal') return;

  for (const c of DEMO_CLINICS) {
    const ctx = await loadClinicCtx(prisma, c.slug);
    const today = localDate(now, ctx.tz);
    await withTenant(
      prisma,
      ctx.id,
      (tx) => ensurePackages(tx, ctx, today, mulberry32(hashString(c.slug))),
      LONG_TX,
    );

    // 歷史就診：過去 N 天，以較低的預約率產生後直接推進到完成
    const historyDays = opts.historyDays ?? 45;
    const hasHistory = await withTenant(prisma, ctx.id, (tx) =>
      tx.appointment.count({
        where: { isDemo: true, startAt: { lt: zonedDateTime(today, 0, ctx.tz) } },
      }),
    );
    if (hasHistory === 0) {
      for (let d = historyDays; d >= 1; d--) {
        const date = addDays(today, -d);
        await withTenant(
          prisma,
          ctx.id,
          async (tx) => {
            await generateDay(tx, ctx, date, 0.12);
            await progressDay(tx, ctx, date, now);
          },
          LONG_TX,
        );
      }
      log(`${c.slug}：已產生 ${historyDays} 天的歷史就診`);
    }
  }
  await runDemoTick(prisma, now);
  log('今天起一週的示範預約完成');
}

async function progressDay(tx: TenantTx, ctx: ClinicCtx, date: string, now: Date) {
  const from = zonedDateTime(date, 0, ctx.tz);
  const to = zonedDateTime(addDays(date, 1), 0, ctx.tz);
  for (const appt of await loadDemoAppointments(tx, from, to)) {
    await progressAppointment(tx, ctx, appt, now);
  }
}

/**
 * 示範模式的定期工作：補上今天起 7 天的示範預約，並依現在時間推進今天（與先前遺留）的示範預約。
 * 可重複執行（已產生的日期不會重複產生、已完成的就診不會再動）。
 */
export async function runDemoTick(
  prisma: PrismaClient,
  now = new Date(),
): Promise<{ created: number }> {
  let created = 0;
  for (const c of DEMO_CLINICS) {
    const exists = await prisma.clinic.findUnique({ where: { slug: c.slug } });
    if (!exists) continue;
    const ctx = await loadClinicCtx(prisma, c.slug);
    const today = localDate(now, ctx.tz);
    for (let d = 0; d < 7; d++) {
      const date = addDays(today, d);
      created += await withTenant(
        prisma,
        ctx.id,
        (tx) => generateDay(tx, ctx, date, d === 0 ? 0.4 : 0.3),
        LONG_TX,
      );
    }
    // 推進今天，以及前幾天因 Worker 停機而沒推進完的示範預約
    for (let d = 3; d >= 0; d--) {
      await withTenant(
        prisma,
        ctx.id,
        (tx) => progressDay(tx, ctx, addDays(today, -d), now),
        LONG_TX,
      );
    }
  }
  return { created };
}
