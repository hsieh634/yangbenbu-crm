'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  addDays,
  APPOINTMENT_STATUS_LABELS,
  localDate,
  ROLE_LABELS,
  VISIT_STATUS_LABELS,
  type AppointmentItem,
  type AuditLogEntry,
  type Paginated,
  type PatientDetail,
  type PatientPackageItem,
  type PatientVisitItem,
  type Role,
} from '@yangbenbu/shared';
import { AlertTriangle, ArrowLeft, Eye, EyeOff, Lock, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { DispensesPanel } from '@/components/patients/dispenses-panel';
import { PackagesPanel } from '@/components/patients/packages-panel';
import { RequirePermission } from '@/components/shell/guards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, EmptyState, Skeleton } from '@/components/ui/feedback';
import { Table, Td, Th } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { VisitSheet } from '@/components/visits/visit-sheet';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { AUDIT_ACTION_LABELS, GENDER_LABELS } from '@/lib/labels';
import { useClinicConfig } from '@/lib/queries';
import { ageFrom, formatDateTime, formatDay, formatTime } from '@/lib/utils';

type Tab = 'overview' | 'visits' | 'packages' | 'dispenses' | 'audit';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm">{children}</dd>
    </div>
  );
}

const Empty = () => <span className="text-ink-muted">—</span>;

function RestrictedNote({ children }: { children: ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-sm text-ink-muted">
      <Lock className="size-4" /> {children}
    </p>
  );
}

function NationalId({ patientId, masked }: { patientId: string; masked: string | null }) {
  const can = useCan();
  const [shown, setShown] = useState<string | null>(null);
  const reveal = useMutation({
    mutationFn: () =>
      api<{ nationalId: string | null }>(`/patients/${patientId}/national-id/reveal`, {
        method: 'POST',
      }),
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
          <Button
            variant="secondary"
            size="sm"
            onClick={() => reveal.mutate()}
            disabled={reveal.isPending}
          >
            <Eye /> 查看完整號碼
          </Button>
        ))}
      {!shown && can('patient:read_national_id') && (
        <span className="text-xs text-ink-muted">查看會記錄於稽核紀錄</span>
      )}
    </div>
  );
}

