import type { Category, MomentVO, PostVO } from '../api/types';

/**
 * 离线/接口不可用时的示例数据（字段与文档一致），
 * 保证首次启动也能看到完整 UI。
 */
export const MOCK_CATEGORIES: Category[] = [
  { id: 1, name: '摄影', color: '#5F8A6E', slug: 'photography' },
  { id: 2, name: '设计', color: '#E0B35A', slug: 'design' },
  { id: 3, name: '技术', color: '#5F8A6E', slug: 'tech' },
  { id: 4, name: '生活', color: '#E0B35A', slug: 'life' },
  { id: 5, name: '旅行', color: '#7A6C4F', slug: 'travel' },
  { id: 6, name: '随笔', color: '#E0B35A', slug: 'essay' },
];

export const MOCK_POSTS: PostVO[] = [
  {
    id: 1,
    title: '《山海》· 摄影手记：在风里找一座山的形状',
    summary:
      '凌晨四点出发，雾还没散。取景框里，山只是墨色的一笔——直到风把云层撕开一道口子。',
    categoryId: 1,
    categoryName: '摄影',
    categoryColor: '#5F8A6E',
    tags: [
      { id: 1, name: '摄影' },
      { id: 2, name: '旅行' },
    ],
    authorName: '臻',
    authorColor: '#5F8A6E',
    views: 1024,
    likes: 231,
    comments: 18,
    readTime: 6,
    isTop: true,
    isFeatured: true,
    createTime: '2026-11-25 08:12',
    contentHtml:
      '<p>凌晨四点出发，雾还没散。</p><h2>取景框里的山</h2><p>取景框里，山只是墨色的一笔——直到风把云层撕开一道口子，光落下来，整座山都醒了。</p><blockquote>好的照片不是拍出来的，是等出来的。</blockquote><p>快门按下的那一刻，我知道这一程值了。</p>',
  },
  {
    id: 2,
    title: '奶油纸上的松墨：一份极简写作界面的设计观',
    summary:
      '为什么我喜欢在奶油色背景上写字？聊聊低对比、衬线字体，以及留白如何让文字呼吸。',
    categoryId: 2,
    categoryName: '设计',
    categoryColor: '#E0B35A',
    tags: [
      { id: 3, name: '设计' },
      { id: 4, name: '写作' },
    ],
    authorName: '纸鸢',
    authorColor: '#B8553C',
    views: 876,
    likes: 154,
    comments: 23,
    readTime: 5,
    createTime: '2026-11-24 21:40',
    contentHtml:
      '<p>奶油色不是米黄，也不是纯白。它像一张微微泛黄的纸，让黑色文字不再刺眼。</p><h2>留白即呼吸</h2><p>当段落之间有了足够的距离，阅读就变成了散步，而不是赶路。</p>',
  },
  {
    id: 3,
    title: '春日食单：青团与艾草的一百种吃法',
    summary:
      '外婆的配方，一勺猪油、两把艾草。蒸笼掀开的那一下，整个厨房都是春天。',
    categoryId: 4,
    categoryName: '生活',
    categoryColor: '#E0B35A',
    tags: [
      { id: 5, name: '美食' },
      { id: 6, name: '生活' },
    ],
    authorName: '灶台',
    authorColor: '#B8553C',
    views: 2103,
    likes: 512,
    comments: 67,
    readTime: 4,
    createTime: '2026-11-23 12:00',
    contentHtml: '<p>一勺猪油、两把艾草，是外婆的配方。</p><p>蒸笼掀开的那一下，整个厨房都是春天。</p>',
  },
  {
    id: 4,
    title: '从零开始写一个 Markdown 渲染器',
    summary:
      '不引第三方库，用 300 行代码实现标题、列表、代码块、引用与表格的解析渲染。',
    categoryId: 3,
    categoryName: '技术',
    categoryColor: '#5F8A6E',
    tags: [
      { id: 7, name: '前端' },
      { id: 8, name: 'Markdown' },
    ],
    authorName: '码农老张',
    authorColor: '#5F8A6E',
    views: 4500,
    likes: 398,
    comments: 42,
    readTime: 12,
    isFeatured: true,
    createTime: '2026-11-22 18:20',
    contentHtml:
      '<p>不引第三方库，用 300 行代码实现一个可用的 Markdown 渲染器。</p><h2>解析思路</h2><p>先按行切分，识别块级元素，再对行内元素做正则替换。</p>',
  },
  {
    id: 5,
    title: '夜航西飞：一个人去大西北的七天',
    summary:
      '从兰州到敦煌，一路向西。戈壁滩上的星空，是我见过最沉默的盛大。',
    categoryId: 5,
    categoryName: '旅行',
    categoryColor: '#7A6C4F',
    tags: [
      { id: 9, name: '旅行' },
      { id: 10, name: '摄影' },
    ],
    authorName: '远行客',
    authorColor: '#7A6C4F',
    views: 1305,
    likes: 210,
    comments: 31,
    readTime: 9,
    createTime: '2026-11-21 09:15',
    contentHtml:
      '<p>从兰州到敦煌，一路向西。</p><blockquote>戈壁滩上的星空，是我见过最沉默的盛大。</blockquote>',
  },
  {
    id: 6,
    title: '读书札记：关于「无用之用」的几段摘抄',
    summary:
      '一些散落在书页边角的话，关于缓慢、关于无用、关于把日子过成一首诗。',
    categoryId: 6,
    categoryName: '随笔',
    categoryColor: '#E0B35A',
    tags: [
      { id: 11, name: '读书' },
      { id: 12, name: '随笔' },
    ],
    authorName: '臻',
    authorColor: '#5F8A6E',
    views: 540,
    likes: 89,
    comments: 12,
    readTime: 3,
    createTime: '2026-11-20 20:05',
    contentHtml: '<p>一些散落在书页边角的话，关于缓慢、关于无用。</p>',
  },
];

