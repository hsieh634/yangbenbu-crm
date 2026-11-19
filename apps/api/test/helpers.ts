import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaClient } from '@yangbenbu/db';
import { createApp } from '../src/bootstrap';

export const DEMO_PASSWORD = 'Demo1234!';
export const ACCOUNTS = {
  admin: 'admin@yangbenbu.demo',
  doctor: 'doctor@yangbenbu.demo',
  doctor2: 'doctor2@yangbenbu.demo',
  frontDesk: 'frontdesk@yangbenbu.demo',
  assistant: 'assistant@yangbenbu.demo',
  health: 'health@yangbenbu.demo',
  adminQinghe: 'admin.qinghe@yangbenbu.demo',
} as const;

export async function startApp(): Promise<NestFastifyApplication> {
  const app = await createApp({ logger: false });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/** 取得 Set-Cookie 中的 session cookie（"yb_session=..."） */
export function sessionCookie(setCookie: string | string[] | undefined): string {
  const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const found = list.find((c) => c.startsWith('yb_session='));
  if (!found) throw new Error('回應沒有 session cookie');
  return found.split(';')[0]!;
}

export async function login(app: NestFastifyApplication, email: string, password = DEMO_PASSWORD) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  if (res.statusCode !== 200) throw new Error(`登入失敗 ${res.statusCode} ${res.body}`);
  return sessionCookie(res.headers['set-cookie']);
}

/** 不受 RLS 限制的檢查用連線不存在（應用程式角色本身就受限），所以用 withTenant 指定診所 */
export const db = new PrismaClient();

export async function clinicIdBySlug(slug: string): Promise<string> {
  return (await db.clinic.findUniqueOrThrow({ where: { slug } })).id;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** 以某個登入身分呼叫 API；回傳狀態碼與 JSON */
export function as(app: NestFastifyApplication, cookie: string) {
  // 測試中直接讀取回應欄位，以 any 省去每個斷言的型別轉換
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async <T = any>(
    method: Method,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ): Promise<{ status: number; body: T }> => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { cookie, ...headers },
      payload: payload as never,
    });
    return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
  };
}

export type Caller = ReturnType<typeof as>;

/** 找出 baseDate 之後第一個指定星期幾的日期（0 = 星期日） */
export function nextWeekday(baseDate: string, weekday: number, minDaysAhead = 2): string {
  const d = new Date(`${baseDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() !== weekday) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
