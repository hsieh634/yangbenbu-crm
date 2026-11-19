'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export type StreamState = 'connecting' | 'live' | 'offline';

/**
 * 看板即時同步：以 Server-Sent Events 接收「有變動」的通知，收到後重新抓取看板。
 * 推送內容不含病患資料，資料仍經由一般 API 取得（有權限檢查與稽核）。
 * 斷線時瀏覽器會自動重連；Session 逾時則停止重連。
 */
export function useBoardStream(enabled: boolean): StreamState {
  const queryClient = useQueryClient();
  const [state, setState] = useState<StreamState>('connecting');

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource('/api/v1/board/stream');
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['board'] });
      void queryClient.invalidateQueries({ queryKey: ['visit'] });
    };
    source.addEventListener('ready', () => {
      setState('live');
      // 重新連線後補抓一次，避免斷線期間漏掉的變動
      refresh();
    });
    source.addEventListener('change', refresh);
    source.addEventListener('session-expired', () => {
      source.close();
      setState('offline');
      void queryClient.invalidateQueries({ queryKey: ['board'] }); // 觸發 401 → 導回登入頁
    });
    source.onerror = () =>
      setState(source.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    return () => source.close();
  }, [enabled, queryClient]);

  return state;
}

/** 每 30 秒更新一次「現在時間」，用來顯示等候分鐘數 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
