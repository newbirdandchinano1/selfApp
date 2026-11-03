/**
 * 道路节点「验收标准」：存于 life_road_nodes.extra_data.acceptance_criteria。
 * 方向级可勾选清单，不进任务日历 / 积分 / 截止日期。
 */
import { makeTimestampEntityId } from '@/lib/entity-id';
import { LifeRoadValidationError } from '@/lib/life-road/life-road-node-model';

export const LIFE_ROAD_ACCEPTANCE_EXTRA_KEY = 'acceptance_criteria';
export const LIFE_ROAD_ACCEPTANCE_MAX_ITEMS = 20;
export const LIFE_ROAD_ACCEPTANCE_TEXT_MAX = 80;

export type LifeRoadAcceptanceItem = {
  id: string;
  text: string;
  done: boolean;
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
    /* 非 JSON 旧值：当作空对象，写入时覆盖为合法 JSON */
  }
  return {};
}

function normalizeItem(raw: unknown): LifeRoadAcceptanceItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const text = String(o.text ?? '').trim();
  if (!text) return null;
  const idRaw = String(o.id ?? '').trim();
  const id = idRaw || makeTimestampEntityId('lac_', 6);
  return {
    id: id.slice(0, 36),
    text: text.slice(0, LIFE_ROAD_ACCEPTANCE_TEXT_MAX),
    done: Boolean(o.done),
  };
}

/** 从 extra_data 读取验收标准；坏数据静默为空列表 */
export function parseAcceptanceCriteria(
  extraData: string | null | undefined,
): LifeRoadAcceptanceItem[] {
  const obj = parseExtraObject(extraData);
  const list = obj[LIFE_ROAD_ACCEPTANCE_EXTRA_KEY];
  if (!Array.isArray(list)) return [];
  const out: LifeRoadAcceptanceItem[] = [];
  for (const row of list) {
    const item = normalizeItem(row);
    if (item) out.push(item);
    if (out.length >= LIFE_ROAD_ACCEPTANCE_MAX_ITEMS) break;
  }
  return out;
}

export function createAcceptanceItem(text = ''): LifeRoadAcceptanceItem {
  return {
    id: makeTimestampEntityId('lac_', 6),
    text,
    done: false,
  };
}

/** 校验并规范化用户编辑结果（保存前） */
export function normalizeAcceptanceCriteriaInput(
  items: LifeRoadAcceptanceItem[],
): LifeRoadAcceptanceItem[] {
  if (items.length > LIFE_ROAD_ACCEPTANCE_MAX_ITEMS) {
    throw new LifeRoadValidationError(
      `验收标准最多 ${LIFE_ROAD_ACCEPTANCE_MAX_ITEMS} 条`,
    );
  }
  const out: LifeRoadAcceptanceItem[] = [];
  for (const raw of items) {
    const text = String(raw.text ?? '').trim();
    if (!text) continue;
    if (unicodeLen(text) > LIFE_ROAD_ACCEPTANCE_TEXT_MAX) {
      throw new LifeRoadValidationError(
        `验收标准单条最多 ${LIFE_ROAD_ACCEPTANCE_TEXT_MAX} 字`,
      );
    }
    out.push({
      id: (String(raw.id ?? '').trim() || makeTimestampEntityId('lac_', 6)).slice(
        0,
        36,
      ),
      text,
      done: Boolean(raw.done),
    });
  }
  return out;
}

/**
 * 把验收标准写回 extra_data JSON 字符串。
 * 空列表时删除该键；若对象已空则返回 null。
 */
export function writeAcceptanceCriteria(
  extraData: string | null | undefined,
  items: LifeRoadAcceptanceItem[],
): string | null {
  const normalized = normalizeAcceptanceCriteriaInput(items);
  const obj = parseExtraObject(extraData);
  if (normalized.length === 0) {
    delete obj[LIFE_ROAD_ACCEPTANCE_EXTRA_KEY];
  } else {
    obj[LIFE_ROAD_ACCEPTANCE_EXTRA_KEY] = normalized;
  }
  if (Object.keys(obj).length === 0) return null;
  return JSON.stringify(obj);
}

export function acceptanceProgress(items: LifeRoadAcceptanceItem[]): {
  done: number;
  total: number;
} {
  const total = items.length;
  const done = items.filter((i) => i.done).length;
  return { done, total };
}

export function acceptanceMetaLabel(items: LifeRoadAcceptanceItem[]): string | null {
  if (items.length === 0) return null;
  const { done, total } = acceptanceProgress(items);
  return `验收 ${done}/${total}`;
}
