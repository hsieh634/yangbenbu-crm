export const GENDER_LABELS = { MALE: '男', FEMALE: '女', OTHER: '其他' } as const;

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  'auth.login': '登入',
  'auth.logout': '登出',
  'auth.switch_clinic': '切換診所',
  'auth.mfa_enabled': '啟用兩步驟驗證',
  'patient.list': '查詢病患列表',
  'patient.read': '檢視病患資料',
  'patient.reveal_national_id': '查看完整身分證字號',
  'access.denied': '越權嘗試',
};
