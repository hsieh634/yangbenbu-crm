'use client';

import { useQuery } from '@tanstack/react-query';
import {
  addDays,
  APPOINTMENT_STATUS_LABELS,
  type AppointmentItem,
  type AppointmentStatus,
  type AvailabilityResponse,
} from '@yangbenbu/shared';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  AppointmentDialog,
  BookDialog,
  type SlotTarget,
} from '@/components/appointments/appointment-dialogs';
import { RequirePermission } from '@/components/shell/guards';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, EmptyState, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useClinicConfig } from '@/lib/queries';
import { cn, formatLongDay, formatTime } from '@/lib/utils';

const STATUS_STYLE: Record<AppointmentStatus, string> = {
  BOOKED: 'border-line bg-surface',
  CONFIRMED: 'border-jade-200 bg-jade-50',
  CHECKED_IN: 'border-jade-500 bg-jade-100',
  NO_SHOW: 'border-danger/30 bg-danger-soft text-danger',
  CANCELLED: 'border-line bg-paper text-ink-muted line-through',
};

function Calendar() {
  const can = useCan();
  const { data: config } = useClinicConfig();
  const today = config?.clinic.today;
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today ?? '';
  const [booking, setBooking] = useState<SlotTarget | null>(null);
  const [opened, setOpened] = useState<AppointmentItem | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);

  const availability = useQuery({
    queryKey: ['availability', date],
    queryFn: () => api<AvailabilityResponse>(`/availability?date=${date}`),
    enabled: !!date,
  });
  const appointments = useQuery({
    queryKey: ['appointments', date],
    queryFn: () => api<AppointmentItem[]>(`/appointments?from=${date}&to=${date}`),
    enabled: !!date,
  });

  const { rows, byCell, others, counts } = useMemo(() => {
    const list = appointments.data ?? [];
    const times = new Set<string>();
    for (const d of availability.data?.doctors ?? []) for (const s of d.slots) times.add(s.startAt);
    const byCell = new Map<string, AppointmentItem[]>();
    const others: AppointmentItem[] = [];
    const counts: Partial<Record<AppointmentStatus, number>> = {};
    for (const a of list) {
      counts[a.status] = (counts[a.status] ?? 0) + 1;
      if (a.status === 'CANCELLED' && !showCancelled) continue;
      if (!times.has(a.startAt)) {
        others.push(a); // 現場掛號或排班調整前的預約
        continue;
      }
      const key = `${a.doctor.id}|${a.startAt}`;
      byCell.set(key, [...(byCell.get(key) ?? []), a]);
    }
    return { rows: [...times].sort(), byCell, others, counts };
  }, [appointments.data, availability.data, showCancelled]);

  const doctors = availability.data?.doctors ?? [];
  const slotOf = (doctorId: string, startAt: string) =>
    doctors.find((d) => d.doctor.id === doctorId)?.slots.find((s) => s.startAt === startAt);

  return (
    <>
      <PageHeader
        title="預約"
        description={date ? formatLongDay(date) : ' '}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="icon"
              aria-label="前一天"
              onClick={() => setPicked(addDays(date, -1))}
            >
              <ChevronLeft />
            </Button>
            <Input
              type="date"
              aria-label="選擇日期"
              className="w-40"
              value={date}
              onChange={(e) => e.target.value && setPicked(e.target.value)}
            />
            <Button
              variant="secondary"
              size="icon"
              aria-label="後一天"
              onClick={() => setPicked(addDays(date, 1))}
            >
              <ChevronRight />
            </Button>
            {today && date !== today && (
              <Button variant="ghost" onClick={() => setPicked(null)}>
                今天
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-ink-muted">
        {(['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'NO_SHOW', 'CANCELLED'] as const).map((s) => (
          <span key={s} className="inline-flex items-center gap-1.5">
            <span className={cn('size-3 rounded-sm border', STATUS_STYLE[s])} />
            {APPOINTMENT_STATUS_LABELS[s]}{' '}
            <span className="tabular-nums text-ink">{counts[s] ?? 0}</span>
          </span>
        ))}
        <label className="ml-auto inline-flex items-center gap-2">
          <input
            type="checkbox"
            checked={showCancelled}
            onChange={(e) => setShowCancelled(e.target.checked)}
          />
          顯示已取消
        </label>
      </div>

      {(availability.error || appointments.error) && (
        <Alert className="mb-4">{(availability.error ?? appointments.error)!.message}</Alert>
      )}

      {availability.isPending || appointments.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : doctors.every((d) => d.slots.length === 0) && others.length === 0 ? (
        <Card>
          <EmptyState title="這天沒有門診">
            {doctors
              .map((d) => d.closedReason && `${d.doctor.name}：${d.closedReason}`)
              .filter(Boolean)
              .join('、') || '醫師當天沒有排班。'}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead>
              <tr>
                <th className="sticky left-0 w-16 border-b border-line bg-surface px-3 py-2.5 text-left text-xs font-medium text-ink-muted">
                  時段
                </th>
                {doctors.map((d) => (
                  <th
                    key={d.doctor.id}
                    className="border-b border-l border-line px-3 py-2.5 text-left font-medium"
                  >
                    {d.doctor.name}
                    {d.closedReason && (
                      <span className="ml-2 text-xs text-danger">休診：{d.closedReason}</span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((startAt) => (
                <tr key={startAt} className="align-top">
                  <td className="sticky left-0 border-b border-line bg-surface px-3 py-2 text-xs tabular-nums text-ink-muted">
                    {formatTime(startAt)}
                  </td>
                  {doctors.map((d) => {
                    const slot = slotOf(d.doctor.id, startAt);
                    const items = byCell.get(`${d.doctor.id}|${startAt}`) ?? [];
                    const remaining = slot ? slot.capacity - slot.booked : 0;
                    return (
                      <td
                        key={d.doctor.id}
                        className={cn(
                          'border-b border-l border-line px-2 py-1.5',
                          !slot && 'bg-paper/70',
                        )}
                      >
                        <div className="flex flex-wrap gap-1.5">
                          {items.map((a) => (
                            <button
                              key={a.id}
                              type="button"
                              onClick={() => setOpened(a)}
                              className={cn(
                                'rounded-md border px-2 py-1 text-left text-xs hover:shadow-sm',
                                STATUS_STYLE[a.status],
                              )}
                            >
                              <span className="font-medium">{a.patient.name}</span>
                              {a.service && (
                                <span className="ml-1 text-ink-muted">{a.service.name}</span>
                              )}
                            </button>
                          ))}
                          {slot && !slot.past && remaining > 0 && can('appointment:write') && (
                            <button
                              type="button"
                              onClick={() => setBooking({ doctor: d.doctor, startAt, remaining })}
                              className="inline-flex items-center gap-0.5 rounded-md border border-dashed border-line px-2 py-1 text-xs text-ink-muted hover:border-jade-500 hover:text-jade-700"
                              aria-label={`預約 ${d.doctor.name} ${formatTime(startAt)}`}
                            >
                              <Plus className="size-3" /> {remaining}
                            </button>
                          )}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {others.length > 0 && (
            <div className="border-t border-line px-4 py-3">
              <p className="mb-2 text-xs text-ink-muted">現場掛號／非排班時段</p>
              <div className="flex flex-wrap gap-1.5">
                {others.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => setOpened(a)}
                    className={cn('rounded-md border px-2 py-1 text-xs', STATUS_STYLE[a.status])}
                  >
                    {formatTime(a.startAt)} {a.patient.name}・{a.doctor.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      <BookDialog target={booking} onClose={() => setBooking(null)} />
      {today && (
        <AppointmentDialog appointment={opened} today={today} onClose={() => setOpened(null)} />
      )}
    </>
  );
}

export default function AppointmentsPage() {
  return (
    <RequirePermission permission="appointment:read">
      <Calendar />
    </RequirePermission>
  );
}
