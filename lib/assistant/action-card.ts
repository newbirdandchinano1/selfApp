/**
 * 全局助手 ActionCard 契约（对齐《全局AI助手方案》§5 / S9.2）。
 * 写库类必须 needs_confirm；推荐 id 只能来自 brief_context 白名单。
 * commit_* 由 App ChatCommitExecutor 落库；preview_* 仍为 Sheet/路由降级。
 */

import type {
  DraftField,
  WriteOperationError,
  WriteOperationResult,
  WriteOperationState,
} from '@/lib/assistant/write-operation';

export type { DraftField, WriteOperationError, WriteOperationResult, WriteOperationState };

export type AssistantDomain =
  | 'finance'
  | 'food'
  | 'task'
  | 'habit'
  | 'memo'
  | 'wardrobe'
  | 'recipe'
  | 'wish'
  | 'review'
  | 'general'
  | 'profile'
  | 'life_road'
  | 'project';

export type AssistantIntent =
  | 'create'
  | 'insight'
  | 'navigate'
  | 'clarify'
  | 'suggest_today'
  | 'multi';

/** S8 预览/导航确认动作 */
export type AssistantPreviewConfirmAction =
  | 'preview_finance_txn'
  | 'preview_finance_transfer'
  | 'preview_finance_scheduled'
  | 'preview_finance_cash_flow'
  | 'preview_finance_budget'
  | 'preview_food_intake'
  | 'preview_task'
  | 'preview_habit'
  | 'preview_memo'
  | 'preview_wardrobe_item'
  | 'preview_wish'
  | 'preview_recipe'
  | 'preview_profile'
  | 'open_route'
  | 'frog_assign'
  | 'review_quick_create';

/**
 * S9 commit_*（名称以对照表 / Registry 为准；解析时允许任意 commit_ 前缀）。
 * 未注册 handler 的动作由 Executor 返回 failed，不得宣称已保存。
 */
export type AssistantCommitConfirmAction =
  | 'commit_finance_txn'
  | 'commit_finance_transfer'
  | 'commit_finance_scheduled'
  | 'commit_finance_cash_flow'
  | 'commit_finance_budget'
  | 'commit_finance_account'
  | 'commit_finance_flow_category'
  | 'commit_finance_account_type'
  | 'commit_savings_plan'
  | 'commit_savings_deposit'
  | 'commit_task'
  | 'commit_project'
  | 'commit_habit'
  | 'commit_habit_checkin'
  | 'commit_habit_context'
  | 'commit_food_intake'
  | 'commit_weight'
  | 'commit_intake_targets'
  | 'commit_memo'
  | 'commit_recipe'
  | 'commit_recipe_plan'
  | 'commit_recipe_basket'
  | 'commit_recipe_shop'
  | 'commit_recipe_cook_log'
  | 'commit_recipe_category'
  | 'commit_recipe_delete'
  | 'commit_recipe_category_delete'
  | 'commit_wardrobe_item'
  | 'commit_wardrobe_outfit'
  | 'commit_wardrobe_wear'
  | 'commit_wardrobe_meta'
  | 'commit_wardrobe_body'
  | 'commit_wish'
  | 'commit_review_journal'
  | 'commit_review_dimension'
  | 'commit_review_column'
  | 'commit_profile'
  | 'commit_life_road_node'
  | 'commit_life_direction'
  | 'commit_life_bet'
  | 'commit_tag'
  | 'commit_task_category'
  | 'commit_project_category'
  | 'commit_schedule_placement'
  | 'commit_catalog_write'
  | (string & { readonly __commitBrand?: unique symbol });

export type AssistantConfirmAction =
  | AssistantPreviewConfirmAction
  | AssistantCommitConfirmAction;

/** 敏感操作永不作为 confirm_action（兑奖/删库/改余额/批量完成等） */
export const FORBIDDEN_CONFIRM_ACTIONS = [
  'redeem_wish',
  'delete',
  'delete_record',
  'adjust_balance',
  'complete_task',
  'batch_complete',
  'arrive_road',
  'reset_points',
  'reset_user_data',
  'delete_account',
] as const;

