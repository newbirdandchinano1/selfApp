/**
 * 智谱 GLM 视觉模型：图片 → JSON（chat/completions）
 * 默认密钥内置在应用中；若设置了 EXPO_PUBLIC_ZHIPU_API_KEY 则优先使用该环境变量（便于轮换而无需改代码）。
 *
 * 另支持豆包（火山方舟 Responses）：在「我的」页切换提供商。密钥优先读 EXPO_PUBLIC_ARK_API_KEY，其次 EXPO_PUBLIC_GEMINI_API_KEY（兼容旧名）；未设置时使用应用内置 Ark 密钥。
 */

import {
  getPreferredAiLlmProviderSync,
  type AiLlmProviderId,
} from '@/lib/ai-llm-provider-preference';
import {
  GEMINI_TEXT_MODEL_DEFAULT,
  GEMINI_VISION_MODEL_DEFAULT,
  geminiGenerateContentWithRetries,
  type GeminiInlineUserPart,
} from '@/lib/gemini-generative';

const ZHIPU_EMBEDDED_API_KEY = 'd0ab5a5e402040d291d9b77f58996d32.nL1sXtGfaUMXzW7W';

/** 内置 Ark 密钥（环境变量 EXPO_PUBLIC_ARK_API_KEY / EXPO_PUBLIC_GEMINI_API_KEY 优先） */
const GEMINI_EMBEDDED_API_KEY =
  'ark-7000f340-7c9e-4c84-8661-c6998ee2aa5f-61452';

const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

/** 智谱 GLM-4-Flash（chat/completions 的 model 字段） */
const ZHIPU_GLM_4_FLASH_MODEL = 'glm-4-flash';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 每次智谱请求结束后的随机间隔（毫秒），降低触发限流概率 */
function zhipuPostRequestCooldownMs(): number {
  return 200 + Math.floor(Math.random() * 101);
}

let zhipuChatRequestTail: Promise<void> = Promise.resolve();

/**
 * 智谱 chat/completions 全局串行：任意时刻仅一条 HTTP 在途；每次调用结束后随机 sleep 200–300ms 再允许下一条。
 */
function runZhipuChatExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = (async (): Promise<T> => {
    await zhipuChatRequestTail;
    try {
      return await fn();
    } finally {
      await sleep(zhipuPostRequestCooldownMs());
    }
  })();
  zhipuChatRequestTail = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

const DEFAULT_JSON_TEMPLATE = `{
  "result": {
    "total_amount": 0,
    "date": "",
    "items": [{"name": "", "price": 0}],
    "is_valid": true
  }
}`;

export type ParseImageToJsonOptions = {
  apiKey: string;
  imageBase64: string;
  /** 不含 data: 前缀的纯 base64 时，由调用方指定 MIME，默认 image/jpeg */
  imageMimeType?: string;
  question?: string;
  jsonTemplate?: string;
};

export type ParseImageToJsonResult =
  | { ok: true; data: unknown; rawContent: string }
  | { ok: false; error: string; httpStatus?: number; details?: unknown };

export async function parseImageToJson(options: ParseImageToJsonOptions): Promise<ParseImageToJsonResult> {
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥' };
  }

  const question = (options.question ?? '分析这张图片').trim() || '分析这张图片';
  const mime = (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg';
  const jsonTemplate = (options.jsonTemplate ?? DEFAULT_JSON_TEMPLATE).trim();

  const systemContent = `你是一个图片解析工具。严格按照以下规则输出：
1. 只返回一个标准JSON对象
2. 完全遵循我给你的JSON格式和字段类型
3. 不要添加任何JSON以外的内容（包括解释、说明、代码块）
4. 如果无法识别某个字段，填null或默认值

必须严格遵循的JSON格式：
${jsonTemplate}`;

  try {
    const dr = await dispatchZhipuOrGeminiVisionChat({
      apiKey: key,
      systemContent,
      userText: question,
      imageBase64: options.imageBase64,
      imageMimeType: mime,
      temperature: 0.1,
      maxTokens: 4096,
      maxAttempts: 8,
      retryDelayMs: 1000,
      forceJsonObject: true,
    });

    if (!dr.ok) {
      return { ok: false, error: dr.error, httpStatus: dr.httpStatus, details: dr.details };
    }

    const content = dr.text.trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripMarkdownJsonFence(content));
    } catch {
      return {
        ok: false,
        error: '模型返回的不是合法 JSON',
        httpStatus: dr.httpStatus,
        details: { contentSnippet: content.slice(0, 500) },
      };
    }

    return { ok: true, data: parsed, rawContent: content };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `网络或解析异常: ${message}` };
  }
}

export function getZhipuApiKeyFromEnv(): string {
  if (typeof process === 'undefined') return '';
  return (process.env.EXPO_PUBLIC_ZHIPU_API_KEY ?? '').trim();
}

/** 环境变量优先，否则使用应用内置密钥 */
export function getZhipuApiKey(): string {
  return getZhipuApiKeyFromEnv() || ZHIPU_EMBEDDED_API_KEY;
}

export function getGeminiApiKeyFromEnv(): string {
  if (typeof process === 'undefined') return '';
  return (process.env.EXPO_PUBLIC_ARK_API_KEY ?? process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '').trim();
}

/** 环境变量优先，否则使用应用内置密钥 */
export function getGeminiApiKey(): string {
  return getGeminiApiKeyFromEnv() || GEMINI_EMBEDDED_API_KEY;
}

export type ZhipuConnectivityProbeResult = {
  httpStatus: number;
  httpOk: boolean;
  bodySnippet: string;
};

/** 最小文本請求，用於「我的」頁連通性測試（顯示原始 JSON）。 */
export async function probeZhipuTextConnectivity(apiKey: string): Promise<ZhipuConnectivityProbeResult> {
  const key = apiKey.trim();
  if (!key) {
    return { httpStatus: 0, httpOk: false, bodySnippet: '未配置 API 金鑰' };
  }
  const payload = JSON.stringify({
    model: ZHIPU_GLM_4_FLASH_MODEL,
    messages: [{ role: 'user', content: '只回复这两个字母：OK' }],
    max_tokens: 32,
    temperature: 0,
  });
  try {
    const response = await runZhipuChatExclusive(() =>
      fetch(ZHIPU_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      }),
    );
    const raw = await response.text();
    return {
      httpStatus: response.status,
      httpOk: response.ok,
      bodySnippet: raw.length > 2400 ? `${raw.slice(0, 2400)}…` : raw,
    };
  } catch (e) {
    return {
      httpStatus: 0,
      httpOk: false,
      bodySnippet: e instanceof Error ? e.message : String(e),
    };
  }
}

/** 按当前用户选择的提供商返回对应 API Key（智谱 / 豆包·Ark）。 */
export function getActiveAiLlmApiKey(): string {
  return getPreferredAiLlmProviderSync() === 'gemini' ? getGeminiApiKey() : getZhipuApiKey();
}

export function isActiveAiLlmConfigured(): boolean {
  return Boolean(getActiveAiLlmApiKey().trim());
}

export function getActiveAiLlmProviderLabel(): '智谱' | '豆包' {
  return getPreferredAiLlmProviderSync() === 'gemini' ? '豆包' : '智谱';
}

export type { AiLlmProviderId };

type DispatchTextChatOk = { ok: true; text: string; attempts: number; httpStatus: number };
type DispatchTextChatFail = {
  ok: false;
  error: string;
  attempts: number;
  httpStatus?: number;
  details?: unknown;
};
type DispatchTextChatResult = DispatchTextChatOk | DispatchTextChatFail;

/**
 * 文本 chat：按用户偏好走智谱 glm-4-flash 或豆包（方舟 Responses）。
 * `forceJsonObject`：智谱侧加 `response_format`；豆包侧在系统提示中附加 JSON 输出约束。
 */
async function dispatchZhipuOrGeminiTextChat(options: {
  apiKey: string;
  systemContent: string;
  userContent: string;
  temperature: number;
  maxTokens: number;
  maxAttempts: number;
  retryDelayMs: number;
  forceJsonObject: boolean;
}): Promise<DispatchTextChatResult> {
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }

  if (getPreferredAiLlmProviderSync() === 'gemini') {
    const gr = await geminiGenerateContentWithRetries({
      apiKey: key,
      model: GEMINI_TEXT_MODEL_DEFAULT,
      systemInstruction: options.systemContent,
      userParts: [{ kind: 'text', text: options.userContent }],
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
      responseMimeType: options.forceJsonObject ? 'application/json' : undefined,
      maxAttempts: options.maxAttempts,
      retryDelayMs: options.retryDelayMs,
    });
    if (!gr.ok) {
      return {
        ok: false,
        error: gr.error,
        attempts: gr.attempts,
        httpStatus: gr.httpStatus,
        details: gr.details,
      };
    }
    return { ok: true, text: gr.text, attempts: gr.attempts, httpStatus: gr.httpStatus };
  }

  const payloadObj: Record<string, unknown> = {
    model: ZHIPU_GLM_4_FLASH_MODEL,
    messages: [
      { role: 'system', content: options.systemContent },
      { role: 'user', content: options.userContent },
    ],
    temperature: options.temperature,
    max_tokens: options.maxTokens,
  };
  if (options.forceJsonObject) {
    payloadObj.response_format = { type: 'json_object' };
  }
  const payload = JSON.stringify(payloadObj);

  let lastError = '未知错误';
  let lastHttp = 0;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await runZhipuChatExclusive(() =>
        fetch(ZHIPU_CHAT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: payload,
        }),
      );
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        attempts: attempt,
        httpStatus: 0,
      };
    }

    const httpStatus = response.status;
    lastHttp = httpStatus;
    const rawText = await response.text();
    let body: unknown = rawText;
    try {
      body = JSON.parse(rawText) as unknown;
    } catch {
      body = rawText;
    }

    if (bodyIndicatesZhipu1305(body) && attempt < options.maxAttempts) {
      await sleep(options.retryDelayMs);
      continue;
    }

    if (!response.ok) {
      const msg =
        typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error?: { message?: string } }).error?.message ?? response.statusText)
          : response.statusText;
      lastError = msg;
      if (bodyIndicatesZhipu1305(body) && attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: body };
    }

    const content = extractMessageContentFromZhipuBody(body);
    if (!content) {
      lastError = '响应中无有效 content';
      if (bodyIndicatesZhipu1305(body) && attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      if (attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: body };
    }

    return { ok: true, text: content, attempts: attempt, httpStatus };
  }

  return { ok: false, error: lastError, attempts: options.maxAttempts, httpStatus: lastHttp };
}

type DispatchVisionChatOk = { ok: true; text: string; attempts: number; httpStatus: number };
type DispatchVisionChatFail = {
  ok: false;
  error: string;
  attempts: number;
  httpStatus?: number;
  details?: unknown;
};
type DispatchVisionChatResult = DispatchVisionChatOk | DispatchVisionChatFail;

