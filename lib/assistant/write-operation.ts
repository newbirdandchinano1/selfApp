/**
 * S9.2：聊天写操作状态机与会话级 store。
 * drafted → awaiting_confirmation → committing → succeeded|failed|cancelled
 * S9.7：分域字段模板见 confirm-card-fields.ts（deriveDraftFields 接入）
 */

import {
  COMMON_FIELD_LABELS,
  readDraftScalar,
  resolveFieldTemplate,
} from '@/lib/assistant/confirm-card-fields';

export type WriteOperationState =
  | 'drafted'
  | 'awaiting_confirmation'
  | 'committing'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export type WriteSyncStatus =
  | 'synced'
  | 'pending'
  | 'pending_push'
  | 'pending_pull'
  | 'sync_failed'
  | 'failed';

export type DraftField = {
  key: string;
  label: string;
  value: string;
  editable?: boolean;
};

export type WriteOperationResult = {
  entity_id?: string;
  message?: string;
  sync_status?: WriteSyncStatus;
};

export type WriteOperationError = {
  code: string;
  message: string;
};

export type WriteOperationRecord = {
  operation_id: string;
  confirm_action: string;
  domain?: string;
  status: WriteOperationState;
  draft: Record<string, unknown>;
  draft_fields?: DraftField[];
  idempotency_key: string;
  result?: WriteOperationResult;
  error?: WriteOperationError;
  /** 防重复确认：committing 期间忽略新请求 */
  commitStartedAt?: number;
  updatedAt: number;
};

/** S9.6：committing 超过此时长视为卡住，进入超时核实 */
export const COMMIT_STALE_MS = 45_000;

const TERMINAL: ReadonlySet<WriteOperationState> = new Set([
  'succeeded',
  'failed',
  'cancelled',
]);

const ALLOWED: Record<WriteOperationState, ReadonlySet<WriteOperationState>> = {
  drafted: new Set(['awaiting_confirmation', 'cancelled']),
  awaiting_confirmation: new Set(['awaiting_confirmation', 'committing', 'cancelled']),
  committing: new Set(['succeeded', 'failed']),
  succeeded: new Set(),
  failed: new Set(['committing', 'cancelled']),
  cancelled: new Set(),
};

export function canTransitionWriteStatus(
  from: WriteOperationState,
  to: WriteOperationState,
): boolean {
  if (from === to) return true;
  return ALLOWED[from]?.has(to) === true;
}

export function isTerminalWriteStatus(status: WriteOperationState): boolean {
  return TERMINAL.has(status);
}

export function isCommitConfirmAction(action: string | undefined | null): boolean {
  if (!action) return false;
  return action.startsWith('commit_');
}

export type DeriveDraftFieldsOptions = {
  confirmAction?: string | null;
  domain?: string | null;
};

/** 从 draft 推导展示字段；优先 preferred，否则按分域模板 / 通用中文标签 */
export function deriveDraftFields(
  draft: Record<string, unknown> | undefined,
  preferred?: DraftField[],
  options?: DeriveDraftFieldsOptions | string | null,
): DraftField[] {
  const opts: DeriveDraftFieldsOptions =
    typeof options === 'string' || options == null
      ? { confirmAction: options }
      : options;

  if (preferred?.length) {
    return preferred.map(f => ({
      key: f.key,
      label:
        f.label && f.label !== f.key
          ? f.label
          : COMMON_FIELD_LABELS[f.key] || f.label || f.key,
      value: String(f.value ?? ''),
      editable: f.editable === true,
    }));
  }
  if (!draft) return [];

  const template = resolveFieldTemplate(opts.confirmAction, opts.domain);
  if (template?.length) {
    const out: DraftField[] = [];
    const seen = new Set<string>();
    for (const spec of template) {
      const hit = readDraftScalar(draft, spec.key, spec.aliases);
      if (!hit) continue;
      if (seen.has(spec.key) || seen.has(hit.key)) continue;
      out.push({
        key: spec.key,
        label: spec.label,
        value: hit.value,
        editable: spec.editable === true,
      });
      seen.add(spec.key);
      seen.add(hit.key);
    }
    // 模板未覆盖但 draft 有值的标量：只读追加，最多补到 8
    for (const [key, v] of Object.entries(draft)) {
      if (seen.has(key)) continue;
      if (v == null || v === '') continue;
      if (typeof v === 'object') continue;
      if (out.length >= 8) break;
      out.push({
        key,
        label: COMMON_FIELD_LABELS[key] || key,
        value: String(v),
        editable: false,
      });
      seen.add(key);
    }
    return out;
  }

  const out: DraftField[] = [];
  const preferKeys = [
    'name',
    'title',
    'amount',
    'category_label',
    'account_name',
    'payment_account_label',
    'food_summary',
    'food_name',
    'note',
    'body',
    'due_ymd',
    'transaction_type',
  ];
  const seen = new Set<string>();
  for (const key of preferKeys) {
    if (!(key in draft)) continue;
    const v = draft[key];
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    out.push({
      key,
      label: COMMON_FIELD_LABELS[key] || key,
      value: String(v),
      editable: true,
    });
    seen.add(key);
  }
  for (const [key, v] of Object.entries(draft)) {
    if (seen.has(key)) continue;
    if (v == null || v === '') continue;
    if (typeof v === 'object') continue;
    if (out.length >= 8) break;
    out.push({
      key,
      label: COMMON_FIELD_LABELS[key] || key,
      value: String(v),
      editable: false,
    });
  }
  return out;
}

