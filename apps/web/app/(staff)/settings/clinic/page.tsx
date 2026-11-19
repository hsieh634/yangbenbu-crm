'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  hhmmToMinute,
  minuteToHHMM,
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_LABELS,
  WEEKDAY_LABELS,
  type ClinicConfig,
  type PackagePlanItem,
  type ScheduleItem,
  type ServiceCategory,
  type ServiceItem,
} from '@yangbenbu/shared';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { RequirePermission } from '@/components/shell/guards';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Alert, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { Input, Label } from '@/components/ui/input';
import { Table, Td, Th } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { CLINIC_CONFIG_KEY, useClinicConfig } from '@/lib/queries';
import { formatMoney } from '@/lib/utils';

const errorMessage = (err: unknown) => {
  if (err instanceof ApiError) return err.problem?.errors?.[0]?.message ?? err.message;
  return '儲存失敗';
};

function useSave<T>(fn: (input: T) => Promise<unknown>, message: string, onDone: () => void) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      toast(message);
      void qc.invalidateQueries({ queryKey: CLINIC_CONFIG_KEY });
      void qc.invalidateQueries({ queryKey: ['availability'] });
      onDone();
    },
  });
}

function SectionCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex items-center justify-between">
        <CardTitle>{title}</CardTitle>
        {action}
      </CardHeader>
      {children}
    </Card>
  );
}