/** 视觉：智谱 glm-4.6v-flash 或豆包多模态（识图）。 */
async function dispatchZhipuOrGeminiVisionChat(options: {
  apiKey: string;
  systemContent: string;
  userText: string;
  imageBase64: string;
  imageMimeType: string;
  temperature: number;
  maxTokens: number;
  maxAttempts: number;
  retryDelayMs: number;
  forceJsonObject: boolean;
  /** 智谱视觉模型 id */
  zhipuVisionModel?: string;
}): Promise<DispatchVisionChatResult> {
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const mime = (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg';
  const rawB64 = options.imageBase64?.trim() ?? '';
  if (!rawB64) {
    return { ok: false, error: '图片数据为空', attempts: 0 };
  }

  if (getPreferredAiLlmProviderSync() === 'gemini') {
    const userParts: GeminiInlineUserPart[] = [
      { kind: 'text', text: options.userText },
      { kind: 'image', mimeType: mime, base64: rawB64 },
    ];
    const gr = await geminiGenerateContentWithRetries({
      apiKey: key,
      model: GEMINI_VISION_MODEL_DEFAULT,
      systemInstruction: options.systemContent,
      userParts,
      temperature: options.temperature,
      maxOutputTokens: options.maxTokens,
      responseMimeType: options.forceJsonObject ? 'application/json' : undefined,
      maxAttempts: options.maxAttempts,
      retryDelayMs: options.retryDelayMs,
    });
    if (!gr.ok) {
      return {
        ok: false,
        error: gr.error,
        attempts: gr.attempts,
        httpStatus: gr.httpStatus,
        details: gr.details,
      };
    }
    return { ok: true, text: gr.text, attempts: gr.attempts, httpStatus: gr.httpStatus };
  }

  const dataUrl = mime.includes('/') ? `data:${mime};base64,${rawB64}` : `data:image/jpeg;base64,${rawB64}`;
  const zhipuModel = options.zhipuVisionModel ?? 'glm-4.6v-flash';
  const payloadObj: Record<string, unknown> = {
    model: zhipuModel,
    temperature: options.temperature,
    messages: [
      { role: 'system', content: options.systemContent },
      {
        role: 'user',
        content: [
          { type: 'text', text: options.userText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    max_tokens: options.maxTokens,
  };
  if (options.forceJsonObject) {
    payloadObj.response_format = { type: 'json_object' };
  }
  const payload = JSON.stringify(payloadObj);

  let lastError = '未知错误';
  let lastHttp = 0;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await runZhipuChatExclusive(() =>
        fetch(ZHIPU_CHAT_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          body: payload,
        }),
      );
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        attempts: attempt,
        httpStatus: 0,
      };
    }

    const httpStatus = response.status;
    lastHttp = httpStatus;
    const rawText = await response.text();
    let body: unknown = rawText;
    try {
      body = JSON.parse(rawText) as unknown;
    } catch {
      body = rawText;
    }

    if (bodyIndicatesZhipu1305(body) && attempt < options.maxAttempts) {
      await sleep(options.retryDelayMs);
      continue;
    }

    if (!response.ok) {
      const msg =
        typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error?: { message?: string } }).error?.message ?? response.statusText)
          : response.statusText;
      lastError = msg;
      if (bodyIndicatesZhipu1305(body) && attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: body };
    }

    const content = extractMessageContentFromZhipuBody(body);
    if (!content) {
      lastError = '响应中无有效 content';
      if (bodyIndicatesZhipu1305(body) && attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      if (attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: body };
    }

    return { ok: true, text: content, attempts: attempt, httpStatus };
  }

  return { ok: false, error: lastError, attempts: options.maxAttempts, httpStatus: lastHttp };
}

type LoopTextJsonFinish<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; details?: unknown };

/**
 * 文本 JSON：外层重试（智谱 1305 / 豆包 429、503 与 JSON 解析失败），每次请求内为单轮 dispatch。
 */
async function loopTextJsonLlmWithRetries<T>(options: {
  apiKey: string;
  systemContent: string;
  userContent: string;
  temperature: number;
  maxTokens: number;
  maxAttempts: number;
  retryDelayMs: number;
  finish: (parsed: unknown, rawText: string, attempt: number) => LoopTextJsonFinish<T>;
}): Promise<
  | { ok: true; value: T; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown }
> {
  let lastError = '未知错误';
  let lastHttp = 0;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const dr = await dispatchZhipuOrGeminiTextChat({
      apiKey: options.apiKey,
      systemContent: options.systemContent,
      userContent: options.userContent,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      maxAttempts: 1,
      retryDelayMs: 0,
      forceJsonObject: true,
    });
    if (!dr.ok) {
      lastError = dr.error;
      lastHttp = dr.httpStatus ?? 0;
      const p = getPreferredAiLlmProviderSync();
      const retryable =
        (p === 'zhipu' && bodyIndicatesZhipu1305(dr.details)) ||
        (p === 'gemini' && (dr.httpStatus === 429 || dr.httpStatus === 503));
      if (retryable && attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus: lastHttp, details: dr.details };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripMarkdownJsonFence(dr.text)) as unknown;
    } catch {
      lastError = '模型返回的不是合法 JSON';
      if (attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return {
        ok: false,
        error: lastError,
        attempts: attempt,
        httpStatus: dr.httpStatus,
        details: { snippet: dr.text.slice(0, 400) },
      };
    }
    const fin = options.finish(parsed, dr.text.trim(), attempt);
    if (fin.ok) {
      return { ok: true, value: fin.value, rawContent: dr.text.trim(), attempts: attempt };
    }
    lastError = fin.error;
    if (attempt < options.maxAttempts) {
      await sleep(options.retryDelayMs);
      continue;
    }
    return { ok: false, error: lastError, attempts: attempt, httpStatus: dr.httpStatus, details: fin.details };
  }
  return { ok: false, error: lastError, attempts: options.maxAttempts, httpStatus: lastHttp };
}

type LoopVisionJsonFinish<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; details?: unknown };

/** 视觉 JSON：与 `loopTextJsonLlmWithRetries` 同理，走识图模型。 */
async function loopVisionJsonLlmWithRetries<T>(options: {
  apiKey: string;
  systemContent: string;
  userText: string;
  imageBase64: string;
  imageMimeType: string;
  temperature: number;
  maxTokens: number;
  maxAttempts: number;
  retryDelayMs: number;
  zhipuVisionModel?: string;
  finish: (parsed: unknown, rawText: string, attempt: number) => LoopVisionJsonFinish<T>;
}): Promise<
  | { ok: true; value: T; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown }
> {
  let lastError = '未知错误';
  let lastHttp = 0;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const dr = await dispatchZhipuOrGeminiVisionChat({
      apiKey: options.apiKey,
      systemContent: options.systemContent,
      userText: options.userText,
      imageBase64: options.imageBase64,
      imageMimeType: options.imageMimeType,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      maxAttempts: 1,
      retryDelayMs: 0,
      forceJsonObject: true,
      zhipuVisionModel: options.zhipuVisionModel,
    });
    if (!dr.ok) {
      lastError = dr.error;
      lastHttp = dr.httpStatus ?? 0;
      const p = getPreferredAiLlmProviderSync();
      const retryable =
        (p === 'zhipu' && bodyIndicatesZhipu1305(dr.details)) ||
        (p === 'gemini' && (dr.httpStatus === 429 || dr.httpStatus === 503));
      if (retryable && attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus: lastHttp, details: dr.details };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripMarkdownJsonFence(dr.text)) as unknown;
    } catch {
      lastError = '模型返回的不是合法 JSON';
      if (attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return {
        ok: false,
        error: lastError,
        attempts: attempt,
        httpStatus: dr.httpStatus,
        details: { snippet: dr.text.slice(0, 400) },
      };
    }
    const fin = options.finish(parsed, dr.text.trim(), attempt);
    if (fin.ok) {
      return { ok: true, value: fin.value, rawContent: dr.text.trim(), attempts: attempt };
    }
    lastError = fin.error;
    if (attempt < options.maxAttempts) {
      await sleep(options.retryDelayMs);
      continue;
    }
    return { ok: false, error: lastError, attempts: attempt, httpStatus: dr.httpStatus, details: fin.details };
  }
  return { ok: false, error: lastError, attempts: options.maxAttempts, httpStatus: lastHttp };
}

/** 纯文本（无 JSON 约束），用于每周复盘教练等。 */
async function loopPlainTextLlmWithRetries(options: {
  apiKey: string;
  systemContent: string;
  userContent: string;
  temperature: number;
  maxTokens: number;
  maxAttempts: number;
  retryDelayMs: number;
}): Promise<
  | { ok: true; text: string; attempts: number; httpStatus: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown }
> {
  let lastError = '未知错误';
  let lastHttp = 0;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const dr = await dispatchZhipuOrGeminiTextChat({
      apiKey: options.apiKey,
      systemContent: options.systemContent,
      userContent: options.userContent,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      maxAttempts: 1,
      retryDelayMs: 0,
      forceJsonObject: false,
    });
    if (!dr.ok) {
      lastError = dr.error;
      lastHttp = dr.httpStatus ?? 0;
      const p = getPreferredAiLlmProviderSync();
      const retryable =
        (p === 'zhipu' && bodyIndicatesZhipu1305(dr.details)) ||
        (p === 'gemini' && (dr.httpStatus === 429 || dr.httpStatus === 503));
      if (retryable && attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus: lastHttp, details: dr.details };
    }
    const t = dr.text.trim();
    if (!t) {
      lastError = '响应中无有效文本';
      if (attempt < options.maxAttempts) {
        await sleep(options.retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus: dr.httpStatus };
    }
    return { ok: true, text: t, attempts: attempt, httpStatus: dr.httpStatus };
  }
  return { ok: false, error: lastError, attempts: options.maxAttempts, httpStatus: lastHttp };
}

/** 纯文字描述一餐 → 估算蛋白质、碳水、钠与「应计入」的水分（毫升） */
export type FoodTextIntakeJson = {
  food_summary: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  sodium_mg: number;
  /** 1～3 句口语化中文，从均衡/控盐/搭配等角度点评 */
  ai_evaluation: string;
};

export type ParseFoodIntakeFromTextOptions = {
  apiKey: string;
  text: string;
  /** 默认：分析这段饮食描述并估算营养 */
  question?: string;
};

