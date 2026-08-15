import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { subscribePointsEarnedToast } from '@/lib/points-earned-toast-events';

/** 根级挂载：获得积分时底部短暂提示约 1 秒。 */
export function PointsEarnedToastHost() {
  const { isDark } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [points, setPoints] = React.useState<number | null>(null);

  React.useEffect(() => subscribePointsEarnedToast(setPoints), []);

  if (points == null || points <= 0) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.wrap, { bottom: Math.max(insets.bottom, 12) + 88 }]}>
      <View
        style={[
          styles.toast,
          { backgroundColor: isDark ? 'rgba(15,23,42,0.94)' : 'rgba(17,24,39,0.94)' },
        ]}>
        <MaterialIcons name="stars" size={16} color="#fbbf24" />
        <Text style={styles.text}>获得 +{points} 积分</Text>
      </View>
    </View>
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
