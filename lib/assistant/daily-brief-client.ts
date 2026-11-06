/**
 * 全局助手 daily-brief：拼 brief_context → 调 Agent → 白名单消毒。
 * 失败时回退本地规则 facts（数字仍以 brief 为准）。
 */
import {
  parseActionCards,
  sanitizeActionCardsAgainstWhitelist,
  type ActionCard,
} from '@/lib/assistant/action-card';
import {
  buildAssistantBriefFactLines,
  collectAllowedIdsFromBriefContext,
  type AssistantBriefContext,
} from '@/lib/assistant/brief-context';
import { loadAssistantBriefContext } from '@/lib/assistant/brief-context-load';
import {
  aiAssistantDailyBrief,
  type AssistantDailyBriefFact,
  type AssistantDailyBriefResult,
} from '@/lib/ai-api-client';

export type AssistantDailyBriefClientResult = {
  headline: string;
  facts: AssistantDailyBriefFact[];
  cards: ActionCard[];
  brief_context: AssistantBriefContext;
  dropped_ids: string[];
  /** true = Agent 失败，仅本地规则 facts */
  from_fallback: boolean;
};

function localHeadline(facts: AssistantDailyBriefFact[]): string {
  if (!facts.length) return '今天节奏平稳，有需要随时叫我。';
  const first = (facts[0]?.text || '').split('；')[0]?.slice(0, 24) || '今日要点';
  return first.endsWith('。') ? first : `${first}。`;
}

function normalizeFacts(
  raw: unknown,
  fallback: AssistantDailyBriefFact[],
): AssistantDailyBriefFact[] {
  if (!Array.isArray(raw) || raw.length === 0) return fallback;
  const out: AssistantDailyBriefFact[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const domain = typeof o.domain === 'string' ? o.domain.trim() : '';
    const text = typeof o.text === 'string' ? o.text.trim() : '';
    if (!domain || !text) continue;
    out.push({ domain, text });
  }
  return out.length ? out : fallback;
}

export async function runAssistantDailyBrief(opts?: {
  brief_context?: AssistantBriefContext;
  locale?: string;
}): Promise<AssistantDailyBriefClientResult> {
  const brief = opts?.brief_context ?? (await loadAssistantBriefContext());
  const allowed = collectAllowedIdsFromBriefContext(brief);
  const localFacts = buildAssistantBriefFactLines(brief);

  try {
    const raw: AssistantDailyBriefResult = await aiAssistantDailyBrief({
      brief_context: brief,
      locale: opts?.locale ?? 'zh-CN',
    });
    const facts = normalizeFacts(raw.facts, localFacts);
    const parsed = parseActionCards(raw.cards ?? []);
    const { cards, dropped_ids } = sanitizeActionCardsAgainstWhitelist(parsed, allowed);
    const headline =
      (typeof raw.headline === 'string' && raw.headline.trim()) || localHeadline(facts);
    return {
      headline: headline.slice(0, 48),
      facts,
      cards: cards.slice(0, 3),
      brief_context: brief,
      dropped_ids,
      from_fallback: false,
    };
  } catch {
    return {
      headline: localHeadline(localFacts),
      facts: localFacts,
      cards: [],
      brief_context: brief,
      dropped_ids: [],
      from_fallback: true,
    };
  }
}