export type ParseFoodIntakeFromTextResult =
  | { ok: true; data: FoodTextIntakeJson; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

const FOOD_TEXT_INTAKE_JSON_TEMPLATE = `{
  "result": {
    "food_summary": "",
    "hydration_ml": 0,
    "protein_g": 0,
    "carbohydrate_g": 0,
    "sodium_mg": 0,
    "ai_evaluation": ""
  }
}`;

function normalizeFoodTextIntakeFromResult(raw: unknown): FoodTextIntakeJson {
  const empty: FoodTextIntakeJson = {
    food_summary: '',
    hydration_ml: 0,
    protein_g: 0,
    carbohydrate_g: 0,
    sodium_mg: 0,
    ai_evaluation: '',
  };
  if (typeof raw !== 'object' || raw === null) return empty;
  const root = raw as Record<string, unknown>;
  const r = root.result;
  if (typeof r !== 'object' || r === null) return empty;
  const o = r as Record<string, unknown>;
  const summary =
    typeof o.food_summary === 'string'
      ? o.food_summary.trim()
      : o.food_summary != null
        ? String(o.food_summary).trim()
        : '';
  const evalRaw = o.ai_evaluation;
  const ai_evaluation =
    typeof evalRaw === 'string'
      ? evalRaw.trim()
      : evalRaw != null
        ? String(evalRaw).trim()
        : '';
  return {
    food_summary: summary,
    hydration_ml: toNonNegativeFiniteNumber(o.hydration_ml),
    protein_g: toNonNegativeFiniteNumber(o.protein_g),
    carbohydrate_g: toNonNegativeFiniteNumber(o.carbohydrate_g),
    sodium_mg: toNonNegativeFiniteNumber(o.sodium_mg),
    ai_evaluation,
  };
}

/**
 * 根据用户中文饮食描述估算 hydration_ml、protein_g、carbohydrate_g、sodium_mg。
 * hydration_ml 仅计汤/粥/饮料/水果等；正餐固体不显性计水（见系统提示）。
 * 含 1305 重试与 JSON 围栏剥离。
 */
export async function parseFoodIntakeFromText(
  options: ParseFoodIntakeFromTextOptions,
): Promise<ParseFoodIntakeFromTextResult> {
  const maxAttempts = 40;
  const retryDelayMs = 1000;
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.text.trim();
  if (!text) {
    return { ok: false, error: '描述为空', attempts: 0 };
  }
  const question = (options.question ?? '分析这段饮食描述，估算蛋白质、碳水化合物、钠与应计入记录的水分（毫升）').trim();

  const systemContent = `只返回严格JSON，不要任何解释和markdown（含代码块）。顶层为一个对象，且必须包含 result；result 内字段：food_summary（简短中文概括所吃所喝）、hydration_ml、protein_g、carbohydrate_g、sodium_mg、ai_evaluation。

hydration_ml（毫升，非负）的计入规则（必须遵守）：
- **应计入**：用户明确提到的汤、羹、粥、饮品（水、茶、咖啡、奶茶、果汁、汽水、酒等）、牛奶/豆浆等流质、以及**水果**中可视为饮水的部分（可用常见经验估算，如一个中等苹果约对应少量水等，合理即可）。
- **严禁计入**：米饭、面条、馒头、面包、炒菜、炖肉、烧烤、点心等**正餐固体食物**内部的隐性水分（菜肴「自带」的水、油焖蒸发的水等一律不要折算进 hydration_ml）。若描述里只有这类正餐、没有任何汤粥饮料水果等可饮水来源，则 hydration_ml 必须为 0。
- protein_g、carbohydrate_g、sodium_mg 为非负数值，无法从描述推断时填 0。
- ai_evaluation：1～3 句口语化中文，从均衡膳食、控盐、搭配等角度点评这一餐；勿重复罗列数字。

必须遵循的形状：
${FOOD_TEXT_INTAKE_JSON_TEMPLATE}`;

  let lastError = '未知错误';
  let lastHttp = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const dr = await dispatchZhipuOrGeminiTextChat({
      apiKey: key,
      systemContent,
      userContent: `${question}：${text}`,
      temperature: 0.0,
      maxTokens: 1024,
      maxAttempts: 1,
      retryDelayMs: 0,
      forceJsonObject: true,
    });

    if (!dr.ok) {
      lastError = dr.error;
      lastHttp = dr.httpStatus ?? 0;
      const p = getPreferredAiLlmProviderSync();
      const retryable =
        (p === 'zhipu' && bodyIndicatesZhipu1305(dr.details)) ||
        (p === 'gemini' && (dr.httpStatus === 429 || dr.httpStatus === 503));
      if (retryable && attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus: lastHttp, details: dr.details };
    }

    const content = dr.text.trim();
    let parsed: unknown;
    try {
      const cleaned = stripMarkdownJsonFence(content);
      parsed = JSON.parse(cleaned) as unknown;
    } catch {
      lastError = '模型返回的不是合法 JSON';
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus: dr.httpStatus, details: { snippet: content.slice(0, 400) } };
    }

    const data = normalizeFoodTextIntakeFromResult(parsed);
    return { ok: true, data, rawContent: content, attempts: attempt };
  }

  return { ok: false, error: lastError, attempts: maxAttempts, httpStatus: lastHttp };
}

const FINANCE_STATS_ANALYSIS_JSON_HINT = `{"analysis":"2～5句中文个人财务建议，口语化、可操作，不要markdown"}`;

export type AnalyzeFinanceBillSummaryFromTextOptions = {
  apiKey: string;
  /** 中文统计摘要，由调用方从本地账单聚合生成 */
  summaryText: string;
  /** 遇到 1305 等可重试错误时的最大请求次数（含首次），默认 12 */
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeFinanceBillSummaryFromTextResult =
  | { ok: true; analysis: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFinanceStatsAnalysisJson(parsed: unknown): string {
  if (typeof parsed !== 'object' || parsed === null) return '';
  const o = parsed as Record<string, unknown>;
  const raw = o.analysis;
  const s = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : '';
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}

/**
 * 根据账单统计摘要生成简短中文建议（智谱 glm-4-flash，JSON 含 analysis 字段）。
 * 与 `parseFoodIntakeFromText` 类似：串行队列、1305 重试、JSON 围栏剥离。
 */
export async function analyzeFinanceBillSummaryFromText(
  options: AnalyzeFinanceBillSummaryFromTextOptions,
): Promise<AnalyzeFinanceBillSummaryFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 12);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 1000);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.summaryText.trim();
  if (!text) {
    return { ok: false, error: '摘要为空', attempts: 0 };
  }

  const systemContent = `你是个人记账应用里的财务助手。用户会提供一段时间内的本地记账统计摘要（中文，已脱敏聚合）。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含字段 analysis（字符串）：
- 用 2～5 句口语化中文，从消费习惯、储蓄、分类结构、可执行的小建议等角度点评；
- 不要重复罗列摘要中的每一个数字；不要捏造摘要中未出现的交易或金额；
- 若摘要显示几乎没有收支或笔数为 0，仅友好说明需要多记账才能分析习惯。

输出形状示例（内容替换为你的生成）：${FINANCE_STATS_ANALYSIS_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<string>({
    apiKey: key,
    systemContent,
    userContent: `以下是统计摘要，请生成 analysis 字段：\n\n${text}`,
    temperature: 0.25,
    maxTokens: 600,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const analysis = normalizeFinanceStatsAnalysisJson(parsed);
      if (!analysis) {
        return { ok: false, error: '模型未返回有效的 analysis 文案', details: parsed };
      }
      return { ok: true, value: analysis };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return { ok: true, analysis: lr.value, rawContent: lr.rawContent, attempts: lr.attempts };
}

const CASH_FLOW_DASHBOARD_JSON_HINT = `{"analysis":"3～7句中文建议，口语化、可操作，不要markdown"}`;

export type AnalyzeCashFlowDashboardFromTextOptions = {
  apiKey: string;
  /** 由调用方从本地现金流图状态与汇总指标组装的结构化中文摘要 */
  summaryText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeCashFlowDashboardFromTextResult =
  | { ok: true; analysis: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

/**
 * 根据「现金流图」页本地数据摘要生成中文分析与建议（智谱 glm-4-flash，JSON 含 analysis 字段）。
 */
export async function analyzeCashFlowDashboardFromText(
  options: AnalyzeCashFlowDashboardFromTextOptions,
): Promise<AnalyzeCashFlowDashboardFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 12);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 1000);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.summaryText.trim();
  if (!text) {
    return { ok: false, error: '摘要为空', attempts: 0 };
  }

  const systemContent = `你是个人财务应用里「现金流图」模块的顾问，熟悉 ESBI 四象限、主动/被动收入、资产负债净现金流与自由现金流等概念。
用户会提供从本地数据库聚合的中文摘要（已脱敏为名称与金额，无真实账号）。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含字段 analysis（字符串）：
- 用 3～7 句口语化中文，综合点评当前结构（如被动收入占比、财务自由进度、负债消耗、非必要支出、资产性净流入等），给出可执行的下一步建议；
- 不要逐条复读摘要里的每一个数字；不要捏造摘要中未出现的条目或金额；
- 若数据几乎为空，友好引导用户先补全收入、支出与资产负债台账。

输出形状示例（内容替换为你的生成）：${CASH_FLOW_DASHBOARD_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<string>({
    apiKey: key,
    systemContent,
    userContent: `以下是用户现金流图数据摘要，请生成 analysis 字段：\n\n${text}`,
    temperature: 0.3,
    maxTokens: 800,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const analysis = normalizeFinanceStatsAnalysisJson(parsed);
      if (!analysis) {
        return { ok: false, error: '模型未返回有效的 analysis 文案', details: parsed };
      }
      return { ok: true, value: analysis };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return { ok: true, analysis: lr.value, rawContent: lr.rawContent, attempts: lr.attempts };
}

const WISH_LIST_RATIONAL_REVIEW_JSON_HINT = `{"headline":"一句中文概括（建议不超过24字）","review":"2～6句理性消费分析与建议，口语化、可操作，不要markdown"}`;

export type AnalyzeWishListRationalReviewFromTextOptions = {
  apiKey: string;
  /** 心愿清单与汇总的中文上下文，由调用方从本地数据组装 */
  contextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeWishListRationalReviewFromTextResult =
  | { ok: true; headline: string; review: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeWishListRationalReviewJson(parsed: unknown): { headline: string; review: string } | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  let headline = typeof o.headline === 'string' ? o.headline.trim() : '';
  let review = typeof o.review === 'string' ? o.review.trim() : '';
  if (!review && typeof o.analysis === 'string') {
    review = (o.analysis as string).trim();
  }
  if (!review && typeof o.body === 'string') {
    review = (o.body as string).trim();
  }
  if (!headline && typeof o.title === 'string') {
    headline = (o.title as string).trim();
  }
  if (headline.length > 48) headline = `${headline.slice(0, 45)}…`;
  if (review.length > 1200) review = `${review.slice(0, 1197)}…`;
  if (!review) return null;
  if (!headline) {
    const one = review.split(/[。！？\n]/)[0]?.trim() ?? review;
    headline = one.length > 24 ? `${one.slice(0, 21)}…` : one || '理性消费评审';
  }
  return { headline, review };
}

/**
 * 根据本地心愿清单摘要生成「理性消费」中文标题与正文（智谱 glm-4-flash，JSON）。
 */
export async function analyzeWishListRationalReviewFromText(
  options: AnalyzeWishListRationalReviewFromTextOptions,
): Promise<AnalyzeWishListRationalReviewFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 8);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 800);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.contextText.trim();
  if (!text) {
    return { ok: false, error: '清单上下文为空', attempts: 0 };
  }

  const systemContent = `你是个人生活规划应用里的消费顾问。用户会提供本地「欲望/心愿清单」的聚合摘要（中文，已脱敏；仅名称、价格、欲望等级、类别与自填理由等）。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含两个字符串字段：
- headline：用一句话概括当前清单的消费风险或优先级焦点，建议不超过 24 个汉字，语气克制、不羞辱用户。
- review：用 2～6 句口语化中文，从必要性、预算压力、欲望等级与理由一致性、可延后或替代方案等角度给出理性建议；不要重复逐条念清单；不要捏造摘要中未出现的商品或金额；若条目很少，可鼓励先沉淀需求再下单。

输出形状示例（内容须替换为你的生成）：${WISH_LIST_RATIONAL_REVIEW_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<{ headline: string; review: string }>({
    apiKey: key,
    systemContent,
    userContent: `以下是心愿清单上下文，请生成 headline 与 review 字段：\n\n${text}`,
    temperature: 0.35,
    maxTokens: 800,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const normalized = normalizeWishListRationalReviewJson(parsed);
      if (!normalized) {
        return { ok: false, error: '模型未返回有效的评审正文', details: parsed };
      }
      return { ok: true, value: normalized };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return {
    ok: true,
    headline: lr.value.headline,
    review: lr.value.review,
    rawContent: lr.rawContent,
    attempts: lr.attempts,
  };
}

/** 人格画像页：智谱 glm-4-flash 返回的统一 JSON 形状 */
export type PersonaPortraitAiData = {
  hero_kicker: string;
  hero_main: string;
  hero_caption: string;
  overview: string;
  bullets: string[];
  stats: { label: string; value: string; hint: string }[];
  milestones: string[];
  dims: { title: string; sub: string }[];
  /** 综合洞察（ai-insight）主段落；其它 slug 可与 overview 配合 */
  ai_quote: string;
};

const PERSONA_PORTRAIT_JSON_HINT = `{"hero_kicker":"","hero_main":"","hero_caption":"","overview":"","bullets":[],"stats":[],"milestones":[],"dims":[],"ai_quote":""}`;

export type GeneratePersonaPortraitOptions = {
  apiKey: string;
  /** plan-completion | body-composition | hydration | savings | ai-insight */
  personaSlug: string;
  /** 中文本地数据摘要，由调用方组装 */
  contextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type GeneratePersonaPortraitResult =
  | { ok: true; data: PersonaPortraitAiData; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function clipPersonaStr(s: string, max: number): string {
  const t = s.trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, Math.max(0, max - 1))}…`;
}

