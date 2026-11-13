import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { patientListQuerySchema, type PatientListQuery } from '@yangbenbu/shared';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { CurrentAuth, ReqMeta, RequirePermissions } from '../../common/decorators';
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

  @Get(':id')
  @RequirePermissions('patient:read')
  get(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ReqMeta() meta: RequestMeta) {
    return this.patients.get(auth, id, meta);
  }

  /** 查看完整身分證字號：需要額外權限，且每次都留下稽核紀錄 */
  @Post(':id/national-id/reveal')
  @HttpCode(200)
  @RequirePermissions('patient:read', 'patient:read_national_id')
  reveal(@CurrentAuth() auth: AuthContext, @Param('id') id: string, @ReqMeta() meta: RequestMeta) {
    return this.patients.revealNationalId(auth, id, meta);
  }
}
