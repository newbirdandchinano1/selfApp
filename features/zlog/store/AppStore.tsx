import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  ReactNode,
} from 'react';
import { api, ApiError } from '../api/client';
import type { Category, MomentVO, PostVO } from '../api/types';
import {
  MOCK_CATEGORIES,
  filterMockMoments,
  filterMockPosts,
} from '../data/mock';

interface FilterParams {
  keyword?: string;
  categoryId?: number;
}

interface AppStoreValue {
  posts: PostVO[];
  postsLoading: boolean;
  categories: Category[];
  offline: boolean;
  refreshPosts: (params?: FilterParams) => Promise<void>;
  refreshCategories: () => Promise<void>;

  moments: MomentVO[];
  momentsLoading: boolean;
  refreshMoments: (keyword?: string) => Promise<void>;
  createMoment: (body: { content?: string; images?: string[]; linkCard?: any }) => Promise<void>;
  removeMoment: (id: number) => Promise<void>;

  publishPost: (body: {
    title: string;
    summary?: string;
    contentMd?: string;
    contentHtml?: string;
    cover?: string | null;
    categoryId?: number;
    tagIds?: number[];
    status: number;
  }) => Promise<number>;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [posts, setPosts] = useState<PostVO[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [categories, setCategories] = useState<Category[]>(MOCK_CATEGORIES);
  const [offline, setOffline] = useState(false);

  const [moments, setMoments] = useState<MomentVO[]>([]);
  const [momentsLoading, setMomentsLoading] = useState(true);

  const refreshPosts = useCallback(async (params: FilterParams = {}) => {
    setPostsLoading(true);
    try {
      const page = await api.listPosts({
        page: 1,
        size: 20,
        keyword: params.keyword,
        categoryId: params.categoryId,
      });
      setPosts(page.records || []);
      setOffline(false);
    } catch (err) {
      // 接口不可用时回退到示例数据，保证 UI 可展示
      setPosts(filterMockPosts(params));
      setOffline(true);
    } finally {
      setPostsLoading(false);
    }
  }, []);

  const refreshCategories = useCallback(async () => {
    try {
      const data = await api.listCategories();
      const list = Array.isArray(data)
        ? data
        : (data as any)?.records ?? [];
      if (list.length) setCategories(list);
    } catch {
      setCategories(MOCK_CATEGORIES);
    }
  }, []);

  const refreshMoments = useCallback(async (keyword?: string) => {
    setMomentsLoading(true);
    try {
      const page = await api.listMoments({ page: 1, pageSize: 20 });
      let records = page.records || [];
      if (keyword?.trim()) {
        records = records.filter((m) => (m.content || '').includes(keyword.trim()));
      }
      setMoments(records);
    } catch {
      setMoments(filterMockMoments(keyword));
    } finally {
      setMomentsLoading(false);
    }
  }, []);

  const createMoment = useCallback(
    async (body: { content?: string; images?: string[]; linkCard?: any }) => {
      await api.createMoment(body);
      await refreshMoments();
    },
    [refreshMoments]
  );

  const removeMoment = useCallback(
    async (id: number) => {
      await api.deleteMoment(id);
      setMoments((prev) => prev.filter((m) => m.id !== id));
    },
    []
  );

  const publishPost = useCallback(
    async (body: {
      title: string;
      summary?: string;
      contentMd?: string;
      contentHtml?: string;
      cover?: string | null;
      categoryId?: number;
      tagIds?: number[];
      status: number;
    }) => {
      const id = await api.publishPost(body);
      await refreshPosts();
      return id;
    },
    [refreshPosts]
  );

  const value = useMemo<AppStoreValue>(
    () => ({
      posts,
      postsLoading,
      categories,
      offline,
      refreshPosts,
      refreshCategories,
      moments,
      momentsLoading,
      refreshMoments,
      createMoment,
      removeMoment,
      publishPost,
    }),
    [
      posts,
      postsLoading,
      categories,
      offline,
      refreshPosts,
      refreshCategories,
      moments,
      momentsLoading,
      refreshMoments,
      createMoment,
      removeMoment,
      publishPost,
    ]
  );

  return (
    <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>
  );
}

export function useAppStore(): AppStoreValue {
  const ctx = useContext(AppStoreContext);
  if (!ctx) throw new Error('useAppStore 必须在 AppStoreProvider 内使用');
  return ctx;
}

export { ApiError };
