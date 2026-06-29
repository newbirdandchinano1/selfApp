import AsyncStorage from '@react-native-async-storage/async-storage';

export const API_DEBUG_ENABLED_KEY = '@selfapp/api_debug_enabled_v1';

const MAX_LOG_ENTRIES = 100;
/** 单条请求/响应最大保留字符（调试用途，尽量完整；超大响应才截断） */
const MAX_STORE_CHARS = 512_000;

const SENSITIVE_KEY = /password|passwd|token|authorization|secret|credential/i;

export type ApiDebugLogEntry = {
  id: string;
  at: string;
  method: string;
  url: string;
  status: number;
  apiCode: number | null;
  durationMs: number;
  ok: boolean;
  requestBody?: string | null;
  responseBody?: string | null;
  error?: string | null;
};

let enabled = false;
let enabledLoaded = false;
const entries: ApiDebugLogEntry[] = [];
const listeners = new Set<() => void>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

export function subscribeApiDebug(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isApiDebugEnabled(): boolean {
  return enabled;
}

export async function loadApiDebugEnabled(): Promise<boolean> {
  if (enabledLoaded) return enabled;
  try {
    const raw = await AsyncStorage.getItem(API_DEBUG_ENABLED_KEY);
    enabled = raw === '1' || raw === 'true';
  } catch {
    enabled = false;
  }
  enabledLoaded = true;
  notifyListeners();
  return enabled;
}

export async function setApiDebugEnabled(next: boolean): Promise<void> {
  enabled = next;
  enabledLoaded = true;
  try {
    await AsyncStorage.setItem(API_DEBUG_ENABLED_KEY, next ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (!next) {
    entries.length = 0;
  } else {
    pushApiDebugSystemMessage('接口调试模式已开启');
    void probeApiDebugConnection();
  }
  notifyListeners();
}

export function getApiDebugLogs(): readonly ApiDebugLogEntry[] {
  return entries;
}

export function clearApiDebugLogs(): void {
  entries.length = 0;
  notifyListeners();
}

function capStoredText(text: string): string {
  if (text.length <= MAX_STORE_CHARS) return text;
  return `${text.slice(0, MAX_STORE_CHARS)}\n… [存储截断，原长 ${text.length} 字符]`;
}

function redactSensitiveValue(value: unknown): unknown {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? '***' : redactSensitiveValue(val);
  }
  return out;
}

/** 序列化请求体；敏感字段替换为 *** */
export function formatBodyForApiDebug(body: unknown): string | null {
  if (body == null) return null;
  try {
    const normalized = typeof body === 'string' ? JSON.parse(body) : body;
    return capStoredText(JSON.stringify(redactSensitiveValue(normalized), null, 2));
  } catch {
    return capStoredText(String(body));
  }
}

function formatRequestBodyFromFetch(body: BodyInit | null | undefined): string | null {
  if (body == null) return null;
  if (typeof body === 'string') {
    try {
      return formatBodyForApiDebug(JSON.parse(body));
    } catch {
      return capStoredText(body);
    }
  }
  return capStoredText(String(body));
}

/** 为列表接口响应附加 pagination 摘要，便于排查分页问题 */
export function formatResponseForApiDebug(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return '(empty body)';

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const data =
      parsed && typeof parsed.data === 'object' && parsed.data !== null && !Array.isArray(parsed.data)
        ? (parsed.data as Record<string, unknown>)
        : parsed;
    const list = data?.list;
    const pagination = data?.pagination as Record<string, unknown> | undefined;
    if (Array.isArray(list) && pagination) {
      const summary = `[list=${list.length} total=${String(pagination.total ?? '?')} page=${String(pagination.page ?? '?')}/${String(pagination.totalPages ?? '?')} limit=${String(pagination.limit ?? '?')}]`;
      return capStoredText(`${summary}\n${trimmed}`);
    }
  } catch {
    /* 非 JSON */
  }

  return capStoredText(trimmed);
}

function appendApiDebugLog(partial: Omit<ApiDebugLogEntry, 'id' | 'at'>): void {
  entries.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ...partial,
  });
  while (entries.length > MAX_LOG_ENTRIES) {
    entries.pop();
  }
  notifyListeners();
}

export function pushApiDebugSystemMessage(message: string): void {
  if (!enabled) return;
  appendApiDebugLog({
    method: 'SYS',
    url: '(local)',
    status: 0,
    apiCode: null,
    durationMs: 0,
    ok: true,
    responseBody: message,
  });
}

