import type { SharedValue } from 'react-native-reanimated';

/** 气泡相对底栏的额外抬升空间（凸起玻璃） */
export const BUBBLE_LIFT_EXTRA = 10;
/** 静止选中背景高度 */
export const BUBBLE_REST_H = 44;
/** 液态玻璃态高度（明显高于静止背景） */
export const BUBBLE_GLASS_H = 54;
/** 圆角：静止略方、玻璃态更圆润 */
export const BUBBLE_REST_R = 14;
export const BUBBLE_GLASS_R = 22;

export type BubbleTheme = {
  /** 静止浅灰选中底 */
  settleFill: string;
  settleBorder: string;
  /** 玻璃主体半透明色 */
  glassFill: string;
  highlight: string;
  isDark: boolean;
};

export type AnimatedGlassBubbleProps = {
  /** 底栏内容区宽度（已测布局） */
  barWidth: number;
  barHeight: number;
  /** 指示器左边缘（shared，弹簧驱动） */
  bubbleX: SharedValue<number>;
  /** 指示器基础宽度（shared，弹簧驱动） */
  bubbleW: SharedValue<number>;
  /** 目标左边缘：用于派生行程拉伸 */
  targetX: SharedValue<number>;
  /** 0=收敛为浅灰选中底，1=凸起液态玻璃 */
  glassProgress: SharedValue<number>;
  /** 整体显隐（首次测量前为 0） */
  opacity: SharedValue<number>;
  theme: BubbleTheme;
};
