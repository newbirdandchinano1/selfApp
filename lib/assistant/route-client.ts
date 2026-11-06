/**
 * 全局助手 route：拼 brief_context → 调 Agent → 白名单消毒 ActionCard。
 */
import {
  parseActionCards,
  sanitizeActionCardsAgainstWhitelist,
  type ActionCard,
} from '@/lib/assistant/action-card';
import {
  collectAllowedIdsFromBriefContext,
  type AssistantBriefContext,
} from '@/lib/assistant/brief-context';
import { loadAssistantBriefContext } from '@/lib/assistant/brief-context-load';
import { aiAssistantRoute, type AssistantRouteResult } from '@/lib/ai-api-client';

export type AssistantRouteClientResult = {
  reply_text?: string;
  routed_domains: string[];
  cards: ActionCard[];
  brief_context: AssistantBriefContext;
  dropped_ids: string[];
};

export async function runAssistantRoute(opts: {
  text?: string;
  image_base64?: string;
  image_mime_type?: string;
  brief_context?: AssistantBriefContext;
  locale?: string;
}): Promise<AssistantRouteClientResult> {
  const brief = opts.brief_context ?? (await loadAssistantBriefContext());
  const allowed = collectAllowedIdsFromBriefContext(brief);
  const raw: AssistantRouteResult = await aiAssistantRoute({
    text: opts.text,
    image_base64: opts.image_base64,
    image_mime_type: opts.image_mime_type,
    brief_context: brief,
    locale: opts.locale ?? 'zh-CN',
  });
  const parsed = parseActionCards(raw.cards ?? []);
  const { cards, dropped_ids } = sanitizeActionCardsAgainstWhitelist(parsed, allowed);
  return {
    reply_text: raw.reply_text,
    routed_domains: Array.isArray(raw.routed_domains) ? raw.routed_domains.map(String) : [],
    cards,
    brief_context: brief,
    dropped_ids,
  };
}
