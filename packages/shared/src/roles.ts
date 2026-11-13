/** 診所內的職務角色。一位員工在每家診所只有一個角色。 */
export const ROLES = [
  'ADMIN',
  'DOCTOR',
  'FRONT_DESK',
  'CLINICAL_ASSISTANT',
  'HEALTH_MANAGER',
] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: '管理者',
  DOCTOR: '醫師',
  FRONT_DESK: '櫃檯',
  CLINICAL_ASSISTANT: '診務人員',
  HEALTH_MANAGER: '健康管理師',
};