function Overview({ p }: { p: PatientDetail }) {
  const can = useCan();
  const { data: config } = useClinicConfig();
  const today = config?.clinic.today;
  const upcoming = useQuery({
    queryKey: ['appointments', 'patient', p.id, today],
    queryFn: () =>
      api<AppointmentItem[]>(
        `/appointments?patientId=${p.id}&from=${today}&to=${addDays(today!, 60)}`,
      ),
    enabled: !!today && can('appointment:read'),
  });
  const packages = useQuery({
    queryKey: ['packages', p.id],
    queryFn: () => api<PatientPackageItem[]>(`/patients/${p.id}/packages`),
    enabled: can('package:read'),
  });
  const active = (packages.data ?? []).filter((x) => x.status === 'ACTIVE');
  const next = (upcoming.data ?? []).filter(
    (a) => a.status === 'BOOKED' || a.status === 'CONFIRMED',
  );
  const contactRestricted = p.restricted.includes('contact');

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
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
              <Field label="來源">{p.source ?? <Empty />}</Field>
              <Field label="個資同意書">
                {p.consentSignedAt ? (
                  <>
                    {formatDateTime(p.consentSignedAt)} 簽署
                    {p.consentOutdated && (
                      <Badge tone="ochre" className="ml-2">
                        版本已更新，需重簽
                      </Badge>
                    )}
                  </>
                ) : (
                  <Badge tone="ochre">尚未簽署</Badge>
                )}
              </Field>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>聯絡資料</CardTitle>
          </CardHeader>
          <CardContent>
            {contactRestricted ? (
              <RestrictedNote>您的角色無法檢視地址與緊急聯絡人</RestrictedNote>
            ) : (
              <dl className="grid gap-5 sm:grid-cols-2">
                <Field label="Email">{p.email ?? <Empty />}</Field>
                <Field label="地址">{p.address ?? <Empty />}</Field>
                <Field label="緊急聯絡人">{p.emergencyContactName ?? <Empty />}</Field>
                <Field label="緊急聯絡人電話">
                  {p.emergencyContactPhone ? (
                    <span className="font-mono">{p.emergencyContactPhone}</span>
                  ) : (
                    <Empty />
                  )}
                </Field>
              </dl>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>過敏與病史</CardTitle>
          </CardHeader>
          <CardContent>
            {p.restricted.includes('medical') ? (
              <RestrictedNote>您的角色無法檢視此區塊</RestrictedNote>
            ) : (
              <dl className="space-y-5">
                <Field label="過敏">
                  {p.allergies ? (
                    <Badge tone="danger">{p.allergies}</Badge>
                  ) : (
                    <span className="text-ink-muted">無</span>
                  )}
                </Field>
                <Field label="既往病史">
                  {p.medicalHistory ?? <span className="text-ink-muted">無</span>}
                </Field>
              </dl>
            )}
          </CardContent>
        </Card>

        {can('appointment:read') && (
          <Card>
            <CardHeader>
              <CardTitle>接下來的預約</CardTitle>
            </CardHeader>
            <CardContent>
              {next.length === 0 ? (
                <p className="text-sm text-ink-muted">沒有預約</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {next.slice(0, 5).map((a) => (
                    <li key={a.id} className="flex justify-between gap-2">
                      <span>
                        {formatDay(localDate(new Date(a.startAt)))} {formatTime(a.startAt)}
                      </span>
                      <span className="text-ink-muted">
                        {a.doctor.name}・{APPOINTMENT_STATUS_LABELS[a.status]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}

        {can('package:read') && (
          <Card>
            <CardHeader>
              <CardTitle>使用中的療程</CardTitle>
            </CardHeader>
            <CardContent>
              {active.length === 0 ? (
                <p className="text-sm text-ink-muted">沒有使用中的療程</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {active.map((x) => (
                    <li key={x.id} className="flex justify-between gap-2">
                      <span>{x.name}</span>
                      <span className={x.expiringSoon ? 'text-ochre-700' : 'text-ink-muted'}>
                        剩 {x.remainingSessions} 堂・{x.expiresOn} 到期
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Visits({ patientId }: { patientId: string }) {
  const can = useCan();
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ['patient-visits', patientId],
    queryFn: () => api<PatientVisitItem[]>(`/patients/${patientId}/visits`),
  });
  if (error) return <Alert>{error.message}</Alert>;
  if (isPending) return <Skeleton className="h-40 w-full" />;
  const clinical = can('visit:read');

  return (
    <Card>
      {data.length === 0 ? (
        <EmptyState title="尚無就診紀錄" />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>日期</Th>
              <Th>醫師</Th>
              <Th>服務項目</Th>
              {clinical && <Th className="hidden md:table-cell">主訴</Th>}
              {clinical && <Th className="hidden sm:table-cell">證型</Th>}
              <Th>狀態</Th>
            </tr>
          </thead>
          <tbody>
            {data.map((v) => (
              <tr
                key={v.id}
                className="cursor-pointer hover:bg-jade-50/50"
                onClick={() => setOpenId(v.id)}
              >
                <Td className="tabular-nums">{v.visitDate}</Td>
                <Td>{v.doctor?.name ?? '—'}</Td>
                <Td>{v.services.join('、') || '—'}</Td>
                {clinical && (
                  <Td className="hidden max-w-64 truncate md:table-cell">
                    {v.chiefComplaint ?? '—'}
                  </Td>
                )}
                {clinical && <Td className="hidden sm:table-cell">{v.pattern ?? '—'}</Td>}
                <Td>
                  <Badge tone={v.status === 'COMPLETED' ? 'neutral' : 'jade'}>
                    {VISIT_STATUS_LABELS[v.status]}
                  </Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {!clinical && (
        <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
          <Lock className="mr-1 inline size-3" />
          您的角色看不到主訴與證型
        </p>
      )}
      <VisitSheet visitId={openId} onClose={() => setOpenId(null)} />
    </Card>
  );
}

function AuditTrail({ patientId }: { patientId: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ['audit', 'patient', patientId],
    queryFn: () => api<Paginated<AuditLogEntry>>(`/audit-logs?patientId=${patientId}&pageSize=50`),
  });
  if (error) return <Alert>{error.message}</Alert>;
  if (isPending) return <Skeleton className="h-40 w-full" />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>誰看過或改過這位病患</CardTitle>
      </CardHeader>
      <Table>
        <thead>
          <tr>
            <Th>時間</Th>
            <Th>人員</Th>
            <Th>動作</Th>
            <Th className="hidden md:table-cell">內容</Th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((e) => (
            <tr key={e.id}>
              <Td className="whitespace-nowrap text-xs tabular-nums text-ink-muted">
                {formatDateTime(e.createdAt)}
              </Td>
              <Td>
                {e.actor?.name ?? '系統'}
                {e.actorRole && (
                  <span className="ml-1 text-xs text-ink-muted">
                    {ROLE_LABELS[e.actorRole as Role]}
                  </span>
                )}
              </Td>
              <Td>{AUDIT_ACTION_LABELS[e.action] ?? e.action}</Td>
              <Td className="hidden max-w-80 truncate font-mono text-xs text-ink-muted md:table-cell">
                {e.metadata ? JSON.stringify(e.metadata) : ''}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const [tab, setTab] = useState<Tab>('overview');
  const {
    data: p,
    isPending,
    error,
  } = useQuery({
    queryKey: ['patients', id],
    queryFn: () => api<PatientDetail>(`/patients/${id}`),
  });

  if (error) {
    return (
      <Alert>
        {error instanceof ApiError && error.status === 404
          ? '找不到這位病患，或病患不屬於目前的診所。'
          : error.message}
      </Alert>
    );
  }
  if (isPending) return <Skeleton className="h-72 w-full" />;

  const tabs: { value: Tab; label: string }[] = [
    { value: 'overview', label: '總覽' },
    { value: 'visits', label: '就診紀錄' },
    ...(can('package:read') ? [{ value: 'packages' as const, label: '療程' }] : []),
    ...(can('medication:read') ? [{ value: 'dispenses' as const, label: '領藥' }] : []),
    ...(can('audit:read') ? [{ value: 'audit' as const, label: '稽核紀錄' }] : []),
  ];

  return (
    <>
      <Link
        href="/patients"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> 病患列表
      </Link>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
          <span className="font-mono text-sm text-ink-muted">{p.chartNo}</span>
          <span className="text-sm text-ink-muted">
            {GENDER_LABELS[p.gender]}・{ageFrom(p.birthDate)} 歲
          </span>
          {p.hasAllergy && (
            <Badge tone="danger">
              <AlertTriangle className="size-3" /> 有過敏史
            </Badge>
          )}
          {p.tags.map((t) => (
            <Badge key={t} tone="jade">
              {t}
            </Badge>
          ))}
        </div>
        {can('patient:write') && (
          <Button variant="secondary" onClick={() => router.push(`/patients/${p.id}/edit`)}>
            <Pencil /> 編輯
          </Button>
        )}
      </div>

      <Tabs tabs={tabs} value={tab} onChange={setTab} className="mb-6" />

      {tab === 'overview' && <Overview p={p} />}
      {tab === 'visits' && <Visits patientId={p.id} />}
      {tab === 'packages' && <PackagesPanel patientId={p.id} />}
      {tab === 'dispenses' && <DispensesPanel patientId={p.id} />}
      {tab === 'audit' && <AuditTrail patientId={p.id} />}
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
