import AsyncStorage from '@react-native-async-storage/async-storage';

const SELECTED_STORAGE_KEY = '@quick_add_cards_v1';
const CUSTOM_ITEMS_STORAGE_KEY = '@quick_add_custom_items_v1';
const MAX_HOME_ITEMS = 3;

export type QuickAddVolumeUnit = 'ml' | 'g' | 'mg';
export type QuickAddMetricType = 'hydration' | 'protein' | 'carbohydrate' | 'sodium';

export type QuickAddCardItem = {
  key: string;
  label: string;
  displayAmount: number;
  displayUnit: QuickAddVolumeUnit;
  hydrationMl: number;
  metricType?: QuickAddMetricType;
  metricTypes?: QuickAddMetricType[];
  icon: string;
};

export const ALL_QUICK_ADD_ITEMS: QuickAddCardItem[] = [
  { key: 'water', label: '水', displayAmount: 250, displayUnit: 'ml', hydrationMl: 250, icon: 'local-drink' },
  { key: 'coffee', label: '咖啡', displayAmount: 150, displayUnit: 'ml', hydrationMl: 150, icon: 'local-cafe' },
  { key: 'milk', label: '牛奶', displayAmount: 200, displayUnit: 'ml', hydrationMl: 200, icon: 'emoji-food-beverage' },
  { key: 'black-tea', label: '红茶', displayAmount: 200, displayUnit: 'ml', hydrationMl: 200, icon: 'emoji-food-beverage' },
  { key: 'juice', label: '果汁', displayAmount: 300, displayUnit: 'ml', hydrationMl: 300, icon: 'local-drink' },
  { key: 'green-tea', label: '绿茶', displayAmount: 250, displayUnit: 'ml', hydrationMl: 250, icon: 'spa' },
];

const DEFAULT_HOME_KEYS = ['water', 'coffee', 'milk'];

export function createQuickAddItemMap(items: QuickAddCardItem[]) {
  return new Map(items.map((item) => [item.key, item]));
}

function normalizeKeys(keys: string[], itemMap: Map<string, QuickAddCardItem>): string[] {
  const uniqueValidKeys: string[] = [];
  for (const key of keys) {
    if (!itemMap.has(key)) continue;
    if (uniqueValidKeys.includes(key)) continue;
    uniqueValidKeys.push(key);
    if (uniqueValidKeys.length >= MAX_HOME_ITEMS) break;
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
    metricTypes: metricTypes.length > 0 ? Array.from(new Set(metricTypes)) : undefined,
  };
}

export async function loadCustomQuickAddItems(): Promise<QuickAddCardItem[]> {
  const stored = await AsyncStorage.getItem(CUSTOM_ITEMS_STORAGE_KEY);
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
  await AsyncStorage.setItem(CUSTOM_ITEMS_STORAGE_KEY, JSON.stringify(items));
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
  const stored = await AsyncStorage.getItem(SELECTED_STORAGE_KEY);
  return keysToItems(parseStoredKeys(stored, itemMap), itemMap);
}

export async function saveSelectedQuickAddKeys(keys: string[]): Promise<void> {
  const allItems = await loadAllQuickAddItems();
  const itemMap = createQuickAddItemMap(allItems);
  const normalized = normalizeKeys(keys, itemMap);
  await AsyncStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(normalized));
}

export async function addCustomQuickAddItem(input: {
  label: string;
  displayAmount: number;
  displayUnit: QuickAddVolumeUnit;
  hydrationMl: number;
  metricType?: QuickAddMetricType;
  metricTypes?: QuickAddMetricType[];
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
    metricTypes.length === 0
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
  const stored = await AsyncStorage.getItem(SELECTED_STORAGE_KEY);
  const normalized = normalizeKeys(parseStoredKeys(stored, itemMap), itemMap);
  await AsyncStorage.setItem(SELECTED_STORAGE_KEY, JSON.stringify(normalized));
}
