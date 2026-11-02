/**
 * AI 复盘结构化结果：解析 / 落库。
 * 字段契约以 `review-ai-json-contract.ts` 为准（与 Agent coaching JSON 对齐）。
 * 兼容旧版纯文本（问题 / 风险 / 建议分段）。
 */

import {
  REVIEW_AI_JSON_LIMITS,
  REVIEW_AI_SUGGESTION_ACTIONS,
} from '@/lib/review-ai-json-contract';

export type ReviewAiSuggestionAction = (typeof REVIEW_AI_SUGGESTION_ACTIONS)[number];

export type ReviewAiSuggestion = {
  text: string;
  action: ReviewAiSuggestionAction;
  draftTitle: string;
  draftBody: string;
};

export type ReviewAiPayload = {
  title: string;
  overview: string;
  tags: string[];
  suggestions: ReviewAiSuggestion[];
  /** 落库用的规范 JSON 字符串；旧数据可能是纯文本 */
  raw: string;
  /** 是否解析自规范 JSON */
  structured: boolean;
};

/** @deprecated 旧分段结构；新 UI 用 ReviewAiPayload */
export type ReviewAiSectionKey = 'problems' | 'risks' | 'suggestions';

/** @deprecated */
export type ReviewAiSection = {
  key: ReviewAiSectionKey;
  title: string;
  items: string[];
};

/** @deprecated 请改用 ReviewAiPayload / parseReviewAiPayload */
export type ReviewAiDigest = {
  headline: string;
  intro: string;
  sections: ReviewAiSection[];
  raw: string;
};

const ACTIONS: ReviewAiSuggestionAction[] = [...REVIEW_AI_SUGGESTION_ACTIONS];

const SECTION_DEFS: { key: ReviewAiSectionKey; title: string; match: RegExp }[] = [
  { key: 'problems', title: '目前的问题', match: /目前的问题|当前的问题|现有问题|本周的问题/ },
  { key: 'risks', title: '潜在问题', match: /潜在问题|潜在风险|风险|隐患/ },
  { key: 'suggestions', title: '建议', match: /建议|下一步|行动|可以试试/ },
];

const BULLET_RE = /^(?:[·•▪◦‣*\-–—]|\d+[.、)）]|[（(]\d+[）)]|第[一二三四五六七八九十]+条)\s*/;

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, '').trim();
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const cut = flat.split(/(?<=[。！？!?])/)[0] ?? flat;
  return cut.trim();
}

