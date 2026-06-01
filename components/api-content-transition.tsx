import { useApiLoading } from '@/hooks/use-api-loading';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

type ApiContentTransitionProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** 全局内容区：API 读取时降低透明度并略变暗，完成后平滑淡入 */
export function ApiContentTransition({ children, style }: ApiContentTransitionProps) {
  const isLoading = useApiLoading(480);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: isLoading ? 0.78 : 1,
      duration: isLoading ? 180 : 340,
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
