'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { Paginated, PatientSummary } from '@yangbenbu/shared';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Pagination } from '@/components/pagination';
import { RequirePermission } from '@/components/shell/guards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { api, queryString } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { COMMON_TAGS, GENDER_LABELS } from '@/lib/labels';
import { ageFrom, cn } from '@/lib/utils';

const PAGE_SIZE = 15;

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function PatientList() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [tag, setTag] = useState('');
  const can = useCan();
  const router = useRouter();
  const query = useDebounced(q.trim(), 300);

  const { data, isPending, error, isPlaceholderData } = useQuery({
    queryKey: ['patients', { q: query, page, tag }],
    queryFn: () =>
      api<Paginated<PatientSummary>>(
        `/patients${queryString({ q: query, page, pageSize: PAGE_SIZE, tag })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="病患"
        description="搜尋姓名、病歷號、電話、身分證末四碼或完整身分證字號"
        actions={
          can('patient:write') && (
            <Button onClick={() => router.push('/patients/new')}>
              <Plus /> 新增病患
            </Button>
          )
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
          <Input
            type="search"
            placeholder="姓名、病歷號、電話或身分證"
            title="可搜尋姓名、病歷號、電話、身分證末四碼或完整身分證字號"
            className="pl-9"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setPage(1);
            }}
            aria-label="搜尋病患"
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="依標籤篩選">
          {COMMON_TAGS.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tag === t}
              onClick={() => {
                setTag(tag === t ? '' : t);
                setPage(1);
              }}
              className={cn(
                'rounded-full border px-2.5 py-1 text-xs',
                tag === t
                  ? 'border-jade-700 bg-jade-700 text-white'
                  : 'border-line text-ink-muted hover:border-jade-500',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {error && <Alert className="mb-4">{error.message}</Alert>}

      <Card className={isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
        <Table>
          <thead>
            <tr>
              <Th>病歷號</Th>
              <Th>姓名</Th>
              <Th className="hidden sm:table-cell">性別／年齡</Th>
              <Th className="hidden md:table-cell">電話</Th>
              <Th className="hidden lg:table-cell">身分證</Th>
              <Th className="hidden md:table-cell">標籤</Th>
            </tr>
          </thead>
          <tbody>
            {isPending &&
              Array.from({ length: 6 }, (_, i) => (
                <tr key={i}>
                  <Td colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </Td>
                </tr>
              ))}
            {data?.items.map((p) => (
              <tr key={p.id} className="hover:bg-jade-50/50">
                <Td className="font-mono text-xs text-ink-muted">{p.chartNo}</Td>
                <Td>
                  <Link
                    href={`/patients/${p.id}`}
                    className="font-medium text-jade-700 hover:underline"
                  >
                    {p.name}
                  </Link>
                  {p.hasAllergy && (
                    <Badge tone="danger" className="ml-2">
                      過敏
                    </Badge>
                  )}
                </Td>
                <Td className="hidden sm:table-cell">
                  {GENDER_LABELS[p.gender]}・{ageFrom(p.birthDate)} 歲
                </Td>
                <Td className="hidden font-mono text-xs md:table-cell">{p.phone}</Td>
                <Td className="hidden font-mono text-xs text-ink-muted lg:table-cell">
                  {p.nationalIdMasked ?? '—'}
                </Td>
                <Td className="hidden md:table-cell">
                  <div className="flex flex-wrap gap-1">
                    {p.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {data && data.total === 0 && (
          <EmptyState title="找不到符合的病患">請換個關鍵字試試。</EmptyState>
        )}
        {data && data.total > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
        )}
      </Card>
    </>
  );
}

export default function PatientsPage() {
  return (
    <RequirePermission permission="patient:read">
      <PatientList />
    </RequirePermission>
  );
}