function normalizeHeading(line: string): string | null {
  let s = line.trim();
  if (!s) return null;
  s = s.replace(/^#+\s*/, '');
  s = s.replace(/\*\*/g, '');
  const bracket = /^【(.+?)】$/.exec(s);
  if (bracket) s = bracket[1].trim();
  s = s.replace(/^[（(]?[一二三四五六七八九十\d]+[）)、.．]\s*/, '');
  if (!s || s.length > 14) return null;
  return s;
}

function matchSection(title: string): { key: ReviewAiSectionKey; title: string } | null {
  for (const def of SECTION_DEFS) {
    if (def.match.test(title)) return { key: def.key, title: def.title };
  }
  return null;
}

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function asAction(raw: unknown, fallbackText: string): ReviewAiSuggestionAction {
  const key = String(raw ?? '')
    .trim()
    .toLowerCase();
  if ((ACTIONS as string[]).includes(key)) return key as ReviewAiSuggestionAction;
  const blob = fallbackText;
  if (/习惯|打卡|每天|每日|每周固定/.test(blob)) return 'habit';
  if (/项目|拆解|里程碑|长期|规划/.test(blob)) return 'project';
  if (/备忘|记下|记录想法|复盘笔记/.test(blob)) return 'memo';
  return 'todo';
}

function normalizeSuggestion(item: unknown): ReviewAiSuggestion | null {
  if (typeof item === 'string') {
    const text = clip(stripBullet(item), REVIEW_AI_JSON_LIMITS.suggestionText);
    if (!text) return null;
    return {
      text,
      action: asAction(null, text),
      draftTitle: clip(text, 24),
      draftBody: '',
    };
  }
  if (!item || typeof item !== 'object') return null;
  const o = item as Record<string, unknown>;
  const text = clip(
    String(o.text ?? o.content ?? o.body ?? '').trim(),
    REVIEW_AI_JSON_LIMITS.suggestionText,
  );
  if (!text) return null;
  const draftTitle =
    clip(String(o.draft_title ?? o.draftTitle ?? o.title ?? text).trim(), REVIEW_AI_JSON_LIMITS.draftTitle) ||
    clip(text, 24);
  const draftBody = clip(
    String(o.draft_body ?? o.draftBody ?? o.note ?? '').trim(),
    REVIEW_AI_JSON_LIMITS.draftBody,
  );
  return {
    text,
    action: asAction(o.action ?? o.create_as ?? o.createAs, `${text} ${draftTitle}`),
    draftTitle,
    draftBody,
  };
}

function tryParseStructuredJson(raw: string): ReviewAiPayload | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  const title = clip(String(o.title ?? o.headline ?? '').trim(), REVIEW_AI_JSON_LIMITS.title);
  const overview = clip(
    String(o.overview ?? o.summary ?? o.body ?? '').trim(),
    REVIEW_AI_JSON_LIMITS.overview,
  );
  const suggestions: ReviewAiSuggestion[] = [];
  if (Array.isArray(o.suggestions)) {
    for (const item of o.suggestions) {
      const s = normalizeSuggestion(item);
      if (s) suggestions.push(s);
      if (suggestions.length >= REVIEW_AI_JSON_LIMITS.suggestionsMax) break;
    }
  } else if (typeof o.suggestions === 'string') {
    for (const line of o.suggestions.split(/[\n;；]+/)) {
      const s = normalizeSuggestion(line);
      if (s) suggestions.push(s);
      if (suggestions.length >= REVIEW_AI_JSON_LIMITS.suggestionsMax) break;
    }
  }
  const tags: string[] = [];
  if (Array.isArray(o.tags)) {
    for (const t of o.tags) {
      if (typeof t !== 'string') continue;
      const name = t.trim();
      if (name && !tags.includes(name) && tags.length < REVIEW_AI_JSON_LIMITS.tagsMax) tags.push(name);
    }
  }
  if (!title && !overview && suggestions.length === 0) return null;
  const resolvedTitle = title || firstSentence(overview) || suggestions[0]?.text || '';
  const resolvedOverview = overview || title || '';
  return {
    title: resolvedTitle,
    overview: resolvedOverview,
    tags,
    suggestions,
    raw: trimmed,
    structured: true,
  };
}

/** 列表/入口卡用的一行摘要（优先 title） */
export function reviewAiPreviewTitle(text: string | null | undefined, maxLen = 36): string {
  const payload = parseReviewAiPayload(text);
  const line = payload.title || firstSentence(payload.overview) || '';
  if (!line) return '';
  return line.length > maxLen ? `${line.slice(0, maxLen - 1)}…` : line;
}

/** 把落库字符串（JSON 或旧纯文本）解析为 UI 结构 */
export function parseReviewAiPayload(text: string | null | undefined): ReviewAiPayload {
  const raw = (text ?? '').trim();
  if (!raw) {
    return { title: '', overview: '', tags: [], suggestions: [], raw: '', structured: false };
  }

  const fromJson = tryParseStructuredJson(raw);
  if (fromJson) return fromJson;

  // 旧纯文本：导语 + 【建议】列表
  const digest = parseReviewAiDigest(raw);
  const suggestionItems = digest.sections.find(s => s.key === 'suggestions')?.items ?? [];
  const suggestions = suggestionItems.map(item => {
    const textItem = clip(item, REVIEW_AI_JSON_LIMITS.suggestionText);
    return {
      text: textItem,
      action: asAction(null, textItem),
      draftTitle: clip(textItem, 24),
      draftBody: '',
    } satisfies ReviewAiSuggestion;
  });
  const title = digest.headline || firstSentence(digest.intro) || suggestions[0]?.text || '';
  const overview =
    digest.intro.trim() ||
    digest.sections
      .filter(s => s.key !== 'suggestions')
      .flatMap(s => [`【${s.title}】`, ...s.items.map(i => `· ${i}`)])
      .join('\n') ||
    title;

  return {
    title,
    overview,
    tags: [],
    suggestions,
    raw,
    structured: false,
  };
}

