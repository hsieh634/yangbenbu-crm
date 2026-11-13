import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/**
 * 敏感欄位的應用層加密（身分證字號、TOTP 金鑰等）。
 *
 * - 加密：AES-256-GCM，格式 `v1:<base64(iv | authTag | ciphertext)>`。
 *   版本前綴保留金鑰輪替的空間。
 * - 雜湊：HMAC-SHA256，用於精確比對查詢（例如以身分證字號找病患），
 *   與加密使用不同金鑰。
 */
const VERSION = 'v1';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function loadKey(name: 'FIELD_ENCRYPTION_KEY' | 'FIELD_HASH_KEY'): Buffer {
  const raw = process.env[name];
  if (!raw) throw new Error(`環境變數 ${name} 未設定`);
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`${name} 必須是 32 bytes 的 base64 字串`);
  return key;
}

export function encryptField(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', loadKey('FIELD_ENCRYPTION_KEY'), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, tag, ciphertext]).toString('base64')}`;
}

export function decryptField(encrypted: string): string {
  const [version, payload] = encrypted.split(':', 2);
  if (version !== VERSION || !payload) throw new Error('不支援的加密格式');
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv('aes-256-gcm', loadKey('FIELD_ENCRYPTION_KEY'), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function hashField(value: string): string {
  return createHmac('sha256', loadKey('FIELD_HASH_KEY')).update(value).digest('base64url');
}

/** 檢查金鑰是否設定正確，服務啟動時呼叫，避免執行到一半才失敗。 */
export function assertFieldKeys(): void {
  loadKey('FIELD_ENCRYPTION_KEY');
  loadKey('FIELD_HASH_KEY');
}