// ── 服務項目 ─────────────────────────────────────────────────────────
function Services({ config }: { config: ClinicConfig }) {
  const [editing, setEditing] = useState<ServiceItem | 'new' | null>(null);
  const [form, setForm] = useState({
    code: '',
    name: '',
    category: 'OTHER' as ServiceCategory,
    durationMinutes: 20,
    isActive: true,
  });
  const open = (s: ServiceItem | 'new') => {
    setEditing(s);
    setForm(
      s === 'new'
        ? { code: '', name: '', category: 'OTHER', durationMinutes: 20, isActive: true }
        : { ...s },
    );
  };
  const save = useSave(
    () =>
      editing === 'new'
        ? api('/services', { method: 'POST', json: form })
        : api(`/services/${(editing as ServiceItem).id}`, { method: 'PATCH', json: form }),
    '服務項目已儲存',
    () => setEditing(null),
  );
  return (
    <SectionCard
      title="服務項目"
      action={
        <Button size="sm" variant="secondary" onClick={() => open('new')}>
          <Plus /> 新增
        </Button>
      }
    >
      <Table>
        <thead>
          <tr>
            <Th>代碼</Th>
            <Th>名稱</Th>
            <Th>類別</Th>
            <Th>時間</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {config.services.map((s) => (
            <tr key={s.id}>
              <Td className="font-mono text-xs">{s.code}</Td>
              <Td>
                {s.name}
                {!s.isActive && <Badge className="ml-2">停用</Badge>}
              </Td>
              <Td>{SERVICE_CATEGORY_LABELS[s.category]}</Td>
              <Td>{s.durationMinutes} 分</Td>
              <Td className="text-right">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`編輯${s.name}`}
                  onClick={() => open(s)}
                >
                  <Pencil />
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增服務項目' : '編輯服務項目'}
        footer={
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            儲存
          </Button>
        }
      >
        {save.error && <Alert className="mb-3">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="svc-code">代碼</Label>
            <Input
              id="svc-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
            />
          </div>
          <div>
            <Label htmlFor="svc-name">名稱</Label>
            <Input
              id="svc-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="svc-cat">類別</Label>
            <Select
              id="svc-cat"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value as ServiceCategory })}
            >
              {SERVICE_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {SERVICE_CATEGORY_LABELS[c]}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="svc-min">時間（分鐘）</Label>
            <Input
              id="svc-min"
              type="number"
              min={5}
              max={240}
              value={form.durationMinutes}
              onChange={(e) => setForm({ ...form, durationMinutes: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            啟用
          </label>
        </div>
      </Dialog>
    </SectionCard>
  );
}

// ── 療程方案 ─────────────────────────────────────────────────────────
function Plans({ config }: { config: ClinicConfig }) {
  const [editing, setEditing] = useState<PackagePlanItem | 'new' | null>(null);
  const empty = {
    name: '',
    serviceId: config.services[0]?.id ?? '',
    sessions: 10,
    validDays: 180,
    price: 0,
    isActive: true,
  };
  const [form, setForm] = useState(empty);
  const open = (p: PackagePlanItem | 'new') => {
    setEditing(p);
    setForm(
      p === 'new'
        ? empty
        : {
            name: p.name,
            serviceId: p.service.id,
            sessions: p.sessions,
            validDays: p.validDays,
            price: p.price,
            isActive: p.isActive,
          },
    );
  };
  const save = useSave(
    () =>
      editing === 'new'
        ? api('/package-plans', { method: 'POST', json: form })
        : api(`/package-plans/${(editing as PackagePlanItem).id}`, { method: 'PATCH', json: form }),
    '療程方案已儲存',
    () => setEditing(null),
  );
  return (
    <SectionCard
      title="療程方案"
      action={
        <Button size="sm" variant="secondary" onClick={() => open('new')}>
          <Plus /> 新增
        </Button>
      }
    >
      <Table>
        <thead>
          <tr>
            <Th>名稱</Th>
            <Th>抵用服務</Th>
            <Th>堂數</Th>
            <Th className="hidden sm:table-cell">效期</Th>
            <Th>價格</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {config.packagePlans.map((p) => (
            <tr key={p.id}>
              <Td>
                {p.name}
                {!p.isActive && <Badge className="ml-2">停用</Badge>}
              </Td>
              <Td>{p.service.name}</Td>
              <Td>{p.sessions}</Td>
              <Td className="hidden sm:table-cell">{p.validDays} 天</Td>
              <Td className="tabular-nums">{formatMoney(p.price)}</Td>
              <Td className="text-right">
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`編輯${p.name}`}
                  onClick={() => open(p)}
                >
                  <Pencil />
                </Button>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
      <CardContent className="text-xs text-ink-muted">
        已售出的療程保留購買當下的堂數與價格，修改方案不影響。
      </CardContent>
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? '新增療程方案' : '編輯療程方案'}
        footer={
          <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
            儲存
          </Button>
        }
      >
        {save.error && <Alert className="mb-3">{errorMessage(save.error)}</Alert>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="plan-name">名稱</Label>
            <Input
              id="plan-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="例：針灸 10 堂"
            />
          </div>
          <div>
            <Label htmlFor="plan-svc">抵用服務</Label>
            <Select
              id="plan-svc"
              value={form.serviceId}
              onChange={(e) => setForm({ ...form, serviceId: e.target.value })}
            >
              {config.services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="plan-sessions">堂數</Label>
            <Input
              id="plan-sessions"
              type="number"
              min={1}
              value={form.sessions}
              onChange={(e) => setForm({ ...form, sessions: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="plan-days">效期（天）</Label>
            <Input
              id="plan-days"
              type="number"
              min={1}
              value={form.validDays}
              onChange={(e) => setForm({ ...form, validDays: Number(e.target.value) })}
            />
          </div>
          <div>
            <Label htmlFor="plan-price">價格（元）</Label>
            <Input
              id="plan-price"
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => setForm({ ...form, price: Number(e.target.value) })}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            開放購買
          </label>
        </div>
      </Dialog>
    </SectionCard>
  );
}

// ── 醫師排班 ─────────────────────────────────────────────────────────
type Block = {
  weekday: number;
  start: string;
  end: string;
  slotMinutes: number;
  capacity: number;
  roomId: string;
};

function toBlock(s: ScheduleItem): Block {
  return {
    weekday: s.weekday,
    start: minuteToHHMM(s.startMinute),
    end: minuteToHHMM(s.endMinute),
    slotMinutes: s.slotMinutes,
    capacity: s.capacity,
    roomId: s.roomId ?? '',
  };
}

function Schedules({ config }: { config: ClinicConfig }) {
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const open = (id: string) => {
    setDoctorId(id);
    setBlocks(config.schedules.filter((s) => s.doctorId === id).map(toBlock));
  };
  const save = useSave(
    () =>
      api(`/doctors/${doctorId}/schedules`, {
        method: 'PUT',
        json: {
          items: blocks.map((b) => ({
            weekday: b.weekday,
            startMinute: hhmmToMinute(b.start),
            endMinute: hhmmToMinute(b.end),
            slotMinutes: b.slotMinutes,
            capacity: b.capacity,
            roomId: b.roomId || null,
          })),
        },
      }),
    '排班已更新，新的時段立即開放預約',
    () => setDoctorId(null),
  );
  const update = (i: number, patch: Partial<Block>) =>
    setBlocks(blocks.map((b, j) => (j === i ? { ...b, ...patch } : b)));

  return (
    <SectionCard title="醫師每週排班">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr>
              <Th>醫師</Th>
              {WEEKDAY_LABELS.map((d) => (
                <Th key={d} className="text-center">
                  週{d}
                </Th>
              ))}
              <Th />
            </tr>
          </thead>
          <tbody>
            {config.doctors.map((d) => (
              <tr key={d.id} className="align-top">
                <Td className="font-medium">{d.name}</Td>
                {WEEKDAY_LABELS.map((_, wd) => (
                  <Td key={wd} className="text-center text-xs">
                    {config.schedules
                      .filter((s) => s.doctorId === d.id && s.weekday === wd)
                      .map((s) => (
                        <div
                          key={s.id}
                          className="mb-1 rounded bg-jade-50 px-1 py-0.5 tabular-nums text-jade-800"
                        >
                          {minuteToHHMM(s.startMinute)}–{minuteToHHMM(s.endMinute)}
                        </div>
                      ))}
                  </Td>
                ))}
                <Td className="text-right">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`編輯${d.name}的排班`}
                    onClick={() => open(d.id)}
                  >
                    <Pencil />
                  </Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog
        open={!!doctorId}
        onClose={() => setDoctorId(null)}
        className="max-w-3xl"
        title={`編輯排班：${config.doctors.find((d) => d.id === doctorId)?.name ?? ''}`}
        description="每段門診會依「間隔」切成預約時段。已成立的預約不受影響。"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() =>
                setBlocks([
                  ...blocks,
                  {
                    weekday: 1,
                    start: '09:00',
                    end: '12:00',
                    slotMinutes: 15,
                    capacity: 2,
                    roomId: '',
                  },
                ])
              }
            >
              <Plus /> 新增時段
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate(undefined)}>
              儲存
            </Button>
          </>
        }
      >
        {save.error && <Alert className="mb-3">{errorMessage(save.error)}</Alert>}
        {blocks.length === 0 && <p className="text-sm text-ink-muted">沒有門診時段</p>}
        <div className="space-y-2">
          {blocks.map((b, i) => (
            <div
              key={i}
              className="grid grid-cols-2 items-end gap-2 rounded-lg border border-line p-2 sm:grid-cols-[5rem_6rem_6rem_5rem_4.5rem_1fr_auto]"
            >
              <div>
                <Label className="text-xs text-ink-muted">星期</Label>
                <Select
                  aria-label="星期"
                  value={b.weekday}
                  onChange={(e) => update(i, { weekday: Number(e.target.value) })}
                >
                  {WEEKDAY_LABELS.map((d, wd) => (
                    <option key={d} value={wd}>
                      週{d}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="text-xs text-ink-muted">開始</Label>
                <Input
                  aria-label="開始時間"
                  type="time"
                  step={300}
                  value={b.start}
                  onChange={(e) => update(i, { start: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs text-ink-muted">結束</Label>
                <Input
                  aria-label="結束時間"
                  type="time"
                  step={300}
                  value={b.end}
                  onChange={(e) => update(i, { end: e.target.value })}
                />
              </div>
              <div>
                <Label className="text-xs text-ink-muted">間隔</Label>
                <Select
                  aria-label="預約間隔"
                  value={b.slotMinutes}
                  onChange={(e) => update(i, { slotMinutes: Number(e.target.value) })}
                >
                  {[10, 15, 20, 30].map((m) => (
                    <option key={m} value={m}>
                      {m} 分
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label className="text-xs text-ink-muted">每段人數</Label>
                <Input
                  aria-label="每時段人數"
                  type="number"
                  min={1}
                  max={20}
                  value={b.capacity}
                  onChange={(e) => update(i, { capacity: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs text-ink-muted">診間</Label>
                <Select
                  aria-label="診間"
                  value={b.roomId}
                  onChange={(e) => update(i, { roomId: e.target.value })}
                >
                  <option value="">未指定</option>
                  {config.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                size="icon"
                variant="ghost"
                aria-label="刪除時段"
                onClick={() => setBlocks(blocks.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
        </div>
      </Dialog>
    </SectionCard>
  );
}

// ── 休診日 ───────────────────────────────────────────────────────────
function Closures({ config }: { config: ClinicConfig }) {
  const toast = useToast();
  const [form, setForm] = useState({ date: '', doctorId: '', reason: '' });
  const qc = useQueryClient();
  const add = useMutation({
    mutationFn: () =>
      api<{ affectedAppointments: number }>('/schedule-closures', {
        method: 'POST',
        json: { date: form.date, doctorId: form.doctorId || null, reason: form.reason || null },
      }),
    onSuccess: (r) => {
      toast(
        r.affectedAppointments
          ? `已設定休診。當天已有 ${r.affectedAppointments} 筆預約，請逐一聯絡病患改期`
          : '已設定休診',
      );
      setForm({ date: '', doctorId: '', reason: '' });
      void qc.invalidateQueries({ queryKey: CLINIC_CONFIG_KEY });
      void qc.invalidateQueries({ queryKey: ['availability'] });
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/schedule-closures/${id}`, { method: 'DELETE' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: CLINIC_CONFIG_KEY }),
  });

  return (
    <SectionCard title="休診日">
      <CardContent className="space-y-4">
        {add.error && <Alert>{errorMessage(add.error)}</Alert>}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (form.date) add.mutate();
          }}
        >
          <div>
            <Label htmlFor="cl-date">日期</Label>
            <Input
              id="cl-date"
              type="date"
              min={config.clinic.today}
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="cl-doctor">範圍</Label>
            <Select
              id="cl-doctor"
              value={form.doctorId}
              onChange={(e) => setForm({ ...form, doctorId: e.target.value })}
            >
              <option value="">全院休診</option>
              {config.doctors.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-40 flex-1">
            <Label htmlFor="cl-reason">原因</Label>
            <Input
              id="cl-reason"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder="例：國定假日、醫師進修"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={!form.date || add.isPending}>
            <Plus /> 新增
          </Button>
        </form>
        {config.closures.length === 0 ? (
          <p className="text-sm text-ink-muted">近期沒有休診日</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {config.closures.map((c) => (
              <li key={c.id} className="flex items-center justify-between py-2">
                <span>
                  <span className="tabular-nums">{c.date}</span>
                  <span className="ml-3">{c.doctor?.name ?? '全院'}</span>
                  {c.reason && <span className="ml-3 text-ink-muted">{c.reason}</span>}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="刪除休診日"
                  onClick={() => remove.mutate(c.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </SectionCard>
  );
}

function Settings() {
  const { data: config, isPending, error } = useClinicConfig();
  if (error) return <Alert>{error.message}</Alert>;
  if (isPending) return <Skeleton className="h-96 w-full" />;
  return (
    <>
      <PageHeader title="診所設定" description={config.clinic.name} />
      <div className="space-y-6">
        <Schedules config={config} />
        <Closures config={config} />
        <div className="grid gap-6 xl:grid-cols-2">
          <Services config={config} />
          <Plans config={config} />
        </div>
      </div>
    </>
  );
}

export default function ClinicSettingsPage() {
  return (
    <RequirePermission permission="settings:manage">
      <Settings />
    </RequirePermission>
  );
}
