'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ToastProvider } from '@/components/ui/toast';
import { ApiError } from '@/lib/api';

/** Session 逾時（閒置 30 分鐘）時，任何 API 收到 401 都導回登入頁 */
function handleAuthError(err: unknown) {
  if (!(err instanceof ApiError) || err.status !== 401) return;
  const path = window.location.pathname;
  if (path.startsWith('/login')) return;
  const target = err.code === 'MFA_REQUIRED' ? '/login/mfa' : '/login';
  // 刻意整頁重新載入而非 router.push：清掉記憶體中所有病患資料與查詢快取
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.href = `${target}?from=${encodeURIComponent(path)}`;
}

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: handleAuthError }),
        mutationCache: new MutationCache({ onError: handleAuthError }),
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            // 401／403 重試也沒用
            retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
