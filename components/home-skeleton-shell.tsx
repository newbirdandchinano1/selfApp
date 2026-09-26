import React from 'react';
import { Animated, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

export type HomeSkeletonShellProps = {
  /** 首次加载仍在进行 */
  pending: boolean;
  /** 是否仍挂载骨架（含淡出） */
  mounted: boolean;
  opacity: Animated.Value;
  backgroundColor?: string;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
};

/**
 * 首页骨架叠层：pending 时占满流式布局；就绪后绝对定位淡出，内容层可同时淡入。
 */
export function HomeSkeletonShell({
  pending,
  mounted,
  opacity,
  backgroundColor,
  children,
  style,
}: HomeSkeletonShellProps) {
  if (!pending && !mounted) return null;

  return (
    <Animated.View
      pointerEvents={pending ? 'auto' : 'none'}
      style={[
        pending ? undefined : styles.overlay,
        {
          opacity: pending ? 1 : opacity,
          backgroundColor: pending ? undefined : backgroundColor,
        },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 2,
  },
});
