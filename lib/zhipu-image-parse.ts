/**
 * 智谱 GLM 视觉模型：图片 → JSON（chat/completions）
 * 默认密钥内置在应用中；若设置了 EXPO_PUBLIC_ZHIPU_API_KEY 则优先使用该环境变量（便于轮换而无需改代码）。
 */

const ZHIPU_EMBEDDED_API_KEY = 'd0ab5a5e402040d291d9b77f58996d32.nL1sXtGfaUMXzW7W';

const ZHIPU_CHAT_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

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

  const dataUrl = mime.includes('/') ? `data:${mime};base64,${options.imageBase64}` : `data:image/jpeg;base64,${options.imageBase64}`;

  try {
    const response = await fetch(ZHIPU_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'glm-4.6v-flash',
        response_format: { type: 'json_object' },
        temperature: 0.1,
        messages: [
          {
            role: 'system',
            content: `你是一个图片解析工具。严格按照以下规则输出：
1. 只返回一个标准JSON对象
2. 完全遵循我给你的JSON格式和字段类型
3. 不要添加任何JSON以外的内容（包括解释、说明、代码块）
4. 如果无法识别某个字段，填null或默认值

必须严格遵循的JSON格式：
${jsonTemplate}`,
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: question },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });

    const httpStatus = response.status;
    const data = (await response.json()) as {
      error?: { message?: string; code?: string };
      choices?: { message?: { content?: string } }[];
    };

    if (!response.ok) {
      const msg = data.error?.message ?? response.statusText ?? '请求失败';
      return { ok: false, error: msg, httpStatus, details: data };
    }

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      return {
        ok: false,
        error: '响应中无有效 content',
        httpStatus,
        details: data,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(content.trim());
    } catch {
      return {
        ok: false,
        error: '模型返回的不是合法 JSON',
        httpStatus,
        details: { contentSnippet: content.slice(0, 500) },
      };
    }

    return { ok: true, data: parsed, rawContent: content.trim() };
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

/** 纯文字描述一餐/饮品 → 估算水分与三大营养（智谱 glm-4.7-flash + JSON） */
export type FoodTextIntakeJson = {
  food_summary: string;
  hydration_ml: number;
  protein_g: number;
  carbohydrate_g: number;
  sodium_mg: number;
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
    "sodium_mg": 0
  }
}`;

function normalizeFoodTextIntakeFromResult(raw: unknown): FoodTextIntakeJson {
  const empty: FoodTextIntakeJson = {
    food_summary: '',
    hydration_ml: 0,
    protein_g: 0,
    carbohydrate_g: 0,
    sodium_mg: 0,
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
  return {
    food_summary: summary,
    hydration_ml: toNonNegativeFiniteNumber(o.hydration_ml),
    protein_g: toNonNegativeFiniteNumber(o.protein_g),
    carbohydrate_g: toNonNegativeFiniteNumber(o.carbohydrate_g),
    sodium_mg: toNonNegativeFiniteNumber(o.sodium_mg),
  };
}

/**
 * 根据用户中文饮食描述估算 hydration_ml、protein_g、carbohydrate_g、sodium_mg。
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
  const question = (options.question ?? '分析这段饮食描述并估算一餐的水分、蛋白质、碳水化合物与钠').trim();

  const payload = JSON.stringify({
    model: 'glm-4.7-flash',
    response_format: { type: 'json_object' },
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `你是一个饮食摄入估算工具。严格按照以下规则输出：
1. 只返回一个标准JSON对象
2. 完全遵循我给你的JSON格式和字段类型（数字用数值，不是字符串）
3. 不要添加任何JSON以外的内容（包括解释、代码块）
4. 无法从描述推断的数值填 0；food_summary 用简短中文概括用户所吃所喝

