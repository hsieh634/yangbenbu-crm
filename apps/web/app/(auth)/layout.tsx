import type { ReactNode } from 'react';
import { Logo } from '@/components/shell/logo';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <aside className="relative hidden overflow-hidden bg-jade-800 p-10 text-white lg:flex lg:flex-col">
        <Logo inverted />
        <div className="mt-auto max-w-sm">
          <p className="text-3xl font-semibold leading-snug tracking-wide">
            以養為本，
            <br />
            記下每一步調理。
          </p>
          <p className="mt-4 text-sm leading-relaxed text-jade-200">
            體質問卷、調理方案、療程堂數、診後追蹤，
            <br />
            從櫃檯到健康管理師，同一本簿子接力照顧。
          </p>
        </div>
        <svg
          className="pointer-events-none absolute -right-16 -top-10 size-80 text-jade-700/60"
          viewBox="0 0 200 200"
          aria-hidden
        >
          <path d="M30 170C30 90 75 40 170 25c-8 95-55 140-140 145Z" fill="currentColor" />
          <path d="M45 155C80 115 115 80 160 40" stroke="#3f7d64" strokeWidth="2" fill="none" />
        </svg>
      </aside>
      <main className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Logo className="mb-10 lg:hidden" />
          {children}
        </div>
      </main>
    </div>
  );
}
