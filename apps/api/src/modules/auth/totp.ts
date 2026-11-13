import { authenticator } from 'otplib';

authenticator.options = { step: 30, window: 1, digits: 6 };

export const TOTP_ISSUER = '養本簿 CRM';

export function generateTotpSecret(): string {
  return authenticator.generateSecret(20);
}

export function totpUri(email: string, secret: string): string {
  return authenticator.keyuri(email, TOTP_ISSUER, secret);
}

/**
 * 驗證 TOTP，回傳通過的時間區段編號（用於防止重放）；不通過回傳 null。
 * window=1 允許前後各 30 秒的時間誤差。
 */
export function verifyTotp(secret: string, code: string, now = Date.now()): number | null {
  const delta = authenticator.checkDelta(code, secret);
  if (delta === null) return null;
  return Math.floor(now / 1000 / 30) + delta;
}
