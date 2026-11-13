import { ConflictException, ForbiddenException, HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { burnPasswordCheck, decryptField, encryptField, verifyPassword } from '@yangbenbu/db';
import { permissionsFor, type LoginInput, type LoginResult, type MeResponse } from '@yangbenbu/shared';
import type { FastifyReply } from 'fastify';
import type { AuthContext, RequestMeta } from '../../common/auth-context';
import { PrismaService } from '../../common/prisma.service';
import { env } from '../../config/env';
import { AuditService } from '../audit/audit.service';
import { SessionService } from './session.service';
import { generateTotpSecret, totpUri, verifyTotp } from './totp';

/** 連續失敗幾次後鎖定，鎖定多久 */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

const invalidCredentials = () =>
  new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: '帳號或密碼錯誤' });

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginInput, reply: FastifyReply, meta: RequestMeta): Promise<LoginResult> {
    const staff = await this.prisma.staff.findUnique({
      where: { email: input.email },
      include: { memberships: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
    });

    if (!staff || !staff.isActive) {
      await burnPasswordCheck(input.password);
      await this.audit.record({
        clinicId: null,
        action: 'auth.login',
        outcome: 'FAILURE',
        metadata: { reason: 'unknown_account', email: input.email },
        meta,
      });
      throw invalidCredentials();
    }

    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      await this.audit.record({
        clinicId: null,
        actorStaffId: staff.id,
        action: 'auth.login',
        outcome: 'DENIED',
        metadata: { reason: 'locked' },
        meta,
      });
      throw new HttpException(
        { code: 'ACCOUNT_LOCKED', message: `登入失敗次數過多，帳號已暫時鎖定，請 ${LOCKOUT_MINUTES} 分鐘後再試` },
        HttpStatus.LOCKED,
      );
    }

    if (!(await verifyPassword(staff.passwordHash, input.password))) {
      await this.registerFailure(staff.id, staff.failedLoginCount, 'bad_password', meta);
      throw invalidCredentials();
    }

    const membership = staff.memberships[0];
    if (!membership) {
      throw new ForbiddenException({ code: 'NO_CLINIC', message: '此帳號尚未加入任何診所' });
    }

    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { failedLoginCount: 0, lockedUntil: null, ...(staff.totpEnabled ? {} : { lastLoginAt: new Date() }) },
    });
    await this.sessions.create(reply, {
      staffId: staff.id,
      clinicId: membership.clinicId,
      mfaPending: staff.totpEnabled,
      meta,
    });

    if (staff.totpEnabled) return { status: 'mfa_required' };

    await this.audit.record({
      clinicId: membership.clinicId,
      actorStaffId: staff.id,
      actorRole: membership.role,
      action: 'auth.login',
      outcome: 'SUCCESS',
      meta,
    });
    return { status: 'ok' };
  }

  /** 兩步驟驗證通過後換發新的 Session（避免 Session fixation） */
  async verifyMfa(auth: AuthContext, code: string, reply: FastifyReply, meta: RequestMeta): Promise<LoginResult> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: auth.staffId } });
    if (!staff.totpEnabled || !staff.totpSecretEnc) {
      throw new ConflictException({ code: 'MFA_NOT_ENABLED', message: '此帳號未啟用兩步驟驗證' });
    }
    if (staff.lockedUntil && staff.lockedUntil > new Date()) {
      await this.sessions.revoke(auth.sessionId);
      throw new HttpException({ code: 'ACCOUNT_LOCKED', message: '帳號已暫時鎖定' }, HttpStatus.LOCKED);
    }

    const step = verifyTotp(decryptField(staff.totpSecretEnc), code);
    if (step === null || (staff.totpLastUsedStep !== null && step <= staff.totpLastUsedStep)) {
      await this.registerFailure(staff.id, staff.failedLoginCount, 'bad_totp', meta, auth.clinicId);
      throw new UnauthorizedException({ code: 'INVALID_TOTP', message: '驗證碼錯誤或已使用過' });
    }

    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { failedLoginCount: 0, totpLastUsedStep: step, lastLoginAt: new Date() },
    });
    await this.sessions.revoke(auth.sessionId);
    await this.sessions.create(reply, { staffId: staff.id, clinicId: auth.clinicId, mfaPending: false, meta });
    await this.audit.record({
      clinicId: auth.clinicId,
      actorStaffId: staff.id,
      actorRole: auth.role,
      action: 'auth.login',
      outcome: 'SUCCESS',
      metadata: { mfa: true },
      meta,
    });
    return { status: 'ok' };
  }

  private async registerFailure(
    staffId: string,
    currentCount: number,
    reason: string,
    meta: RequestMeta,
    clinicId: string | null = null,
  ): Promise<void> {
    const count = currentCount + 1;
    const lock = count >= MAX_FAILED_ATTEMPTS;
    await this.prisma.staff.update({
      where: { id: staffId },
      data: lock
        ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MINUTES * 60_000) }
        : { failedLoginCount: count },
    });
    await this.audit.record({
      clinicId,
      actorStaffId: staffId,
      action: 'auth.login',
      outcome: 'FAILURE',
      metadata: { reason, attempt: count, locked: lock },
      meta,
    });
  }

  async me(auth: AuthContext): Promise<MeResponse> {
    const staff = await this.prisma.staff.findUniqueOrThrow({
      where: { id: auth.staffId },
      include: { memberships: { where: { isActive: true }, include: { clinic: true }, orderBy: { createdAt: 'asc' } } },
    });
    const active = staff.memberships.find((m) => m.clinicId === auth.clinicId)!;
    return {
      staff: { id: staff.id, name: staff.name, email: staff.email, mfaEnabled: staff.totpEnabled },
      activeClinic: { id: active.clinic.id, name: active.clinic.name },
      role: auth.role,
      permissions: permissionsFor(auth.role),
      clinics: staff.memberships.map((m) => ({ id: m.clinic.id, name: m.clinic.name, role: m.role })),
      mfaEnrollmentRequired: env().REQUIRE_MFA && !staff.totpEnabled,
    };
  }

  async switchClinic(auth: AuthContext, clinicId: string, meta: RequestMeta): Promise<void> {
    const membership = await this.prisma.clinicMembership.findUnique({
      where: { clinicId_staffId: { clinicId, staffId: auth.staffId } },
    });
    if (!membership?.isActive) {
      await this.audit.record({
        clinicId: auth.clinicId,
        actorStaffId: auth.staffId,
        actorRole: auth.role,
        action: 'auth.switch_clinic',
        outcome: 'DENIED',
        metadata: { targetClinicId: clinicId },
        meta,
      });
      throw new ForbiddenException({ code: 'NOT_A_MEMBER', message: '您不屬於這家診所' });
    }
    await this.prisma.session.update({ where: { id: auth.sessionId }, data: { activeClinicId: clinicId } });
    await this.audit.record({
      clinicId,
      actorStaffId: auth.staffId,
      actorRole: membership.role,
      action: 'auth.switch_clinic',
      outcome: 'SUCCESS',
      metadata: { fromClinicId: auth.clinicId },
      meta,
    });
  }

  async logout(auth: AuthContext, reply: FastifyReply, meta: RequestMeta): Promise<void> {
    await this.sessions.revoke(auth.sessionId);
    this.sessions.clearCookie(reply);
    await this.audit.record({
      clinicId: auth.clinicId,
      actorStaffId: auth.staffId,
      actorRole: auth.role,
      action: 'auth.logout',
      outcome: 'SUCCESS',
      meta,
    });
  }

  /** 產生新的 TOTP 金鑰（尚未啟用，需以 enableMfa 驗證一次才生效） */
  async setupMfa(auth: AuthContext): Promise<{ secret: string; otpauthUri: string }> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: auth.staffId } });
    if (staff.totpEnabled) {
      throw new ConflictException({ code: 'MFA_ALREADY_ENABLED', message: '已啟用兩步驟驗證' });
    }
    const secret = generateTotpSecret();
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { totpSecretEnc: encryptField(secret), totpLastUsedStep: null },
    });
    return { secret, otpauthUri: totpUri(staff.email, secret) };
  }

  async enableMfa(auth: AuthContext, code: string, meta: RequestMeta): Promise<void> {
    const staff = await this.prisma.staff.findUniqueOrThrow({ where: { id: auth.staffId } });
    if (staff.totpEnabled) {
      throw new ConflictException({ code: 'MFA_ALREADY_ENABLED', message: '已啟用兩步驟驗證' });
    }
    if (!staff.totpSecretEnc) {
      throw new ConflictException({ code: 'MFA_SETUP_REQUIRED', message: '請先產生 QR Code' });
    }
    const step = verifyTotp(decryptField(staff.totpSecretEnc), code);
    if (step === null) {
      throw new UnauthorizedException({ code: 'INVALID_TOTP', message: '驗證碼錯誤，請確認手機時間是否正確' });
    }
    await this.prisma.staff.update({
      where: { id: staff.id },
      data: { totpEnabled: true, totpLastUsedStep: step },
    });
    // 啟用後登出其他裝置，讓它們重新以兩步驟驗證登入
    await this.sessions.revokeAllForStaff(staff.id, auth.sessionId);
    await this.audit.record({
      clinicId: auth.clinicId,
      actorStaffId: auth.staffId,
      actorRole: auth.role,
      action: 'auth.mfa_enabled',
      outcome: 'SUCCESS',
      meta,
    });
  }
}
