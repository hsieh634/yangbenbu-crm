'use client';

import { X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Sidebar } from '@/components/shell/sidebar';
import { Topbar } from '@/components/shell/topbar';
import { Skeleton } from '@/components/ui/feedback';
import { useMe } from '@/lib/auth';

export default function StaffLayout({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe();
  const router = useRouter();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  // 診所要求兩步驟驗證但尚未設定：只能停留在設定頁
  useEffect(() => {
    if (me?.mfaEnrollmentRequired && pathname !== '/settings/security')
      router.replace('/settings/security');
  }, [me, pathname, router]);

  if (isPending || !me) {
    return (
      <div className="flex min-h-dvh">
        <div className="hidden w-60 bg-jade-800 md:block" />
        <div className="flex-1 space-y-4 p-8">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 md:block">
        <Sidebar />
      </aside>

      {menuOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-ink/40" onClick={() => setMenuOpen(false)} />
          <div className="relative h-full w-64">
            <Sidebar onNavigate={() => setMenuOpen(false)} />
            <button
              onClick={() => setMenuOpen(false)}
              className="absolute right-3 top-5 rounded-md p-1 text-jade-100 hover:bg-jade-700"
              aria-label="關閉選單"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar me={me} onMenu={() => setMenuOpen(true)} />
        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
      </div>
    </div>
  );
}
