import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';
import { notifyLocalDataChanged } from '@/lib/sync-pull';

export type QuickAddVolumeUnit = 'ml' | 'g' | 'kcal';
export type QuickAddMetricType = 'hydration' | 'protein' | 'carbohydrate' | 'calories';

export type QuickAddMetricAmounts = Partial<Record<QuickAddMetricType, number>>;

export type QuickAddCardItem = {
  key: string;
  label: string;
  displayAmount: number;
  displayUnit: QuickAddVolumeUnit;
  hydrationMl: number;
  metricType?: QuickAddMetricType;
  metricTypes?: QuickAddMetricType[];
  metricAmounts?: QuickAddMetricAmounts;
  icon: string;
};

export const ALL_QUICK_ADD_ITEMS: QuickAddCardItem[] = [
  {
    key: 'water',
    label: '一杯水',
    displayAmount: 250,
    displayUnit: 'ml',
    hydrationMl: 250,
    metricType: 'hydration',
    metricTypes: ['hydration'],
    metricAmounts: { hydration: 250 },
    icon: 'local-drink',
  },
];

const DEFAULT_HOME_KEYS = ['water'];

/** 首页快捷卡空态「从这三张开始」推荐（对齐 health-screens/16） */
export type QuickAddStarterSuggestion = {
  starterKey: string;
  label: string;
  amountLabel: string;
  icon: string;
  /** 若对应内置卡仍存在，优先启用内置而非新建 */
  builtinKey?: string;
  displayAmount: number;
  displayUnit: QuickAddVolumeUnit;
  hydrationMl: number;
  metricType: QuickAddMetricType;
  metricTypes: QuickAddMetricType[];
  metricAmounts: QuickAddMetricAmounts;
};

export const QUICK_ADD_STARTER_SUGGESTIONS: QuickAddStarterSuggestion[] = [
  {
    starterKey: 'starter_water',
    builtinKey: 'water',
    label: '一杯水',
    amountLabel: '+250 ml',
    icon: 'local-drink',
    displayAmount: 250,
    displayUnit: 'ml',
    hydrationMl: 250,
    metricType: 'hydration',
    metricTypes: ['hydration'],
    metricAmounts: { hydration: 250 },
  },
  {
    starterKey: 'starter_protein',
    label: '蛋白加餐',
    amountLabel: '+20 g',
    icon: 'egg',
    displayAmount: 20,
    displayUnit: 'g',
    hydrationMl: 20,
    metricType: 'protein',
    metricTypes: ['protein'],
    metricAmounts: { protein: 20 },
  },
  {
    starterKey: 'starter_americano',
    label: '冰美式',
    amountLabel: '+300 ml',
    icon: 'local-cafe',
    displayAmount: 300,
    displayUnit: 'ml',
    hydrationMl: 300,
    metricType: 'hydration',
    metricTypes: ['hydration'],
    metricAmounts: { hydration: 300 },
  },
];

async function appendSelectedKey(key: string): Promise<void> {
  const selected = await loadSelectedQuickAddItems();
  if (selected.some((item) => item.key === key)) return;
  await saveSelectedQuickAddKeys([...selected.map((item) => item.key), key]);
}

/** 空态推荐：启用内置或按模板新建，并加入今日快捷栏。不写入摄入。 */
export async function enableQuickAddStarter(starterKey: string): Promise<QuickAddCardItem> {
  const starter = QUICK_ADD_STARTER_SUGGESTIONS.find((item) => item.starterKey === starterKey);
  if (!starter) throw new Error('unknown_starter');

  const allItems = await loadAllQuickAddItems();
  const itemMap = createQuickAddItemMap(allItems);

  if (starter.builtinKey && itemMap.has(starter.builtinKey)) {
    const builtin = itemMap.get(starter.builtinKey)!;
    await appendSelectedKey(builtin.key);
    return builtin;
  }

  const byLabel = allItems.find((item) => item.label.trim() === starter.label);
  if (byLabel) {
    await appendSelectedKey(byLabel.key);
    return byLabel;
  }

  const created = await addCustomQuickAddItem({
    label: starter.label,
    displayAmount: starter.displayAmount,
    displayUnit: starter.displayUnit,
    hydrationMl: starter.hydrationMl,
    metricType: starter.metricType,
    metricTypes: starter.metricTypes,
    metricAmounts: starter.metricAmounts,
    icon: starter.icon,
  });
  await appendSelectedKey(created.key);
  return created;
}

