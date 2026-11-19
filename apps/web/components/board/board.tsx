'use client';

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BOARD_COLUMNS,
  canTransition,
  nextVisitStatus,
  VISIT_STATUS_LABELS,
  type BoardCard,
  type BoardColumn,
  type BoardResponse,
  type VisitStatus,
} from '@yangbenbu/shared';
import {
  AlertTriangle,
  ArrowRight,
  Clock,
  MessageSquareText,
  Package,
  Radio,
  UserCheck,
  UserPlus,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Alert, PageHeader, Skeleton } from '@/components/ui/feedback';
import { Select } from '@/components/ui/form';
import { useToast } from '@/components/ui/toast';
import { VisitSheet } from '@/components/visits/visit-sheet';
import { ApiError, api } from '@/lib/api';
import { useCan } from '@/lib/auth';
import { cn, formatLongDay, formatTime, minutesSince } from '@/lib/utils';
import { useBoardStream, useNow, type StreamState } from './use-board-stream';
import { WalkInDialog } from './walk-in-dialog';

const BOARD_KEY = ['board'] as const;

/** 拖曳目標是否合法：已預約只能拖到已報到；就診單依狀態機 */
function canDrop(card: BoardCard, to: BoardColumn): boolean {
  if (card.column === to) return false;
  if (card.kind === 'appointment') return to === 'CHECKED_IN';
  if (to === 'SCHEDULED') return false;
  return canTransition(card.column as VisitStatus, to as VisitStatus);
}

function moveCard(data: BoardResponse, id: string, to: BoardColumn): BoardResponse {
  return {
    ...data,
    cards: data.cards.map((c) =>
      c.id === id ? { ...c, column: to, statusChangedAt: new Date().toISOString() } : c,
    ),
  };
}

export function Board() {
  const can = useCan();
  const canUpdate = can('board:update');
  const queryClient = useQueryClient();
  const toast = useToast();
  const now = useNow();
  const stream = useBoardStream(true);
  const [doctorId, setDoctorId] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [openVisitId, setOpenVisitId] = useState<string | null>(null);
  const [walkIn, setWalkIn] = useState(false);

  const { data, isPending, error } = useQuery({
    queryKey: BOARD_KEY,
    queryFn: () => api<BoardResponse>('/board'),
    // 即時同步斷線時的保險：每分鐘重新抓一次
    refetchInterval: stream === 'live' ? false : 60_000,
  });

  const move = useMutation({
    mutationFn: async ({ card, to }: { card: BoardCard; to: BoardColumn }) => {
      if (card.kind === 'appointment') {
        return api<{ visitId: string }>('/visits', {
          method: 'POST',
          json: { appointmentId: card.appointmentId },
        });
      }
      return api(`/visits/${card.visitId}/transition`, {
        method: 'POST',
        json: { from: card.column, to },
      });
    },
    // 樂觀更新：卡片立刻移動，失敗再還原
    onMutate: async ({ card, to }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const previous = queryClient.getQueryData<BoardResponse>(BOARD_KEY);
      if (previous) queryClient.setQueryData(BOARD_KEY, moveCard(previous, card.id, to));
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(BOARD_KEY, ctx.previous);
      toast(err instanceof ApiError ? err.message : '操作失敗，請再試一次', 'error');
    },
    onSuccess: (_res, { card, to }) => {
      toast(`${card.patient.name}：${VISIT_STATUS_LABELS[to]}`);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: BOARD_KEY }),
  });

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const cards = useMemo(
    () => (data?.cards ?? []).filter((c) => !doctorId || c.doctor?.id === doctorId),
    [data, doctorId],
  );
  const doctors = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of data?.cards ?? []) if (c.doctor) map.set(c.doctor.id, c.doctor.name);
    return [...map];
  }, [data]);
  const activeCard = cards.find((c) => c.id === activeId) ?? null;

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const card = cards.find((c) => c.id === e.active.id);
    const to = e.over?.id as BoardColumn | undefined;
    if (!card || !to || card.column === to) return;
    if (!canDrop(card, to)) {
      toast(
        card.kind === 'appointment'
          ? '尚未報到的預約只能拖到「已報到」'
          : `無法從「${VISIT_STATUS_LABELS[card.column]}」直接移到「${VISIT_STATUS_LABELS[to]}」`,
        'error',
      );
      return;
    }
    move.mutate({ card, to });
  };

  const advance = (card: BoardCard) => {
    const to =
      card.kind === 'appointment' ? 'CHECKED_IN' : nextVisitStatus(card.column as VisitStatus);
    if (to && to !== 'CANCELLED') move.mutate({ card, to });
  };

  return (
    <>
      <PageHeader
        title="今日看板"
        description={data ? formatLongDay(data.date) : ' '}
        actions={
          <div className="flex items-center gap-3">
            <StreamBadge state={stream} />
            {canUpdate && (
              <Button variant="secondary" onClick={() => setWalkIn(true)}>
                <UserPlus /> 現場掛號
              </Button>
            )}
            <Select
              aria-label="依醫師篩選"
              className="w-36"
              value={doctorId}
              onChange={(e) => setDoctorId(e.target.value)}
            >
              <option value="">全部醫師</option>
              {doctors.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        }
      />

      {error && <Alert className="mb-4">{error.message}</Alert>}
      {data && <Stats data={data} />}

      {isPending ? (
        <div className="flex gap-3">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-72 w-64 shrink-0" />
          ))}
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
            <div className="flex min-w-max gap-3">
              {BOARD_COLUMNS.map((column) => (
                <Column
                  key={column}
                  column={column}
                  cards={cards.filter((c) => c.column === column)}
                  activeCard={activeCard}
                  now={now}
                  canUpdate={canUpdate}
                  onOpen={(c) => c.visitId && setOpenVisitId(c.visitId)}
                  onAdvance={advance}
                  busy={move.isPending}
                />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeCard && <CardBody card={activeCard} now={now} className="rotate-1 shadow-xl" />}
          </DragOverlay>
        </DndContext>
      )}

      <VisitSheet visitId={openVisitId} onClose={() => setOpenVisitId(null)} />
      <WalkInDialog open={walkIn} onClose={() => setWalkIn(false)} />
    </>
  );
}

