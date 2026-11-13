'use client';

import { useQuery } from '@tanstack/react-query';
import type { MeResponse, Permission } from '@yangbenbu/shared';
import { api } from './api';

export const ME_KEY = ['auth', 'me'] as const;

export function useMe() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: () => api<MeResponse>('/auth/me'),
    staleTime: 60_000,
  });
}

export function useCan() {
  const { data } = useMe();
  return (permission: Permission) => data?.permissions.includes(permission) ?? false;
}
