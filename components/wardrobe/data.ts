/** 衣橱演示数据：对齐 `衣橱-UI重构.html` 的 items / categories / outfits */

export type WardrobeArt =
  | 'hoodie'
  | 'knit'
  | 'shirt'
  | 'pants'
  | 'jeans'
  | 'skirt'
  | 'coat'
  | 'jacket'
  | 'dress'
  | 'suit'
  | 'sneaker'
  | 'bag';

export type WardrobeItem = {
  id: string;
  name: string;
  category: string;
  price: string;
  season: string;
  color: string;
  brand: string;
  wear: number;
  warmth: string;
  code: string;
  fit: string;
  art: WardrobeArt;
  tint: string;
  tint2: string;
  line: string;
  tags: string[];
  date: string;
};

export type WardrobeCategory = {
  name: string;
  ids: string[];
  tint: string;
  tint2: string;
  tone: string;
};

export type WardrobeOutfit = {
  id: string;
  name: string;
  occasion: string;
  date: string;
  wear: number;
  items: string[];
  note: string;
};

export type ClosetLayout = 'card' | 'double' | 'single';
export type ClosetSort = 'recent' | 'category' | 'color' | 'price' | 'wear';
export type WardrobeTab = 'closet' | 'outfits' | 'mine';
export type SeasonFilter = 'all' | 'ss' | 'aw';

