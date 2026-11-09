/**
 * 道路节点「验收」= 任务树：存于 life_road_nodes.extra_data.acceptance_criteria。
 * 年验收可连接季（link_quarter）；季验收可连接月（link_month）；
 * 月验收可嵌套子任务（children，结构对齐项目）；叶子验收后可快速建项目。
 * 不进任务日历 / 积分 / 截止日期。
 */
import { makeTimestampEntityId } from '@/lib/entity-id';
import {
  LifeRoadValidationError,
  monthLabel,
  quarterLabel,
} from '@/lib/life-road/life-road-node-model';

export const LIFE_ROAD_ACCEPTANCE_EXTRA_KEY = 'acceptance_criteria';
export const LIFE_ROAD_ACCEPTANCE_MAX_ITEMS = 40;
export const LIFE_ROAD_ACCEPTANCE_TEXT_MAX = 80;
export const LIFE_ROAD_ACCEPTANCE_MAX_DEPTH = 3;

export type LifeRoadAcceptanceItem = {
  id: string;
  text: string;
  done: boolean;
  /** 年节点验收 → 连接的季 1–4 */
  link_quarter?: 1 | 2 | 3 | 4 | null;
  /** 季节点验收 → 连接的月 1–12 */
  link_month?: number | null;
  /** 子验收（任务拆解，对齐项目子任务） */
  children?: LifeRoadAcceptanceItem[];
};

function unicodeLen(text: string): number {
  return [...text].length;
}

function parseExtraObject(raw: string | null | undefined): Record<string, unknown> {
  if (raw == null || !String(raw).trim()) return {};
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...(parsed as Record<string, unknown>) };
    }
  } catch {
    /* 非 JSON 旧值 */
  }
  return {};
}

function parseLinkQuarter(raw: unknown): 1 | 2 | 3 | 4 | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return null;
}

function parseLinkMonth(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

function normalizeItem(
  raw: unknown,
  depth: number,
): LifeRoadAcceptanceItem | null {
  if (depth > LIFE_ROAD_ACCEPTANCE_MAX_DEPTH) return null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.text ?? '').trim();
  if (!text) return null;
  const idRaw = String(o.id ?? '').trim();
  const id = idRaw || makeTimestampEntityId('lac_', 6);
  const link_quarter = parseLinkQuarter(o.link_quarter);
  const link_month = parseLinkMonth(o.link_month);
  const childrenRaw = Array.isArray(o.children) ? o.children : [];
  const children: LifeRoadAcceptanceItem[] = [];
  for (const child of childrenRaw) {
    const n = normalizeItem(child, depth + 1);
    if (n) children.push(n);
  }
  const item: LifeRoadAcceptanceItem = {
    id: id.slice(0, 36),
    text: text.slice(0, LIFE_ROAD_ACCEPTANCE_TEXT_MAX),
    done: Boolean(o.done),
    children,
  };
  if (link_quarter != null) item.link_quarter = link_quarter;
  if (link_month != null) item.link_month = link_month;
  return item;
}

/** 从 extra_data 读取验收任务树；坏数据静默为空列表 */
export function parseAcceptanceCriteria(
  extraData: string | null | undefined,
): LifeRoadAcceptanceItem[] {
  const obj = parseExtraObject(extraData);
  const list = obj[LIFE_ROAD_ACCEPTANCE_EXTRA_KEY];
  if (!Array.isArray(list)) return [];
  const out: LifeRoadAcceptanceItem[] = [];
  for (const row of list) {
    const item = normalizeItem(row, 1);
    if (item) out.push(item);
  }
  return out;
}

export function createAcceptanceItem(text = ''): LifeRoadAcceptanceItem {
  return {
    id: makeTimestampEntityId('lac_', 6),
    text,
    done: false,
    children: [],
  };
}

