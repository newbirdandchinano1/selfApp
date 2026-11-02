/**
 * AI 复盘分析 · JSON 契约（App 侧权威定义）
 *
 * 用途：约束 Agent `/weekly-review/coaching` 的返回形状，与
 * `components/review/review-ai-analysis-screen.tsx` UI 一一对应。
 * Agent `review_prompts.py` 须与本文件保持字段名、枚举与长度上限一致。
 *
 * UI 映射：
 * - title       → 页顶英雄区总结标题（流式展示）
 * - overview    → 「复盘概览」卡正文
 * - tags        → 标题下方维度标签（0～4）
 * - suggestions →「明天/下周/下月可以试试」列表；每条可快捷新建备忘/项目/习惯/待办
 *
 * 落库：整份对象序列化为字符串写入 ai_coaching（见 serializeReviewAiPayload）。
 */

/** 与内置复盘维度标题一致；自定义模板可额外出现，解析端会尽量保留短标签 */
export const REVIEW_AI_TAG_ALLOWLIST = [
  '健康',
  '任务',
  '财务',
  '日常',
  '缺陷',
  '新想法',
] as const;

export type ReviewAiTagName = (typeof REVIEW_AI_TAG_ALLOWLIST)[number];

export const REVIEW_AI_SUGGESTION_ACTIONS = ['memo', 'project', 'habit', 'todo'] as const;

export type ReviewAiSuggestionAction = (typeof REVIEW_AI_SUGGESTION_ACTIONS)[number];

/** 字段长度上限（与 Agent normalize / App parse 对齐） */
export const REVIEW_AI_JSON_LIMITS = {
  title: 48,
  overview: 800,
  suggestionText: 80,
  draftTitle: 40,
  draftBody: 160,
  tagsMax: 4,
  suggestionsMax: 12,
} as const;

export type ReviewAiJsonSuggestion = {
  /** 列表行展示的可执行建议 */
  text: string;
  /** 更合适的快捷落地点；App 仍会给每条提供四种新建入口 */
  action: ReviewAiSuggestionAction;
  /** 快捷新建预填标题 */
  draft_title: string;
  /** 快捷新建预填备注 / 验收标准，可空串 */
  draft_body?: string;
};

/** Agent 成功时 data 中的结构化体（另含 text 落库串） */
export type ReviewAiJsonPayload = {
  title: string;
  overview: string;
  tags: string[];
  suggestions: ReviewAiJsonSuggestion[];
};

/** 给模型看的形状示例（内容占位，须替换） */
export const REVIEW_AI_JSON_EXAMPLE: ReviewAiJsonPayload = {
  title: '今天执行集中，睡眠偏晚',
  overview:
    '上午推进了关键任务，下午精力下降。健康维度睡眠偏晚，财务未记，不作强推断。明天优先收口一项青蛙任务并提前入睡。',
  tags: ['任务', '健康'],
  suggestions: [
    {
      text: '明天上午只排一项青蛙任务并完成。',
      action: 'todo',
      draft_title: '明日青蛙',
      draft_body: '只排一项，完成即勾选',
    },
    {
      text: '连续三天 23:00 前入睡并打卡。',
      action: 'habit',
      draft_title: '23 点前入睡',
      draft_body: '连续三天',
    },
  ],
};

/**
 * 写入 system / 文档用的紧凑 JSON 提示串（单行）。
 * Agent 侧应使用同构字符串，避免两边字段漂移。
 */
export function reviewAiJsonHint(): string {
  return JSON.stringify(REVIEW_AI_JSON_EXAMPLE);
}

/** 人可读的字段说明，供文档或调试 */
export const REVIEW_AI_JSON_FIELD_DOCS: Record<
  keyof ReviewAiJsonPayload,
  { ui: string; rules: string }
> = {
  title: {
    ui: '分析页顶部总结标题',
    rules: '简体中文一句，约 12～36 字，勿换行，勿空标题如「复盘报告」',
  },
  overview: {
    ui: '「复盘概览」卡',
    rules: '约 80～220 字连贯段落，两到五句；勿分点、勿小标题；缺数据写明不足，勿编造',
  },
  tags: {
    ui: '标题下维度标签',
    rules: `0～${REVIEW_AI_JSON_LIMITS.tagsMax} 个，优先从「${REVIEW_AI_TAG_ALLOWLIST.join('、')}」选取`,
  },
  suggestions: {
    ui: '「可以试试」列表',
    rules: `1～${REVIEW_AI_JSON_LIMITS.suggestionsMax} 条；每项含 text / action / draft_title / draft_body；action 仅 memo|project|habit|todo`,
  },
};