function StreamBadge({ state }: { state: StreamState }) {
  const label = { live: '即時同步', connecting: '連線中…', offline: '已離線' }[state];
  return (
    <span
      className={cn(
        'hidden items-center gap-1.5 text-xs sm:inline-flex',
        state === 'live' ? 'text-jade-700' : 'text-ink-muted',
      )}
      title="其他裝置的變更會自動出現在這裡"
    >
      <Radio className={cn('size-3.5', state === 'live' && 'animate-pulse')} />
      {label}
    </span>
  );
}

function Stats({ data }: { data: BoardResponse }) {
  const { stats } = data;
  const rate = stats.appointments ? Math.round((stats.arrived / stats.appointments) * 100) : null;
  const items: { label: string; short: string; value: number | string; hint?: string }[] = [
    { label: '今日預約', short: '預約', value: stats.appointments },
    {
      label: '已到診',
      short: '到診',
      value: stats.arrived,
      hint: rate !== null ? `到診率 ${rate}%` : undefined,
    },
    { label: '已完成', short: '完成', value: stats.completed },
    { label: '未到', short: '未到', value: stats.noShow },
    {
      label: '平均等候',
      short: '等候',
      value: stats.avgWaitMinutes !== null ? `${stats.avgWaitMinutes} 分` : '—',
    },
  ];
  return (
    <div className="mb-4 grid grid-cols-5 gap-2 sm:gap-3">
      {items.map((i) => (
        <Card key={i.label} className="px-2.5 py-2 sm:px-4 sm:py-3">
          <p className="text-[11px] text-ink-muted sm:text-xs">
            <span className="sm:hidden">{i.short}</span>
            <span className="hidden sm:inline">{i.label}</span>
          </p>
          <p className="mt-0.5 whitespace-nowrap text-base font-semibold tabular-nums sm:mt-1 sm:text-xl">
            {i.value}
          </p>
          {i.hint && <p className="hidden text-xs text-ink-muted sm:block">{i.hint}</p>}
        </Card>
      ))}
    </div>
  );
}

