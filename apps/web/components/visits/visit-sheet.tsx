'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ROLE_LABELS,
  ROLES,
  VISIT_STATUS_LABELS,
  VISIT_TRANSITIONS,
  type ClinicalNote,
  type Role,
  type VisitDetail,
  type VisitServiceItem,
} from '@yangbenbu/shared';
import { AlertTriangle, Check, Lock, Pill, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/dialog';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/form';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { FIELD_LABELS } from '@/lib/labels';
import { useClinicConfig } from '@/lib/queries';
import { cn, formatDateTime, formatTime } from '@/lib/utils';

const NOTE_FIELDS: { key: keyof ClinicalNote; rows: number; placeholder: string }[] = [
  { key: 'chiefComplaint', rows: 2, placeholder: '例：肩頸痠痛兩週，低頭工作後加劇' },
  { key: 'fourDiagnosis', rows: 3, placeholder: '望聞問切摘要，例：舌淡紅苔薄白，脈弦細' },
  { key: 'pattern', rows: 1, placeholder: '例：肝鬱氣滯' },
  { key: 'treatmentPrinciple', rows: 1, placeholder: '例：疏肝理氣' },
  { key: 'advice', rows: 2, placeholder: '例：避免生冷飲食，晚上 11 點前就寢' },
];

function errorMessage(err: unknown) {
  return err instanceof ApiError ? err.message : '操作失敗，請再試一次';
}

function Section({
  title,
  children,
  extra,
}: {
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        {extra}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

/** 就診單側邊面板：從今日看板點開。不同角色看到與能操作的區塊不同。 */
export function VisitSheet({ visitId, onClose }: { visitId: string | null; onClose: () => void }) {
  const {
    data: v,
    isPending,
    error,
  } = useQuery({
    queryKey: ['visit', visitId],
    queryFn: () => api<VisitDetail>(`/visits/${visitId}`),
    enabled: !!visitId,
  });

  return (
    <Sheet
      open={!!visitId}
      onClose={onClose}
      title={
        v ? (
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/patients/${v.patient.id}`}
                className="text-lg font-semibold hover:underline"
              >
                {v.patient.name}
              </Link>
              <span className="font-mono text-xs text-ink-muted">{v.patient.chartNo}</span>
              {v.patient.hasAllergy && (
                <Badge tone="danger">
                  <AlertTriangle className="size-3" /> 有過敏史
                </Badge>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {[
                v.doctor?.name,
                v.appointment?.service?.name,
                v.room?.name,
                `報到 ${formatTime(v.checkedInAt)}`,
              ]
                .filter(Boolean)
                .join('・')}
            </p>
          </div>
        ) : (
          <h2 className="text-lg font-semibold">就診單</h2>
        )
      }
    >
      {error && <Alert>{errorMessage(error)}</Alert>}
      {isPending && visitId && <Skeleton className="h-96 w-full" />}
      {v && (
        <div className="space-y-4">
          <StatusSection v={v} />
          <ClinicalNoteSection v={v} />
          <ServicesSection v={v} />
          <HandoffSection v={v} />
          <DispenseSection v={v} />
          <HistorySection v={v} />
        </div>
      )}
    </Sheet>
  );
}

function useInvalidate(visitId: string) {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['visit', visitId] });
    void qc.invalidateQueries({ queryKey: ['board'] });
  };
}

function StatusSection({ v }: { v: VisitDetail }) {
  const can = useCan();
  const toast = useToast();
  const invalidate = useInvalidate(v.id);
  const transition = useMutation({
    mutationFn: (to: string) =>
      api(`/visits/${v.id}/transition`, { method: 'POST', json: { from: v.status, to } }),
    onSuccess: (_r, to) =>
      toast(`已變更為「${VISIT_STATUS_LABELS[to as keyof typeof VISIT_STATUS_LABELS]}」`),
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: invalidate,
  });
  const targets = VISIT_TRANSITIONS[v.status];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge tone={v.status === 'COMPLETED' ? 'neutral' : 'jade'} className="px-3 py-1 text-sm">
        {VISIT_STATUS_LABELS[v.status]}
      </Badge>
      {can('board:update') &&
        targets.map((to, i) => (
          <Button
            key={to}
            size="sm"
            variant={i === 0 ? 'primary' : to === 'CANCELLED' ? 'ghost' : 'secondary'}
            disabled={transition.isPending}
            onClick={() => transition.mutate(to)}
          >
            {i === 0 ? '→ ' : ''}
            {to === 'CANCELLED' ? '取消就診' : VISIT_STATUS_LABELS[to]}
          </Button>
        ))}
    </div>
  );
}

function ClinicalNoteSection({ v }: { v: VisitDetail }) {
  const can = useCan();
  const toast = useToast();
  const invalidate = useInvalidate(v.id);
  const editable = can('visit:write_clinical') && v.status !== 'CANCELLED';
  const [note, setNote] = useState<ClinicalNote | null>(v.clinicalNote);
  useEffect(() => setNote(v.clinicalNote), [v.clinicalNote]);
  const dirty = JSON.stringify(note) !== JSON.stringify(v.clinicalNote);

  const save = useMutation({
    mutationFn: () => api(`/visits/${v.id}/clinical-note`, { method: 'PUT', json: note }),
    onSuccess: () => toast('醫師欄位已儲存'),
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: invalidate,
  });

  if (v.clinicalRestricted || !note) {
    return (
      <Section title="醫師欄位">
        <p className="flex items-center gap-2 text-sm text-ink-muted">
          <Lock className="size-4" /> 您的角色無法檢視主訴、診斷與醫囑
        </p>
      </Section>
    );
  }

  return (
    <Section
      title="醫師欄位"
      extra={
        v.clinicalNoteUpdatedAt && (
          <span className="text-xs text-ink-muted">
            {v.clinicalNoteUpdatedBy?.name}・{formatDateTime(v.clinicalNoteUpdatedAt)}
          </span>
        )
      }
    >
      <div className="space-y-3">
        {NOTE_FIELDS.map((f) => (
          <div key={f.key}>
            <Label htmlFor={`note-${f.key}`} className="text-xs text-ink-muted">
              {FIELD_LABELS[f.key]}
            </Label>
            {editable ? (
              f.rows === 1 ? (
                <Input
                  id={`note-${f.key}`}
                  value={note[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setNote({ ...note, [f.key]: e.target.value || null })}
                />
              ) : (
                <Textarea
                  id={`note-${f.key}`}
                  rows={f.rows}
                  value={note[f.key] ?? ''}
                  placeholder={f.placeholder}
                  onChange={(e) => setNote({ ...note, [f.key]: e.target.value || null })}
                />
              )
            ) : (
              <p id={`note-${f.key}`} className="text-sm whitespace-pre-wrap">
                {note[f.key] ?? <span className="text-ink-muted">—</span>}
              </p>
            )}
          </div>
        ))}
        <p className="text-xs text-ink-muted">
          本系統只做服務紀錄，正式病歷與健保申報以 HIS 為準。
        </p>
        {editable && (
          <div className="flex justify-end">
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              儲存
            </Button>
          </div>
        )}
      </div>
    </Section>
  );
}

function ServicesSection({ v }: { v: VisitDetail }) {
  const can = useCan();
  const toast = useToast();
  const invalidate = useInvalidate(v.id);
  const { data: config } = useClinicConfig();
  const editable = can('visit:write_services') && v.status !== 'CANCELLED';
  const [serviceId, setServiceId] = useState('');
  const used = new Set(v.services.map((s) => s.service.id));
  const options = (config?.services ?? []).filter((s) => s.isActive && !used.has(s.id));

  const add = useMutation({
    mutationFn: () =>
      api<VisitServiceItem>(`/visits/${v.id}/services`, { method: 'POST', json: { serviceId } }),
    onSuccess: (r) => {
      setServiceId('');
      toast(
        r.packageName
          ? `已登記「${r.service.name}」，從「${r.packageName}」扣 1 堂（剩 ${r.packageRemaining} 堂）`
          : `已登記「${r.service.name}」（無可抵用的療程）`,
      );
    },
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: invalidate,
  });
  const remove = useMutation({
    mutationFn: (item: VisitServiceItem) =>
      api(`/visits/${v.id}/services/${item.id}`, { method: 'DELETE' }),
    onSuccess: (_r, item) =>
      toast(
        item.packageName
          ? `已移除「${item.service.name}」並退回 1 堂`
          : `已移除「${item.service.name}」`,
      ),
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: invalidate,
  });

  return (
    <Section title="本次服務項目">
      {v.services.length === 0 && <p className="text-sm text-ink-muted">尚未登記</p>}
      <ul className="space-y-2">
        {v.services.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 text-sm">
            <span>
              {s.service.name}
              {s.packageName ? (
                <span className="ml-2 text-xs text-jade-700">扣「{s.packageName}」1 堂</span>
              ) : (
                <span className="ml-2 text-xs text-ink-muted">自費／未扣堂</span>
              )}
            </span>
            {editable && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`移除${s.service.name}`}
                disabled={remove.isPending}
                onClick={() => remove.mutate(s)}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {editable && options.length > 0 && (
        <div className="mt-3 flex gap-2">
          <Select
            aria-label="選擇服務項目"
            value={serviceId}
            onChange={(e) => setServiceId(e.target.value)}
          >
            <option value="">選擇服務項目…</option>
            {options.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <Button
            variant="secondary"
            disabled={!serviceId || add.isPending}
            onClick={() => add.mutate()}
          >
            <Plus /> 登記
          </Button>
        </div>
      )}
      {editable && (
        <p className="mt-2 text-xs text-ink-muted">
          病患有可抵用的療程時會自動扣堂，移除時自動退回。
        </p>
      )}
    </Section>
  );
}

function HandoffSection({ v }: { v: VisitDetail }) {
  const can = useCan();
  const toast = useToast();
  const invalidate = useInvalidate(v.id);
  const [body, setBody] = useState('');
  const [targetRole, setTargetRole] = useState<Role | ''>('');
  const editable = can('board:update');

  const add = useMutation({
    mutationFn: () =>
      api(`/visits/${v.id}/handoffs`, {
        method: 'POST',
        json: { body, targetRole: targetRole || null },
      }),
    onSuccess: () => {
      setBody('');
      toast('已留下交接備註');
    },
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: invalidate,
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api(`/visits/${v.id}/handoffs/${id}/resolve`, { method: 'POST' }),
    onError: (err) => toast(errorMessage(err), 'error'),
    onSettled: invalidate,
  });

  return (
    <Section title="交接備註">
      {v.handoffs.length === 0 && <p className="text-sm text-ink-muted">沒有交接事項</p>}
      <ul className="space-y-2">
        {v.handoffs.map((h) => (
          <li
            key={h.id}
            className={cn(
              'rounded-lg px-3 py-2 text-sm',
              h.resolvedAt ? 'bg-paper text-ink-muted' : 'bg-ochre-100',
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <p className={cn(h.resolvedAt && 'line-through')}>{h.body}</p>
              {!h.resolvedAt && editable && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={() => resolve.mutate(h.id)}
                >
                  <Check /> 完成
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-muted">
              {h.author?.name}・{formatTime(h.createdAt)}
              {h.targetRole && `・給${ROLE_LABELS[h.targetRole]}`}
              {h.resolvedBy && `・${h.resolvedBy.name} 已處理`}
            </p>
          </li>
        ))}
      </ul>
      {editable && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate();
          }}
        >
          <Textarea
            aria-label="交接內容"
            rows={2}
            value={body}
            maxLength={500}
            placeholder="例：左肩針灸後請熱敷 10 分鐘"
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex gap-2">
            <Select
              aria-label="交接對象"
              value={targetRole}
              onChange={(e) => setTargetRole(e.target.value as Role | '')}
            >
              <option value="">所有人</option>
              {ROLES.filter((r) => r !== 'ADMIN').map((r) => (
                <option key={r} value={r}>
                  給{ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" disabled={!body.trim() || add.isPending}>
              留言
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

function DispenseSection({ v }: { v: VisitDetail }) {
  const can = useCan();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState('科學中藥 7 日份');
  const [days, setDays] = useState(7);
  const add = useMutation({
    mutationFn: () =>
      api<{ nextEligibleOn: string }>(`/patients/${v.patient.id}/dispenses`, {
        method: 'POST',
        json: { name, days, visitId: v.id },
      }),
    onSuccess: (r) => {
      toast(`已登記領藥，下次可領日 ${r.nextEligibleOn}`);
      void qc.invalidateQueries({ queryKey: ['dispenses', v.patient.id] });
    },
    onError: (err) => toast(errorMessage(err), 'error'),
  });
  if (!can('medication:write') || v.status === 'CANCELLED') return null;

  return (
    <Section title="登記領藥">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <div className="min-w-40 flex-1">
          <Label htmlFor="dispense-name" className="text-xs text-ink-muted">
            藥品／處方（以 HIS 為準）
          </Label>
          <Input id="dispense-name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="w-20">
          <Label htmlFor="dispense-days" className="text-xs text-ink-muted">
            天數
          </Label>
          <Input
            id="dispense-days"
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!name.trim() || add.isPending}>
          <Pill /> 登記
        </Button>
      </form>
    </Section>
  );
}

function HistorySection({ v }: { v: VisitDetail }) {
  return (
    <Section title="狀態紀錄">
      <ol className="space-y-1.5 text-sm">
        {v.events.map((e) => (
          <li key={e.id} className="flex gap-3">
            <span className="w-12 shrink-0 tabular-nums text-ink-muted">
              {formatTime(e.createdAt)}
            </span>
            <span>
              {e.fromStatus ? `${VISIT_STATUS_LABELS[e.fromStatus]} → ` : ''}
              {VISIT_STATUS_LABELS[e.toStatus]}
              <span className="ml-2 text-xs text-ink-muted">{e.actor?.name ?? '系統'}</span>
            </span>
          </li>
        ))}
      </ol>
    </Section>
  );
}
