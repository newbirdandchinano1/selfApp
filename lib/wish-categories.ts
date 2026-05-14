import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@wish_custom_categories_v1';
const DEFAULT_PRIORITY_OVERRIDES_KEY = '@wish_default_category_priorities_v1';
const DEFAULT_NAME_OVERRIDES_KEY = '@wish_default_category_names_v1';
const HIDDEN_DEFAULT_IDS_KEY = '@wish_hidden_default_category_ids_v1';

export type WishCategoryDef = {
  id: string;
  name: string;
  /** 数值越大在列表中越靠前 */
  priority: number;
};

/** 内置类别；可通过隐藏 ID 从列表中移除，但至少应保留一个可见类别（由 UI 约束） */
export const DEFAULT_WISH_CATEGORIES: WishCategoryDef[] = [
  { id: 'default:数码', name: '数码', priority: 60 },
  { id: 'default:家居', name: '家居', priority: 55 },
  { id: 'default:健康', name: '健康', priority: 50 },
  { id: 'default:学习', name: '学习', priority: 45 },
  { id: 'default:体验', name: '体验', priority: 40 },
  { id: 'default:其他', name: '其他', priority: 10 },
];

const BUILTIN_ID_SET = new Set(DEFAULT_WISH_CATEGORIES.map(d => d.id));

function normalizeName(name: string): string {
  return name.trim();
}

/**
 * 合并内置（可带名称、优先级覆盖）、自定义类别，按 priority 降序；同优先级按名称排序。
 * `hiddenDefaultCategoryIds` 中已标记的内置类别不会出现在结果中（用户侧视为已删除）。
 */
export function mergeWishCategories(
  custom: WishCategoryDef[],
  defaultPriorityOverrides: Record<string, number> = {},
  defaultNameOverrides: Record<string, string> = {},
  hiddenDefaultCategoryIds: string[] = [],
): WishCategoryDef[] {
  const hidden = new Set(hiddenDefaultCategoryIds);
  const defaults = DEFAULT_WISH_CATEGORIES.filter(d => !hidden.has(d.id)).map(d => {
    const nameOv = defaultNameOverrides[d.id];
    const displayName =
      nameOv !== undefined && normalizeName(nameOv).length > 0 ? normalizeName(nameOv) : d.name;
    return {
      ...d,
      name: displayName,
      priority: defaultPriorityOverrides[d.id] ?? d.priority,
    };
  });
  const merged = [...defaults, ...custom];
  merged.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name, 'zh-CN'));
  return merged;
}

export function isBuiltinWishCategoryId(id: string): boolean {
  return id.startsWith('default:');
}

export function isCustomWishCategoryId(id: string): boolean {
  return id.startsWith('custom:');
}

function parseStoredList(raw: string | null): WishCategoryDef[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: WishCategoryDef[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = typeof o.id === 'string' && o.id.length > 0 ? o.id : '';
    const name = typeof o.name === 'string' ? normalizeName(o.name) : '';
    const pr = o.priority;
    const priority =
      typeof pr === 'number' && Number.isFinite(pr) ? Math.round(Math.min(9999, Math.max(-9999, pr))) : 50;
    if (!id || !name) continue;
    out.push({ id, name, priority });
  }
  return out;
}

export async function loadCustomWishCategories(): Promise<WishCategoryDef[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return parseStoredList(raw);
}

export async function saveCustomWishCategories(categories: WishCategoryDef[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(categories));
}

export async function loadDefaultPriorityOverrides(): Promise<Record<string, number>> {
  const raw = await AsyncStorage.getItem(DEFAULT_PRIORITY_OVERRIDES_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[k] = Math.round(Math.min(9999, Math.max(-9999, v)));
    }
  }
  return out;
}

export async function saveDefaultPriorityOverrides(overrides: Record<string, number>): Promise<void> {
  await AsyncStorage.setItem(DEFAULT_PRIORITY_OVERRIDES_KEY, JSON.stringify(overrides));
}

export async function loadDefaultNameOverrides(): Promise<Record<string, string>> {
  const raw = await AsyncStorage.getItem(DEFAULT_NAME_OVERRIDES_KEY);
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof v === 'string') {
      const n = normalizeName(v);
      if (n.length > 0) out[k] = n;
    }
  }
  return out;
}

export async function saveDefaultNameOverrides(overrides: Record<string, string>): Promise<void> {
  await AsyncStorage.setItem(DEFAULT_NAME_OVERRIDES_KEY, JSON.stringify(overrides));
}

export async function loadHiddenDefaultCategoryIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(HIDDEN_DEFAULT_IDS_KEY);
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item === 'string' && BUILTIN_ID_SET.has(item)) out.push(item);
  }
  return [...new Set(out)];
}

export async function saveHiddenDefaultCategoryIds(ids: string[]): Promise<void> {
  const unique = [...new Set(ids.filter(id => BUILTIN_ID_SET.has(id)))].sort();
  await AsyncStorage.setItem(HIDDEN_DEFAULT_IDS_KEY, JSON.stringify(unique));
}

export function createCustomCategoryId(): string {
  return `custom:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 9)}`;
}

/** 与内置或其它自定义重名时返回提示文案，否则 null */
export function findDuplicateCategoryName(
  name: string,
  existing: WishCategoryDef[],
  excludeId?: string
): string | null {
  const n = normalizeName(name);
  if (!n) return '请输入类别名称';
  const lower = n.toLowerCase();
  for (const c of existing) {
    if (excludeId && c.id === excludeId) continue;
    if (c.name.trim().toLowerCase() === lower) return '已存在同名类别';
  }
  return null;
}
