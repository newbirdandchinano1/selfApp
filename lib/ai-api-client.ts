/**
 * App → selfAPP_AIAgent `/api/v1/ai/*`（智谱 Key 仅存 Agent；鉴权为 X-API-Key）。
 * 规范见项目根目录 AI_API.md 与各业务模块 APP 接入说明。
 */

import { getAgentApiKey, getAgentBaseUrl } from '@/lib/agent-config';
import { ApiRequestError } from '@/lib/api/http';
import { fetchWithTimeoutAndRetry } from '@/lib/cloud-fetch-retry';

import type {
  AiFinanceDashboardPayload,
  DailyIntakeTargetsEstimateJson,
  FoodNutritionJson,
  FoodTextIntakeJson,
} from '@/lib/ai-types';

const AI_PREFIX = '/api/v1/ai';
const AI_TIMEOUT_MS = 120_000;

export type AiHealthData = {
  ok: boolean;
  model: string;
  latency_ms: number;
};

export type FinanceOneLinerAccountHint = {
  name: string;
  account_no?: string | null;
};

export type FinanceOneLinerJson = {
  transaction_type: 'expense' | 'income';
  amount: number;
  name: string;
  category_label: string | null;
  payment_account_label: string | null;
  account_name: string | null;
  is_bill?: boolean;
  /** 截图记账：账单上的消费/支付时间（ISO8601 或常见中文日期时间） */
  happened_at?: string | null;
  consumption_time?: string | null;
  paid_at?: string | null;
  transaction_time?: string | null;
  payment_time?: string | null;
};

type AgentEnvelope<T> = {
  code: number;
  message: string;
  data: T | null;
};

function extractEnvelope(parsed: unknown): AgentEnvelope<unknown> | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (typeof o.code !== 'number' || typeof o.message !== 'string') return null;
  return { code: o.code, message: o.message, data: (o.data ?? null) as unknown };
}

async function agentAiRequest<T>(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {},
): Promise<T> {
  const baseUrl = await getAgentBaseUrl();
  const apiKey = await getAgentApiKey();
  const method = options.method ?? 'GET';
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const headers: Record<string, string> = {
    'X-API-Key': apiKey,
  };
  let requestBody: string | undefined;
  if (options.body !== undefined && options.body !== null) {
    requestBody = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetchWithTimeoutAndRetry(
    url,
    {
      method,
      headers,
      ...(requestBody !== undefined ? { body: requestBody } : {}),
    },
    { perAttemptTimeoutMs: AI_TIMEOUT_MS, maxAttempts: 2 },
  );

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = null;
    }
  }

  const envelope = extractEnvelope(parsed);
  if (!envelope) {
    throw new ApiRequestError(
      `Agent 响应格式异常：HTTP ${res.status}`,
      res.status,
      -1,
      { retryable: res.status >= 500 },
    );
  }

  if (!(res.status === 200 && envelope.code === 0)) {
    throw new ApiRequestError(
      envelope.message || `Agent 请求失败：HTTP ${res.status}`,
      res.status,
      envelope.code,
      {
        retryable: res.status === 500 || res.status === 502 || res.status === 503,
        data: envelope.data,
      },
    );
  }

  return envelope.data as T;
}

export async function aiGetHealth(): Promise<AiHealthData> {
  return agentAiRequest<AiHealthData>(`${AI_PREFIX}/health`, { method: 'GET' });
}

export async function aiFoodIntakeFromText(body: {
  text: string;
  question?: string;
}): Promise<FoodTextIntakeJson> {
  return agentAiRequest(`${AI_PREFIX}/food/intake-from-text`, { method: 'POST', body });
}

export async function aiFoodNutritionFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  supplement_text?: string;
}): Promise<FoodNutritionJson> {
  return agentAiRequest(`${AI_PREFIX}/food/nutrition-from-image`, { method: 'POST', body });
}

export async function aiFoodDailyTargets(body: { context_block: string }): Promise<DailyIntakeTargetsEstimateJson> {
  return agentAiRequest(`${AI_PREFIX}/food/daily-targets`, { method: 'POST', body });
}

export async function aiFinanceParseOneLiner(body: {
  text: string;
  accounts?: FinanceOneLinerAccountHint[];
}): Promise<FinanceOneLinerJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/parse-one-liner`, { method: 'POST', body });
}

export async function aiFinanceParseOneLinerFromImage(body: {
  image_base64: string;
  image_mime_type?: string;
  accounts?: FinanceOneLinerAccountHint[];
}): Promise<FinanceOneLinerJson> {
  return agentAiRequest(`${AI_PREFIX}/finance/parse-one-liner-from-image`, { method: 'POST', body });
}

export async function aiFinanceTxnComment(body: { summary_text: string }): Promise<{ comment: string }> {
  return agentAiRequest(`${AI_PREFIX}/finance/txn-comment`, { method: 'POST', body });
}

export async function aiFinanceBillSummaryAnalysis(body: { summary_text: string }): Promise<{ analysis: string }> {
  return agentAiRequest(`${AI_PREFIX}/finance/bill-summary-analysis`, { method: 'POST', body });
}

export async function aiFinanceDashboardAnalysis(body: {
  summary_text: string;
  past6_net_savings?: number[];
  past6_income?: number[];
}): Promise<AiFinanceDashboardPayload> {
  return agentAiRequest(`${AI_PREFIX}/finance/dashboard-analysis`, { method: 'POST', body });
}

export async function aiFinanceCashFlowAnalysis(body: { summary_text: string }): Promise<{ analysis: string }> {
  return agentAiRequest(`${AI_PREFIX}/finance/cash-flow-analysis`, { method: 'POST', body });
}

export async function aiMemoReview(body: { memo_context_text: string }): Promise<{
  evaluation: string;
  suggestions: string;
}> {
  return agentAiRequest(`${AI_PREFIX}/memo/review`, { method: 'POST', body });
}

export async function aiWeeklyReviewCoaching(body: { user_prompt: string }): Promise<{ text: string }> {
  return agentAiRequest(`${AI_PREFIX}/weekly-review/coaching`, { method: 'POST', body });
}

/** 拆分 data URI 或纯 Base64，供图片类接口使用 */
export function splitImageBase64AndMime(
  input: string,
  defaultMime = 'image/jpeg',
): { image_base64: string; image_mime_type: string } {
  const s = input.trim();
  const m = s.match(/^data:([^;]+);base64,(.+)$/is);
  if (m) {
    const image_mime_type = (m[1] || defaultMime).trim() || defaultMime;
    return { image_mime_type, image_base64: m[2].replace(/\s/g, '') };
  }
  return { image_mime_type: defaultMime, image_base64: s.replace(/\s/g, '') };
}
