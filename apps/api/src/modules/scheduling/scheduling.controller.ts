import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import {
  appointmentCancelSchema,
  appointmentCreateSchema,
  appointmentListQuerySchema,
  appointmentRescheduleSchema,
  availabilityQuerySchema,
  type AppointmentListQuery,
  type AvailabilityQuery,
} from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { CurrentAuth, ReqMeta, RequirePermissions } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { SchedulingService } from './scheduling.service';

@Controller()
export class SchedulingController {
  constructor(private readonly scheduling: SchedulingService) {}

  @Get('availability')
  @RequirePermissions('appointment:read')
  availability(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(availabilityQuerySchema)) query: AvailabilityQuery,
  ) {
    return this.scheduling.availability(auth, query);
  }

  @Get('appointments')
  @RequirePermissions('appointment:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(appointmentListQuerySchema)) query: AppointmentListQuery,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.scheduling.list(auth, query, meta);
  }

  @Post('appointments')
  @RequirePermissions('appointment:write')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(appointmentCreateSchema)) body: z.output<typeof appointmentCreateSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.scheduling.create(auth, body, meta);
  }

  @Post('appointments/:id/confirm')
  @HttpCode(200)
  @RequirePermissions('appointment:write')
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.scheduling.confirm(auth, id, meta);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('appointment:write')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(appointmentCancelSchema)) body: z.output<typeof appointmentCancelSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.scheduling.cancel(auth, id, body.reason, meta);
  }

  @Post('appointments/:id/no-show')
  @HttpCode(200)
  @RequirePermissions('appointment:write')
  noShow(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.scheduling.markNoShow(auth, id, meta);
  }

  @Post('appointments/:id/reschedule')
  @HttpCode(200)
  @RequirePermissions('appointment:write')
  reschedule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(appointmentRescheduleSchema))
    body: z.output<typeof appointmentRescheduleSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.scheduling.reschedule(auth, id, body, meta);
  }
}
