/**
 * S9.2：写操作结果回灌。
 * 方案 A：客户端插入结果气泡（默认）。
 * 方案 B：预留 execution_result 载荷，供下轮 /agent/chat metadata 回灌。
 */

import type { ChatMessage } from '@/lib/assistant/chat-types';
import type {
  WriteOperationError,
  WriteOperationResult,
  WriteOperationState,
} from '@/lib/assistant/write-operation';

export type ExecutionResultPayload = {
  operation_id: string;
  capability_hint?: string;
  confirm_action?: string;
  ok: boolean;
  entity_id?: string;
  summary?: string;
  sync_status?: string;
  error_code?: string;
  error_message?: string;
};

/** S9.6：sync_status → 用户可见短文案（气泡 / ConfirmCard 共用） */
export function formatSyncStatusLabel(syncStatus?: string | null): string {
  if (syncStatus === 'sync_failed' || syncStatus === 'failed') {
    return '本地已保存，同步待重试。';
  }
  if (syncStatus === 'synced') return '已保存并同步。';
  if (syncStatus === 'pending' || syncStatus === 'pending_push' || syncStatus === 'pending_pull') {
    return '已保存（同步进行中）。';
  }
  return '已保存。';
}

export function formatCommitResultBubble(input: {
  status: WriteOperationState;
  title?: string;
  result?: WriteOperationResult;
  error?: WriteOperationError;
}): string {
  if (input.status === 'succeeded') {
    const sync = formatSyncStatusLabel(input.result?.sync_status);
    const custom = input.result?.message?.trim();
    if (custom) {
      if (/同步/.test(custom)) return custom;
      return `${custom}${custom.endsWith('。') ? '' : '。'}${sync}`;
    }
    const id = input.result?.entity_id ? `（${input.result.entity_id}）` : '';
    const title = input.title?.trim();
    return title ? `已成功保存「${title}」${id}。${sync}` : `已成功保存${id}。${sync}`;
  }
  if (input.status === 'failed') {
    const msg = input.error?.message?.trim() || '写入失败';
    return `未能保存：${msg}`;
  }
  if (input.status === 'cancelled') {
    return '已取消，未写入任何数据。';
  }
  return '';
}

/** 方案 A：构造助手结果气泡消息（不调用模型） */
export function createCommitResultMessage(input: {
  id: string;
  status: 'succeeded' | 'failed' | 'cancelled';
  title?: string;
  result?: WriteOperationResult;
  error?: WriteOperationError;
  createdAt?: number;
}): ChatMessage {
  const text = formatCommitResultBubble(input);
  return {
    id: input.id,
    role: 'assistant',
    parts: [{ type: 'text', text: text || '操作已结束。' }],
    createdAt: input.createdAt ?? Date.now(),
    status: 'done',
  };
}

/** 方案 B：预留 execution_result，挂到下轮 chat metadata */
export function buildExecutionResultPayload(input: {
  operation_id: string;
  confirm_action?: string;
  capability_hint?: string;
  ok: boolean;
  entity_id?: string;
  summary?: string;
  sync_status?: string;
  error?: WriteOperationError;
}): ExecutionResultPayload {
  return {
    operation_id: input.operation_id,
    confirm_action: input.confirm_action,
    capability_hint: input.capability_hint,
    ok: input.ok,
    entity_id: input.entity_id,
    summary: input.summary,
    sync_status: input.sync_status,
    error_code: input.error?.code,
    error_message: input.error?.message,
  };
}

/** 待下轮随请求上报的 execution_results 队列（方案 B 预留） */
const pendingExecutionResults: ExecutionResultPayload[] = [];

export function enqueueExecutionResult(payload: ExecutionResultPayload): void {
  pendingExecutionResults.push(payload);
  if (pendingExecutionResults.length > 20) {
    pendingExecutionResults.splice(0, pendingExecutionResults.length - 20);
  }
}

export function drainExecutionResults(): ExecutionResultPayload[] {
  const out = [...pendingExecutionResults];
  pendingExecutionResults.length = 0;
  return out;
}

export function peekExecutionResults(): ExecutionResultPayload[] {
  return [...pendingExecutionResults];
}

export function clearExecutionResults(): void {
  pendingExecutionResults.length = 0;
}
