import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { permissionsFor } from '@yangbenbu/shared';
import type { FastifyRequest } from 'fastify';
import { env } from '../config/env';
import { SessionService } from '../modules/auth/session.service';
import { ALLOW_MFA_ENROLLMENT, ALLOW_MFA_PENDING, IS_PUBLIC } from './decorators';

/**
 * 全域認證守衛：
 * 1. 驗證 Session cookie（閒置逾時、絕對逾時、撤銷）
 * 2. 確認員工帳號與目前診所的職務仍然有效
 * 3. 兩步驟驗證：尚未通過 → 只能呼叫驗證 API；強制啟用但未設定 → 只能呼叫設定 API
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const flag = (key: string) =>
      this.reflector.getAllAndOverride<boolean>(key, [ctx.getHandler(), ctx.getClass()]) ?? false;
    if (flag(IS_PUBLIC)) return true;

    const req = ctx.switchToHttp().getRequest<FastifyRequest>();
    const session = await this.sessions.resolve(req);
    if (!session)
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: '請重新登入' });

    const { staff } = session;
    const membership = staff.memberships.find(
      (m) => m.clinicId === session.activeClinicId && m.isActive,
    );
    if (!staff.isActive || !membership) {
      await this.sessions.revoke(session.id);
      throw new UnauthorizedException({
        code: 'ACCOUNT_DISABLED',
        message: '帳號或診所權限已停用',
      });
    }

    if (session.mfaPending && !flag(ALLOW_MFA_PENDING)) {
      throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: '請完成兩步驟驗證' });
    }
    if (env().REQUIRE_MFA && !staff.totpEnabled && !flag(ALLOW_MFA_ENROLLMENT)) {
      throw new ForbiddenException({
        code: 'MFA_ENROLLMENT_REQUIRED',
        message: '本診所要求啟用兩步驟驗證，請先完成設定',
      });
    }

    req.auth = {
      sessionId: session.id,
      staffId: staff.id,
      staffName: staff.name,
      clinicId: membership.clinicId,
      role: membership.role,
      permissions: new Set(permissionsFor(membership.role)),
      mfaEnabled: staff.totpEnabled,
    };
    return true;
  }
}