function normalizePersonaPortraitJson(parsed: unknown): PersonaPortraitAiData {
  const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const topStr = (key: string, max: number, fallback: string) => {
    const v = o[key];
    const s = typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : '';
    return s ? clipPersonaStr(s, max) : fallback;
  };

  let bullets: string[] = [];
  if (Array.isArray(o.bullets)) {
    bullets = o.bullets
      .map(x => (typeof x === 'string' ? x : String(x)).trim())
      .filter(Boolean)
      .slice(0, 4)
      .map(s => clipPersonaStr(s, 180));
  }

  const stats: { label: string; value: string; hint: string }[] = [];
  if (Array.isArray(o.stats)) {
    for (const row of o.stats.slice(0, 3)) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const label = typeof r.label === 'string' ? clipPersonaStr(r.label, 28) : clipPersonaStr(String(r.label ?? ''), 28);
      const value = typeof r.value === 'string' ? clipPersonaStr(r.value, 24) : clipPersonaStr(String(r.value ?? ''), 24);
      const hint = typeof r.hint === 'string' ? clipPersonaStr(r.hint, 48) : clipPersonaStr(String(r.hint ?? ''), 48);
      if (label || value || hint) stats.push({ label: label || '项', value: value || '—', hint });
    }
  }

  let milestones: string[] = [];
  if (Array.isArray(o.milestones)) {
    milestones = o.milestones
      .map(x => clipPersonaStr(typeof x === 'string' ? x : String(x), 140))
      .filter(Boolean)
      .slice(0, 5);
  }

  const dims: { title: string; sub: string }[] = [];
  if (Array.isArray(o.dims)) {
    for (const row of o.dims.slice(0, 5)) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const title = typeof r.title === 'string' ? clipPersonaStr(r.title, 36) : clipPersonaStr(String(r.title ?? ''), 36);
      const sub = typeof r.sub === 'string' ? clipPersonaStr(r.sub, 90) : clipPersonaStr(String(r.sub ?? ''), 90);
      if (title || sub) dims.push({ title: title || '维度', sub });
    }
  }

  return {
    hero_kicker: topStr('hero_kicker', 28, 'INSIGHT'),
    hero_main: topStr('hero_main', 40, '—'),
    hero_caption: topStr('hero_caption', 100, ''),
    overview: topStr('overview', 900, ''),
    bullets,
    stats,
    milestones,
    dims,
    ai_quote: topStr('ai_quote', 520, ''),
  };
}

function personaPortraitHasUsefulBody(d: PersonaPortraitAiData): boolean {
  if (d.overview.trim().length >= 12) return true;
  if (d.ai_quote.trim().length >= 12) return true;
  if (d.bullets.some(b => b.trim().length >= 8)) return true;
  return false;
}

/**
 * 根据本地摘要生成「AI 人格画像」展示用 JSON（智谱 glm-4-flash）。
 * 与账单分析相同：串行队列、1305 重试、JSON 围栏剥离。
 */
export async function generatePersonaPortraitFromContext(
  options: GeneratePersonaPortraitOptions,
): Promise<GeneratePersonaPortraitResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 10);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 900);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const slug = options.personaSlug.trim();
  if (!slug) {
    return { ok: false, error: 'personaSlug 为空', attempts: 0 };
  }
  const text = options.contextText.trim();
  if (!text) {
    return { ok: false, error: '数据摘要为空', attempts: 0 };
  }

  const systemContent = `你是自我管理类 App 里的「人格画像」文案生成器。用户会提供 persona_slug 与一段「本地真实数据摘要」（中文，已聚合脱敏）。
你必须只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。

硬性规则：
1) 语气：简体中文、温暖、具体、像懂心理学的朋友；避免说教与恐吓式措辞。
2) 事实：不要编造摘要里未出现的具体金额、天数、百分比、体脂率、诊断；摘要不足时坦诚样本少，并给温和、通用的微习惯建议。
3) 医疗：身体成分、饮水、营养相关文案仅供生活方式参考，不得给出疾病诊断或用药建议。
4) 字段必须齐全（可填空字符串或空数组），类型与示例一致。

persona_slug 含义（决定侧重点，但仍需填满所有字段；不适用的数组可给 0～3 条或留空数组）：
- plan-completion：任务完成、青蛙优先级、闭环节奏。
- body-composition：身高体重 BMI、身体自律侧写（非医疗）。
- hydration：饮水均值与目标、节律与自我照料。
- savings：储蓄/记账/延迟满足倾向（基于摘要中的数字）。
- ai-insight：综合其它维度的一段「总评」式洞察，dims 给 3 条维度拆解。

输出形状示例（请替换内容）：${PERSONA_PORTRAIT_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<PersonaPortraitAiData>({
    apiKey: key,
    systemContent,
    userContent: `persona_slug=${slug}\n\n以下是用户本地数据摘要：\n\n${text}`,
    temperature: 0.35,
    maxTokens: 1400,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const data = normalizePersonaPortraitJson(parsed);
      if (!personaPortraitHasUsefulBody(data)) {
        return { ok: false, error: '模型返回内容过短或无效', details: parsed };
      }
      return { ok: true, value: data };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return { ok: true, data: lr.value, rawContent: lr.rawContent, attempts: lr.attempts };
}

const FINANCE_TXN_COMMENT_JSON_HINT = `{"comment":"一句口语化中文点评，约20～40字"}`;

export type AnalyzeFinanceTxnCommentFromTextOptions = {
  apiKey: string;
  /** 单条记账的中文描述（类型、金额、名称、分类、时间等） */
  summaryText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeFinanceTxnCommentFromTextResult =
  | { ok: true; comment: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFinanceTxnCommentJson(parsed: unknown): string {
  const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const raw = o.comment;
  let s = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : '';
  s = s.replace(/^(AI|点评|评价)[：:\s]*/i, '').trim();
  if (s.length > 120) s = `${s.slice(0, 117)}…`;
  return s;
}

/**
 * 为单条收支/转账记录生成一句简短中文 AI 评价（智谱 glm-4-flash，JSON 含 comment 字段）。
 */
export async function analyzeFinanceTxnCommentFromText(
  options: AnalyzeFinanceTxnCommentFromTextOptions,
): Promise<AnalyzeFinanceTxnCommentFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 8);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 800);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.summaryText.trim();
  if (!text) {
    return { ok: false, error: '摘要为空', attempts: 0 };
  }

  const systemContent = `你是个人记账应用里的财务助手。用户会提供「单条」本地记账摘要（中文）。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含字段 comment（字符串）：
- 用 1 句口语化中文点评该笔记录（习惯、预算感、记账清晰度、转账合理性等择一相关角度即可）；
- 不要重复罗列摘要里的金额数字串；不要捏造摘要中未出现的商户或场景；
- 长度控制在 40 字以内为佳，最多不超过 80 字；
- 转账类可简短提醒注意账户对应关系即可。