export type ForbiddenConfirmAction = (typeof FORBIDDEN_CONFIRM_ACTIONS)[number];

export const ASSISTANT_CONFIRM_ACTIONS: readonly AssistantPreviewConfirmAction[] = [
  'preview_finance_txn',
  'preview_finance_transfer',
  'preview_finance_scheduled',
  'preview_finance_cash_flow',
  'preview_finance_budget',
  'preview_food_intake',
  'preview_task',
  'preview_habit',
  'preview_memo',
  'preview_wardrobe_item',
  'preview_wish',
  'preview_recipe',
  'preview_profile',
  'open_route',
  'frog_assign',
  'review_quick_create',
] as const;

export type ActionCard = {
  id: string;
  domain: AssistantDomain;
  intent: AssistantIntent;
  title: string;
  summary?: string;
  confidence: number;
  needs_confirm: boolean;
  /** 对齐 L1 场景草稿；字段名与对应域 parse 响应一致 */
  draft?: Record<string, unknown>;
  /** 推荐/指派类：必须是请求摘要里出现过的 id */
  ref_ids?: string[];
  confirm_action?: AssistantConfirmAction;
  /** S9.2：多轮改稿稳定 id；缺省 = card.id */
  operation_id?: string;
  /** S9.2：写操作状态机 */
  write_status?: WriteOperationState;
  /** S9.2：可显式指定 commit；缺省复用 confirm_action */
  commit_action?: AssistantCommitConfirmAction;
  /** S9.2：确认卡展示字段 */
  draft_fields?: DraftField[];
  /** S9.2：succeeded 后填充 */
  result?: WriteOperationResult;
  /** S9.2：failed 时填充 */
  error?: WriteOperationError;
  /** S9.2：幂等键；建议 = operation_id */
  idempotency_key?: string;
  /**
   * 导航类：Agent 只发 module_id，由 capability-router 映射 Href。
   * 有 module_id 时优先于 route_href（遗留兼容）。
   */
  module_id?: string;
  /** 遗留：旧 assistant/route 可能直接给 Href；新路径应使用 module_id */
  route_href?: string;
  route_params?: Record<string, string>;
  clarify_question?: string;
  clarify_choices?: string[];
};

const DOMAINS = new Set<string>([
  'finance',
  'food',
  'task',
  'habit',
  'memo',
  'wardrobe',
  'recipe',
  'wish',
  'review',
  'general',
  'profile',
  'life_road',
  'project',
]);

const INTENTS = new Set<string>([
  'create',
  'insight',
  'navigate',
  'clarify',
  'suggest_today',
  'multi',
]);

const CONFIRM_SET = new Set<string>(ASSISTANT_CONFIRM_ACTIONS);
const FORBIDDEN_SET = new Set<string>(FORBIDDEN_CONFIRM_ACTIONS);

const WRITE_STATUS_SET = new Set<string>([
  'drafted',
  'awaiting_confirmation',
  'committing',
  'succeeded',
  'failed',
  'cancelled',
]);

function isAllowedConfirmAction(action: string): boolean {
  if (FORBIDDEN_SET.has(action)) return false;
  if (CONFIRM_SET.has(action)) return true;
  // S9：任意 commit_* 可解析；是否可执行由 ChatCommitExecutor 注册表决定
  if (action.startsWith('commit_')) return true;
  return false;
}

/** draft / route_params 内可能出现的实体 id 字段（白名单校验） */
export const ASSISTANT_DRAFT_ID_KEYS = [
  'frog_task_id',
  'task_id',
  'taskId',
  'habit_id',
  'habitId',
  'memo_id',
  'memoId',
  'item_id',
  'itemId',
  'outfit_id',
  'outfitId',
  'recipe_id',
  'recipeId',
  'wish_id',
  'wishId',
  'project_id',
  'projectId',
  'account_id',
  'accountId',
  'tag_id',
  'tagId',
  'id',
] as const;

