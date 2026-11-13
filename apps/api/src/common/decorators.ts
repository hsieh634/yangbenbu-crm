import { SetMetadata, UnauthorizedException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@yangbenbu/shared';
import type { FastifyRequest } from 'fastify';
import type { AuthContext, RequestMeta } from './auth-context';

export const IS_PUBLIC = 'yb:public';
export const ALLOW_MFA_PENDING = 'yb:allow-mfa-pending';
export const ALLOW_MFA_ENROLLMENT = 'yb:allow-mfa-enrollment';
export const REQUIRED_PERMISSIONS = 'yb:permissions';

/** 不需要登入 */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** 已通過密碼、尚未通過兩步驟驗證的 Session 也可以呼叫 */
export const AllowMfaPending = () => SetMetadata(ALLOW_MFA_PENDING, true);

/** REQUIRE_MFA=true 但尚未設定兩步驟驗證時仍可呼叫（設定流程本身） */
export const AllowMfaEnrollment = () => SetMetadata(ALLOW_MFA_ENROLLMENT, true);

/** 需要具備所有列出的權限 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

export const CurrentAuth = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthContext => {
  const req = ctx.switchToHttp().getRequest<FastifyRequest>();
  if (!req.auth) throw new UnauthorizedException();
  return req.auth;
});

export function requestMeta(req: FastifyRequest): RequestMeta {
  const ua = req.headers['user-agent'];
  return {
    ip: req.ip ?? null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 500) : null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}

export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMeta =>
  requestMeta(ctx.switchToHttp().getRequest<FastifyRequest>()),
);
