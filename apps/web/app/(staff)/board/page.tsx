'use client';

import { VISIT_STATUSES, VISIT_STATUS_LABELS } from '@yangbenbu/shared';
import { useEffect, useState } from 'react';
import { PageHeader } from '@/components/ui/feedback';
import { RequirePermission } from '@/components/shell/guards';

const dateFormat = new Intl.DateTimeFormat('zh-TW', {
  timeZone: 'Asia/Taipei',
  month: 'long',
  day: 'numeric',
  weekday: 'long',
});

export default function BoardPage() {
  // 日期在瀏覽器端計算，避免靜態產生時把建置當天的日期寫死
  const [today, setToday] = useState('');
  useEffect(() => setToday(dateFormat.format(new Date())), []);

  return (
    <RequirePermission permission="board:read">
      <PageHeader
        title="今日看板"
        description={
          <>
            {today && `${today}・`}就診進度看板將於{' '}
            <span className="font-medium text-ochre-700">Phase 1</span> 上線，以下為欄位預覽。
          </>
        }
      />
      <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
        <div className="flex min-w-max gap-3">
          {VISIT_STATUSES.map((status, i) => (
            <section key={status} className="w-56 shrink-0 rounded-xl bg-line/40 p-2">
              <header className="flex items-center justify-between px-2 py-1.5">
                <h2 className="text-sm font-medium">{VISIT_STATUS_LABELS[status]}</h2>
                <span className="text-xs text-ink-muted">0</span>
              </header>
              <div className="mt-1 flex h-40 items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-muted">
                {i === 0 ? '預約報到後出現在這裡' : '　'}
              </div>
            </section>
          ))}
        </div>
      </div>
    </RequirePermission>
  );
}
