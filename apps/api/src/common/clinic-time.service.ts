import { Injectable } from '@nestjs/common';
import { addDays, DEFAULT_TIMEZONE, localDate, zonedDateTime } from '@yangbenbu/shared';
import { PrismaService } from './prisma.service';

/** 診所時區與「今天」。時區很少變動，快取在記憶體。 */
@Injectable()
export class ClinicTimeService {
  private readonly cache = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  async timezone(clinicId: string): Promise<string> {
    let tz = this.cache.get(clinicId);
    if (!tz) {
      const clinic = await this.prisma.clinic.findUnique({
        where: { id: clinicId },
        select: { timezone: true },
      });
      tz = clinic?.timezone || DEFAULT_TIMEZONE;
      this.cache.set(clinicId, tz);
    }
    return tz;
  }

  async today(clinicId: string, now = new Date()): Promise<string> {
    return localDate(now, await this.timezone(clinicId));
  }

  /** 某天在診所時區的 [00:00, 隔天 00:00) */
  async dayRange(clinicId: string, date: string): Promise<{ from: Date; to: Date; tz: string }> {
    const tz = await this.timezone(clinicId);
    return { from: zonedDateTime(date, 0, tz), to: zonedDateTime(addDays(date, 1), 0, tz), tz };
  }
}
