import { useColorScheme } from '@/hooks/use-color-scheme';
import { getRecipePalette } from '@/lib/recipe-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

const FAB_SIZE = 56;
const EDGE = 14;
const DRAG_ACTIVATE_PX = 8;

type Props = {
  count: number;
  /** 底部预留（含玻璃底栏高度），避免挡住 Tab */
  bottomInset: number;
  onPress: () => void;
};

/**
 * 菜谱列表右下角可拖动菜单篮悬浮球：轻点打开，拖动改位置（松手吸附到左右边）。
 */
export function RecipeBasketFab({ count, bottomInset, onPress }: Props) {
  const colorScheme = useColorScheme();
  const p = getRecipePalette(colorScheme);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);
  const bottomPad = useSharedValue(bottomInset);

  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const scale = useSharedValue(1);
  const minX = useSharedValue(EDGE);
  const maxX = useSharedValue(EDGE);
  const minY = useSharedValue(EDGE);
  const maxY = useSharedValue(EDGE);
  const placed = useSharedValue(0);

  const applyBounds = useCallback(
    (w: number, h: number, pad: number, resetCorner: boolean) => {
      if (w <= 0 || h <= 0) return;
      const nextMinX = EDGE;
      const nextMaxX = Math.max(EDGE, w - FAB_SIZE - EDGE);
      const nextMinY = EDGE;
      const nextMaxY = Math.max(EDGE, h - FAB_SIZE - pad - EDGE);
      minX.value = nextMinX;
      maxX.value = nextMaxX;
      minY.value = nextMinY;
      maxY.value = nextMaxY;
      if (resetCorner || placed.value < 1) {
        x.value = nextMaxX;
        y.value = nextMaxY;
        placed.value = 1;
      } else {
        x.value = Math.min(nextMaxX, Math.max(nextMinX, x.value));
        y.value = Math.min(nextMaxY, Math.max(nextMinY, y.value));
      }
    },
    [maxX, maxY, minX, minY, placed, x, y],
  );

  useEffect(() => {
    bottomPad.value = bottomInset;
    applyBounds(boxW.value, boxH.value, bottomInset, false);
  }, [applyBounds, bottomInset, bottomPad, boxH, boxW]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const { width: w, height: h } = e.nativeEvent.layout;
      if (w <= 0 || h <= 0) return;
      const first = placed.value < 1;
      boxW.value = w;
      boxH.value = h;
      applyBounds(w, h, bottomPad.value, first);
    },
    [applyBounds, bottomPad, boxH, boxW, placed],
  );

  const firePress = useCallback(() => {
    onPressRef.current();
  }, []);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .minDistance(DRAG_ACTIVATE_PX)
      .onBegin(() => {
        startX.value = x.value;
        startY.value = y.value;
        scale.value = withSpring(1.08, { damping: 16, stiffness: 280 });
      })
      .onUpdate(e => {
        const nx = Math.min(maxX.value, Math.max(minX.value, startX.value + e.translationX));
        const ny = Math.min(maxY.value, Math.max(minY.value, startY.value + e.translationY));
        x.value = nx;
        y.value = ny;
      })
      .onFinalize(() => {
        scale.value = withSpring(1, { damping: 16, stiffness: 280 });
        const mid = (minX.value + maxX.value) / 2;
        const snappedX = x.value < mid ? minX.value : maxX.value;
        const ny = Math.min(maxY.value, Math.max(minY.value, y.value));
        x.value = withSpring(snappedX, { damping: 18, stiffness: 220 });
        y.value = withSpring(ny, { damping: 18, stiffness: 220 });
      });

    const tap = Gesture.Tap().onEnd(() => {
      runOnJS(firePress)();
    });

    return Gesture.Exclusive(pan, tap);
  }, [firePress, maxX, maxY, minX, minY, scale, startX, startY, x, y]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
    opacity: placed.value,
  }));

  const badge = count > 99 ? '99+' : String(count);
  const hasItems = count > 0;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill} onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[
            styles.fab,
            {
              backgroundColor: hasItems ? p.primary : p.card,
              borderColor: hasItems ? p.primary : p.border,
              shadowColor: p.isDark ? '#000' : '#1c2430',
            },
            animStyle,
          ]}
          accessibilityRole="button"
          accessibilityLabel={hasItems ? `菜单篮 ${count} 道` : '菜单篮'}>
          <MaterialIcons
            name="shopping-basket"
            size={26}
            color={hasItems ? '#fff' : p.primary}
          />
          {hasItems ? (
            <View style={[styles.badge, { backgroundColor: p.danger }]}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
    elevation: 8,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  badge: {
    position: 'absolute',
    top: 4,
    right: 4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
});
