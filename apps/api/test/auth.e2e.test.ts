import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNTS, DEMO_PASSWORD, db, login, sessionCookie, startApp } from './helpers';

let app: NestFastifyApplication;
beforeAll(async () => {
  app = await startApp();
});
afterAll(async () => {
  await app.close();
  await db.$disconnect();
});

const me = (cookie: string) =>
  app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } });

describe('登入', () => {
  it('成功登入後發出 httpOnly、SameSite=Strict 的 Session cookie', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ACCOUNTS.frontDesk, password: DEMO_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    const raw = String(res.headers['set-cookie']);
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
  });

  it('/auth/me 回傳目前診所、角色與權限', async () => {
    const cookie = await login(app, ACCOUNTS.frontDesk);
    const body = (await me(cookie)).json();
    expect(body.role).toBe('FRONT_DESK');
    expect(body.activeClinic.name).toContain('養本堂');
    expect(body.permissions).toContain('package:deduct');
    expect(body.permissions).not.toContain('audit:read');
  });

  it('密碼錯誤與帳號不存在回傳相同訊息（避免帳號列舉）', async () => {
    const wrong = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ACCOUNTS.assistant, password: 'nope' },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'nobody@yangbenbu.demo', password: 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json().detail).toBe(unknown.json().detail);
    expect(wrong.headers['content-type']).toContain('application/problem+json');
  });

  it('格式錯誤回傳 400 與欄位錯誤', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['email', 'password']),
    );
  });

  it('連續失敗 5 次後鎖定，即使密碼正確也無法登入', async () => {
    const email = 'lockout-test@yangbenbu.demo';
    const admin = await db.staff.findUniqueOrThrow({
      where: { email: ACCOUNTS.admin },
      include: { memberships: true },
    });
    const staff = await db.staff.create({
      data: {
        email,
        name: '鎖定測試',
        passwordHash: admin.passwordHash,
        memberships: { create: { clinicId: admin.memberships[0]!.clinicId, role: 'FRONT_DESK' } },
      },
    });

    for (let i = 0; i < 5; i++) {
      await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email, password: 'wrong' },
      });
    }
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: DEMO_PASSWORD },
    });
    expect(res.statusCode).toBe(423);
    expect(res.json().code).toBe('ACCOUNT_LOCKED');
    const after = await db.staff.findUniqueOrThrow({ where: { id: staff.id } });
    expect(after.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('Session', () => {
  it('未登入呼叫受保護 API 回傳 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/patients' });
    expect(res.statusCode).toBe(401);
  });

  it('登出後 Session 立即失效', async () => {
    const cookie = await login(app, ACCOUNTS.doctor);
    expect((await me(cookie)).statusCode).toBe(200);
    expect(
      (await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { cookie } }))
        .statusCode,
    ).toBe(204);
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('閒置超過 30 分鐘自動失效', async () => {
    const cookie = await login(app, ACCOUNTS.health);
    await db.session.updateMany({
      where: { staff: { email: ACCOUNTS.health }, revokedAt: null },
      data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
    });
    expect((await me(cookie)).statusCode).toBe(401);
  });

  it('跨站來源的寫入請求被拒絕（CSRF）', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { email: ACCOUNTS.admin, password: DEMO_PASSWORD },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('BAD_ORIGIN');
  });
});

describe('切換診所', () => {
  it('同時屬於兩家診所的醫師可以切換', async () => {
    const cookie = await login(app, ACCOUNTS.doctor);
    const before = (await me(cookie)).json();
    expect(before.clinics).toHaveLength(2);
    const other = before.clinics.find((c: { id: string }) => c.id !== before.activeClinic.id);
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch-clinic',
      headers: { cookie },
      payload: { clinicId: other.id },
    });
    expect(res.statusCode).toBe(204);
    expect((await me(cookie)).json().activeClinic.id).toBe(other.id);
  });

  it('不能切換到不屬於自己的診所', async () => {
    const cookie = await login(app, ACCOUNTS.admin);
    const qinghe = await db.clinic.findUniqueOrThrow({ where: { slug: 'demo-qinghe' } });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/switch-clinic',
      headers: { cookie },
      payload: { clinicId: qinghe.id },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('兩步驟驗證（TOTP）', () => {
  it('設定 → 啟用 → 登入需驗證碼 → 驗證碼不能重複使用', async () => {
    let cookie = await login(app, ACCOUNTS.adminQinghe);

    const setup = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/setup',
      headers: { cookie },
    });
    expect(setup.statusCode).toBe(200);
    const { secret, otpauthUri } = setup.json();
    expect(otpauthUri).toMatch(/^otpauth:\/\/totp\//);

    const enable = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/enable',
      headers: { cookie },
      payload: { code: authenticator.generate(secret) },
    });
    expect(enable.statusCode).toBe(204);
    expect((await me(cookie)).json().staff.mfaEnabled).toBe(true);

    // 重新登入：密碼正確後進入「待驗證」狀態
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: ACCOUNTS.adminQinghe, password: DEMO_PASSWORD },
    });
    expect(res.json()).toEqual({ status: 'mfa_required' });
    cookie = sessionCookie(res.headers['set-cookie']);

    // 尚未驗證前不能使用其他 API
    const blocked = await me(cookie);
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().code).toBe('MFA_REQUIRED');

    // 啟用時用掉的驗證碼不能再用；用下一個時間區段的驗證碼
    const replay = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      headers: { cookie },
      payload: { code: authenticator.generate(secret) },
    });
    expect(replay.statusCode).toBe(401);

    const nextCode = authenticator.clone({ epoch: Date.now() + 30_000 }).generate(secret);
    const verify = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mfa/verify',
      headers: { cookie },
      payload: { code: nextCode },
    });
    expect(verify.statusCode).toBe(200);

    // 驗證通過後換發新 Session，舊的待驗證 Session 作廢
    const fresh = sessionCookie(verify.headers['set-cookie']);
    expect(fresh).not.toBe(cookie);
    expect((await me(fresh)).statusCode).toBe(200);
    expect((await me(cookie)).statusCode).toBe(401);
  });
});
