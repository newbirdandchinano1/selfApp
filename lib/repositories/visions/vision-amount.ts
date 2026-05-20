/** 进度型 / 目标型数值：统一保留两位小数 */
export const VISION_AMOUNT_DECIMALS = 2;

export function roundVisionAmount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** VISION_AMOUNT_DECIMALS;
  return Math.round(n * factor) / factor;
}

/** 展示用：最多两位小数，去掉末尾无意义的 0 */
export function formatVisionAmount(n: number): string {
  const r = roundVisionAmount(n);
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(VISION_AMOUNT_DECIMALS).replace(/\.?0+$/, '');
}

/** 持久化：非负、四舍五入到两位 */
export function formatVisionAmountStored(n: number): string {
  const r = roundVisionAmount(Math.max(0, n));
  if (Math.abs(r - Math.round(r)) < 1e-9) return String(Math.round(r));
  return r.toFixed(VISION_AMOUNT_DECIMALS);
}

export function parseVisionAmountInput(text: string): number | null {
  const t = text.trim();
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundVisionAmount(n);
}

/** 输入过程中限制为合法的小数格式（最多两位小数） */
export function sanitizeVisionAmountInput(text: string): string {
  const cleaned = text.replace(/[^\d.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot === -1) return cleaned;
  const intPart = cleaned.slice(0, dot);
  const frac = cleaned.slice(dot + 1).replace(/\./g, '').slice(0, VISION_AMOUNT_DECIMALS);
  return `${intPart}.${frac}`;
}
