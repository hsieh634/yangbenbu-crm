import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { addDays } from '@yangbenbu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, as, db, login, startApp, type Caller } from './helpers';

let app: NestFastifyApplication;
let frontDesk: Caller;
let health: Caller;
let assistant: Caller;
let admin: Caller;
let patientId: string;
let today: string;

beforeAll(async () => {
  app = await startApp();
  frontDesk = as(app, await login(app, ACCOUNTS.frontDesk));
  health = as(app, await login(app, ACCOUNTS.health));
  assistant = as(app, await login(app, ACCOUNTS.assistant));
  admin = as(app, await login(app, ACCOUNTS.admin));
  patientId = (await frontDesk('GET', '/patients?pageSize=1&page=30')).body.items[0].id;
  today = (await frontDesk('GET', '/clinic/config')).body.clinic.today;
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('領藥紀錄', () => {
  it('登記領藥並計算下次可領日', async () => {
    const res = await frontDesk('POST', `/patients/${patientId}/dispenses`, {
      name: '科學中藥 7 日份',
      days: 7,
      hisRxNo: 'RX-001',
    });
    expect(res.status).toBe(201);
    expect(res.body.nextEligibleOn).toBe(addDays(today, 7));
  });

  it('領藥日不能是未來', async () => {
    const res = await frontDesk('POST', `/patients/${patientId}/dispenses`, {
      name: '水煎藥',
      days: 5,
      dispensedOn: addDays(today, 1),
    });
    expect(res.body.code).toBe('FUTURE_DATE');
  });

  it('健康管理師可以看但不能登記；診務人員看不到', async () => {
    expect((await health('GET', `/patients/${patientId}/dispenses`)).status).toBe(200);
    expect(
      (await health('POST', `/patients/${patientId}/dispenses`, { name: 'x', days: 1 })).status,
    ).toBe(403);
    expect((await assistant('GET', `/patients/${patientId}/dispenses`)).status).toBe(403);
  });

  it('登記錯誤以作廢處理，紀錄保留', async () => {
    const [item] = (await frontDesk('GET', `/patients/${patientId}/dispenses`)).body;
    expect(
      (await frontDesk('POST', `/dispenses/${item.id}/void`, { reason: '登記錯誤' })).status,
    ).toBe(204);
    const [after] = (await frontDesk('GET', `/patients/${patientId}/dispenses`)).body;
    expect(after).toMatchObject({ id: item.id, voidReason: '登記錯誤' });
    expect(
      (await frontDesk('POST', `/dispenses/${item.id}/void`, { reason: '再一次' })).body.code,
    ).toBe('ALREADY_VOIDED');
  });
});

describe('診所設定', () => {
  it('所有角色都能讀取設定（表單需要）', async () => {
    const res = await health('GET', '/clinic/config');
    expect(res.status).toBe(200);
    expect(res.body.services.map((s: { code: string }) => s.code)).toContain('ACU');
    expect(res.body.doctors).toHaveLength(2);
  });

  it('只有管理者能新增服務項目與療程方案', async () => {
    const svc = { code: 'GUASHA', name: '刮痧', category: 'OTHER', durationMinutes: 20 };
    expect((await frontDesk('POST', '/services', svc)).status).toBe(403);
    const created = await admin('POST', '/services', svc);
    expect(created.status).toBe(201);
    expect((await admin('POST', '/services', svc)).body.code).toBe('DUPLICATE_CODE');

    const planRes = await admin('POST', '/package-plans', {
      name: '刮痧 5 堂',
      serviceId: created.body.id,
      sessions: 5,
      validDays: 60,
      price: 2000,
    });
    expect(planRes.body).toMatchObject({ name: '刮痧 5 堂', service: { name: '刮痧' } });
  });

  it('排班：同一天的時段不可重疊；取代後時段立即生效', async () => {
    const config = (await admin('GET', '/clinic/config')).body;
    const doctorId = config.doctors[1].id;
    type Item = {
      doctorId: string;
      weekday: number;
      startMinute: number;
      endMinute: number;
      slotMinutes: number;
      capacity: number;
      roomId: string | null;
    };
    const original = config.schedules
      .filter((s: Item) => s.doctorId === doctorId)
      .map(({ weekday, startMinute, endMinute, slotMinutes, capacity, roomId }: Item) => ({
        weekday,
        startMinute,
        endMinute,
        slotMinutes,
        capacity,
        roomId,
      }));

    const overlap = await admin('PUT', `/doctors/${doctorId}/schedules`, {
      items: [
        { weekday: 6, startMinute: 540, endMinute: 720, slotMinutes: 15, capacity: 2 },
        { weekday: 6, startMinute: 700, endMinute: 760, slotMinutes: 15, capacity: 2 },
      ],
    });
    expect(overlap.status).toBe(400);

    // 加開星期六下午（其他測試不會用到），驗證後還原，不影響其他測試檔
    const extra = {
      weekday: 6,
      startMinute: 840,
      endMinute: 900,
      slotMinutes: 20,
      capacity: 1,
      roomId: null,
    };
    expect(
      (await admin('PUT', `/doctors/${doctorId}/schedules`, { items: [...original, extra] }))
        .status,
    ).toBe(204);
    const after = (await admin('GET', '/clinic/config')).body.schedules.filter(
      (s: Item) => s.doctorId === doctorId,
    );
    expect(after).toHaveLength(original.length + 1);
    expect((await admin('PUT', `/doctors/${doctorId}/schedules`, { items: original })).status).toBe(
      204,
    );
  });
});
