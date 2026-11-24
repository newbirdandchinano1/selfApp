/**
 * Agent Space 氛围层 — 纸感 grain + 柔光 orb（对齐 preview）。
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useAppTheme } from '@/hooks/use-app-theme';

export function AgentSpaceBackdrop() {
  const { colors, isDark } = useAppTheme();

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View
        style={[
          styles.orbA,
          {
            backgroundColor: isDark
              ? 'rgba(127,166,149,0.18)'
              : 'rgba(127,166,149,0.28)',
          },
        ]}
      />
      <View
        style={[
          styles.orbB,
          {
            backgroundColor: isDark
              ? 'rgba(224,179,90,0.1)'
              : 'rgba(224,179,90,0.14)',
          },
        ]}
      />
      <View
        style={[
          styles.grain,
          {
            backgroundColor: colors.text,
            opacity: isDark ? 0.04 : 0.035,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  orbA: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    right: -130,
    top: -100,
  },
  orbB: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    left: -120,
    bottom: 80,
  },
  grain: {
    ...StyleSheet.absoluteFillObject,
  },
});
