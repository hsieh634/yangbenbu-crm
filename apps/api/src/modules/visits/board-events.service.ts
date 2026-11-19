import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Client } from 'pg';
import { filter, map, Subject, type Observable } from 'rxjs';
import { env } from '../../config/env';

export interface BoardChange {
  clinicId: string;
  table: string;
  id: string;
}

const CHANNEL = 'board_change';

/**
 * 接收資料庫的看板變動通知（pg_notify，由 trigger 發出），轉給同診所的 SSE 連線。
 *
 * 每個 API 程序只開一條 LISTEN 連線；斷線時自動重連。
 * 多台 API 同時運作時，每台都會收到通知，各自推給連到自己的瀏覽器。
 */
@Injectable()
export class BoardEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BoardEventsService.name);
  private readonly changes = new Subject<BoardChange>();
  private client: Client | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private ready: Promise<void> = Promise.resolve();

  onModuleInit(): void {
    this.ready = this.connect();
  }

  /** 測試用：等待 LISTEN 生效 */
  whenReady(): Promise<void> {
    return this.ready;
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({ connectionString: env().DATABASE_URL });
    client.on('notification', (msg) => {
      if (msg.channel !== CHANNEL || !msg.payload) return;
      try {
        this.changes.next(JSON.parse(msg.payload) as BoardChange);
      } catch {
        this.logger.warn('無法解析看板通知');
      }
    });
    client.on('error', (err) => {
      this.logger.warn({ err: err.message }, '看板通知連線中斷，5 秒後重連');
      this.scheduleReconnect();
    });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      this.client = client;
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, '看板通知連線失敗，5 秒後重試');
      await client.end().catch(() => {});
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    const old = this.client;
    this.client = null;
    void old?.end().catch(() => {});
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ready = this.connect();
    }, 5_000);
  }

  /** 只會收到指定診所的變動 */
  forClinic(clinicId: string): Observable<{ table: string }> {
    return this.changes.pipe(
      filter((c) => c.clinicId === clinicId),
      map((c) => ({ table: c.table })),
    );
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.changes.complete();
    await this.client?.end().catch(() => {});
  }
}
