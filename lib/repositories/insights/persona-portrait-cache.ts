import { getDatabase } from '../../database.native';
import type { PersonaPortraitAiData } from '@/lib/zhipu-image-parse';

export const PERSONA_PORTRAIT_SLUGS = [
  'plan-completion',
  'health',
  'savings',
  'ai-insight',
] as const;

export type PersonaPortraitCacheSlug = (typeof PERSONA_PORTRAIT_SLUGS)[number];

const SLUG_SET = new Set<string>(PERSONA_PORTRAIT_SLUGS);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 宽松校验：避免坏 JSON 污染界面 */
export function parsePersonaPortraitPayload(json: string): PersonaPortraitAiData | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json) as unknown;
  } catch {
    return null;
  }
  if (!isPlainObject(raw)) return null;
  const str = (k: string) => (typeof raw[k] === 'string' ? (raw[k] as string) : '');
  const bullets = Array.isArray(raw.bullets)
    ? raw.bullets.map(x => (typeof x === 'string' ? x : String(x))).filter(Boolean)
    : [];
  const milestones = Array.isArray(raw.milestones)
    ? raw.milestones.map(x => (typeof x === 'string' ? x : String(x))).filter(Boolean)
    : [];
  const stats: { label: string; value: string; hint: string }[] = [];
  if (Array.isArray(raw.stats)) {
    for (const row of raw.stats) {
      if (!isPlainObject(row)) continue;
      stats.push({
        label: typeof row.label === 'string' ? row.label : String(row.label ?? ''),
        value: typeof row.value === 'string' ? row.value : String(row.value ?? ''),
        hint: typeof row.hint === 'string' ? row.hint : String(row.hint ?? ''),
      });
    }
  }
  const dims: { title: string; sub: string }[] = [];
  if (Array.isArray(raw.dims)) {
    for (const row of raw.dims) {
      if (!isPlainObject(row)) continue;
      dims.push({
        title: typeof row.title === 'string' ? row.title : String(row.title ?? ''),
        sub: typeof row.sub === 'string' ? row.sub : String(row.sub ?? ''),
      });
    }
  }
  const data: PersonaPortraitAiData = {
    hero_kicker: str('hero_kicker'),
    hero_main: str('hero_main'),
    hero_caption: str('hero_caption'),
    overview: str('overview'),
    bullets,
    stats,
    milestones,
    dims,
    ai_quote: str('ai_quote'),
  };
  if (!data.overview.trim() && !data.ai_quote.trim() && !data.bullets.some(b => b.trim())) return null;
  return data;
}

export async function getPersonaPortraitCache(slug: string): Promise<{
  cache_date_ymd: string;
  data: PersonaPortraitAiData;
} | null> {
  if (!SLUG_SET.has(slug)) return null;
  const db = await getDatabase();
  if (!db) return null;
  const row = await db.getFirstAsync<{ cache_date_ymd: string; payload_json: string }>(
    `SELECT cache_date_ymd, payload_json
     FROM persona_portrait_cache
     WHERE slug = ?
     LIMIT 1`,
    [slug],
  );
  if (!row?.payload_json?.trim()) return null;
  const data = parsePersonaPortraitPayload(row.payload_json);
  if (!data) return null;
  return { cache_date_ymd: row.cache_date_ymd.trim(), data };
}

export async function savePersonaPortraitCache(
  slug: string,
  cacheDateYmd: string,
  data: PersonaPortraitAiData,
): Promise<void> {
  if (!SLUG_SET.has(slug)) return;
  const db = await getDatabase();
  if (!db) return;
  const payload = JSON.stringify(data);
  await db.runAsync(
    `INSERT OR REPLACE INTO persona_portrait_cache (slug, cache_date_ymd, payload_json, updated_at)
     VALUES (?, ?, ?, datetime('now'))`,
    [slug, cacheDateYmd, payload],
  );
}
