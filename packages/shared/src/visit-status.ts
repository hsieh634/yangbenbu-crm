/**
 * 就診狀態機。今日看板的欄位 = 「已預約」（尚未報到的預約）+ 就診單狀態。
 *
 * 正常流程只能往前一步，但允許退回前一步（例如誤按），每次轉換都會留下紀錄。
 * 「已完成」與「取消」是終止狀態。
 */
export const VISIT_STATUSES = [
  'CHECKED_IN',
  'WAITING',
  'IN_CONSULTATION',
  'IN_TREATMENT',
  'PENDING_CHECKOUT',
  'COMPLETED',
  'CANCELLED',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** 看板欄位（不含取消） */
export const BOARD_COLUMNS = [
  'SCHEDULED',
  'CHECKED_IN',
  'WAITING',
  'IN_CONSULTATION',
  'IN_TREATMENT',
  'PENDING_CHECKOUT',
  'COMPLETED',
] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const VISIT_STATUS_LABELS: Record<VisitStatus | 'SCHEDULED', string> = {
  SCHEDULED: '已預約',
  CHECKED_IN: '已報到',
  WAITING: '候診',
  IN_CONSULTATION: '看診中',
  IN_TREATMENT: '療程中',
  PENDING_CHECKOUT: '待批價／領藥',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const VISIT_TRANSITIONS: Record<VisitStatus, readonly VisitStatus[]> = {
  CHECKED_IN: ['WAITING', 'IN_CONSULTATION', 'CANCELLED'],
  WAITING: ['IN_CONSULTATION', 'CHECKED_IN', 'CANCELLED'],
  // 沒有療程（只看診、拿藥）可以直接到待批價
  IN_CONSULTATION: ['IN_TREATMENT', 'PENDING_CHECKOUT', 'WAITING'],
  IN_TREATMENT: ['PENDING_CHECKOUT', 'IN_CONSULTATION'],
  PENDING_CHECKOUT: ['COMPLETED', 'IN_TREATMENT', 'IN_CONSULTATION'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: VisitStatus, to: VisitStatus): boolean {
  return VISIT_TRANSITIONS[from].includes(to);
}

/** 正常流程的下一步（看板卡片上的「下一步」按鈕） */
export function nextVisitStatus(from: VisitStatus): VisitStatus | null {
  return VISIT_TRANSITIONS[from][0] ?? null;
}

export const APPOINTMENT_STATUSES = [
  'BOOKED',
  'CONFIRMED',
  'CHECKED_IN',
  'NO_SHOW',
  'CANCELLED',
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABELS: Record<AppointmentStatus, string> = {
  BOOKED: '已預約',
  CONFIRMED: '已確認',
  CHECKED_IN: '已報到',
  NO_SHOW: '未到',
  CANCELLED: '已取消',
};

/** 仍佔用時段的預約狀態 */
export const ACTIVE_APPOINTMENT_STATUSES = ['BOOKED', 'CONFIRMED', 'CHECKED_IN'] as const;
