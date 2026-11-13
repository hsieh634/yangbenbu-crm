import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { withTenant } from '@yangbenbu/db';
import { isValidTaiwanId } from '@yangbenbu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, clinicIdBySlug, db, login, startApp } from './helpers';

let app: NestFastifyApplication;
let yangbenId: string;
let patientId: string;

beforeAll(async () => {
  app = await startApp();
  yangbenId = await clinicIdBySlug('demo-yangben');
  patientId = (await withTenant(db, yangbenId, (tx) => tx.patient.findFirstOrThrow({ orderBy: { chartNo: 'asc' } }))).id;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const latestAudit = (action: string) =>
  withTenant(db, yangbenId, (tx) => tx.auditLog.findFirst({ where: { action }, orderBy: { createdAt: 'desc' } }));

describe('角色權限', () => {
  it('非管理者不能看稽核紀錄，且越權嘗試會被記錄', async () => {
    const cookie = await login(app, ACCOUNTS.assistant);
    const res = await app.inject({ method: 'GET', url: '/api/v1/audit-logs', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    const log = await latestAudit('access.denied');
    expect(log?.outcome).toBe('DENIED');
    expect(log?.actorRole).toBe('CLINICAL_ASSISTANT');
    expect(log?.metadata).toMatchObject({ missing: ['audit:read'] });
  });

  it('只有管理者可以看員工列表', async () => {
    const admin = await login(app, ACCOUNTS.admin);
    const doctor = await login(app, ACCOUNTS.doctor);
    expect((await app.inject({ method: 'GET', url: '/api/v1/staff', headers: { cookie: admin } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/api/v1/staff', headers: { cookie: doctor } })).statusCode).toBe(403);
  });

  it('健康管理師不能查看完整身分證字號', async () => {
    const cookie = await login(app, ACCOUNTS.health);
    const res = await app.inject({ method: 'POST', url: `/api/v1/patients/${patientId}/national-id/reveal`, headers: { cookie } });
    expect(res.statusCode).toBe(403);
  });
});

describe('身分證字號保護', () => {
  it('列表與詳情只回傳遮罩後的號碼', async () => {
    const cookie = await login(app, ACCOUNTS.frontDesk);
    const list = await app.inject({ method: 'GET', url: '/api/v1/patients', headers: { cookie } });
    const detail = await app.inject({ method: 'GET', url: `/api/v1/patients/${patientId}`, headers: { cookie } });
    for (const body of [list.body, detail.body]) {
      expect(body).not.toMatch(/[A-Z][12]\d{8}/);
    }
    expect(detail.json().nationalIdMasked).toMatch(/^\*{7}\d{3}$/);
  });

  it('櫃檯可以查看完整號碼，每次查看都留下紀錄', async () => {
    const cookie = await login(app, ACCOUNTS.frontDesk);
    const res = await app.inject({ method: 'POST', url: `/api/v1/patients/${patientId}/national-id/reveal`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(isValidTaiwanId(res.json().nationalId)).toBe(true);
    const log = await latestAudit('patient.reveal_national_id');
    expect(log).toMatchObject({ patientId, actorRole: 'FRONT_DESK', outcome: 'SUCCESS' });
  });

  it('可以用完整身分證字號搜尋（以雜湊值比對）', async () => {
    const cookie = await login(app, ACCOUNTS.frontDesk);
    const { nationalId } = (
      await app.inject({ method: 'POST', url: `/api/v1/patients/${patientId}/national-id/reveal`, headers: { cookie } })
    ).json();
    const res = await app.inject({ method: 'GET', url: `/api/v1/patients?q=${nationalId}`, headers: { cookie } });
    expect(res.json().items.map((p: { id: string }) => p.id)).toEqual([patientId]);
  });

  it('資料庫中的身分證字號是加密的', async () => {
    const raw = await withTenant(db, yangbenId, (tx) =>
      tx.$queryRaw<{ national_id_enc: string }[]>`SELECT national_id_enc FROM patient LIMIT 1`,
    );
    expect(raw[0]!.national_id_enc).toMatch(/^v1:/);
  });
});

describe('稽核紀錄', () => {
  it('讀取病患詳情會記錄是誰、看了哪位病患', async () => {
    const cookie = await login(app, ACCOUNTS.doctor);
    await app.inject({ method: 'GET', url: `/api/v1/patients/${patientId}`, headers: { cookie } });
    const log = await latestAudit('patient.read');
    const doctor = await db.staff.findUniqueOrThrow({ where: { email: ACCOUNTS.doctor } });
    expect(log).toMatchObject({ patientId, actorStaffId: doctor.id, actorRole: 'DOCTOR', outcome: 'SUCCESS' });
  });

  it('管理者可以查詢，並依病患篩選', async () => {
    const cookie = await login(app, ACCOUNTS.admin);
    const res = await app.inject({ method: 'GET', url: `/api/v1/audit-logs?patientId=${patientId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const items = res.json().items as { patientId: string; patient: { id: string; chartNo: string }; actor: { name: string } }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.patientId === patientId)).toBe(true);
    expect(items[0]!.actor.name).toBeTruthy();
    expect(items[0]!.patient).toMatchObject({ id: patientId, chartNo: 'P00001' });
  });

  it('其他診所的管理者看不到這些紀錄', async () => {
    const qingheId = await clinicIdBySlug('demo-qinghe');
    const leaked = await withTenant(db, qingheId, (tx) => tx.auditLog.count({ where: { patientId } }));
    expect(leaked).toBe(0);
  });

  it('稽核紀錄無法修改或刪除', async () => {
    const log = (await latestAudit('patient.read'))!;
    // 第一層：RLS 沒有 UPDATE／DELETE 政策，應用程式角色根本「看不到」可修改的資料列
    const updated = await withTenant(
      db,
      yangbenId,
      (tx) => tx.$executeRaw`UPDATE audit_log SET action = 'tampered' WHERE id = ${log.id}::uuid`,
    );
    const deleted = await withTenant(
      db,
      yangbenId,
      (tx) => tx.$executeRaw`DELETE FROM audit_log WHERE id = ${log.id}::uuid`,
    );
    expect(updated).toBe(0);
    expect(deleted).toBe(0);
    const still = await withTenant(db, yangbenId, (tx) => tx.auditLog.findUnique({ where: { id: log.id } }));
    expect(still?.action).toBe('patient.read');

    // 第二層：即使有人以繞過 RLS 的角色連線，trigger 也會拒絕 UPDATE／DELETE／TRUNCATE
    const triggers = await db.$queryRaw<{ tgname: string }[]>`
      SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal ORDER BY tgname`;
    expect(triggers.map((t) => t.tgname)).toEqual(['audit_log_no_truncate', 'audit_log_no_update_delete']);
  });
});
