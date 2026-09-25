import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

export const DIETARY_PRESET_TAGS = [
  '素食',
  '蛋奶素',
  '不喝奶',
  '无麸质',
  '低糖',
  '低脂',
  '清真',
  '不吃猪肉',
  '不吃海鲜',
  '不吃辣',
] as const;

export type DietaryPresetTag = (typeof DIETARY_PRESET_TAGS)[number];

export type DietaryPrefs = {
  tags: string[];
  allergies: string;
  avoidFoods: string;
  notes: string;
};

export const DEFAULT_DIETARY_PREFS: DietaryPrefs = {
  tags: [],
  allergies: '',
  avoidFoods: '',
  notes: '',
};

function clampText(raw: unknown, max = 200): string {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, max);
}

export function normalizeDietaryPrefs(raw: unknown): DietaryPrefs {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...DEFAULT_DIETARY_PREFS };
  }
  const o = raw as Record<string, unknown>;
  const presetSet = new Set<string>(DIETARY_PRESET_TAGS);
  const tags = Array.isArray(o.tags)
    ? o.tags
        .filter((t): t is string => typeof t === 'string')
        .map((t) => t.trim())
        .filter((t) => t.length > 0 && presetSet.has(t))
    : [];
  return {
    tags: [...new Set(tags)],
    allergies: clampText(o.allergies),
    avoidFoods: clampText(o.avoidFoods),
    notes: clampText(o.notes, 300),
  };
}

export function isDietaryPrefsEmpty(prefs: DietaryPrefs): boolean {
  return (
    prefs.tags.length === 0 &&
    !prefs.allergies.trim() &&
    !prefs.avoidFoods.trim() &&
    !prefs.notes.trim()
  );
}

/** 供资料完整度 / 档案摘要展示 */
export function formatDietaryPrefsSummary(prefs: DietaryPrefs): string {
  if (isDietaryPrefsEmpty(prefs)) return '未设置';
  const parts: string[] = [];
  if (prefs.tags.length) parts.push(prefs.tags.slice(0, 3).join('、'));
  if (prefs.allergies.trim()) parts.push(`过敏：${prefs.allergies.trim()}`);
  if (prefs.avoidFoods.trim()) parts.push(`忌口：${prefs.avoidFoods.trim()}`);
  return parts.join(' · ') || '已设置';
}

/** 写入 AI 摄入目标上下文；空则返回 null */
export function formatDietaryPrefsForAi(prefs: DietaryPrefs): string | null {
  if (isDietaryPrefsEmpty(prefs)) return null;
  const lines: string[] = [];
  if (prefs.tags.length) lines.push(`饮食标签：${prefs.tags.join('、')}`);
  if (prefs.allergies.trim()) lines.push(`过敏：${prefs.allergies.trim()}`);
  if (prefs.avoidFoods.trim()) lines.push(`忌口/不吃：${prefs.avoidFoods.trim()}`);
  if (prefs.notes.trim()) lines.push(`补充说明：${prefs.notes.trim()}`);
  return lines.join('；');
}

export async function loadDietaryPrefs(): Promise<DietaryPrefs> {
  const parsed = await getAppSetting<unknown>(AppSettingKey.dietaryPrefs);
  return normalizeDietaryPrefs(parsed);
}

export async function saveDietaryPrefs(next: DietaryPrefs): Promise<DietaryPrefs> {
  const normalized = normalizeDietaryPrefs(next);
  await setAppSetting(AppSettingKey.dietaryPrefs, normalized);
  return normalized;
}
