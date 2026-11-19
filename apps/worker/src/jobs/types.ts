import type { PrismaClient } from '@yangbenbu/db';
import type PgBoss from 'pg-boss';

export interface JobContext {
  boss: PgBoss;
  prisma: PrismaClient;
  log: (message: string, data?: Record<string, unknown>) => void;
}

/** 一個背景工作：名稱、排程（cron，台北時間）與處理函式 */
export interface JobDefinition {
  name: string;
  /** 不設定代表只由事件觸發（boss.send） */
  cron?: string;
  /** 回傳 false 時不註冊（例如只在示範站執行的工作） */
  enabled?: () => boolean;
  handler: (ctx: JobContext) => Promise<void>;
}
