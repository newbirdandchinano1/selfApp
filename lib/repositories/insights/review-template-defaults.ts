import type { ReviewTemplateScope } from './review-template.types';

/** 日 / 周 / 月复盘共用的内置模块语义键（层层嵌套：日→周→月） */
export const REVIEW_BUILTIN_MODULE_KEYS = [
  'health',
  'tasks',
  'finance',
  'routine',
  'defects',
  'ideas',
] as const;

export type ReviewBuiltinModuleKey = (typeof REVIEW_BUILTIN_MODULE_KEYS)[number];

const MODULE_TITLES: Record<ReviewBuiltinModuleKey, string> = {
  health: '健康',
  tasks: '任务',
  finance: '财务',
  routine: '日常',
  defects: '缺陷',
  ideas: '新想法',
};

const MODULE_COLUMN_TITLES: Record<ReviewTemplateScope, Record<ReviewBuiltinModuleKey, string>> = {
  daily: {
    health: '今日健康',
    tasks: '今日任务',
    finance: '今日财务',
    routine: '今日日常',
    defects: '今日缺陷',
    ideas: '今日新想法',
  },
  weekly: {
    health: '本周健康',
    tasks: '本周任务',
    finance: '本周财务',
    routine: '本周日常',
    defects: '本周缺陷',
    ideas: '本周新想法',
  },
  monthly: {
    health: '本月健康',
    tasks: '本月任务',
    finance: '本月财务',
    routine: '本月日常',
    defects: '本月缺陷',
    ideas: '本月新想法',
  },
};

const MODULE_PLACEHOLDERS: Record<ReviewTemplateScope, Record<ReviewBuiltinModuleKey, string>> = {
  daily: {
    health: '可一键写入今日摄入汇总与体重（不含逐条 AI 记录），也可自己补充。',
    tasks: '可一键写入：任务（青蛙）/ 待办 / 小习惯的完成与未完成，也可自己补充。',
    finance: '可一键写入今日汇总与流水，也可自己补充。',
    routine: '今天的日常点滴，自己填写。',
    defects: '今天有哪些做得不够好的地方？写完可用下方快捷入口落到备忘 / 项目 / 习惯 / 待办。',
    ideas: '今天冒出了什么新想法？写完可用下方快捷入口落到备忘 / 项目 / 习惯 / 待办。',
  },
  weekly: {
    health: '空栏默认写入本周摄入汇总（不含逐条 AI 记录），也可自己补充。',
    tasks: '空栏默认写入本周任务/待办/小习惯完成与未完成，也可自己补充。',
    finance: '空栏默认写入本周汇总与流水，也可自己补充。',
    routine: '默认汇总近六天日复盘「日常」，可自行补充。',
    defects: '默认汇总近六天「缺陷」：还有哪些共性问题？写完可用快捷入口落到执行。',
    ideas: '默认汇总近六天「新想法」；写完可用快捷入口落到备忘/项目/习惯/待办。',
  },
  monthly: {
    health: '空栏默认写入本月摄入汇总（不含逐条 AI 记录），也可自己补充。',
    tasks: '空栏默认写入本月任务/待办/小习惯完成与未完成，也可自己补充。',
    finance: '空栏默认写入本月汇总与流水，也可自己补充。',
    routine: '默认汇总本月各周复盘「日常」，可自行补充。',
    defects: '默认汇总本月各周「缺陷」：还有哪些共性问题？写完可用快捷入口落到执行。',
    ideas: '默认汇总本月各周「新想法」；写完可用快捷入口落到备忘/项目/习惯/待办。',
  },
};

export function builtinReviewDimensionId(
  scope: ReviewTemplateScope,
  key: ReviewBuiltinModuleKey,
): string {
  return `rd_${scope}_${key}`;
}

export function builtinReviewColumnId(
  scope: ReviewTemplateScope,
  key: ReviewBuiltinModuleKey,
): string {
  return `rc_${scope}_${key}`;
}

/** @deprecated 使用 BUILTIN_REVIEW_DIMENSION_IDS.daily */
export const BUILTIN_DAILY_REVIEW_DIMENSION_IDS = {
  health: builtinReviewDimensionId('daily', 'health'),
  tasks: builtinReviewDimensionId('daily', 'tasks'),
  finance: builtinReviewDimensionId('daily', 'finance'),
  routine: builtinReviewDimensionId('daily', 'routine'),
  defects: builtinReviewDimensionId('daily', 'defects'),
  ideas: builtinReviewDimensionId('daily', 'ideas'),
} as const;

