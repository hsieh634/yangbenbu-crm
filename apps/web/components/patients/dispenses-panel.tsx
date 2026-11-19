'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DispenseItem } from '@yangbenbu/shared';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Input, Label } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useClinicConfig } from '@/lib/queries';
import { cn } from '@/lib/utils';

const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : '操作失敗，請再試一次';

/** 領藥紀錄：處方內容以 HIS 為準，這裡記錄領取狀況與下次可領日 */
export function DispensesPanel({ patientId }: { patientId: string }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: config } = useClinicConfig();
  const today = config?.clinic.today ?? '';
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<DispenseItem | null>(null);
  const [form, setForm] = useState({
    name: '科學中藥 7 日份',
    days: 7,
    dispensedOn: '',
    hisRxNo: '',
  });
  const [reason, setReason] = useState('');
  const { data, isPending, error } = useQuery({
    queryKey: ['dispenses', patientId],
    queryFn: () => api<DispenseItem[]>(`/patients/${patientId}/dispenses`),
  });
  const done = (message: string) => {
    toast(message);
    void qc.invalidateQueries({ queryKey: ['dispenses', patientId] });
    setAdding(false);
    setVoiding(null);
    setReason('');
  };
  const create = useMutation({
    mutationFn: () =>
      api<{ nextEligibleOn: string }>(`/patients/${patientId}/dispenses`, {
        method: 'POST',
        json: {
          ...form,
          dispensedOn: form.dispensedOn || undefined,
          hisRxNo: form.hisRxNo || null,
        },
      }),
    onSuccess: (r) => done(`已登記，下次可領日 ${r.nextEligibleOn}`),
  });
  const voidIt = useMutation({
    mutationFn: () => api(`/dispenses/${voiding!.id}/void`, { method: 'POST', json: { reason } }),
    onSuccess: () => done('已作廢'),
  });

  if (error) return <Alert>{errorMessage(error)}</Alert>;
  if (isPending) return <Skeleton className="h-40 w-full" />;
  const latest = data.find((d) => !d.voidedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {latest ? (
            <>
              下次可領日：
              <span
                className={cn(
                  'font-medium',
                  latest.nextEligibleOn <= today ? 'text-jade-700' : 'text-ink',
                )}
              >
                {latest.nextEligibleOn}
              </span>
              {latest.nextEligibleOn <= today && '（已可領取）'}
            </>
          ) : (
            '尚無領藥紀錄'
          )}
        </p>
        {can('medication:write') && (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <Plus /> 登記領藥
          </Button>
        )}
      </div>
      <Card>
        {data.length === 0 ? (
          <EmptyState title="尚無領藥紀錄" />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>領藥日</Th>
                <Th>藥品／處方</Th>
                <Th>天數</Th>
                <Th className="hidden sm:table-cell">下次可領</Th>
                <Th className="hidden md:table-cell">HIS 處方號</Th>
                <Th className="hidden md:table-cell">登記人</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.id} className={cn(d.voidedAt && 'text-ink-muted')}>
                  <Td className="tabular-nums">{d.dispensedOn}</Td>
                  <Td>
                    <span className={cn(d.voidedAt && 'line-through')}>{d.name}</span>
                    {d.voidedAt && (
                      <Badge className="ml-2" title={d.voidReason ?? undefined}>
                        已作廢
                      </Badge>
                    )}
                  </Td>
                  <Td>{d.days}</Td>
                  <Td className="hidden tabular-nums sm:table-cell">{d.nextEligibleOn}</Td>
                  <Td className="hidden font-mono text-xs md:table-cell">{d.hisRxNo ?? '—'}</Td>
                  <Td className="hidden md:table-cell">{d.createdBy?.name ?? '—'}</Td>
                  <Td className="text-right">
                    {!d.voidedAt && can('medication:write') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setVoiding(d)}
                      >
                        作廢
                      </Button>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title="登記領藥"
        description="處方內容以 HIS 為準，這裡只記錄領取狀況。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              取消
            </Button>
            <Button
              disabled={!form.name.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              登記
            </Button>
          </>
        }
      >
        {create.error && <Alert className="mb-3">{errorMessage(create.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="d-name">藥品／處方名稱</Label>
            <Input
              id="d-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="d-days">天數</Label>
            <Input
              id="d-days"
              type="number"
              min={1}
              max={90}
              value={form.days}
              onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="d-date">領藥日</Label>
            <Input
              id="d-date"
              type="date"
              max={today}
              value={form.dispensedOn || today}
              onChange={(e) => setForm({ ...form, dispensedOn: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="d-rx">HIS 處方號（選填）</Label>
            <Input
              id="d-rx"
              value={form.hisRxNo}
              onChange={(e) => setForm({ ...form, hisRxNo: e.target.value })}
            />
          </div>
        </div>
      </Dialog>

      <Dialog
        open={!!voiding}
        onClose={() => setVoiding(null)}
        title="作廢領藥紀錄"
        description="紀錄會保留並標示為作廢。"
        footer={
          <>
            <Button variant="ghost" onClick={() => setVoiding(null)}>
              取消
            </Button>
            <Button
              variant="danger"
              disabled={!reason.trim() || voidIt.isPending}
              onClick={() => voidIt.mutate()}
            >
              作廢
            </Button>
          </>
        }
      >
        {voidIt.error && <Alert className="mb-3">{errorMessage(voidIt.error)}</Alert>}
        <Label htmlFor="void-reason">原因</Label>
        <Input
          id="void-reason"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="例：登記錯誤"
        />
      </Dialog>
    </div>
  );
}
