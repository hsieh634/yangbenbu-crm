'use client';

import type { Permission } from '@yangbenbu/shared';
import { Lock } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { useCan } from '@/lib/auth';

/** 頁面層級的權限檢查（後端仍會再檢查一次，這裡只是避免顯示無法使用的畫面） */
export function RequirePermission({
  permission,
  children,
}: {
  permission: Permission;
  children: ReactNode;
}) {
  const can = useCan();
  if (!can(permission)) {
    return (
      <Card className="mx-auto mt-10 max-w-md px-6 py-10 text-center">
        <Lock className="mx-auto size-8 text-ink-muted" />
        <p className="mt-3 font-medium">您的角色無法使用此功能</p>
        <p className="mt-1 text-sm text-ink-muted">如需權限，請洽診所管理者。</p>
      </Card>
    );
  }
  return <>{children}</>;
}

export function ComingSoon({
  title,
  phase,
  items,
}: {
  title: string;
  phase: number;
  items: string[];
}) {
  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <Card className="mt-6 max-w-xl p-6">
        <span className="rounded-full bg-ochre-100 px-2.5 py-1 text-xs font-medium text-ochre-700">
          Phase {phase} 開發中
        </span>
        <ul className="mt-4 space-y-2 text-sm text-ink-muted">
          {items.map((item) => (
            <li key={item} className="flex gap-2">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-jade-500" />
              {item}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
