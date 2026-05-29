import { AppSettingKey, getAppSettingRaw, setAppSetting } from '@/lib/app-settings-store';

export type QuickAddVolumeUnit = 'ml' | 'g' | 'mg';
export type QuickAddMetricType = 'hydration' | 'protein' | 'carbohydrate' | 'sodium';

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
  { key: 'water', label: '水', displayAmount: 250, displayUnit: 'ml', hydrationMl: 250, icon: 'local-drink' },
];

const DEFAULT_HOME_KEYS = ['water'];

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

function parseStoredKeys(raw: string | null, itemMap: Map<string, QuickAddCardItem>): string[] {
  if (!raw) return DEFAULT_HOME_KEYS;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_HOME_KEYS;
  }
  if (!Array.isArray(parsed)) return DEFAULT_HOME_KEYS;
  const keys = parsed.filter((v): v is string => typeof v === 'string');
  const normalized = normalizeKeys(keys, itemMap);
  return normalized.length > 0 ? normalized : DEFAULT_HOME_KEYS;
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
    displayUnitRaw === 'ml' || displayUnitRaw === 'g' || displayUnitRaw === 'mg' ? displayUnitRaw : 'ml';
  const metricTypeRaw = o.metricType;
  const metricType: QuickAddMetricType | undefined =
    metricTypeRaw === 'hydration' || metricTypeRaw === 'protein' || metricTypeRaw === 'carbohydrate' || metricTypeRaw === 'sodium'
      ? metricTypeRaw
      : undefined;
  const metricTypesRaw = o.metricTypes;
  const metricTypes = Array.isArray(metricTypesRaw)
    ? metricTypesRaw.filter(
        (v): v is QuickAddMetricType =>
          v === 'hydration' || v === 'protein' || v === 'carbohydrate' || v === 'sodium'
      )
    : [];
  const metricAmountsRaw = o.metricAmounts;
  const metricAmounts: QuickAddMetricAmounts = {};
  if (metricAmountsRaw && typeof metricAmountsRaw === 'object') {
    const amountRecord = metricAmountsRaw as Record<string, unknown>;
    for (const metric of ['hydration', 'protein', 'carbohydrate', 'sodium'] as const) {
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

export async function loadAllQuickAddItems(): Promise<QuickAddCardItem[]> {
  const custom = await loadCustomQuickAddItems();
  return [...ALL_QUICK_ADD_ITEMS, ...custom];
}

export function formatQuickAddAmount(item: QuickAddCardItem): string {
  if (item.metricTypes && item.metricTypes.length > 1) {
    return `${Math.round(item.displayAmount)}`;
  }
  const unitLabel = item.displayUnit === 'mg' ? 'MG' : item.displayUnit;
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
          v === 'hydration' || v === 'protein' || v === 'carbohydrate' || v === 'sodium'
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
    (displayUnit !== 'ml' && displayUnit !== 'g' && displayUnit !== 'mg') ||
    !Number.isFinite(hydrationMl) ||
    hydrationMl <= 0 ||
    (metricType !== undefined &&
      metricType !== 'hydration' &&
      metricType !== 'protein' &&
      metricType !== 'carbohydrate' &&
      metricType !== 'sodium') ||
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
  return item;
}

export function getQuickAddMetricType(item: Pick<QuickAddCardItem, 'displayUnit' | 'metricType'>): QuickAddMetricType {
  if (item.metricType) return item.metricType;
  if (item.displayUnit === 'g') return 'protein';
  if (item.displayUnit === 'mg') return 'sodium';
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

export async function deleteCustomQuickAddItem(key: string): Promise<void> {
  const customItems = await loadCustomQuickAddItems();
  const nextCustomItems = customItems.filter((item) => item.key !== key);
  if (nextCustomItems.length === customItems.length) return;
  await saveCustomQuickAddItems(nextCustomItems);

  const allItems = [...ALL_QUICK_ADD_ITEMS, ...nextCustomItems];
  const itemMap = createQuickAddItemMap(allItems);
  const stored = await getAppSettingRaw(AppSettingKey.quickAddSelected);
  const normalized = normalizeKeys(parseStoredKeys(stored, itemMap), itemMap);
  await setAppSetting(AppSettingKey.quickAddSelected, normalized);
}
