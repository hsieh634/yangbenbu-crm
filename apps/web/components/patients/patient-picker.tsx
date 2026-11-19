'use client';

import { useQuery } from '@tanstack/react-query';
import type { Paginated, PatientSummary } from '@yangbenbu/shared';
import { Search, X } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { Input } from '@/components/ui/input';
import { api, queryString } from '@/lib/api';
import { GENDER_LABELS } from '@/lib/labels';
import { ageFrom, cn } from '@/lib/utils';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** 選擇病患：輸入姓名、病歷號、電話或身分證末四碼搜尋 */
export function PatientPicker({
  value,
  onChange,
}: {
  value: PatientSummary | null;
  onChange: (p: PatientSummary | null) => void;
}) {
  const id = useId();
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const [active, setActive] = useState(0);
  const { data, isFetching } = useQuery({
    queryKey: ['patients', 'picker', query],
    queryFn: () =>
      api<Paginated<PatientSummary>>(`/patients${queryString({ q: query, pageSize: 8 })}`),
    enabled: query.length > 0 && !value,
  });
  const items = data?.items ?? [];

  if (value) {
    return (
      <div className="flex h-10 items-center justify-between rounded-lg border border-jade-200 bg-jade-50 px-3 text-sm">
        <span>
          <span className="font-medium">{value.name}</span>
          <span className="ml-2 font-mono text-xs text-ink-muted">{value.chartNo}</span>
          <span className="ml-2 text-xs text-ink-muted">{value.phone}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="重新選擇病患"
          className="text-ink-muted hover:text-ink"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
      <Input
        role="combobox"
        aria-expanded={items.length > 0}
        aria-controls={`${id}-list`}
        aria-label="搜尋病患"
        className="pl-9"
        placeholder="姓名、病歷號、電話或身分證末四碼"
        value={q}
        autoFocus
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, items.length - 1));
          else if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
          else if (e.key === 'Enter' && items[active]) {
            e.preventDefault();
            onChange(items[active]);
          } else return;
          e.preventDefault();
        }}
      />
      {query && (
        <ul
          id={`${id}-list`}
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg"
        >
          {items.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                onChange(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={cn('cursor-pointer px-3 py-2 text-sm', i === active && 'bg-jade-50')}
            >
              <span className="font-medium">{p.name}</span>
              <span className="ml-2 font-mono text-xs text-ink-muted">{p.chartNo}</span>
              <span className="ml-2 text-xs text-ink-muted">
                {GENDER_LABELS[p.gender]}・{ageFrom(p.birthDate)} 歲・{p.phone}
              </span>
            </li>
          ))}
          {!isFetching && items.length === 0 && (
            <li className="px-3 py-2 text-sm text-ink-muted">找不到符合的病患</li>
          )}
        </ul>
      )}
    </div>
  );
}