export type SanitizeActionCardResult = {
  card: ActionCard;
  /** 被丢弃的 id（不在白名单） */
  dropped_ids: string[];
  /** 因关键 id 整卡降级为 clarify */
  degraded_to_clarify: boolean;
};

function asTrimmedString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s ? s : null;
}

function clampConfidence(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function parseRouteParams(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = String(v);
    else if (typeof v === 'boolean') out[k] = v ? '1' : '0';
  }
  return Object.keys(out).length ? out : undefined;
}

function parseStringList(raw: unknown, max = 20): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const item of raw) {
    const s = asTrimmedString(item);
    if (!s) continue;
    out.push(s);
    if (out.length >= max) break;
  }
  return out.length ? out : undefined;
}

function isWriteConfirmAction(action: AssistantConfirmAction | undefined): boolean {
  if (!action) return false;
  return (
    action.startsWith('preview_') ||
    action.startsWith('commit_') ||
    action === 'frog_assign' ||
    action === 'review_quick_create'
  );
}

function parseDraftFields(raw: unknown): DraftField[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: DraftField[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const key = asTrimmedString(o.key);
    if (!key) continue;
    const label = asTrimmedString(o.label) || key;
    const value =
      typeof o.value === 'string'
        ? o.value
        : o.value == null
          ? ''
          : String(o.value);
    out.push({ key, label, value, editable: o.editable === true });
    if (out.length >= 24) break;
  }
  return out.length ? out : undefined;
}

function parseWriteStatus(raw: unknown): WriteOperationState | undefined {
  const s = asTrimmedString(raw);
  if (!s || !WRITE_STATUS_SET.has(s)) return undefined;
  return s as WriteOperationState;
}

function parseWriteResult(raw: unknown): WriteOperationResult | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const entity_id = asTrimmedString(o.entity_id) ?? undefined;
  const message = asTrimmedString(o.message) ?? undefined;
  const syncRaw = asTrimmedString(o.sync_status);
  const sync_status =
    syncRaw === 'synced' ||
    syncRaw === 'pending' ||
    syncRaw === 'pending_push' ||
    syncRaw === 'pending_pull' ||
    syncRaw === 'sync_failed' ||
    syncRaw === 'failed'
      ? syncRaw
      : undefined;
  if (!entity_id && !message && !sync_status) return undefined;
  return { entity_id, message, sync_status };
}

function parseWriteError(raw: unknown): WriteOperationError | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const code = asTrimmedString(o.code) || 'error';
  const message = asTrimmedString(o.message) || '操作失败';
  return { code, message };
}

/**
 * 将 Agent 原始 JSON 规范为 ActionCard；非法 confirm_action / 敏感动作剔除。
 * 不抛错：坏卡尽量降级为 clarify。
 */
