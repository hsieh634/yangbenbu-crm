'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import type { PatientDetail } from '@yangbenbu/shared';
import { ArrowLeft, Eye, EyeOff, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { RequirePermission } from '@/components/shell/guards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { GENDER_LABELS } from '@/lib/labels';
import { ageFrom, formatDateTime } from '@/lib/utils';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

function NationalId({ patientId, masked }: { patientId: string; masked: string | null }) {
  const can = useCan();
  const [shown, setShown] = useState<string | null>(null);
  const reveal = useMutation({
    mutationFn: () => api<{ nationalId: string | null }>(`/patients/${patientId}/national-id/reveal`, { method: 'POST' }),
    onSuccess: (r) => setShown(r.nationalId),
  });

  if (!masked) return <span className="text-ink-muted">未提供</span>;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{shown ?? masked}</span>
      {can('patient:read_national_id') &&
        (shown ? (
          <Button variant="ghost" size="sm" onClick={() => setShown(null)}>
            <EyeOff /> 隱藏
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => reveal.mutate()} disabled={reveal.isPending}>
            <Eye /> 查看完整號碼
          </Button>
        ))}
      {!shown && can('patient:read_national_id') && (
        <span className="text-xs text-ink-muted">查看會記錄於稽核紀錄</span>
      )}
    </div>
  );
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const can = useCan();
  const { data: p, isPending, error } = useQuery({
    queryKey: ['patients', id],
    queryFn: () => api<PatientDetail>(`/patients/${id}`),
  });

  if (error) {
    return <Alert>{error instanceof ApiError && error.status === 404 ? '找不到這位病患，或病患不屬於目前的診所。' : error.message}</Alert>;
  }
  if (isPending) return <Skeleton className="h-72 w-full" />;

  return (
    <>
      <Link href="/patients" className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> 病患列表
      </Link>

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
        <span className="font-mono text-sm text-ink-muted">{p.chartNo}</span>
        {p.tags.map((t) => (
          <Badge key={t} tone="jade">
            {t}
          </Badge>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>基本資料</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-5 sm:grid-cols-2">
              <Field label="性別">{GENDER_LABELS[p.gender]}</Field>
              <Field label="生日">
                {p.birthDate}（{ageFrom(p.birthDate)} 歲）
              </Field>
              <Field label="電話">
                <span className="font-mono">{p.phone}</span>
              </Field>
              <Field label="身分證字號">
                <NationalId patientId={p.id} masked={p.nationalIdMasked} />
              </Field>
              <Field label="建檔時間">{formatDateTime(p.createdAt)}</Field>
              <Field label="最後更新">{formatDateTime(p.updatedAt)}</Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>過敏與病史</CardTitle>
          </CardHeader>
          <CardContent>
            {can('patient:read_medical') ? (
              <dl className="space-y-5">
                <Field label="過敏">
                  {p.allergies ? <Badge tone="danger">{p.allergies}</Badge> : <span className="text-ink-muted">無</span>}
                </Field>
                <Field label="既往病史">{p.medicalHistory ?? <span className="text-ink-muted">無</span>}</Field>
              </dl>
            ) : (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <ShieldAlert className="size-4" /> 您的角色無法檢視此區塊
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 border-dashed bg-transparent">
        <CardContent className="text-sm text-ink-muted">
          就診紀錄、體質問卷、調理方案、療程堂數、追蹤紀錄將於 Phase 1、Phase 2 加入病患 360° 頁面。
        </CardContent>
      </Card>
    </>
  );
}

export default function PatientDetailPage() {
  return (
    <RequirePermission permission="patient:read">
      <Detail />
    </RequirePermission>
  );
}
