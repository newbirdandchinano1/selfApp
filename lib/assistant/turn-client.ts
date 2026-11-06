/**
 * 全局助手 turn：多轮改草稿 / 澄清追问。
 * 有 pending_cards 时走 /assistant/turn；对外以 assistant 为准。
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
import { aiAssistantTurn, type AssistantTurnResult } from '@/lib/ai-api-client';

export type AssistantTurnClientResult = {
  session_id: string;
  reply_text?: string;
  cards: ActionCard[];
  brief_context: AssistantBriefContext;
  dropped_ids: string[];
};

export async function runAssistantTurn(opts: {
  session_id?: string;
  message: string;
  history?: unknown[];
  pending_cards?: ActionCard[];
  brief_context?: AssistantBriefContext;
  locale?: string;
}): Promise<AssistantTurnClientResult> {
  const brief = opts.brief_context ?? (await loadAssistantBriefContext());
  const allowed = collectAllowedIdsFromBriefContext(brief);
  const raw: AssistantTurnResult = await aiAssistantTurn({
    session_id: opts.session_id,
    message: opts.message,
    history: opts.history,
    brief_context: brief,
    pending_cards: opts.pending_cards,
    locale: opts.locale ?? 'zh-CN',
  });
  const parsed = parseActionCards(raw.cards ?? []);
  const { cards, dropped_ids } = sanitizeActionCardsAgainstWhitelist(parsed, allowed);
  return {
    session_id: typeof raw.session_id === 'string' && raw.session_id.trim() ? raw.session_id : '',
    reply_text: raw.reply_text,
    cards,
    brief_context: brief,
    dropped_ids,
  };
}
