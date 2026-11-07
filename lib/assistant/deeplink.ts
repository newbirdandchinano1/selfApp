/**
 * 助手 / Widget 深链解析（纯函数，可单测）。
 * Widget 只深链，不在组件进程跑 LLM。
 */

export type AssistantDeepLinkKind =
  | 'assistant_open'
  | 'assistant_clipboard'
  | 'assistant_brief'
  | 'tab_finance'
  | 'tab_tasks'
  | 'tab_health'
  | 'tab_profile'
  | 'tab_review'
  | 'wardrobe'
  | 'unknown';

export type ParsedAssistantDeepLink = {
  kind: AssistantDeepLinkKind;
  /** brief 可选域提示 */
  domain?: string;
  /** tasks placement 等 */
  query: Record<string, string>;
};

function parseQuery(search: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = (search || '').replace(/^\?/, '');
  if (!q) return out;
  for (const part of q.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    const k = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part).trim();
    const v = decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : '').trim();
    if (k) out[k] = v;
  }
  return out;
}

/**
 * 解析 zheng://… / 自定义 scheme。
 * 例：zheng://finance、zheng://assistant/brief、zheng://health、zheng://tasks?placement=x
 */
export function parseAssistantDeepLink(url: string): ParsedAssistantDeepLink {
  const raw = (url || '').trim();
  if (!raw) return { kind: 'unknown', query: {} };

  const noHash = raw.split('#')[0] || '';
  const qIdx = noHash.indexOf('?');
  const beforeQ = qIdx >= 0 ? noHash.slice(0, qIdx) : noHash;
  const query = parseQuery(qIdx >= 0 ? noHash.slice(qIdx) : '');

  // zheng://host/path → after scheme
  let rest = beforeQ;
  const schemeIdx = rest.indexOf('://');
  if (schemeIdx >= 0) {
    rest = rest.slice(schemeIdx + 3);
  } else if (rest.startsWith('/')) {
    rest = rest.replace(/^\/+/, '');
  }
  const path = rest.replace(/^\/+|\/+$/g, '').toLowerCase();

  if (!path || path === 'index' || path === 'health') {
    // 空 host（zheng://）视为健康首页；assistant/brief 另判
    if (!path) {
      return { kind: 'tab_health', query };
    }
    return { kind: 'tab_health', query };
  }

  if (path === 'assistant' || path === 'assistant/open' || path === 'assistant/route') {
    return { kind: 'assistant_open', query };
  }
  if (path === 'assistant/clipboard' || path === 'assistant/from-clipboard') {
    return { kind: 'assistant_clipboard', query };
  }
  if (path === 'assistant/brief' || path === 'assistant/daily-brief') {
    return {
      kind: 'assistant_brief',
      domain: query.domain || undefined,
      query,
    };
  }
  if (path === 'finance') return { kind: 'tab_finance', query };
  if (path === 'tasks' || path.startsWith('tasks/')) return { kind: 'tab_tasks', query };
  if (path === 'profile' || path === 'me') return { kind: 'tab_profile', query };
  if (path === 'review') return { kind: 'tab_review', query };
  if (path === 'wardrobe' || path === 'my-wardrobe') return { kind: 'wardrobe', query };

  if (/assistant\/clipboard/i.test(raw)) return { kind: 'assistant_clipboard', query };
  if (/assistant\/brief/i.test(raw)) {
    return { kind: 'assistant_brief', domain: query.domain, query };
  }
  if (/:\/\/assistant(\/|\?|$)/i.test(raw)) return { kind: 'assistant_open', query };

  return { kind: 'unknown', query };
}

/** Widget / 文档用的规范深链 */
export const ASSISTANT_DEEP_LINKS = {
  open: 'zheng://assistant',
  clipboard: 'zheng://assistant/clipboard',
  brief: 'zheng://assistant/brief',
  finance: 'zheng://finance',
  tasks: 'zheng://tasks',
  health: 'zheng://health',
  profile: 'zheng://profile',
  wardrobe: 'zheng://wardrobe',
  review: 'zheng://review',
} as const;
