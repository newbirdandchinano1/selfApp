/**
 * 拼图编辑器数据模型：对齐设计稿 `衣橱-UI重构-拼图版.html` 的 collageState。
 */

export type CollageRatio = '1:1' | '9:16' | '2:3' | '3:2' | '3:4' | '4:3';
/** portrait/detail 为旧演示预设；custom 为用户导入照片 */
export type CollagePhotoKind = 'portrait' | 'detail' | 'none' | 'custom';
export type CollageStickerType = 'sparkle' | 'tape' | 'stamp' | 'label' | 'heart' | 'asterisk';
export type CollageTool = 'background' | 'items' | 'photo' | 'text' | 'material' | '';
export type CollageBgSub = 'bg' | 'ratio';

export type CollagePiece = {
  uid: string;
  id: string;
  x: number;
  y: number;
  rot: number;
  scale: number;
};

export type CollagePhoto = {
  kind: CollagePhotoKind;
  /** custom 时的本地 file URI 或统一库 `/uploads/images/...` */
  uri?: string;
  x: number;
  y: number;
  rot: number;
  scale: number;
};

export type CollageCaption = {
  text: string;
  x: number;
  y: number;
  rot: number;
  tone: number;
};

export type CollageSticker = {
  uid: string;
  type: CollageStickerType;
  x: number;
  y: number;
  rot: number;
};

/** 持久化到 wardrobe_outfits.extra_data.collage（无运行时 uid） */
export type OutfitCollagePersisted = {
  ratio: CollageRatio;
  bg: string;
  photo: CollagePhoto;
  caption: CollageCaption;
  items: Omit<CollagePiece, 'uid'>[];
  stickers: Omit<CollageSticker, 'uid'>[];
  seasons?: string[];
  tags?: string[];
};

export const COLLAGE_RATIOS: CollageRatio[] = ['1:1', '9:16', '2:3', '3:2', '3:4', '4:3'];

export const COLLAGE_RATIO_NAMES: Record<CollageRatio, string> = {
  '1:1': '1:1',
  '9:16': '壁纸',
  '2:3': '2:3',
  '3:2': '3:2',
  '3:4': '3:4',
  '4:3': '4:3',
};

export const COLLAGE_SWATCHES = [
  '#F4F0E7',
  '#F8DDE5',
  '#FCE6DB',
  '#DDEEF1',
  '#D8E2F4',
  '#E6DCF2',
  '#F3D3DA',
  '#F7E9C7',
  '#DCEAD8',
  '#D8D2CA',
  '#E5B36C',
  '#1D2A24',
] as const;

export const COLLAGE_PATTERNS: { key: string; label: string }[] = [
  { key: 'gridPink', label: '樱粉格' },
  { key: 'stripeBlue', label: '雾蓝纹' },
  { key: 'wideBlue', label: '海盐纹' },
  { key: 'sage', label: '鼠尾草' },
  { key: 'checkPurple', label: '丁香格' },
  { key: 'checkOrange', label: '杏子格' },
  { key: 'paper', label: '亚麻纸' },
];

export const COLLAGE_TONES: { bg: [string, string]; fg: string }[] = [
  { bg: ['#294B3F', '#1B352B'], fg: '#FFF5DF' },
  { bg: ['#F3E4C7', '#E4C897'], fg: '#4C4739' },
  { bg: ['#C47C73', '#A85C58'], fg: '#FFF5E9' },
  { bg: ['#1E2E28', '#101B16'], fg: '#F2D6A6' },
];

export const COLLAGE_STICKER_CATALOG: { type: CollageStickerType; label: string }[] = [
  { type: 'sparkle', label: '星芒' },
  { type: 'tape', label: '胶带' },
  { type: 'stamp', label: '印章' },
  { type: 'label', label: '标签' },
  { type: 'heart', label: '爱心' },
  { type: 'asterisk', label: '花体' },
];

export const COLLAGE_LAYOUTS = [
  { x: 29, y: 39, rot: -6, scale: 1.02 },
  { x: 31, y: 75, rot: 4, scale: 0.84 },
  { x: 70, y: 73, rot: -3, scale: 0.83 },
  { x: 76, y: 44, rot: 7, scale: 0.72 },
] as const;

export const COLLAGE_SEASONS = ['春', '夏', '秋', '冬', '四季'] as const;

let collageSeq = 0;
export function collageUid(prefix: string): string {
  collageSeq += 1;
  return `${prefix}${collageSeq}`;
}

export function defaultCollageItems(ids: string[]): CollagePiece[] {
  return ids.slice(0, 4).map((id, index) => ({
    uid: collageUid('p'),
    id,
    ...(COLLAGE_LAYOUTS[index] ?? {
      x: 34 + (index % 3) * 16,
      y: 32 + (index % 2) * 14,
      rot: index % 2 ? 5 : -5,
      scale: 0.8,
    }),
  }));
}

/** 新建拼图不预置贴纸；用户从「素材」Tray 自行添加。 */
export function defaultCollageStickers(): CollageSticker[] {
  return [];
}

export function defaultCollagePhoto(kind: CollagePhotoKind = 'none', uri?: string): CollagePhoto {
  return {
    kind,
    ...(kind === 'custom' && uri?.trim() ? { uri: uri.trim() } : {}),
    x: 70,
    y: 32,
    rot: 2,
    scale: 1,
  };
}

