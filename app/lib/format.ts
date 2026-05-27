/**
 * 格式化 token 数：1234 → "1.2k tok"，123456 → "123k tok"，1234567 → "1.2M tok"。
 * 阈值之下原样显示。
 */
export function fmtTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 tok';
  if (n < 1000) return `${n} tok`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k tok`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k tok`;
  return `${(n / 1_000_000).toFixed(1)}M tok`;
}
