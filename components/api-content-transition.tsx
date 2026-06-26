import { useApiLoading } from '@/hooks/use-api-loading';
import { useActivePageApiKey } from '@/hooks/use-active-page-api-key';
import { isSkeletonLoadingTabPageKey } from '@/lib/page-api-health-ui';
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

type ApiContentTransitionProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** 全局内容区：API 读取时降低透明度并略变暗，完成后平滑淡入 */
export function ApiContentTransition({ children, style }: ApiContentTransitionProps) {
  const activePageKey = useActivePageApiKey();
  const suppressDim = isSkeletonLoadingTabPageKey(activePageKey);
  const isLoading = useApiLoading(suppressDim ? 0 : 480);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: suppressDim || !isLoading ? 1 : 0.78,
      duration: suppressDim || !isLoading ? 340 : 180,
      easing: isLoading && !suppressDim ? Easing.out(Easing.quad) : Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isLoading, opacity, suppressDim]);

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