export const WARDROBE_ITEMS: WardrobeItem[] = [
  {
    id: 'i1',
    name: '藏青连帽卫衣',
    category: '未分类',
    price: '¥ 299',
    season: '秋 / 冬',
    color: '藏青',
    brand: 'UNIQLO',
    wear: 8,
    warmth: '8–18°C',
    code: 'HOODIE  /  001',
    fit: '宽松',
    art: 'hoodie',
    tint: '#D9E4E1',
    tint2: '#C1D5D0',
    line: '#31564C',
    tags: ['基础款', '通勤', '棉质'],
    date: '2026.10.28',
  },
  {
    id: 'i2',
    name: '奶油白针织开衫',
    category: '上衣',
    price: '¥ 459',
    season: '秋 / 冬',
    color: '燕麦白',
    brand: 'MASSIMO DUTTI',
    wear: 5,
    warmth: '10–20°C',
    code: 'KNITWEAR  /  014',
    fit: '常规',
    art: 'knit',
    tint: '#F0E6D1',
    tint2: '#DDD1B7',
    line: '#927C5D',
    tags: ['针织', '温柔', '羊毛混纺'],
    date: '2026.10.24',
  },
  {
    id: 'i3',
    name: '雾霾蓝府绸衬衫',
    category: '上衣',
    price: '¥ 329',
    season: '春 / 秋',
    color: '雾蓝',
    brand: 'COS',
    wear: 12,
    warmth: '15–24°C',
    code: 'SHIRT  /  027',
    fit: '微宽松',
    art: 'shirt',
    tint: '#DDE8EB',
    tint2: '#C4D7DC',
    line: '#4E6971',
    tags: ['纯棉', '通勤', '基础款'],
    date: '2026.10.20',
  },
  {
    id: 'i4',
    name: '燕麦色直筒西裤',
    category: '下装',
    price: '¥ 399',
    season: '四季',
    color: '燕麦色',
    brand: 'ARKET',
    wear: 9,
    warmth: '12–24°C',
    code: 'TROUSERS  /  008',
    fit: '直筒',
    art: 'pants',
    tint: '#EBE2D2',
    tint2: '#D8CBB5',
    line: '#806E56',
    tags: ['显腿长', '通勤', '垂感'],
    date: '2026.10.18',
  },
  {
    id: 'i5',
    name: '原色直筒牛仔裤',
    category: '下装',
    price: '¥ 369',
    season: '春 / 秋',
    color: '靛蓝',
    brand: 'LEVI’S',
    wear: 15,
    warmth: '12–25°C',
    code: 'DENIM  /  021',
    fit: '直筒',
    art: 'jeans',
    tint: '#DCE6E9',
    tint2: '#BFD1D8',
    line: '#42616C',
    tags: ['丹宁', '日常', '经典'],
    date: '2026.10.16',
  },
  {
    id: 'i6',
    name: '深橄榄伞摆半裙',
    category: '下装',
    price: '¥ 289',
    season: '春 / 秋',
    color: '橄榄绿',
    brand: '& OTHER STORIES',
    wear: 6,
    warmth: '14–24°C',
    code: 'SKIRT  /  011',
    fit: 'A字',
    art: 'skirt',
    tint: '#E2E7DA',
    tint2: '#C8D2BE',
    line: '#566A4E',
    tags: ['A字', '复古', '轻盈'],
    date: '2026.10.13',
  },
  {
    id: 'i7',
    name: '炭灰羊毛长大衣',
    category: '外套',
    price: '¥ 1,290',
    season: '冬',
    color: '炭灰',
    brand: 'COS',
    wear: 3,
    warmth: '-2–12°C',
    code: 'COAT  /  003',
    fit: '廓形',
    art: 'coat',
    tint: '#E4E1DD',
    tint2: '#C9C5BE',
    line: '#555A57',
    tags: ['羊毛', '经典', '廓形'],
    date: '2026.10.09',
  },
  {
    id: 'i8',
    name: '鼠尾草短款夹克',
    category: '外套',
    price: '¥ 689',
    season: '春 / 秋',
    color: '鼠尾草绿',
    brand: 'MUJI',
    wear: 7,
    warmth: '10–22°C',
    code: 'JACKET  /  017',
    fit: '短款',
    art: 'jacket',
    tint: '#E0E8DC',
    tint2: '#C3D2BD',
    line: '#587058',
    tags: ['棉质', '轻户外', '短款'],
    date: '2026.10.05',
  },
  {
    id: 'i9',
    name: '杏色方领连衣裙',
    category: '连衣裙',
    price: '¥ 569',
    season: '春 / 夏',
    color: '杏色',
    brand: 'ARKET',
    wear: 4,
    warmth: '18–30°C',
    code: 'DRESS  /  005',
    fit: '收腰',
    art: 'dress',
    tint: '#F2E2D1',
    tint2: '#E1CBB2',
    line: '#9C7654',
    tags: ['方领', '度假', '棉麻'],
    date: '2026.09.30',
  },
  {
    id: 'i10',
    name: '米灰羊毛西装',
    category: '正装',
    price: '¥ 1,180',
    season: '四季',
    color: '米灰',
    brand: 'THEORY',
    wear: 2,
    warmth: '12–24°C',
    code: 'SUIT  /  002',
    fit: '修身',
    art: 'suit',
    tint: '#E5E2D9',
    tint2: '#CECCBF',
    line: '#67675C',
    tags: ['羊毛', '商务', '修身'],
    date: '2026.09.26',
  },
  {
    id: 'i11',
    name: '复古拼色帆布鞋',
    category: '鞋履',
    price: '¥ 429',
    season: '四季',
    color: '奶油 / 棕',
    brand: 'NEW BALANCE',
    wear: 18,
    warmth: '四季',
    code: 'SNEAKER  /  019',
    fit: 'US 7.5',
    art: 'sneaker',
    tint: '#EEE5D9',
    tint2: '#D9C9B3',
    line: '#806A4F',
    tags: ['复古', '日常', '舒适'],
    date: '2026.09.21',
  },
  {
    id: 'i12',
    name: '焦糖色小号手提包',
    category: '配饰',
    price: '¥ 799',
    season: '四季',
    color: '焦糖棕',
    brand: 'POLÈNE',
    wear: 11,
    warmth: '—',
    code: 'BAG  /  012',
    fit: '小号',
    art: 'bag',
    tint: '#F1E0CC',
    tint2: '#DEC3A5',
    line: '#896341',
    tags: ['皮革', '通勤', '手提'],
    date: '2026.09.15',
  },
];

export const WARDROBE_CATEGORIES: WardrobeCategory[] = [
  { name: '未分类', ids: ['i1'], tint: '#DCE8E5', tint2: '#C3D6D0', tone: '#36584F' },
  { name: '上衣', ids: ['i2', 'i3'], tint: '#E8E8DC', tint2: '#D5D6C6', tone: '#5F684E' },
  { name: '下装', ids: ['i4', 'i5', 'i6'], tint: '#E9E3D4', tint2: '#D7CDB9', tone: '#786A4F' },
  { name: '连衣裙', ids: ['i9'], tint: '#F0E2D6', tint2: '#DEC9B5', tone: '#936C50' },
  { name: '外套', ids: ['i7', 'i8'], tint: '#E2E7DD', tint2: '#CBD4C4', tone: '#596750' },
  { name: '运动装', ids: [], tint: '#E0E9E9', tint2: '#C9D9D9', tone: '#4E6B71' },
  { name: '正装', ids: ['i10'], tint: '#E6E3DB', tint2: '#CFCCC1', tone: '#65645C' },
  { name: '鞋履', ids: ['i11'], tint: '#EFE7D9', tint2: '#DCCDB8', tone: '#826C4F' },
  { name: '配饰', ids: ['i12'], tint: '#F1E4D4', tint2: '#DFC7A8', tone: '#8D6743' },
];

