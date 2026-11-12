/**
 * 小习惯网格排序（任务侧标签已下线）：
 * - 今日已完成的习惯：沉底
 * - 情境内：未完成在前，组内稳定按 id
 * - 情境间：按 contextSortOrder / 标题
 */

export type HabitGridSortableItem = { id: string };

export type HabitGridSortableSection<T extends HabitGridSortableItem> = {
  id: string;
  title: string;
  items: T[];
};

export type SortHabitGridSectionsOptions<T extends HabitGridSortableItem> = {
  /** 已完成 → 沉底 */
  isCompleted?: (item: T) => boolean;
};

export function sortHabitGridSections<T extends HabitGridSortableItem>(
  sections: HabitGridSortableSection<T>[],
  contextSortOrderById?: Map<string, number>,
  opts?: SortHabitGridSectionsOptions<T>,
): HabitGridSortableSection<T>[] {
  const done = (item: T) => Boolean(opts?.isCompleted?.(item));

  const sorted = sections.map((sec) => ({
    ...sec,
    items: [...sec.items].sort((a, b) => {
      const da = done(a);
      const db = done(b);
      if (da !== db) return da ? 1 : -1;
      return a.id.localeCompare(b.id);
    }),
  }));
  sorted.sort((a, b) => {
    const orderA = contextSortOrderById?.get(a.id) ?? 1_000_000;
    const orderB = contextSortOrderById?.get(b.id) ?? 1_000_000;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title, 'zh-CN');
  });
  return sorted;
}

/** @deprecated 使用 sortHabitGridSections */
export const sortHabitGridSectionsByTagWeight = <T extends HabitGridSortableItem>(
  sections: HabitGridSortableSection<T>[],
  _weightByHabitId?: Map<string, number>,
  contextSortOrderById?: Map<string, number>,
  opts?: SortHabitGridSectionsOptions<T>,
): HabitGridSortableSection<T>[] => sortHabitGridSections(sections, contextSortOrderById, opts);
