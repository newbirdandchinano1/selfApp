/**
 * 道路节点编辑：验收标准可增删勾选清单。
 * 对齐设计稿 `我的道路-UI重构.html` route-node checklist-edit。
 */
import {
  LIFE_ROAD_ACCEPTANCE_MAX_ITEMS,
  LIFE_ROAD_ACCEPTANCE_TEXT_MAX,
  createAcceptanceItem,
  type LifeRoadAcceptanceItem,
} from '@/lib/life-road/life-road-acceptance';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type AcceptanceChecklistEditorProps = {
  items: LifeRoadAcceptanceItem[];
  onChange: (next: LifeRoadAcceptanceItem[]) => void;
  ink2: string;
  ink3: string;
  muted: string;
  muted2: string;
  faint: string;
  line: string;
  pine: string;
  onRoad: string;
  clay2: string;
};

function RemoveIcon({ color }: { color: string }) {
  return (
    <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 5l14 14M19 5L5 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function AcceptanceChecklistEditor({
  items,
  onChange,
  ink2,
  ink3,
  muted,
  muted2,
  faint,
  line,
  pine,
  onRoad,
  clay2,
}: AcceptanceChecklistEditorProps) {
  const [draft, setDraft] = useState('');

  const updateAt = (index: number, patch: Partial<LifeRoadAcceptanceItem>) => {
    onChange(items.map((it, i) => (i === index ? { ...it, ...patch } : it)));
  };

  const removeAt = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  const addFromDraft = () => {
    if (items.length >= LIFE_ROAD_ACCEPTANCE_MAX_ITEMS) return;
    const text = draft.trim();
    if (!text) return;
    onChange([
      ...items,
      createAcceptanceItem(text.slice(0, LIFE_ROAD_ACCEPTANCE_TEXT_MAX)),
    ]);
    setDraft('');
  };

  return (
    <View style={styles.wrap}>
      {items.map((item, index) => (
        <View key={item.id} style={styles.row}>
          <Pressable
            onPress={() => updateAt(index, { done: !item.done })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.done }}
            accessibilityLabel={item.done ? '标为未完成' : '标为已完成'}
            hitSlop={6}
            style={[
              styles.check,
              item.done
                ? { borderColor: pine, backgroundColor: pine }
                : {
                    borderColor: line,
                    backgroundColor: 'rgba(255,255,255,0.45)',
                  },
            ]}>
            {item.done ? (
              <Svg width={9} height={9} viewBox="0 0 24 24" fill="none">
                <Path
                  d="M5 12.5l4.5 4.5L19 7"
                  stroke={onRoad}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            ) : null}
          </Pressable>
          <TextInput
            value={item.text}
            onChangeText={(text) => updateAt(index, { text })}
            maxLength={LIFE_ROAD_ACCEPTANCE_TEXT_MAX}
            placeholder="过关条件…"
            placeholderTextColor={faint}
            style={[styles.input, { color: item.done ? muted : ink3 }]}
          />
          <Pressable
            onPress={() => removeAt(index)}
            accessibilityLabel="删除本条"
            hitSlop={8}
            style={({ pressed }) => [
              styles.remove,
              pressed && { backgroundColor: clay2, opacity: 1 },
            ]}>
            <RemoveIcon color={muted2} />
          </Pressable>
        </View>
      ))}

      {items.length < LIFE_ROAD_ACCEPTANCE_MAX_ITEMS ? (
        <View style={styles.addRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            maxLength={LIFE_ROAD_ACCEPTANCE_TEXT_MAX}
            placeholder="加一条可勾选的验收标准"
            placeholderTextColor={muted2}
            onSubmitEditing={addFromDraft}
            returnKeyType="done"
            style={[
              styles.addInput,
              {
                color: ink3,
                borderColor: line,
                backgroundColor: 'rgba(255,255,255,0.38)',
              },
            ]}
          />
          <Pressable
            onPress={addFromDraft}
            disabled={!draft.trim()}
            accessibilityLabel="添加验收标准"
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: pine,
                opacity: !draft.trim() ? 0.4 : pressed ? 0.9 : 1,
              },
            ]}>
            <Text style={{ color: onRoad, fontSize: 18, lineHeight: 20, marginTop: -1 }}>
              +
            </Text>
          </Pressable>
        </View>
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
  wrap: { gap: 4, marginTop: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 9,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  remove: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
    flexShrink: 0,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 5,
  },
  addInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cap: { fontSize: 11, marginTop: 4 },
  empty: { fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginTop: 4 },
});