export function createQuickAddItemMap(items: QuickAddCardItem[]) {
  return new Map(items.map((item) => [item.key, item]));
}

function normalizeKeys(keys: string[], itemMap: Map<string, QuickAddCardItem>): string[] {
  const uniqueValidKeys: string[] = [];
  for (const key of keys) {
    if (!itemMap.has(key)) continue;
    if (uniqueValidKeys.includes(key)) continue;
    uniqueValidKeys.push(key);
  }
  return uniqueValidKeys;
}

function defaultKeysForCatalog(itemMap: Map<string, QuickAddCardItem>): string[] {
  return normalizeKeys(DEFAULT_HOME_KEYS, itemMap);
}

/** 未写入过设置时用默认；显式空数组 `[]` 表示用户清空，允许空栏。 */
function parseStoredKeys(raw: string | null, itemMap: Map<string, QuickAddCardItem>): string[] {
  if (raw == null) return defaultKeysForCatalog(itemMap);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return defaultKeysForCatalog(itemMap);
  }
  if (!Array.isArray(parsed)) return defaultKeysForCatalog(itemMap);
  const keys = parsed.filter((v): v is string => typeof v === 'string');
  return normalizeKeys(keys, itemMap);
}

function keysToItems(keys: string[], itemMap: Map<string, QuickAddCardItem>): QuickAddCardItem[] {
  return keys
    .map((key) => itemMap.get(key))
    .filter((item): item is QuickAddCardItem => Boolean(item));
}

function sanitizeMetricAmount(value: unknown): number | undefined {
  if (typeof value !== 'number') return undefined;
  const amount = Math.round(value);
  return Number.isFinite(amount) && amount > 0 ? amount : undefined;
}

function sanitizeCustomItem(raw: unknown): QuickAddCardItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const key = typeof o.key === 'string' ? o.key.trim() : '';
  const label = typeof o.label === 'string' ? o.label.trim() : '';
  const icon = typeof o.icon === 'string' ? o.icon.trim() : '';
  const hydrationMl = typeof o.hydrationMl === 'number' ? Math.round(o.hydrationMl) : Number.NaN;
  const displayAmountRaw = typeof o.displayAmount === 'number' ? Math.round(o.displayAmount) : Math.round(hydrationMl);
  const displayUnitRaw = o.displayUnit;
  const displayUnit: QuickAddVolumeUnit =
    displayUnitRaw === 'ml' || displayUnitRaw === 'g' || displayUnitRaw === 'kcal' ? displayUnitRaw : 'ml';
  const metricTypeRaw = o.metricType;
  const metricType: QuickAddMetricType | undefined =
    metricTypeRaw === 'hydration' || metricTypeRaw === 'protein' || metricTypeRaw === 'carbohydrate' || metricTypeRaw === 'calories'
      ? metricTypeRaw
      : undefined;
  const metricTypesRaw = o.metricTypes;
  const metricTypes = Array.isArray(metricTypesRaw)
    ? metricTypesRaw.filter(
        (v): v is QuickAddMetricType =>
          v === 'hydration' || v === 'protein' || v === 'carbohydrate' || v === 'calories'
      )
    : [];
  const metricAmountsRaw = o.metricAmounts;
  const metricAmounts: QuickAddMetricAmounts = {};
  if (metricAmountsRaw && typeof metricAmountsRaw === 'object') {
    const amountRecord = metricAmountsRaw as Record<string, unknown>;
    for (const metric of ['hydration', 'protein', 'carbohydrate', 'calories'] as const) {
      const amount = sanitizeMetricAmount(amountRecord[metric]);
      if (amount !== undefined) metricAmounts[metric] = amount;
    }
  }
  const normalizedMetricTypes = Array.from(new Set(metricTypes));
  const finalMetricTypes = normalizedMetricTypes.length > 0 ? normalizedMetricTypes : metricType ? [metricType] : [];
  if (!key || !label || !icon || !Number.isFinite(hydrationMl) || hydrationMl <= 0) return null;
  if (!Number.isFinite(displayAmountRaw) || displayAmountRaw <= 0) return null;
  return {
    key,
    label,
    icon,
    hydrationMl,
    displayAmount: displayAmountRaw,
    displayUnit,
    metricType,
    metricTypes: finalMetricTypes.length > 0 ? finalMetricTypes : undefined,
    metricAmounts: Object.keys(metricAmounts).length > 0 ? metricAmounts : undefined,
  };
}

