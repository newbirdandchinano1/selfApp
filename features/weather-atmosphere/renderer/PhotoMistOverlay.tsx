/**
 * 摄影级云/雾层：使用 weather-atmosphere 实拍动图，
 * 替代椭圆手绘团块，观感接近真实天空照片。
 */
import type { AtmospherePeriod } from '@/features/weather-atmosphere/config/sky-palette';
import { Image } from 'expo-image';
import React, { memo, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';

/** partly=多云透日；overcast=阴；storm=雨/雷 */
export type CloudDensity = 'partly' | 'overcast' | 'storm';

export type PhotoMistOverlayProps = {
  mistKind: 'cloud' | 'fog';
  cloudDensity?: CloudDensity;
  period: AtmospherePeriod;
  /** 场景切换淡入淡出 */
  opacity?: SharedValue<number>;
  /** 减弱动效时仍显示静帧 */
  reduceMotion?: boolean;
  /**
   * 雨雪雷暴时用静帧，避免动图解码与粒子抢 CPU。
   * 云层质感仍在，只是不播循环动画。
   */
  preferStatic?: boolean;
};

const CLOUDY = require('../../../assets/weather-atmosphere/cloudy.webp');
const OVERCAST = require('../../../assets/weather-atmosphere/overcast.webp');
const FOG = require('../../../assets/weather-atmosphere/fog.webp');

function resolveSource(mistKind: 'cloud' | 'fog', density: CloudDensity) {
  if (mistKind === 'fog') return FOG;
  if (density === 'partly') return CLOUDY;
  // 阴天 / 雨暴云幕：用实拍阴天，避免程序化灰团
  return OVERCAST;
}

function resolveLook(
  mistKind: 'cloud' | 'fog',
  density: CloudDensity,
  period: AtmospherePeriod,
): {
  imageOpacity: number;
  scrim: string | null;
  contentPosition: 'center' | 'top' | 'bottom';
} {
  const night = period === 'night';
  const dusk = period === 'dusk';

  if (mistKind === 'fog') {
    return {
      // 雾铺满中下景，略透出天空色
      imageOpacity: night ? 0.82 : 0.78,
      scrim: night ? 'rgba(10, 14, 22, 0.28)' : dusk ? 'rgba(40, 44, 52, 0.12)' : 'rgba(200, 208, 216, 0.08)',
      contentPosition: 'bottom',
    };
  }

  if (density === 'partly') {
    // 多云：透出太阳/天空，云层像照片里的真云
    return {
      imageOpacity: night ? 0.72 : 0.68,
      scrim: night ? 'rgba(8, 14, 26, 0.32)' : null,
      contentPosition: 'top',
    };
  }

  if (density === 'storm') {
    return {
      imageOpacity: night ? 0.78 : 0.74,
      scrim: night ? 'rgba(6, 10, 18, 0.36)' : 'rgba(40, 52, 64, 0.14)',
      contentPosition: 'center',
    };
  }

  // overcast
  return {
    imageOpacity: night ? 0.88 : 0.86,
    scrim: night ? 'rgba(8, 12, 20, 0.3)' : 'rgba(60, 70, 82, 0.1)',
    contentPosition: 'center',
  };
}

function PhotoMistOverlayInner({
  mistKind,
  cloudDensity = 'overcast',
  period,
  opacity,
  reduceMotion = false,
  preferStatic = false,
}: PhotoMistOverlayProps) {
  const source = useMemo(
    () => resolveSource(mistKind, cloudDensity),
    [mistKind, cloudDensity],
  );
  const look = useMemo(
    () => resolveLook(mistKind, cloudDensity, period),
    [mistKind, cloudDensity, period],
  );

  const fadeStyle = useAnimatedStyle(() => ({
    opacity: (opacity?.value ?? 1) * look.imageOpacity,
  }));

  const autoplay = !reduceMotion && !preferStatic;

  return (
    <Animated.View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, fadeStyle]}
      accessibilityElementsHidden
    >
      <Image
        source={source}
        style={styles.image}
        contentFit="cover"
        contentPosition={look.contentPosition}
        recyclingKey={`photo-mist-${mistKind}-${cloudDensity}-${autoplay ? 'live' : 'still'}`}
        transition={preferStatic ? 0 : 320}
        autoplay={autoplay}
        useAppleWebpCodec={false}
      />
      {look.scrim ? <View style={[StyleSheet.absoluteFill, { backgroundColor: look.scrim }]} /> : null}
    </Animated.View>
  );
}

export const PhotoMistOverlay = memo(PhotoMistOverlayInner);

const styles = StyleSheet.create({
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
});
