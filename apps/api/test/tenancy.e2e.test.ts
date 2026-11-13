import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { withTenant } from '@yangbenbu/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, clinicIdBySlug, db, login, startApp } from './helpers';

let app: NestFastifyApplication;
let yangbenId: string;
let qingheId: string;

beforeAll(async () => {
  app = await startApp();
  yangbenId = await clinicIdBySlug('demo-yangben');
  qingheId = await clinicIdBySlug('demo-qinghe');
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('資料庫層：Row-Level Security', () => {
  it('沒有指定診所時看不到任何病患（預設拒絕）', async () => {
    expect(await db.patient.count()).toBe(0);
  });

  it('指定診所後只看得到該診所的病患', async () => {
    expect(await withTenant(db, yangbenId, (tx) => tx.patient.count())).toBe(36);
    expect(await withTenant(db, qingheId, (tx) => tx.patient.count())).toBe(12);
  });

  it('不能把資料寫進其他診所', async () => {
    await expect(
      withTenant(db, yangbenId, (tx) =>
        tx.patient.create({
          data: {
            clinicId: qingheId,
            chartNo: 'X00001',
            name: '越界測試',
            gender: 'OTHER',
            birthDate: new Date('2000-01-01'),
            phone: '0900000000',
          },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('沒帶 clinicId 時自動使用目前診所', async () => {
    const created = await withTenant(db, qingheId, (tx) =>
      tx.patient.create({
        data: {
          chartNo: 'T00001',
          name: '預設診所測試',
          gender: 'OTHER',
          birthDate: new Date('2000-01-01'),
          phone: '0900000001',
        },
      }),
    );
    expect(created.clinicId).toBe(qingheId);
  });
});

describe('API 層：租戶隔離', () => {
  it('病患列表只包含自己診所的資料', async () => {
    const cookie = await login(app, ACCOUNTS.admin);
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/patients?pageSize=100',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().total).toBe(36);
  });

  it('知道其他診所病患的 ID 也查不到（回應與不存在相同）', async () => {
    const other = await withTenant(db, qingheId, (tx) => tx.patient.findFirstOrThrow());
    const cookie = await login(app, ACCOUNTS.admin);
    for (const [method, url] of [
      ['GET', `/api/v1/patients/${other.id}`],
      ['POST', `/api/v1/patients/${other.id}/national-id/reveal`],
    ] as const) {
      const res = await app.inject({ method, url, headers: { cookie } });
      expect(res.statusCode).toBe(404);
    }
  });

  it('切換診所後看到的是另一家的病患', async () => {
    const cookie = await login(app, ACCOUNTS.doctor);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch-clinic',
      headers: { cookie },
      payload: { clinicId: qingheId },
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/patients?pageSize=100',
      headers: { cookie },
    });
    // 12 位示範病患 + 上面 RLS 測試建立的 1 位
    expect(res.json().total).toBe(13);
  });
});
