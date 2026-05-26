import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
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

type Props = {
  children: React.ReactNode;
  drawerWidth: number;
  /** 底部 Tab 栏高度，左缘滑动手势区不覆盖该区域，避免与最左侧 Tab 点击冲突 */
  tabBarHeight?: number;
};

/** 包裹主 Tab 内容：在屏幕左缘向右滑，从左侧拉出全局设置抽屉 */
export function SettingsDrawerHost({ children, drawerWidth, tabBarHeight = 0 }: Props) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { isOpen, initialSection, open, close } = useSettingsDrawer();
  const screenHeight = Dimensions.get('window').height;

  const closedOffset = -drawerWidth;
  const translateX = useSharedValue(closedOffset);
  const backdropOpacity = useSharedValue(0);
  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const openThreshold = drawerWidth * OPEN_THRESHOLD_RATIO;

  const snapOpen = useCallback(() => {
    translateX.value = 0;
    backdropOpacity.value = 1;
  }, [backdropOpacity, translateX]);

  const snapClose = useCallback(() => {
    translateX.value = closedOffset;
    backdropOpacity.value = 0;
  }, [backdropOpacity, closedOffset, translateX]);

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
          if (shouldOpen) {
            translateX.value = 0;
            backdropOpacity.value = 1;
            runOnJS(finishOpen)();
          } else {
            translateX.value = closedOffset;
            backdropOpacity.value = 0;
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
    }),
    [closedOffset, drawerWidth, openThreshold, finishClose, translateX, backdropOpacity, touchStartX, touchStartY],
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

  const text = theme.text;
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const surface = isDark ? theme.surface : '#ffffff';

  return (
    <View style={styles.host}>
      <GestureDetector gesture={panToOpen}>
        <View style={styles.content} pointerEvents={isOpen ? 'none' : 'auto'} accessibilityLabel="打开全局设置">
          {children}
        </View>
      </GestureDetector>

      {/* 跟手滑动时的半透明层（不拦截点击） */}
      {!isOpen ? <Animated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} /> : null}

      {/* 打开后：点击或左滑遮罩区域关闭 */}
      {isOpen ? (
        <GestureDetector gesture={backdropGestures}>
          <View style={styles.backdropPressable} accessibilityLabel="关闭设置" />
        </GestureDetector>
      ) : null}

      <Animated.View
        pointerEvents={isOpen ? 'auto' : 'none'}
        style={[
          styles.drawer,
          {
            width: drawerWidth,
            backgroundColor: isDark ? theme.background : '#faf8ff',
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          },
          drawerStyle,
        ]}>
        <View style={styles.drawerInner}>
          <GestureDetector gesture={panCloseHeader}>
            <View style={[styles.header, { borderBottomColor: isDark ? 'rgba(148,163,184,0.15)' : 'rgba(0,0,0,0.06)' }]}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.headerKicker, { color: outline }]}>SETTINGS</Text>
                <Text style={[styles.headerTitle, { color: text }]}>全局设置</Text>
                <Text style={[styles.headerHint, { color: outline }]}>左缘右滑打开 · 面板内左滑收起</Text>
              </View>
              <Pressable
                onPress={close}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.closeBtn,
                  { backgroundColor: surface, opacity: pressed ? 0.8 : 1 },
                ]}
                accessibilityLabel="关闭">
                <MaterialIcons name="close" size={22} color={text} />
              </Pressable>
            </View>
          </GestureDetector>
          <GlobalSettingsPanel initialSection={initialSection} panCloseGesture={panCloseScroll} />
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
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
    zIndex: 30,
  },
  backdropPressable: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.42)',
    zIndex: 35,
    elevation: 35,
  },
  drawer: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    zIndex: 40,
    shadowColor: '#000',
    shadowOffset: { width: 4, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 16,
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
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerKicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  headerTitle: { fontSize: 20, fontWeight: '800', marginTop: 2 },
  headerHint: { fontSize: 11, marginTop: 6, lineHeight: 16 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export { DRAWER_WIDTH_FALLBACK };
