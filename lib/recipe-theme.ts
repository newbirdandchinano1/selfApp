import { PaletteDark, PaletteLight } from '@/constants/design-tokens';

/** 菜谱模块色：跟 App 主色一致，背景/强调略偏暖 */
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

  if (isDark) {
    const t = PaletteDark;
    return {
      bg: t.background,
      text: t.text,
      textSecondary: t.textSecondary,
      outline: 'rgba(148,163,184,0.85)',
      outlineMuted: 'rgba(148,163,184,0.55)',
      primary: t.primary,
      primarySoft: t.primaryMuted,
      // 略暖：用 tertiary 琥珀作章节/标签点缀
      accent: t.tertiary,
      accentSoft: 'rgba(251,191,36,0.14)',
      border: t.outline,
      card: t.surface,
      header: t.headerScrim,
      inputBg: t.input,
      placeholderBg: 'rgba(251,191,36,0.1)',
      danger: t.dangerSoft,
      overlay: t.overlay,
      isDark: true,
    };
  }

  const t = PaletteLight;
  return {
    // 主色同 App；底比 #faf8ff 略暖一丁点（仍偏冷白）
    bg: '#faf8f6',
    text: t.text,
    textSecondary: t.textSecondary,
    outline: '#5c6370',
    outlineMuted: '#8b92a0',
    primary: t.primary,
    primarySoft: t.primaryMuted,
    // tertiary 棕金，只作轻点缀
    accent: t.tertiary,
    accentSoft: 'rgba(130,81,0,0.08)',
    border: 'rgba(0,88,190,0.08)',
    card: t.surface,
    header: 'rgba(250,248,246,0.94)',
    inputBg: t.input,
    placeholderBg: 'rgba(130,81,0,0.06)',
    danger: '#b91c1c',
    overlay: t.overlay,
    isDark: false,
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
