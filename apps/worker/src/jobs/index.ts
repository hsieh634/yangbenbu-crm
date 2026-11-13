import { sessionCleanup } from './session-cleanup';
import type { JobDefinition } from './types';

/**
 * 所有背景工作。後續階段會加入：
 * - Phase 1：未到標記、療程到期提醒
 * - Phase 2：追蹤任務產生、報表彙總
 * - Phase 3：預約提醒、領藥提醒、LINE 推播發送（含重試與速率限制）
 */
export const JOBS: JobDefinition[] = [sessionCleanup];
