/** 角标展示：0 → 不显示；>99 → `99+` */
export function formatInboxBadgeCount(n: number): string | undefined {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v <= 0) return undefined;
  if (v > 99) return '99+';
  return String(v);
}
