/**
 * 通知来源入口红点（页内小圆点，非数字角标）。
 */
import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  visible?: boolean;
  /** 默认右上角外侧；传 style 可覆盖定位 */
  style?: StyleProp<ViewStyle>;
  size?: number;
  color?: string;
  accessibilityLabel?: string;
};

export function InboxSourceDot({
  visible = true,
  style,
  size = 7,
  color = '#EF4444',
  accessibilityLabel = '有未读提醒',
}: Props) {
  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={accessibilityLabel}
      style={[
        styles.dot,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {
    position: 'absolute',
    top: -1,
    right: -1,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.92)',
    zIndex: 2,
  },
});
