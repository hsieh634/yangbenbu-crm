import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import {
  loginSchema,
  switchClinicSchema,
  totpCodeSchema,
  type LoginInput,
  type TotpCodeInput,
} from '@yangbenbu/shared';
import type { FastifyReply } from 'fastify';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import {
  AllowMfaEnrollment,
  AllowMfaPending,
  CurrentAuth,
  Public,
  ReqMeta,
} from '../../common/decorators';
import { ZodPipe } from '../../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(
    @Body(new ZodPipe(loginSchema)) body: LoginInput,
    @Res({ passthrough: true }) reply: FastifyReply,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.login(body, reply, meta);
  }

  @AllowMfaPending()
  @Post('mfa/verify')
  @HttpCode(200)
  verifyMfa(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(totpCodeSchema)) body: TotpCodeInput,
    @Res({ passthrough: true }) reply: FastifyReply,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.verifyMfa(auth, body.code, reply, meta);
  }

  @AllowMfaEnrollment()
  @Get('me')
  me(@CurrentAuth() auth: AuthContext) {
    return this.auth.me(auth);
  }

  @Post('switch-clinic')
  @HttpCode(204)
  switchClinic(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(switchClinicSchema)) body: { clinicId: string },
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.switchClinic(auth, body.clinicId, meta);
  }

  @AllowMfaPending()
  @AllowMfaEnrollment()
  @Post('logout')
  @HttpCode(204)
  logout(
    @CurrentAuth() auth: AuthContext,
    @Res({ passthrough: true }) reply: FastifyReply,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.logout(auth, reply, meta);
  }

  @AllowMfaEnrollment()
  @Post('mfa/setup')
  @HttpCode(200)
  setupMfa(@CurrentAuth() auth: AuthContext) {
    return this.auth.setupMfa(auth);
  }

  @AllowMfaEnrollment()
  @Post('mfa/enable')
  @HttpCode(204)
  enableMfa(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(totpCodeSchema)) body: TotpCodeInput,
    @ReqMeta() meta: RequestMeta,
  ) {
    return this.auth.enableMfa(auth, body.code, meta);
  }
}
