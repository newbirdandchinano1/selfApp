import type { MemoFormatAction } from '@/lib/memo-format';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

type ToolbarItem = {
  action: MemoFormatAction;
  icon?: keyof typeof MaterialIcons.glyphMap;
  label: string;
  textLabel?: string;
};

const ITEMS: ToolbarItem[] = [
  { action: 'bold', icon: 'format-bold', label: '加粗' },
  { action: 'italic', icon: 'format-italic', label: '斜体' },
  { action: 'strike', icon: 'format-strikethrough', label: '删除线' },
  { action: 'heading-1', label: '一级标题', textLabel: 'H1' },
  { action: 'heading-2', label: '二级标题', textLabel: 'H2' },
  { action: 'heading-3', label: '三级标题', textLabel: 'H3' },
  { action: 'bullet', icon: 'format-list-bulleted', label: '无序列表' },
  { action: 'ordered', icon: 'format-list-numbered', label: '有序列表' },
  { action: 'todo', icon: 'check-box-outline-blank', label: '待办' },
  { action: 'quote', icon: 'format-quote', label: '引用' },
  { action: 'code', icon: 'code', label: '代码块' },
  { action: 'divider', icon: 'horizontal-rule', label: '分割线' },
  { action: 'image', icon: 'image', label: '图片链接' },
  { action: 'indent-in', icon: 'format-indent-increase', label: '增加缩进' },
  { action: 'indent-out', icon: 'format-indent-decrease', label: '减少缩进' },
];

type Props = {
  onAction: (action: MemoFormatAction) => void;
  primary: string;
  borderColor: string;
  backgroundColor: string;
};

function ToolbarBtn({
  item,
  primary,
  onAction,
}: {
  item: ToolbarItem;
  primary: string;
  onAction: (action: MemoFormatAction) => void;
}) {
  return (
    <Pressable
      // onPressIn：比 onPress 更早，减少 iOS 点工具栏时 WebView 选区被清掉的窗口
      onPressIn={() => onAction(item.action)}
      accessibilityRole="button"
      accessibilityLabel={item.label}
      style={({ pressed }) => [styles.btn, { opacity: pressed ? 0.65 : 1 }]}>
      {item.textLabel ? (
        <Text style={[styles.textBtn, { color: primary }]}>{item.textLabel}</Text>
      ) : item.icon ? (
        <MaterialIcons name={item.icon} size={22} color={primary} />
      ) : null}
    </Pressable>
  );
}

/** 固定两行：前一半 / 后一半 */
export function MemoFormatToolbar({ onAction, primary, borderColor, backgroundColor }: Props) {
  const [row1, row2] = useMemo(() => {
    const mid = Math.ceil(ITEMS.length / 2);
    return [ITEMS.slice(0, mid), ITEMS.slice(mid)] as const;
  }, []);

  return (
    <View style={[styles.wrap, { borderColor, backgroundColor }]}>
      <View style={styles.row}>
        {row1.map(item => (
          <ToolbarBtn key={item.action} item={item} primary={primary} onAction={onAction} />
        ))}
      </View>
      <View style={styles.row}>
        {row2.map(item => (
          <ToolbarBtn key={item.action} item={item} primary={primary} onAction={onAction} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderRadius: 12,
    marginBottom: 8,
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 2,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  btn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBtn: { fontSize: 13, fontWeight: '900' },
});
