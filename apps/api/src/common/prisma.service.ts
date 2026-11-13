import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient, checkRlsEnforced, withTenant, type TenantTx } from '@yangbenbu/db';
import { env } from '../config/env';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    const { ok, role } = await checkRlsEnforced(this);
    if (!ok) {
      const message = `資料庫角色 "${role}" 是超級使用者或具 BYPASSRLS，Row-Level Security 不會生效`;
      if (env().NODE_ENV === 'production') throw new Error(message);
      this.logger.warn(message);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** 在指定診所範圍內執行（受 RLS 限制） */
  tenant<T>(clinicId: string, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
    return withTenant(this, clinicId, fn);
  }
}