输出形状示例（内容替换为你的生成）：${FINANCE_TXN_COMMENT_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<string>({
    apiKey: key,
    systemContent,
    userContent: `以下是单条记账摘要，请生成 comment 字段：\n\n${text}`,
    temperature: 0.35,
    /** 豆包 seed 等模型可能在 JSON 前消耗较多输出额度；200 易截断导致解析失败，智谱侧略放宽无妨。 */
    maxTokens: 1024,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const comment = normalizeFinanceTxnCommentJson(parsed);
      if (!comment) {
        return { ok: false, error: '模型未返回有效的 comment 文案', details: parsed };
      }
      return { ok: true, value: comment };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return { ok: true, comment: lr.value, rawContent: lr.rawContent, attempts: lr.attempts };
}

const WISH_ITEM_AI_COMMENT_JSON_HINT = `{"comment":"2～4句理性消费与必要性角度的中文点评，口语化、不羞辱用户"}`;

export type AnalyzeWishItemAiCommentFromTextOptions = {
  apiKey: string;
  /** 单条心愿的中文摘要（名称、价格、欲望等级、类别、理由等） */
  summaryText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeWishItemAiCommentFromTextResult =
  | { ok: true; comment: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeWishItemAiCommentJson(parsed: unknown): string {
  const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const raw = o.comment;
  let s = typeof raw === 'string' ? raw.trim() : raw != null ? String(raw).trim() : '';
  s = s.replace(/^(AI|点评|评价)[：:\s]*/i, '').trim();
  if (s.length > 520) s = `${s.slice(0, 517)}…`;
  return s;
}

/**
 * 为单条「欲望/心愿」条目生成理性消费向中文评价（智谱 glm-4-flash，JSON 含 comment 字段）。
 */
export async function analyzeWishItemAiCommentFromText(
  options: AnalyzeWishItemAiCommentFromTextOptions,
): Promise<AnalyzeWishItemAiCommentFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 8);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 800);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.summaryText.trim();
  if (!text) {
    return { ok: false, error: '摘要为空', attempts: 0 };
  }

  const systemContent = `你是个人生活规划应用里的消费顾问。用户会提供「单条」本地心愿/欲望清单摘要（中文，已脱敏）。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含字段 comment（字符串）：
- 用 2～4 句口语化中文，从必要性、预算感、欲望等级与理由是否自洽、可延后或替代思路等角度点评；
- 语气克制、友善，不羞辱用户；不要编造摘要中未出现的商品细节或金额；
- 总字数建议 80～260 字，不要超过 400 字。

输出形状示例（内容替换为你的生成）：${WISH_ITEM_AI_COMMENT_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<string>({
    apiKey: key,
    systemContent,
    userContent: `以下是单条心愿摘要，请生成 comment 字段：\n\n${text}`,
    temperature: 0.35,
    maxTokens: 520,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const comment = normalizeWishItemAiCommentJson(parsed);
      if (!comment) {
        return { ok: false, error: '模型未返回有效的 comment 文案', details: parsed };
      }
      return { ok: true, value: comment };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return { ok: true, comment: lr.value, rawContent: lr.rawContent, attempts: lr.attempts };
}

const MEMO_REVIEW_JSON_HINT = `{"evaluation":"约80～200字的中文评价","suggestions":"3～6条可执行建议，可用换行分隔"}`;

export type AnalyzeMemoReviewFromTextOptions = {
  apiKey: string;
  /** 完整备忘文本：含标题与正文，由调用方格式化 */
  memoContextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeMemoReviewFromTextResult =
  | { ok: true; evaluation: string; suggestions: string; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

/** 备忘等场景限制长度；缺点 AI 用 full 保留模型全文，不在此截断。 */
export type MemoReviewJsonNormalizeMode = 'memo' | 'full';

function normalizeMemoReviewJson(
  parsed: unknown,
  mode: MemoReviewJsonNormalizeMode = 'memo',
): { evaluation: string; suggestions: string } | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  let evaluation = typeof o.evaluation === 'string' ? o.evaluation.trim() : '';
  let suggestions = typeof o.suggestions === 'string' ? o.suggestions.trim() : '';
  if (!evaluation && typeof o.comment === 'string') {
    evaluation = (o.comment as string).trim();
  }
  if (!suggestions && typeof o.advice === 'string') {
    suggestions = (o.advice as string).trim();
  }
  if (mode === 'memo') {
    if (evaluation.length > 500) evaluation = `${evaluation.slice(0, 497)}…`;
    if (suggestions.length > 800) suggestions = `${suggestions.slice(0, 797)}…`;
  }
  if (!evaluation && !suggestions) return null;
  if (!evaluation) evaluation = '（模型未单独输出评价，见下方建议。）';
  if (!suggestions) suggestions = '（模型未单独输出建议，可结合上文评价自行拆解行动项。）';
  return { evaluation, suggestions };
}

async function runZhipuJsonEvaluationSuggestionsReview(options: {
  apiKey: string;
  contextText: string;
  emptyContextError: string;
  systemInstruction: string;
  userMessage: string;
  maxAttempts?: number;
  retryDelayMs?: number;
  /** 默认 memo：截断过长字段；full 保留全文（缺点分析等） */
  reviewJsonNormalize?: MemoReviewJsonNormalizeMode;
  maxTokens?: number;
}): Promise<AnalyzeMemoReviewFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 8);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 800);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.contextText.trim();
  if (!text) {
    return { ok: false, error: options.emptyContextError, attempts: 0 };
  }

  const normalizeMode = options.reviewJsonNormalize ?? 'memo';
  const maxTokens = options.maxTokens ?? 900;

  const lr = await loopTextJsonLlmWithRetries<{ evaluation: string; suggestions: string }>({
    apiKey: key,
    systemContent: options.systemInstruction,
    userContent: options.userMessage,
    temperature: 0.4,
    maxTokens,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const normalized = normalizeMemoReviewJson(parsed, normalizeMode);
      if (!normalized) {
        return { ok: false, error: '模型未返回有效的评价与建议', details: parsed };
      }
      return {
        ok: true,
        value: { evaluation: normalized.evaluation, suggestions: normalized.suggestions },
      };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return {
    ok: true,
    evaluation: lr.value.evaluation,
    suggestions: lr.value.suggestions,
    rawContent: lr.rawContent,
    attempts: lr.attempts,
  };
}

/**
 * 根据单条备忘录的标题与正文生成中文「评价」与「建议」（智谱 glm-4-flash，JSON）。
 */
export async function analyzeMemoReviewFromText(
  options: AnalyzeMemoReviewFromTextOptions,
): Promise<AnalyzeMemoReviewFromTextResult> {
  const text = options.memoContextText.trim();
  return runZhipuJsonEvaluationSuggestionsReview({
    apiKey: options.apiKey,
    contextText: text,
    emptyContextError: '备忘内容为空',
    systemInstruction: `你是个人效率应用里的备忘教练。用户会提供一条本地备忘录的「标题」与「正文」（均为中文或中英混排）。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含两个字符串字段：
- evaluation：对这条备忘内容的整体评价（是否清晰、是否可执行、是否缺关键信息等），2～5 句中文，总字数约 80～220 字；语气友善、具体，不要人身攻击；不要编造用户未写明的具体日程或金额。
- suggestions：基于该备忘给出的 3～6 条可执行改进建议（如何改写、如何拆任务、如何补全要素等），用中文分号或换行分隔即可，总字数建议不超过 400 字。

输出形状示例（内容须替换为你的生成）：${MEMO_REVIEW_JSON_HINT}`,
    userMessage: `请根据以下备忘录内容生成 evaluation 与 suggestions 字段：\n\n${text}`,
    maxAttempts: options.maxAttempts,
    retryDelayMs: options.retryDelayMs,
  });
}

const WEEKLY_REVIEW_COACHING_SYSTEM_PROMPT =
  '你是资深生活与效率教练，用简体中文回复。用户在做「每周复盘」，并可能附带近七日「每日复盘」原文。请输出结构化文本，须包含以下小节标题（逐字）：【总览】【对齐用户写下的重点】【数据侧参考】【建议与修正提醒】【下周可做的一件事】【温和结语】。语气真诚、具体、避免说教；若用户内容涉及心理危机，提醒寻求专业帮助。不要编造用户未提及的事实；每日复盘仅作线索，与周记冲突时以周记为主并温和指出差异。';

export type GenerateWeeklyReviewCoachingFromTextOptions = {
  apiKey: string;
  userPrompt: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type GenerateWeeklyReviewCoachingFromTextResult =
  | { ok: true; text: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

/**
 * 每周复盘：纯文本教练回复（智谱 glm-4-flash；与项目内其他智谱能力共用密钥与请求排队）。
 */
export async function generateWeeklyReviewCoachingFromText(
  options: GenerateWeeklyReviewCoachingFromTextOptions,
): Promise<GenerateWeeklyReviewCoachingFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 6);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 800);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const userPrompt = options.userPrompt.trim();
  if (!userPrompt) {
    return { ok: false, error: '复盘内容为空', attempts: 0 };
  }

  const pr = await loopPlainTextLlmWithRetries({
    apiKey: key,
    systemContent: WEEKLY_REVIEW_COACHING_SYSTEM_PROMPT,
    userContent: userPrompt,
    temperature: 0.65,
    maxTokens: 2048,
    maxAttempts,
    retryDelayMs,
  });

  if (!pr.ok) {
    return { ok: false, error: pr.error, attempts: pr.attempts, httpStatus: pr.httpStatus, details: pr.details };
  }
  return { ok: true, text: pr.text, attempts: pr.attempts };
}

export type AnalyzeWeaknessReviewFromTextOptions = {
  apiKey: string;
  /** 缺点名称与详情的格式化文本，由调用方生成 */
  weaknessContextText: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

/**
 * 根据用户自述的缺点名称与详情生成中文「分析回应」与「改进建议」（智谱 glm-4-flash，JSON；字段名与备忘评价一致：evaluation / suggestions）。
 */
export async function analyzeWeaknessReviewFromText(
  options: AnalyzeWeaknessReviewFromTextOptions,
): Promise<AnalyzeMemoReviewFromTextResult> {
  const text = options.weaknessContextText.trim();
  return runZhipuJsonEvaluationSuggestionsReview({
    apiKey: options.apiKey,
    contextText: text,
    emptyContextError: '缺点描述为空',
    systemInstruction: `你是个人成长应用中的「自我觉察」陪练。用户会自愿写下自己认为的一个缺点名称与详细说明，用于自我梳理，数据仅存于用户本机。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含两个字符串字段：
- evaluation：对用户自述内容的善意、具体回应（可涉及常见心理机制、认知重构角度、自我同情等），2～5 句中文，总字数约 80～220 字；禁止羞辱、贴负面人格标签或绝对化评判；不要编造用户未写明的经历或事实；若内容可能涉及临床心理健康问题，不要下诊断，可温和提醒必要时寻求专业心理咨询或医疗支持。
- suggestions：给出多条可执行的改进或应对策略（微习惯、环境设计、沟通、时间管理等），用中文分号或换行分隔；若条目较多可充分展开，须写完整、勿用「见上文」等省略。

输出形状示例（内容须替换为你的生成）：${MEMO_REVIEW_JSON_HINT}`,
    userMessage: `请根据以下用户自述的缺点信息生成 evaluation 与 suggestions 字段：\n\n${text}`,
    maxAttempts: options.maxAttempts,
    retryDelayMs: options.retryDelayMs,
    reviewJsonNormalize: 'full',
    maxTokens: 8192,
  });
}

const USER_SKILLS_PORTFOLIO_JSON_HINT = `{"per_skill":[{"skill_id":"","evaluation":"","suggestions":""}],"overall_suggestions":"","profile_analysis":""}`;

export type UserSkillAiPortfolioSkillRow = {
  skill_id: string;
  evaluation: string;
  suggestions: string;
};

export type UserSkillAiPortfolioPayload = {
  per_skill: UserSkillAiPortfolioSkillRow[];
  overall_suggestions: string;
  profile_analysis: string;
};

export type AnalyzeUserSkillsPortfolioFromTextOptions = {
  apiKey: string;
  /** 展示用称呼 */
  userDisplayName: string;
  /** 待评估的每条技能（须含稳定 skill_id） */
  lines: { skill_id: string; dimension: string; name: string; description: string }[];
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeUserSkillsPortfolioFromTextResult =
  | { ok: true; data: UserSkillAiPortfolioPayload; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeUserSkillAiPortfolioJson(
  parsed: unknown,
  expectedSkillIds: string[],
): UserSkillAiPortfolioPayload | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const overall = typeof o.overall_suggestions === 'string' ? o.overall_suggestions.trim() : '';
  const profile = typeof o.profile_analysis === 'string' ? o.profile_analysis.trim() : '';
  const rawArr = o.per_skill;
  const arr = Array.isArray(rawArr) ? rawArr : [];
  const byId = new Map<string, UserSkillAiPortfolioSkillRow>();
  for (const item of arr) {
    if (typeof item !== 'object' || item === null) continue;
    const x = item as Record<string, unknown>;
    const id = typeof x.skill_id === 'string' ? x.skill_id.trim() : '';
    if (!id) continue;
    const evaluation = typeof x.evaluation === 'string' ? x.evaluation.trim() : '';
    const suggestions = typeof x.suggestions === 'string' ? x.suggestions.trim() : '';
    byId.set(id, { skill_id: id, evaluation, suggestions });
  }
  const per_skill: UserSkillAiPortfolioSkillRow[] = expectedSkillIds.map(id => {
    const row = byId.get(id);
    if (row && (row.evaluation.length > 0 || row.suggestions.length > 0)) return row;
    return {
      skill_id: id,
      evaluation: row?.evaluation?.trim() ?? '',
      suggestions: row?.suggestions?.trim() ?? '（模型未返回该技能的有效条目，可稍后重试。）',
    };
  });
  if (!overall && !profile && per_skill.every(p => !p.evaluation && !p.suggestions)) return null;
  return {
    per_skill,
    overall_suggestions: overall.length > 0 ? overall : '（暂无综合建议，可稍后重试。）',
    profile_analysis: profile.length > 0 ? profile : '（暂无总体分析，可稍后重试。）',
  };
}

/**
 * 根据用户自报的「维度—技能—描述」生成逐技能评估与综合建议（智谱 glm-4-flash，JSON）。
 */
export async function analyzeUserSkillsPortfolioFromText(
  options: AnalyzeUserSkillsPortfolioFromTextOptions,
): Promise<AnalyzeUserSkillsPortfolioFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 6);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 900);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const lines = options.lines.filter(
    l =>
      l.skill_id.trim().length > 0 &&
      l.dimension.trim().length > 0 &&
      l.name.trim().length > 0 &&
      l.description.trim().length > 0,
  );
  if (lines.length === 0) {
    return { ok: false, error: '没有可评估的技能条目', attempts: 0 };
  }
  const expectedIds = lines.map(l => l.skill_id.trim());
  const display = options.userDisplayName.trim() || '用户';
  const bodyText = lines
    .map(
      l =>
        `【维度】${l.dimension.trim()}\n【技能】${l.name.trim()}\n【skill_id】${l.skill_id.trim()}\n【自我描述】${l.description.trim()}`,
    )
    .join('\n\n---\n\n');

  const userBlock = `用户称呼：${display}\n\n以下是用户自报的各维度技能与自我描述（skill_id 必须原样回填到 JSON 的 per_skill 中）：\n\n${bodyText}`;

  const systemContent = `你是职业发展教练与技能评估顾问。用户会提供多条「维度—技能名称—自我描述」，每条有唯一 skill_id。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含字段：
- per_skill：数组；对输入中每一条技能各输出一项，且 skill_id 必须与输入完全一致。
  每项含 evaluation（字符串，2～5 句中文，客观评价当前水平、亮点与不足）、suggestions（字符串，2～5 句中文，具体可执行的提升建议）。
- overall_suggestions（字符串，5～10 句中文）：跨技能组合的发展路径、学习顺序与练习方式等综合建议。
- profile_analysis（字符串，6～12 句中文）：对用户能力结构、优势短板、适合角色类型与中长期成长方向的总体分析。

要求：基于用户自述推断，不要捏造用户未提及的具体公司/证书/项目；语气专业、友善、具体。

输出形状示例（内容须替换为你的生成）：${USER_SKILLS_PORTFOLIO_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<UserSkillAiPortfolioPayload>({
    apiKey: key,
    systemContent,
    userContent: userBlock,
    temperature: 0.35,
    maxTokens: 6000,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const data = normalizeUserSkillAiPortfolioJson(parsed, expectedIds);
      if (!data) {
        return { ok: false, error: '模型未返回有效的技能评估结构', details: parsed };
      }
      return { ok: true, value: data };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return { ok: true, data: lr.value, rawContent: lr.rawContent, attempts: lr.attempts };
}

const FINANCE_ONE_LINER_JSON_HINT = `{"transaction_type":"expense","amount":28,"name":"午饭","category_label":"餐饮"}`;

export type ParseFinanceOneLinerFromTextOptions = {
  apiKey: string;
  /** 用户一句话记账描述，中文 */
  text: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type ParseFinanceOneLinerFromTextResult =
  | {
      ok: true;
      transaction_type: 'expense' | 'income';
      amount: number;
      name: string;
      category_label: string | null;
      rawContent: string;
      attempts: number;
    }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

function normalizeFinanceOneLinerPayload(parsed: unknown): {
  transaction_type: 'expense' | 'income';
  amount: number;
  name: string;
  category_label: string | null;
} | null {
  if (typeof parsed !== 'object' || parsed === null) return null;
  const o = parsed as Record<string, unknown>;
  const typeRaw = String(o.transaction_type ?? 'expense').toLowerCase();
  const transaction_type: 'expense' | 'income' = typeRaw === 'income' ? 'income' : 'expense';
  const rawAmt = o.amount;
  const amount =
    typeof rawAmt === 'number' && Number.isFinite(rawAmt)
      ? rawAmt
      : Number(String(rawAmt ?? '').replace(/,/g, '').trim());
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const nameRaw = typeof o.name === 'string' ? o.name.trim() : String(o.name ?? '').trim();
  if (!nameRaw) return null;
  const cat = o.category_label;
  const category_label =
    typeof cat === 'string' && cat.trim().length > 0 ? cat.trim().slice(0, 40) : null;
  return {
    transaction_type,
    amount: Math.min(Math.max(amount, 0.01), 99999999.99),
    name: nameRaw.length > 80 ? `${nameRaw.slice(0, 77)}…` : nameRaw,
    category_label,
  };
}

/**
 * 将用户「一句话」记账解析为类型、金额、标题与可选分类提示（智谱 glm-4-flash，JSON）。
 */
export async function parseFinanceOneLinerFromText(
  options: ParseFinanceOneLinerFromTextOptions,
): Promise<ParseFinanceOneLinerFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 6);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 800);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.text.trim();
  if (!text) {
    return { ok: false, error: '输入为空', attempts: 0 };
  }

  const systemContent = `你是个人记账应用里的解析器。用户会输入一句中文口语化记账描述（可含金额、收支方向、事由）。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。
必须包含字段：
1) transaction_type：字符串，仅允许 "expense" 或 "income"。默认支出；若明确为工资/奖金/到账/退款/回款/进账等则为收入。
2) amount：正数（元），从用户话中提取主金额；不要编造用户未写的数字。
3) name：简短中文标题（≤20字），概括事由，不要含「JSON」等词。
4) category_label：可为 null 或简短中文分类名（如 餐饮、交通、购物、工资），尽力从语义推断；不确定则 null。

若用户话里没有任何可解析的金额，不要猜测金额，此时仍输出 JSON 但 amount 填 0（调用方将判为失败）。

输出形状示例（内容替换）：${FINANCE_ONE_LINER_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<{
    transaction_type: 'expense' | 'income';
    amount: number;
    name: string;
    category_label: string | null;
  }>({
    apiKey: key,
    systemContent,
    userContent: `请解析以下一句话记账：\n\n${text.slice(0, 500)}`,
    temperature: 0.1,
    maxTokens: 400,
    maxAttempts,
    retryDelayMs,
    finish: parsed => {
      const norm = normalizeFinanceOneLinerPayload(parsed);
      if (!norm || !Number.isFinite(norm.amount) || norm.amount <= 0) {
        return { ok: false, error: '未能从话中解析出有效金额与标题', details: parsed };
      }
      return { ok: true, value: norm };
    },
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return {
    ok: true,
    transaction_type: lr.value.transaction_type,
    amount: lr.value.amount,
    name: lr.value.name,
    category_label: lr.value.category_label,
    rawContent: lr.rawContent,
    attempts: lr.attempts,
  };
}

function stripDataUriForVision(input: string): { base64: string; mime: string } {
  const s = input.trim();
  const m = s.match(/^data:([^;]+);base64,(.+)$/is);
  if (m) {
    const mime = (m[1] || 'image/png').trim() || 'image/png';
    return { mime, base64: m[2].replace(/\s/g, '') };
  }
  return { mime: 'image/png', base64: s.replace(/\s/g, '') };
}

export type ParseFinanceOneLinerFromImageOptions = {
  apiKey: string;
  /** 剪贴板 `getImageAsync` 返回的 `data`（含 `data:image/...;base64,` 前缀） */
  imageDataUri: string;
};

/**
 * 从支付/账单/小票等截图中解析一笔主交易（视觉模型 + JSON，与一句话记账字段一致）。
 */
export async function parseFinanceOneLinerFromImage(
  options: ParseFinanceOneLinerFromImageOptions,
): Promise<ParseFinanceOneLinerFromTextResult> {
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const uri = options.imageDataUri.trim();
  if (!uri) {
    return { ok: false, error: '图片为空', attempts: 0 };
  }

  const { base64, mime } = stripDataUriForVision(uri);
  if (!base64) {
    return { ok: false, error: '无法解析图片数据', attempts: 0 };
  }

  const jsonTemplate = `{"transaction_type":"expense","amount":0,"name":"","category_label":null}`;
  const question =
    '请查看这张手机屏幕截图（可能是支付成功页、账单详情、小票、转账或收款记录等）。识别其中一笔主要交易；若有多笔，取金额最大或信息最完整的一笔。\n' +
    '要求：transaction_type 仅 expense 或 income；amount 为人民币元且为正数，不得编造截图中不存在的数字；name 为不超过 20 字的中文事由；category_label 为简短中文分类名或 null。\n' +
    '若无法识别任何可信金额，将 amount 设为 0。';

  const r = await parseImageToJson({
    apiKey: key,
    imageBase64: base64,
    imageMimeType: mime,
    question,
    jsonTemplate,
  });

  if (!r.ok) {
    return {
      ok: false,
      error: r.error,
      attempts: 1,
      httpStatus: r.httpStatus,
      details: r.details,
    };
  }

  let payload = normalizeFinanceOneLinerPayload(r.data);
  if (!payload && r.data && typeof r.data === 'object') {
    const inner = (r.data as Record<string, unknown>).result;
    payload = normalizeFinanceOneLinerPayload(inner);
  }
  if (!payload || !Number.isFinite(payload.amount) || payload.amount <= 0) {
    return {
      ok: false,
      error: '未能从截图中识别出有效金额与标题',
      attempts: 1,
      details: r.data,
    };
  }

  return {
    ok: true,
    transaction_type: payload.transaction_type,
    amount: payload.amount,
    name: payload.name,
    category_label: payload.category_label,
    rawContent: r.rawContent,
    attempts: 1,
  };
}

export type AiFinanceDashboardInsight = { title: string; body: string };

/** AI 财务分析页：健康分、洞察、支出点评 + 三组 12 个月预测（前 6 历史 + 后 6 预测，单位：元） */
export type AiFinanceDashboardPayload = {
  health_score: number;
  health_summary: string;
  insights: [AiFinanceDashboardInsight, AiFinanceDashboardInsight];
  expense_breakdown_comment: string;
  /** 月度净储蓄：索引 0～5 过去 6 个月（旧→新），5 为本月；6～11 为预测未来 6 个月 */
  savings_forecast_12: number[];
  /** 月度收入合计，同上 12 个月结构 */
  income_forecast_12: number[];
  /** 月度盈余（与净储蓄同口径即可），同上 */
  surplus_forecast_12: number[];
};

export type AnalyzeAiFinanceDashboardFromTextOptions = {
  apiKey: string;
  summaryText: string;
  /** 过去 6 个月每月净储蓄（元，旧→新），用于约束/补全曲线 */
  past6NetSavings?: number[];
  /** 过去 6 个月每月收入合计（元，旧→新） */
  past6Income?: number[];
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeAiFinanceDashboardFromTextResult =
  | { ok: true; data: AiFinanceDashboardPayload; rawContent: string; attempts: number }
  | { ok: false; error: string; attempts: number; httpStatus?: number; details?: unknown };

const AI_FINANCE_DASHBOARD_JSON_HINT = `{"health_score":72,"health_summary":"…","insights":[{"title":"…","body":"…"},{"title":"…","body":"…"}],"expense_breakdown_comment":"…","savings_forecast_12":[0,0,0,0,0,0,0,0,0,0,0,0],"income_forecast_12":[0,0,0,0,0,0,0,0,0,0,0,0],"surplus_forecast_12":[0,0,0,0,0,0,0,0,0,0,0,0]}`;

function clampHealthScore0to100(n: unknown): number {
  const x = typeof n === 'number' ? n : typeof n === 'string' ? Number(String(n).trim().replace(/,/g, '')) : NaN;
  if (!Number.isFinite(x)) return 65;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function linearExtrapolate12From6(past6: number[], clampNonNegative: boolean): number[] {
  const n = 6;
  const series = past6.length >= n ? past6.slice(-n) : [...past6, ...Array(n - past6.length).fill(0)];
  const xAvg = 2.5;
  const yAvg = series.reduce((s, v) => s + v, 0) / n;
  const denom = series.reduce((s, _, i) => s + (i - xAvg) ** 2, 0);
  const num = series.reduce((s, v, i) => s + (i - xAvg) * (v - yAvg), 0);
  const slope = denom === 0 ? 0 : num / denom;
  const intercept = yAvg - slope * xAvg;
  const future = Array.from({ length: 6 }, (_, i) => {
    const y = intercept + slope * (n + i);
    if (clampNonNegative) return Math.max(0, y);
    return y;
  });
  return [...series, ...future];
}

function coerceNumber12(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null;
  const out: number[] = [];
  for (const v of raw) {
    if (out.length >= 12) break;
    const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/,/g, ''));
    out.push(Number.isFinite(n) ? n : 0);
  }
  return out.length === 12 ? out : null;
}

function mergeAiForecast12(raw: unknown, fallbackPast6: number[], clampNonNegative: boolean): number[] {
  const c = coerceNumber12(raw);
  if (c) return c;
  return linearExtrapolate12From6(fallbackPast6, clampNonNegative);
}

function normalizeAiFinanceDashboardPayload(
  parsed: unknown,
  ctx: { past6Net: number[]; past6Income: number[] },
): AiFinanceDashboardPayload {
  const o = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};

  const health_score = clampHealthScore0to100(o.health_score ?? o.score ?? o.health);

  const health_summaryRaw =
    typeof o.health_summary === 'string'
      ? o.health_summary.trim()
      : typeof o.health_desc === 'string'
        ? o.health_desc.trim()
        : '';
  const health_summary =
    health_summaryRaw.length > 0 ? health_summaryRaw.slice(0, 420) : '本月收支结构整体可控，建议继续保持记账并关注固定支出占比。';

  const expenseRaw =
    typeof o.expense_breakdown_comment === 'string'
      ? o.expense_breakdown_comment.trim()
      : typeof o.expense_comment === 'string'
        ? o.expense_comment.trim()
        : typeof o.category_comment === 'string'
          ? o.category_comment.trim()
          : '';
  const expense_breakdown_comment =
    expenseRaw.length > 0 ? expenseRaw.slice(0, 900) : '建议为高频支出设置分类预算，并定期回顾「非必要」支出项。';

  const rawList = Array.isArray(o.insights) ? o.insights : Array.isArray(o.insight_cards) ? o.insight_cards : [];
  const parsedInsights: AiFinanceDashboardInsight[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const title =
      typeof row.title === 'string'
        ? row.title.trim().slice(0, 28)
        : typeof row.kicker === 'string'
          ? row.kicker.trim().slice(0, 28)
          : '';
    const body =
      typeof row.body === 'string'
        ? row.body.trim()
        : typeof row.text === 'string'
          ? row.text.trim()
          : '';
    if (title && body) parsedInsights.push({ title, body: body.slice(0, 560) });
    if (parsedInsights.length >= 2) break;
  }

  while (parsedInsights.length < 2) {
    parsedInsights.push({
      title: parsedInsights.length === 0 ? '收支节奏' : '延伸建议',
      body:
        parsedInsights.length === 0
          ? '在数据较少时，优先保证「收入、固定支出、储蓄」三类记录完整，再逐步细化分类。'
          : '可把部分结余转入低风险流动性资产作为安全垫，避免月光。',
    });
  }

  const insights: [AiFinanceDashboardInsight, AiFinanceDashboardInsight] = [
    parsedInsights[0]!,
    parsedInsights[1]!,
  ];

  const past6Net = ctx.past6Net.length === 6 ? ctx.past6Net : [0, 0, 0, 0, 0, 0];
  const past6Income = ctx.past6Income.length === 6 ? ctx.past6Income : [0, 0, 0, 0, 0, 0];

  const savings_forecast_12 = mergeAiForecast12(
    o.savings_forecast_12 ?? o.savings_forecast ?? o.forecast_savings_12,
    past6Net,
    false,
  );
  const income_forecast_12 = mergeAiForecast12(
    o.income_forecast_12 ?? o.income_forecast ?? o.forecast_income_12,
    past6Income,
    true,
  );
  const surplus_forecast_12 = mergeAiForecast12(
    o.surplus_forecast_12 ?? o.surplus_forecast ?? o.net_forecast_12 ?? o.savings_forecast_12,
    past6Net,
    false,
  );

  return { health_score, health_summary, insights, expense_breakdown_comment, savings_forecast_12, income_forecast_12, surplus_forecast_12 };
}

/**
 * AI 财务分析页专用：根据「本月汇总 + 分类 + 趋势数字」摘要，返回健康分、两条洞察卡片、支出结构点评。
 */
export async function analyzeAiFinanceDashboardFromText(
  options: AnalyzeAiFinanceDashboardFromTextOptions,
): Promise<AnalyzeAiFinanceDashboardFromTextResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 12);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 1000);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }
  const text = options.summaryText.trim();
  if (!text) {
    return { ok: false, error: '摘要为空', attempts: 0 };
  }

  const past6Net =
    Array.isArray(options.past6NetSavings) && options.past6NetSavings.length === 6
      ? options.past6NetSavings.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0))
      : [0, 0, 0, 0, 0, 0];
  const past6Income =
    Array.isArray(options.past6Income) && options.past6Income.length === 6
      ? options.past6Income.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0))
      : [0, 0, 0, 0, 0, 0];

  const systemContent = `你是个人记账应用里的财务顾问。用户会提供「本月及近月」聚合后的中文统计摘要（来自本地数据库，已脱敏）。
只输出一个标准 JSON 对象，不要 markdown 代码块、不要任何 JSON 以外的文字。

必须包含字段：
1) health_score：0～100 的整数，综合储蓄率、收支稳定性、支出集中度等给出主观评分；无收入或数据极少时给 40～60 并偏低。
2) health_summary：1～2 句中文，概括财务健康度（不要出现「JSON」「字段」等词）。
3) insights：长度恰好为 2 的数组；每项含 title（≤12 字中文短语）与 body（2～4 句中文建议）。禁止编造摘要里不存在的具体金额或虚构扣款。
4) expense_breakdown_comment：2～4 句中文，结合摘要里的支出分类占比做点评；若几乎无支出则提醒多记录。
5) savings_forecast_12：长度恰好 12 的**数字数组**（单位：元）。索引 0～5 必须与摘要中「过去 6 个月每月净储蓄（收入−支出）」数值一致或极其接近；索引 5 为本月；索引 6～11 为你对未来 6 个月净储蓄的预测，要求平滑、可解释，避免断崖式跳变（除非摘要支持）。
6) income_forecast_12：长度恰好 12 的数字数组（元）。索引 0～5 与摘要中过去 6 个月每月收入合计一致或接近；6～11 为未来 6 个月收入预测（非负）。
7) surplus_forecast_12：长度恰好 12 的数字数组（元），表示每月「盈余/可储蓄」口径；通常可与净储蓄同趋势，但允许你根据摘要微调；索引 0～5 与过去 6 个月实际盈余对齐，6～11 为预测。

