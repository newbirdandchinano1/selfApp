/**
 * 主 Tab 全屏天气氛围 WebP 动图背景（侧边栏开关控制）。
 */
import {
  useWeatherAtmosphereWebpBgEnabled,
  useWeatherAtmosphereWebpPick,
} from '@/hooks/use-weather-atmosphere-webp';
import { useWeatherSummary } from '@/hooks/use-weather-summary';
import {
  resolveWeatherAtmosphereWebpId,
  weatherAtmosphereWebpSource,
} from '@/lib/weather-atmosphere-webp-assets';
import { Image } from 'expo-image';
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

export function WeatherAtmosphereWebpBackground() {
  const enabled = useWeatherAtmosphereWebpBgEnabled();
  const pick = useWeatherAtmosphereWebpPick();
  const { summary, scene } = useWeatherSummary();

  const source = useMemo(() => {
    const id =
      pick === 'auto'
        ? resolveWeatherAtmosphereWebpId({
            scene,
            text: summary?.now?.text,
            icon: summary?.now?.icon,
            precipMm: summary?.now?.precipMm,
          })
        : pick;
    return weatherAtmosphereWebpSource(id);
  }, [pick, scene, summary?.now?.text, summary?.now?.icon, summary?.now?.precipMm]);

  if (!enabled) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <Image
        source={source}
        style={styles.image}
        contentFit="cover"
        contentPosition="center"
        recyclingKey={`weather-webp-${source}`}
        transition={280}
        autoplay
        // iOS 默认 Apple 编解码对部分动图帧率/混合不准，改用 libwebp
        useAppleWebpCodec={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
});
