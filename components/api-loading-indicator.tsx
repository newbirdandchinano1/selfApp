import { useApiLoading } from '@/hooks/use-api-loading';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const SCREEN_WIDTH = Dimensions.get('window').width;
const BAR_SEGMENT_WIDTH = Math.round(SCREEN_WIDTH * 0.42);

export function ApiLoadingIndicator() {
  const isLoading = useApiLoading(480);
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';
  const primary = isDark ? '#60a5fa' : '#0058be';

  const slide = useRef(new Animated.Value(0)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  const barTranslateX = slide.interpolate({
    inputRange: [0, 1],
    outputRange: [-BAR_SEGMENT_WIDTH, SCREEN_WIDTH],
  });

  useEffect(() => {
    if (!isLoading) {
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
  }, [isLoading, pillOpacity, slide]);

  if (!isLoading) return null;

  return (
    <View
      style={[styles.root, { top: insets.top }]}
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
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 9999,
    elevation: 9999,
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
});
