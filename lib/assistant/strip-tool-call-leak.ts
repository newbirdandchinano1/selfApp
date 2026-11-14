/**
 * 剔除助手把 function calling 写成聊天正文的泄漏：
 * recipe.draft_category_rename\n{"category_id":"..."}
 * 与 Agent ReplyValidator 规则对齐（点号 / 下划线均可）。
 */
const TOOL_CALL_LEAK_RE =
  /(?:^|\n)\s*(?:调用(?:工具)?[:：]?\s*|tool\s*call[:：]?\s*)?([a-z][a-z0-9]*(?:[._][a-z0-9]+){1,})\s*(\{(?:[^{}]|\{[^{}]*\})*\})/gms;

function looksLikeJsonObject(raw: string): boolean {
  try {
    const v = JSON.parse(raw) as unknown;
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  } catch {
    return false;
  }
}

export function stripAssistantToolCallLeak(text: string): string {
  if (!text.trim()) return text;
  const cleaned = text.replace(TOOL_CALL_LEAK_RE, (full, _name: string, args: string) => {
    if (!looksLikeJsonObject(args)) return full;
    return '\n';
  });
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

/** 整段是否基本只有工具泄漏（无剩余自然语言） */
export function isMostlyToolCallLeak(text: string): boolean {
  const raw = text.trim();
  if (!raw) return false;
  const stripped = stripAssistantToolCallLeak(raw);
  return !stripped.trim();
}
