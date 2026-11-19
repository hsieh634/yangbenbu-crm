import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS, ROLE_PERMISSIONS, hasPermission } from '../src/permissions';
import { ROLES } from '../src/roles';

describe('角色權限對照', () => {
  it('每個角色的權限都存在於權限目錄', () => {
    for (const role of ROLES) {
      for (const p of ROLE_PERMISSIONS[role]) expect(ALL_PERMISSIONS).toContain(p);
    }
  });

  it('只有管理者可以看稽核紀錄與管理員工', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, 'audit:read')).toBe(role === 'ADMIN');
      expect(hasPermission(role, 'staff:manage')).toBe(role === 'ADMIN');
    }
  });

  it('完整身分證字號只開放給管理者、醫師、櫃檯', () => {
    const allowed = ROLES.filter((r) => hasPermission(r, 'patient:read_national_id'));
    expect(allowed.sort()).toEqual(['ADMIN', 'DOCTOR', 'FRONT_DESK']);
  });

  it('醫師欄位只有醫師能寫，管理者也不行', () => {
    const allowed = ROLES.filter((r) => hasPermission(r, 'visit:write_clinical'));
    expect(allowed).toEqual(['DOCTOR']);
  });
});

describe('Phase 1 欄位權限', () => {
  it('病史只有管理者與醫師能編輯，但所有角色都能檢視', () => {
    expect(ROLES.filter((r) => hasPermission(r, 'patient:write_medical')).sort()).toEqual([
      'ADMIN',
      'DOCTOR',
    ]);
    for (const role of ROLES) expect(hasPermission(role, 'patient:read_medical')).toBe(true);
  });

  it('健康管理師看不到地址與緊急聯絡人', () => {
    expect(hasPermission('HEALTH_MANAGER', 'patient:read_contact')).toBe(false);
    expect(hasPermission('FRONT_DESK', 'patient:read_contact')).toBe(true);
  });

  it('櫃檯可以扣堂但看不到醫師欄位', () => {
    expect(hasPermission('FRONT_DESK', 'package:deduct')).toBe(true);
    expect(hasPermission('FRONT_DESK', 'visit:read')).toBe(false);
  });
});
