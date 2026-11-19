import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { zonedDateTime } from '@yangbenbu/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, as, db, login, nextWeekday, startApp, type Caller } from './helpers';

let app: NestFastifyApplication;
let frontDesk: Caller;
let doctorCaller: Caller;
let admin: Caller;
let doctorId: string;
let patients: string[];
let monday: string;

/** 陳柏翰醫師週一早上 09:00–12:00 門診，每 15 分鐘一個時段、每時段 2 人 */
const at = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return zonedDateTime(date, h * 60 + m).toISOString();
};

beforeAll(async () => {
  app = await startApp();
  frontDesk = as(app, await login(app, ACCOUNTS.frontDesk));
  doctorCaller = as(app, await login(app, ACCOUNTS.doctor));
  admin = as(app, await login(app, ACCOUNTS.admin));
  const config = (await frontDesk('GET', '/clinic/config')).body;
  doctorId = config.doctors.find((d: { name: string }) => d.name === '陳柏翰').id;
  monday = nextWeekday(config.clinic.today, 1);
  patients = (await frontDesk('GET', '/patients?pageSize=20')).body.items.map(
    (p: { id: string }) => p.id,
  );
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

describe('可預約時段', () => {
  it('依排班切出時段，並標示已預約人數', async () => {
    const res = await frontDesk('GET', `/availability?date=${monday}&doctorId=${doctorId}`);
    expect(res.status).toBe(200);
    const slots = res.body.doctors[0].slots;
    // 週一：早診 09:00–12:00（12 個時段）+ 午診 14:30–17:30（12 個時段）
    expect(slots).toHaveLength(24);
    expect(slots[0]).toMatchObject({
      startAt: at(monday, '09:00'),
      capacity: 2,
      booked: 0,
      past: false,
    });
  });

  it('醫師可以看時段，但不能預約', async () => {
    expect((await doctorCaller('GET', `/availability?date=${monday}`)).status).toBe(200);
    const res = await doctorCaller('POST', '/appointments', {
      patientId: patients[0],
      doctorId,
      startAt: at(monday, '09:00'),
    });
    expect(res.status).toBe(403);
  });
});

describe('預約', () => {
  it('不是門診時段的時間不能預約', async () => {
    const res = await frontDesk('POST', '/appointments', {
      patientId: patients[0],
      doctorId,
      startAt: at(monday, '09:07'),
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_A_SLOT');
  });

  it('同時 5 個人搶 2 個名額：剛好 2 個成功，不會超額', async () => {
    const startAt = at(monday, '09:15');
    const results = await Promise.all(
      patients
        .slice(1, 6)
        .map((patientId) => frontDesk('POST', '/appointments', { patientId, doctorId, startAt })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 409, 409, 409]);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.code === 'SLOT_FULL')).toBe(
      true,
    );
    const slot = (
      await frontDesk('GET', `/availability?date=${monday}&doctorId=${doctorId}`)
    ).body.doctors[0].slots.find((s: { startAt: string }) => s.startAt === startAt);
    expect(slot.booked).toBe(2);
  });

  it('同一位病患不能在同一時段有兩筆預約', async () => {
    const first = await frontDesk('POST', '/appointments', {
      patientId: patients[10],
      doctorId,
      startAt: at(monday, '10:00'),
    });
    expect(first.status).toBe(201);
    const doctor2 = (await frontDesk('GET', '/clinic/config')).body.doctors.find(
      (d: { name: string }) => d.name === '許心怡',
    ).id;
    const second = await frontDesk('POST', '/appointments', {
      patientId: patients[10],
      doctorId: doctor2,
      startAt: at(monday, '10:00'),
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('PATIENT_DOUBLE_BOOKED');
  });

  it('取消後名額釋出；已取消的預約不能再確認', async () => {
    const startAt = at(monday, '10:30');
    const a = await frontDesk('POST', '/appointments', {
      patientId: patients[11],
      doctorId,
      startAt,
    });
    await frontDesk('POST', '/appointments', { patientId: patients[12], doctorId, startAt });
    expect(
      (await frontDesk('POST', '/appointments', { patientId: patients[13], doctorId, startAt }))
        .status,
    ).toBe(409);

    const cancelled = await frontDesk('POST', `/appointments/${a.body.id}/cancel`, {
      reason: '病患臨時有事',
    });
    expect(cancelled.body.status).toBe('CANCELLED');
    expect(
      (await frontDesk('POST', '/appointments', { patientId: patients[13], doctorId, startAt }))
        .status,
    ).toBe(201);
    expect((await frontDesk('POST', `/appointments/${a.body.id}/confirm`)).status).toBe(409);
  });

  it('改期會檢查新時段，改期後需重新確認', async () => {
    const a = await frontDesk('POST', '/appointments', {
      patientId: patients[14],
      doctorId,
      startAt: at(monday, '11:00'),
    });
    await frontDesk('POST', `/appointments/${a.body.id}/confirm`);
    // 09:15 已額滿
    const full = await frontDesk('POST', `/appointments/${a.body.id}/reschedule`, {
      startAt: at(monday, '09:15'),
    });
    expect(full.body.code).toBe('SLOT_FULL');
    const moved = await frontDesk('POST', `/appointments/${a.body.id}/reschedule`, {
      startAt: at(monday, '11:30'),
    });
    expect(moved.status).toBe(200);
    expect(moved.body).toMatchObject({ startAt: at(monday, '11:30'), status: 'BOOKED' });
  });

  it('未來的預約不能標記未到；不能預約過去的時段', async () => {
    const a = await frontDesk('POST', '/appointments', {
      patientId: patients[15],
      doctorId,
      startAt: at(monday, '11:45'),
    });
    expect((await frontDesk('POST', `/appointments/${a.body.id}/no-show`)).body.code).toBe(
      'NOT_YET',
    );
    const past = await frontDesk('POST', '/appointments', {
      patientId: patients[15],
      doctorId,
      startAt: at('2020-01-06', '09:00'),
    });
    expect(past.body.code).toBe('SLOT_IN_PAST');
  });

  it('列表依日期區間查詢，並寫入稽核', async () => {
    const res = await frontDesk('GET', `/appointments?from=${monday}&to=${monday}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(7);
    expect(res.body[0].patient).toHaveProperty('chartNo');
  });
});

describe('休診日', () => {
  it('管理者設定休診後，當天不能預約', async () => {
    const tuesday = nextWeekday(monday, 2, 7);
    const closure = await admin('POST', '/schedule-closures', {
      date: tuesday,
      doctorId,
      reason: '進修',
    });
    expect(closure.status).toBe(201);
    const availability = await frontDesk(
      'GET',
      `/availability?date=${tuesday}&doctorId=${doctorId}`,
    );
    expect(availability.body.doctors[0]).toMatchObject({ closedReason: '進修', slots: [] });
    const res = await frontDesk('POST', '/appointments', {
      patientId: patients[16],
      doctorId,
      startAt: at(tuesday, '09:00'),
    });
    expect(res.body.code).toBe('CLINIC_CLOSED');
    expect((await frontDesk('POST', '/schedule-closures', { date: tuesday })).status).toBe(403);
  });
});
