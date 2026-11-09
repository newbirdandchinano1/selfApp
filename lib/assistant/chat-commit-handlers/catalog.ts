/**
 * 通用 Catalog 写入：按 Agent 确认卡 draft 中的 method/path 调原 /api/app 业务 API。
 * 无精品 commit_* 映射时兜底；禁止静默写，必须经确认卡。
 */

import type { ChatCommitHandler, ChatCommitHandlerResult } from '@/lib/assistant/chat-commit';
import { draftString, fail, ok, requestPushPending } from './shared';

const FORBIDDEN_PATH_SNIPS = [
  '/redeem',
  '/points/adjust',
  '/points/reset',
  '/admin',
  '/auth/',
  '/webhook',
  '/data/',
] as const;

function fillPathTemplate(
  template: string,
  draft: Record<string, unknown>,
): string | null {
  let path = template;
  const missing: string[] = [];
  path = path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_m, name: string) => {
    const raw = draft[name];
    const val =
      typeof raw === 'string' || typeof raw === 'number' ? String(raw).trim() : '';
    if (!val) {
      missing.push(name);
      return `:${name}`;
    }
    return encodeURIComponent(val);
  });
  if (missing.length) return null;
  return path;
}

function isAllowedAppPath(path: string): boolean {
  if (!path.startsWith('/api/app/')) return false;
  const lower = path.toLowerCase();
  return !FORBIDDEN_PATH_SNIPS.some(s => lower.includes(s));
}

function buildBody(draft: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(draft)) {
    if (k.startsWith('_')) continue;
    if (k === 'id') continue;
    body[k] = v;
  }
  return body;
}

export async function commitCatalogWrite(
  draft: Record<string, unknown>,
): Promise<ChatCommitHandlerResult> {
  const method = draftString(draft, '_http_method').toUpperCase();
  const pathTemplate = draftString(draft, '_http_path');
  const operationId = draftString(draft, '_catalog_operation_id');

  if (!method || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return fail('invalid_method', 'Catalog 写入缺少合法 HTTP 方法');
  }
  if (!pathTemplate) {
    return fail('invalid_path', 'Catalog 写入缺少目标 path');
  }

  const filled = fillPathTemplate(pathTemplate, draft);
  if (!filled) {
    return fail('incomplete_draft', '缺少路径参数，请补充后再确认');
  }
  if (!isAllowedAppPath(filled)) {
    return fail('forbidden_path', '该接口不允许通过通用 Catalog 确认写调用');
  }

  try {
    const { apiRequest } = await import('@/lib/api/http');
    const body = buildBody(draft);
    const hasBody = method !== 'DELETE' && Object.keys(body).length > 0;
    const data = await apiRequest<unknown>(filled, {
      method: method as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
      ...(hasBody ? { body } : method !== 'DELETE' ? { body: {} } : {}),
    });

    await requestPushPending();

    const entityId =
      (data &&
        typeof data === 'object' &&
        'id' in data &&
        typeof (data as { id: unknown }).id === 'string' &&
        (data as { id: string }).id) ||
      operationId ||
      filled;

    return ok(String(entityId), '已按确认提交到业务接口', 'synced');
  } catch (err) {
    const message =
      err && typeof err === 'object' && 'message' in err
        ? String((err as { message: unknown }).message)
        : 'Catalog 写入失败';
    return fail('catalog_write_failed', message || 'Catalog 写入失败');
  }
}

export const catalogCommitHandlers: Record<string, ChatCommitHandler> = {
  commit_catalog_write: async input => commitCatalogWrite(input.draft),
};
