import { HEALTH_HOME_DARK, HEALTH_HOME_LIGHT } from '@/constants/health-home-theme';

/**
 * 菜谱模块色 — 直接消费健康页令牌（奶油纸底 / 松墨绿 / sage）。
 * 菜谱挂在健康域下，不再走旧财务蓝。
 */
export type RecipePalette = {
  bg: string;
  text: string;
  textSecondary: string;
  outline: string;
  outlineMuted: string;
  primary: string;
  primarySoft: string;
  accent: string;
  accentSoft: string;
  border: string;
  card: string;
  header: string;
  inputBg: string;
  placeholderBg: string;
  danger: string;
  overlay: string;
  isDark: boolean;
};

export function getRecipePalette(
  colorScheme: 'light' | 'dark' | null | undefined,
): RecipePalette {
  const isDark = (colorScheme ?? 'light') === 'dark';
  const h = isDark ? HEALTH_HOME_DARK : HEALTH_HOME_LIGHT;

  return {
    bg: h.paper,
    text: h.ink,
    textSecondary: h.inkSoft,
    outline: h.inkSoft,
    outlineMuted: h.muted,
    primary: h.pine,
    // 选中底：sageSoft，比 track 更实，筛选/入篮状态清楚
    primarySoft: h.sageSoft,
    accent: h.sage,
    accentSoft: isDark ? h.sageSoft : 'rgba(127,166,149,0.28)',
    border: h.lineStrong,
    card: h.card,
    header: isDark ? h.paper : 'rgba(245,243,232,0.94)',
    inputBg: h.cardMuted,
    placeholderBg: h.track,
    danger: isDark ? '#ef4444' : '#b91c1c',
    overlay: isDark ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)',
    isDark,
  };
}

export function formatRecipeRelativeTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return d.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
