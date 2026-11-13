import { hash, verify } from '@node-rs/argon2';

// Argon2id，參數依 OWASP Password Storage Cheat Sheet 建議（m=19 MiB, t=2, p=1）
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * 帳號不存在時也要花同樣的時間驗證，避免從回應時間推測 Email 是否已註冊。
 */
let dummyHash: Promise<string> | undefined;
export async function burnPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('timing-equalizer-not-a-real-password');
  await verifyPassword(await dummyHash, password);
}