输出形状示例（内容请替换）：${AI_FINANCE_DASHBOARD_JSON_HINT}`;

  const lr = await loopTextJsonLlmWithRetries<AiFinanceDashboardPayload>({
    apiKey: key,
    systemContent,
    userContent: `请根据以下摘要生成上述 JSON：\n\n${text.slice(0, 9500)}`,
    temperature: 0.2,
    maxTokens: 3200,
    maxAttempts,
    retryDelayMs,
    finish: parsed => ({
      ok: true,
      value: normalizeAiFinanceDashboardPayload(parsed, { past6Net, past6Income }),
    }),
  });

  if (!lr.ok) {
    return { ok: false, error: lr.error, attempts: lr.attempts, httpStatus: lr.httpStatus, details: lr.details };
  }
  return { ok: true, data: lr.value, rawContent: lr.rawContent, attempts: lr.attempts };
}

export type ZhipuVisionChatRawOptions = {
  apiKey: string;
  imageBase64: string;
  imageMimeType?: string;
  /** 用户对图片的提问或闲聊引导 */
  userPrompt?: string;
  /** 遇到 1305 时最多请求次数（含首次），默认 40 */
  maxAttempts?: number;
  /** 两次请求间隔（毫秒），默认 1000 */
  retryDelayMs?: number;
};

/** 智谱业务错误码 1305（如限流/繁忙）时需重试 */
function bodyIndicatesZhipu1305(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const o = body as Record<string, unknown>;
  const err = o.error;
  if (err && typeof err === 'object') {
    const code = (err as Record<string, unknown>).code;
    if (code !== undefined && String(code) === '1305') return true;
  }
  if (o.code !== undefined && String(o.code) === '1305') return true;
  if (o.error_code !== undefined && String(o.error_code) === '1305') return true;
  return false;
}

/** 存在非空的 choices[0].message.content 视为有效完成 */
function bodyHasValidCompletion(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message;
  if (!message || typeof message !== 'object') return false;
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' && content.trim().length > 0;
}

/** 视觉对话：不约定 response_format；若返回 1305 则自动重试直至得到有效回复或达到次数上限 */
export async function zhipuVisionChatRaw(options: ZhipuVisionChatRawOptions): Promise<{
  httpStatus: number;
  body: unknown;
  attempts: number;
}> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 40);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 1000);

  const key = options.apiKey.trim();
  if (!key) {
    return { httpStatus: 0, body: { error: '未配置 API 密钥' }, attempts: 0 };
  }

  const mime = (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg';
  const userText = (options.userPrompt ?? '随便聊聊这张图里有什么、你的感受也行。').trim() || '随便聊聊这张图。';

  let lastHttpStatus = 0;
  let lastBody: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const dr = await dispatchZhipuOrGeminiVisionChat({
      apiKey: key,
      systemContent:
        '用户会发图片。请用自然、口语化的中文像朋友一样分享你看到的内容和联想，不必遵守固定输出格式，不要用 JSON。',
      userText,
      imageBase64: options.imageBase64,
      imageMimeType: mime,
      temperature: 0.7,
      maxTokens: 2048,
      maxAttempts: 1,
      retryDelayMs: 0,
      forceJsonObject: false,
      zhipuVisionModel: 'glm-4.6v-flash',
    });

    if (dr.ok) {
      const trimmed = dr.text.trim();
      if (trimmed) {
        const synBody = { choices: [{ message: { content: trimmed } }] };
        return { httpStatus: dr.httpStatus, body: synBody, attempts: attempt };
      }
      lastBody = { error: 'empty_response' };
    } else {
      lastBody = dr.details ?? { error: dr.error };
    }

    lastHttpStatus = dr.httpStatus ?? lastHttpStatus;
    const p = getPreferredAiLlmProviderSync();
    const outboundDetails = dr.ok ? undefined : dr.details;
    const retryable =
      (dr.ok && !dr.text.trim() && attempt < maxAttempts) ||
      (!dr.ok &&
        ((p === 'zhipu' && bodyIndicatesZhipu1305(outboundDetails)) ||
          (p === 'gemini' && (dr.httpStatus === 429 || dr.httpStatus === 503))));
    if (retryable && attempt < maxAttempts) {
      await sleep(retryDelayMs);
      continue;
    }

    return { httpStatus: dr.httpStatus ?? lastHttpStatus, body: lastBody, attempts: attempt };
  }

  return { httpStatus: lastHttpStatus, body: lastBody, attempts: maxAttempts };
}

/** 极小 JPEG（约几十字节），用于仅测连通性、无需相册 */
export const TINY_TEST_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

/** 食物营养分析：全部为数字；非食物时用 is_food=0 与 non_food_code 表示原因 */
export type FoodNutritionJson = {
  /** 1=图中为可估算的食物；0=非食物或无法按食物分析 */
  is_food: 0 | 1;
  /**
   * is_food=1 时必须为 0。
   * is_food=0 时：1=明显非食物；2=无法识别/不清晰；3=多物混杂无法单一估算
   */
  non_food_code: number;
  /** is_food=1 时：识别到的食物/菜品简称（简短中文） */
  food_name: string;
  /** is_food=1 时：1～3 句口语化点评；is_food=0 时为空字符串 */
  ai_evaluation: string;
  /** 可食部分估算蛋白质，克 */
  protein_g: number;
  /** 可食部分估算碳水化合物，克 */
  carbohydrate_g: number;
  /** 可食部分估算钠，毫克 */
  sodium_mg: number;
};

export type AnalyzeFoodNutritionOptions = {
  apiKey: string;
  imageBase64: string;
  imageMimeType?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
};

export type AnalyzeFoodNutritionResult =
  | { ok: true; data: FoodNutritionJson; attempts: number; rawContent: string; repaired: boolean }
  | {
      ok: false;
      error: string;
      attempts: number;
      httpStatus?: number;
      /** 请求失败时的兜底结构，便于界面展示 */
      data: FoodNutritionJson;
    };

const FOOD_NUTRITION_FALLBACK: FoodNutritionJson = {
  is_food: 0,
  non_food_code: 2,
  food_name: '',
  ai_evaluation: '',
  protein_g: 0,
  carbohydrate_g: 0,
  sodium_mg: 0,
};

function extractMessageContentFromZhipuBody(body: unknown): string | null {
  if (!bodyHasValidCompletion(body)) return null;
  const choices = (body as Record<string, unknown>).choices as unknown[];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const content = message?.content;
  if (typeof content !== 'string') return null;
  const t = content.trim();
  return t.length > 0 ? t : null;
}

/** 去掉 ```json ... ``` 包裹，便于容错解析 */
function stripMarkdownJsonFence(text: string): string {
  let t = text.trim();
  if (t.startsWith('```')) {
    t = t.replace(/^```[a-zA-Z0-9]*\s*\n?/, '').replace(/\n?```\s*$/,'');
  }
  return t.trim();
}

