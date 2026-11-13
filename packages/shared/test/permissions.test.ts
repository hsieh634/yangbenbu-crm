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