export const MOCK_MOMENTS: MomentVO[] = [
  {
    id: 1,
    author: '臻',
    authorColor: '#5F8A6E',
    content: '今天的晚霞像被打翻的松墨，从山的这边一直晕染到那边。',
    images: ['/uploads/post/a.png', '/uploads/post/b.png', '/uploads/post/c.png'],
    timestamp: '2026-11-25 18:30',
  },
  {
    id: 2,
    author: '纸鸢',
    authorColor: '#B8553C',
    content: '把桌面整理成奶油色，效率好像真的变高了。\n也许只是心情变好了。',
    images: [],
    timestamp: '2026-11-25 16:02',
  },
  {
    id: 3,
    author: '灶台',
    authorColor: '#E0B35A',
    content: '立冬后的第一锅萝卜炖牛腩，香气飘满整条楼道。',
    images: ['/uploads/post/d.png', '/uploads/post/e.png', '/uploads/post/f.png', '/uploads/post/g.png'],
    timestamp: '2026-11-24 19:40',
  },
  {
    id: 4,
    author: '远行客',
    authorColor: '#7A6C4F',
    content: '分享一个链接：最近在刷的纪录片，讲茶叶的四季。',
    images: [],
    linkCard: {
      platform: 'bilibili',
      url: 'https://www.bilibili.com/video/BVxxxx',
      title: '《茶，一片树叶的故事》纪录片',
      description: '一部关于茶的四季与山河',
    },
    timestamp: '2026-11-24 11:20',
  },
  {
    id: 5,
    author: '码农老张',
    authorColor: '#5F8A6E',
    content: '重构完成，代码量少了 40%，心情指数 +100%。',
    images: [],
    timestamp: '2026-11-23 23:59',
  },
];

export function filterMockPosts(params: { keyword?: string; categoryId?: number }): PostVO[] {
  let list = [...MOCK_POSTS];
  const kw = (params.keyword || '').trim().toLowerCase();
  if (kw) {
    list = list.filter((p) =>
      `${p.title} ${p.summary || ''} ${(p.tags || []).map((t) => t.name).join(' ')}`
        .toLowerCase()
        .includes(kw)
    );
  }
  if (params.categoryId) {
    list = list.filter((p) => p.categoryId === params.categoryId);
  }
  return list.sort(
    (a, b) => Number(b.isTop || 0) - Number(a.isTop || 0) || (b.id || 0) - (a.id || 0)
  );
}

export function filterMockMoments(keyword?: string): MomentVO[] {
  const kw = (keyword || '').trim();
  if (!kw) return [...MOCK_MOMENTS];
  return MOCK_MOMENTS.filter((m) => m.content.includes(kw));
}
