import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@yangbenbu/db';
import type { ProblemDetails } from '@yangbenbu/shared';
import type { FastifyReply } from 'fastify';

const TITLES: Record<number, string> = {
  400: '請求內容有誤',
  401: '尚未登入或登入已逾時',
  403: '沒有權限',
  404: '找不到資料',
  409: '資料衝突',
  423: '帳號已鎖定',
  429: '請求過於頻繁',
  500: '系統發生錯誤',
};

/** 統一錯誤格式：RFC 9457 Problem Details（application/problem+json） */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    let problem: ProblemDetails;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const extra =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const message = typeof extra.message === 'string' ? extra.message : undefined;
      problem = {
        type: 'about:blank',
        title: TITLES[status] ?? exception.name,
        status,
        detail: message ?? (typeof body === 'string' ? body : undefined),
        code: typeof extra.code === 'string' ? extra.code : undefined,
        errors: Array.isArray(extra.errors)
          ? (extra.errors as ProblemDetails['errors'])
          : undefined,
      };
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      // 唯一鍵衝突：多半是兩個請求同時建立同一筆資料，服務層的檢查已先處理常見情況
      problem = {
        type: 'about:blank',
        title: TITLES[409]!,
        status: HttpStatus.CONFLICT,
        detail: '資料已存在或已被其他人更新，請重新整理後再試',
        code: 'CONFLICT',
      };
    } else {
      this.logger.error(exception);
      problem = {
        type: 'about:blank',
        title: TITLES[500]!,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }

    void reply
      .status(problem.status)
      .header('content-type', 'application/problem+json')
      .send(problem);
  }
}
