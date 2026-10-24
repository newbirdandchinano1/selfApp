/**
 * 热力格 heatBloom — 对齐设计稿 `.hcell` / `@keyframes heatBloom`
 * 错峰：--i = 列*7+行（buildHeat），12ms 步进
 * 选中 / 今日：双环用绝对定位叠在格上（等同 CSS box-shadow），不改变格子占位，避免后续格错位
 * 减弱动效：仅 120ms 透明度，无缩放
 */
import { FOLD_MOTION_EASE } from '@/components/review/fold-motion';
import { TaskFoldMotion } from '@/constants/task-fold-theme';
import React from 'react';
import { Animated, Pressable, View } from 'react-native';

const REDUCED_MS = 120;

export function HeatBloomCell({
  index,
  color,
  selected,
  isToday,
  disabled,
  onPress,
  animate,
  fullMotion = true,
  paper,
  pond,
  sun,
  cellSize,
  hitPadding = 0,
}: {
  /** 设计稿 style="--i:c*7+r" */
  index: number;
  color: string;
  selected: boolean;
  isToday: boolean;
  disabled: boolean;
  onPress: () => void;
  /** 是否播放入场（含减弱动效下的淡入） */
  animate: boolean;
  /** false = 减弱动效：仅透明度 */
  fullMotion?: boolean;
  paper: string;
  pond: string;
  sun: string;
  cellSize: number;
  /** 详情页格间距略大时外扩点击区（不改变格心占位） */
  hitPadding?: number;
}) {
  const bloom = React.useRef(new Animated.Value(animate ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate) {
      bloom.setValue(1);
      return;
    }

    bloom.setValue(0);
    const delay = fullMotion ? index * TaskFoldMotion.heatBloomStagger : 0;
    const duration = fullMotion ? TaskFoldMotion.heatBloom : REDUCED_MS;
    const anim = Animated.timing(bloom, {
      toValue: 1,
      duration,
      delay,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, bloom, fullMotion, index]);

  const bloomScale = fullMotion
    ? bloom.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] })
    : 1;

  const showRing = selected || isToday;
  const ringOuter = selected ? pond : sun;
  /** 设计稿：paper 1.5 + pond/sun 外环，总外扩约 3 */
  const ringInner = 1.5;
  const ringOuterW = selected ? 1.5 : 1;
  const ringOutset = ringInner + ringOuterW;
  const radius = cellSize >= 12 ? 2.5 : 2;
  const slot = cellSize + hitPadding;

  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      hitSlop={disabled ? 0 : 4}
      style={{
        width: slot,
        height: slot,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: selected || isToday ? 2 : 0,
        overflow: 'visible',
      }}>
      <Animated.View
        style={{
          width: cellSize,
          height: cellSize,
          opacity: bloom,
          transform: [{ scale: bloomScale }],
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'visible',
        }}>
        <View
          style={{
            width: cellSize,
            height: cellSize,
            borderRadius: radius,
            backgroundColor: color,
          }}
        />
        {showRing ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: -ringOutset,
              left: -ringOutset,
              width: cellSize + ringOutset * 2,
              height: cellSize + ringOutset * 2,
              borderRadius: radius + ringOutset,
              borderWidth: ringOuterW,
              borderColor: ringOuter,
              backgroundColor: 'transparent',
              padding: ringInner,
            }}>
            <View
              style={{
                flex: 1,
                borderRadius: radius + ringInner,
                borderWidth: ringInner,
                borderColor: paper,
              }}
            />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}
