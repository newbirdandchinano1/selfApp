import { useApiLoadingOverlay } from '@/hooks/use-api-loading-overlay';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_WIDTH = Dimensions.get('window').width;
const BAR_SEGMENT_WIDTH = Math.round(SCREEN_WIDTH * 0.42);
const LOADING_TIMEOUT_MS = 10000;

export function ApiLoadingIndicator() {
  const { visible, timedOut, blocking, retry } = useApiLoadingOverlay(480, LOADING_TIMEOUT_MS);
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const textColor = isDark ? '#e5e7eb' : '#131b2e';

  const slide = useRef(new Animated.Value(0)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  const barTranslateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-BAR_SEGMENT_WIDTH, SCREEN_WIDTH],
  });

  useEffect(() => {
    if (!visible) {
      loopRef.current?.stop();
      loopRef.current = null;
      Animated.timing(pillOpacity, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(pillOpacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start();

    slide.setValue(0);
    const loop = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: 1100,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loopRef.current = loop;
    loop.start();

    return () => {
      loop.stop();
    };
  }, [visible, pillOpacity, slide]);

  if (!blocking) return null;

  return (
    <View style={styles.blocker} pointerEvents="auto" accessibilityViewIsModal>
      <View
        style={[
          styles.scrim,
          { backgroundColor: isDark ? 'rgba(0,0,0,0.42)' : 'rgba(15,23,42,0.28)' },
        ]}
      />

      {timedOut ? (
        <View
          style={[
            styles.timeoutCard,
            {
              backgroundColor: isDark ? 'rgba(31,41,55,0.98)' : 'rgba(255,255,255,0.98)',
              borderColor: isDark ? 'rgba(96,165,250,0.45)' : 'rgba(0,88,190,0.35)',
            },
          ]}
        >
          <Text style={[styles.timeoutTitle, { color: textColor }]}>加载超时</Text>
          <Text style={[styles.timeoutHint, { color: isDark ? '#94a3b8' : '#64748b' }]}>
            数据加载超过 10 秒，请检查网络后重试
          </Text>
          <Pressable
            onPress={() => void retry()}
            style={({ pressed }) => [
              styles.retryBtn,
              { backgroundColor: primary, opacity: pressed ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="重试加载"
          >
            <Text style={styles.retryBtnText}>重试</Text>
          </Pressable>
        </View>
      ) : (
        <View
          style={[styles.topBar, { top: insets.top }]}
          pointerEvents="none"
          accessibilityRole="progressbar"
          accessibilityLabel="加载中"
        >
          <View style={[styles.track, { backgroundColor: isDark ? 'rgba(96,165,250,0.22)' : 'rgba(0,88,190,0.16)' }]}>
            <Animated.View
              style={[
                styles.bar,
                {
                  width: BAR_SEGMENT_WIDTH,
                  backgroundColor: primary,
                  transform: [{ translateX: barTranslateX }],
                },
              ]}
            />
          </View>
          <Animated.View
            style={[
              styles.pill,
              {
                opacity: pillOpacity,
                backgroundColor: isDark ? 'rgba(31,41,55,0.96)' : 'rgba(255,255,255,0.98)',
                borderColor: isDark ? 'rgba(96,165,250,0.45)' : 'rgba(0,88,190,0.35)',
              },
            ]}
          >
            <ActivityIndicator size="small" color={primary} />
            <Text style={[styles.pillText, { color: primary }]}>正在加载数据…</Text>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  blocker: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  track: {
    width: '100%',
    height: 5,
    overflow: 'hidden',
  },
  bar: {
    height: 5,
    borderRadius: 3,
  },
  pill: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
    elevation: 6,
  },
  pillText: {
    fontSize: 14,
    fontWeight: '700',
  },
  timeoutCard: {
    width: '84%',
    maxWidth: 320,
    paddingHorizontal: 20,
    paddingVertical: 22,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 8,
  },
  timeoutTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  timeoutHint: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 18,
    minWidth: 120,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  retryBtnText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
});
