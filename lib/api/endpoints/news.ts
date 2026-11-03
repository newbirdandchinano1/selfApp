/**
 * TrendRadar 热点资讯接口：/api/app/news/*
 * 对齐 self_app_back routes/app/news.ts
 */
import { APP_API_PREFIX, apiRequest } from '@/lib/api/http';

function buildQuery(params: Record<string, string | number | boolean | null | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === '') continue;
    if (typeof value === 'boolean') {
      qs.set(key, value ? 'true' : 'false');
      continue;
    }
    qs.set(key, String(value));
  }
  const text = qs.toString();
  return text ? `?${text}` : '';
}

export type NewsDateItem = {
  date: string;
  itemCount: number;
  newCount: number;
};

export type TrendRadarNewsItem = {
  id: number;
  reportId: number;
  reportDate: string;
  section: string;
  keywordGroup: string;
  groupSeq: number | null;
  groupTotal: number | null;
  groupCount: number | null;
  seqNo: number | null;
  platformName: string;
  title: string;
  url: string | null;
  rankNo: number | null;
  rankEnd: number | null;
  rankTrend: string | null;
  appearTime: string | null;
  crawlCount: number | null;
  isNew: boolean;
};

export type NewsLatestPayload = {
  date: string | null;
  items: TrendRadarNewsItem[];
  total: number;
};

export type NewsItemsPayload = {
  items: TrendRadarNewsItem[];
  total: number;
};

/** GET /api/app/news/dates */
export async function apiNewsDates(params?: {
  limit?: number;
  signal?: AbortSignal;
}): Promise<{ items: NewsDateItem[] }> {
  return apiRequest<{ items: NewsDateItem[] }>(
    `${APP_API_PREFIX}/news/dates${buildQuery({ limit: params?.limit })}`,
    { method: 'GET', signal: params?.signal, skipGlobalLoading: true },
  );
}

/** GET /api/app/news/latest */
export async function apiNewsLatest(params?: {
  platform?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<NewsLatestPayload> {
  return apiRequest<NewsLatestPayload>(
    `${APP_API_PREFIX}/news/latest${buildQuery({
      platform: params?.platform,
      keyword: params?.keyword,
      limit: params?.limit,
      offset: params?.offset,
    })}`,
    { method: 'GET', signal: params?.signal, skipGlobalLoading: true },
  );
}

/** GET /api/app/news/items?date=YYYY-MM-DD */
export async function apiNewsItems(params: {
  date?: string;
  platform?: string;
  keyword?: string;
  limit?: number;
  offset?: number;
  signal?: AbortSignal;
}): Promise<NewsItemsPayload> {
  return apiRequest<NewsItemsPayload>(
    `${APP_API_PREFIX}/news/items${buildQuery({
      date: params.date,
      platform: params.platform,
      keyword: params.keyword,
      limit: params.limit,
      offset: params.offset,
    })}`,
    { method: 'GET', signal: params.signal, skipGlobalLoading: true },
  );
}
