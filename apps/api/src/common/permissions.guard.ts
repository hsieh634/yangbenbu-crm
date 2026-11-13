import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@yangbenbu/shared';
import type { FastifyRequest } from 'fastify';
import { AuditService } from '../modules/audit/audit.service';
import { REQUIRED_PERMISSIONS, requestMeta } from './decorators';

/** 檢查 @RequirePermissions()；拒絕存取時寫入稽核紀錄，方便發現越權嘗試 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required?.length) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const auth = req.auth;
    if (!auth) return false;

    const missing = required.filter((p) => !auth.permissions.has(p));
    if (missing.length === 0) return true;

    await this.audit.record({
      clinicId: auth.clinicId,
      actorStaffId: auth.staffId,
      actorRole: auth.role,
      action: 'access.denied',
      outcome: 'DENIED',
      metadata: { missing, method: req.method, route: req.routeOptions?.url ?? req.url },
      meta: requestMeta(req),
    });
    throw new ForbiddenException({ code: 'FORBIDDEN', message: '您的角色沒有執行此操作的權限' });
  }
}
