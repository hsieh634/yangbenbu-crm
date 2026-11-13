import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { decryptField, encryptField, hashField } from '../src/field-crypto';

beforeAll(() => {
  process.env.FIELD_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.FIELD_HASH_KEY = randomBytes(32).toString('base64');
});

describe('欄位加密', () => {
  it('加密後可以解回原文', () => {
    const enc = encryptField('A123456789');
    expect(enc).toMatch(/^v1:/);
    expect(enc).not.toContain('A123456789');
    expect(decryptField(enc)).toBe('A123456789');
  });

  it('相同明文每次加密結果不同（隨機 IV）', () => {
    expect(encryptField('A123456789')).not.toBe(encryptField('A123456789'));
  });

  it('密文被竄改時解密失敗', () => {
    const enc = encryptField('A123456789');
    const buf = Buffer.from(enc.slice(3), 'base64');
    buf[buf.length - 1]! ^= 0xff;
    expect(() => decryptField(`v1:${buf.toString('base64')}`)).toThrow();
  });

  it('雜湊值固定，可用於比對查詢', () => {
    expect(hashField('A123456789')).toBe(hashField('A123456789'));
    expect(hashField('A123456789')).not.toBe(hashField('B123456789'));
  });
});
