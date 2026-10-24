import { useFoldMotionGate } from '@/components/review/fold-motion';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { MaterialIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import React, { useCallback, useEffect, useMemo } from 'react';
import { Dimensions, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createPanCloseGesture } from './create-pan-close-gesture';
import { GlobalSettingsPanel } from './global-settings-panel';
import { useSettingsDrawer } from './settings-drawer-context';

const DRAWER_WIDTH_FALLBACK = 320;
const OPEN_THRESHOLD_RATIO = 0.32;
const OPEN_VELOCITY = 520;
/** 抽屉右缘拖拽条宽度，便于左滑收起 */
const DRAWER_RIGHT_DRAG_WIDTH = 28;
/** 仅在此宽度内（屏幕左缘）起手向右滑才打开抽屉；尽量窄以免挡住页面左侧按钮 */
const LEFT_OPEN_EDGE_WIDTH = 16;
const OPEN_HORIZONTAL_ACTIVATE_PX = 16;
const OPEN_VERTICAL_FAIL_PX = 10;

/** 设计稿 drawer .4s ease / overlay .35s */
const DRAWER_OPEN_MS = 400;
const DRAWER_CLOSE_MS = 360;
const OVERLAY_MS = 350;
const DRAWER_EASE = Easing.bezier(0.22, 1, 0.36, 1);

type Props = {
  children: React.ReactNode;
  drawerWidth: number;
  /** 底部 Tab 栏高度，左缘滑动手势区不覆盖该区域，避免与最左侧 Tab 点击冲突 */
  tabBarHeight?: number;
};

/** 包裹主 Tab 内容：在屏幕左缘向右滑，从左侧拉出全局设置抽屉 */
export function SettingsDrawerHost({ children, drawerWidth, tabBarHeight = 0 }: Props) {
  const insets = useSafeAreaInsets();
  const { palette, fold, isDark } = useFoldTheme();
  const { animate: motionOk } = useFoldMotionGate();
  const { isOpen, initialSection, open, close } = useSettingsDrawer();
  const screenHeight = Dimensions.get('window').height;

  const closedOffset = -drawerWidth;
  const translateX = useSharedValue(closedOffset);
  const backdropOpacity = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const closeRotate = useSharedValue(0);
  const openThreshold = drawerWidth * OPEN_THRESHOLD_RATIO;

  const snapOpen = useCallback(() => {
    const ms = motionOk ? DRAWER_OPEN_MS : 0;
    const overlayMs = motionOk ? OVERLAY_MS : 0;
    translateX.value = withTiming(0, { duration: ms, easing: DRAWER_EASE });
    backdropOpacity.value = withTiming(1, { duration: overlayMs, easing: DRAWER_EASE });
  }, [backdropOpacity, motionOk, translateX]);

  const snapClose = useCallback(() => {
    const ms = motionOk ? DRAWER_CLOSE_MS : 0;
    const overlayMs = motionOk ? OVERLAY_MS : 0;
    translateX.value = withTiming(closedOffset, { duration: ms, easing: DRAWER_EASE });
    backdropOpacity.value = withTiming(0, { duration: overlayMs, easing: DRAWER_EASE });
    closeRotate.value = withTiming(0, { duration: motionOk ? 180 : 0 });
  }, [backdropOpacity, closeRotate, closedOffset, motionOk, translateX]);

  useEffect(() => {
    if (isOpen) snapOpen();
    else snapClose();
  }, [isOpen, snapOpen, snapClose]);

  const finishOpen = useCallback(() => open(), [open]);
  const finishClose = useCallback(() => close(), [close]);

  const setBackdropFromTranslate = (x: number) => {
    'worklet';
    backdropOpacity.value = 1 + x / drawerWidth;
  };

  /** 向右滑：左侧设置面板跟手滑入；手动激活，非左缘点击直接 fail，不挡左侧按钮 */
  const panToOpen = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!isOpen)
        .manualActivation(true)
        .onTouchesDown((e, state) => {
          'worklet';
          const t = e.allTouches[0];
          if (!t) {
            state.fail();
            return;
          }
          if (t.absoluteX > LEFT_OPEN_EDGE_WIDTH) {
            state.fail();
            return;
          }
          if (tabBarHeight > 0 && t.absoluteY >= screenHeight - tabBarHeight) {
            state.fail();
            return;
          }
          touchStartX.value = t.absoluteX;
          touchStartY.value = t.absoluteY;
        })
        .onTouchesMove((e, state) => {
          'worklet';
          const t = e.allTouches[0];
          if (!t) return;
          const dx = t.absoluteX - touchStartX.value;
          const dy = t.absoluteY - touchStartY.value;
          if (dx > OPEN_HORIZONTAL_ACTIVATE_PX && Math.abs(dx) > Math.abs(dy) * 1.1) {
            state.activate();
          } else if (Math.abs(dy) > OPEN_VERTICAL_FAIL_PX && Math.abs(dy) >= Math.abs(dx)) {
            state.fail();
          }
        })
        .onUpdate(e => {
          'worklet';
          if (e.translationX > 0) {
            translateX.value = Math.min(0, closedOffset + e.translationX);
            setBackdropFromTranslate(translateX.value);
          }
        })
        .onEnd(e => {
          'worklet';
          const shouldOpen = e.translationX > openThreshold || e.velocityX > OPEN_VELOCITY;
          const ms = motionOk ? DRAWER_OPEN_MS : 0;
          const closeMs = motionOk ? DRAWER_CLOSE_MS : 0;
          if (shouldOpen) {
            translateX.value = withTiming(0, { duration: ms, easing: DRAWER_EASE });
            backdropOpacity.value = withTiming(1, {
              duration: motionOk ? OVERLAY_MS : 0,
              easing: DRAWER_EASE,
            });
            runOnJS(finishOpen)();
          } else {
            translateX.value = withTiming(closedOffset, { duration: closeMs, easing: DRAWER_EASE });
            backdropOpacity.value = withTiming(0, {
              duration: motionOk ? OVERLAY_MS : 0,
              easing: DRAWER_EASE,
            });
          }
        }),
    [
      isOpen,
      tabBarHeight,
      screenHeight,
      closedOffset,
      openThreshold,
      finishOpen,
      translateX,
      backdropOpacity,
      touchStartX,
      touchStartY,
      motionOk,
    ],
  );

  const handleBackdropPress = useCallback(() => {
    close();
  }, [close]);

  const panCloseRefs = useMemo(
    () => ({
      translateX,
      backdropOpacity,
      touchStartX,
      touchStartY,
      closedOffset,
      drawerWidth,
      openThreshold,
      onClose: finishClose,
      motionOk,
    }),
    [
      closedOffset,
      drawerWidth,
      openThreshold,
      finishClose,
      translateX,
      backdropOpacity,
      touchStartX,
      touchStartY,
      motionOk,
    ],
  );

  const panCloseScroll = useMemo(
    () => createPanCloseGesture(isOpen, panCloseRefs),
    [isOpen, panCloseRefs],
  );
  const panCloseHeader = useMemo(
    () => createPanCloseGesture(isOpen, panCloseRefs),
    [isOpen, panCloseRefs],
  );
  const panCloseEdge = useMemo(() => createPanCloseGesture(isOpen, panCloseRefs), [isOpen, panCloseRefs]);
  const panCloseBackdrop = useMemo(
    () => createPanCloseGesture(isOpen, panCloseRefs),
    [isOpen, panCloseRefs],
  );

  const tapBackdrop = Gesture.Tap().onEnd(() => {
    runOnJS(handleBackdropPress)();
  });

  const backdropGestures = Gesture.Exclusive(panCloseBackdrop, tapBackdrop);

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: backdropOpacity.value,
  }));

  const closeBtnStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${closeRotate.value}deg` }, { scale: closeRotate.value > 45 ? 0.92 : 1 }],
  }));

  const onClosePressIn = useCallback(() => {
    closeRotate.value = withTiming(90, {
      duration: motionOk ? 200 : 0,
      easing: Easing.bezier(0.34, 1.56, 0.64, 1),
    });
  }, [closeRotate, motionOk]);

  const onClosePressOut = useCallback(() => {
    if (!isOpen) {
      closeRotate.value = withTiming(0, { duration: motionOk ? 160 : 0 });
    }
  }, [closeRotate, isOpen, motionOk]);

  const overlayTint = isDark ? 'rgba(18,26,22,0.55)' : 'rgba(32,42,37,0.35)';

  return (
    <View style={styles.host}>
      <GestureDetector gesture={panToOpen}>
        <View style={styles.content} pointerEvents={isOpen ? 'none' : 'auto'} accessibilityLabel="打开全局设置">
          {children}
        </View>
      </GestureDetector>

      <GestureDetector gesture={backdropGestures}>
        <Animated.View
          pointerEvents={isOpen ? 'auto' : 'none'}
          style={[styles.backdrop, backdropStyle]}
          accessibilityLabel="关闭设置">
          {Platform.OS !== 'web' ? (
            <BlurView
              intensity={isDark ? 18 : 12}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
              blurMethod={Platform.OS === 'android' ? 'dimezisBlurView' : undefined}
            />
          ) : null}
          <View style={[StyleSheet.absoluteFill, { backgroundColor: overlayTint }]} />
        </Animated.View>
      </GestureDetector>

      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={[
          styles.drawer,
          {
            width: drawerWidth,
            backgroundColor: palette.paper,
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
            shadowColor: fold.shadow,
          },
          drawerStyle,
        ]}>
        <View style={styles.drawerInner}>
          <GestureDetector gesture={panCloseHeader}>
            <View style={[styles.header, { borderBottomColor: palette.line }]}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.headerKicker, { color: palette.muted }]}>SETTINGS</Text>
                <Text style={[styles.headerTitle, { color: palette.ink }]}>全局设置</Text>
                <Text style={[styles.headerHint, { color: palette.muted }]}>
                  左缘右滑打开 · 面板内左滑收起
                </Text>
              </View>
              <Pressable
                onPress={close}
                onPressIn={onClosePressIn}
                onPressOut={onClosePressOut}
                hitSlop={12}
                accessibilityLabel="关闭">
                <Animated.View
                  style={[
                    styles.closeBtn,
                    {
                      backgroundColor: isDark ? fold.cardSoft : 'rgba(255,252,245,0.65)',
                      borderColor: palette.line,
                    },
                    closeBtnStyle,
                  ]}>
                  <MaterialIcons name="close" size={20} color={palette.inkSoft} />
                </Animated.View>
              </Pressable>
            </View>
          </GestureDetector>
          <GlobalSettingsPanel
            initialSection={initialSection}
            panCloseGesture={panCloseScroll as never}
          />
          <GestureDetector gesture={panCloseEdge}>
            <View
              style={[styles.drawerRightDragEdge, { width: DRAWER_RIGHT_DRAG_WIDTH }]}
              pointerEvents="box-only"
              accessibilityLabel="左滑收起设置"
            />
          </GestureDetector>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  content: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFill,
    zIndex: 35,
    elevation: 35,
    overflow: 'hidden',
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 40,
    shadowOffset: { width: 10, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 40,
  },
  drawerInner: { flex: 1 },
  drawerRightDragEdge: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerKicker: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.9,
    textTransform: 'uppercase',
  },
  headerTitle: { fontSize: 20, fontWeight: '700', marginTop: 2, letterSpacing: 0.2 },
  headerHint: { fontSize: 10, marginTop: 4, lineHeight: 14 },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});

export { DRAWER_WIDTH_FALLBACK };