async function loadHiddenBuiltInKeys(): Promise<string[]> {
  const stored = await getAppSettingRaw(AppSettingKey.quickAddHiddenBuiltIn);
  if (!stored) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const builtin = new Set(ALL_QUICK_ADD_ITEMS.map((item) => item.key));
  const keys: string[] = [];
  for (const value of parsed) {
    if (typeof value !== 'string') continue;
    const key = value.trim();
    if (!key || !builtin.has(key) || keys.includes(key)) continue;
    keys.push(key);
  }
  return keys;
}

async function saveHiddenBuiltInKeys(keys: string[]): Promise<void> {
  await setAppSetting(AppSettingKey.quickAddHiddenBuiltIn, keys);
}

export async function loadCustomQuickAddItems(): Promise<QuickAddCardItem[]> {
  const stored = await getAppSettingRaw(AppSettingKey.quickAddCustomItems);
  if (!stored) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const dedup = new Map<string, QuickAddCardItem>();
  for (const item of parsed) {
    const valid = sanitizeCustomItem(item);
    if (!valid) continue;
    dedup.set(valid.key, valid);
  }
  return Array.from(dedup.values());
}

async function saveCustomQuickAddItems(items: QuickAddCardItem[]): Promise<void> {
  await setAppSetting(AppSettingKey.quickAddCustomItems, items);
}

function notifyQuickAddUiChanged(): void {
  notifyLocalDataChanged(['app_settings']);
}

export async function loadAllQuickAddItems(): Promise<QuickAddCardItem[]> {
  const [custom, hidden] = await Promise.all([loadCustomQuickAddItems(), loadHiddenBuiltInKeys()]);
  const hiddenSet = new Set(hidden);
  const builtIn = ALL_QUICK_ADD_ITEMS.filter((item) => !hiddenSet.has(item.key));
  return [...builtIn, ...custom];
}

export function formatQuickAddAmount(item: QuickAddCardItem): string {
  if (item.metricTypes && item.metricTypes.length > 1) {
    return `${Math.round(item.displayAmount)}`;
  }
  const unitLabel = item.displayUnit === 'kcal' ? 'KCAL' : item.displayUnit;
  return `${Math.round(item.displayAmount)}${unitLabel}`;
}

export function getDefaultQuickAddItems(): QuickAddCardItem[] {
  return keysToItems(DEFAULT_HOME_KEYS, createQuickAddItemMap(ALL_QUICK_ADD_ITEMS));
}

export async function loadSelectedQuickAddItems(): Promise<QuickAddCardItem[]> {
  const allItems = await loadAllQuickAddItems();
  const itemMap = createQuickAddItemMap(allItems);
  const stored = await getAppSettingRaw(AppSettingKey.quickAddSelected);
  return keysToItems(parseStoredKeys(stored, itemMap), itemMap);
}

export async function saveSelectedQuickAddKeys(keys: string[]): Promise<void> {
  const allItems = await loadAllQuickAddItems();
  const itemMap = createQuickAddItemMap(allItems);
  const normalized = normalizeKeys(keys, itemMap);
  await setAppSetting(AppSettingKey.quickAddSelected, normalized);
  notifyQuickAddUiChanged();
}

