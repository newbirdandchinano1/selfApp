/**
 * 本地通知登记时解析 title/body（非系统弹出瞬间）。
 * 优先读缓存；未命中则用硬编码兜底。
 * 不再调用 AI（曾误复用 finance/txn-comment，启动重同步会轰炸后端）。
 */

import { AppSettingKey, getAppSetting } from '@/lib/app-settings-store';

const TITLE_MAX = 28;
const BODY_MAX = 80;

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
  const raw = await getAppSetting<unknown>(AppSettingKey.notificationAiCopyCache);
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
  /** 保留参数以兼容调用方；不再送 AI */
  contextBlock: string;
}): Promise<NotificationAiCopy> {
  const fallback = normalizeCopy(params.fallback.title, params.fallback.body);

  try {
    const store = await readCache();
    const hit = store.entries.find(
      e => e.identifier === params.identifier && e.fingerprint === params.fingerprint,
    );
    if (hit) return normalizeCopy(hit.title, hit.body);
  } catch {
    /* ignore */
  }

  return fallback;
}
