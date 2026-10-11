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

const FADE_IN_MS = 260;
const FADE_OUT_MS = 240;
const SLIDE_OFFSET = -14;
const SCALE_FROM = 0.94;

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
  const translateY = React.useRef(new Animated.Value(SLIDE_OFFSET)).current;
  const scale = React.useRef(new Animated.Value(SCALE_FROM)).current;
  const animRef = React.useRef<Animated.CompositeAnimation | null>(null);

  React.useEffect(() => {
    return subscribeAppToast((next) => {
      animRef.current?.stop();

      if (next == null) {
        const hide = Animated.parallel([
          Animated.timing(opacity, {
            toValue: 0,
            duration: FADE_OUT_MS,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(translateY, {
            toValue: SLIDE_OFFSET,
            duration: FADE_OUT_MS,
            easing: Easing.in(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: SCALE_FROM,
            duration: FADE_OUT_MS,
            easing: Easing.in(Easing.cubic),
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
      translateY.setValue(SLIDE_OFFSET);
      scale.setValue(SCALE_FROM);

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
        Animated.timing(scale, {
          toValue: 1,
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
  }, [opacity, translateY, scale]);

  if (payload == null) return null;

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.wrap,
        {
          // 顶部更易注意到，避开底部 Tab / 积分 Toast
          top: Math.max(insets.top, 12) + 16,
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}>
      <View style={styles.toast}>
        <View style={[styles.accent, { backgroundColor: KIND_COLOR[payload.kind] }]} />
        <MaterialIcons
          name={KIND_ICON[payload.kind]}
          size={20}
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
    gap: Spacing.xl,
    borderRadius: Radius.pill,
    paddingHorizontal: Spacing['5xl'],
    paddingVertical: Spacing['3xl'],
    minHeight: 48,
    maxWidth: '90%',
    backgroundColor: 'rgba(17,24,39,0.96)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 10,
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  text: {
    color: '#fff',
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
    letterSpacing: 0.2,
    flexShrink: 1,
  },
});