export async function addCustomQuickAddItem(input: {
  label: string;
  displayAmount: number;
  displayUnit: QuickAddVolumeUnit;
  hydrationMl: number;
  metricType?: QuickAddMetricType;
  metricTypes?: QuickAddMetricType[];
  metricAmounts?: QuickAddMetricAmounts;
  icon: string;
}): Promise<QuickAddCardItem> {
  const label = input.label.trim();
  const displayAmount = Math.round(input.displayAmount);
  const displayUnit = input.displayUnit;
  const hydrationMl = Math.round(input.hydrationMl);
  const metricType = input.metricType;
  const metricTypes = Array.isArray(input.metricTypes)
    ? Array.from(new Set(input.metricTypes)).filter(
        (v): v is QuickAddMetricType =>
          v === 'hydration' || v === 'protein' || v === 'carbohydrate' || v === 'calories'
      )
    : [];
  const metricAmounts: QuickAddMetricAmounts = {};
  if (input.metricAmounts) {
    for (const metric of metricTypes) {
      const amount = sanitizeMetricAmount(input.metricAmounts[metric]);
      if (amount !== undefined) metricAmounts[metric] = amount;
    }
  }
  const icon = input.icon;
  if (
    !label ||
    !Number.isFinite(displayAmount) ||
    displayAmount <= 0 ||
    (displayUnit !== 'ml' && displayUnit !== 'g' && displayUnit !== 'kcal') ||
    !Number.isFinite(hydrationMl) ||
    hydrationMl <= 0 ||
    (metricType !== undefined &&
      metricType !== 'hydration' &&
      metricType !== 'protein' &&
      metricType !== 'carbohydrate' &&
      metricType !== 'calories') ||
    !icon ||
    metricTypes.length === 0 ||
    metricTypes.some((metric) => metricAmounts[metric] === undefined)
  ) {
    throw new Error('invalid_item');
  }
  const key = `custom_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const item: QuickAddCardItem = {
    key,
    label,
    displayAmount,
    displayUnit,
    hydrationMl,
    metricType: metricType ?? metricTypes[0],
    metricTypes,
    metricAmounts,
    icon,
  };
  const customItems = await loadCustomQuickAddItems();
  await saveCustomQuickAddItems([...customItems, item]);
  notifyQuickAddUiChanged();
  return item;
}

export function getQuickAddMetricType(item: Pick<QuickAddCardItem, 'displayUnit' | 'metricType'>): QuickAddMetricType {
  if (item.metricType) return item.metricType;
  if (item.displayUnit === 'g') return 'protein';
  if (item.displayUnit === 'kcal') return 'calories';
  return 'hydration';
}

export function getQuickAddMetricTypes(
  item: Pick<QuickAddCardItem, 'displayUnit' | 'metricType' | 'metricTypes'>
): QuickAddMetricType[] {
  if (item.metricTypes && item.metricTypes.length > 0) return item.metricTypes;
  return [getQuickAddMetricType(item)];
}

export function getQuickAddMetricAmount(item: QuickAddCardItem, metric: QuickAddMetricType): number {
  const amount = item.metricAmounts?.[metric];
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 ? amount : item.hydrationMl;
}

export function isBuiltInQuickAddItem(key: string): boolean {
  return ALL_QUICK_ADD_ITEMS.some((item) => item.key === key);
}

async function removeKeyFromSelected(key: string): Promise<void> {
  const allItems = await loadAllQuickAddItems();
  const itemMap = createQuickAddItemMap(allItems);
  const stored = await getAppSettingRaw(AppSettingKey.quickAddSelected);
  const nextKeys = parseStoredKeys(stored, itemMap).filter((k) => k !== key);
  await setAppSetting(AppSettingKey.quickAddSelected, normalizeKeys(nextKeys, itemMap));
}

/** 删除快捷卡片（自定义从目录移除；内置记入隐藏列表）。后端无额外限制。 */
export async function deleteQuickAddItem(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) return;

  if (isBuiltInQuickAddItem(trimmed)) {
    const hidden = await loadHiddenBuiltInKeys();
    if (!hidden.includes(trimmed)) {
      await saveHiddenBuiltInKeys([...hidden, trimmed]);
    }
  } else {
    const customItems = await loadCustomQuickAddItems();
    const nextCustomItems = customItems.filter((item) => item.key !== trimmed);
    if (nextCustomItems.length === customItems.length) return;
    await saveCustomQuickAddItems(nextCustomItems);
  }

  await removeKeyFromSelected(trimmed);
  notifyQuickAddUiChanged();
}

/** @deprecated 使用 deleteQuickAddItem；保留别名避免旧引用报错 */
export async function deleteCustomQuickAddItem(key: string): Promise<void> {
  await deleteQuickAddItem(key);
}

export type FrequentQuickAddCandidate = {
  label: string;
  count: number;
  hydration: number;
  protein: number;
  carbohydrate: number;
  calories: number;
};

/**
 * 从最近记录中挑出「标题出现 ≥ minCount 次」的候选，均值作为快捷卡增量。
 * 跳过已有同名卡片；不含纯快捷卡写入（无标题）。
 */
export function collectFrequentQuickAddCandidates(
  records: Array<{
    intake_display_title?: string | null;
    quick_add_key?: string | null;
    hydration: number;
    protein: number;
    carbohydrate: number;
    calories: number;
  }>,
  existingLabels: Set<string>,
  minCount = 3,
): FrequentQuickAddCandidate[] {
  type Acc = {
    count: number;
    hydration: number;
    protein: number;
    carbohydrate: number;
    calories: number;
  };
  const byLabel = new Map<string, Acc>();

  for (const row of records) {
    const label = String(row.intake_display_title ?? '').trim();
    if (!label) continue;
    if (existingLabels.has(label)) continue;
    const prev = byLabel.get(label) ?? {
      count: 0,
      hydration: 0,
      protein: 0,
      carbohydrate: 0,
      calories: 0,
    };
    prev.count += 1;
    prev.hydration += Math.max(0, Number(row.hydration) || 0);
    prev.protein += Math.max(0, Number(row.protein) || 0);
    prev.carbohydrate += Math.max(0, Number(row.carbohydrate) || 0);
    prev.calories += Math.max(0, Number(row.calories) || 0);
    byLabel.set(label, prev);
  }

  const out: FrequentQuickAddCandidate[] = [];
  for (const [label, acc] of byLabel) {
    if (acc.count < minCount) continue;
    const avg = (n: number) => Math.max(0, Math.round(n / acc.count));
    const hydration = avg(acc.hydration);
    const protein = avg(acc.protein);
    const carbohydrate = avg(acc.carbohydrate);
    const calories = avg(acc.calories);
    if (hydration + protein + carbohydrate + calories <= 0) continue;
    out.push({ label, count: acc.count, hydration, protein, carbohydrate, calories });
  }

  return out.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh'));
}

function pickIconForFrequent(candidate: FrequentQuickAddCandidate): string {
  if (candidate.hydration > 0 && candidate.protein + candidate.carbohydrate + candidate.calories === 0) {
    return 'local-drink';
  }
  if (candidate.protein >= candidate.carbohydrate && candidate.protein >= candidate.calories) {
    return 'egg';
  }
  if (candidate.carbohydrate >= candidate.protein && candidate.carbohydrate >= candidate.calories) {
    return 'eco';
  }
  if (candidate.calories > 0) return 'restaurant';
  return 'lunch-dining';
}

/** 把常用候选写成自定义快捷卡，并追加到首页选中列表末尾。 */
export async function createQuickAddItemsFromFrequent(
  candidates: FrequentQuickAddCandidate[],
): Promise<QuickAddCardItem[]> {
  const created: QuickAddCardItem[] = [];
  for (const candidate of candidates) {
    const metricAmounts: QuickAddMetricAmounts = {};
    const metricTypes: QuickAddMetricType[] = [];
    if (candidate.hydration > 0) {
      metricTypes.push('hydration');
      metricAmounts.hydration = candidate.hydration;
    }
    if (candidate.protein > 0) {
      metricTypes.push('protein');
      metricAmounts.protein = candidate.protein;
    }
    if (candidate.carbohydrate > 0) {
      metricTypes.push('carbohydrate');
      metricAmounts.carbohydrate = candidate.carbohydrate;
    }
    if (candidate.calories > 0) {
      metricTypes.push('calories');
      metricAmounts.calories = candidate.calories;
    }
    if (metricTypes.length === 0) continue;

    const primary = metricTypes[0]!;
    const displayAmount = metricAmounts[primary] ?? 1;
    const displayUnit: QuickAddVolumeUnit =
      primary === 'hydration' ? 'ml' : primary === 'calories' ? 'kcal' : 'g';
    const hydrationMl = Math.max(1, metricAmounts.hydration ?? displayAmount);

    try {
      const item = await addCustomQuickAddItem({
        label: candidate.label.slice(0, 24),
        displayAmount,
        displayUnit,
        hydrationMl,
        metricType: primary,
        metricTypes,
        metricAmounts,
        icon: pickIconForFrequent(candidate),
      });
      created.push(item);
    } catch {
      // skip invalid candidate
    }
  }

  if (created.length > 0) {
    const selected = await loadSelectedQuickAddItems();
    const nextKeys = [...selected.map((item) => item.key), ...created.map((item) => item.key)];
    await saveSelectedQuickAddKeys(nextKeys);
  }

  return created;
}

export function formatQuickAddMetricSummary(item: QuickAddCardItem): string {
  const parts = getQuickAddMetricTypes(item).map((metric) => {
    const amount = Math.round(getQuickAddMetricAmount(item, metric));
    if (metric === 'hydration') return `水分 +${amount} ml`;
    if (metric === 'protein') return `蛋白 +${amount}g`;
    if (metric === 'carbohydrate') return `碳水 +${amount}g`;
    return `热量 +${amount} kcal`;
  });
  return parts.join(' · ');
}

export function formatQuickAddPreviewMetric(item: QuickAddCardItem): string {
  const metrics = getQuickAddMetricTypes(item);
  const primary = metrics[0] ?? 'hydration';
  const amount = Math.round(getQuickAddMetricAmount(item, primary));
  if (primary === 'hydration') return `${amount} ml`;
  if (primary === 'calories') return `${amount} kcal`;
  return `${amount} g`;
}