function toNonNegativeFiniteNumber(v: unknown): number {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, v);
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim().replace(/,/g, ''));
    if (Number.isFinite(n)) return Math.max(0, n);
  }
  return 0;
}

function toIsFoodFlag(v: unknown): 0 | 1 {
  if (v === 1 || v === true) return 1;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === '1' || s === 'true' || s === 'yes') return 1;
  }
  return 0;
}

function toNonFoodCode(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : Number(String(v).trim());
  if (!Number.isFinite(n)) return 1;
  return Math.min(99, Math.max(0, Math.round(n)));
}

/**
 * 将模型 JSON 规范为 FoodNutritionJson；字段缺失或类型不对时补全为安全数字。
 */
export function normalizeFoodNutritionPayload(raw: unknown): { data: FoodNutritionJson; repaired: boolean } {
  let repaired = false;
  if (typeof raw !== 'object' || raw === null) {
    return { data: { ...FOOD_NUTRITION_FALLBACK }, repaired: true };
  }
  const o = raw as Record<string, unknown>;
  const is_food = toIsFoodFlag(o.is_food);
  let non_food_code = toNonFoodCode(o.non_food_code);
  let food_name =
    typeof o.food_name === 'string'
      ? o.food_name.trim()
      : o.food_name != null
        ? String(o.food_name).trim()
        : '';
  let ai_evaluation =
    typeof o.ai_evaluation === 'string'
      ? o.ai_evaluation.trim()
      : o.ai_evaluation != null
        ? String(o.ai_evaluation).trim()
        : '';
  let protein_g = toNonNegativeFiniteNumber(o.protein_g);
  let carbohydrate_g = toNonNegativeFiniteNumber(o.carbohydrate_g ?? o.carb_g ?? o.carbs_g);
  if (o.carbohydrate_g === undefined && (o.carb_g !== undefined || o.carbs_g !== undefined)) repaired = true;
  let sodium_mg = toNonNegativeFiniteNumber(o.sodium_mg ?? o.sodium);

  if (is_food === 1) {
    if (non_food_code !== 0) repaired = true;
    non_food_code = 0;
  } else {
    if (non_food_code < 1 || non_food_code > 3) {
      non_food_code = non_food_code < 1 ? 1 : 3;
      repaired = true;
    }
    protein_g = 0;
    carbohydrate_g = 0;
    sodium_mg = 0;
    food_name = '';
    ai_evaluation = '';
  }

  return {
    data: { is_food, non_food_code, food_name, ai_evaluation, protein_g, carbohydrate_g, sodium_mg },
    repaired,
  };
}