export function parseActionCard(raw: unknown, fallbackId = 'c0'): ActionCard {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const id = asTrimmedString(o.id) || fallbackId;
  const domainRaw = asTrimmedString(o.domain) || 'general';
  const domain: AssistantDomain = DOMAINS.has(domainRaw) ? (domainRaw as AssistantDomain) : 'general';
  const intentRaw = asTrimmedString(o.intent) || 'clarify';
  let intent: AssistantIntent = INTENTS.has(intentRaw) ? (intentRaw as AssistantIntent) : 'clarify';

  const title = asTrimmedString(o.title) || (intent === 'clarify' ? '需要补充' : '助手建议');
  const summary = asTrimmedString(o.summary) ?? undefined;
  const confidence = clampConfidence(o.confidence);

  let confirm_action: AssistantConfirmAction | undefined;
  const confirmRaw = asTrimmedString(o.confirm_action);
  if (confirmRaw) {
    if (FORBIDDEN_SET.has(confirmRaw)) {
      intent = 'clarify';
      confirm_action = undefined;
    } else if (isAllowedConfirmAction(confirmRaw)) {
      confirm_action = confirmRaw as AssistantConfirmAction;
    }
  }

  const draft =
    o.draft && typeof o.draft === 'object' && !Array.isArray(o.draft)
      ? ({ ...(o.draft as Record<string, unknown>) } as Record<string, unknown>)
      : undefined;

  const ref_ids = parseStringList(o.ref_ids);
  const module_id = asTrimmedString(o.module_id) ?? undefined;
  const route_href = asTrimmedString(o.route_href) ?? undefined;
  const route_params = parseRouteParams(o.route_params);
  const clarify_question = asTrimmedString(o.clarify_question) ?? undefined;
  const clarify_choices = parseStringList(o.clarify_choices, 8);

  const operation_id =
    asTrimmedString(o.operation_id) ||
    (confirm_action?.startsWith('commit_') ? id : undefined);
  const commitRaw = asTrimmedString(o.commit_action);
  const commit_action =
    commitRaw && commitRaw.startsWith('commit_') && !FORBIDDEN_SET.has(commitRaw)
      ? (commitRaw as AssistantCommitConfirmAction)
      : undefined;
  const draft_fields = parseDraftFields(o.draft_fields);
  let write_status = parseWriteStatus(o.write_status);
  if (!write_status && (confirm_action?.startsWith('commit_') || commit_action)) {
    write_status = 'awaiting_confirmation';
  }
  const result = parseWriteResult(o.result);
  const error = parseWriteError(o.error);
  const idempotency_key =
    asTrimmedString(o.idempotency_key) || operation_id || undefined;

  let needs_confirm = o.needs_confirm === true;
  if (isWriteConfirmAction(confirm_action) || Boolean(commit_action)) {
    needs_confirm = true;
  }
  if (intent === 'clarify') {
    needs_confirm = false;
  }

  return {
    id,
    domain,
    intent,
    title,
    summary,
    confidence,
    needs_confirm,
    draft,
    ref_ids,
    confirm_action,
    operation_id,
    write_status,
    commit_action,
    draft_fields,
    result,
    error,
    idempotency_key,
    module_id,
    route_href,
    route_params,
    clarify_question,
    clarify_choices,
  };
}

export function parseActionCards(raw: unknown): ActionCard[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item, i) => parseActionCard(item, `c${i}`));
}

function collectDraftIds(draft: Record<string, unknown> | undefined): string[] {
  if (!draft) return [];
  const out: string[] = [];
  for (const key of ASSISTANT_DRAFT_ID_KEYS) {
    const v = draft[key];
    if (typeof v === 'string' && v.trim()) out.push(v.trim());
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === 'string' && item.trim()) out.push(item.trim());
      }
    }
  }
  // quick_add_keys / recipe_ids 等数组字段
  for (const key of ['quick_add_keys', 'recipe_ids', 'itemIds', 'item_ids', 'tag_ids', 'focus_task_ids']) {
    const v = draft[key];
    if (!Array.isArray(v)) continue;
    for (const item of v) {
      if (typeof item === 'string' && item.trim()) out.push(item.trim());
    }
  }
  return out;
}

function stripUnknownDraftIds(
  draft: Record<string, unknown> | undefined,
  allowed: Set<string>,
): { draft: Record<string, unknown> | undefined; dropped: string[] } {
  if (!draft) return { draft: undefined, dropped: [] };
  const next: Record<string, unknown> = { ...draft };
  const dropped: string[] = [];

  for (const key of ASSISTANT_DRAFT_ID_KEYS) {
    if (!(key in next)) continue;
    const v = next[key];
    if (typeof v === 'string') {
      const id = v.trim();
      if (id && !allowed.has(id)) {
        dropped.push(id);
        delete next[key];
      }
    } else if (Array.isArray(v)) {
      const kept: string[] = [];
      for (const item of v) {
        if (typeof item !== 'string') continue;
        const id = item.trim();
        if (!id) continue;
        if (allowed.has(id)) kept.push(id);
        else dropped.push(id);
      }
      if (kept.length) next[key] = kept;
      else delete next[key];
    }
  }

  for (const key of ['quick_add_keys', 'recipe_ids', 'itemIds', 'item_ids', 'tag_ids', 'focus_task_ids']) {
    if (!(key in next) || !Array.isArray(next[key])) continue;
    const kept: string[] = [];
    for (const item of next[key] as unknown[]) {
      if (typeof item !== 'string') continue;
      const id = item.trim();
      if (!id) continue;
      if (allowed.has(id)) kept.push(id);
      else dropped.push(id);
    }
    if (kept.length) next[key] = kept;
    else delete next[key];
  }

  return { draft: next, dropped };
}