function Column({
  column,
  cards,
  activeCard,
  now,
  canUpdate,
  onOpen,
  onAdvance,
  busy,
}: {
  column: BoardColumn;
  cards: BoardCard[];
  activeCard: BoardCard | null;
  now: number;
  canUpdate: boolean;
  onOpen: (card: BoardCard) => void;
  onAdvance: (card: BoardCard) => void;
  busy: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const droppable = activeCard ? canDrop(activeCard, column) : false;
  const sorted = useMemo(
    () =>
      [...cards].sort((a, b) =>
        column === 'SCHEDULED' || column === 'COMPLETED'
          ? (a.appointmentAt ?? '').localeCompare(b.appointmentAt ?? '')
          : (a.statusChangedAt ?? '').localeCompare(b.statusChangedAt ?? ''),
      ),
    [cards, column],
  );

  return (
    <section
      ref={setNodeRef}
      aria-label={VISIT_STATUS_LABELS[column]}
      className={cn(
        'flex w-64 shrink-0 flex-col rounded-xl bg-line/40 p-2 transition-colors',
        activeCard && droppable && 'bg-jade-50 ring-2 ring-jade-200',
        activeCard && droppable && isOver && 'bg-jade-100 ring-jade-500',
        activeCard && !droppable && activeCard.column !== column && 'opacity-50',
      )}
    >
      <header className="flex items-center justify-between px-2 py-1.5">
        <h2 className="text-sm font-medium">{VISIT_STATUS_LABELS[column]}</h2>
        <span className="rounded-full bg-surface px-2 text-xs tabular-nums text-ink-muted">
          {cards.length}
        </span>
      </header>
      <div className="mt-1 flex min-h-32 flex-1 flex-col gap-2">
        {sorted.map((card) => (
          <DraggableCard
            key={card.id}
            card={card}
            now={now}
            canUpdate={canUpdate}
            onOpen={onOpen}
            onAdvance={onAdvance}
            busy={busy}
          />
        ))}
        {cards.length === 0 && (
          <div className="flex h-24 items-center justify-center rounded-lg border border-dashed border-line text-xs text-ink-muted">
            {column === 'SCHEDULED' ? '今天的預約會出現在這裡' : '—'}
          </div>
        )}
      </div>
    </section>
  );
}

function DraggableCard({
  card,
  now,
  canUpdate,
  onOpen,
  onAdvance,
  busy,
}: {
  card: BoardCard;
  now: number;
  canUpdate: boolean;
  onOpen: (card: BoardCard) => void;
  onAdvance: (card: BoardCard) => void;
  busy: boolean;
}) {
  const terminal = card.column === 'COMPLETED';
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    disabled: !canUpdate || terminal,
  });
  const next =
    card.kind === 'appointment'
      ? 'CHECKED_IN'
      : terminal
        ? null
        : nextVisitStatus(card.column as VisitStatus);

  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && 'opacity-30')}>
      <CardBody
        card={card}
        now={now}
        onClick={card.visitId ? () => onOpen(card) : undefined}
        action={
          canUpdate && next ? (
            <Button
              size="sm"
              variant="secondary"
              className="h-7 px-2 text-xs"
              disabled={busy}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onAdvance(card);
              }}
            >
              {card.kind === 'appointment' ? (
                <>
                  <UserCheck /> 報到
                </>
              ) : (
                <>
                  {VISIT_STATUS_LABELS[next]} <ArrowRight />
                </>
              )}
            </Button>
          ) : undefined
        }
      />
    </div>
  );
}

function CardBody({
  card,
  now,
  onClick,
  action,
  className,
}: {
  card: BoardCard;
  now: number;
  onClick?: () => void;
  action?: React.ReactNode;
  className?: string;
}) {
  const waiting =
    card.statusChangedAt && (card.column === 'CHECKED_IN' || card.column === 'WAITING')
      ? minutesSince(card.statusChangedAt, now)
      : null;
  const late =
    card.kind === 'appointment' && card.appointmentAt ? minutesSince(card.appointmentAt, now) : 0;

  return (
    <article
      onClick={onClick}
      className={cn(
        'rounded-lg border border-line bg-surface p-3 text-sm shadow-sm',
        onClick && 'cursor-pointer hover:border-jade-200',
        card.column === 'COMPLETED' && 'opacity-70',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{card.patient.name}</p>
          <p className="font-mono text-[11px] text-ink-muted">{card.patient.chartNo}</p>
        </div>
        {card.appointmentAt && (
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              late > 15 ? 'text-danger' : 'text-ink-muted',
            )}
          >
            {formatTime(card.appointmentAt)}
          </span>
        )}
      </div>

      {(card.patient.hasAllergy ||
        card.patient.isFirstVisit ||
        card.patient.tags.includes('VIP')) && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.patient.hasAllergy && (
            <Badge tone="danger">
              <AlertTriangle className="size-3" /> 過敏
            </Badge>
          )}
          {card.patient.isFirstVisit && <Badge tone="ochre">初診</Badge>}
          {card.patient.tags.includes('VIP') && <Badge tone="jade">VIP</Badge>}
        </div>
      )}

      <p className="mt-2 truncate text-xs text-ink-muted">
        {[card.doctor?.name, card.service?.name, card.room?.name].filter(Boolean).join('・')}
      </p>
      {card.package && (
        <p
          className={cn(
            'mt-1 flex items-center gap-1 text-xs',
            card.package.remaining <= 1 ? 'text-ochre-700' : 'text-ink-muted',
          )}
        >
          <Package className="size-3" /> {card.package.name}・剩 {card.package.remaining} 堂
        </p>
      )}
      {card.latestHandoff && (
        <p className="mt-2 flex gap-1 rounded-md bg-ochre-100 px-2 py-1 text-xs text-ochre-700">
          <MessageSquareText className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2">{card.latestHandoff}</span>
        </p>
      )}

      {(waiting !== null || action) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          {waiting !== null ? (
            <span
              className={cn(
                'inline-flex items-center gap-1 text-xs',
                waiting >= 20 ? 'text-danger' : 'text-ink-muted',
              )}
            >
              <Clock className="size-3" /> 等候 {waiting} 分
            </span>
          ) : (
            <span />
          )}
          {action}
        </div>
      )}
    </article>
  );
}
