/**
 * 本地通知登记时预生成 title/body（非系统弹出瞬间）。
 * 复用现有 `aiFinanceTxnComment` 封装；失败则硬编码兜底。
 * 同一 identifier + 业务指纹未变时缓存，避免重复请求。
 */

import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';
import * as aiApi from '@/lib/ai-api-client';
import { getActiveAiLlmApiKey, isActiveAiLlmConfigured } from '@/lib/zhipu-image-parse';

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

const CACHE_LIMIT = 80;

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

async function writeCacheEntry(entry: CacheEntry): Promise<void> {
  try {
    const store = await readCache();
    const next = store.entries.filter(
      e => !(e.identifier === entry.identifier && e.fingerprint === entry.fingerprint),
    );
    next.unshift(entry);
    await setAppSetting(AppSettingKey.notificationAiCopyCache, {
      entries: next.slice(0, CACHE_LIMIT),
    });
  } catch {
    /* 缓存失败不影响推送 */
  }
}

function parseTitleBodyFromComment(raw: string): NotificationAiCopy | null {
  const text = raw.trim();
  if (!text) return null;

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const o = JSON.parse(jsonMatch[0]) as { title?: unknown; body?: unknown };
      if (typeof o.title === 'string' && typeof o.body === 'string') {
        return normalizeCopy(o.title, o.body);
      }
    } catch {
      /* fall through */
    }
  }

  const sep = text.includes('|||') ? '|||' : text.includes('\n') ? '\n' : null;
  if (sep) {
    const [a, ...rest] = text.split(sep);
    const b = rest.join(sep).trim();
    if (a?.trim() && b) return normalizeCopy(a, b);
  }

  return null;
}

/**
 * 登记预约时调用：优先缓存 → AI → 硬编码兜底。
 * 永不抛错；AI 失败不影响推送。
 */
export async function resolveNotificationAiCopy(params: {
  identifier: string;
  fingerprint: string;
  fallback: NotificationAiCopy;
  /** 上云上下文（不脱敏），按频道简述未达标项 / 标题 / 习惯名等 */
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

  if (!isActiveAiLlmConfigured()) return fallback;
  const apiKey = getActiveAiLlmApiKey().trim();
  if (!apiKey && !isActiveAiLlmConfigured()) return fallback;

  try {
    const prompt = [
      '请为手机本地推送通知写简短中文文案。',
      `只输出一行 JSON：{"title":"…","body":"…"}，title≤${TITLE_MAX}字，body≤${BODY_MAX}字。`,
      '不要解释、不要 markdown。',
      '',
      params.contextBlock.trim(),
    ].join('\n');

    const { comment } = await aiApi.aiFinanceTxnComment({ summary_text: prompt });
    const parsed = parseTitleBodyFromComment(comment ?? '');
    if (!parsed) return fallback;

    void writeCacheEntry({
      identifier: params.identifier,
      fingerprint: params.fingerprint,
      title: parsed.title,
      body: parsed.body,
      updatedAt: new Date().toISOString(),
    });
    return parsed;
  } catch (e) {
    console.warn('通知 AI 文案失败，使用兜底', e);
    return fallback;
  }
}
