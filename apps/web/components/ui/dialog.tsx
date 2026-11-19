'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * 以原生 <dialog> 實作的對話框與側邊面板：
 * 焦點鎖定、Esc 關閉、背景不可操作都由瀏覽器處理，不需要額外套件。
 */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    el.addEventListener('cancel', handler);
    return () => el.removeEventListener('cancel', handler);
  }, [onClose]);
  return ref;
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useDialog(open, onClose);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/40',
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <h2 className="text-base font-semibold">{title}</h2>
              {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-ink-muted hover:bg-jade-50"
              aria-label="關閉"
            >
              <X className="size-4" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">
              {footer}
            </footer>
          )}
        </div>
      )}
    </dialog>
  );
}

export function Sheet({
  open,
  onClose,
  title,
  children,
  headerExtra,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  headerExtra?: ReactNode;
}) {
  const ref = useDialog(open, onClose);
  return (
    <dialog
      ref={ref}
      aria-label={typeof title === 'string' ? title : '詳細資料'}
      onClick={(e) => e.target === ref.current && onClose()}
      className="ml-auto mr-0 h-dvh max-h-dvh w-full max-w-xl border-l border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/30"
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-start justify-between gap-4 border-b border-line bg-surface px-5 py-4">
            <div className="min-w-0 flex-1">
              {typeof title === 'string' ? (
                <h2 className="text-lg font-semibold">{title}</h2>
              ) : (
                title
              )}
            </div>
            {headerExtra}
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-ink-muted hover:bg-jade-50"
              aria-label="關閉"
            >
              <X className="size-5" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}
