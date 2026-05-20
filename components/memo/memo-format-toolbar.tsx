import type { MemoFormatAction } from '@/lib/memo-format';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type ToolbarItem = {
  action: MemoFormatAction;
  icon?: keyof typeof MaterialIcons.glyphMap;
  label: string;
  textLabel?: string;
};

const ITEMS: ToolbarItem[] = [
  { action: 'bold', icon: 'format-bold', label: '加粗' },
  { action: 'size-small', label: '小字', textLabel: '小' },
  { action: 'size-large', label: '大字', textLabel: '大' },
  { action: 'indent-in', icon: 'format-indent-increase', label: '增加缩进' },
  { action: 'indent-out', icon: 'format-indent-decrease', label: '减少缩进' },
];

type Props = {
  onAction: (action: MemoFormatAction) => void;
  primary: string;
  borderColor: string;
  backgroundColor: string;
};

export function MemoFormatToolbar({ onAction, primary, borderColor, backgroundColor }: Props) {
  return (
    <View style={[styles.wrap, { borderColor, backgroundColor }]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {ITEMS.map(item => (
          <Pressable
            key={item.action}
            onPress={() => onAction(item.action)}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.65 : 1 }]}
          >
            {item.textLabel ? (
              <Text style={[styles.textBtn, { color: primary }]}>{item.textLabel}</Text>
            ) : item.icon ? (
              <MaterialIcons name={item.icon} size={22} color={primary} />
            ) : null}
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 2,
  },
  btn: {
    minWidth: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  textBtn: { fontSize: 15, fontWeight: '900' },
});
