/**
 * 阶段 F：时间线左侧语义时段标签（决议 #8）
 * 按钟点自动分桶：凌晨 / 上午 / 午间 / 下午 / 晚餐 / 晚上。
 * 边界为常量，可后续微调；支持跨午夜（逻辑日 axis 可 >1440）。
 */
import type { AxisLike } from '@/lib/schedule/axis';
import { SCHEDULE_DAY_END_MAX_MINUTES } from '@/lib/schedule/axis';

export type SemanticBucketKey =
  | 'dawn'
  | 'morning'
  | 'noon'
  | 'afternoon'
  | 'dinner'
  | 'evening';

type RawBucket = {
  key: SemanticBucketKey;
  label: string;
  /** 墙上时钟小时，[from, to) */
  fromHour: number;
  toHour: number;
};

/** 桶边界：可调常量。全天 24h，按墙钟小时划分。 */
export const SEMANTIC_BUCKET_DEFS: readonly RawBucket[] = [
  { key: 'dawn', label: '凌晨', fromHour: 0, toHour: 6 },
  { key: 'morning', label: '上午', fromHour: 6, toHour: 11 },
  { key: 'noon', label: '午间', fromHour: 11, toHour: 14 },
  { key: 'afternoon', label: '下午', fromHour: 14, toHour: 18 },
  { key: 'dinner', label: '晚餐', fromHour: 18, toHour: 20 },
  { key: 'evening', label: '晚上', fromHour: 20, toHour: 24 },
] as const;

export type SemanticBucketSegment = {
  key: SemanticBucketKey;
  label: string;
  startMinutes: number;
  endMinutes: number;
};

/**
 * 轴上各语义时段片段（裁剪到 [axis.startMinutes, axis.endMinutes)）。
 * 轴跨越午夜时按天偏移重复展开（0 / +1440 / +2880）。
 */
export function semanticBucketsForAxis(axis: AxisLike): SemanticBucketSegment[] {
  const start = Math.max(0, Math.round(axis.startMinutes));
  const end = Math.round(axis.endMinutes);
  if (!(end > start)) return [];

  const out: SemanticBucketSegment[] = [];
  const maxOffset = Math.ceil(end / SCHEDULE_DAY_END_MAX_MINUTES) * SCHEDULE_DAY_END_MAX_MINUTES;
  for (let dayOffset = 0; dayOffset <= maxOffset; dayOffset += SCHEDULE_DAY_END_MAX_MINUTES) {
    for (const def of SEMANTIC_BUCKET_DEFS) {
      const segStart = Math.max(start, dayOffset + def.fromHour * 60);
      const segEnd = Math.min(end, dayOffset + def.toHour * 60);
      if (segEnd > segStart) {
        out.push({
          key: def.key,
          label: def.label,
          startMinutes: segStart,
          endMinutes: segEnd,
        });
      }
    }
  }
  return out;
}

/** 某一分钟命中的语义标签（墙钟口径）；用于无障碍 / 卡片副文 */
export function semanticLabelForMinutes(minutes: number): string {
  const m =
    ((Math.round(minutes) % SCHEDULE_DAY_END_MAX_MINUTES) +
      SCHEDULE_DAY_END_MAX_MINUTES) %
    SCHEDULE_DAY_END_MAX_MINUTES;
  const hour = m / 60;
  for (const def of SEMANTIC_BUCKET_DEFS) {
    if (hour >= def.fromHour && hour < def.toHour) return def.label;
  }
  return '晚上';
}
