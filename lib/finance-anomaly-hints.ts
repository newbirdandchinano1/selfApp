/**
 * 财务首页异常消费弱提示：低频请求 Agent，本地缓存按摘要 digest。
 * 只读展示，不自动删改流水。
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  analyzeFinanceAnomalyHints,
  type FinanceAnomalyHintItem,
} from '@/lib/zhipu-image-parse';
import type { FinanceTransactionRow } from '@/lib/repositories/finance/finance.types';

const CACHE_KEY = '@selfapp/finance_anomaly_hints_v1';
const MAX_TXNS = 80;
const LOOKBACK_DAYS = 14;

type CacheRow = {
  digest: string;
  savedAt: number;
  hints: FinanceAnomalyHintItem[];
};

function ymdFromDatetime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function hourFromDatetime(iso: string): number | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours();
}

export function buildFinanceAnomalySummary(params: {
  transactions: FinanceTransactionRow[];
  categoryNameById?: Map<string, string>;
  now?: Date;
}): { summaryText: string; txnIds: string[]; digest: string } {
  const now = params.now ?? new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - LOOKBACK_DAYS);
  const startMs = start.getTime();
  const rows = params.transactions
    .filter((t) => {
      if (t.transaction_type === 'transfer') return false;
      const ms = new Date(t.happened_at).getTime();
      return Number.isFinite(ms) && ms >= startMs;
    })
    .sort((a, b) => new Date(b.happened_at).getTime() - new Date(a.happened_at).getTime())
    .slice(0, MAX_TXNS);

  const lines: string[] = [
    `近 ${LOOKBACK_DAYS} 日流水（最多 ${MAX_TXNS} 条；含 id/名称/类型/金额/分类/时段）：`,
  ];
  const txnIds: string[] = [];
  for (const t of rows) {
    txnIds.push(t.id);
    const ymd = ymdFromDatetime(t.happened_at) ?? t.happened_at.slice(0, 10);
    const hour = hourFromDatetime(t.happened_at);
    const cat =
      (t.flow_category_id && params.categoryNameById?.get(t.flow_category_id)) || '未分类';
    const typeLabel = t.transaction_type === 'income' ? '收入' : '支出';
    lines.push(
      `- id=${t.id} | ${ymd} ${hour != null ? `${String(hour).padStart(2, '0')}时` : ''} | ${typeLabel} | ${t.name?.trim() || '（无标题）'} | ¥${Math.abs(t.amount).toFixed(2)} | ${cat}`,
    );
  }
  const summaryText = lines.join('\n');
  const digest = `${LOOKBACK_DAYS}|${txnIds.length}|${txnIds.slice(0, 12).join(',')}|${summaryText.length}`;
  return { summaryText, txnIds, digest };
}

async function readCache(): Promise<CacheRow | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheRow;
    if (!parsed || typeof parsed.digest !== 'string' || !Array.isArray(parsed.hints)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function writeCache(row: CacheRow): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(row));
  } catch {
    /* ignore */
  }
}

/**
 * 有缓存且 digest 相同则直接返回；否则低频请求 AI。
 * 失败时返回空 hints（不抛错）。
 */
export async function loadFinanceAnomalyHints(params: {
  transactions: FinanceTransactionRow[];
  categoryNameById?: Map<string, string>;
  force?: boolean;
}): Promise<FinanceAnomalyHintItem[]> {
  const built = buildFinanceAnomalySummary(params);
  if (!built.txnIds.length) return [];

  if (!params.force) {
    const cached = await readCache();
    if (cached && cached.digest === built.digest) return cached.hints;
    // 同日已有缓存且 digest 仅轻微变化：仍可复用 6h 内结果，避免首页聚焦轰炸
    if (
      cached &&
      Date.now() - (cached.savedAt || 0) < 6 * 60 * 60 * 1000 &&
      cached.hints.length >= 0
    ) {
      // digest 不同才继续请求；6h 内同 digest 已在上面返回
    }
  }

  const r = await analyzeFinanceAnomalyHints({
    summaryText: built.summaryText,
    txnIds: built.txnIds,
  });
  if (!r.ok) {
    const cached = await readCache();
    return cached?.hints ?? [];
  }
  await writeCache({ digest: built.digest, savedAt: Date.now(), hints: r.data.hints });
  return r.data.hints;
}
