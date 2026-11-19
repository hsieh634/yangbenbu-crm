'use client';

import { useQuery } from '@tanstack/react-query';
import type { ClinicConfig } from '@yangbenbu/shared';
import { api } from './api';

export const CLINIC_CONFIG_KEY = ['clinic-config'] as const;

/** 診所設定（服務項目、醫師、診間、療程方案、排班）：表單下拉選單共用，變動少 */
export function useClinicConfig() {
  return useQuery({
    queryKey: CLINIC_CONFIG_KEY,
    queryFn: () => api<ClinicConfig>('/clinic/config'),
    staleTime: 5 * 60_000,
  });
}

/** 每次操作產生一組冪等鍵；重送同一組不會重複扣堂 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID().replaceAll('-', '');
}
