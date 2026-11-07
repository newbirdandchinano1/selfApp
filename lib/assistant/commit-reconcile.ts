/**
 * S9.6：多轮草稿调和 — 同 operation_id 改稿不双建；「再记一笔」开新卡。
 */

import type { ActionCard } from '@/lib/assistant/action-card';
import { resolveCommitAction, resolveOperationId } from '@/lib/assistant/chat-commit-controller';
import type { ChatMessage, ChatSession } from '@/lib/assistant/chat-types';
import { isCommitConfirmAction } from '@/lib/assistant/write-operation';

const OPEN_STATUSES = new Set([
  'drafted',
  'awaiting_confirmation',
  'failed',
  undefined,
  null,
  '',
]);

export function looksLikeDraftAmendment(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return /(改成|改为|更新为|改一下|金额改成|改成\s*[¥￥]?\s*\d|(把|将).{0,12}(改成|改为))/.test(
    t,
  );
}

export function looksLikeNewSiblingWrite(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return /(再记一笔|另外记|另记一笔|再帮我记|再加一笔|再来一笔|再记一)/.test(t);
}

export type PendingOperationSummary = {
  operation_id: string;
  domain?: string;
  confirm_action?: string;
  title?: string;
  draft?: Record<string, unknown>;
};

/** 会话内未确认 commit 卡 → 供 metadata.pending_operations */
export function collectPendingOperations(session: ChatSession | null | undefined): PendingOperationSummary[] {
  if (!session) return [];
  const out: PendingOperationSummary[] = [];
  const seen = new Set<string>();
  for (const m of session.messages) {
    for (const p of m.parts) {
      if (p.type !== 'action_card') continue;
      const card = p.card;
      const action = resolveCommitAction(card);
      if (!action) continue;
      const status = card.write_status;
      if (status && !OPEN_STATUSES.has(status)) continue;
      const oid = resolveOperationId(card);
      if (!oid || seen.has(oid)) continue;
      seen.add(oid);
      out.push({
        operation_id: oid,
        domain: card.domain,
        confirm_action: action,
        title: card.title,
        draft: card.draft ? { ...card.draft } : undefined,
      });
      if (out.length >= 8) return out;
    }
  }
  return out;
}

function listOpenCommitCards(session: ChatSession): ActionCard[] {
  const out: ActionCard[] = [];
  const seen = new Set<string>();
  for (const m of session.messages) {
    for (const p of m.parts) {
      if (p.type !== 'action_card') continue;
      const card = p.card;
      if (!resolveCommitAction(card) && !isCommitConfirmAction(card.confirm_action)) continue;
      const status = card.write_status;
      if (status && !OPEN_STATUSES.has(status)) continue;
      const oid = resolveOperationId(card);
      if (seen.has(oid)) continue;
      seen.add(oid);
      out.push(card);
    }
  }
  return out;
}

function mergeDraft(
  base: Record<string, unknown> | undefined,
  patch: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(base || {}), ...(patch || {}) };
}

/**
 * 将本轮 Agent 返回的 commit 卡与会话未确认卡调和：
 * - 同 operation_id → 原地更新 draft，不追加第二张
 * - 「改成…」且同域仅一张未确认 → 强制复用该 operation_id
 * - 「再记一笔」→ 保留新卡新 id
 */
export function reconcileIncomingCommitCards(opts: {
  session: ChatSession;
  incoming: ActionCard[];
  userMessage?: string;
}): { session: ChatSession; cards: ActionCard[] } {
  const open = listOpenCommitCards(opts.session);
  const amend = looksLikeDraftAmendment(opts.userMessage || '');
  const sibling = looksLikeNewSiblingWrite(opts.userMessage || '');
  const reconciled: ActionCard[] = [];
  const mergeTargets = new Map<string, ActionCard>(); // operation_id → patched card

  for (const raw of opts.incoming) {
    const isCommit =
      Boolean(resolveCommitAction(raw)) || isCommitConfirmAction(raw.confirm_action);
    if (!isCommit) {
      reconciled.push(raw);
      continue;
    }

    let targetOid = resolveOperationId(raw);
    let matched = open.find(c => resolveOperationId(c) === targetOid);

    if (!matched && !sibling && amend) {
      const sameDomain = open.filter(c => c.domain === raw.domain);
      if (sameDomain.length === 1) {
        matched = sameDomain[0];
        targetOid = resolveOperationId(matched);
      } else if (open.length === 1 && (!raw.domain || open[0].domain === raw.domain || raw.domain === 'general')) {
        matched = open[0];
        targetOid = resolveOperationId(matched);
      }
    }

    if (matched && !sibling) {
      const merged: ActionCard = {
        ...matched,
        ...raw,
        id: matched.id,
        operation_id: targetOid,
        idempotency_key: matched.idempotency_key || targetOid,
        draft: mergeDraft(matched.draft, raw.draft),
        draft_fields: raw.draft_fields?.length ? raw.draft_fields : matched.draft_fields,
        write_status: 'awaiting_confirmation',
        needs_confirm: true,
        result: undefined,
        error: undefined,
        title: raw.title || matched.title,
        summary: raw.summary || matched.summary,
        confirm_action: raw.confirm_action || matched.confirm_action,
        commit_action: raw.commit_action || matched.commit_action,
      };
      mergeTargets.set(targetOid, merged);
      // 不放入 reconciled 作为「新卡」——由 session patch 体现
      continue;
    }

    // 新独立操作
    const oid = resolveOperationId(raw) || raw.id;
    reconciled.push({
      ...raw,
      operation_id: oid,
      idempotency_key: raw.idempotency_key || oid,
      write_status: raw.write_status ?? 'awaiting_confirmation',
    });
  }

  let session = opts.session;
  if (mergeTargets.size) {
    const messages: ChatMessage[] = session.messages.map(m => {
      let changed = false;
      const parts = m.parts.map(p => {
        if (p.type !== 'action_card') return p;
        const oid = resolveOperationId(p.card);
        const next = mergeTargets.get(oid);
        if (!next) return p;
        changed = true;
        return { ...p, card: next };
      });
      return changed ? { ...m, parts } : m;
    });
    session = { ...session, messages, updatedAt: Date.now() };
  }

  return { session, cards: reconciled };
}
