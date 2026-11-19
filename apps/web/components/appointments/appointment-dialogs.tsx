'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_SOURCES,
  APPOINTMENT_STATUS_LABELS,
  localDate,
  type AppointmentItem,
  type AppointmentSource,
  type AvailabilityResponse,
  type PatientSummary,
} from '@yangbenbu/shared';
import Link from 'next/link';
import { useState } from 'react';
import { PatientPicker } from '@/components/patients/patient-picker';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { Select, Textarea } from '@/components/ui/form';
import { Input, Label } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { useClinicConfig } from '@/lib/queries';
import { formatDay, formatTime } from '@/lib/utils';

const errorMessage = (err: unknown) =>
  err instanceof ApiError ? err.message : '操作失敗，請再試一次';

function useInvalidateAppointments() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['appointments'] });
    void qc.invalidateQueries({ queryKey: ['availability'] });
    void qc.invalidateQueries({ queryKey: ['board'] });
  };
}

export interface SlotTarget {
  doctor: { id: string; name: string };
  startAt: string;
  remaining: number;
}

export function BookDialog({
  target,
  onClose,
}: {
  target: SlotTarget | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateAppointments();
  const { data: config } = useClinicConfig();
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [serviceId, setServiceId] = useState('');
  const [source, setSource] = useState<AppointmentSource>('FRONT_DESK');
  const [note, setNote] = useState('');

  const close = () => {
    setPatient(null);
    setServiceId('');
    setNote('');
    onClose();
  };
  const book = useMutation({
    mutationFn: () =>
      api<AppointmentItem>('/appointments', {
        method: 'POST',
        json: {
          patientId: patient!.id,
          doctorId: target!.doctor.id,
          startAt: target!.startAt,
          serviceId: serviceId || null,
          source,
          note: note || null,
        },
      }),
    onSuccess: (a) => {
      toast(`已為 ${a.patient.name} 預約 ${formatTime(a.startAt)}（${a.doctor.name}）`);
      invalidate();
      close();
    },
  });

  return (
    <Dialog
      open={!!target}
      onClose={close}
      title="新增預約"
      description={
        target &&
        `${target.doctor.name}・${formatDay(localDate(new Date(target.startAt)))} ${formatTime(target.startAt)}・剩 ${target.remaining} 位`
      }
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            取消
          </Button>
          <Button disabled={!patient || book.isPending} onClick={() => book.mutate()}>
            確定預約
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {book.error && <Alert>{errorMessage(book.error)}</Alert>}
        <div>
          <Label>病患</Label>
          <PatientPicker value={patient} onChange={setPatient} />
          <p className="mt-1.5 text-xs text-ink-muted">
            找不到？
            <Link href="/patients/new" className="text-jade-700 hover:underline">
              新增病患
            </Link>
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="book-service">服務項目</Label>
            <Select
              id="book-service"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              <option value="">未指定</option>
              {config?.services
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="book-source">預約來源</Label>
            <Select
              id="book-source"
              value={source}
              onChange={(e) => setSource(e.target.value as AppointmentSource)}
            >
              {APPOINTMENT_SOURCES.filter((s) => s !== 'WALK_IN').map((s) => (
                <option key={s} value={s}>
                  {APPOINTMENT_SOURCE_LABELS[s]}
                </option>
              ))}
            </Select>
          </div>
        </div>
        <div>
          <Label htmlFor="book-note">備註</Label>
          <Textarea
            id="book-note"
            rows={2}
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </div>
    </Dialog>
  );
}

export function AppointmentDialog({
  appointment: a,
  today,
  onClose,
}: {
  appointment: AppointmentItem | null;
  today: string;
  onClose: () => void;
}) {
  const can = useCan();
  const toast = useToast();
  const invalidate = useInvalidateAppointments();
  const [mode, setMode] = useState<'view' | 'cancel' | 'reschedule'>('view');
  const [reason, setReason] = useState('');
  const close = () => {
    setMode('view');
    setReason('');
    onClose();
  };
  const action = useMutation({
    mutationFn: ({ path, json }: { path: string; json?: unknown }) =>
      api(path, { method: 'POST', json }),
    onSuccess: (_r, { path }) => {
      toast(
        path.endsWith('/visits')
          ? '已報到，病患出現在今日看板'
          : path.endsWith('cancel')
            ? '預約已取消'
            : path.endsWith('no-show')
              ? '已標記未到'
              : path.endsWith('reschedule')
                ? '已改期'
                : '預約已確認',
      );
      invalidate();
      close();
    },
  });
  if (!a)
    return (
      <Dialog open={false} onClose={close} title="">
        {null}
      </Dialog>
    );

  const writable = can('appointment:write');
  const active = a.status === 'BOOKED' || a.status === 'CONFIRMED';
  const isToday = localDate(new Date(a.startAt)) === today;
  const past = new Date(a.startAt).getTime() < Date.now();

  return (
    <Dialog
      open
      onClose={close}
      title={`${a.patient.name}・${formatTime(a.startAt)}`}
      description={`${a.doctor.name}${a.service ? `・${a.service.name}` : ''}・${APPOINTMENT_STATUS_LABELS[a.status]}`}
    >
      {action.error && <Alert className="mb-3">{errorMessage(action.error)}</Alert>}
      {mode === 'view' && (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-ink-muted">病歷號</dt>
              <dd className="font-mono">
                <Link href={`/patients/${a.patient.id}`} className="text-jade-700 hover:underline">
                  {a.patient.chartNo}
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">電話</dt>
              <dd className="font-mono">{a.patient.phone}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">來源</dt>
              <dd>{APPOINTMENT_SOURCE_LABELS[a.source]}</dd>
            </div>
            {a.note && (
              <div className="col-span-2">
                <dt className="text-xs text-ink-muted">備註</dt>
                <dd>{a.note}</dd>
              </div>
            )}
            {a.cancelReason && (
              <div className="col-span-2">
                <dt className="text-xs text-ink-muted">取消原因</dt>
                <dd>{a.cancelReason}</dd>
              </div>
            )}
          </dl>
          <div className="flex flex-wrap gap-2">
            {can('board:update') && (active || a.status === 'NO_SHOW') && isToday && (
              <Button
                onClick={() => action.mutate({ path: '/visits', json: { appointmentId: a.id } })}
              >
                報到
              </Button>
            )}
            {writable && a.status === 'BOOKED' && (
              <Button
                variant="secondary"
                onClick={() => action.mutate({ path: `/appointments/${a.id}/confirm` })}
              >
                已電話確認
              </Button>
            )}
            {writable && active && (
              <Button variant="secondary" onClick={() => setMode('reschedule')}>
                改期
              </Button>
            )}
            {writable && active && past && (
              <Button
                variant="secondary"
                onClick={() => action.mutate({ path: `/appointments/${a.id}/no-show` })}
              >
                標記未到
              </Button>
            )}
            {writable && (active || a.status === 'NO_SHOW') && (
              <Button variant="ghost" className="text-danger" onClick={() => setMode('cancel')}>
                取消預約
              </Button>
            )}
          </div>
        </div>
      )}
      {mode === 'cancel' && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate({ path: `/appointments/${a.id}/cancel`, json: { reason } });
          }}
        >
          <Label htmlFor="cancel-reason">取消原因</Label>
          <Input
            id="cancel-reason"
            autoFocus
            value={reason}
            maxLength={200}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例：病患臨時有事"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMode('view')}>
              返回
            </Button>
            <Button type="submit" variant="danger" disabled={!reason.trim() || action.isPending}>
              確定取消
            </Button>
          </div>
        </form>
      )}
      {mode === 'reschedule' && (
        <RescheduleForm
          appointment={a}
          today={today}
          pending={action.isPending}
          onBack={() => setMode('view')}
          onSubmit={(json) => action.mutate({ path: `/appointments/${a.id}/reschedule`, json })}
        />
      )}
    </Dialog>
  );
}

