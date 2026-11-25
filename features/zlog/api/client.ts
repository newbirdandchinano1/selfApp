import { BASE_URL, PAT } from '../config';
import type {
  PageResult,
  PostVO,
  MomentVO,
  Category,
  UploadResult,
} from './types';

export class ApiError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function qs(params: Record<string, string | number | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15000
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const isForm = init.body instanceof FormData;
    const res = await fetch(BASE_URL + path, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${PAT}`,
        ...(isForm ? {} : { 'Content-Type': 'application/json' }),
        ...((init.headers as Record<string, string>) || {}),
      },
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      throw new ApiError(res.status, '返回数据解析失败');
    }

    if (!json || json.code !== 200) {
      throw new ApiError(
        json?.code ?? res.status,
        json?.message || json?.msg || `请求失败 (${res.status})`
      );
    }
    return json.data as T;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new ApiError(0, '请求超时，请检查网络或 :4002 端口');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  /* ---------- 博客 ---------- */
  listPosts(
    params: {
      page?: number;
      size?: number;
      keyword?: string;
      categoryId?: number;
      authorId?: number;
      isTop?: number;
      isFeatured?: number;
    } = {}
  ) {
    return request<PageResult<PostVO>>(
      `/api/post/list${qs({
        page: params.page ?? 1,
        size: params.size ?? 10,
        keyword: params.keyword,
        categoryId: params.categoryId,
        authorId: params.authorId,
        isTop: params.isTop,
        isFeatured: params.isFeatured,
      })}`
    );
  },

  getPost(id: number) {
    return request<PostVO>(`/api/post/${id}`);
  },

  publishPost(body: {
    id?: number | null;
    title: string;
    summary?: string;
    contentMd?: string;
    contentHtml?: string;
    cover?: string | null;
    categoryId?: number;
    tagIds?: number[];
    status: number;
  }) {
    return request<number>(`/api/post/publish`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  listCategories() {
    return request<Category[] | PageResult<Category>>('/api/post-category/list');
  },

  /* ---------- 说说 ---------- */
  listMoments(params: { page?: number; pageSize?: number } = {}) {
    return request<PageResult<MomentVO>>(
      `/api/moments${qs({
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 10,
      })}`
    );
  },

  createMoment(body: {
    content?: string;
    images?: string[];
    linkCard?: any;
  }) {
    return request<MomentVO>(`/api/moments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  deleteMoment(id: number) {
    return request<null>(`/api/moments/${id}`, { method: 'DELETE' });
  },

  /* ---------- 上传 ---------- */
  async uploadImage(uri: string): Promise<UploadResult> {
    const name = uri.split('/').pop() || `photo-${Date.now()}.jpg`;
    const lower = name.toLowerCase();
    const type = lower.endsWith('.png')
      ? 'image/png'
      : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg';

    const form = new FormData();
    // RN 的 FormData 接受 { uri, name, type } 结构
    form.append('file', { uri, name, type } as any);

    const res = await fetch(`${BASE_URL}/api/files/post-image`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${PAT}`,
      },
      body: form,
    });
    const json = await res.json();
    if (!json || json.code !== 200) {
      throw new ApiError(json?.code ?? res.status, json?.message || '图片上传失败');
    }
    return json.data as UploadResult;
  },

};

/** 相对路径拼完整地址 */
export function imageUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http://') || path.startsWith('https://')) return path;
  return BASE_URL + path;
}