export const WARDROBE_OUTFITS: WardrobeOutfit[] = [
  {
    id: 'o1',
    name: '初秋的通勤',
    occasion: '工作',
    date: '10.28',
    wear: 8,
    items: ['i2', 'i4', 'i12'],
    note: '奶油针织与燕麦西裤，安静又有质感。',
  },
  {
    id: 'o2',
    name: '蓝调周末',
    occasion: '休闲',
    date: '10.26',
    wear: 6,
    items: ['i3', 'i5', 'i11'],
    note: '雾蓝与原色丹宁，留一点松弛感。',
  },
  {
    id: 'o3',
    name: '微凉散步',
    occasion: '休闲',
    date: '10.23',
    wear: 4,
    items: ['i8', 'i5', 'i11'],
    note: '鼠尾草绿夹克，适合有风的傍晚。',
  },
  {
    id: 'o4',
    name: '轻盈午后',
    occasion: '度假',
    date: '10.21',
    wear: 3,
    items: ['i9', 'i11', 'i12'],
    note: '杏色棉麻，把阳光留在裙摆上。',
  },
  {
    id: 'o5',
    name: '深绿与奶油',
    occasion: '工作',
    date: '10.19',
    wear: 5,
    items: ['i2', 'i6', 'i12'],
    note: '柔软针织叠搭深橄榄色。',
  },
  {
    id: 'o6',
    name: '利落会议日',
    occasion: '正装',
    date: '10.17',
    wear: 2,
    items: ['i10', 'i3', 'i11'],
    note: '米灰西装与雾蓝衬衫，简洁有分寸。',
  },
  {
    id: 'o7',
    name: '风起时',
    occasion: '休闲',
    date: '10.14',
    wear: 4,
    items: ['i7', 'i3', 'i5'],
    note: '炭灰羊毛大衣，温度与线条并存。',
  },
  {
    id: 'o8',
    name: '衣橱日常',
    occasion: '工作',
    date: '10.11',
    wear: 7,
    items: ['i1', 'i4', 'i11'],
    note: '一件熟悉的卫衣，也可以很完整。',
  },
];

export const OCCASIONS = ['全部', '工作', '正装', '休闲', '运动', '派对', '居家', '度假'] as const;
export const CLOSET_ORDER = [
  '未分类',
  '上衣',
  '下装',
  '连衣裙',
  '外套',
  '运动装',
  '正装',
  '鞋履',
  '配饰',
] as const;
export const RECENT_SEARCHES = ['针织', '通勤', '雾蓝', '秋冬', '帆布鞋'];

export function itemById(id: string, items: WardrobeItem[] = WARDROBE_ITEMS): WardrobeItem | undefined {
  return items.find((item) => item.id === id);
}

export function parsePrice(price: string): number {
  return Number(price.replace(/[^\d]/g, '')) || 0;
}

export function matchSeason(item: WardrobeItem, season: SeasonFilter): boolean {
  if (season === 'all') return true;
  const map = { ss: ['春', '夏', '四季'], aw: ['秋', '冬', '四季'] } as const;
  return item.season.split(' / ').some((part) => (map[season] as readonly string[]).includes(part));
}

export function sortItems(list: WardrobeItem[], sort: ClosetSort): WardrobeItem[] {
  const sorted = [...list];
  if (sort === 'category') {
    return sorted.sort(
      (a, b) => CLOSET_ORDER.indexOf(a.category as (typeof CLOSET_ORDER)[number]) - CLOSET_ORDER.indexOf(b.category as (typeof CLOSET_ORDER)[number]),
    );
  }
  if (sort === 'color') return sorted.sort((a, b) => a.color.localeCompare(b.color, 'zh'));
  if (sort === 'price') return sorted.sort((a, b) => parsePrice(b.price) - parsePrice(a.price));
  if (sort === 'wear') return sorted.sort((a, b) => b.wear - a.wear);
  return sorted;
}

export function pad2(value: number | string): string {
  return String(value).padStart(2, '0');
}
