import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  patientCreateSchema,
  patientListQuerySchema,
  patientUpdateSchema,
  type PatientListQuery,
} from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { CurrentAuth, ReqMeta, RequirePermissions } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { PatientsService } from './patients.service';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get()
  @RequirePermissions('patient:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(patientListQuerySchema)) query: PatientListQuery,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.patients.list(auth, query, meta);
  }

  @Post()
  @RequirePermissions('patient:write')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(patientCreateSchema)) body: z.output<typeof patientCreateSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.patients.create(auth, body, meta);
  }

  @Get(':id')
  @RequirePermissions('patient:read')
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.patients.get(auth, id, meta);
  }

  @Patch(':id')
  @RequirePermissions('patient:write')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(patientUpdateSchema)) body: z.output<typeof patientUpdateSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.patients.update(auth, id, body, meta);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermissions('patient:delete')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.patients.remove(auth, id, meta);
  }

  /** 查看完整身分證字號：需要額外權限，且每次都留下稽核紀錄 */
  @Post(':id/national-id/reveal')
  @HttpCode(200)
  @RequirePermissions('patient:read', 'patient:read_national_id')
  reveal(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.patients.revealNationalId(auth, id, meta);
  }

  @Get(':id/visits')
  @RequirePermissions('patient:read')
  visits(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.patients.visits(auth, id, meta);
  }
}
