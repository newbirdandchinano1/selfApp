/**
 * 把 AI 复盘文本解析成「观察 / 风险 / 建议」三段结构。
 * AI 复盘分析页（设计稿 11）用它把长文本拆成可扫读的卡片，
 * 解析失败时回退为原文整段展示，不丢内容。
 */

export type ReviewAiSectionKey = 'problems' | 'risks' | 'suggestions';

export type ReviewAiSection = {
  key: ReviewAiSectionKey;
  title: string;
  items: string[];
};

export type ReviewAiDigest = {
  /** 首句导语（设计稿 hero 大标题） */
  headline: string;
  /** 导语全文 */
  intro: string;
  sections: ReviewAiSection[];
  /** 原始正文 */
  raw: string;
};

const SECTION_DEFS: { key: ReviewAiSectionKey; title: string; match: RegExp }[] = [
  { key: 'problems', title: '目前的问题', match: /目前的问题|当前的问题|现有问题|本周的问题/ },
  { key: 'risks', title: '潜在问题', match: /潜在问题|潜在风险|风险|隐患/ },
  { key: 'suggestions', title: '建议', match: /建议|下一步|行动|可以试试/ },
];

const BULLET_RE = /^(?:[·•▪◦‣*\-–—]|\d+[.、)）]|[（(]\d+[）)]|第[一二三四五六七八九十]+条)\s*/;

function stripBullet(line: string): string {
  return line.replace(BULLET_RE, '').trim();
}

/** 归一化标题行：`【目前的问题】` / `**目前的问题**` / `二、潜在问题` → `目前的问题` */
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

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const cut = flat.split(/(?<=[。！？!?])/)[0] ?? flat;
  return cut.trim();
}

export function parseReviewAiDigest(text: string | null | undefined): ReviewAiDigest {
  const raw = (text ?? '').trim();
  if (!raw) {
    return { headline: '', intro: '', sections: [], raw: '' };
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
