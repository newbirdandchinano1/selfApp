/**
 * Agent 端用户偏好 CRUD（Agent 文件为真相源）。
 */
import { getAgentApiKey, getAgentBaseUrl } from '@/lib/agent-config';
import { ApiRequestError } from '@/lib/api/http';

/** 单用户 App 与 Agent 约定的默认 user_id */
export const AGENT_PREFS_USER_ID = 'default';

export type AgentPrefSource = 'chat' | 'app' | 'system';

export type AgentPrefItem = {
  id: string;
  content: string;
  source: AgentPrefSource;
  created_at: string;
  updated_at: string;
};

export type AgentPrefSnapshot = {
  user_id: string;
  version: number;
  updated_at: string;
  items: AgentPrefItem[];
  count: number;
};

async function agentFetch(path: string, init?: RequestInit): Promise<AgentPrefSnapshot> {
  const baseUrl = await getAgentBaseUrl();
  const apiKey = await getAgentApiKey();
  const url = `${baseUrl}/api/v1/agent/preferences${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  });
  const text = await res.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object' && 'detail' in parsed
        ? String((parsed as { detail: unknown }).detail)
        : `HTTP ${res.status}`;
    throw new ApiRequestError(`偏好同步失败：${detail}`, res.status, -1, {
      retryable: res.status >= 500,
    });
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new ApiRequestError('偏好同步失败：空响应', res.status, -1, { retryable: true });
  }
  const o = parsed as Record<string, unknown>;
  const itemsRaw = Array.isArray(o.items) ? o.items : [];
  const items: AgentPrefItem[] = itemsRaw
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map(row => ({
      id: String(row.id || ''),
      content: String(row.content || ''),
      source: (row.source === 'chat' || row.source === 'system' ? row.source : 'app') as AgentPrefSource,
      created_at: String(row.created_at || ''),
      updated_at: String(row.updated_at || ''),
    }))
    .filter(it => it.id && it.content);
  return {
    user_id: String(o.user_id || AGENT_PREFS_USER_ID),
    version: Number(o.version) || 0,
    updated_at: String(o.updated_at || ''),
    items,
    count: Number(o.count) || items.length,
  };
}

export async function listAgentPreferences(
  userId: string = AGENT_PREFS_USER_ID,
): Promise<AgentPrefSnapshot> {
  const q = `?user_id=${encodeURIComponent(userId)}`;
  return agentFetch(q, { method: 'GET' });
}

export async function createAgentPreference(
  content: string,
  userId: string = AGENT_PREFS_USER_ID,
): Promise<AgentPrefSnapshot> {
  return agentFetch('', {
    method: 'POST',
    body: JSON.stringify({ content: content.trim(), user_id: userId, source: 'app' }),
  });
}

export async function updateAgentPreference(
  itemId: string,
  content: string,
  userId: string = AGENT_PREFS_USER_ID,
): Promise<AgentPrefSnapshot> {
  return agentFetch(`/${encodeURIComponent(itemId)}`, {
    method: 'PUT',
    body: JSON.stringify({ content: content.trim(), user_id: userId }),
  });
}

export async function deleteAgentPreference(
  itemId: string,
  userId: string = AGENT_PREFS_USER_ID,
): Promise<AgentPrefSnapshot> {
  const q = `?user_id=${encodeURIComponent(userId)}`;
  return agentFetch(`/${encodeURIComponent(itemId)}${q}`, { method: 'DELETE' });
}

export function formatPrefsUpdatedAt(iso: string): string {
  const s = (iso || '').trim();
  if (!s) return '尚未同步';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
