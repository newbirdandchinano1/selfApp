import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing } from '@/constants/design-tokens';
import {
  subscribeAppToast,
  type AppToastKind,
  type AppToastPayload,
} from '@/lib/app-feedback/toast-events';

const FADE_IN_MS = 180;
const FADE_OUT_MS = 220;

const KIND_ICON: Record<AppToastKind, keyof typeof MaterialIcons.glyphMap> = {
  success: 'check-circle',
  error: 'error-outline',
  info: 'info-outline',
  warn: 'warning-amber',
};

const KIND_COLOR: Record<AppToastKind, string> = {
  success: '#4ade80',
  error: '#fb7185',
  info: '#60a5fa',
  warn: '#fbbf24',
};

/** 根级挂载：通用操作反馈 Toast（success / error / info / warn） */
export function AppToastHost() {
  const insets = useSafeAreaInsets();
  const [payload, setPayload] = React.useState<AppToastPayload | null>(null);
  const opacity = React.useRef(new Animated.Value(0)).current;
  const translateY = React.useRef(new Animated.Value(8)).current;
  const animRef = React.useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
    return subscribeAppToast((next) => {
      animRef.current?.stop();

      if (next == null) {
        const hide = Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: FADE_OUT_MS,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: 8,
            duration: FADE_OUT_MS,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]);
        animRef.current = hide;
        hide.start(({ finished }) => {
          if (!finished) return;
          animRef.current = null;
          setPayload(null);
        });
        return;
      }

      setPayload(next);
      opacity.setValue(0);
      translateY.setValue(8);

      const show = Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: FADE_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: FADE_IN_MS,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);
      animRef.current = show;
      show.start(({ finished }) => {
        if (finished) animRef.current = null;
      });
    });
  }, [opacity, translateY]);

  if (payload == null) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        {
          // 略高于积分 Toast，避免互相遮死
          bottom: Math.max(insets.bottom, 12) + 132,
          opacity,
          transform: [{ translateY }],
        },
      ]}>
      <View style={styles.toast}>
        <View style={[styles.accent, { backgroundColor: KIND_COLOR[payload.kind] }]} />
        <MaterialIcons
          name={KIND_ICON[payload.kind]}
          size={16}
          color={KIND_COLOR[payload.kind]}
        />
        <Text style={styles.text} numberOfLines={2}>
          {payload.message}
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
    zIndex: 210,
    elevation: 210,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing['2xl'],
    paddingVertical: Spacing.lg,
    maxWidth: '88%',
    backgroundColor: 'rgba(17,24,39,0.94)',
    overflow: 'hidden',
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
    flexShrink: 1,
  },
});
