import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { dispenseCreateSchema, dispenseVoidSchema } from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { CurrentAuth, ReqMeta, RequirePermissions } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { MedicationsService } from './medications.service';

@Controller()
export class MedicationsController {
  constructor(private readonly medications: MedicationsService) {}

  @Get('patients/:id/dispenses')
  @RequirePermissions('medication:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.medications.list(auth, id, meta);
  }

  @Post('patients/:id/dispenses')
  @RequirePermissions('medication:write')
  create(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(dispenseCreateSchema)) body: z.output<typeof dispenseCreateSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.medications.create(auth, id, body, meta);
  }

  @Post('dispenses/:id/void')
  @HttpCode(204)
  @RequirePermissions('medication:write')
  void(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(dispenseVoidSchema)) body: z.output<typeof dispenseVoidSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.medications.void(auth, id, body.reason, meta);
  }
}
