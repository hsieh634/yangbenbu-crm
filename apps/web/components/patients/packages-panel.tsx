'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PACKAGE_STATUS_LABELS, type PatientPackageItem } from '@yangbenbu/shared';
import { Minus, Plus, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { newIdempotencyKey, useClinicConfig } from '@/lib/queries';
import { cn, formatDateTime, formatMoney } from '@/lib/utils';

const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : '操作失敗，請再試一次';

type Pending =
  | { kind: 'purchase' }
  | { kind: 'deduct'; pkg: PatientPackageItem; key: string }
  | { kind: 'reverse'; usageId: string; pkg: PatientPackageItem };

/** 療程與扣堂紀錄。剩餘堂數由扣堂紀錄加總而來；更正一律以沖銷處理，紀錄不刪除。 */
export function PackagesPanel({ patientId }: { patientId: string }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const { data: config } = useClinicConfig();
  const [pending, setPending] = useState<Pending | null>(null);
  const [planId, setPlanId] = useState('');
  const [reason, setReason] = useState('');
  const { data, isPending, error } = useQuery({
    queryKey: ['packages', patientId],
    queryFn: () => api<PatientPackageItem[]>(`/patients/${patientId}/packages`),
  });

  const close = () => {
    setPending(null);
    setReason('');
    setPlanId('');
  };
  const mutate = useMutation({
    mutationFn: async (p: Pending) => {
      if (p.kind === 'purchase')
        return api(`/patients/${patientId}/packages`, { method: 'POST', json: { planId } });
      if (p.kind === 'deduct')
        return api<{ remaining: number }>(`/packages/${p.pkg.id}/usages`, {
          method: 'POST',
          json: { reason },
          headers: { 'idempotency-key': p.key },
        });
      return api(`/package-usages/${p.usageId}/reverse`, { method: 'POST', json: { reason } });
    },
    onSuccess: (res, p) => {
      toast(
        p.kind === 'purchase'
          ? '已開立療程'
          : p.kind === 'deduct'
            ? `已扣 1 堂，剩 ${(res as { remaining: number }).remaining} 堂`
            : '已沖銷，堂數已退回',
      );
      void qc.invalidateQueries({ queryKey: ['packages', patientId] });
      void qc.invalidateQueries({ queryKey: ['board'] });
      close();
    },
  });

  if (error) return <Alert>{errorMessage(error)}</Alert>;
  if (isPending) return <Skeleton className="h-48 w-full" />;

  return (
    <div className="space-y-4">
      {can('package:manage') && (
        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => setPending({ kind: 'purchase' })}>
            <Plus /> 開立療程
          </Button>
        </div>
      )}
      {data.length === 0 && (
        <Card>
          <EmptyState title="尚未購買療程" />
        </Card>
      )}
      {data.map((pkg) => (
        <Card key={pkg.id}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{pkg.name}</h3>
                <Badge
                  tone={pkg.status === 'ACTIVE' ? (pkg.expiringSoon ? 'ochre' : 'jade') : 'neutral'}
                >
                  {pkg.status === 'ACTIVE' && pkg.expiringSoon
                    ? '即將用完／到期'
                    : PACKAGE_STATUS_LABELS[pkg.status]}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {pkg.service.name}・{formatMoney(pkg.price)}・{pkg.purchasedOn} 購買・
                {pkg.expiresOn} 到期
              </p>
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold tabular-nums">
                {pkg.remainingSessions}
                <span className="text-sm font-normal text-ink-muted">
                  {' '}
                  / {pkg.totalSessions} 堂
                </span>
              </p>
              {can('package:deduct') && pkg.status === 'ACTIVE' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-1"
                  onClick={() => setPending({ kind: 'deduct', pkg, key: newIdempotencyKey() })}
                >
                  <Minus /> 手動扣堂
                </Button>
              )}
            </div>
          </div>
          <div className="h-1.5 bg-line/60">
            <div
              className="h-full bg-jade-500"
              style={{ width: `${(pkg.usedSessions / pkg.totalSessions) * 100}%` }}
            />
          </div>
          {pkg.usages.length > 0 && (
            <ul className="divide-y divide-line text-sm">
              {pkg.usages.map((u) => (
                <li
                  key={u.id}
                  className={cn(
                    'flex items-center justify-between gap-3 px-5 py-2',
                    u.reversedById && 'text-ink-muted',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-xs tabular-nums text-ink-muted">
                      {formatDateTime(u.createdAt)}
                    </span>
                    <span className={cn(u.reversedById && 'line-through')}>
                      {u.kind === 'DEDUCT' ? '扣 1 堂' : '沖銷 +1 堂'}
                      <span className="ml-2 text-xs text-ink-muted">
                        {u.reason ?? (u.visitId ? '就診時自動扣堂' : '')}
                        {u.actor && `・${u.actor.name}`}
                      </span>
                    </span>
                  </span>
                  {u.kind === 'DEDUCT' && !u.reversedById && can('package:manage') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setPending({ kind: 'reverse', usageId: u.id, pkg })}
                    >
                      <Undo2 /> 沖銷
                    </Button>
                  )}
                  {u.reversedById && <span className="text-xs">已沖銷</span>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      ))}

      <Dialog
        open={!!pending}
        onClose={close}
        title={
          pending?.kind === 'purchase'
            ? '開立療程'
            : pending?.kind === 'deduct'
              ? `手動扣堂：${pending.pkg.name}`
              : '沖銷扣堂'
        }
        description={
          pending?.kind === 'deduct'
            ? '就診時登記服務項目會自動扣堂；手動扣堂用於補登，請填寫原因。'
            : pending?.kind === 'reverse'
              ? '沖銷會新增一筆 +1 堂的紀錄，原紀錄保留。'
              : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              取消
            </Button>
            <Button
              disabled={
                mutate.isPending || (pending?.kind === 'purchase' ? !planId : !reason.trim())
              }
              onClick={() => pending && mutate.mutate(pending)}
            >
              確定
            </Button>
          </>
        }
      >
        {mutate.error && <Alert className="mb-3">{errorMessage(mutate.error)}</Alert>}
        {pending?.kind === 'purchase' ? (
          <div>
            <Label htmlFor="plan">療程方案</Label>
            <Select id="plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">請選擇</option>
              {config?.packagePlans
                .filter((p) => p.isActive)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}（{p.sessions} 堂・{p.validDays} 天內・{formatMoney(p.price)}）
                  </option>
                ))}
            </Select>
          </div>
        ) : (
          <div>
            <Label htmlFor="reason">原因</Label>
            <Input
              id="reason"
              autoFocus
              maxLength={200}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={pending?.kind === 'deduct' ? '例：補登 11/18 針灸' : '例：誤扣'}
            />
          </div>
        )}
      </Dialog>
    </div>
  );
}
