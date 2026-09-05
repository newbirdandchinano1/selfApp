/** 积分流水 reason → 中文标题（前端兜底，不依赖后端是否返回 reason_label） */

const POINTS_LEDGER_REASON_LABELS: Record<string, string> = {
  habit_check_in: '习惯打卡',
  habit_check_in_undo: '撤销习惯打卡',
  habit_goal_complete: '完成习惯目标',
  habit_goal_complete_undo: '撤销习惯目标',
  task_complete: '完成任务',
  task_complete_undo: '撤销任务完成',
  project_complete: '完成项目',
  project_complete_undo: '撤销项目完成',
  wish_redeem: '兑换心愿',
  points_reset: '重置积分',
  manual_adjust: '手动调整',
  break_habit_penalty: '破戒扣分',
  break_habit_penalty_undo: '撤销破戒扣分',
  break_habit_clean: '未破戒加分',
  break_habit_clean_undo: '撤销未破戒加分',
  break_habit_goal: '戒除目标达成',
  break_habit_goal_undo: '撤销戒除目标',
  health_metric_complete: '健康指标达标',
  health_metric_complete_undo: '撤销健康指标达标',
  health_metric_over_penalty: '热量超额扣分',
  health_metric_over_penalty_undo: '撤销热量超额扣分',
};

const HEALTH_METRIC_NAME_ZH: Record<string, string> = {
  hydration: '水分',
  protein: '蛋白质',
  carbohydrate: '碳水',
  calories: '热量',
};

/** 是否像未翻译的英文 reason 代码（如 habit_check_in） */
function looksLikeReasonCode(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(value);
}

/**
 * 展示用标题：优先本地中文映射，其次可用的服务端 reason_label，避免直接露出英文 reason。
 */
export function formatPointsLedgerReasonLabel(
  reason: string | null | undefined,
  reasonLabel?: string | null,
): string {
  const code = String(reason ?? '').trim();
  if (code && POINTS_LEDGER_REASON_LABELS[code]) {
    return POINTS_LEDGER_REASON_LABELS[code];
  }

  const fromApi = String(reasonLabel ?? '').trim();
  if (fromApi && !looksLikeReasonCode(fromApi)) {
    return fromApi;
  }

  if (code.endsWith('_undo')) {
    const base = code.slice(0, -'_undo'.length);
    const baseLabel = POINTS_LEDGER_REASON_LABELS[base];
    if (baseLabel) return `撤销${baseLabel}`;
  }

  if (code) return code;
  if (fromApi) return fromApi;
  return '积分变动';
}

/**
 * 健康指标流水 ref_id 形如 `2026-09-05:calories`，解析为可读副标题。
 */
export function formatHealthMetricLedgerRefTitle(
  refType: string | null | undefined,
  refId: string | null | undefined,
): string | null {
  if (String(refType ?? '').trim() !== 'health_metric') return null;
  const raw = String(refId ?? '').trim();
  if (!raw) return null;
  const colon = raw.lastIndexOf(':');
  if (colon <= 0 || colon >= raw.length - 1) return raw;
  const ymd = raw.slice(0, colon).trim();
  const metric = raw.slice(colon + 1).trim();
  const metricZh = HEALTH_METRIC_NAME_ZH[metric] ?? metric;
  if (!ymd) return metricZh;
  return `${ymd} · ${metricZh}`;
}
