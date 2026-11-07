/**
 * S9.3 W2：commit_life_road_node / commit_life_direction（动态 import）。
 * 终态 arrive/drop 需明确字段；禁止无确认一键终态（对照表 C08）。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftNumber, draftString, fail, ok, requestPushPending } from './shared';

type NodeDraft = Record<string, unknown>;

function readAcceptanceTexts(draft: Record<string, unknown>): string[] {
  const raw = draft.acceptance_items ?? draft.acceptance ?? draft.items;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const row of raw.slice(0, 20)) {
    if (typeof row === 'string' && row.trim()) {
      out.push(row.trim().slice(0, 80));
      continue;
    }
    if (row && typeof row === 'object') {
      const t = String((row as { text?: unknown }).text ?? '').trim();
      if (t) out.push(t.slice(0, 80));
    }
  }
  return out;
}

function readNodeRows(draft: Record<string, unknown>): NodeDraft[] {
  const nodes = draft.nodes;
  if (Array.isArray(nodes)) {
    return nodes.filter((n): n is NodeDraft => !!n && typeof n === 'object');
  }
  // 单节点更新草稿
  if (
    draftString(draft, 'title') ||
    draftString(draft, 'node_id') ||
    draftString(draft, 'id') ||
    draft.acceptance_items != null
  ) {
    return [draft];
  }
  return [];
}

function asKind(raw: unknown): string | null {
  const s = String(raw ?? '').trim().toLowerCase();
  if (['multi', 'farther', 'year', 'quarter', 'month'].includes(s)) return s;
  if (s === '年' || s === '今年') return 'year';
  if (s === '季' || s === '季度') return 'quarter';
  if (s === '月' || s === '月份') return 'month';
  return null;
}

function asStatus(raw: unknown): string | undefined {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return undefined;
  if (s === 'on_track' || s === '在路上') return 'on_track';
  if (s === 'paused' || s === '暂搁') return 'paused';
  // 终态需显式允许字段；默认拒绝静默 arrive/drop
  if (s === 'arrived' || s === '抵达' || s === '已抵达') {
    return 'arrived';
  }
  if (s === 'dropped' || s === '放弃' || s === '已放弃') {
    return 'dropped';
  }
  return undefined;
}

async function mergeAcceptanceExtra(
  existingExtra: string | null | undefined,
  draft: Record<string, unknown>,
): Promise<string | null | undefined> {
  const texts = readAcceptanceTexts(draft);
  if (!texts.length) return undefined;
  const {
    createAcceptanceItem,
    writeAcceptanceCriteria,
    parseAcceptanceCriteria,
  } = await import('@/lib/life-road/life-road-acceptance');
  const prev = parseAcceptanceCriteria(existingExtra);
  const merged = [
    ...prev,
    ...texts.map(t => createAcceptanceItem(t)),
  ].slice(0, 20);
  return writeAcceptanceCriteria(existingExtra, merged);
}

export async function commitLifeRoadNode(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const rows = readNodeRows(draft);
  if (!rows.length) {
    return fail('incomplete_draft', '缺少道路节点草稿（标题或 nodes）');
  }

  // 终态门禁须在动态 import 之前（Node 单测不能拉 RN）
  for (const row of rows.slice(0, 24)) {
    const statusRaw = asStatus(row.status);
    const allowTerminal =
      row.allow_terminal === true ||
      draft.allow_terminal === true ||
      draftString(row, 'confirm_terminal') === 'yes';
    if ((statusRaw === 'arrived' || statusRaw === 'dropped') && !allowTerminal) {
      return fail(
        'terminal_needs_confirm',
        '抵达/放弃属于高成本终态，请在道路页内二次确认，或显式 allow_terminal',
      );
    }
  }

  const { createLifeRoadNode, updateLifeRoadNode, getLifeRoadNodeById } = await import(
    '@/lib/repositories/life-road/life-road-node'
  );

  const createdIds: string[] = [];
  const yearFallback =
    draftNumber(draft, 'calendar_year') ?? new Date().getFullYear();
  let updatedCount = 0;

  for (const row of rows.slice(0, 24)) {
    const nodeId =
      draftString(row, 'node_id') ||
      draftString(row, 'id') ||
      (rows.length === 1 ? draftString(draft, 'node_id') : '');
    const title = draftString(row, 'title') || draftString(row, 'name');
    const note = draftString(row, 'note') || draftString(row, 'description') || null;
    const kind = asKind(row.kind) || (nodeId ? null : 'year');
    const statusRaw = asStatus(row.status);
    const allowTerminal =
      row.allow_terminal === true ||
      draft.allow_terminal === true ||
      draftString(row, 'confirm_terminal') === 'yes';

    if (nodeId) {
      const existing = await getLifeRoadNodeById(nodeId, { serverFallback: true });
      if (!existing) {
        return fail('node_missing', `找不到道路节点 ${nodeId}`);
      }
      const extra = await mergeAcceptanceExtra(existing.extra_data, {
        ...draft,
        ...row,
      });
      const patch: Record<string, unknown> = {};
      if (title) patch.title = title.slice(0, 80);
      if (note !== null && note !== '') patch.note = note;
      if (statusRaw && statusRaw !== 'arrived' && statusRaw !== 'dropped') {
        patch.status = statusRaw;
      } else if (statusRaw && allowTerminal) {
        patch.status = statusRaw;
      }
      if (extra !== undefined) patch.extra_data = extra;
      if (Object.keys(patch).length === 0) {
        continue;
      }
      await updateLifeRoadNode(nodeId, patch as Parameters<typeof updateLifeRoadNode>[1]);
      updatedCount += 1;
      createdIds.push(nodeId);
      continue;
    }

    if (!title) continue;
    if (!kind) {
      return fail('incomplete_draft', `节点「${title}」缺少类型（year/quarter/month…）`);
    }

    const acceptanceExtra = await mergeAcceptanceExtra(null, { ...draft, ...row });
    const createStatus =
      statusRaw && (statusRaw === 'on_track' || statusRaw === 'paused')
        ? statusRaw
        : statusRaw && allowTerminal
          ? statusRaw
          : 'on_track';
    const created = await createLifeRoadNode({
      kind: kind as 'multi' | 'farther' | 'year' | 'quarter' | 'month',
      title: title.slice(0, 80),
      note,
      calendar_year:
        draftNumber(row, 'calendar_year') ??
        (kind === 'year' || kind === 'quarter' || kind === 'month'
          ? yearFallback
          : null),
      quarter: draftNumber(row, 'quarter'),
      month: draftNumber(row, 'month'),
      parent_id: draftString(row, 'parent_id') || null,
      status: createStatus as 'on_track' | 'paused' | 'arrived' | 'dropped',
      ...(acceptanceExtra ? { extra_data: acceptanceExtra } : {}),
    });
    createdIds.push(created.id);
  }

  // 同卡若带方向正文，一并落库（对照表 A 指向 commit_life_direction）
  const directionBody =
    draftString(draft, 'direction_body') || draftString(draft, 'body');
  if (directionBody) {
    await commitLifeDirection({
      body: directionBody,
      year_theme: draftString(draft, 'year_theme') || undefined,
    });
  }

  if (!createdIds.length && !directionBody) {
    return fail('incomplete_draft', '没有可写入的道路节点字段');
  }

  await requestPushPending();
  if (updatedCount && !createdIds.length) {
    return ok(createdIds[0] || 'life_road', `已更新 ${updatedCount} 个道路节点`);
  }
  const suffix = updatedCount ? `（含更新 ${updatedCount}）` : '';
  return ok(
    createdIds[0] || 'life_road',
    `已保存 ${createdIds.length || updatedCount} 个道路节点${suffix}`,
  );
}

export async function commitLifeDirection(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const body =
    draftString(draft, 'body') ||
    draftString(draft, 'direction_body') ||
    draftString(draft, 'direction');
  if (!body) {
    return fail('incomplete_draft', '缺少总方向正文');
  }

  const { upsertLifeDirection } = await import(
    '@/lib/repositories/life-road/life-direction'
  );
  const yearTheme = draftString(draft, 'year_theme') || undefined;
  const row = await upsertLifeDirection({
    body: body.slice(0, 200),
    ...(yearTheme ? { year_theme: yearTheme.slice(0, 40) } : {}),
    id: draftString(draft, 'direction_id') || draftString(draft, 'id') || undefined,
  });
  await requestPushPending();
  return ok(row.id, `已保存人生方向「${(yearTheme || body).slice(0, 40)}」`);
}

export async function commitLifeBet(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const title =
    draftString(draft, 'title') ||
    draftString(draft, 'name') ||
    draftString(draft, 'bet_title');
  if (!title) return fail('incomplete_draft', '缺少 bet 标题');

  const { createLifeBet, updateLifeBet } = await import(
    '@/lib/repositories/life-road/life-bet'
  );
  const existingId =
    draftString(draft, 'bet_id') || draftString(draft, 'id');
  const note =
    draftString(draft, 'note') ||
    draftString(draft, 'description') ||
    draftString(draft, 'stake') ||
    null;
  const yearRaw = draftNumber(draft, 'year');
  const horizonRaw = draftString(draft, 'horizon') || draftString(draft, 'bet_type') || 'year';
  const horizon =
    horizonRaw === 'multi' || horizonRaw === 'farther' ? horizonRaw : 'year';

  if (existingId) {
    const row = await updateLifeBet(existingId, {
      title: title.slice(0, 40),
      note,
      ...(yearRaw != null ? { year: Math.round(yearRaw) } : {}),
      horizon,
    });
    await requestPushPending();
    return ok(row.id, `已更新年度 bet「${title.slice(0, 40)}」`);
  }

  const row = await createLifeBet({
    title: title.slice(0, 40),
    horizon,
    year: yearRaw != null ? Math.round(yearRaw) : undefined,
    note,
    extra_data: JSON.stringify({ source: 'assistant_chat_commit' }),
  });
  await requestPushPending();
  return ok(row.id, `已创建年度 bet「${title.slice(0, 40)}」`);
}

export const lifeRoadCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_life_road_node: async input => commitLifeRoadNode(input.draft),
  commit_life_direction: async input => commitLifeDirection(input.draft),
  commit_life_bet: async input => commitLifeBet(input.draft),
};
