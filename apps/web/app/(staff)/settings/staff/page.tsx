'use client';

import { useQuery } from '@tanstack/react-query';
import { ROLE_LABELS, type StaffMember } from '@yangbenbu/shared';
import { RequirePermission } from '@/components/shell/guards';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Alert, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Table, Td, Th } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

function StaffList() {
  const { data, isPending, error } = useQuery({
    queryKey: ['staff'],
    queryFn: () => api<StaffMember[]>('/staff'),
  });
  return (
    <>
      <PageHeader title="員工帳號" description="新增員工與調整角色將於 Phase 1 開放。" />
      {error && <Alert className="mb-4">{error.message}</Alert>}
      <Card>
        <Table>
          <thead>
            <tr>
              <Th>姓名</Th>
              <Th>角色</Th>
              <Th className="hidden md:table-cell">Email</Th>
              <Th>兩步驟驗證</Th>
              <Th className="hidden md:table-cell">最後登入</Th>
            </tr>
          </thead>
          <tbody>
            {isPending && (
              <tr>
                <Td colSpan={5}>
                  <Skeleton className="h-5 w-full" />
                </Td>
              </tr>
            )}
            {data?.map((s) => (
              <tr key={s.id}>
                <Td className="font-medium">{s.name}</Td>
                <Td>
                  <Badge tone="jade">{ROLE_LABELS[s.role]}</Badge>
                </Td>
                <Td className="hidden text-ink-muted md:table-cell">{s.email}</Td>
                <Td>
                  {s.mfaEnabled ? (
                    <Badge tone="jade">已啟用</Badge>
                  ) : (
                    <Badge tone="ochre">未啟用</Badge>
                  )}
                </Td>
                <Td className="hidden text-ink-muted md:table-cell">
                  {s.lastLoginAt ? formatDateTime(s.lastLoginAt) : '—'}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}

export default function StaffPage() {
  return (
    <RequirePermission permission="staff:manage">
      <StaffList />
    </RequirePermission>
  );
}
