/** 就診狀態（今日看板的欄位）。Phase 1 實作狀態機，Phase 0 先定義給前端顯示。 */
export const VISIT_STATUSES = [
  'SCHEDULED',
  'CHECKED_IN',
  'WAITING',
  'IN_CONSULTATION',
  'IN_TREATMENT',
  'PENDING_CHECKOUT',
  'COMPLETED',
] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  SCHEDULED: '已預約',
  CHECKED_IN: '已報到',
  WAITING: '候診',
  IN_CONSULTATION: '看診中',
  IN_TREATMENT: '療程中',
  PENDING_CHECKOUT: '待批價／領藥',
  COMPLETED: '已完成',
};
