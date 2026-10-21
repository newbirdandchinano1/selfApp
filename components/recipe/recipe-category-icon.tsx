import {
  resolveRecipeCategoryIcon,
  type RecipeCategoryIconOption,
} from '@/lib/recipe-category-icons';
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

type Props = {
  iconKey?: string | null;
  name?: string;
  index?: number;
  size?: number;
  /** 直接传入已解析选项时可跳过 resolve */
  option?: RecipeCategoryIconOption;
  style?: StyleProp<ViewStyle>;
};

/** 菜谱分类插图图标（系统 emoji 彩色渲染） */
export function RecipeCategoryIcon({
  iconKey,
  name,
  index = 0,
  size = 22,
  option,
  style,
}: Props) {
  const icon = option ?? resolveRecipeCategoryIcon(iconKey, name, index);
  const box = Math.max(36, Math.round(size * 1.9));
  return (
    <View
      style={[
        styles.wrap,
        { width: box, height: box, borderRadius: Math.round(box * 0.28), backgroundColor: icon.soft },
        style,
      ]}
      accessibilityLabel={icon.label}>
      <Text style={{ fontSize: size, lineHeight: size + 4 }}>{icon.emoji}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
