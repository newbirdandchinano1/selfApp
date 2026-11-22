/**
 * 天气图标：优先和风彩色 PNG，其次单色 SVG，再回退 Material。
 */
import { AppIcon, type AppIconName } from '@/components/ui/app-icon';
import {
  qweatherColorIconUrl,
  qweatherMonoIconUrl,
  weatherFallbackIcon,
} from '@/lib/weather-visuals';
import { Image } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  icon?: string | null;
  text?: string | null;
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  /** 强制只用回退图标（离线预览） */
  forceFallback?: boolean;
};

type Stage = 'color' | 'mono' | 'fallback';

export function WeatherConditionIcon({
  icon,
  text,
  size = 36,
  color = '#23443A',
  style,
  forceFallback = false,
}: Props) {
  const colorUrl = useMemo(
    () => (forceFallback ? null : qweatherColorIconUrl(icon, text)),
    [forceFallback, icon, text],
  );
  const monoUrl = useMemo(
    () => (forceFallback ? null : qweatherMonoIconUrl(icon)),
    [forceFallback, icon],
  );
  const [stage, setStage] = useState<Stage>(() =>
    forceFallback ? 'fallback' : colorUrl ? 'color' : monoUrl ? 'mono' : 'fallback',
  );

  useEffect(() => {
    setStage(forceFallback ? 'fallback' : colorUrl ? 'color' : monoUrl ? 'mono' : 'fallback');
  }, [colorUrl, forceFallback, monoUrl]);

  const fallback: AppIconName = weatherFallbackIcon(text, icon);
  const uri = stage === 'color' ? colorUrl : stage === 'mono' ? monoUrl : null;

  if (!uri || stage === 'fallback') {
    return (
      <View
        style={[
          { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
          style,
        ]}>
        <AppIcon name={fallback} size={size * 0.85} color={color} />
      </View>
    );
  }

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Image
        source={{ uri }}
        style={styles.img}
        contentFit="contain"
        recyclingKey={uri}
        onError={() => {
          if (stage === 'color' && monoUrl) setStage('mono');
          else setStage('fallback');
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  img: { width: '100%', height: '100%' },
});
