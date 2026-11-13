import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RequestMeta } from '../../common/auth-context';
import { PrismaService } from '../../common/prisma.service';
import { env } from '../../config/env';

export const SESSION_COOKIE = 'yb_session';
/** 尚未完成兩步驟驗證的 Session 只保留 5 分鐘 */
const MFA_PENDING_TTL_MS = 5 * 60_000;
/** lastSeenAt 最多每分鐘更新一次，減少寫入 */
const TOUCH_INTERVAL_MS = 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

@Injectable()
export class SessionService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    reply: FastifyReply,
    input: { staffId: string; clinicId: string; mfaPending: boolean; meta: RequestMeta },
  ): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const id = hashToken(token);
    const ttl = input.mfaPending ? MFA_PENDING_TTL_MS : env().SESSION_ABSOLUTE_HOURS * 3_600_000;
    await this.prisma.session.create({
      data: {
        id,
        staffId: input.staffId,
        activeClinicId: input.clinicId,
        mfaPending: input.mfaPending,
        ip: input.meta.ip,
        userAgent: input.meta.userAgent,
        expiresAt: new Date(Date.now() + ttl),
      },
    });
    void reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: env().COOKIE_SECURE,
      path: '/',
    });
    return id;
  }

  /** 讀取並驗證 Session；逾時或已撤銷時回傳 null */
  async resolve(req: FastifyRequest) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return null;
    const session = await this.prisma.session.findUnique({
      where: { id: hashToken(token) },
      include: { staff: { include: { memberships: { include: { clinic: true } } } } },
    });
    if (!session || session.revokedAt) return null;

    const now = Date.now();
    const idleLimit = env().SESSION_IDLE_MINUTES * 60_000;
    if (session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > idleLimit) {
      await this.revoke(session.id);
      return null;
    }
    if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }
    return session;
  }

  async revoke(id: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForStaff(staffId: string, exceptId?: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { staffId, revokedAt: null, id: exceptId ? { not: exceptId } : undefined },
      data: { revokedAt: new Date() },
    });
  }

  clearCookie(reply: FastifyReply): void {
    void reply.clearCookie(SESSION_COOKIE, { path: '/' });
  }
}
