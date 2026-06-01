import { useApiLoading } from '@/hooks/use-api-loading';
import { useColorScheme } from '@/hooks/use-color-scheme';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

const SHOW_DELAY_MS = 180;

export function ApiLoadingOverlay() {
  const isLoading = useApiLoading();
  const colorScheme = useColorScheme();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setVisible(false);
      return;
    }

    const timer = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isLoading]);

  if (!visible) return null;

  const isDark = colorScheme === 'dark';

  return (
    <View style={styles.root} pointerEvents="auto" accessibilityRole="progressbar" accessibilityLabel="加载中">
      <View
        style={[
          styles.backdrop,
          { backgroundColor: isDark ? 'rgba(0, 0, 0, 0.38)' : 'rgba(255, 255, 255, 0.58)' },
        ]}
      />
      <View style={[styles.indicatorBox, { backgroundColor: isDark ? '#1f2937' : '#ffffff' }]}>
        <ActivityIndicator size="large" color={isDark ? '#60a5fa' : '#0058be'} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 9999,
    elevation: 9999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  indicatorBox: {
    paddingHorizontal: 28,
    paddingVertical: 24,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
});
