import { describe, expect, it } from 'vitest';
import { isValidTaiwanId, maskTaiwanId } from '../src/taiwan-id';

describe('isValidTaiwanId', () => {
  it('接受檢查碼正確的身分證字號', () => {
    expect(isValidTaiwanId('A123456789')).toBe(true);
    expect(isValidTaiwanId('a123456789')).toBe(true);
  });

  it('拒絕檢查碼錯誤或格式錯誤', () => {
    expect(isValidTaiwanId('A123456788')).toBe(false);
    expect(isValidTaiwanId('A323456789')).toBe(false);
    expect(isValidTaiwanId('1234567890')).toBe(false);
    expect(isValidTaiwanId('A12345678')).toBe(false);
  });
});

describe('maskTaiwanId', () => {
  it('只保留前 3 碼與末 3 碼', () => {
    expect(maskTaiwanId('A123456789')).toBe('A12****789');
  });
});
