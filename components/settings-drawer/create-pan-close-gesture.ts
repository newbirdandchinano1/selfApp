import { Gesture } from 'react-native-gesture-handler';
import { Easing, runOnJS, withTiming, type SharedValue } from 'react-native-reanimated';

const OPEN_VELOCITY = 520;
const HORIZONTAL_ACTIVATE_PX = 12;
const VERTICAL_FAIL_PX = 10;
const CLOSE_MS = 360;
const OVERLAY_MS = 350;
const DRAWER_EASE = Easing.bezier(0.22, 1, 0.36, 1);

export type PanCloseGestureRefs = {
  translateX: SharedValue<number>;
  backdropOpacity: SharedValue<number>;
  touchStartX: SharedValue<number>;
  touchStartY: SharedValue<number>;
  closedOffset: number;
  drawerWidth: number;
  openThreshold: number;
  onClose: () => void;
  /** 减少动态效果时瞬间贴合 */
  motionOk?: boolean;
};

export function createPanCloseGesture(enabled: boolean, refs: PanCloseGestureRefs) {
  const {
    translateX,
    backdropOpacity,
    touchStartX,
    touchStartY,
    closedOffset,
    drawerWidth,
    openThreshold,
    onClose,
    motionOk = true,
  } = refs;

  return Gesture.Pan()
    .enabled(enabled)
    .manualActivation(true)
    .onTouchesDown(e => {
      'worklet';
      const t = e.allTouches[0];
      if (t) {
        touchStartX.value = t.x;
        touchStartY.value = t.y;
      }
    })
    .onTouchesMove((e, state) => {
      'worklet';
      const t = e.allTouches[0];
      if (!t) return;
      const dx = t.x - touchStartX.value;
      const dy = t.y - touchStartY.value;
      if (dx < -HORIZONTAL_ACTIVATE_PX && Math.abs(dx) > Math.abs(dy) * 1.1) {
        state.activate();
      } else if (Math.abs(dy) > VERTICAL_FAIL_PX && Math.abs(dy) >= Math.abs(dx)) {
        state.fail();
      }
    })
    .onUpdate(e => {
      'worklet';
      if (e.translationX < 0) {
        translateX.value = Math.max(closedOffset, e.translationX);
        backdropOpacity.value = 1 + translateX.value / drawerWidth;
      }
    })
    .onEnd(e => {
      'worklet';
      const shouldClose = e.translationX < -openThreshold || e.velocityX < -OPEN_VELOCITY;
      const closeMs = motionOk ? CLOSE_MS : 0;
      const overlayMs = motionOk ? OVERLAY_MS : 0;
      if (shouldClose) {
        translateX.value = withTiming(closedOffset, { duration: closeMs, easing: DRAWER_EASE });
        backdropOpacity.value = withTiming(0, { duration: overlayMs, easing: DRAWER_EASE });
        runOnJS(onClose)();
      } else {
        translateX.value = withTiming(0, { duration: closeMs, easing: DRAWER_EASE });
        backdropOpacity.value = withTiming(1, { duration: overlayMs, easing: DRAWER_EASE });
      }
    });
}
