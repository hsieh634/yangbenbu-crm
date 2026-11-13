'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type AuditLogEntry, type Paginated, type Role } from '@yangbenbu/shared';
import Link from 'next/link';
import { useState } from 'react';
import { Pagination } from '@/components/pagination';
import { RequirePermission } from '@/components/shell/guards';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Table, Td, Th } from '@/components/ui/table';
import { api, queryString } from '@/lib/api';
import { AUDIT_ACTION_LABELS } from '@/lib/labels';
import { formatDateTime } from '@/lib/utils';

const PAGE_SIZE = 20;
const FILTERS = [
  { value: '', label: '全部' },
  { value: 'patient.', label: '病患資料' },
  { value: 'auth.', label: '登入登出' },
  { value: 'access.denied', label: '越權嘗試' },
];

const OUTCOME = {
  SUCCESS: { label: '成功', tone: 'jade' },
  DENIED: { label: '拒絕', tone: 'danger' },
  FAILURE: { label: '失敗', tone: 'ochre' },
} as const;

function AuditList() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data, isPending, error, isPlaceholderData } = useQuery({
    queryKey: ['audit-logs', { action, page }],
    queryFn: () =>
      api<Paginated<AuditLogEntry>>(
        `/audit-logs${queryString({ action, page, pageSize: PAGE_SIZE })}`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="稽核紀錄"
        description="誰在什麼時間看了或改了哪位病患的資料。紀錄只能新增，任何人（包含管理者）都無法修改或刪除。"
      />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            role="tab"
            aria-selected={action === f.value}
            onClick={() => {
              setAction(f.value);
              setPage(1);
            }}
            className={
              action === f.value
                ? 'rounded-full bg-jade-700 px-3 py-1.5 text-sm text-white'
                : 'rounded-full border border-line bg-surface px-3 py-1.5 text-sm text-ink-muted hover:text-ink'
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <Alert className="mb-4">{error.message}</Alert>}

      <Card className={isPlaceholderData ? 'opacity-60 transition-opacity' : undefined}>
        <Table>
          <thead>
            <tr>
              <Th>時間</Th>
              <Th>人員</Th>
              <Th>動作</Th>
              <Th>結果</Th>
              <Th className="hidden md:table-cell">對象</Th>
              <Th className="hidden lg:table-cell">IP</Th>
            </tr>
          </thead>
          <tbody>
            {isPending &&
              Array.from({ length: 8 }, (_, i) => (
                <tr key={i}>
                  <Td colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </Td>
                </tr>
              ))}
            {data?.items.map((log) => (
              <tr key={log.id}>
                <Td className="whitespace-nowrap font-mono text-xs text-ink-muted">
                  {formatDateTime(log.createdAt)}
                </Td>
                <Td className="whitespace-nowrap">
                  {log.actor?.name ?? <span className="text-ink-muted">系統</span>}
                  {log.actorRole && (
                    <span className="ml-1.5 text-xs text-ink-muted">
                      {ROLE_LABELS[log.actorRole as Role]}
                    </span>
                  )}
                </Td>
                <Td>
                  {AUDIT_ACTION_LABELS[log.action] ?? log.action}
                  {log.action === 'access.denied' && Array.isArray(log.metadata?.missing) && (
                    <span className="ml-1.5 font-mono text-xs text-ink-muted">
                      {(log.metadata.missing as string[]).join(', ')}
                    </span>
                  )}
                </Td>
                <Td>
                  <Badge tone={OUTCOME[log.outcome].tone}>{OUTCOME[log.outcome].label}</Badge>
                </Td>
                <Td className="hidden md:table-cell">
                  {log.patient ? (
                    <Link
                      href={`/patients/${log.patient.id}`}
                      className="text-jade-700 hover:underline"
                    >
                      {log.patient.name}
                      <span className="ml-1.5 font-mono text-xs text-ink-muted">
                        {log.patient.chartNo}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </Td>
                <Td className="hidden font-mono text-xs text-ink-muted lg:table-cell">
                  {log.ip ?? '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {data && data.total === 0 && <EmptyState title="沒有紀錄" />}
        {data && data.total > 0 && (
          <Pagination page={page} pageSize={PAGE_SIZE} total={data.total} onChange={setPage} />
        )}
      </Card>
    </>
  );
}

export default function AuditPage() {
  return (
    <RequirePermission permission="audit:read">
      <AuditList />
    </RequirePermission>
  );
}