export function normalizeCollagePhoto(raw: Partial<CollagePhoto> | null | undefined): CollagePhoto {
  const kindRaw = typeof raw?.kind === 'string' ? raw.kind : 'none';
  const kind = (
    ['portrait', 'detail', 'none', 'custom'].includes(kindRaw) ? kindRaw : 'none'
  ) as CollagePhotoKind;
  const uri = typeof raw?.uri === 'string' ? raw.uri.trim() : '';
  if (kind === 'custom' && !uri) {
    return defaultCollagePhoto('none');
  }
  return {
    kind,
    ...(kind === 'custom' ? { uri } : {}),
    x: Number(raw?.x) || 70,
    y: Number(raw?.y) || 32,
    rot: Number(raw?.rot) || 0,
    scale: Number(raw?.scale) || 1,
  };
}

export function defaultCollageCaption(text = '新的搭配'): CollageCaption {
  return { text, x: 48, y: 88, rot: -2, tone: 0 };
}

export function clampPct(n: number, min = 4, max = 96): number {
  return Math.min(max, Math.max(min, n));
}

export function parseOutfitCollage(extra: unknown): OutfitCollagePersisted | null {
  if (!extra || typeof extra !== 'object') return null;
  const collage = (extra as { collage?: unknown }).collage;
  if (!collage || typeof collage !== 'object') return null;
  const c = collage as Partial<OutfitCollagePersisted>;
  if (!c.ratio || !c.bg || !c.photo || !c.caption || !Array.isArray(c.items)) return null;
  return {
    ratio: (COLLAGE_RATIOS.includes(c.ratio as CollageRatio) ? c.ratio : '1:1') as CollageRatio,
    bg: String(c.bg),
    photo: normalizeCollagePhoto(c.photo),
    caption: {
      text: String(c.caption.text ?? ''),
      x: Number(c.caption.x) || 48,
      y: Number(c.caption.y) || 88,
      rot: Number(c.caption.rot) || -2,
      tone: Math.max(0, Math.min(3, Number(c.caption.tone) || 0)),
    },
    items: c.items.map((piece) => ({
      id: String(piece.id),
      x: Number(piece.x) || 50,
      y: Number(piece.y) || 50,
      rot: Number(piece.rot) || 0,
      scale: Number(piece.scale) || 1,
    })),
    stickers: Array.isArray(c.stickers)
      ? c.stickers.map((s) => ({
          type: s.type as CollageStickerType,
          x: Number(s.x) || 50,
          y: Number(s.y) || 50,
          rot: Number(s.rot) || 0,
        }))
      : [],
    seasons: Array.isArray(c.seasons) ? c.seasons.map(String) : undefined,
    tags: Array.isArray(c.tags) ? c.tags.map(String) : undefined,
  };
}

export function hydrateCollageRuntime(persisted: OutfitCollagePersisted | null, fallbackItemIds: string[], name?: string) {
  if (persisted) {
    return {
      ratio: persisted.ratio,
      bg: persisted.bg,
      photo: { ...persisted.photo },
      caption: { ...persisted.caption },
      items: persisted.items.map((piece) => ({ ...piece, uid: collageUid('p') })),
      stickers: persisted.stickers.map((s) => ({ ...s, uid: collageUid('s') })),
      seasons: persisted.seasons?.length ? [...persisted.seasons] : ['秋'],
      tags: persisted.tags?.length ? [...persisted.tags] : ['通勤', '温柔', '针织'],
    };
  }
  const ids = fallbackItemIds.length ? fallbackItemIds : [];
  return {
    ratio: '1:1' as CollageRatio,
    bg: 'stripeBlue',
    // 新建画布不预置照片 / 文字 / 贴纸，由用户从 Tray 添加
    photo: defaultCollagePhoto('none'),
    caption: defaultCollageCaption(''),
    items: defaultCollageItems(ids.length ? ids : []),
    stickers: defaultCollageStickers(),
    seasons: ['秋'],
    tags: ['通勤', '温柔', '针织'],
  };
}

export function serializeCollageExtra(input: {
  ratio: CollageRatio;
  bg: string;
  photo: CollagePhoto;
  caption: CollageCaption;
  items: CollagePiece[];
  stickers: CollageSticker[];
  seasons: string[];
  tags: string[];
}): { collage: OutfitCollagePersisted } {
  const photo = normalizeCollagePhoto(input.photo);
  return {
    collage: {
      ratio: input.ratio,
      bg: input.bg,
      photo,
      caption: { ...input.caption },
      items: input.items.map(({ uid: _uid, ...piece }) => piece),
      stickers: input.stickers.map(({ uid: _uid, ...s }) => s),
      seasons: input.seasons,
      tags: input.tags,
    },
  };
}

export function fitArtboardSize(
  availW: number,
  availH: number,
  ratio: CollageRatio,
  maxW = 352,
): { width: number; height: number } {
  const [wRatio, hRatio] = ratio.split(':').map(Number) as [number, number];
  const padW = Math.max(120, availW - 34);
  const padH = Math.max(120, availH - 10);
  let width = Math.min(padW, padH * (wRatio / hRatio), maxW);
  let height = width * (hRatio / wRatio);
  if (height > padH) {
    height = padH;
    width = height * (wRatio / hRatio);
  }
  return { width: Math.round(width), height: Math.round(height) };
}
