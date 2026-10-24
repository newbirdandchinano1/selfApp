/**
 * 任务折页视觉令牌 — 对齐 `task-screens/任务APP-设计稿.html`
 * Paper warm · Pond green · Lily lime · Sun amber；仅任务相关页消费。
 */
import { Platform } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export const TASK_FOLD_LIGHT = {
  paper: '#F4F0E8',
  paper2: '#EDE7DB',
  paper3: '#F1EDE2',
  card: '#FFFCF5',
  cardSoft: 'rgba(255,252,245,0.92)',
  cream: '#FFFCF4',
  ink: '#202A25',
  ink2: '#46534C',
  pond: '#20382F',
  pond2: '#2C4E3F',
  onPond: '#F7F4E9',
  frog: '#4F7C51',
  frog2: '#6B9562',
  lily: '#C9D9A3',
  lily2: '#E8EFD9',
  mist: '#E6ECE0',
  water: '#93B4A3',
  sage: '#7FA695',
  sage2: '#DDE8E0',
  sun: '#D6974B',
  sun2: '#F5E6CB',
  amber: '#D99A4E',
  amber2: '#F4E5CC',
  amberInk: '#8A5F25',
  rose: '#C47055',
  rose2: '#F4DED4',
  clay: '#C96A4B',
  clay2: '#F5DED6',
  muted: '#7A857D',
  faint: '#98A197',
  line: '#E6DDCE',
  line2: '#D8CDBB',
  white: '#FFFDF8',
  track: '#ECE6D8',
  heat0: '#ECE7DA',
  heat1: '#DEE8CE',
  heat2: '#C1D3A4',
  heat3: '#96B57C',
  heat4: '#658F58',
  heat5: '#355E45',
  shadow: '#20382F',
  dim: 'rgba(25,34,28,0.42)',
  scoreFrom: '#F5E8CF',
  scoreTo: '#FBF4E4',
  scoreBorder: '#E7CEA4',
  scoreInk: '#7E5A24',
  scoreMuted: '#A07B45',
} as const;

export type TaskFoldPalette = { readonly [K in keyof typeof TASK_FOLD_LIGHT]: string };

export const TASK_FOLD_DARK: TaskFoldPalette = {
  paper: '#141C18',
  paper2: '#1B2621',
  paper3: '#222E28',
  card: 'rgba(255,252,245,0.06)',
  cardSoft: 'rgba(255,252,245,0.08)',
  cream: '#1F2A24',
  ink: '#F2EEE4',
  ink2: '#C6D0C9',
  pond: '#A9C7B9',
  pond2: '#8DB5A3',
  onPond: '#F7F4E9',
  frog: '#7FA06F',
  frog2: '#96B57C',
  lily: '#658F58',
  lily2: 'rgba(201,217,163,0.18)',
  mist: 'rgba(230,236,224,0.12)',
  water: '#93B4A3',
  sage: '#7FA695',
  sage2: 'rgba(127,166,149,0.22)',
  sun: '#E0B072',
  sun2: 'rgba(214,151,75,0.18)',
  amber: '#E0B072',
  amber2: 'rgba(224,176,114,0.18)',
  amberInk: '#EFC894',
  rose: '#E08B6D',
  rose2: 'rgba(196,112,85,0.2)',
  clay: '#E08B6D',
  clay2: 'rgba(224,139,109,0.2)',
  muted: '#8A968F',
  faint: '#7A8A82',
  line: 'rgba(230,221,206,0.14)',
  line2: 'rgba(230,221,206,0.24)',
  white: '#FFFDF8',
  track: 'rgba(236,230,216,0.14)',
  heat0: '#26312B',
  heat1: '#33473D',
  heat2: '#48675A',
  heat3: '#6D9482',
  heat4: '#8FBEAA',
  heat5: '#A8D4C0',
  shadow: '#000000',
  dim: 'rgba(8,14,12,0.62)',
  scoreFrom: 'rgba(245,232,207,0.16)',
  scoreTo: 'rgba(251,244,228,0.1)',
  scoreBorder: 'rgba(231,206,164,0.35)',
  scoreInk: '#EFC894',
  scoreMuted: '#C9A66E',
};

export const taskFoldFonts = {
  serif: Platform.select({ ios: 'Songti SC', android: 'serif', default: 'serif' }),
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

/** 设计稿动效时长（ms） */
export const TaskFoldMotion = {
  scrim: 240,
  sheet: 420,
  rowStagger: 45,
  paneInd: 300,
  /** 三窗格内容交叉淡入（设计稿 120ms，不横向推挤） */
  paneFade: 120,
  zoomMorph: 380,
  /** 格内详情底栏上滑（设计稿 shot 04） */
  detailSheet: 380,
  /** 完成确认弹窗 */
  confirmDialog: 340,
  /** 快捷输入提交后收拢 */
  quickInputCollapse: 180,
  /** 待办行长按抬起 → 操作抽屉 */
  todoLongPress: 420,
  pressSpring: 180,
  livePulse: 2600,
  preselGlow: 2000,
  frogHop: 1600,
  stampPop: 340,
  checkBurst: 1800,
  /** 日程块错峰上浮 */
  schedBlockStagger: 42,
  /** 热力格绽放：单格 420ms / 错峰 12ms（设计稿 --i=c*7+r） */
  heatBloom: 420,
  heatBloomStagger: 12,
  /** 热力选中明细展开（高度回弹） */
  heatDetail: 300,
  /** 勾选完成后热力防抖刷新 */
  heatRefreshDebounce: 400,
  /** 项目树展开：高度 + 箭头旋转 */
  treeExpand: 360,
  /** 项目树子行级联 */
  treeStagger: 35,
  /** 进度环 / 进度条补间（非入场） */
  progressTween: 280,
  /** 积分 / 热力数字滚动 */
  countUp: 760,
  /** 任务日历：换月时标题淡出 */
  calMonthFade: 120,
  /** 任务日历：点日选中填充 */
  calDaySelect: 180,
  /** 任务日历：日明细展开 */
  calDetailExpand: 300,
  /** 新建待办：四象限选中灰→绿 */
  prioSelect: 220,
  /** 新建待办：条件字段展开 */
  fieldExpand: 240,
  /** 保存 toast 停留 */
  toastHold: 1700,
  /** 分类排序：长按抬起延迟 */
  sortLongPress: 300,
  /** 分类排序：拖起缩放 */
  sortDragScale: 180,
  /** 项目标签：权重条补间 */
  tagWeightBar: 420,
  /** 日程选择器：日期/时刻 Tab 指示片 */
  pickTabInd: 280,
  /** 习惯详情：月历按周错峰淡入 */
  habitCalFade: 360,
  habitCalStagger: 16,
  /** 习惯详情：近 14 天趋势柱自底生长 */
  habitSparkGrow: 480,
  habitSparkStagger: 28,
  /** 新建习惯：类型 morph（设计稿 shot 23 · 280ms） */
  habitTypeMorph: 280,
  /** 新建习惯：折叠高度补间 */
  habitAccExpand: 260,
  /** 新建习惯：积分区 hbtFade */
  habitScoreFade: 260,
  /** 新建习惯：名称光标闪烁半周期 */
  habitCaretBlink: 700,
} as const;

export function useTaskFoldTheme(): {
  tf: TaskFoldPalette;
  isDark: boolean;
  fonts: typeof taskFoldFonts;
} {
  const { isDark } = useAppTheme();
  return {
    tf: isDark ? TASK_FOLD_DARK : TASK_FOLD_LIGHT,
    isDark,
    fonts: taskFoldFonts,
  };
}
