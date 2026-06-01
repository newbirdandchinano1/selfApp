import { useApiLoading } from '@/hooks/use-api-loading';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

type ApiContentTransitionProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** 全局内容区：API 读取时轻微降低透明度，完成后平滑淡入 */
export function ApiContentTransition({ children, style }: ApiContentTransitionProps) {
  const isLoading = useApiLoading();
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: isLoading ? 0.92 : 1,
      duration: isLoading ? 140 : 320,
      easing: isLoading ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isLoading, opacity]);

  return (
    <Animated.View style={[styles.root, style, { opacity }]}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
