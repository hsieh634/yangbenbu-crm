import { Controller, Get, Query } from '@nestjs/common';
import { auditLogQuerySchema, type AuditLogQuery } from '@yangbenbu/shared';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/decorators';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { AuditService } from './audit.service';

@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions('audit:read')
  list(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(auditLogQuerySchema)) query: AuditLogQuery,
  ) {
    return this.audit.list(auth.clinicId, query);
  }
}
