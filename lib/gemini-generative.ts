/**
 * 豆包（火山方舟 Responses API）：`POST /api/v3/responses`，Bearer 鉴权，便于 Expo/RN。
 * 默认模型：`doubao-seed-2-0-pro-260215`（文本 / 识图同一接入点）。
 *
 * 为减少调用方改动，仍导出 `gemini*` / `Gemini*` 名称，实际已对接 Ark。
 */

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ARK_RESPONSES_URL = 'https://ark.cn-beijing.volces.com/api/v3/responses';

/** 与方舟控制台接入点一致；可通过 `options.model` 覆盖 */
export const GEMINI_TEXT_MODEL_DEFAULT = 'doubao-seed-2-0-pro-260215';
export const GEMINI_VISION_MODEL_DEFAULT = 'doubao-seed-2-0-pro-260215';

export type GeminiInlineUserPart =
  | { kind: 'text'; text: string }
  | { kind: 'image'; mimeType: string; base64: string };

export type GeminiGenerateOk = { ok: true; text: string; attempts: number; httpStatus: number };
export type GeminiGenerateFail = {
  ok: false;
  error: string;
  attempts: number;
  httpStatus?: number;
  details?: unknown;
};
export type GeminiGenerateResult = GeminiGenerateOk | GeminiGenerateFail;

type ArkInputText = { type: 'input_text'; text: string };
type ArkInputImage = { type: 'input_image'; image_url: string };
type ArkUserContent = string | (ArkInputText | ArkInputImage)[];

function userPartsToArkUserContent(parts: GeminiInlineUserPart[]): ArkUserContent {
  const hasImage = parts.some(p => p.kind === 'image');
  if (!hasImage) {
    return parts
      .filter((p): p is Extract<GeminiInlineUserPart, { kind: 'text' }> => p.kind === 'text')
      .map(p => p.text)
      .join('\n\n');
  }
  const content: (ArkInputText | ArkInputImage)[] = [];
  for (const p of parts) {
    if (p.kind === 'text') {
      content.push({ type: 'input_text', text: p.text });
    } else {
      const mime = p.mimeType.trim() || 'image/jpeg';
      content.push({
        type: 'input_image',
        image_url: `data:${mime};base64,${p.base64}`,
      });
    }
  }
  return content;
}

function collectTextFromUnknown(value: unknown, out: string[]): void {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    if (value.trim()) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const x of value) collectTextFromUnknown(x, out);
    return;
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    if (typeof o.text === 'string' && o.text.trim()) {
      out.push(o.text);
      return;
    }
    if (Array.isArray(o.content)) collectTextFromUnknown(o.content, out);
    if (Array.isArray(o.parts)) collectTextFromUnknown(o.parts, out);
    if (Array.isArray(o.output)) collectTextFromUnknown(o.output, out);
  }
}

/** 解析 Responses API 非流式 JSON（兼容 `output[].content[].text` 等嵌套） */
function extractArkResponseText(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const root = body as Record<string, unknown>;
  const chunks: string[] = [];
  if (Array.isArray(root.output)) {
    for (const item of root.output) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (o.type === 'message' && Array.isArray(o.content)) {
        for (const c of o.content) {
          if (!c || typeof c !== 'object') continue;
          const p = c as Record<string, unknown>;
          if (typeof p.text === 'string') chunks.push(p.text);
        }
      }
    }
  }
  let joined = chunks.join('').trim();
  if (joined) return joined;
  collectTextFromUnknown(root.output, chunks);
  joined = chunks.join('').trim();
  return joined;
}

function arkErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const err = (body as { error?: { message?: string; msg?: string; code?: string | number } }).error;
    if (err && typeof err === 'object') {
      const m = err.message ?? err.msg;
      if (typeof m === 'string' && m.trim()) return m.trim();
    }
    const msg = (body as { message?: string }).message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim();
  }
  return fallback;
}

/** 1×1 JPEG，僅作連通性探測用 */
const PROBE_TINY_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=';

function summarizeGeminiProbeBody(body: unknown): { extractedText: string; diagnostic?: string } {
  const text = extractArkResponseText(body);
  if (text.trim()) return { extractedText: text.trim() };
  if (typeof body === 'object' && body !== null) {
    const errMsg = arkErrorMessage(body, '');
    if (errMsg) return { extractedText: '', diagnostic: errMsg };
  }
  return { extractedText: '', diagnostic: '回應中無可讀文本' };
}

export type GeminiConnectivityProbeRow = {
  label: string;
  model: string;
  httpStatus: number;
  httpOk: boolean;
  hasModelText: boolean;
  extractedText: string;
  diagnostic?: string;
  bodySnippet: string;
};

function buildArkPayload(options: {
  model: string;
  systemInstruction: string;
  userContent: ArkUserContent;
  temperature: number;
  maxOutputTokens: number;
}): Record<string, unknown> {
  const input: { role: string; content: string | (ArkInputText | ArkInputImage)[] }[] = [];
  const sys = options.systemInstruction.trim();
  if (sys) {
    input.push({ role: 'system', content: sys });
  }
  input.push({ role: 'user', content: options.userContent });
  return {
    model: options.model,
    input,
    temperature: options.temperature,
    max_output_tokens: options.maxOutputTokens,
    stream: false,
  };
}

