import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { withTenant } from '@yangbenbu/db';
import { zonedDateTime } from '@yangbenbu/shared';
import { firstValueFrom, takeUntil, timer, toArray } from 'rxjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BoardEventsService } from '../src/modules/visits/board-events.service';
import {
  ACCOUNTS,
  as,
  clinicIdBySlug,
  db,
  login,
  nextWeekday,
  startApp,
  type Caller,
} from './helpers';

let app: NestFastifyApplication;
let yangbenId: string;
let qingheId: string;
let frontDesk: Caller;
let doctor: Caller;
let assistant: Caller;
let health: Caller;
let config: {
  clinic: { today: string };
  doctors: { id: string; name: string }[];
  services: { id: string; code: string }[];
  packagePlans: { id: string; name: string }[];
};
let patients: string[];
const service = (code: string) => config.services.find((s) => s.code === code)!.id;
const plan = (prefix: string) => config.packagePlans.find((p) => p.name.startsWith(prefix))!.id;

beforeAll(async () => {
  app = await startApp();
  yangbenId = await clinicIdBySlug('demo-yangben');
  qingheId = await clinicIdBySlug('demo-qinghe');
  frontDesk = as(app, await login(app, ACCOUNTS.frontDesk));
  doctor = as(app, await login(app, ACCOUNTS.doctor));
  assistant = as(app, await login(app, ACCOUNTS.assistant));
  health = as(app, await login(app, ACCOUNTS.health));
  config = (await frontDesk('GET', '/clinic/config')).body;
  patients = (await frontDesk('GET', '/patients?pageSize=40')).body.items.map(
    (p: { id: string }) => p.id,
  );
  await app.get(BoardEventsService).whenReady();
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

/** 現場掛號報到（任何時間都能執行，不受門診時段影響） */
async function walkIn(patientId: string, serviceCode = 'ACU') {
  const res = await frontDesk('POST', '/visits', {
    patientId,
    doctorId: config.doctors[0]!.id,
    serviceId: service(serviceCode),
  });
  expect(res.status).toBe(201);
  return res.body.visitId as string;
}

describe('報到與狀態機', () => {
  let visitId: string;

  it('現場掛號建立就診單，出現在今日看板的「已報到」欄', async () => {
    visitId = await walkIn(patients[0]!);
    const board = await frontDesk('GET', '/board');
    const card = board.body.cards.find((c: { id: string }) => c.id === visitId);
    expect(card).toMatchObject({
      kind: 'visit',
      column: 'CHECKED_IN',
      patient: { isFirstVisit: true },
    });
    expect(board.body.stats.arrived).toBeGreaterThanOrEqual(1);
  });

  it('同一位病患尚未完成就診前不能重複報到', async () => {
    const res = await frontDesk('POST', '/visits', {
      patientId: patients[0],
      doctorId: config.doctors[0]!.id,
    });
    expect(res.body.code).toBe('ALREADY_CHECKED_IN');
  });

  it('不能跳過看診直接完成', async () => {
    const res = await frontDesk('POST', `/visits/${visitId}/transition`, { to: 'COMPLETED' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('兩台裝置同時拖曳：後到的請求因狀態已變更而被拒絕', async () => {
    const [a, b] = await Promise.all([
      frontDesk('POST', `/visits/${visitId}/transition`, { from: 'CHECKED_IN', to: 'WAITING' }),
      assistant('POST', `/visits/${visitId}/transition`, {
        from: 'CHECKED_IN',
        to: 'IN_CONSULTATION',
      }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect([a.body.code, b.body.code]).toContain('STALE_STATUS');
  });

  it('健康管理師只能看看板，不能推進', async () => {
    expect((await health('GET', '/board')).status).toBe(200);
    const res = await health('POST', `/visits/${visitId}/transition`, { to: 'CHECKED_IN' });
    expect(res.status).toBe(403);
  });

  it('每次轉換都留下操作人與時間，紀錄不可修改', async () => {
    const current = (await doctor('GET', `/visits/${visitId}`)).body.status;
    if (current === 'WAITING') {
      await doctor('POST', `/visits/${visitId}/transition`, { to: 'IN_CONSULTATION' });
    }
    const detail = await doctor('GET', `/visits/${visitId}`);
    expect(detail.body.events.map((e: { toStatus: string }) => e.toStatus).at(-1)).toBe(
      'IN_CONSULTATION',
    );
    expect(detail.body.events.every((e: { actor: unknown }) => e.actor)).toBe(true);

    await expect(
      withTenant(db, yangbenId, (tx) => tx.$executeRaw`UPDATE visit_event SET note = 'x'`),
    ).rejects.toThrow(/append-only/);
    await expect(
      withTenant(db, yangbenId, (tx) => tx.$executeRaw`DELETE FROM visit_event`),
    ).rejects.toThrow(/append-only/);
  });

  it('只能為今天的預約報到', async () => {
    // 用星期二，避免和預約測試（星期一）搶同一個時段
    const tuesday = nextWeekday(config.clinic.today, 2);
    const appt = await frontDesk('POST', '/appointments', {
      patientId: patients[1],
      doctorId: config.doctors[0]!.id,
      startAt: zonedDateTime(tuesday, 9 * 60).toISOString(),
    });
    expect(appt.status).toBe(201);
    const res = await frontDesk('POST', '/visits', { appointmentId: appt.body.id });
    expect(res.body.code).toBe('NOT_TODAY');
  });
});

describe('醫師欄位', () => {
  let visitId: string;
  beforeAll(async () => {
    visitId = await walkIn(patients[2]!);
  });

  it('只有醫師能填寫；櫃檯完全看不到內容', async () => {
    const note = { chiefComplaint: '肩頸痠痛', pattern: '肝鬱氣滯', advice: '早睡' };
    expect((await frontDesk('PUT', `/visits/${visitId}/clinical-note`, note)).status).toBe(403);
    expect((await doctor('PUT', `/visits/${visitId}/clinical-note`, note)).status).toBe(204);

    const asFrontDesk = await frontDesk('GET', `/visits/${visitId}`);
    expect(asFrontDesk.body).toMatchObject({ clinicalNote: null, clinicalRestricted: true });
    expect(JSON.stringify(asFrontDesk.body)).not.toContain('肝鬱氣滯');

    const asAssistant = await assistant('GET', `/visits/${visitId}`);
    expect(asAssistant.body.clinicalNote).toMatchObject(note);
    expect(asAssistant.body.clinicalNoteUpdatedBy.name).toBe('陳柏翰');
  });

  it('醫師欄位在資料庫中加密，稽核只記錄改了哪些欄位', async () => {
    const [row] = await withTenant(
      db,
      yangbenId,
      (tx) =>
        tx.$queryRaw<
          { clinical_note_enc: string }[]
        >`SELECT clinical_note_enc FROM visit WHERE id = ${visitId}::uuid`,
    );
    expect(row!.clinical_note_enc).toMatch(/^v1:/);
    const log = await withTenant(db, yangbenId, (tx) =>
      tx.auditLog.findFirst({
        where: { action: 'visit.clinical_note.update' },
        orderBy: { createdAt: 'desc' },
      }),
    );
    expect(log?.metadata).toEqual({ changed: ['chiefComplaint', 'pattern', 'advice'] });
  });
});

describe('療程與扣堂', () => {
  let patientId: string;
  let packageId: string;

  beforeAll(async () => {
    patientId = patients[3]!;
    const res = await frontDesk('POST', `/patients/${patientId}/packages`, {
      planId: plan('針灸'),
    });
    expect(res.status).toBe(201);
    packageId = res.body.id;
  });

  it('登記服務項目時自動從療程扣堂，移除時自動沖銷', async () => {
    const visitId = await walkIn(patientId);
    const added = await assistant('POST', `/visits/${visitId}/services`, {
      serviceId: service('ACU'),
    });
    expect(added.status).toBe(201);
    expect(added.body).toMatchObject({ packageName: '針灸 10 堂', packageRemaining: 9 });

    const board = await frontDesk('GET', '/board');
    expect(board.body.cards.find((c: { id: string }) => c.id === visitId).package).toEqual({
      name: '針灸 10 堂',
      remaining: 9,
    });

    expect(
      (await assistant('POST', `/visits/${visitId}/services`, { serviceId: service('ACU') })).body
        .code,
    ).toBe('DUPLICATE_SERVICE');

    expect((await assistant('DELETE', `/visits/${visitId}/services/${added.body.id}`)).status).toBe(
      204,
    );
    const pkg = (await frontDesk('GET', `/patients/${patientId}/packages`)).body[0];
    expect(pkg).toMatchObject({ usedSessions: 0, remainingSessions: 10 });
    expect(pkg.usages.map((u: { kind: string }) => u.kind)).toEqual(['REVERSAL', 'DEDUCT']);
  });

  it('沒有可抵用療程時只記錄服務，不扣堂', async () => {
    const visitId = await walkIn(patients[4]!, 'TUINA');
    const added = await assistant('POST', `/visits/${visitId}/services`, {
      serviceId: service('TUINA'),
    });
    expect(added.body).toMatchObject({ packageName: null, packageUsageId: null });
  });

  it('手動扣堂需要冪等鍵；重送同一個請求不會重複扣', async () => {
    const noKey = await frontDesk('POST', `/packages/${packageId}/usages`, { reason: '補登' });
    expect(noKey.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

    const headers = { 'idempotency-key': 'test-key-0001' };
    const first = await frontDesk(
      'POST',
      `/packages/${packageId}/usages`,
      { reason: '補登' },
      headers,
    );
    const retry = await frontDesk(
      'POST',
      `/packages/${packageId}/usages`,
      { reason: '補登' },
      headers,
    );
    expect(first.body).toMatchObject({ remaining: 9, replayed: false });
    expect(retry.body).toMatchObject({ usageId: first.body.usageId, remaining: 9, replayed: true });
  });

  it('同時扣最後兩堂：剛好成功兩次，其餘回報已無堂數', async () => {
    const res = await frontDesk('POST', `/patients/${patients[5]}/packages`, {
      planId: plan('拔罐'),
    });
    const id = res.body.id;
    for (let i = 0; i < 3; i++) {
      await frontDesk(
        'POST',
        `/packages/${id}/usages`,
        { reason: '使用' },
        { 'idempotency-key': `seq-${id}-${i}` },
      );
    }
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        frontDesk(
          'POST',
          `/packages/${id}/usages`,
          { reason: '使用' },
          { 'idempotency-key': `race-${id}-${i}` },
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409, 409, 409]);
    expect(
      results.filter((r) => r.status === 409).every((r) => r.body.code === 'PACKAGE_EXHAUSTED'),
    ).toBe(true);
    const pkg = (await frontDesk('GET', `/patients/${patients[5]}/packages`)).body[0];
    expect(pkg).toMatchObject({ usedSessions: 5, remainingSessions: 0, status: 'EXHAUSTED' });
  });

  it('沖銷需要 package:manage；同一筆只能沖銷一次', async () => {
    const pkg = (await frontDesk('GET', `/patients/${patientId}/packages`)).body[0];
    const usage = pkg.usages.find(
      (u: { kind: string; reversedById: string | null }) => u.kind === 'DEDUCT' && !u.reversedById,
    );
    expect(
      (await assistant('POST', `/package-usages/${usage.id}/reverse`, { reason: '誤扣' })).status,
    ).toBe(403);
    expect(
      (await frontDesk('POST', `/package-usages/${usage.id}/reverse`, { reason: '誤扣' })).status,
    ).toBe(200);
    expect(
      (await frontDesk('POST', `/package-usages/${usage.id}/reverse`, { reason: '誤扣' })).body
        .code,
    ).toBe('ALREADY_REVERSED');
  });

  it('扣堂紀錄不可修改或刪除', async () => {
    await expect(
      withTenant(db, yangbenId, (tx) => tx.$executeRaw`UPDATE package_usage SET quantity = 0`),
    ).rejects.toThrow();
    await expect(
      withTenant(db, yangbenId, (tx) => tx.$executeRaw`DELETE FROM package_usage`),
    ).rejects.toThrow(/append-only/);
  });
});

describe('交接備註', () => {
  it('留給特定職務；其他職務不能標記完成', async () => {
    const visitId = await walkIn(patients[6]!);
    const created = await doctor('POST', `/visits/${visitId}/handoffs`, {
      body: '左肩針灸後請熱敷 10 分鐘',
      targetRole: 'CLINICAL_ASSISTANT',
    });
    expect(created.status).toBe(201);
    const card = (await frontDesk('GET', '/board')).body.cards.find(
      (c: { id: string }) => c.id === visitId,
    );
    expect(card).toMatchObject({ openHandoffs: 1, latestHandoff: '左肩針灸後請熱敷 10 分鐘' });

    const url = `/visits/${visitId}/handoffs/${created.body.id}/resolve`;
    expect((await frontDesk('POST', url)).body.code).toBe('NOT_ADDRESSEE');
    expect((await assistant('POST', url)).status).toBe(204);
  });
});

describe('即時同步與租戶隔離', () => {
  it('狀態變更會由資料庫通知看板，且只通知同一家診所', async () => {
    const events = app.get(BoardEventsService);
    const visitId = await walkIn(patients[7]!);
    // 等報到本身的通知送達，避免和下面的轉換混在一起
    await new Promise((r) => setTimeout(r, 500));
    const collect = (clinicId: string) =>
      firstValueFrom(events.forClinic(clinicId).pipe(takeUntil(timer(1500)), toArray()));
    const [yangben, qinghe] = await Promise.all([
      collect(yangbenId),
      collect(qingheId),
      frontDesk('POST', `/visits/${visitId}/transition`, { to: 'WAITING' }),
    ]);
    expect(yangben).toContainEqual({ table: 'visit' });
    expect(qinghe).toEqual([]);
  });

  it('別家診所的管理者讀不到、改不到這筆就診', async () => {
    const visitId = await walkIn(patients[8]!);
    const other = as(app, await login(app, ACCOUNTS.adminQinghe));
    expect((await other('GET', `/visits/${visitId}`)).status).toBe(404);
    expect((await other('POST', `/visits/${visitId}/transition`, { to: 'WAITING' })).status).toBe(
      404,
    );
  });

  it('資料庫層：不能讓預約指向別家診所的病患', async () => {
    const yangbenPatient = patients[9]!;
    const doctorId = config.doctors[0]!.id;
    // 外鍵本身不受 RLS 限制（病患 ID 確實存在），擋下來的是 assert_same_clinic trigger
    await expect(
      withTenant(
        db,
        qingheId,
        (tx) =>
          tx.$executeRaw`
          INSERT INTO appointment (id, patient_id, doctor_id, start_at, end_at, updated_at)
          VALUES (gen_random_uuid(), ${yangbenPatient}::uuid, ${doctorId}::uuid, now(), now() + interval '15 minutes', now())`,
      ),
    ).rejects.toThrow(/outside clinic/);
  });
});
