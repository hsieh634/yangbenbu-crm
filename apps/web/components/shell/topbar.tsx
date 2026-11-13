'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ROLE_LABELS, type MeResponse } from '@yangbenbu/shared';
import { Building2, LogOut, Menu } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export function Topbar({ me, onMenu }: { me: MeResponse; onMenu: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const switchClinic = useMutation({
    mutationFn: (clinicId: string) => api('/auth/switch-clinic', { method: 'POST', json: { clinicId } }),
    // 換診所後所有資料都不同：回到該區塊首頁（原本的病患在新診所不存在），並重新載入所有資料
    onSuccess: async () => {
      router.replace(`/${pathname.split('/')[1] ?? 'board'}`);
      await queryClient.resetQueries();
    },
  });

  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => {
      queryClient.clear();
      router.replace('/login');
    },
  });

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-paper/90 px-4 backdrop-blur md:px-8">
      <Button variant="ghost" size="icon" className="md:hidden" onClick={onMenu} aria-label="開啟選單">
        <Menu />
      </Button>

      <div className="flex min-w-0 items-center gap-2">
        <Building2 className="size-4 shrink-0 text-ink-muted" />
        {me.clinics.length > 1 ? (
          <select
            aria-label="切換診所"
            value={me.activeClinic.id}
            disabled={switchClinic.isPending}
            onChange={(e) => switchClinic.mutate(e.target.value)}
            className="min-w-0 truncate rounded-md border border-line bg-surface py-1 pl-2 pr-7 text-sm font-medium"
          >
            {me.clinics.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="truncate text-sm font-medium">{me.activeClinic.name}</span>
        )}
      </div>

      <div className="ml-auto flex items-center gap-3">
        <div className="hidden text-right sm:block">
          <div className="text-sm font-medium leading-tight">{me.staff.name}</div>
          <div className="text-xs text-ink-muted">{me.staff.email}</div>
        </div>
        <Badge tone="jade">{ROLE_LABELS[me.role]}</Badge>
        <Button variant="ghost" size="icon" onClick={() => logout.mutate()} aria-label="登出" title="登出">
          <LogOut />
        </Button>
      </div>
    </header>
  );
}
