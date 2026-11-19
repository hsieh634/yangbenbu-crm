import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { withTenant } from '@yangbenbu/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, as, clinicIdBySlug, db, login, startApp, type Caller } from './helpers';

let app: NestFastifyApplication;
let yangbenId: string;
let frontDesk: Caller;
let doctor: Caller;
let health: Caller;
let assistant: Caller;

const NEW_PATIENT = {
  name: '測試病患',
  gender: 'FEMALE',
  birthDate: '1990-05-01',
  phone: '0912345678',
  email: 'test@example.com',
  address: '台北市測試路 1 號',
  nationalId: 'a123456789',
  tags: ['初診'],
  consentSigned: true,
};

beforeAll(async () => {
  app = await startApp();
  yangbenId = await clinicIdBySlug('demo-yangben');
  frontDesk = as(app, await login(app, ACCOUNTS.frontDesk));
  doctor = as(app, await login(app, ACCOUNTS.doctor));
  health = as(app, await login(app, ACCOUNTS.health));
  assistant = as(app, await login(app, ACCOUNTS.assistant));
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const latestAudit = (action: string) =>
  withTenant(db, yangbenId, (tx) =>
    tx.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } }),
  );

describe('新增病患', () => {
  let patientId: string;

  it('櫃檯可以建檔，病歷號自動編號，身分證轉大寫並遮罩', async () => {
    const res = await frontDesk('POST', '/patients', NEW_PATIENT);
    expect(res.status).toBe(201);
    expect(res.body.chartNo).toBe('P00081'); // 本診所示範病患為 P00001–P00080
    expect(res.body.nationalIdMasked).toBe('*******789');
    expect(res.body.consentVersion).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain('A123456789');
    patientId = res.body.id;
  });

  it('同一個身分證字號不能重複建檔', async () => {
    const res = await frontDesk('POST', '/patients', { ...NEW_PATIENT, nationalId: 'A123456789' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DUPLICATE_NATIONAL_ID');
  });

  it('身分證檢查碼錯誤會被拒絕', async () => {
    const res = await frontDesk('POST', '/patients', { ...NEW_PATIENT, nationalId: 'A123456788' });
    expect(res.status).toBe(400);
    expect(res.body.errors[0].path).toBe('nationalId');
  });

  it('櫃檯不能填寫病史與過敏，醫師可以', async () => {
    const denied = await frontDesk('PATCH', `/patients/${patientId}`, { allergies: '花生' });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('FIELD_FORBIDDEN');

    const ok = await doctor('PATCH', `/patients/${patientId}`, {
      allergies: '花生',
      medicalHistory: '偏頭痛',
    });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({
      allergies: '花生',
      medicalHistory: '偏頭痛',
      hasAllergy: true,
    });
  });

  it('病史在資料庫中是加密的', async () => {
    const [row] = await withTenant(
      db,
      yangbenId,
      (tx) =>
        tx.$queryRaw<{ allergies_enc: string; medical_history_enc: string }[]>`
        SELECT allergies_enc, medical_history_enc FROM patient WHERE id = ${patientId}::uuid`,
    );
    expect(row!.allergies_enc).toMatch(/^v1:/);
    expect(row!.medical_history_enc).toMatch(/^v1:/);
  });

  it('修改紀錄只記錄欄位名稱，不記錄內容', async () => {
    await frontDesk('PATCH', `/patients/${patientId}`, { phone: '0922000111', tags: ['VIP'] });
    const log = await latestAudit('patient.update');
    expect(log?.metadata).toMatchObject({
      changed: ['phone', 'tags'],
      tags: { from: ['初診'], to: ['VIP'] },
    });
    expect(JSON.stringify(log?.metadata)).not.toContain('0922000111');
  });

  it('沒有變更時不寫入', async () => {
    const before = await latestAudit('patient.update');
    const res = await frontDesk('PATCH', `/patients/${patientId}`, { phone: '0922000111' });
    expect(res.status).toBe(200);
    expect((await latestAudit('patient.update'))?.id).toBe(before?.id);
  });

  it('依標籤篩選', async () => {
    const res = await frontDesk('GET', '/patients?tag=VIP&pageSize=100');
    expect(res.body.items.every((p: { tags: string[] }) => p.tags.includes('VIP'))).toBe(true);
    expect(res.body.items.map((p: { id: string }) => p.id)).toContain(patientId);
  });

  it('只有管理者可以刪除；刪除後不出現在列表，但資料仍保留', async () => {
    expect((await frontDesk('DELETE', `/patients/${patientId}`)).status).toBe(403);
    const admin = as(app, await login(app, ACCOUNTS.admin));
    expect((await admin('DELETE', `/patients/${patientId}`)).status).toBe(204);
    expect((await frontDesk('GET', `/patients/${patientId}`)).status).toBe(404);
    const row = await withTenant(db, yangbenId, (tx) =>
      tx.patient.findUnique({ where: { id: patientId } }),
    );
    expect(row?.deletedAt).toBeTruthy();
  });
});

describe('同一位病患，不同角色看到的欄位不同', () => {
  let patientId: string;
  beforeAll(async () => {
    patientId = (await frontDesk('GET', '/patients?pageSize=1')).body.items[0].id;
  });

  it('櫃檯看得到聯絡資料', async () => {
    const res = await frontDesk('GET', `/patients/${patientId}`);
    expect(res.body.restricted).toEqual([]);
    expect(res.body.address).toBeTruthy();
  });

  it('健康管理師看不到地址與緊急聯絡人，回應標示為受限', async () => {
    const res = await health('GET', `/patients/${patientId}`);
    expect(res.body.restricted).toEqual(['contact']);
    expect(res.body.address).toBeNull();
    expect(res.body.phone).toBeTruthy();
  });

  it('健康管理師與診務人員不能編輯病患', async () => {
    expect((await health('PATCH', `/patients/${patientId}`, { phone: '0900000000' })).status).toBe(
      403,
    );
    expect(
      (await assistant('PATCH', `/patients/${patientId}`, { phone: '0900000000' })).status,
    ).toBe(403);
  });
});