/** @deprecated 使用 BUILTIN_REVIEW_COLUMN_IDS.daily */
export const BUILTIN_DAILY_REVIEW_COLUMN_IDS = {
  health: builtinReviewColumnId('daily', 'health'),
  tasks: builtinReviewColumnId('daily', 'tasks'),
  finance: builtinReviewColumnId('daily', 'finance'),
  routine: builtinReviewColumnId('daily', 'routine'),
  defects: builtinReviewColumnId('daily', 'defects'),
  ideas: builtinReviewColumnId('daily', 'ideas'),
} as const;

export const BUILTIN_REVIEW_DIMENSION_IDS = {
  daily: BUILTIN_DAILY_REVIEW_DIMENSION_IDS,
  weekly: {
    health: builtinReviewDimensionId('weekly', 'health'),
    tasks: builtinReviewDimensionId('weekly', 'tasks'),
    finance: builtinReviewDimensionId('weekly', 'finance'),
    routine: builtinReviewDimensionId('weekly', 'routine'),
    defects: builtinReviewDimensionId('weekly', 'defects'),
    ideas: builtinReviewDimensionId('weekly', 'ideas'),
  },
  monthly: {
    health: builtinReviewDimensionId('monthly', 'health'),
    tasks: builtinReviewDimensionId('monthly', 'tasks'),
    finance: builtinReviewDimensionId('monthly', 'finance'),
    routine: builtinReviewDimensionId('monthly', 'routine'),
    defects: builtinReviewDimensionId('monthly', 'defects'),
    ideas: builtinReviewDimensionId('monthly', 'ideas'),
  },
} as const;

export const BUILTIN_REVIEW_COLUMN_IDS = {
  daily: BUILTIN_DAILY_REVIEW_COLUMN_IDS,
  weekly: {
    health: builtinReviewColumnId('weekly', 'health'),
    tasks: builtinReviewColumnId('weekly', 'tasks'),
    finance: builtinReviewColumnId('weekly', 'finance'),
    routine: builtinReviewColumnId('weekly', 'routine'),
    defects: builtinReviewColumnId('weekly', 'defects'),
    ideas: builtinReviewColumnId('weekly', 'ideas'),
  },
  monthly: {
    health: builtinReviewColumnId('monthly', 'health'),
    tasks: builtinReviewColumnId('monthly', 'tasks'),
    finance: builtinReviewColumnId('monthly', 'finance'),
    routine: builtinReviewColumnId('monthly', 'routine'),
    defects: builtinReviewColumnId('monthly', 'defects'),
    ideas: builtinReviewColumnId('monthly', 'ideas'),
  },
} as const;

/** 自定义维度排序下限（内置占 10～60） */
export const BUILTIN_DAILY_REVIEW_CUSTOM_SORT_START = 100;
export const BUILTIN_REVIEW_CUSTOM_SORT_START = BUILTIN_DAILY_REVIEW_CUSTOM_SORT_START;

const ALL_BUILTIN_DIMENSION_IDS = new Set<string>(
  (['daily', 'weekly', 'monthly'] as const).flatMap(scope =>
    REVIEW_BUILTIN_MODULE_KEYS.map(key => builtinReviewDimensionId(scope, key)),
  ),
);
const ALL_BUILTIN_COLUMN_IDS = new Set<string>(
  (['daily', 'weekly', 'monthly'] as const).flatMap(scope =>
    REVIEW_BUILTIN_MODULE_KEYS.map(key => builtinReviewColumnId(scope, key)),
  ),
);

export function isBuiltinReviewDimensionId(id: string | null | undefined): boolean {
  return !!id && ALL_BUILTIN_DIMENSION_IDS.has(id);
}

export function isBuiltinReviewColumnId(id: string | null | undefined): boolean {
  return !!id && ALL_BUILTIN_COLUMN_IDS.has(id);
}

/** 兼容旧名：日复盘内置判断（现含全部 scope 内置 ID） */
export function isBuiltinDailyReviewDimensionId(id: string | null | undefined): boolean {
  return isBuiltinReviewDimensionId(id);
}

export function isBuiltinDailyReviewColumnId(id: string | null | undefined): boolean {
  return isBuiltinReviewColumnId(id);
}

/** 置顶顺序：健康 → 任务 → 财务 → 日常 → 缺陷 → 新想法 */
export const BUILTIN_DAILY_REVIEW_PIN_ORDER = REVIEW_BUILTIN_MODULE_KEYS.map(key =>
  builtinReviewDimensionId('daily', key),
);

export function builtinReviewPinOrder(scope: ReviewTemplateScope): readonly string[] {
  return REVIEW_BUILTIN_MODULE_KEYS.map(key => builtinReviewDimensionId(scope, key));
}

export function builtinDailyReviewPinIndex(id: string): number {
  return builtinReviewPinIndex('daily', id);
}

export function builtinReviewPinIndex(scope: ReviewTemplateScope, id: string): number {
  return builtinReviewPinOrder(scope).indexOf(id);
}

