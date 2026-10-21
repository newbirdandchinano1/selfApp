import { makeMutable, withTiming } from 'react-native-reanimated';
import { useSyncExternalStore } from 'react';

/**
 * 悬浮底栏的滚动自动隐藏：
 * 页面下滑 → 淡出；页面上滑 → 淡入。
 * 各 Tab 主滚动容器在 onScroll 中调用 reportTabBarScroll(contentOffset.y)，
 * 切 Tab / 回到顶部时调用 resetTabBarAutoHide() 复位。
 */

const FADE_MS = 180;
/** 连续下滑多少像素后隐藏（避免轻微抖动误触） */
const HIDE_AFTER_PX = 18;
/** 连续上滑多少像素后显示 */
const SHOW_AFTER_PX = 10;
/** 接近顶部时始终显示，不参与自动隐藏 */
const KEEP_VISIBLE_TOP_PX = 64;
/** 复位后短暂冻结自动隐藏，避免首屏内容加载抖动误隐藏 */
const ARM_DELAY_MS = 350;

/** 1 = 完全显示，0 = 已淡出；由底栏动画消费 */
export const tabBarVisibility = makeMutable(1);

let hidden = false;
let lastY: number | null = null;
let downAcc = 0;
let upAcc = 0;
/** 复位时刻：此后的短窗口内不触发隐藏 */
let armedAt = 0;
const listeners = new Set<() => void>();

function setHidden(next: boolean) {
  if (hidden === next) return;
  hidden = next;
  tabBarVisibility.value = withTiming(next ? 0 : 1, { duration: FADE_MS });
  listeners.forEach(listener => listener());
}

/** 主滚动容器上报纵向偏移 */
export function reportTabBarScroll(y: number) {
  if (!Number.isFinite(y)) return;

  // 每个页面首次上报只取基线，避免复用旧位置导致误判方向
  if (lastY === null) {
    lastY = y;
    if (y <= KEEP_VISIBLE_TOP_PX) {
      downAcc = 0;
      upAcc = 0;
      setHidden(false);
    }
    return;
  }

  const dy = y - lastY;
  lastY = y;

  // 靠近顶部时永远显示
  if (y <= KEEP_VISIBLE_TOP_PX) {
    downAcc = 0;
    upAcc = 0;
    setHidden(false);
    return;
  }

  if (dy > 0.5) {
    downAcc += dy;
    upAcc = 0;
  } else if (dy < -0.5) {
    upAcc -= dy;
    downAcc = 0;
  }

  if (!hidden && downAcc >= HIDE_AFTER_PX) {
    downAcc = 0;
    // 刚复位/刚进页面时内容可能整体位移，不据此隐藏
    if (Date.now() - armedAt < ARM_DELAY_MS) return;
    setHidden(true);
    return;
  }
  if (hidden && upAcc >= SHOW_AFTER_PX) {
    upAcc = 0;
    setHidden(false);
  }
}

/** 切 Tab 或重置滚动位置时调用：恢复显示并重新取基线 */
export function resetTabBarAutoHide() {
  lastY = null;
  downAcc = 0;
  upAcc = 0;
  armedAt = Date.now();
  setHidden(false);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot() {
  return hidden;
}

/** 供底栏读取当前是否隐藏（用于切换 pointerEvents） */
export function useTabBarHidden(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
