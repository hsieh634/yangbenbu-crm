import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import { assertFieldKeys } from '@yangbenbu/db';
import type { ProblemDetails } from '@yangbenbu/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { allowedOrigins } from './config/env';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** main.ts 與測試共用的應用程式設定 */
export async function createApp(
  options: { logger?: boolean } = {},
): Promise<NestFastifyApplication> {
  assertFieldKeys();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true, logger: options.logger === false ? false : undefined },
  );
  if (options.logger !== false) app.useLogger(app.get(Logger));

  await app.register(helmet);
  await app.register(cookie);

  // CSRF 防護：Session cookie 已設 SameSite=Strict，寫入請求再檢查 Origin。
  // 允許的情況：
  // 1. 同源：Origin 的主機等於這次請求的主機。前端經由 Next.js 轉發時，原本的主機放在 x-forwarded-host。
  //    跨站網頁無法偽造這兩個標頭，因此可安全判斷（與 Next.js Server Actions 的檢查方式相同）。
  //    換 port、換網域、透過預覽服務開啟都適用，不必逐一設定。
  // 2. 明確列在 WEB_ORIGIN 的來源（前端與 API 分屬不同網域時）。
  // 沒有 Origin 的是非瀏覽器用戶端，不受 CSRF 影響。
  const origins = new Set(allowedOrigins());
  const isAllowed = (origin: string, req: FastifyRequest) => {
    if (origins.has(origin)) return true;
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return false;
    }
    const forwarded = req.headers['x-forwarded-host'];
    const requestHost =
      (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim() ??
      req.headers.host;
    return !!requestHost && originHost === requestHost;
  };
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (UNSAFE_METHODS.has(req.method) && origin && !isAllowed(origin, req)) {
        const problem: ProblemDetails = {
          type: 'about:blank',
          title: '沒有權限',
          status: 403,
          code: 'BAD_ORIGIN',
          detail: '不允許的請求來源',
        };
        return reply.code(403).header('content-type', 'application/problem+json').send(problem);
      }
    });

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  return app;
}