/** 将 API 结构化结果序列化为落库字符串 */
export function serializeReviewAiPayload(payload: {
  title: string;
  overview: string;
  tags?: string[];
  suggestions: Array<{
    text: string;
    action: ReviewAiSuggestionAction;
    draftTitle?: string;
    draft_title?: string;
    draftBody?: string;
    draft_body?: string;
  }>;
}): string {
  const body = {
    title: clip(payload.title, REVIEW_AI_JSON_LIMITS.title),
    overview: clip(payload.overview, REVIEW_AI_JSON_LIMITS.overview),
    tags: (payload.tags ?? []).slice(0, REVIEW_AI_JSON_LIMITS.tagsMax),
    suggestions: payload.suggestions.slice(0, REVIEW_AI_JSON_LIMITS.suggestionsMax).map(s => ({
      text: clip(s.text, REVIEW_AI_JSON_LIMITS.suggestionText),
      action: asAction(s.action, s.text),
      draft_title: clip(s.draftTitle ?? s.draft_title ?? s.text, REVIEW_AI_JSON_LIMITS.draftTitle),
      draft_body: clip(s.draftBody ?? s.draft_body ?? '', REVIEW_AI_JSON_LIMITS.draftBody),
    })),
  };
  return JSON.stringify(body);
}

/** 复制用可读正文 */
export function formatReviewAiPayloadForCopy(payload: ReviewAiPayload): string {
  if (!payload.title && !payload.overview && payload.suggestions.length === 0) return '';
  const lines = [payload.title, '', payload.overview, ''];
  if (payload.suggestions.length > 0) {
    lines.push('可以试试：');
    payload.suggestions.forEach((s, i) => {
      lines.push(`${i + 1}. ${s.text}`);
    });
  }
  return lines.join('\n').trim();
}

export function parseReviewAiDigest(text: string | null | undefined): ReviewAiDigest {
  const raw = (text ?? '').trim();
  if (!raw) {
    return { headline: '', intro: '', sections: [], raw: '' };
  }

  const structured = tryParseStructuredJson(raw);
  if (structured) {
    return {
      headline: structured.title,
      intro: structured.overview,
      sections:
        structured.suggestions.length > 0
          ? [
              {
                key: 'suggestions',
                title: '建议',
                items: structured.suggestions.map(s => s.text),
              },
            ]
          : [],
      raw,
    };
  }

  const lines = raw.split(/\r?\n/);
  const introLines: string[] = [];
  const buckets = new Map<ReviewAiSectionKey, { title: string; items: string[] }>();

  let current: ReviewAiSectionKey | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    const heading = normalizeHeading(line);
    const section = heading ? matchSection(heading) : null;
    if (section) {
      current = section.key;
      if (!buckets.has(current)) buckets.set(current, { title: section.title, items: [] });
      continue;
    }

    if (current) {
      const bucket = buckets.get(current);
      if (bucket) bucket.items.push(stripBullet(line));
      continue;
    }

    introLines.push(stripBullet(line));
  }

  const sections: ReviewAiSection[] = [];
  for (const def of SECTION_DEFS) {
    const bucket = buckets.get(def.key);
    if (!bucket) continue;
    const items = bucket.items.filter(item => item.length > 0);
    if (items.length === 0) continue;
    sections.push({ key: def.key, title: bucket.title, items });
  }

  const intro = introLines.join(' ').trim();
  const fallbackHeadline = sections[0]?.items[0] ?? intro;

  return {
    headline: firstSentence(fallbackHeadline),
    intro,
    sections,
    raw,
  };
}