export function flattenAcceptanceItems(
  items: LifeRoadAcceptanceItem[],
): LifeRoadAcceptanceItem[] {
  const rows: LifeRoadAcceptanceItem[] = [];
  const walk = (list: LifeRoadAcceptanceItem[]) => {
    for (const n of list) {
      rows.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(items);
  return rows;
}

export function isAcceptanceLeaf(item: LifeRoadAcceptanceItem): boolean {
  return !item.children || item.children.length === 0;
}

/** 在验收树中按 id 查找节点 */
export function findAcceptanceById(
  items: LifeRoadAcceptanceItem[],
  id: string,
): LifeRoadAcceptanceItem | null {
  for (const n of items) {
    if (n.id === id) return n;
    const found = findAcceptanceById(n.children ?? [], id);
    if (found) return found;
  }
  return null;
}

/** 可挂项目的验收叶子（无子项） */
export function listAcceptanceLeaves(
  items: LifeRoadAcceptanceItem[],
): LifeRoadAcceptanceItem[] {
  return flattenAcceptanceItems(items).filter(isAcceptanceLeaf);
}

export function acceptanceDepthOf(
  items: LifeRoadAcceptanceItem[],
  id: string,
  depth = 1,
): number | null {
  for (const n of items) {
    if (n.id === id) return depth;
    const found = acceptanceDepthOf(n.children ?? [], id, depth + 1);
    if (found != null) return found;
  }
  return null;
}

export function updateAcceptanceById(
  items: LifeRoadAcceptanceItem[],
  id: string,
  patch: Partial<
    Pick<LifeRoadAcceptanceItem, 'text' | 'done' | 'link_quarter' | 'link_month'>
  >,
): LifeRoadAcceptanceItem[] {
  return items.map((n) => {
    if (n.id === id) return { ...n, ...patch, children: n.children ?? [] };
    return {
      ...n,
      children: updateAcceptanceById(n.children ?? [], id, patch),
    };
  });
}

export function removeAcceptanceById(
  items: LifeRoadAcceptanceItem[],
  id: string,
): LifeRoadAcceptanceItem[] {
  return items
    .filter((n) => n.id !== id)
    .map((n) => ({
      ...n,
      children: removeAcceptanceById(n.children ?? [], id),
    }));
}

export function addChildAcceptance(
  items: LifeRoadAcceptanceItem[],
  parentId: string | null,
  child: LifeRoadAcceptanceItem,
): LifeRoadAcceptanceItem[] {
  if (!parentId) return [...items, child];
  return items.map((n) => {
    if (n.id === parentId) {
      return { ...n, children: [...(n.children ?? []), child] };
    }
    return {
      ...n,
      children: addChildAcceptance(n.children ?? [], parentId, child),
    };
  });
}

function serializeItem(it: LifeRoadAcceptanceItem): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: it.id,
    text: it.text,
    done: it.done,
  };
  if (it.link_quarter != null) row.link_quarter = it.link_quarter;
  if (it.link_month != null) row.link_month = it.link_month;
  const kids = (it.children ?? [])
    .map(serializeItem)
    .filter((c) => String(c.text ?? '').trim());
  if (kids.length) row.children = kids;
  return row;
}

/** 校验并规范化用户编辑结果（保存前） */
export function normalizeAcceptanceCriteriaInput(
  items: LifeRoadAcceptanceItem[],
): LifeRoadAcceptanceItem[] {
  const cleaned: LifeRoadAcceptanceItem[] = [];
  for (const raw of items) {
    const n = normalizeItem(raw, 1);
    if (n) cleaned.push(n);
  }
  const flat = flattenAcceptanceItems(cleaned);
  if (flat.length > LIFE_ROAD_ACCEPTANCE_MAX_ITEMS) {
    throw new LifeRoadValidationError(
      `验收最多 ${LIFE_ROAD_ACCEPTANCE_MAX_ITEMS} 条（含子任务）`,
    );
  }
  for (const node of flat) {
    if (unicodeLen(node.text) > LIFE_ROAD_ACCEPTANCE_TEXT_MAX) {
      throw new LifeRoadValidationError(
        `验收单条最多 ${LIFE_ROAD_ACCEPTANCE_TEXT_MAX} 字`,
      );
    }
  }
  return cleaned;
}

/**
 * 把验收写回 extra_data JSON 字符串。
 * 空列表时删除该键；若对象已空则返回 null。
 */
export function writeAcceptanceCriteria(
  extraData: string | null | undefined,
  items: LifeRoadAcceptanceItem[],
): string | null {
  const normalized = normalizeAcceptanceCriteriaInput(items);
  const obj = parseExtraObject(extraData);
  // 清理误加的独立月任务键
  delete obj.month_tasks;
  if (normalized.length === 0) {
    delete obj[LIFE_ROAD_ACCEPTANCE_EXTRA_KEY];
  } else {
    obj[LIFE_ROAD_ACCEPTANCE_EXTRA_KEY] = normalized.map(serializeItem);
  }
  if (Object.keys(obj).length === 0) return null;
  return JSON.stringify(obj);
}

export function acceptanceProgress(items: LifeRoadAcceptanceItem[]): {
  done: number;
  total: number;
} {
  const all = flattenAcceptanceItems(items);
  const total = all.length;
  const done = all.filter((i) => i.done).length;
  return { done, total };
}

export function acceptanceMetaLabel(items: LifeRoadAcceptanceItem[]): string | null {
  if (items.length === 0) return null;
  const { done, total } = acceptanceProgress(items);
  return `验收 ${done}/${total}`;
}

/** 导图 / 编辑侧展示：→ Q2 / → 3月 */
export function acceptanceLinkLabel(item: LifeRoadAcceptanceItem): string | null {
  if (item.link_quarter != null) return `→ ${quarterLabel(item.link_quarter)}`;
  if (item.link_month != null) return `→ ${monthLabel(item.link_month)}`;
  return null;
}