必须遵循的JSON格式：
${FOOD_TEXT_INTAKE_JSON_TEMPLATE}`,
      },
      {
        role: 'user',
        content: `${question}：${text}`,
      },
    ],
  });

  let lastError = '未知错误';
  let lastHttp = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(ZHIPU_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
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

    if (bodyIndicatesZhipu1305(body) && attempt < maxAttempts) {
      await sleep(retryDelayMs);
      continue;
    }

    if (!response.ok) {
      const msg =
        typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error?: { message?: string } }).error?.message ?? response.statusText)
          : response.statusText;
      lastError = msg;
      if (bodyIndicatesZhipu1305(body) && attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: body };
    }

    const content = extractMessageContentFromZhipuBody(body);
    if (!content) {
      lastError = '响应中无有效 content';
      if (bodyIndicatesZhipu1305(body) && attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: body };
    }

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
      return { ok: false, error: lastError, attempts: attempt, httpStatus, details: { snippet: content.slice(0, 400) } };
    }

    const data = normalizeFoodTextIntakeFromResult(parsed);
    return { ok: true, data, rawContent: content.trim(), attempts: attempt };
  }

  return { ok: false, error: lastError, attempts: maxAttempts, httpStatus: lastHttp };
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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

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
  const dataUrl = mime.includes('/') ? `data:${mime};base64,${options.imageBase64}` : `data:image/jpeg;base64,${options.imageBase64}`;
  const userText = (options.userPrompt ?? '随便聊聊这张图里有什么、你的感受也行。').trim() || '随便聊聊这张图。';

  const payload = JSON.stringify({
    model: 'glm-4.6v-flash',
    temperature: 0.7,
    messages: [
      {
        role: 'system',
        content:
          '用户会发图片。请用自然、口语化的中文像朋友一样分享你看到的内容和联想，不必遵守固定输出格式，不要用 JSON。',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: userText },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  let lastHttpStatus = 0;
  let lastBody: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(ZHIPU_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
    } catch (e) {
      return {
        httpStatus: 0,
        body: { error: e instanceof Error ? e.message : String(e) },
        attempts: attempt,
      };
    }

    const httpStatus = response.status;
    const rawText = await response.text();
    let body: unknown = rawText;
    try {
      body = JSON.parse(rawText) as unknown;
    } catch {
      // 非 JSON
    }
    lastHttpStatus = httpStatus;
    lastBody = body;

    if (bodyHasValidCompletion(body)) {
      return { httpStatus, body, attempts: attempt };
    }

    if (bodyIndicatesZhipu1305(body) && attempt < maxAttempts) {
      await sleep(retryDelayMs);
      continue;
    }

    return { httpStatus, body, attempts: attempt };
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
  }

  return {
    data: { is_food, non_food_code, protein_g, carbohydrate_g, sodium_mg },
    repaired,
  };
}

const FOOD_NUTRITION_SCHEMA_TEXT = `只输出一个 JSON 对象，且所有字段值均为数字（禁止字符串、禁止 null、禁止注释、禁止代码块）。
字段与含义：
- is_food：1=图中主要是可辨识的食物或可估算的菜品；0=明显非食物、无法辨认、风景人物包装无食物等。
- non_food_code：当 is_food 为 1 时必须为 0；当 is_food 为 0 时必须为 1～3 的整数（1=明显非食物场景 2=无法识别或不清晰 3=过于混杂无法对单一食物估算）。
- protein_g：图中可食部分蛋白质估算，单位克，非负。
- carbohydrate_g：碳水化合物估算，单位克，非负。
- sodium_mg：钠估算，单位毫克，非负。
估算以「图中呈现的一份/一盘/可见主体」为基准；若无法合理估算则置 is_food=0 并设置 non_food_code，其它营养字段一律为 0。`;

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
  const dataUrl = mime.includes('/') ? `data:${mime};base64,${rawB64}` : `data:image/jpeg;base64,${rawB64}`;

  const payload = JSON.stringify({
    model: 'glm-4.6v-flash',
    response_format: { type: 'json_object' },
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: `你是营养成分估算助手，根据用户上传的食物照片输出 JSON。\n${FOOD_NUTRITION_SCHEMA_TEXT}`,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '请分析这张图片中的食物（若有），估算蛋白质、碳水化合物、钠含量，并严格按系统要求的纯数字 JSON 输出。',
          },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  let lastError = '未知错误';
  let lastHttp = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let response: Response;
    try {
      response = await fetch(ZHIPU_CHAT_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: payload,
      });
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      return {
        ok: false,
        error: `网络异常: ${lastError}`,
        attempts: attempt,
        httpStatus: 0,
        data: { ...FOOD_NUTRITION_FALLBACK, non_food_code: 2 },
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

    if (bodyIndicatesZhipu1305(body) && attempt < maxAttempts) {
      await sleep(retryDelayMs);
      continue;
    }

    if (!response.ok) {
      const msg =
        typeof body === 'object' && body !== null && 'error' in body
          ? String((body as { error?: { message?: string } }).error?.message ?? response.statusText)
          : response.statusText;
      lastError = msg;
      if (bodyIndicatesZhipu1305(body) && attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      return {
        ok: false,
        error: lastError,
        attempts: attempt,
        httpStatus,
        data: { ...FOOD_NUTRITION_FALLBACK, non_food_code: 2 },
      };
    }

    const content = extractMessageContentFromZhipuBody(body);
    if (!content) {
      lastError = '响应中无有效 content';
      if (attempt < maxAttempts) {
        await sleep(retryDelayMs);
        continue;
      }
      return {
        ok: false,
        error: lastError,
        attempts: attempt,
        httpStatus,
        data: { ...FOOD_NUTRITION_FALLBACK },
      };
    }

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
      return {
        ok: false,
        error: lastError,
        attempts: attempt,
        httpStatus,
        data: { ...FOOD_NUTRITION_FALLBACK, non_food_code: 2 },
      };
    }

    const { data, repaired } = normalizeFoodNutritionPayload(parsed);
    return { ok: true, data, attempts: attempt, rawContent: content, repaired };
  }

  return {
    ok: false,
    error: lastError,
    attempts: maxAttempts,
    httpStatus: lastHttp,
    data: { ...FOOD_NUTRITION_FALLBACK, non_food_code: 2 },
  };
}
