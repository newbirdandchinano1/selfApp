/**
 * Agent 思考态：由真实 stream / 请求生命周期驱动，不做定时器伪阶段。
 */

export type AgentThinkingPhase =
  | 'thinking'
  | 'tool'
  | 'organizing'
  | 'generating'
  | 'error';

/** 视觉强度：普通思考 / 执行任务 / 生成收敛 */
export type AgentThinkingVisual = 'calm' | 'active' | 'converging';

export type AgentThinkingState = {
  phase: AgentThinkingPhase;
  label: string;
  visual: AgentThinkingVisual;
  toolName?: string;
};

const TOOL_STATUS_LABELS: Record<string, string> = {
  'kb.search': '正在检索相关知识…',
  'finance.summary': '正在查询账单数据…',
  'finance.draft_expense': '正在准备记账草稿…',
  'task.list_upcoming': '正在查询待办…',
  'task.draft_todo': '正在准备待办草稿…',
  'habit.draft_habit': '正在准备习惯草稿…',
  'food.gap_summary': '正在查询饮食数据…',
  'food.draft_intake': '正在准备饮食记录…',
  'memo.draft_memo': '正在准备备忘草稿…',
  'recipe.suggest_pantry': '正在根据食材推荐菜谱…',
  'app.open_module': '正在准备打开对应功能…',
};

const PREFIX_LABELS: { prefix: string; label: string }[] = [
  { prefix: 'kb.', label: '正在检索相关知识…' },
  { prefix: 'finance.', label: '正在查询 APP 财务数据…' },
  { prefix: 'task.', label: '正在查询 APP 待办数据…' },
  { prefix: 'habit.', label: '正在查询习惯数据…' },
  { prefix: 'food.', label: '正在查询饮食数据…' },
  { prefix: 'memo.', label: '正在处理备忘…' },
  { prefix: 'recipe.', label: '正在查询菜谱数据…' },
  { prefix: 'app.', label: '正在调用 APP 能力…' },
];

export function labelForToolName(toolName: string): string {
  const name = toolName.trim();
  if (!name) return '正在调用工具…';
  const exact = TOOL_STATUS_LABELS[name];
  if (exact) return exact;
  for (const { prefix, label } of PREFIX_LABELS) {
    if (name.startsWith(prefix)) return label;
  }
  return `正在调用工具：${name}…`;
}

export function visualForPhase(phase: AgentThinkingPhase): AgentThinkingVisual {
  switch (phase) {
    case 'tool':
      return 'active';
    case 'generating':
      return 'converging';
    case 'error':
      return 'calm';
    case 'thinking':
    case 'organizing':
    default:
      return 'calm';
  }
}

export function createThinkingState(
  phase: AgentThinkingPhase,
  opts?: { toolName?: string; label?: string },
): AgentThinkingState {
  const toolName = opts?.toolName?.trim() || undefined;
  let label = opts?.label?.trim() || '';
  if (!label) {
    switch (phase) {
      case 'thinking':
        label = '正在思考…';
        break;
      case 'tool':
        label = labelForToolName(toolName ?? '');
        break;
      case 'organizing':
        label = '正在整理回答…';
        break;
      case 'generating':
        label = '正在生成回答…';
        break;
      case 'error':
        label = '请求遇到问题';
        break;
      default:
        label = '正在思考…';
    }
  }
  return {
    phase,
    label,
    visual: visualForPhase(phase),
    toolName,
  };
}

/** 是否应展示思考光球（有正文后交给流式气泡；生成态无正文时仍可短暂收敛） */
export function shouldShowThinkingOrb(
  thinking: AgentThinkingState | null | undefined,
  hasAssistantText: boolean,
): boolean {
  if (!thinking) return false;
  if (thinking.phase === 'error') return false;
  if (hasAssistantText) return false;
  return true;
}
