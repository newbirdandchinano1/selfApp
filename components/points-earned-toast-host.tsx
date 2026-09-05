import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { subscribePointsEarnedToast, formatPointsToastAmount } from '@/lib/points-earned-toast-events';

const SLIDE_DISTANCE = 48;
const HOLD_MS = 900;
const SLIDE_MS = 700;
const FADE_MS = 650;

/** 根级挂载：积分变动时底部提示（加分 / 扣分），上滑一段距离后渐隐。 */
export function PointsEarnedToastHost() {
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [points, setPoints] = React.useState<number | null>(null);
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(0)).current;
  const animRef = React.useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
    return subscribePointsEarnedToast((next) => {
      if (next == null || next === 0) return;

      animRef.current?.stop();
      setPoints(next);
      opacity.setValue(1);
      translateY.setValue(0);

      const anim = Animated.sequence([
        Animated.delay(HOLD_MS),
        Animated.timing(translateY, {
          toValue: -SLIDE_DISTANCE,
          duration: SLIDE_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: FADE_MS,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ]);
      animRef.current = anim;
      anim.start(({ finished }) => {
        if (!finished) return;
        animRef.current = null;
        setPoints(null);
      });
    });
  }, [opacity, translateY]);

  if (points == null || points === 0) return null;

  const gained = points > 0;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrap,
        {
          bottom: Math.max(insets.bottom, 12) + 88,
          opacity,
          transform: [{ translateY }],
        },
      ]}>
      <View
        style={[
          styles.toast,
          { backgroundColor: isDark ? 'rgba(15,23,42,0.94)' : 'rgba(17,24,39,0.94)' },
        ]}>
        <MaterialIcons
          name={gained ? 'stars' : 'remove-circle'}
          size={16}
          color={gained ? '#fbbf24' : '#fb7185'}
        />
        <Text style={styles.text}>
          {gained ? `获得 +${formatPointsToastAmount(points)} 积分` : `扣除 ${formatPointsToastAmount(points)} 积分`}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 200,
    elevation: 200,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.lg,
    maxWidth: '88%',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
