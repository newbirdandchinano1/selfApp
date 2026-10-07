/**
 * 小习惯网格排序（对齐项目/独立待办的标签权重语义）：
 * - 习惯权重 = 已贴标签的最大 weight（无标签=0）
 * - 今日已完成的习惯：沉底，不参与权重比较，也不计入情境总权重
 * - 情境内未完成：权重降序
 * - 情境间：未完成习惯的权重总和降序；并列再按 contextSortOrder / 标题
 */

export type HabitGridSortableItem = { id: string };

export type HabitGridSortableSection<T extends HabitGridSortableItem> = {
  id: string;
  title: string;
  items: T[];
};

export type SortHabitGridSectionsOptions<T extends HabitGridSortableItem> = {
  /** 已完成 → 沉底且权重视为 0（不计入情境总和） */
  isCompleted?: (item: T) => boolean;
};

export function maxTagWeight(tags: { weight?: number | null }[] | undefined): number {
  if (!tags?.length) return 0;
  let max = 0;
  for (const tag of tags) {
    const w = typeof tag.weight === 'number' && Number.isFinite(tag.weight) ? tag.weight : 0;
    if (w > max) max = w;
  }
  return max;
}

export function buildHabitTagWeightMap(
  tagsByHabitId: Map<string, { weight?: number | null }[]>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, tags] of tagsByHabitId) {
    out.set(id, maxTagWeight(tags));
  }
  return out;
}

function weightOf(weightByHabitId: Map<string, number> | undefined, habitId: string): number {
  const w = weightByHabitId?.get(habitId);
  return typeof w === 'number' && Number.isFinite(w) ? w : 0;
}

export function sortHabitGridSectionsByTagWeight<T extends HabitGridSortableItem>(
  sections: HabitGridSortableSection<T>[],
  weightByHabitId?: Map<string, number>,
  contextSortOrderById?: Map<string, number>,
  opts?: SortHabitGridSectionsOptions<T>,
): HabitGridSortableSection<T>[] {
  const w = (id: string) => weightOf(weightByHabitId, id);
  const done = (item: T) => Boolean(opts?.isCompleted?.(item));
  /** 仅未完成习惯贡献权重 */
  const activeWeight = (item: T) => (done(item) ? 0 : w(item.id));

  const sorted = sections.map((sec) => ({
    ...sec,
    items: [...sec.items].sort((a, b) => {
      const da = done(a);
      const db = done(b);
      if (da !== db) return da ? 1 : -1;
      // 已完成组内不再按权重排，仅稳定次序
      if (da && db) return a.id.localeCompare(b.id);
      const diff = w(b.id) - w(a.id);
      if (diff !== 0) return diff;
      return a.id.localeCompare(b.id);
    }),
  }));
  sorted.sort((a, b) => {
    const sumA = a.items.reduce((s, it) => s + activeWeight(it), 0);
    const sumB = b.items.reduce((s, it) => s + activeWeight(it), 0);
    if (sumA !== sumB) return sumB - sumA;
    const orderA = contextSortOrderById?.get(a.id) ?? 1_000_000;
    const orderB = contextSortOrderById?.get(b.id) ?? 1_000_000;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title, 'zh-CN');
  });
  return sorted;
}
