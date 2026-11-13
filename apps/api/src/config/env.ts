import { z } from 'zod';

const bool = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().min(1),
  API_PORT: z.coerce.number().int().default(4100),
  WEB_ORIGIN: z.string().default('http://localhost:3100'),
  REQUIRE_MFA: bool,
  COOKIE_SECURE: bool,
  /** 閒置多久自動登出（分鐘） */
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  /** Session 最長有效時間（小時），閒置未逾時也必須重新登入 */
  SESSION_ABSOLUTE_HOURS: z.coerce.number().int().positive().default(12),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;
export function env(): Env {
  cached ??= envSchema.parse(process.env);
  return cached;
}

/** 測試用：環境變數改變後重新讀取 */
export function resetEnvCache(): void {
  cached = undefined;
}

export function allowedOrigins(): string[] {
  return env()
    .WEB_ORIGIN.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
