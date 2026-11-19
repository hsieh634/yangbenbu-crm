import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  checkInSchema,
  clinicalNoteSchema,
  handoffCreateSchema,
  isoDateSchema,
  visitServiceAddSchema,
  visitTransitionSchema,
  visitUpdateSchema,
  type CheckInInput,
} from '@yangbenbu/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { CurrentAuth, ReqMeta, RequirePermissions } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { SessionService } from '../auth/session.service';
import { BoardEventsService } from './board-events.service';
import { VisitsService } from './visits.service';

const boardQuerySchema = z.object({ date: isoDateSchema.optional() });

/** 心跳間隔：保持連線不被代理伺服器切斷，並順便確認 Session 仍有效 */
const HEARTBEAT_MS = 25_000;
/** 合併短時間內的多個變動（一次轉換會同時改到預約與就診單） */
const COALESCE_MS = 300;

@Controller()
export class VisitsController {
  constructor(
    private readonly visits: VisitsService,
    private readonly events: BoardEventsService,
    private readonly sessions: SessionService,
  ) {}

  @Get('board')
  @RequirePermissions('board:read')
  board(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(boardQuerySchema)) query: z.infer<typeof boardQuerySchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.board(auth, query.date, meta);
  }

  /**
   * 看板即時同步（Server-Sent Events）。只推送「有變動」，不含任何病患資料；
   * 瀏覽器收到後重新呼叫 GET /board，資料仍經過權限檢查與稽核。
   */
  @Get('board/stream')
  @RequirePermissions('board:read')
  stream(
    @CurrentAuth() auth: AuthContext,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ): void {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    raw.write('retry: 5000\n\n');
    raw.write('event: ready\ndata: {}\n\n');

    let pending: Set<string> | null = null;
    const subscription = this.events.forClinic(auth.clinicId).subscribe(({ table }) => {
      if (pending) {
        pending.add(table);
        return;
      }
      pending = new Set([table]);
      setTimeout(() => {
        const tables = [...(pending ?? [])];
        pending = null;
        if (!raw.writableEnded) raw.write(`event: change\ndata: ${JSON.stringify({ tables })}\n\n`);
      }, COALESCE_MS);
    });

    const heartbeat = setInterval(() => {
      void this.sessions.isActive(auth.sessionId).then((ok) => {
        if (!ok) {
          raw.write('event: session-expired\ndata: {}\n\n');
          close();
        } else if (!raw.writableEnded) {
          raw.write(': ping\n\n');
        }
      });
    }, HEARTBEAT_MS);

    const close = () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      if (!raw.writableEnded) raw.end();
    };
    req.raw.on('close', close);
  }

  @Post('visits')
  @RequirePermissions('board:update')
  checkIn(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(checkInSchema)) body: CheckInInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.checkIn(auth, body, meta);
  }

  @Get('visits/:id')
  @RequirePermissions('board:read')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.get(auth, id, meta);
  }

  @Patch('visits/:id')
  @HttpCode(204)
  @RequirePermissions('board:update')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(visitUpdateSchema)) body: z.output<typeof visitUpdateSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.update(auth, id, body, meta);
  }

  @Post('visits/:id/transition')
  @HttpCode(200)
  @RequirePermissions('board:update')
  transition(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(visitTransitionSchema)) body: z.output<typeof visitTransitionSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.transition(auth, id, body, meta);
  }

  @Put('visits/:id/clinical-note')
  @HttpCode(204)
  @RequirePermissions('visit:write_clinical')
  clinicalNote(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(clinicalNoteSchema)) body: z.output<typeof clinicalNoteSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.saveClinicalNote(auth, id, body, meta);
  }

  @Post('visits/:id/services')
  @RequirePermissions('visit:write_services')
  addService(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(visitServiceAddSchema)) body: z.output<typeof visitServiceAddSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.addService(auth, id, body.serviceId, meta);
  }

  @Delete('visits/:id/services/:serviceId')
  @HttpCode(204)
  @RequirePermissions('visit:write_services')
  removeService(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('serviceId', UuidPipe) visitServiceId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.removeService(auth, id, visitServiceId, meta);
  }

  @Post('visits/:id/handoffs')
  @RequirePermissions('board:update')
  addHandoff(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(handoffCreateSchema)) body: z.output<typeof handoffCreateSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.addHandoff(auth, id, body, meta);
  }

  @Post('visits/:id/handoffs/:handoffId/resolve')
  @HttpCode(204)
  @RequirePermissions('board:update')
  resolveHandoff(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Param('handoffId', UuidPipe) handoffId: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.visits.resolveHandoff(auth, id, handoffId, meta);
  }
}
