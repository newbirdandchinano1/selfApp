import {
  TextScalePolicy,
  Typography,
  type TypographyRole,
} from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import React from 'react';
import { Text, type StyleProp, type TextProps, type TextStyle } from 'react-native';

export type AppTextProps = TextProps & {
  /** 设计系统排版角色；与 Typography token 对齐（不用 role，避免与 RN a11y role 冲突） */
  variant?: TypographyRole;
  /**
   * 密集 UI（标签、统计、顶栏）：使用更紧的 maxFontSizeMultiplier。
   * 默认按内容区倍率，跟随系统 Dynamic Type / fontScale。
   */
  chrome?: boolean;
  style?: StyleProp<TextStyle>;
};

/**
 * 系统字号缩放友好的 Text。
 * 保留 allowFontScaling，用角色基准尺寸 + 倍率上限对齐 Accessibility 设置。
 */
export function AppText({
  variant = 'body',
  chrome = false,
  style,
  allowFontScaling = true,
  maxFontSizeMultiplier,
  ...rest
}: AppTextProps) {
  const { typography } = useAppTheme();
  const cap =
    maxFontSizeMultiplier ??
    (chrome ? TextScalePolicy.maxMultiplierChrome : TextScalePolicy.maxMultiplierContent);

  return (
    <Text
      allowFontScaling={allowFontScaling}
      maxFontSizeMultiplier={cap}
      style={[typography[variant] ?? Typography[variant], style]}
      {...rest}
    />
  );
}
