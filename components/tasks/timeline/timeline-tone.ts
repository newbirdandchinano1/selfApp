/**

 * 阶段 F：时间线卡片配色（浅底圆角卡 + 左侧粗色条 + 完成退饱和）。

 * 每条指派按 id 稳定伪随机取色，避免同类统一色。

 */

import type { TaskFoldPalette } from '@/constants/task-fold-theme';



export type TimelineTone = {

  barColor: string;

  cardBg: string;

  cardBorder: string;

  titleColor: string;

  metaColor: string;

  dotColor: string;

};



/** 多色浅底色板（bar / rgb 分量 / 标题色）；按 seed 取模，相邻 id 尽量拉开色相 */

const CARD_PALETTE: { bar: string; light: string; title: string }[] = [

  { bar: '#5B8A72', light: '91,138,114', title: '#2F4A3C' },

  { bar: '#C47A5A', light: '196,122,90', title: '#6B3E2E' },

  { bar: '#6A8EAE', light: '106,142,174', title: '#2F4A63' },

  { bar: '#B08968', light: '176,137,104', title: '#5C4030' },

  { bar: '#8B7BB8', light: '139,123,184', title: '#4A3D6B' },

  { bar: '#C9A227', light: '201,162,39', title: '#6B5410' },

  { bar: '#D6974B', light: '214,151,75', title: '#7A5B2D' },

  { bar: '#7FA695', light: '127,166,149', title: '#4B6048' },

  { bar: '#A66B8A', light: '166,107,138', title: '#5C3048' },

  { bar: '#5E9A9A', light: '94,154,154', title: '#2F5555' },

  { bar: '#35604A', light: '53,96,74', title: '#24402F' },

  { bar: '#87A566', light: '135,165,102', title: '#4C653F' },

];



function hashSeed(seed: string): number {

  let h = 2166136261;

  for (let i = 0; i < seed.length; i++) {

    h ^= seed.charCodeAt(i);

    h = Math.imul(h, 16777619);

  }

  return h >>> 0;

}



function pickPalette(seed: string): { bar: string; light: string; title: string } {

  const idx = hashSeed(seed) % CARD_PALETTE.length;

  return CARD_PALETTE[idx]!;

}



export function resolveTimelineTone(

  seed: string,

  opts: { done: boolean; isDark: boolean; tf: TaskFoldPalette; overdue?: boolean },

): TimelineTone {

  const { done, isDark, tf, overdue } = opts;



  if (done) {

    return {

      barColor: isDark ? tf.line2 : '#C9CFC2',

      cardBg: isDark ? 'rgba(255,252,245,0.04)' : 'rgba(255,252,245,0.7)',

      cardBorder: isDark ? tf.line : 'rgba(210,206,194,0.7)',

      titleColor: isDark ? tf.faint : '#9AA096',

      metaColor: isDark ? 'rgba(152,161,151,0.7)' : 'rgba(154,160,150,0.85)',

      dotColor: isDark ? tf.faint : '#B4BAAF',

    };

  }



  const base = pickPalette(seed);

  const accent = overdue ? tf.rose : null;



  return {

    barColor: accent ?? base.bar,

    cardBg: isDark ? `rgba(${base.light},0.18)` : `rgba(${base.light},0.14)`,

    cardBorder: accent

      ? `${tf.rose}66`

      : isDark

        ? `rgba(${base.light},0.42)`

        : `rgba(${base.light},0.28)`,

    titleColor: isDark ? tf.ink2 : base.title,

    metaColor: isDark ? 'rgba(198,206,199,0.72)' : 'rgba(76,90,80,0.66)',

    dotColor: accent ?? base.bar,

  };

}


