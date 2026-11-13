/**
 * 示範資料。所有人名、診所、身分證字號皆為虛構（身分證字號只符合檢查碼規則）。
 * 可重複執行：診所與員工以 upsert 建立，病患只在該診所尚無資料時建立。
 */
import { PrismaClient, type Role, type Gender } from '@prisma/client';
import { encryptField, hashField } from '../src/field-crypto';
import { hashPassword } from '../src/password';
import { withTenant } from '../src/tenant';

const prisma = new PrismaClient();
export const DEMO_PASSWORD = 'Demo1234!';

// 固定亂數種子，讓每次產生的資料一致（測試與截圖可重現）
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261113);
const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));

const SURNAMES = ['陳', '林', '黃', '張', '李', '王', '吳', '劉', '蔡', '楊', '許', '鄭', '謝', '郭', '洪', '曾', '邱', '廖', '賴', '周'];
const GIVEN_F = ['淑芬', '美玲', '雅婷', '怡君', '佳穎', '詩涵', '宜蓁', '欣怡', '惠美', '靜宜', '筱婷', '思妤'];
const GIVEN_M = ['志明', '俊傑', '建宏', '冠宇', '家豪', '承恩', '宗翰', '柏宇', '文雄', '國華', '彥廷', '士豪'];
const ALLERGIES = [null, null, null, '盤尼西林', '花生', '海鮮', '阿斯匹靈'];
const HISTORIES = [null, null, '高血壓', '第二型糖尿病', '偏頭痛', '慢性胃炎', '失眠', '過敏性鼻炎', '甲狀腺機能低下'];
const TAGS = ['初診', '針灸療程', 'VIP', '長期調理', '產後調理', '失眠調理', '體重管理'];
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVXYWZIO';
const ID_CODES: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21,
  N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};

function fakeNationalId(gender: Gender): string {
  const letter = pick(LETTERS.split(''));
  const body = `${gender === 'MALE' ? 1 : 2}${Array.from({ length: 7 }, () => int(0, 9)).join('')}`;
  const code = ID_CODES[letter]!;
  const digits = [Math.floor(code / 10), code % 10, ...body.split('').map(Number)];
  const weights = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i]!, 0);
  return `${letter}${body}${(10 - (sum % 10)) % 10}`;
}

function fakePatient(index: number) {
  const gender: Gender = rand() < 0.62 ? 'FEMALE' : 'MALE';
  const nationalId = fakeNationalId(gender);
  const tags = Array.from(new Set([pick(TAGS), ...(rand() < 0.4 ? [pick(TAGS)] : [])]));
  return {
    chartNo: `P${String(index).padStart(5, '0')}`,
    name: pick(SURNAMES) + pick(gender === 'FEMALE' ? GIVEN_F : GIVEN_M),
    gender,
    birthDate: new Date(Date.UTC(int(1950, 2005), int(0, 11), int(1, 28))),
    phone: `09${String(int(10000000, 99999999))}`,
    nationalIdEnc: encryptField(nationalId),
    nationalIdHash: hashField(nationalId),
    nationalIdLast4: nationalId.slice(-4),
    allergies: pick(ALLERGIES),
    medicalHistory: pick(HISTORIES),
    tags,
  };
}

const CLINICS = [
  { slug: 'demo-yangben', name: '養本堂中醫診所（示範）', patientCount: 36 },
  { slug: 'demo-qinghe', name: '青禾中醫診所（示範）', patientCount: 12 },
] as const;

const STAFF: { email: string; name: string; roles: Partial<Record<(typeof CLINICS)[number]['slug'], Role>> }[] = [
  { email: 'admin@yangbenbu.demo', name: '林雅文', roles: { 'demo-yangben': 'ADMIN' } },
  { email: 'doctor@yangbenbu.demo', name: '陳柏翰', roles: { 'demo-yangben': 'DOCTOR', 'demo-qinghe': 'DOCTOR' } },
  { email: 'frontdesk@yangbenbu.demo', name: '張曉芸', roles: { 'demo-yangben': 'FRONT_DESK' } },
  { email: 'assistant@yangbenbu.demo', name: '黃志明', roles: { 'demo-yangben': 'CLINICAL_ASSISTANT' } },
  { email: 'health@yangbenbu.demo', name: '吳佩珊', roles: { 'demo-yangben': 'HEALTH_MANAGER' } },
  { email: 'admin.qinghe@yangbenbu.demo', name: '李俊宏', roles: { 'demo-qinghe': 'ADMIN' } },
];

async function main() {
  const clinicIds = new Map<string, string>();
  for (const c of CLINICS) {
    const clinic = await prisma.clinic.upsert({
      where: { slug: c.slug },
      update: { name: c.name },
      create: { slug: c.slug, name: c.name },
    });
    clinicIds.set(c.slug, clinic.id);
  }

  const passwordHash = await hashPassword(DEMO_PASSWORD);
  for (const s of STAFF) {
    const staff = await prisma.staff.upsert({
      where: { email: s.email },
      update: { name: s.name },
      create: { email: s.email, name: s.name, passwordHash },
    });
    for (const [slug, role] of Object.entries(s.roles)) {
      const clinicId = clinicIds.get(slug)!;
      await prisma.clinicMembership.upsert({
        where: { clinicId_staffId: { clinicId, staffId: staff.id } },
        update: { role },
        create: { clinicId, staffId: staff.id, role },
      });
    }
  }

  let index = 1;
  for (const c of CLINICS) {
    const clinicId = clinicIds.get(c.slug)!;
    await withTenant(prisma, clinicId, async (tx) => {
      if ((await tx.patient.count()) > 0) return;
      const data = Array.from({ length: c.patientCount }, () => fakePatient(index++));
      await tx.patient.createMany({ data });
    });
  }

  console.log(`✔ 示範資料完成：${CLINICS.length} 家診所、${STAFF.length} 位員工（密碼 ${DEMO_PASSWORD}）`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
