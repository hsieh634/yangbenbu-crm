'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCan } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Logo } from './logo';
import { NAV_SECTIONS } from './nav';

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const can = useCan();

  return (
    <nav className="flex h-full flex-col bg-jade-800 px-3 py-5 text-jade-100" aria-label="主選單">
      <Logo inverted className="px-2" />
      <div className="mt-8 flex-1 space-y-6 overflow-y-auto">
        {NAV_SECTIONS.map((section, i) => {
          const items = section.items.filter((item) => !item.permission || can(item.permission));
          if (items.length === 0) return null;
          return (
            <div key={i}>
              {section.title && (
                <p className="mb-2 px-3 text-[11px] font-medium tracking-[0.2em] text-jade-200/70">{section.title}</p>
              )}
              <ul className="space-y-0.5">
                {items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={onNavigate}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                          active ? 'bg-jade-700 text-white' : 'hover:bg-jade-700/50 hover:text-white',
                        )}
                      >
                        <item.icon className="size-4 shrink-0" />
                        <span className="flex-1">{item.label}</span>
                        {item.phase && (
                          <span className="rounded bg-jade-900/50 px-1.5 py-0.5 text-[10px] text-jade-200/80">
                            P{item.phase}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="px-3 text-[11px] leading-relaxed text-jade-200/60">
        病歷與健保申報以診所 HIS 為準
      </p>
    </nav>
  );
}
