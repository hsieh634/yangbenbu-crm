import type { Role } from './roles';

/**
 * 權限目錄。後端以 @RequirePermissions() 檢查，前端用來決定選單與按鈕是否顯示。
 * 對應 docs/02-功能規劃與系統架構.md 第 4 節權限矩陣。
 */
export const PERMISSIONS = {
  'board:read': '檢視今日看板',
  'board:update': '推進看板狀態',
  'patient:read': '檢視病患基本資料',
  'patient:write': '新增與編輯病患',
  'patient:delete': '刪除病患（軟刪除）',
  'patient:read_contact': '檢視地址、Email、緊急聯絡人',
  'patient:read_medical': '檢視病史與過敏',
  'patient:write_medical': '編輯病史與過敏',
  'patient:read_national_id': '檢視完整身分證字號',
  'appointment:read': '檢視預約',
  'appointment:write': '管理預約',
  'visit:read': '檢視就診紀錄',
  'visit:write_clinical': '填寫醫師欄位',
  'visit:write_services': '登記本次服務項目（有療程時自動扣堂）',
  'health:read': '檢視問卷與健康數據',
  'health:write': '管理問卷與健康數據',
  'care_plan:read': '檢視調理方案',
  'care_plan:write': '開立調理方案',
  'care_plan:write_lifestyle': '編輯生活建議',
  'package:read': '檢視療程',
  'package:deduct': '療程扣堂',
  'package:manage': '開立與沖銷療程',
  'medication:read': '檢視領藥紀錄',
  'medication:write': '登記領藥',
  'follow_up:read': '檢視追蹤任務',
  'follow_up:write': '處理追蹤任務',
  'report:read': '檢視報表',
  'staff:manage': '管理員工帳號',
  'settings:manage': '管理診所設定',
  'audit:read': '檢視稽核紀錄',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL_PERMISSIONS.filter((p) => p !== 'visit:write_clinical' && p !== 'care_plan:write'),
  DOCTOR: [
    'board:read',
    'board:update',
    'patient:read',
    'patient:write',
    'patient:read_contact',
    'patient:read_medical',
    'patient:write_medical',
    'patient:read_national_id',
    'appointment:read',
    'visit:read',
    'visit:write_clinical',
    'visit:write_services',
    'health:read',
    'health:write',
    'care_plan:read',
    'care_plan:write',
    'care_plan:write_lifestyle',
    'package:read',
    'medication:read',
    'medication:write',
    'follow_up:read',
    'report:read',
  ],
  FRONT_DESK: [
    'board:read',
    'board:update',
    'patient:read',
    'patient:write',
    'patient:read_contact',
    'patient:read_medical',
    'patient:read_national_id',
    'appointment:read',
    'appointment:write',
    'visit:write_services',
    'package:read',
    'package:deduct',
    'package:manage',
    'medication:read',
    'medication:write',
  ],
  CLINICAL_ASSISTANT: [
    'board:read',
    'board:update',
    'patient:read',
    'patient:read_contact',
    'patient:read_medical',
    'appointment:read',
    'visit:read',
    'visit:write_services',
    'care_plan:read',
    'package:read',
    'package:deduct',
  ],
  HEALTH_MANAGER: [
    'board:read',
    'patient:read',
    'patient:read_medical',
    'appointment:read',
    'visit:read',
    'health:read',
    'health:write',
    'care_plan:read',
    'care_plan:write_lifestyle',
    'package:read',
    'medication:read',
    'follow_up:read',
    'follow_up:write',
    'report:read',
  ],
};

export function permissionsFor(role: Role): Permission[] {
  return [...ROLE_PERMISSIONS[role]];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}
