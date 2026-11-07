/**
 * S9.2：聊天页写操作编排 — Store 状态机 + ChatCommitExecutor + 结果气泡。
 * preview_* 仍走 confirm-execute；本模块只处理 commit_*。
 */

import type { ActionCard } from '@/lib/assistant/action-card';
import {
  globalChatCommitExecutor,
  type ChatCommitExecutor,
  type ChatCommitExecuteResult,
} from '@/lib/assistant/chat-commit';
import { ensureChatCommitHandlersRegistered } from '@/lib/assistant/chat-commit-handlers';
import {
  buildExecutionResultPayload,
  createCommitResultMessage,
  enqueueExecutionResult,
} from '@/lib/assistant/commit-result';
import type { ChatMessage, ChatSession } from '@/lib/assistant/chat-types';
import {
  deriveDraftFields,
  globalWriteOperationStore,
  isCommitConfirmAction,
  type WriteOperationRecord,
  type WriteOperationStore,
} from '@/lib/assistant/write-operation';

function makeMsgId(): string {
  return `cm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function resolveCommitAction(card: ActionCard): string | null {
  const explicit = card.commit_action?.trim();
  if (explicit && isCommitConfirmAction(explicit)) return explicit;
  const action = card.confirm_action?.trim();
  if (action && isCommitConfirmAction(action)) return action;
  return null;
}

export function resolveOperationId(card: ActionCard): string {
  return (card.operation_id || card.idempotency_key || card.id).trim();
}

/** 将 ActionCard 投影为带写状态的卡（用于刷新会话消息） */
export function cardFromWriteRecord(card: ActionCard, op: WriteOperationRecord): ActionCard {
  return {
    ...card,
    operation_id: op.operation_id,
    confirm_action: (op.confirm_action || card.confirm_action) as ActionCard['confirm_action'],
    commit_action: isCommitConfirmAction(op.confirm_action)
      ? (op.confirm_action as ActionCard['commit_action'])
      : card.commit_action,
    draft: { ...op.draft },
    draft_fields:
      op.draft_fields ??
      deriveDraftFields(op.draft, card.draft_fields, {
        confirmAction: op.confirm_action || card.confirm_action,
        domain: op.domain || card.domain,
      }),
    write_status: op.status,
    result: op.result,
    error: op.error,
    idempotency_key: op.idempotency_key,
    needs_confirm: op.status === 'awaiting_confirmation' || op.status === 'failed',
  };
}

export function patchCardInSession(
  session: ChatSession,
  operationId: string,
  patch: (card: ActionCard) => ActionCard,
): ChatSession {
  const messages = session.messages.map(m => {
    let changed = false;
    const parts = m.parts.map(p => {
      if (p.type !== 'action_card') return p;
      const oid = resolveOperationId(p.card);
      if (oid !== operationId && p.card.id !== operationId) return p;
      changed = true;
      return { ...p, card: patch(p.card) };
    });
    return changed ? { ...m, parts } : m;
  });
  return { ...session, messages, updatedAt: Date.now() };
}

export type CommitConfirmOutcome = {
  session: ChatSession;
  op: WriteOperationRecord | null;
  executeResult?: ChatCommitExecuteResult;
  /** 是否因重复点击 / 已成功而跳过 handler */
  skipped: boolean;
};

/**
 * 用户点确认：进入 committing → executor → succeeded/failed → 结果气泡。
 * 重复点击在 committing/succeeded 时安全跳过（不双写）。
 */
export async function confirmChatCommit(opts: {
  session: ChatSession;
  card: ActionCard;
  store?: WriteOperationStore;
  executor?: ChatCommitExecutor;
}): Promise<CommitConfirmOutcome> {
  const store = opts.store ?? globalWriteOperationStore;
  const executor = opts.executor ?? globalChatCommitExecutor;
  ensureChatCommitHandlersRegistered(executor);
  const action = resolveCommitAction(opts.card);
  if (!action) {
    return { session: opts.session, op: null, skipped: true };
  }

  const operation_id = resolveOperationId(opts.card);
  const idempotency_key = opts.card.idempotency_key || operation_id;
  const op0 = store.upsertFromCard({
    operation_id,
    confirm_action: action,
    domain: opts.card.domain,
    draft: opts.card.draft,
    draft_fields: opts.card.draft_fields,
    idempotency_key,
    write_status: opts.card.write_status ?? 'awaiting_confirmation',
  });

  // S9.6：若卡在 committing 且已超时 → 先查 journal，禁止盲目再 create
  const existing = store.get(operation_id);
  if (existing?.status === 'committing' && store.isCommitStale(operation_id)) {
    const journal = executor.getJournalResult(idempotency_key);
    const recovered = store.recoverStaleCommit(operation_id, {
      journalSuccess: journal?.ok
        ? {
            entity_id: journal.entity_id,
            message: journal.message,
            sync_status: journal.sync_status,
          }
        : null,
    });
    if (recovered?.status === 'succeeded') {
      let session = patchCardInSession(opts.session, operation_id, c =>
        cardFromWriteRecord(c, recovered),
      );
      return { session, op: recovered, skipped: true };
    }
    // 超时且无 journal → 已迁 failed，下面 beginCommit 允许 failed→committing 重试
  }

  const begin = store.beginCommit(operation_id);
  if (!begin.started) {
    // 已在 committing（未超时）或已成功：同步卡状态；不二次执行
    let session = opts.session;
    if (begin.record) {
      session = patchCardInSession(session, operation_id, c =>
        cardFromWriteRecord(c, begin.record!),
      );
      // 已成功时若尚未有结果气泡也不强插（避免重复）；幂等由 journal 保证
    }
    return { session, op: begin.record, skipped: true };
  }

  let session = patchCardInSession(opts.session, operation_id, c =>
    cardFromWriteRecord(c, begin.record!),
  );

  const executeResult = await executor.execute({
    confirm_action: action,
    operation_id,
    idempotency_key: op0.idempotency_key,
    draft: begin.record!.draft,
    domain: opts.card.domain,
  });

  if (executeResult.ok) {
    const op = store.markSucceeded(operation_id, {
      entity_id: executeResult.entity_id,
      message: executeResult.message,
      sync_status: executeResult.sync_status ?? 'pending',
    })!;
    session = patchCardInSession(session, operation_id, c => cardFromWriteRecord(c, op));
    const bubble = createCommitResultMessage({
      id: makeMsgId(),
      status: 'succeeded',
      title: opts.card.title,
      result: op.result,
    });
    session = {
      ...session,
      messages: [...session.messages, bubble],
      updatedAt: Date.now(),
    };
    enqueueExecutionResult(
      buildExecutionResultPayload({
        operation_id,
        confirm_action: action,
        ok: true,
        entity_id: op.result?.entity_id,
        summary: op.result?.message || opts.card.title,
        sync_status: op.result?.sync_status,
      }),
    );
    return { session, op, executeResult, skipped: false };
  }

  const op = store.markFailed(operation_id, {
    code: executeResult.error?.code || 'commit_failed',
    message: executeResult.error?.message || '写入失败',
  })!;
  session = patchCardInSession(session, operation_id, c => cardFromWriteRecord(c, op));
  const bubble = createCommitResultMessage({
    id: makeMsgId(),
    status: 'failed',
    title: opts.card.title,
    error: op.error,
  });
  session = {
    ...session,
    messages: [...session.messages, bubble],
    updatedAt: Date.now(),
  };
  enqueueExecutionResult(
    buildExecutionResultPayload({
      operation_id,
      confirm_action: action,
      ok: false,
      error: op.error,
    }),
  );
  return { session, op, executeResult, skipped: false };
}

export function cancelChatCommit(opts: {
  session: ChatSession;
  card: ActionCard;
  store?: WriteOperationStore;
}): { session: ChatSession; op: WriteOperationRecord | null } {
  const store = opts.store ?? globalWriteOperationStore;
  const action = resolveCommitAction(opts.card);
  const operation_id = resolveOperationId(opts.card);
  if (action) {
    store.upsertFromCard({
      operation_id,
      confirm_action: action,
      domain: opts.card.domain,
      draft: opts.card.draft,
      draft_fields: opts.card.draft_fields,
      idempotency_key: opts.card.idempotency_key || operation_id,
      write_status: opts.card.write_status ?? 'awaiting_confirmation',
    });
  }
  const op = store.markCancelled(operation_id);
  if (!op) return { session: opts.session, op: null };
  let session = patchCardInSession(opts.session, operation_id, c => cardFromWriteRecord(c, op));
  const bubble = createCommitResultMessage({
    id: makeMsgId(),
    status: 'cancelled',
    title: opts.card.title,
  });
  session = {
    ...session,
    messages: [...session.messages, bubble],
    updatedAt: Date.now(),
  };
  return { session, op };
}

export function patchChatCommitDraft(opts: {
  session: ChatSession;
  card: ActionCard;
  patches: Array<{ key: string; value: string }>;
  store?: WriteOperationStore;
}): { session: ChatSession; op: WriteOperationRecord | null } {
  const store = opts.store ?? globalWriteOperationStore;
  const action = resolveCommitAction(opts.card);
  const operation_id = resolveOperationId(opts.card);
  if (action) {
    store.upsertFromCard({
      operation_id,
      confirm_action: action,
      domain: opts.card.domain,
      draft: opts.card.draft,
      draft_fields: opts.card.draft_fields,
      idempotency_key: opts.card.idempotency_key || operation_id,
      write_status: 'awaiting_confirmation',
    });
  }
  const op = store.patchDraft(operation_id, opts.patches);
  if (!op) return { session: opts.session, op: null };
  const session = patchCardInSession(opts.session, operation_id, c => cardFromWriteRecord(c, op));
  return { session, op };
}

/** 会话出现 commit 卡时登记到 store（展示 awaiting） */
export function trackCommitCardsInMessages(
  messages: ChatMessage[],
  store: WriteOperationStore = globalWriteOperationStore,
): void {
  for (const m of messages) {
    for (const p of m.parts) {
      if (p.type !== 'action_card') continue;
      const action = resolveCommitAction(p.card);
      if (!action) continue;
      const operation_id = resolveOperationId(p.card);
      if (store.get(operation_id)?.status === 'succeeded') continue;
      store.upsertFromCard({
        operation_id,
        confirm_action: action,
        domain: p.card.domain,
        draft: p.card.draft,
        draft_fields: p.card.draft_fields,
        idempotency_key: p.card.idempotency_key || operation_id,
        write_status: p.card.write_status ?? 'awaiting_confirmation',
      });
    }
  }
}
