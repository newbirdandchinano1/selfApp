/**
 * 星座视觉：中文名 / 拼音 → 码表 + 符号色。
 */

export type ZodiacCode =
  | 'baiyang'
  | 'jinniu'
  | 'shuangzi'
  | 'juxie'
  | 'shizi'
  | 'chunv'
  | 'tiancheng'
  | 'tianxie'
  | 'sheshou'
  | 'mojie'
  | 'shuiping'
  | 'shuangyu';

export type ZodiacVisual = {
  code: ZodiacCode;
  name: string;
  /** Unicode 星座符号 */
  glyph: string;
  accent: string;
  wash: string;
};

const ZODIAC: ZodiacVisual[] = [
  { code: 'baiyang', name: '白羊座', glyph: '♈', accent: '#C96A4B', wash: '#F5DED6' },
  { code: 'jinniu', name: '金牛座', glyph: '♉', accent: '#7FA695', wash: '#DDE8E0' },
  { code: 'shuangzi', name: '双子座', glyph: '♊', accent: '#D99A4E', wash: '#F4E5CC' },
  { code: 'juxie', name: '巨蟹座', glyph: '♋', accent: '#6A8FA8', wash: '#D9E6EF' },
  { code: 'shizi', name: '狮子座', glyph: '♌', accent: '#D99A4E', wash: '#F7E8C8' },
  { code: 'chunv', name: '处女座', glyph: '♍', accent: '#7FA695', wash: '#E2EDE6' },
  { code: 'tiancheng', name: '天秤座', glyph: '♎', accent: '#C98B6E', wash: '#F3E2D8' },
  { code: 'tianxie', name: '天蝎座', glyph: '♏', accent: '#6B4E6E', wash: '#E8DEE8' },
  { code: 'sheshou', name: '射手座', glyph: '♐', accent: '#C96A4B', wash: '#F5DED6' },
  { code: 'mojie', name: '摩羯座', glyph: '♑', accent: '#4E6358', wash: '#DCE6E0' },
  { code: 'shuiping', name: '水瓶座', glyph: '♒', accent: '#5B8FA8', wash: '#D6E8F0' },
  { code: 'shuangyu', name: '双鱼座', glyph: '♓', accent: '#7A90B0', wash: '#DEE6F2' },
];

const BY_ALIAS = new Map<string, ZodiacVisual>();
for (const z of ZODIAC) {
  BY_ALIAS.set(z.code, z);
  BY_ALIAS.set(z.name, z);
  BY_ALIAS.set(z.name.replace(/座$/, ''), z);
  BY_ALIAS.set(z.glyph, z);
}

export function listZodiacVisuals(): ZodiacVisual[] {
  return ZODIAC.slice();
}

export function resolveZodiacVisual(raw: string | null | undefined): ZodiacVisual {
  const key = (raw ?? '').trim();
  if (!key) return ZODIAC[10]; // 默认水瓶
  return BY_ALIAS.get(key) ?? BY_ALIAS.get(key.replace(/座$/, '')) ?? ZODIAC[10];
}