function RescheduleForm({
  appointment,
  today,
  pending,
  onBack,
  onSubmit,
}: {
  appointment: AppointmentItem;
  today: string;
  pending: boolean;
  onBack: () => void;
  onSubmit: (json: { doctorId: string; startAt: string }) => void;
}) {
  const { data: config } = useClinicConfig();
  const original = localDate(new Date(appointment.startAt));
  const [date, setDate] = useState(original < today ? today : original);
  const [doctorId, setDoctorId] = useState(appointment.doctor.id);
  const [startAt, setStartAt] = useState('');
  const { data } = useQuery({
    queryKey: ['availability', date, doctorId],
    queryFn: () => api<AvailabilityResponse>(`/availability?date=${date}&doctorId=${doctorId}`),
  });
  const slots = (data?.doctors[0]?.slots ?? []).filter(
    (s) => !s.past && s.booked < s.capacity && s.startAt !== appointment.startAt,
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ doctorId, startAt });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label htmlFor="rs-date">日期</Label>
          <Input
            id="rs-date"
            type="date"
            min={today}
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setStartAt('');
            }}
          />
        </div>
        <div>
          <Label htmlFor="rs-doctor">醫師</Label>
          <Select
            id="rs-doctor"
            value={doctorId}
            onChange={(e) => {
              setDoctorId(e.target.value);
              setStartAt('');
            }}
          >
            {config?.doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="rs-slot">時段</Label>
        <Select id="rs-slot" value={startAt} onChange={(e) => setStartAt(e.target.value)}>
          <option value="">
            {data?.doctors[0]?.closedReason
              ? `休診（${data.doctors[0].closedReason}）`
              : slots.length
                ? '選擇時段…'
                : '沒有可預約的時段'}
          </option>
          {slots.map((s) => (
            <option key={s.startAt} value={s.startAt}>
              {formatTime(s.startAt)}（剩 {s.capacity - s.booked} 位）
            </option>
          ))}
        </Select>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          返回
        </Button>
        <Button type="submit" disabled={!startAt || pending}>
          確定改期
        </Button>
      </div>
    </form>
  );
}
