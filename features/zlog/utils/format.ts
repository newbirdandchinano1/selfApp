/** 数字缩写：1024 → 1k，1250000 → 1.3m */
export function fmtCount(n?: number): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.0', '')}m`;
  if (v >= 1000) return `${(v / 1000).toFixed(1).replace('.0', '')}k`;
  return String(v);
}

/** 简短相对时间 */
export function formatTime(input?: string): string {
  if (!input) return '';
  const normalized = input.replace('T', ' ');
  const m = normalized.match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2}:\d{2})?/);
  if (!m) return input;
  const [, y, mo, d, hm] = m;
  const now = new Date();
  const sameYear = Number(y) === now.getFullYear();
  const today =
    Number(d) === now.getDate() &&
    Number(mo) === now.getMonth() + 1 &&
    sameYear;
  if (today && hm) return `今天 ${hm}`;
  return sameYear ? `${mo}-${d}${hm ? ' ' + hm : ''}` : `${y}-${mo}-${d}`;
}

