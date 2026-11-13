import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { assertFieldKeys } from '@yangbenbu/db';
import type { ProblemDetails } from '@yangbenbu/shared';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { allowedOrigins } from './config/env';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** main.ts 與測試共用的應用程式設定 */
export async function createApp(options: { logger?: boolean } = {}): Promise<NestFastifyApplication> {
  assertFieldKeys();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ trustProxy: true }),
    { bufferLogs: true, logger: options.logger === false ? false : undefined },
  );
  if (options.logger !== false) app.useLogger(app.get(Logger));

  await app.register(helmet);
  await app.register(cookie);

  // CSRF 防護：Session cookie 已設 SameSite=Strict，再加上 Origin 檢查。
  // 瀏覽器發出跨站寫入請求一定會帶 Origin；沒有 Origin 的是非瀏覽器用戶端，不受 CSRF 影響。
  const origins = new Set(allowedOrigins());
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', async (req, reply) => {
      const origin = req.headers.origin;
      if (UNSAFE_METHODS.has(req.method) && origin && !origins.has(origin)) {
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
