/**
 * 全局助手 compose：跨域编排 → ActionCard（≤5，含 review_quick_create）。
 * 失败时回退空卡 + 提示（不编造 id）。
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
import { ASSISTANT_COMPOSE_MAX_CARDS } from '@/lib/assistant/compose-intent';
import { aiAssistantCompose, type AssistantComposeResult } from '@/lib/ai-api-client';

const DEFAULT_ALLOWED_DOMAINS: string[] = [
  'finance',
  'food',
  'task',
  'habit',
  'memo',
  'wardrobe',
  'recipe',
  'wish',
  'review',
];

export type AssistantComposeClientResult = {
  reply_text?: string;
  composed_domains: string[];
  cards: ActionCard[];
  brief_context: AssistantBriefContext;
  dropped_ids: string[];
  from_fallback: boolean;
};

export async function runAssistantCompose(opts: {
  goal: string;
  brief_context?: AssistantBriefContext;
  allowed_domains?: string[];
  locale?: string;
}): Promise<AssistantComposeClientResult> {
  const goal = (opts.goal || '').trim();
  const brief = opts.brief_context ?? (await loadAssistantBriefContext());
  const allowed = collectAllowedIdsFromBriefContext(brief);
  const domains =
    opts.allowed_domains && opts.allowed_domains.length
      ? opts.allowed_domains
      : DEFAULT_ALLOWED_DOMAINS;

  if (!goal) {
    return {
      reply_text: '先告诉我编排目标。',
      composed_domains: [],
      cards: [
        {
          id: 'c0',
          domain: 'general',
          intent: 'clarify',
          title: '需要补充',
          summary: '请说明想编排什么',
          confidence: 0.4,
          needs_confirm: false,
          clarify_question: '你想按缺口安排晚上，还是复盘后给几件能做的事？',
          clarify_choices: ['按缺口安排晚上', '复盘后给三件能做的事', '只看今日简报'],
        },
      ],
      brief_context: brief,
      dropped_ids: [],
      from_fallback: true,
    };
  }

  try {
    const raw: AssistantComposeResult = await aiAssistantCompose({
      goal,
      brief_context: brief,
      allowed_domains: domains,
      locale: opts.locale ?? 'zh-CN',
    });
    const parsed = parseActionCards(raw.cards ?? []);
    const { cards, dropped_ids } = sanitizeActionCardsAgainstWhitelist(parsed, allowed);
    return {
      reply_text: typeof raw.reply_text === 'string' ? raw.reply_text : undefined,
      composed_domains: Array.isArray(raw.composed_domains)
        ? raw.composed_domains.map(String)
        : [],
      cards: cards.slice(0, ASSISTANT_COMPOSE_MAX_CARDS),
      brief_context: brief,
      dropped_ids,
      from_fallback: false,
    };
  } catch {
    return {
      reply_text: '编排暂时不可用，可改用今日简报或一句话录入。',
      composed_domains: [],
      cards: [],
      brief_context: brief,
      dropped_ids: [],
      from_fallback: true,
    };
  }
}