function degradeToClarify(card: ActionCard, reason: string): ActionCard {
  return {
    id: card.id,
    domain: card.domain === 'general' ? 'general' : card.domain,
    intent: 'clarify',
    title: '需要补充',
    summary: reason,
    confidence: Math.min(card.confidence, 0.45),
    needs_confirm: false,
    clarify_question: card.clarify_question || reason,
    clarify_choices: card.clarify_choices,
  };
}

/**
 * id 白名单校验：ref_ids / draft 内实体 id 不在 allowedIds → 丢弃该字段；
 * 若写操作依赖的核心 id 全部失效，整卡降级为 clarify。
 */
export function sanitizeActionCardAgainstWhitelist(
  card: ActionCard,
  allowedIds: Iterable<string>,
): SanitizeActionCardResult {
  const allowed = new Set<string>();
  for (const id of allowedIds) {
    const s = String(id ?? '').trim();
    if (s) allowed.add(s);
  }

  const dropped_ids: string[] = [];
  const next: ActionCard = { ...card };

  if (next.ref_ids?.length) {
    const kept: string[] = [];
    for (const id of next.ref_ids) {
      if (allowed.has(id)) kept.push(id);
      else dropped_ids.push(id);
    }
    next.ref_ids = kept.length ? kept : undefined;
  }

  if (next.route_params) {
    const rp: Record<string, string> = { ...next.route_params };
    for (const key of ['id', 'taskId', 'habitId', 'memoId', 'itemId', 'outfitId', 'wishId', 'recipeId']) {
      const v = rp[key]?.trim();
      if (!v) continue;
      if (!allowed.has(v)) {
        dropped_ids.push(v);
        delete rp[key];
      }
    }
    next.route_params = Object.keys(rp).length ? rp : undefined;
  }

  const stripped = stripUnknownDraftIds(next.draft, allowed);
  next.draft = stripped.draft;
  dropped_ids.push(...stripped.dropped);

  const needsEntity =
    next.confirm_action === 'frog_assign' ||
    next.intent === 'suggest_today' ||
    (next.confirm_action === 'open_route' && Boolean(next.route_params?.id));

  const coreIds = [
    ...(next.ref_ids ?? []),
    ...collectDraftIds(next.draft),
    next.route_params?.id,
    typeof next.draft?.frog_task_id === 'string' ? next.draft.frog_task_id : null,
  ].filter((x): x is string => typeof x === 'string' && !!x.trim());

  let degraded_to_clarify = false;
  if (needsEntity && coreIds.length === 0 && dropped_ids.length > 0) {
    degraded_to_clarify = true;
    return {
      card: degradeToClarify(next, '推荐条目不在今日摘要中，请换一种说法或打开对应页面。'),
      dropped_ids: [...new Set(dropped_ids)],
      degraded_to_clarify,
    };
  }

  if (next.confirm_action && FORBIDDEN_SET.has(next.confirm_action)) {
    degraded_to_clarify = true;
    return {
      card: degradeToClarify(next, '该操作不能由助手直接执行，请到对应页面手动完成。'),
      dropped_ids: [...new Set(dropped_ids)],
      degraded_to_clarify,
    };
  }

  return {
    card: next,
    dropped_ids: [...new Set(dropped_ids)],
    degraded_to_clarify,
  };
}

export function sanitizeActionCardsAgainstWhitelist(
  cards: ActionCard[],
  allowedIds: Iterable<string>,
): { cards: ActionCard[]; dropped_ids: string[] } {
  const allDropped: string[] = [];
  const out = cards.map(c => {
    const r = sanitizeActionCardAgainstWhitelist(c, allowedIds);
    allDropped.push(...r.dropped_ids);
    return r.card;
  });
  return { cards: out, dropped_ids: [...new Set(allDropped)] };
}