async function postArkResponses(apiKey: string, payload: Record<string, unknown>): Promise<{
  response: Response;
  body: unknown;
  rawText: string;
}> {
  const key = apiKey.trim();
  const res = await fetch(ARK_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const rawText = await res.text();
  let body: unknown = rawText;
  try {
    body = JSON.parse(rawText) as unknown;
  } catch {
    body = rawText;
  }
  return { response: res, body, rawText };
}

/**
 * 單次 Responses 探測（便於排查 Bearer／模型名／多模態格式）。
 */
export async function probeGeminiGenerateRaw(options: {
  apiKey: string;
  model: string;
  withVisionJpeg: boolean;
}): Promise<GeminiConnectivityProbeRow> {
  const key = options.apiKey.trim();
  const label = options.withVisionJpeg ? `識圖 · ${options.model}` : `文本 · ${options.model}`;
  if (!key) {
    return {
      label,
      model: options.model,
      httpStatus: 0,
      httpOk: false,
      hasModelText: false,
      extractedText: '',
      diagnostic: 'API 金鑰為空',
      bodySnippet: '',
    };
  }

  const userContent: ArkUserContent = options.withVisionJpeg
    ? [
        { type: 'input_text', text: '用一兩個中文詞描述這張圖。若看不清可答「測試」。' },
        {
          type: 'input_image',
          image_url: `data:image/jpeg;base64,${PROBE_TINY_JPEG_BASE64}`,
        },
      ]
    : '只輸出這兩個英文字母：OK';

  const payload = buildArkPayload({
    model: options.model,
    systemInstruction: '',
    userContent,
    temperature: 0,
    maxOutputTokens: 64,
  });

  try {
    const { response: res, body, rawText } = await postArkResponses(key, payload);
    const sum = summarizeGeminiProbeBody(body);
    const snippet = rawText.length > 2400 ? `${rawText.slice(0, 2400)}…` : rawText;
    return {
      label,
      model: options.model,
      httpStatus: res.status,
      httpOk: res.ok,
      hasModelText: Boolean(sum.extractedText),
      extractedText: sum.extractedText,
      diagnostic: sum.diagnostic,
      bodySnippet: snippet,
    };
  } catch (e) {
    return {
      label,
      model: options.model,
      httpStatus: 0,
      httpOk: false,
      hasModelText: false,
      extractedText: '',
      diagnostic: e instanceof Error ? e.message : String(e),
      bodySnippet: '',
    };
  }
}

/** 依序探測：預設文本、預設識圖（含圖）。 */
export async function probeGeminiTextAndVisionConnectivity(apiKey: string): Promise<GeminiConnectivityProbeRow[]> {
  const rows: GeminiConnectivityProbeRow[] = [];
  rows.push(await probeGeminiGenerateRaw({ apiKey, model: GEMINI_TEXT_MODEL_DEFAULT, withVisionJpeg: false }));
  rows.push(
    await probeGeminiGenerateRaw({
      apiKey,
      model: GEMINI_VISION_MODEL_DEFAULT,
      withVisionJpeg: true,
    }),
  );
  return rows;
}

function shouldRetryArk(httpStatus: number, body: unknown): boolean {
  if (httpStatus === 429 || httpStatus === 503) return true;
  if (typeof body === 'object' && body !== null && 'error' in body) {
    const err = (body as { error?: { code?: string | number; status?: string; message?: string } }).error;
    const code = Number(err?.code);
    if (code === 429 || code === 503) return true;
    const msg = String(err?.message ?? '').toLowerCase();
    if (msg.includes('rate') || msg.includes('throttl') || msg.includes('限流')) return true;
  }
  return false;
}

export async function geminiGenerateContentWithRetries(options: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  userParts: GeminiInlineUserPart[];
  temperature: number;
  maxOutputTokens: number;
  /** 设为 `application/json` 时在系统提示中附加严格 JSON 输出要求（Ark 侧与智谱一致靠提示约束） */
  responseMimeType?: 'application/json' | 'text/plain';
  maxAttempts: number;
  retryDelayMs: number;
}): Promise<GeminiGenerateResult> {
  const key = options.apiKey.trim();
  if (!key) {
    return { ok: false, error: '未配置 API 密钥', attempts: 0 };
  }

  const maxAttempts = Math.max(1, options.maxAttempts);
  const retryDelayMs = Math.max(0, options.retryDelayMs);

  let system = options.systemInstruction.trim();
  if (options.responseMimeType === 'application/json') {
    system = system
      ? `${system}\n\n输出要求：仅输出合法 JSON 字符串，不要使用 markdown 代码围栏或其它说明文字。`
      : '输出要求：仅输出合法 JSON 字符串，不要使用 markdown 代码围栏或其它说明文字。';
  }

  const userContent = userPartsToArkUserContent(options.userParts);
  const payload = buildArkPayload({
    model: options.model,
    systemInstruction: system,
    userContent,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
  });

  let lastError = '未知错误';
  let lastHttp = 0;
  let lastBody: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response: Response;
    let body: unknown;
    try {
      const r = await postArkResponses(key, payload);
      response = r.response;
      body = r.body;
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
    lastBody = body;

    if (shouldRetryArk(httpStatus, body) && attempt < maxAttempts) {
      await sleep(retryDelayMs);
      continue;
    }

    if (!response.ok) {
      lastError = arkErrorMessage(body, response.statusText || '请求失败');
      if (shouldRetryArk(httpStatus, body) && attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: body };
    }

    const text = extractArkResponseText(body);
    if (!text) {
      lastError = '响应中无有效文本';
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: body };
    }

    return { ok: true, text, attempts: attempt, httpStatus };
  }

  return {
    ok: false,
    error: lastError,
    attempts: maxAttempts,
    httpStatus: lastHttp,
    details: lastBody,
  };
}