const FOOD_NUTRITION_SCHEMA_TEXT = `只输出一个 JSON 对象，禁止 markdown、禁止注释。
字段与含义：
- is_food：1=图中主要是可辨识的食物或可估算的菜品；0=明显非食物、无法辨认、无食物等。
- non_food_code：当 is_food 为 1 时必须为 0；当 is_food 为 0 时必须为 1～3 的整数（1=明显非食物场景 2=无法识别或不清晰 3=过于混杂无法对单一食物估算）。
- food_name：当 is_food 为 1 时填写简短中文食物/菜品名称（如「番茄炒蛋盖饭」）；is_food 为 0 时填空字符串 ""。
- ai_evaluation：当 is_food 为 1 时填写 1～3 句口语化中文，从均衡、控盐、搭配角度点评图中这一餐；is_food 为 0 时填空字符串 ""。
- protein_g、carbohydrate_g、sodium_mg：数字类型，非负；is_food 为 0 时三者均为 0。
估算以「图中呈现的一份/一盘/可见主体」为基准；若无法合理估算则置 is_food=0 并设置 non_food_code，food_name 与 ai_evaluation 为空字符串，营养字段为 0。`;

/**
 * 分析图片中食物的蛋白质、碳水、钠；强制 JSON 数字字段；非食物走 is_food=0。
 * 含 1305 重试、JSON 解析失败重试、结果归一化与失败兜底。
 */
export async function analyzeFoodNutritionFromImage(
  options: AnalyzeFoodNutritionOptions,
): Promise<AnalyzeFoodNutritionResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 40);
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 1000);
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0, data: { ...FOOD_NUTRITION_FALLBACK } };
  }
  const rawB64 = options.imageBase64?.trim() ?? '';
  if (!rawB64) {
    return { ok: false, error: '图片数据为空', attempts: 0, data: { ...FOOD_NUTRITION_FALLBACK } };
  }

  const mime = (options.imageMimeType ?? 'image/jpeg').trim() || 'image/jpeg';

  const systemContent = `你是营养成分估算助手，根据用户上传的食物照片输出 JSON。\n${FOOD_NUTRITION_SCHEMA_TEXT}`;
  const userText =
    '请分析这张图片中的食物（若有），估算蛋白质、碳水化合物、钠含量，并输出 food_name 与 ai_evaluation，严格按系统要求的 JSON 字段与类型。';

  const lr = await loopVisionJsonLlmWithRetries<{ data: FoodNutritionJson; repaired: boolean }>({
    apiKey: key,
    systemContent,
    userText,
    imageBase64: rawB64,
    imageMimeType: mime,
    temperature: 0.1,
    maxTokens: 4096,
    maxAttempts,
    retryDelayMs,
    zhipuVisionModel: 'glm-4.6v-flash',
    finish: parsed => {
      const { data, repaired } = normalizeFoodNutritionPayload(parsed);
      return { ok: true, value: { data, repaired } };
    },
  });

  if (!lr.ok) {
    return {
      ok: false,
      error: lr.error,
      attempts: lr.attempts,
      httpStatus: lr.httpStatus,
      data: { ...FOOD_NUTRITION_FALLBACK, non_food_code: 2 },
    };
  }

  return {
    ok: true,
    data: lr.value.data,
    attempts: lr.attempts,
    rawContent: lr.rawContent,
    repaired: lr.value.repaired,
  };
}
