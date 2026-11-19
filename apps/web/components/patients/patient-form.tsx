'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GENDERS,
  patientCreateSchema,
  type PatientCreateInput,
  type PatientDetail,
} from '@yangbenbu/shared';
import { Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/form';
import { FieldError, Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { COMMON_TAGS, GENDER_LABELS, PATIENT_SOURCES } from '@/lib/labels';
import { cn } from '@/lib/utils';

type FormState = Record<
  | 'chartNo'
  | 'name'
  | 'gender'
  | 'birthDate'
  | 'phone'
  | 'email'
  | 'address'
  | 'emergencyContactName'
  | 'emergencyContactPhone'
  | 'source'
  | 'nationalId'
  | 'allergies'
  | 'medicalHistory',
  string
> & { tags: string[]; consentSigned: boolean };

function initialState(p?: PatientDetail): FormState {
  return {
    chartNo: p?.chartNo ?? '',
    name: p?.name ?? '',
    gender: p?.gender ?? '',
    birthDate: p?.birthDate ?? '',
    phone: p?.phone ?? '',
    email: p?.email ?? '',
    address: p?.address ?? '',
    emergencyContactName: p?.emergencyContactName ?? '',
    emergencyContactPhone: p?.emergencyContactPhone ?? '',
    source: p?.source ?? '',
    nationalId: '',
    allergies: p?.allergies ?? '',
    medicalHistory: p?.medicalHistory ?? '',
    tags: p?.tags ?? [],
    consentSigned: false,
  };
}

function Field({
  id,
  label,
  error,
  hint,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ink-muted">{hint}</p>}
      <FieldError>{error}</FieldError>
    </div>
  );
}

/**
 * 新增／編輯病患。驗證規則與後端共用同一份 Zod schema。
 * 編輯時只送出有變動的欄位；沒有權限的欄位（病史、聯絡資料）唯讀或隱藏。
 */
export function PatientForm({ patient }: { patient?: PatientDetail }) {
  const can = useCan();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(() => initialState(patient));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tagInput, setTagInput] = useState('');
  const editing = !!patient;
  const canMedical = can('patient:write_medical');
  const canContact = can('patient:read_contact');

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: '' }));
  };

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      editing
        ? api<PatientDetail>(`/patients/${patient.id}`, { method: 'PATCH', json: payload })
        : api<PatientDetail>('/patients', { method: 'POST', json: payload }),
    onSuccess: (p) => {
      void qc.invalidateQueries({ queryKey: ['patients'] });
      toast(editing ? '已儲存' : `已建檔，病歷號 ${p.chartNo}`);
      router.push(`/patients/${p.id}`);
    },
    onError: (err) => {
      if (err instanceof ApiError && err.problem?.errors) {
        setErrors(Object.fromEntries(err.problem.errors.map((e) => [e.path, e.message])));
      }
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      ...form,
      chartNo: form.chartNo || undefined,
      nationalId: form.nationalId || undefined,
    };
    if (!canMedical) {
      delete payload.allergies;
      delete payload.medicalHistory;
    }
    if (!canContact)
      for (const k of ['email', 'address', 'emergencyContactName', 'emergencyContactPhone'])
        delete payload[k];
    if (!form.consentSigned) delete payload.consentSigned;

    // 前端先用同一份 schema 檢查，錯誤直接顯示在欄位下方
    const parsed = patientCreateSchema.safeParse({ ...payload, gender: form.gender || undefined });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    if (editing) {
      // 只送出有變動的欄位，稽核紀錄才會準確
      const before = initialState(patient);
      const diff: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(payload)) {
        if (k === 'chartNo') continue;
        if (
          JSON.stringify(v) !== JSON.stringify(before[k as keyof FormState]) &&
          !(k === 'nationalId' && !v)
        )
          diff[k] = v;
      }
      if (Object.keys(diff).length === 0) {
        router.push(`/patients/${patient.id}`);
        return;
      }
      save.mutate(diff);
    } else {
      save.mutate(payload as PatientCreateInput);
    }
  };

  const addTag = (tag: string) => {
    const t = tag.trim();
    if (t && !form.tags.includes(t) && form.tags.length < 10) set('tags', [...form.tags, t]);
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      {save.error && !(save.error instanceof ApiError && save.error.problem?.errors) && (
        <Alert>{save.error instanceof ApiError ? save.error.message : '儲存失敗'}</Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>基本資料</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="name" label="姓名 *" error={errors.name}>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              aria-invalid={!!errors.name}
            />
          </Field>
          <Field id="gender" label="性別 *" error={errors.gender}>
            <Select
              id="gender"
              value={form.gender}
              onChange={(e) => set('gender', e.target.value)}
              aria-invalid={!!errors.gender}
            >
              <option value="">請選擇</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>
                  {GENDER_LABELS[g]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="birthDate" label="生日 *" error={errors.birthDate}>
            <Input
              id="birthDate"
              type="date"
              value={form.birthDate}
              onChange={(e) => set('birthDate', e.target.value)}
              aria-invalid={!!errors.birthDate}
            />
          </Field>
          <Field id="phone" label="電話 *" error={errors.phone}>
            <Input
              id="phone"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
              aria-invalid={!!errors.phone}
            />
          </Field>
          <Field
            id="nationalId"
            label="身分證字號"
            error={errors.nationalId}
            hint={
              editing
                ? patient.nationalIdMasked
                  ? `目前：${patient.nationalIdMasked}，留空表示不修改`
                  : '尚未填寫'
                : '加密儲存，畫面上一律遮罩'
            }
          >
            <Input
              id="nationalId"
              autoComplete="off"
              value={form.nationalId}
              onChange={(e) => set('nationalId', e.target.value.toUpperCase())}
              aria-invalid={!!errors.nationalId}
            />
          </Field>
          {!editing && (
            <Field
              id="chartNo"
              label="病歷號"
              error={errors.chartNo}
              hint="留空自動編號；可填 HIS 病歷號方便對照"
            >
              <Input
                id="chartNo"
                value={form.chartNo}
                onChange={(e) => set('chartNo', e.target.value)}
              />
            </Field>
          )}
          <Field id="source" label="來源管道">
            <Select id="source" value={form.source} onChange={(e) => set('source', e.target.value)}>
              <option value="">未填</option>
              {[...new Set([...PATIENT_SOURCES, ...(form.source ? [form.source] : [])])].map(
                (s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ),
              )}
            </Select>
          </Field>
          <div className="sm:col-span-2 lg:col-span-3">
            <Label htmlFor="tag-input">標籤</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {form.tags.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() =>
                    set(
                      'tags',
                      form.tags.filter((x) => x !== t),
                    )
                  }
                  className="rounded-full bg-jade-100 px-2.5 py-1 text-xs text-jade-800 hover:bg-jade-200"
                  aria-label={`移除標籤 ${t}`}
                >
                  {t} ×
                </button>
              ))}
              {COMMON_TAGS.filter((t) => !form.tags.includes(t)).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addTag(t)}
                  className="rounded-full border border-dashed border-line px-2.5 py-1 text-xs text-ink-muted hover:border-jade-500 hover:text-jade-700"
                >
                  + {t}
                </button>
              ))}
              <Input
                id="tag-input"
                className="h-8 w-32"
                placeholder="自訂標籤"
                value={tagInput}
                maxLength={20}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTag(tagInput);
                    setTagInput('');
                  }
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>聯絡資料</CardTitle>
        </CardHeader>
        <CardContent>
          {canContact ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="email" label="Email" error={errors.email}>
                <Input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              </Field>
              <Field id="address" label="地址">
                <Input
                  id="address"
                  value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                />
              </Field>
              <Field id="emergencyContactName" label="緊急聯絡人">
                <Input
                  id="emergencyContactName"
                  value={form.emergencyContactName}
                  onChange={(e) => set('emergencyContactName', e.target.value)}
                />
              </Field>
              <Field
                id="emergencyContactPhone"
                label="緊急聯絡人電話"
                error={errors.emergencyContactPhone}
              >
                <Input
                  id="emergencyContactPhone"
                  inputMode="tel"
                  value={form.emergencyContactPhone}
                  onChange={(e) => set('emergencyContactPhone', e.target.value)}
                />
              </Field>
            </div>
          ) : (
            <Restricted>您的角色無法檢視或編輯聯絡資料</Restricted>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>過敏與病史</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {canMedical ? (
            <>
              <Field id="allergies" label="過敏" hint="藥物、食物過敏；會在看板卡片上標示">
                <Textarea
                  id="allergies"
                  rows={2}
                  value={form.allergies}
                  onChange={(e) => set('allergies', e.target.value)}
                />
              </Field>
              <Field id="medicalHistory" label="既往病史">
                <Textarea
                  id="medicalHistory"
                  rows={2}
                  value={form.medicalHistory}
                  onChange={(e) => set('medicalHistory', e.target.value)}
                />
              </Field>
            </>
          ) : (
            <Restricted className="sm:col-span-2">病史與過敏由醫師填寫（加密儲存）</Restricted>
          )}
        </CardContent>
      </Card>

      {(!editing || patient.consentOutdated || !patient.consentSignedAt) && (
        <label className="flex items-start gap-3 rounded-xl border border-line bg-surface px-5 py-4 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4"
            checked={form.consentSigned}
            onChange={(e) => set('consentSigned', e.target.checked)}
          />
          <span>
            病患已簽署個人資料蒐集、處理及利用同意書（目前版本）
            <span className="block text-xs text-ink-muted">紙本同意書請依診所規定保存</span>
          </span>
        </label>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()}>
          取消
        </Button>
        <Button type="submit" disabled={save.isPending}>
          {editing ? '儲存變更' : '建立病患'}
        </Button>
      </div>
    </form>
  );
}

function Restricted({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('flex items-center gap-2 text-sm text-ink-muted', className)}>
      <Lock className="size-4" /> {children}
    </p>
  );
}
