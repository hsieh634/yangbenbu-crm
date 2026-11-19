import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from '@nestjs/common';
import {
  closureCreateSchema,
  packagePlanUpsertSchema,
  scheduleReplaceSchema,
  serviceUpsertSchema,
} from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { CurrentAuth, ReqMeta, RequirePermissions } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { ClinicService } from './clinic.service';

@Controller()
export class ClinicController {
  constructor(private readonly clinic: ClinicService) {}

  /** 所有登入者可讀：表單下拉選單需要服務項目、醫師、診間 */
  @Get('clinic/config')
  config(@CurrentAuth() auth: AuthContext) {
    return this.clinic.config(auth);
  }

  @Post('services')
  @RequirePermissions('settings:manage')
  createService(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(serviceUpsertSchema)) body: z.output<typeof serviceUpsertSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clinic.createService(auth, body, meta);
  }

  @Patch('services/:id')
  @RequirePermissions('settings:manage')
  updateService(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(serviceUpsertSchema)) body: z.output<typeof serviceUpsertSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clinic.updateService(auth, id, body, meta);
  }

  @Post('package-plans')
  @RequirePermissions('settings:manage')
  createPlan(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(packagePlanUpsertSchema)) body: z.output<typeof packagePlanUpsertSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clinic.createPlan(auth, body, meta);
  }

  @Patch('package-plans/:id')
  @RequirePermissions('settings:manage')
  updatePlan(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(packagePlanUpsertSchema)) body: z.output<typeof packagePlanUpsertSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clinic.updatePlan(auth, id, body, meta);
  }

  @Put('doctors/:id/schedules')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  replaceSchedule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(scheduleReplaceSchema)) body: z.output<typeof scheduleReplaceSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clinic.replaceSchedule(auth, id, body, meta);
  }

  @Post('schedule-closures')
  @RequirePermissions('settings:manage')
  createClosure(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(closureCreateSchema)) body: z.output<typeof closureCreateSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clinic.createClosure(auth, body, meta);
  }

  @Delete('schedule-closures/:id')
  @HttpCode(204)
  @RequirePermissions('settings:manage')
  deleteClosure(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.clinic.deleteClosure(auth, id, meta);
  }
}
