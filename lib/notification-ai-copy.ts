/**
 * 本地通知登记时解析 title/body（非系统弹出瞬间）。
 * 优先读缓存；未命中则用硬编码兜底。
 * 登记路径本身不直接打模型；财务收口可在排期前低频预取写入缓存。
 */

import { AppSettingKey, getAppSettingFromCache, setAppSetting } from '@/lib/app-settings-store';
import { analyzeFinanceDailyWrapup, draftProfileNotificationCopy } from '@/lib/zhipu-image-parse';

const TITLE_MAX = 28;
const BODY_MAX = 80;
const CACHE_MAX_ENTRIES = 40;

export type NotificationAiCopy = { title: string; body: string };

type CacheEntry = {
  identifier: string;
  fingerprint: string;
  title: string;
  body: string;
  updatedAt: string;
};

type CacheStore = { entries: CacheEntry[] };

function truncate(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + '…';
}

function normalizeCopy(title: string, body: string): NotificationAiCopy {
  return {
    title: truncate(title || '提醒', TITLE_MAX),
    body: truncate(body || '', BODY_MAX),
  };
}

async function readCache(): Promise<CacheStore> {
  const raw = await getAppSettingFromCache<unknown>(AppSettingKey.notificationAiCopyCache);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { entries: [] };
  const entries = (raw as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return { entries: [] };
  const out: CacheEntry[] = [];
  for (const item of entries) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    if (typeof o.identifier !== 'string' || typeof o.fingerprint !== 'string') continue;
    if (typeof o.title !== 'string' || typeof o.body !== 'string') continue;
    out.push({
      identifier: o.identifier,
      fingerprint: o.fingerprint,
      title: o.title,
      body: o.body,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : new Date().toISOString(),
    });
  }
  return { entries: out };
}

/**
 * 登记预约时调用：优先缓存 → 硬编码兜底。
 * 永不抛错；不发起网络请求。
 */
export async function resolveNotificationAiCopy(params: {
  identifier: string;
  fingerprint: string;
  fallback: NotificationAiCopy;
  /** 保留参数以兼容调用方；登记时不送 AI */
  contextBlock: string;
}): Promise<NotificationAiCopy> {
  const fallback = normalizeCopy(params.fallback.title, params.fallback.body);

  try {
    const store = await readCache();
    const hit = store.entries.find(
      (e) => e.identifier === params.identifier && e.fingerprint === params.fingerprint,
    );
    if (hit) return normalizeCopy(hit.title, hit.body);
  } catch {
    /* ignore */
  }

  return fallback;
}

/** 写入通知文案缓存（按 identifier+fingerprint；供排期前低频预取）。 */
export async function cacheNotificationAiCopy(params: {
  identifier: string;
  fingerprint: string;
  title: string;
  body: string;
}): Promise<void> {
  const copy = normalizeCopy(params.title, params.body);
  try {
    const store = await readCache();
    const next: CacheEntry[] = store.entries.filter(
      (e) => !(e.identifier === params.identifier && e.fingerprint === params.fingerprint),
    );
    next.unshift({
      identifier: params.identifier,
      fingerprint: params.fingerprint,
      title: copy.title,
      body: copy.body,
      updatedAt: new Date().toISOString(),
    });
    await setAppSetting(AppSettingKey.notificationAiCopyCache, {
      entries: next.slice(0, CACHE_MAX_ENTRIES),
    });
  } catch {
    /* ignore */
  }
}

/**
 * 财务收口/阈值通知：缓存未命中时低频调 `finance/daily-wrapup` 写入缓存。
 * 失败静默回退；绝不在启动全量同步路径上连环轰炸。
 */
export async function prefetchFinanceNotificationWrapupCopy(params: {
  identifier: string;
  fingerprint: string;
  summaryText: string;
  fallback: NotificationAiCopy;
  period?: 'daily' | 'weekly';
}): Promise<NotificationAiCopy> {
  const fallback = normalizeCopy(params.fallback.title, params.fallback.body);
  try {
    const store = await readCache();
    const hit = store.entries.find(
      (e) => e.identifier === params.identifier && e.fingerprint === params.fingerprint,
    );
    if (hit) return normalizeCopy(hit.title, hit.body);
  } catch {
    /* ignore */
  }

  const summary = params.summaryText.trim();
  if (!summary) return fallback;

  try {
    const r = await analyzeFinanceDailyWrapup({
      summaryText: summary,
      period: params.period ?? 'daily',
    });
    if (!r.ok) return fallback;
    await cacheNotificationAiCopy({
      identifier: params.identifier,
      fingerprint: params.fingerprint,
      title: r.data.title,
      body: r.data.body,
    });
    return normalizeCopy(r.data.title, r.data.body);
  } catch {
    return fallback;
  }
}

/** 供 `prefetchProfileNotificationCopy` 的预热项 */
export type ProfileNotificationCopyPrefetchItem = {
  identifier: string;
  fingerprint: string;
  contextBlock: string;
  fallbackTitle?: string;
  fallbackBody?: string;
};

/**
 * 用户显式开启「更自然的通知文案」后，批量（≤10）调 `profile/notification-copy`
 * 并写入缓存。登记路径仍只读缓存 + 硬编码兜底，不在此处外联。
 */
export async function prefetchProfileNotificationCopy(
  items: ProfileNotificationCopyPrefetchItem[],
): Promise<{ ok: boolean; written: number; error?: string }> {
  const limited = items
    .map((i) => ({
      identifier: i.identifier.trim(),
      fingerprint: i.fingerprint.trim(),
      contextBlock: i.contextBlock.trim(),
      fallbackTitle: i.fallbackTitle,
      fallbackBody: i.fallbackBody,
    }))
    .filter((i) => i.identifier && i.fingerprint && i.contextBlock)
    .slice(0, 10);
  if (!limited.length) return { ok: false, written: 0, error: '没有可预热的通知' };

  try {
    const r = await draftProfileNotificationCopy(
      limited.map((i) => ({
        identifier: i.identifier,
        fingerprint: i.fingerprint,
        contextBlock: i.contextBlock,
        fallbackTitle: i.fallbackTitle,
        fallbackBody: i.fallbackBody,
      })),
    );
    if (!r.ok) return { ok: false, written: 0, error: r.error };
    let written = 0;
    for (const copy of r.data.copies) {
      await cacheNotificationAiCopy({
        identifier: copy.identifier,
        fingerprint: copy.fingerprint,
        title: copy.title,
        body: copy.body,
      });
      written += 1;
    }
    return { ok: true, written };
  } catch (e) {
    return {
      ok: false,
      written: 0,
      error: e instanceof Error ? e.message : '预热失败',
    };
  }
}
