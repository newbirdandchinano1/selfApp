/**
 * 习惯 / 待办 / 项目共用 emoji 图标备选（跨端一致，无需额外字体包）。
 * 习惯存 `habits.icon`；待办与项目存 `extra_data.icon`。
 */

/** 打卡 / 待办 / 项目图标备选 */
export const ENTITY_ICON_CHOICES = [
  '🥛',
  '🏃',
  '🧘',
  '📖',
  '✍️',
  '💧',
  '🍎',
  '🥗',
  '😴',
  '🪥',
  '🚶',
  '🚴',
  '🏋️',
  '⏰',
  '🎯',
  '📝',
  '📅',
  '☀️',
  '🌙',
  '🍵',
  '☕',
  '🧴',
  '💊',
  '🎧',
  '🌿',
  '🧹',
  '💪',
  '🚿',
  '🍽️',
  '🦷',
  '📵',
  '🎵',
  '🧠',
  '❤️',
  '🏊',
  '🤸',
  '🚭',
  '🧊',
  '🛏️',
  '📁',
  '🗂️',
  '🌐',
  '🏠',
  '📦',
  '📞',
  '🧾',
  '🧩',
  '🍳',
] as const;

/** @deprecated 请用 ENTITY_ICON_CHOICES；保留别名以免习惯页旧引用断裂 */
export const HABIT_ICON_CHOICES = ENTITY_ICON_CHOICES;

export const DEFAULT_HABIT_ICON = '🥛';
export const DEFAULT_TODO_ICON = '📝';
export const DEFAULT_PROJECT_ICON = '📁';

const CHOICE_SET = new Set<string>(ENTITY_ICON_CHOICES);

/** 名称以 emoji 开头时沿用（兼容旧项目未存 icon 的数据） */
export function leadingEmojiFromName(name: string | null | undefined): string | null {
  const t = (name ?? '').trim();
  if (!t) return null;
  const first = Array.from(t)[0] ?? '';
  if (first && !/[\u4e00-\u9fffA-Za-z0-9]/.test(first) && first.charCodeAt(0) > 255) {
    return first;
  }
  return null;
}

export function normalizeEntityIcon(
  raw: unknown,
  fallback: string = DEFAULT_TODO_ICON,
): string {
  if (typeof raw !== 'string') return fallback;
  const icon = raw.trim();
  if (!icon) return fallback;
  if (CHOICE_SET.has(icon)) return icon;
  // 允许历史自定义 emoji（非备选表内）仍原样展示
  if (icon.length <= 8 && !/[\u4e00-\u9fffA-Za-z0-9]/.test(icon[0] ?? '')) {
    return icon;
  }
  return fallback;
}

export function parseIconFromExtraData(
  extraData: string | null | undefined,
  fallback: string = DEFAULT_TODO_ICON,
): string {
  if (!extraData) return fallback;
  try {
    const parsed = JSON.parse(extraData) as { icon?: unknown };
    return normalizeEntityIcon(parsed?.icon, fallback);
  } catch {
    return fallback;
  }
}

/** 解析项目展示图标：extra_data.icon → 名称首字 emoji → 默认 */
export function resolveProjectDisplayIcon(
  name: string | null | undefined,
  extraData: string | null | undefined,
): string {
  const fromExtra = parseIconFromExtraData(extraData, '');
  if (fromExtra) return fromExtra;
  return leadingEmojiFromName(name) ?? DEFAULT_PROJECT_ICON;
}

/** 解析待办 / 任务展示图标 */
export function resolveTaskDisplayIcon(extraData: string | null | undefined): string {
  return parseIconFromExtraData(extraData, DEFAULT_TODO_ICON);
}

export function mergeIconIntoExtraData(
  extraData: string | null | undefined,
  icon: string,
  fallback: string = DEFAULT_TODO_ICON,
): string {
  let base: Record<string, unknown> = {};
  if (extraData) {
    try {
      const parsed = JSON.parse(extraData) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        base = { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      base = {};
    }
  }
  base.icon = normalizeEntityIcon(icon, fallback);
  return JSON.stringify(base);
}

export function mergeIconIntoExtraObject(
  extra: Record<string, unknown>,
  icon: string,
  fallback: string = DEFAULT_TODO_ICON,
): Record<string, unknown> {
  return {
    ...extra,
    icon: normalizeEntityIcon(icon, fallback),
  };
}
