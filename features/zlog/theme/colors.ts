import { appFonts } from '@/constants/app-fonts';

/**
 * zlog 设计令牌
 * 主题：奶油纸 / 松墨绿 / sage（琥珀金点缀）
 */
export interface ThemeColors {
  bg: string;
  bg2: string;
  surface: string;
  surface2: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  brand: string;
  onBrand: string;
  sage: string;
  sageSoft: string;
  sageLine: string;
  amber: string;
  amberSoft: string;
  danger: string;
  dangerSoft: string;
  border: string;
  borderStrong: string;
  shadow: string;
}

export const lightColors: ThemeColors = {
  bg: '#F5F3E8',
  bg2: '#EFEBDE',
  surface: '#FFFEFA',
  surface2: '#FAF6EC',
  ink: '#1E3932',
  inkSoft: 'rgba(30,57,50,0.62)',
  inkFaint: 'rgba(30,57,50,0.40)',
  brand: '#1E3932',
  onBrand: '#F5F3E8',
  sage: '#5F8A6E',
  sageSoft: '#E2EDE5',
  sageLine: 'rgba(95,138,110,0.28)',
  amber: '#E0B35A',
  amberSoft: '#F6E7C5',
  danger: '#B8553C',
  dangerSoft: '#F4E2DC',
  border: 'rgba(30,57,50,0.10)',
  borderStrong: 'rgba(30,57,50,0.18)',
  shadow: '#1E3932',
};

export const darkColors: ThemeColors = {
  bg: '#121A16',
  bg2: '#0D130F',
  surface: '#1A241F',
  surface2: '#202C25',
  ink: '#E7EFE9',
  inkSoft: 'rgba(231,239,233,0.62)',
  inkFaint: 'rgba(231,239,233,0.38)',
  brand: '#A9C7B9',
  onBrand: '#14211B',
  sage: '#8FB3A0',
  sageSoft: '#24342B',
  sageLine: 'rgba(169,199,185,0.26)',
  amber: '#E0B072',
  amberSoft: '#3A2F1E',
  danger: '#E0876B',
  dangerSoft: '#3A2520',
  border: 'rgba(169,199,185,0.13)',
  borderStrong: 'rgba(169,199,185,0.24)',
  shadow: '#000000',
};

/** 对齐 SelfApp 已加载的 Noto Serif SC */
export const fonts = {
  serif: appFonts.serifBold,
  sans: appFonts.sans,
};

/** 封面 / 图片占位用的渐变调色板（取自主题色系） */
export const coverPalettes: Array<[string, string]> = [
  ['#1E3932', '#5F8A6E'],
  ['#5F8A6E', '#8FB3A0'],
  ['#E0B35A', '#C77E3A'],
  ['#7A6C4F', '#B09A6C'],
  ['#35544E', '#6E9384'],
  ['#B8553C', '#E0B072'],
];

export const glyphs = ['山', '墨', '纸', '茶', '夜', '行', '读', '写', '风', '月'];
