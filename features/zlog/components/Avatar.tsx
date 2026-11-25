import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { resolveAvatarColor } from '../utils/avatarColor';

interface Props {
  name?: string;
  color?: string;
  size?: number;
  radius?: number;
}

export function Avatar({ name, color, size = 40, radius }: Props) {
  const { colors } = useTheme();
  const label = (name || '?').slice(0, 1);
  const r = radius ?? size * 0.36;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        backgroundColor: resolveAvatarColor(color, colors.sage),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        style={{
          color: '#FFFFFF',
          fontWeight: '700',
          fontSize: Math.round(size * 0.4),
        }}
      >
        {label}
      </Text>
    </View>
  );
}