export function applyDraftFieldPatches(
  draft: Record<string, unknown>,
  patches: Array<{ key: string; value: string }>,
): Record<string, unknown> {
  const next = { ...draft };
  for (const p of patches) {
    const key = p.key.trim();
    if (!key) continue;
    const raw = p.value;
    const asNum = Number(raw);
    if (raw.trim() !== '' && Number.isFinite(asNum) && /^-?\d+(\.\d+)?$/.test(raw.trim())) {
      next[key] = asNum;
    } else {
      next[key] = raw;
    }
  }
  return next;
}

type StoreListener = (op: WriteOperationRecord) => void;

/**
 * 会话级写操作 store（内存）。幂等键相同的成功结果可复用，避免双写。
 */
export class WriteOperationStore {
  private readonly byId = new Map<string, WriteOperationRecord>();
  private readonly listeners = new Set<StoreListener>();

  subscribe(listener: StoreListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(op: WriteOperationRecord): void {
    for (const l of this.listeners) l(op);
  }

  get(operationId: string): WriteOperationRecord | undefined {
    return this.byId.get(operationId);
  }

  list(): WriteOperationRecord[] {
    return [...this.byId.values()];
  }

  clear(): void {
    this.byId.clear();
  }

  upsertFromCard(input: {
    operation_id: string;
    confirm_action: string;
    domain?: string;
    draft?: Record<string, unknown>;
    draft_fields?: DraftField[];
    idempotency_key?: string;
    write_status?: WriteOperationState;
  }): WriteOperationRecord {
    const existing = this.byId.get(input.operation_id);
    if (existing && isTerminalWriteStatus(existing.status) && existing.status === 'succeeded') {
      return existing;
    }
    // S9.6：卡上仍是 awaiting 时，不得把进行中的 committing 覆盖掉（超时核实依赖此状态）
    if (
      existing?.status === 'committing' &&
      input.write_status !== 'succeeded' &&
      input.write_status !== 'failed' &&
      input.write_status !== 'committing'
    ) {
      const draft = { ...(existing.draft ?? {}), ...(input.draft ?? {}) };
      const record: WriteOperationRecord = {
        ...existing,
        confirm_action: input.confirm_action || existing.confirm_action,
        domain: input.domain ?? existing.domain,
        draft,
        draft_fields: deriveDraftFields(draft, input.draft_fields ?? existing.draft_fields, {
          confirmAction: input.confirm_action || existing.confirm_action,
          domain: input.domain ?? existing.domain,
        }),
        idempotency_key:
          input.idempotency_key || existing.idempotency_key || input.operation_id,
        updatedAt: Date.now(),
      };
      this.byId.set(record.operation_id, record);
      this.emit(record);
      return record;
    }
    const draft = { ...(input.draft ?? existing?.draft ?? {}) };
    const status =
      input.write_status ??
      existing?.status ??
      ('awaiting_confirmation' as WriteOperationState);
    const confirmAction = input.confirm_action || existing?.confirm_action;
    const domain = input.domain ?? existing?.domain;
    const record: WriteOperationRecord = {
      operation_id: input.operation_id,
      confirm_action: input.confirm_action,
      domain,
      status,
      draft,
      draft_fields: deriveDraftFields(draft, input.draft_fields ?? existing?.draft_fields, {
        confirmAction,
        domain,
      }),
      idempotency_key: input.idempotency_key || existing?.idempotency_key || input.operation_id,
      result: existing?.result,
      error: existing?.status === status ? existing.error : undefined,
      commitStartedAt: existing?.commitStartedAt,
      updatedAt: Date.now(),
    };
    this.byId.set(record.operation_id, record);
    this.emit(record);
    return record;
  }

  patchDraft(
    operationId: string,
    patches: Array<{ key: string; value: string }>,
  ): WriteOperationRecord | null {
    const cur = this.byId.get(operationId);
    if (!cur) return null;
    if (cur.status !== 'awaiting_confirmation' && cur.status !== 'drafted' && cur.status !== 'failed') {
      return cur;
    }
    const draft = applyDraftFieldPatches(cur.draft, patches);
    const next: WriteOperationRecord = {
      ...cur,
      status: 'awaiting_confirmation',
      draft,
      draft_fields: deriveDraftFields(
        draft,
        cur.draft_fields?.map(f => {
          const hit = patches.find(p => p.key === f.key);
          return hit ? { ...f, value: hit.value } : f;
        }),
        { confirmAction: cur.confirm_action, domain: cur.domain },
      ),
      error: undefined,
      updatedAt: Date.now(),
    };
    this.byId.set(operationId, next);
    this.emit(next);
    return next;
  }

  /**
   * 尝试进入 committing。若已在 committing / 已成功，返回 { started:false, record }。
   * 调用方据此跳过二次执行（幂等）。
   */
  beginCommit(operationId: string): { started: boolean; record: WriteOperationRecord | null } {
    const cur = this.byId.get(operationId);
    if (!cur) return { started: false, record: null };
    if (cur.status === 'succeeded') {
      return { started: false, record: cur };
    }
    if (cur.status === 'committing') {
      return { started: false, record: cur };
    }
    if (!canTransitionWriteStatus(cur.status, 'committing')) {
      return { started: false, record: cur };
    }
    const next: WriteOperationRecord = {
      ...cur,
      status: 'committing',
      commitStartedAt: Date.now(),
      error: undefined,
      updatedAt: Date.now(),
    };
    this.byId.set(operationId, next);
    this.emit(next);
    return { started: true, record: next };
  }

  markSucceeded(operationId: string, result: WriteOperationResult): WriteOperationRecord | null {
    const cur = this.byId.get(operationId);
    if (!cur) return null;
    const next: WriteOperationRecord = {
      ...cur,
      status: 'succeeded',
      result: {
        entity_id: result.entity_id,
        message: result.message,
        sync_status: result.sync_status,
      },
      error: undefined,
      updatedAt: Date.now(),
    };
    this.byId.set(operationId, next);
    this.emit(next);
    return next;
  }

  markFailed(operationId: string, error: WriteOperationError): WriteOperationRecord | null {
    const cur = this.byId.get(operationId);
    if (!cur) return null;
    const next: WriteOperationRecord = {
      ...cur,
      status: 'failed',
      error,
      updatedAt: Date.now(),
    };
    this.byId.set(operationId, next);
    this.emit(next);
    return next;
  }

  markCancelled(operationId: string): WriteOperationRecord | null {
    const cur = this.byId.get(operationId);
    if (!cur) return null;
    if (cur.status === 'committing' || cur.status === 'succeeded') return cur;
    if (!canTransitionWriteStatus(cur.status, 'cancelled')) return cur;
    const next: WriteOperationRecord = {
      ...cur,
      status: 'cancelled',
      updatedAt: Date.now(),
    };
    this.byId.set(operationId, next);
    this.emit(next);
    return next;
  }

  /**
   * S9.6：卡住的 committing 超时核实。
   * - 若 journal 已有成功结果 → 迁到 succeeded（禁止盲目再 create）
   * - 否则 → failed(commit_timeout)，允许用户点「重试」
   * - 未超时则原样返回
   */
  recoverStaleCommit(
    operationId: string,
    opts?: {
      now?: number;
      staleMs?: number;
      journalSuccess?: WriteOperationResult | null;
    },
  ): WriteOperationRecord | null {
    const cur = this.byId.get(operationId);
    if (!cur) return null;
    if (cur.status !== 'committing') return cur;
    const now = opts?.now ?? Date.now();
    const staleMs = opts?.staleMs ?? COMMIT_STALE_MS;
    const started = cur.commitStartedAt ?? cur.updatedAt;
    if (now - started < staleMs) return cur;

    if (opts?.journalSuccess?.entity_id || opts?.journalSuccess?.message) {
      return this.markSucceeded(operationId, {
        entity_id: opts.journalSuccess.entity_id,
        message: opts.journalSuccess.message || '已保存（超时后核实）',
        sync_status: opts.journalSuccess.sync_status ?? 'pending',
      });
    }
    return this.markFailed(operationId, {
      code: 'commit_timeout',
      message: '保存超时，未确认是否写入成功。请先核对列表后再重试，避免重复创建。',
    });
  }

  isCommitStale(operationId: string, opts?: { now?: number; staleMs?: number }): boolean {
    const cur = this.byId.get(operationId);
    if (!cur || cur.status !== 'committing') return false;
    const now = opts?.now ?? Date.now();
    const staleMs = opts?.staleMs ?? COMMIT_STALE_MS;
    const started = cur.commitStartedAt ?? cur.updatedAt;
    return now - started >= staleMs;
  }
}

/** 默认单例：当前聊天页共用 */
export const globalWriteOperationStore = new WriteOperationStore();