/** 在 fetch 层记录 HTTP 请求（覆盖全部 REST 流量） */
export async function logHttpFetchDebug(opts: {
  url: string;
  method: string;
  status: number;
  durationMs: number;
  requestBody?: BodyInit | null;
  response?: Response;
  error?: string | null;
}): Promise<void> {
  if (!enabled) return;

  let responseBody: string | null = null;
  let apiCode: number | null = null;
  let ok = opts.status >= 200 && opts.status < 300 && !opts.error;

  if (opts.response) {
    try {
      const text = await opts.response.clone().text();
      responseBody = formatResponseForApiDebug(text);
      try {
        const parsed = JSON.parse(text) as { code?: number };
        if (typeof parsed.code === 'number') {
          apiCode = parsed.code;
          ok = ok && parsed.code === 0;
        }
      } catch {
        /* ignore */
      }
    } catch {
      responseBody = '(无法读取响应体)';
    }
  }

  appendApiDebugLog({
    method: opts.method.toUpperCase(),
    url: opts.url,
    status: opts.status,
    apiCode,
    durationMs: opts.durationMs,
    ok,
    requestBody: formatRequestBodyFromFetch(opts.requestBody ?? null),
    responseBody,
    error: opts.error ?? null,
  });
}

/** 开启调试后立即打一条探测请求，确认日志链路可用 */
export async function probeApiDebugConnection(): Promise<void> {
  if (!enabled) return;
  try {
    const { apiHealthCheck, apiGetTablesMeta } = await import('@/lib/api-client');
    pushApiDebugSystemMessage('正在请求 GET /health …');
    const healthy = await apiHealthCheck();
    pushApiDebugSystemMessage(healthy ? 'GET /health 成功' : 'GET /health 返回非 2xx');
    pushApiDebugSystemMessage('正在请求 GET /api/tables …');
    const tables = await apiGetTablesMeta();
    pushApiDebugSystemMessage(`GET /api/tables 成功，共 ${tables.length} 张表`);
  } catch (e) {
    pushApiDebugSystemMessage(`探测失败：${e instanceof Error ? e.message : String(e)}`);
  }
}

export function formatApiDebugTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export type PageListApiLogKind = 'projects-list' | 'tasks-list';

function countTasksInProjectList(projects: unknown[]): number {
  let total = 0;
  const walk = (nodes: unknown[]) => {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      total += 1;
      const children = (node as { children?: unknown[] }).children;
      if (Array.isArray(children) && children.length > 0) walk(children);
    }
  };
  for (const project of projects) {
    if (!project || typeof project !== 'object') continue;
    const tasks = (project as { tasks?: unknown[] }).tasks;
    if (Array.isArray(tasks) && tasks.length > 0) walk(tasks);
  }
  return total;
}

/** 项目/任务分页列表接口：控制台输出请求与完整响应，便于联调 */
export function logPageListApiResponse(
  kind: PageListApiLogKind,
  pathWithQuery: string,
  params: Record<string, unknown> | undefined,
  result: { list: unknown[]; pagination?: unknown; meta?: unknown },
): void {
  const label = kind === 'projects-list' ? '项目列表' : '任务列表';
  const summary: Record<string, unknown> = {
    接口: `GET ${pathWithQuery}`,
    项目数: kind === 'projects-list' ? result.list.length : undefined,
    任务数: kind === 'projects-list' ? countTasksInProjectList(result.list) : result.list.length,
    pagination: result.pagination,
    meta: result.meta,
  };
  if (kind !== 'projects-list') {
    delete summary['项目数'];
  }

  console.log(`\n========== [${label}] 接口响应 ==========`);
  console.log(`[${label}] 请求参数`, params ?? {});
  console.log(`[${label}] 响应摘要`, summary);
  console.log(`[${label}] 完整 list`, result.list);
  console.log(`========== [${label}] END ==========\n`);

  if (enabled) {
    appendApiDebugLog({
      method: 'GET',
      url: pathWithQuery,
      status: 200,
      apiCode: 0,
      durationMs: 0,
      ok: true,
      responseBody: capStoredText(
        JSON.stringify(
          {
            summary,
            list: result.list,
          },
          null,
          2,
        ),
      ),
    });
  }
}
