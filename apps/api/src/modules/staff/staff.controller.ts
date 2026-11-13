import { Controller, Get } from '@nestjs/common';
import type { StaffMember } from '@yangbenbu/shared';
import type { AuthContext } from '../../common/auth-context';
import { CurrentAuth, RequirePermissions } from '../../common/decorators';
import { PrismaService } from '../../common/prisma.service';

@Controller('staff')
export class StaffController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions('staff:manage')
  async list(@CurrentAuth() auth: AuthContext): Promise<StaffMember[]> {
    const rows = await this.prisma.clinicMembership.findMany({
      where: { clinicId: auth.clinicId },
      include: { staff: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((m) => ({
      id: m.staff.id,
      name: m.staff.name,
      email: m.staff.email,
      role: m.role,
      mfaEnabled: m.staff.totpEnabled,
      isActive: m.isActive && m.staff.isActive,
      lastLoginAt: m.staff.lastLoginAt?.toISOString() ?? null,
    }));
  }
}
