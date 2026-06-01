import { useApiLoading } from '@/hooks/use-api-loading';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function ApiLoadingIndicator() {
  const isLoading = useApiLoading();
  const colorScheme = useColorScheme();
  const insets = useSafeAreaInsets();
  const isDark = colorScheme === 'dark';
  const primary = isDark ? '#60a5fa' : '#0058be';

  const barOpacity = useRef(new Animated.Value(0.35)).current;
  const pillOpacity = useRef(new Animated.Value(0)).current;
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!isLoading) {
      loopRef.current?.stop();
      loopRef.current = null;
      Animated.timing(pillOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
      return;
    }

    Animated.timing(pillOpacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    }).start();

    barOpacity.setValue(0.35);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(barOpacity, {
          toValue: 1,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(barOpacity, {
          toValue: 0.35,
          duration: 650,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loopRef.current = loop;
    loop.start();

    return () => {
      loop.stop();
    };
  }, [isLoading, barOpacity, pillOpacity]);

  if (!isLoading) return null;

  return (
    <View
      style={[styles.root, { top: insets.top }]}
      pointerEvents="none"
      accessibilityRole="progressbar"
      accessibilityLabel="加载中"
    >
      <View style={[styles.track, { backgroundColor: isDark ? 'rgba(96,165,250,0.12)' : 'rgba(0,88,190,0.1)' }]}>
        <Animated.View style={[styles.bar, { backgroundColor: primary, opacity: barOpacity }]} />
      </View>
      <Animated.View
        style={[
          styles.pill,
          {
            opacity: pillOpacity,
            backgroundColor: isDark ? 'rgba(31,41,55,0.92)' : 'rgba(255,255,255,0.96)',
            borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(194,198,214,0.45)',
          },
        ]}
      >
        <Text style={[styles.pillText, { color: primary }]}>加载中…</Text>
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
    height: 3,
  },
  bar: {
    height: 3,
    width: '100%',
  },
  pill: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 4,
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
  },
});
