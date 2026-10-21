import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import { guessRecipeCategoryIconKey } from '@/lib/recipe-category-icons';
import type { RecipeCategory } from '@/lib/recipes';

export type RecipeCategoryMetaStore = {
  version: 1;
  /** 分类 id 顺序；未列出的跟在后面，按名称 */
  order: string[];
  /** categoryId -> icon key */
  icons: Record<string, string>;
};

function emptyStore(): RecipeCategoryMetaStore {
  return { version: 1, order: [], icons: {} };
}

function parseStore(raw: unknown): RecipeCategoryMetaStore {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return emptyStore();
  const o = raw as Record<string, unknown>;
  if (o.version !== 1) return emptyStore();
  const order: string[] = [];
  if (Array.isArray(o.order)) {
    for (const id of o.order) {
      if (typeof id === 'string' && id.trim() && !order.includes(id)) order.push(id);
    }
  }
  const icons: Record<string, string> = {};
  if (o.icons && typeof o.icons === 'object' && !Array.isArray(o.icons)) {
    for (const [id, key] of Object.entries(o.icons as Record<string, unknown>)) {
      if (!id.trim() || typeof key !== 'string' || !key.trim()) continue;
      icons[id] = key.trim().slice(0, 64);
    }
  }
  return { version: 1, order, icons };
}

export async function loadRecipeCategoryMeta(): Promise<RecipeCategoryMetaStore> {
  const raw = await getAppSetting<unknown>(AppSettingKey.recipeCategoryMeta);
  return parseStore(raw);
}

export async function saveRecipeCategoryMeta(store: RecipeCategoryMetaStore): Promise<void> {
  await setAppSetting(AppSettingKey.recipeCategoryMeta, store);
}

/** 按用户顺序排列；未知 id 按名称排在末尾 */
export function sortCategoriesByMeta<T extends { id: string; name: string }>(
  categories: T[],
  meta: RecipeCategoryMetaStore,
): T[] {
  if (categories.length <= 1) return [...categories];
  const rank = new Map(meta.order.map((id, i) => [id, i]));
  return [...categories].sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id)! : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? rank.get(b.id)! : Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.name.localeCompare(b.name, 'zh-CN');
  });
}

export function iconKeyForCategory(
  categoryId: string,
  name: string,
  meta: RecipeCategoryMetaStore,
): string {
  const saved = meta.icons[categoryId]?.trim();
  if (saved) return saved;
  return guessRecipeCategoryIconKey(name);
}

export async function setRecipeCategoryOrder(orderedIds: string[]): Promise<RecipeCategoryMetaStore> {
  const store = await loadRecipeCategoryMeta();
  const next = { ...store, order: orderedIds.filter(Boolean) };
  await saveRecipeCategoryMeta(next);
  return next;
}

export async function setRecipeCategoryIcon(
  categoryId: string,
  iconKey: string,
): Promise<RecipeCategoryMetaStore> {
  const store = await loadRecipeCategoryMeta();
  const next = {
    ...store,
    icons: { ...store.icons, [categoryId]: iconKey.trim().slice(0, 64) },
  };
  await saveRecipeCategoryMeta(next);
  return next;
}

/** 新建分类后写入顺序末尾与图标 */
export async function registerRecipeCategoryMeta(
  category: RecipeCategory,
  iconKey?: string,
): Promise<RecipeCategoryMetaStore> {
  const store = await loadRecipeCategoryMeta();
  const order = store.order.filter(id => id !== category.id);
  order.push(category.id);
  const key = (iconKey?.trim() || guessRecipeCategoryIconKey(category.name)).slice(0, 64);
  const next = {
    ...store,
    order,
    icons: { ...store.icons, [category.id]: key },
  };
  await saveRecipeCategoryMeta(next);
  return next;
}

/** 删除分类后清理元数据 */
export async function forgetRecipeCategoryMeta(categoryId: string): Promise<RecipeCategoryMetaStore> {
  const store = await loadRecipeCategoryMeta();
  const { [categoryId]: _, ...icons } = store.icons;
  const next = {
    ...store,
    order: store.order.filter(id => id !== categoryId),
    icons,
  };
  await saveRecipeCategoryMeta(next);
  return next;
}
