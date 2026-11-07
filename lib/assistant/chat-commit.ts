/**
 * S9.2：ChatCommitExecutor — 可插拔 handler 注册表。
 * 按 commit_* 分发到各 repository；新增域只注册 handler，不改 Runtime / 主流程。
 * 真实业务 handler 在 S9.3 按对照表接入；本模块不写死三域。
 */

import { FORBIDDEN_CONFIRM_ACTIONS } from '@/lib/assistant/action-card';
import type { WriteSyncStatus } from '@/lib/assistant/write-operation';

export type ChatCommitHandlerInput = {
  confirm_action: string;
  operation_id: string;
  idempotency_key: string;
  draft: Record<string, unknown>;
  domain?: string;
};

export type ChatCommitHandlerResult = {
  ok: boolean;
  entity_id?: string;
  /** 本地成功后的同步透出；默认 pending */
  sync_status?: WriteSyncStatus;
  message?: string;
  error?: { code: string; message: string };
};

export type ChatCommitHandler = (
  input: ChatCommitHandlerInput,
) => Promise<ChatCommitHandlerResult>;

export type ChatCommitExecuteResult = ChatCommitHandlerResult & {
  confirm_action: string;
  operation_id: string;
  /** true = 本次真正调用了 handler；false = 命中幂等缓存或拒绝 */
  executed: boolean;
  /** 命中会话级幂等缓存 */
  from_journal?: boolean;
};

type JournalEntry = {
  key: string;
  result: ChatCommitHandlerResult;
  at: number;
};

const FORBIDDEN_SET = new Set<string>(FORBIDDEN_CONFIRM_ACTIONS as readonly string[]);

export class ChatCommitExecutor {
  private readonly handlers = new Map<string, ChatCommitHandler>();
  /** 会话级幂等：同 idempotency_key 返回首次结果，禁止双写 */
  private readonly journal = new Map<string, JournalEntry>();

  register(confirmAction: string, handler: ChatCommitHandler): void {
    const action = confirmAction.trim();
    if (!action) throw new Error('confirm_action 不能为空');
    if (FORBIDDEN_SET.has(action)) {
      throw new Error(`禁止注册红线动作: ${action}`);
    }
    if (!action.startsWith('commit_') && action !== 'frog_assign') {
      throw new Error(`仅允许注册 commit_* 或 frog_assign，收到: ${action}`);
    }
    this.handlers.set(action, handler);
  }

  unregister(confirmAction: string): void {
    this.handlers.delete(confirmAction.trim());
  }

  clearHandlers(): void {
    this.handlers.clear();
  }

  clearJournal(): void {
    this.journal.clear();
  }

  has(confirmAction: string): boolean {
    return this.handlers.has(confirmAction.trim());
  }

  listRegisteredActions(): string[] {
    return [...this.handlers.keys()].sort();
  }

  /** 供 CLIENT_CAPABILITIES 递增上报 */
  listClientCapabilities(): string[] {
    return this.listRegisteredActions();
  }

  getJournalResult(idempotencyKey: string): ChatCommitHandlerResult | undefined {
    return this.journal.get(idempotencyKey)?.result;
  }

  async execute(input: ChatCommitHandlerInput): Promise<ChatCommitExecuteResult> {
    const confirm_action = input.confirm_action.trim();
    const operation_id = input.operation_id.trim() || input.idempotency_key;
    const idempotency_key = (input.idempotency_key || operation_id).trim();

    if (!confirm_action) {
      return {
        ok: false,
        confirm_action,
        operation_id,
        executed: false,
        error: { code: 'missing_action', message: '缺少 confirm_action' },
      };
    }
    if (FORBIDDEN_SET.has(confirm_action)) {
      return {
        ok: false,
        confirm_action,
        operation_id,
        executed: false,
        error: { code: 'forbidden', message: '该操作不能由助手执行' },
      };
    }

    const cached = this.journal.get(idempotency_key);
    if (cached?.result.ok) {
      return {
        ...cached.result,
        confirm_action,
        operation_id,
        executed: false,
        from_journal: true,
      };
    }

    const handler = this.handlers.get(confirm_action);
    if (!handler) {
      return {
        ok: false,
        confirm_action,
        operation_id,
        executed: false,
        error: {
          code: 'handler_missing',
          message: `尚未注册写入能力：${confirm_action}`,
        },
      };
    }

    let result: ChatCommitHandlerResult;
    try {
      result = await handler({
        confirm_action,
        operation_id,
        idempotency_key,
        draft: { ...input.draft },
        domain: input.domain,
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result = {
        ok: false,
        error: { code: 'handler_throw', message: message || '写入失败' },
      };
    }

    if (result.ok) {
      const normalized: ChatCommitHandlerResult = {
        ok: true,
        entity_id: result.entity_id,
        sync_status: result.sync_status ?? 'pending',
        message: result.message,
      };
      this.journal.set(idempotency_key, {
        key: idempotency_key,
        result: normalized,
        at: Date.now(),
      });
      return {
        ...normalized,
        confirm_action,
        operation_id,
        executed: true,
      };
    }

    return {
      ok: false,
      confirm_action,
      operation_id,
      executed: true,
      error: result.error ?? { code: 'commit_failed', message: '写入失败' },
      message: result.message,
    };
  }
}

/** App 全局 executor；S9.3 由 chat-commit-handlers 注册真实 repository handler */
export const globalChatCommitExecutor = new ChatCommitExecutor();

/**
 * 基线 CLIENT_CAPABILITIES（S8 preview_*）+ 已注册 commit_*。
 * handler 上线即递增上报，未注册的 commit 不暴露给 Agent。
 */
export const BASE_CLIENT_CAPABILITIES = [
  'open_module',
  'preview_finance_txn',
  'preview_finance_transfer',
  'preview_finance_scheduled',
  'preview_finance_cash_flow',
  'preview_finance_budget',
  'preview_task',
  'preview_food_intake',
  'preview_habit',
  'preview_memo',
  'preview_recipe',
  'preview_wardrobe_item',
  'preview_wish',
  'preview_profile',
] as const;

export function buildClientCapabilities(
  executor: ChatCommitExecutor = globalChatCommitExecutor,
): string[] {
  const set = new Set<string>([...BASE_CLIENT_CAPABILITIES, ...executor.listClientCapabilities()]);
  return [...set];
}
