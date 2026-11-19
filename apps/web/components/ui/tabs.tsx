'use client';

import { cn } from '@/lib/utils';

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}
    >
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          role="tab"
          aria-selected={t.value === value}
          onClick={() => onChange(t.value)}
          className={cn(
            '-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors',
            t.value === value
              ? 'border-jade-700 font-medium text-jade-800'
              : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && (
            <span className="ml-1.5 text-xs text-ink-muted">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}