export function pinDailyReviewDimensions<T extends { id: string }>(
  dims: T[],
  sortKey: (d: T) => number,
): T[] {
  return pinBuiltinReviewDimensions('daily', dims, sortKey);
}

export function pinBuiltinReviewDimensions<T extends { id: string }>(
  scope: ReviewTemplateScope,
  dims: T[],
  sortKey: (d: T) => number,
): T[] {
  return [...dims].sort((a, b) => {
    const ai = builtinReviewPinIndex(scope, a.id);
    const bi = builtinReviewPinIndex(scope, b.id);
    const aPin = ai >= 0;
    const bPin = bi >= 0;
    if (aPin && bPin) return ai - bi;
    if (aPin) return -1;
    if (bPin) return 1;
    return sortKey(a) - sortKey(b);
  });
}

type DefaultDim = {
  id: string;
  title: string;
  sort_order: number;
  columns: readonly { id: string; title: string; placeholder: string; sort_order: number }[];
};

function buildScopeDefaults(scope: ReviewTemplateScope): DefaultDim[] {
  return REVIEW_BUILTIN_MODULE_KEYS.map((key, index) => ({
    id: builtinReviewDimensionId(scope, key),
    title: MODULE_TITLES[key],
    sort_order: (index + 1) * 10,
    columns: [
      {
        id: builtinReviewColumnId(scope, key),
        title: MODULE_COLUMN_TITLES[scope][key],
        placeholder: MODULE_PLACEHOLDERS[scope][key],
        sort_order: 10,
      },
    ],
  }));
}

/** 内置维度/栏目稳定 ID，便于从旧版固定字段迁移 */
export const REVIEW_TEMPLATE_DEFAULTS = {
  daily: buildScopeDefaults('daily'),
  weekly: buildScopeDefaults('weekly'),
  monthly: buildScopeDefaults('monthly'),
} as const satisfies Record<ReviewTemplateScope, readonly DefaultDim[]>;

/** 旧版周复盘默认维度（迁移时软删除） */
export const LEGACY_WEEKLY_DEFAULT_DIMENSION_IDS = [
  'rd_weekly_summary',
  'rd_weekly_plans',
  'rd_weekly_reflect',
  'rd_weekly_learnings',
  'rd_weekly_next',
] as const;

/** 旧版月复盘默认维度（迁移时软删除） */
export const LEGACY_MONTHLY_DEFAULT_DIMENSION_IDS = [
  'rd_monthly_summary',
  'rd_monthly_reflect',
  'rd_monthly_next',
] as const;

/** 周复盘旧表字段 → 栏目 ID（读旧数据 / 写回 legacy 列） */
export const LEGACY_WEEKLY_COLUMN_IDS = {
  section_summary: 'rc_weekly_summary',
  section_plans: 'rc_weekly_plans',
  section_reflect: 'rc_weekly_reflect',
  section_learnings: 'rc_weekly_learnings',
  section_next_week: 'rc_weekly_next',
} as const;

/** 旧周栏目 → 新内置栏目（仅在新栏为空时迁入） */
export const LEGACY_WEEKLY_COLUMN_TO_BUILTIN: Record<string, string> = {
  [LEGACY_WEEKLY_COLUMN_IDS.section_summary]: builtinReviewColumnId('weekly', 'routine'),
  [LEGACY_WEEKLY_COLUMN_IDS.section_plans]: builtinReviewColumnId('weekly', 'tasks'),
  [LEGACY_WEEKLY_COLUMN_IDS.section_reflect]: builtinReviewColumnId('weekly', 'defects'),
  [LEGACY_WEEKLY_COLUMN_IDS.section_learnings]: builtinReviewColumnId('weekly', 'ideas'),
  [LEGACY_WEEKLY_COLUMN_IDS.section_next_week]: builtinReviewColumnId('weekly', 'routine'),
};

/** 旧月栏目 → 新内置栏目 */
export const LEGACY_MONTHLY_COLUMN_TO_BUILTIN: Record<string, string> = {
  rc_monthly_summary: builtinReviewColumnId('monthly', 'routine'),
  rc_monthly_reflect: builtinReviewColumnId('monthly', 'defects'),
  rc_monthly_next: builtinReviewColumnId('monthly', 'ideas'),
};

/** 子 scope 栏目 → 父 scope 同名语义栏目 */
export function childToParentBuiltinColumnId(
  childScope: 'daily' | 'weekly',
  parentScope: 'weekly' | 'monthly',
  childColumnId: string,
): string | null {
  for (const key of REVIEW_BUILTIN_MODULE_KEYS) {
    if (childColumnId === builtinReviewColumnId(childScope, key)) {
      return builtinReviewColumnId(parentScope, key);
    }
  }
  return null;
}
