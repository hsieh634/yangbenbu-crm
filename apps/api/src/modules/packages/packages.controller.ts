import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import {
  idempotencyKeySchema,
  packageDeductSchema,
  packagePurchaseSchema,
  usageReverseSchema,
} from '@yangbenbu/shared';
import type { z } from 'zod';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { CurrentAuth, ReqMeta, RequirePermissions } from '../../common/decorators';
import { UuidPipe } from '../../common/uuid.pipe';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { PackagesService } from './packages.service';

@Controller()
export class PackagesController {
  constructor(private readonly packages: PackagesService) {}

  @Get('patients/:id/packages')
  @RequirePermissions('package:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.packages.listForPatient(auth, id, meta);
  }

  @Post('patients/:id/packages')
  @RequirePermissions('package:manage')
  purchase(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(packagePurchaseSchema)) body: z.output<typeof packagePurchaseSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.packages.purchase(auth, id, body, meta);
  }

  /** 手動扣堂：必須帶 Idempotency-Key，重送同一個請求不會重複扣 */
  @Post('packages/:id/usages')
  @RequirePermissions('package:deduct')
  deduct(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Headers('idempotency-key') key: string | undefined,
    @Body(new ZodPipe(packageDeductSchema)) body: z.output<typeof packageDeductSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    const parsed = idempotencyKeySchema.safeParse(key);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'IDEMPOTENCY_KEY_REQUIRED',
        message: '扣堂請求需要 Idempotency-Key',
      });
    }
    return this.packages.deductManual(auth, id, body.reason, parsed.data, meta);
  }

  @Post('package-usages/:id/reverse')
  @HttpCode(200)
  @RequirePermissions('package:manage')
  reverse(
    @CurrentAuth() auth: AuthContext,
    @Param('id', UuidPipe) id: string,
    @Body(new ZodPipe(usageReverseSchema)) body: z.output<typeof usageReverseSchema>,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.packages.reverse(auth, id, body.reason, meta);
  }
}
