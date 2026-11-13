import { cn } from '@/lib/utils';

/** 養本簿標誌：一片葉子落在書頁上 */
export function Logo({ className, inverted = false }: { className?: string; inverted?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect x="3" y="5" width="26" height="22" rx="4" fill={inverted ? '#d6e8de' : '#255241'} />
        <path d="M16 8v16" stroke={inverted ? '#1f3d34' : '#f7f5f0'} strokeWidth="1.5" />
        <path
          d="M10 21c0-6 3.5-9.5 10-10.5-.5 6.5-4 10-10 10.5Z"
          fill={inverted ? '#3f7d64' : '#b9803a'}
        />
      </svg>
      <div className="leading-tight">
        <div
          className={cn(
            'text-[17px] font-semibold tracking-wide',
            inverted ? 'text-white' : 'text-ink',
          )}
        >
          養本簿
        </div>
        <div
          className={cn(
            'text-[11px] tracking-[0.2em]',
            inverted ? 'text-jade-200' : 'text-ink-muted',
          )}
        >
          YANGBENBU CRM
        </div>
      </div>
    </div>
  );
}
