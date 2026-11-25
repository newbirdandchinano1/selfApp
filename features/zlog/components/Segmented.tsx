import React, { useEffect, useRef, useState } from 'react';
import { Animated, LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export interface SegmentedOption<T extends string | number> {
  label: string;
  value: T;
}

interface Props<T extends string | number> {
  options: Array<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: Props<T>) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const [index, setIndex] = useState(Math.max(0, options.findIndex((o) => o.value === value)));
  const anim = useRef(new Animated.Value(index)).current;

  useEffect(() => {
    const i = Math.max(0, options.findIndex((o) => o.value === value));
    setIndex(i);
    Animated.spring(anim, {
      toValue: i,
      useNativeDriver: false,
      speed: 16,
      bounciness: 7,
    }).start();
  }, [value, options, anim]);

  const thumbWidth = width ? (width - 8) / options.length : 0;
  const translateX = width
    ? anim.interpolate({
        inputRange: [0, Math.max(1, options.length - 1)],
        outputRange: [0, thumbWidth * (options.length - 1)],
        extrapolate: 'clamp',
      })
    : 0;

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View
      onLayout={onLayout}
      style={{
        flexDirection: 'row',
        backgroundColor: colors.surface2,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 999,
        padding: 4,
        position: 'relative',
      }}
    >
      {width > 0 ? (
        <Animated.View
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 4,
            width: thumbWidth,
            borderRadius: 999,
            backgroundColor: colors.brand,
            transform: [{ translateX }],
          }}
        />
      ) : null}
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onChange(option.value)}
            style={{ flex: 1, paddingVertical: 10, alignItems: 'center' }}
          >
            <Text
              style={{
                fontSize: 13.5,
                fontWeight: '600',
                color: active ? colors.onBrand : colors.inkSoft,
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
