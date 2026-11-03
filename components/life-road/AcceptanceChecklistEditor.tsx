/**
 * 道路节点编辑：验收标准可增删勾选清单。
 */
import {
  LIFE_ROAD_ACCEPTANCE_MAX_ITEMS,
  LIFE_ROAD_ACCEPTANCE_TEXT_MAX,
  createAcceptanceItem,
  type LifeRoadAcceptanceItem,
} from '@/lib/life-road/life-road-acceptance';
import { getMinTouchTarget } from '@/constants/design-tokens';
import React from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const MIN_TOUCH = getMinTouchTarget(Platform.OS);

export type AcceptanceChecklistEditorProps = {
  items: LifeRoadAcceptanceItem[];
  onChange: (next: LifeRoadAcceptanceItem[]) => void;
  ink: string;
  ink2: string;
  muted: string;
  faint: string;
  line: string;
  pine2: string;
  sage2: string;
};

export function AcceptanceChecklistEditor({
  items,
  onChange,
  ink,
  ink2,
  muted,
  faint,
  line,
  pine2,
  sage2,
}: AcceptanceChecklistEditorProps) {
  const updateAt = (index: number, patch: Partial<LifeRoadAcceptanceItem>) => {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addRow = () => {
    if (items.length >= LIFE_ROAD_ACCEPTANCE_MAX_ITEMS) return;
    onChange([...items, createAcceptanceItem('')]);
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.lab, { color: faint }]}>验收标准（可选）</Text>
      <Text style={[styles.hint, { color: muted }]}>
        「做成了算过关」的可勾选项；不是任务排期，也不计积分。
      </Text>

      {items.map((item, index) => (
        <View
          key={item.id}
          style={[styles.row, { borderColor: line, backgroundColor: 'rgba(255,252,245,0.92)' }]}>
          <Pressable
            onPress={() => updateAt(index, { done: !item.done })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.done }}
            accessibilityLabel={item.done ? '标为未完成' : '标为已完成'}
            hitSlop={6}
            style={[
              styles.check,
              {
                borderColor: item.done ? pine2 : line,
                backgroundColor: item.done ? sage2 : 'transparent',
                minWidth: Math.min(28, MIN_TOUCH),
                minHeight: Math.min(28, MIN_TOUCH),
              },
            ]}>
            <Text style={{ color: pine2, fontSize: 12, fontWeight: '800' }}>
              {item.done ? '✓' : ''}
            </Text>
          </Pressable>
          <TextInput
            value={item.text}
            onChangeText={(text) => updateAt(index, { text })}
            maxLength={LIFE_ROAD_ACCEPTANCE_TEXT_MAX}
            placeholder="过关条件…"
            placeholderTextColor={faint}
            style={[styles.input, { color: ink }]}
          />
          <Pressable
            onPress={() => removeAt(index)}
            accessibilityLabel="删除本条"
            hitSlop={8}
            style={styles.remove}>
            <Text style={{ color: muted, fontSize: 16, fontWeight: '700' }}>×</Text>
          </Pressable>
        </View>
      ))}

      {items.length < LIFE_ROAD_ACCEPTANCE_MAX_ITEMS ? (
        <Pressable
          onPress={addRow}
          accessibilityLabel="添加验收标准"
          style={[styles.add, { borderColor: line }]}>
          <Text style={{ color: pine2, fontSize: 12, fontWeight: '700' }}>
            + 验收标准
          </Text>
        </Pressable>
      ) : (
        <Text style={[styles.cap, { color: faint }]}>
          已达上限 {LIFE_ROAD_ACCEPTANCE_MAX_ITEMS} 条
        </Text>
      )}

      {items.length === 0 ? (
        <Text style={[styles.empty, { color: ink2 }]}>
          暂无。用来写清「怎样算抵达」，可随时增删勾选。
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  lab: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  hint: {
    fontSize: 11,
    lineHeight: 16,
    marginTop: -2,
    marginBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 14,
    fontWeight: '600',
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  remove: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  add: {
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    borderRadius: 10,
    paddingVertical: 9,
    paddingHorizontal: 10,
    alignItems: 'flex-start',
  },
  cap: { fontSize: 11 },
  empty: { fontSize: 12, lineHeight: 18, fontStyle: 'italic' },
});
