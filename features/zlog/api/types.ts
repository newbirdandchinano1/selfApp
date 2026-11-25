export interface PageResult<T> {
  records: T[];
  total: number;
  current: number;
  size: number;
  pages: number;
}

export interface Tag {
  id: number;
  name: string;
}

export interface PostVO {
  id: number;
  title: string;
  summary?: string;
  contentMd?: string;
  contentHtml?: string;
  cover?: string | null;
  authorId?: number;
  authorName?: string;
  authorAvatar?: string;
  authorColor?: string;
  categoryId?: number;
  categoryName?: string;
  categoryColor?: string;
  categorySlug?: string;
  tags?: Tag[];
  views?: number;
  likes?: number;
  comments?: number;
  collections?: number;
  readTime?: number;
  status?: number;
  isTop?: boolean;
  isOfficial?: boolean;
  isFeatured?: boolean;
  createTime?: string;
  updateTime?: string;
  hasLiked?: boolean;
  hasCollected?: boolean;
  hasFollowedAuthor?: boolean;
}

export interface LinkCard {
  platform: string;
  url?: string;
  title: string;
  description?: string;
  cover?: string;
}

export interface MomentVO {
  id: number;
  userId?: number;
  content: string;
  images?: string[];
  linkCard?: LinkCard | null;
  author?: string;
  authorColor?: string;
  authorAvatarUrl?: string;
  timestamp?: string;
  status?: number;
}

export interface Category {
  id: number;
  name: string;
  color?: string;
  slug?: string;
  children?: Category[];
}

export interface UploadResult {
  url: string;
  filename: string;
}
