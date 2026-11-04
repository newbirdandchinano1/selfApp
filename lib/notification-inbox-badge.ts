/** 角标展示：0 → 不显示；>99 → `99+`（铃铛等） */
export function formatInboxBadgeCount(n: number): string | undefined {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v <= 0) return undefined;
  if (v > 99) return '99+';
  return String(v);
}

/**
 * 底部业务 Tab 红点：有未读时返回哨兵 `•`（GlassTabBar 画纯圆点，不画数字）。
 */
export const INBOX_TAB_BADGE_DOT = '•';

export function formatInboxBadgeDot(n: number): string | undefined {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  return v > 0 ? INBOX_TAB_BADGE_DOT : undefined;
}
