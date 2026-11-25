import React from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { PressableScale } from './PressableScale';

interface Props {
  label: string;
  active?: boolean;
  color?: string;
  onPress?: () => void;
}

export function Chip({ label, active, color, onPress }: Props) {
  const { colors } = useTheme();
  return (
    <PressableScale
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 15,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: active ? colors.brand : colors.surface,
        borderWidth: 1,
        borderColor: active ? 'transparent' : colors.border,
      }}
    >
      {color ? (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: color,
          }}
        />
      ) : null}
      <Text
        style={{
          fontSize: 13,
          fontWeight: '600',
          color: active ? colors.onBrand : colors.inkSoft,
        }}
      >
        {label}
      </Text>
    </PressableScale>
  );
}
