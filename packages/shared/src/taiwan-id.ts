/**
 * 中華民國身分證字號／新式居留證號檢核。
 * 格式：1 碼英文字母 + 1 碼性別（1、2，新式居留證為 8、9）+ 8 碼數字，最後一碼為檢查碼。
 */
const LETTER_CODES: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18, K: 19, L: 20, M: 21,
  N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27, U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};
const WEIGHTS = [1, 9, 8, 7, 6, 5, 4, 3, 2, 1, 1];

export function normalizeTaiwanId(value: string): string {
  return value.trim().toUpperCase();
}

export function isValidTaiwanId(value: string): boolean {
  const id = normalizeTaiwanId(value);
  if (!/^[A-Z][1289]\d{8}$/.test(id)) return false;
  const code = LETTER_CODES[id[0]!]!;
  const digits = [Math.floor(code / 10), code % 10, ...id.slice(1).split('').map(Number)];
  const sum = digits.reduce((acc, d, i) => acc + d * WEIGHTS[i]!, 0);
  return sum % 10 === 0;
}

/** 遮罩成 A12****789 的形式（保留前 3 碼與末 3 碼）。 */
export function maskTaiwanId(value: string): string {
  const id = normalizeTaiwanId(value);
  return `${id.slice(0, 3)}****${id.slice(-3)}`;
}
