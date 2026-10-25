/**
 * 验收标准 · 可自由扩展 todolist（与子任务互不冲突）
 */
import {
  createEmptyAcceptanceItem,
  countAcceptanceProgress,
  type AcceptanceCriterionItem,
} from '@/lib/acceptance-criteria';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

export type AcceptanceChecklistEditorProps = {
  items: AcceptanceCriterionItem[];
  onChange: (items: AcceptanceCriterionItem[]) => void;
  /** 编辑态可改文案/增删；查看态仅勾选 */
  mode?: 'edit' | 'check';
  disabled?: boolean;
  placeholder?: string;
  inkColor?: string;
  faintColor?: string;
  frogColor?: string;
  onPondColor?: string;
  lineColor?: string;
  /** 是否显示进度「n / m 达成」 */
  showProgress?: boolean;
};

export function AcceptanceChecklistEditor({
  items,
  onChange,
  mode = 'edit',
  disabled = false,
  placeholder = '怎样算完成？',
  inkColor = '#46534C',
  faintColor = '#98A197',
  frogColor = '#4F7C51',
  onPondColor = '#F7F4E9',
  lineColor = '#D8CDBB',
  showProgress = true,
}: AcceptanceChecklistEditorProps) {
  const { done, total } = countAcceptanceProgress(items);
  const rows = items.length > 0 ? items : mode === 'edit' ? [createEmptyAcceptanceItem()] : [];

  const updateAt = (index: number, patch: Partial<AcceptanceCriterionItem>) => {
    const next = rows.map((row, i) => (i === index ? { ...row, ...patch } : row));
    onChange(next);
  };

  const removeAt = (index: number) => {
    const next = rows.filter((_, i) => i !== index);
    onChange(next.length > 0 ? next : mode === 'edit' ? [createEmptyAcceptanceItem()] : []);
  };

  const addRow = () => {
    onChange([...rows, createEmptyAcceptanceItem()]);
  };

  return (
    <View style={styles.wrap}>
      {showProgress && total > 0 ? (
        <Text style={[styles.progress, { color: faintColor }]}>
          {done} / {total} 达成
        </Text>
      ) : null}

      {rows.map((item, index) => {
        const canRemove = mode === 'edit' && rows.length > 1;
        return (
          <View key={item.id} style={styles.row}>
            <Pressable
              onPress={() => {
                if (disabled) return;
                updateAt(index, { done: !item.done });
              }}
              disabled={disabled}
              hitSlop={6}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: item.done }}
              style={[
                styles.cb,
                {
                  borderColor: item.done ? frogColor : lineColor,
                  backgroundColor: item.done ? frogColor : 'rgba(255,255,255,0.5)',
                  opacity: disabled ? 0.55 : 1,
                },
              ]}>
              {item.done ? <MaterialIcons name="check" size={11} color={onPondColor} /> : null}
            </Pressable>

            {mode === 'edit' ? (
              <TextInput
                value={item.text}
                onChangeText={(text) => updateAt(index, { text })}
                placeholder={index === 0 ? placeholder : '继续添加…'}
                placeholderTextColor={faintColor}
                editable={!disabled}
                style={[
                  styles.input,
                  {
                    color: item.done ? faintColor : inkColor,
                    textDecorationLine: item.done ? 'line-through' : 'none',
                    opacity: disabled ? 0.65 : 1,
                  },
                ]}
                onSubmitEditing={() => {
                  if (item.text.trim()) addRow();
                }}
                returnKeyType="next"
              />
            ) : (
              <Text
                style={[
                  styles.label,
                  {
                    color: item.done ? faintColor : inkColor,
                    textDecorationLine: item.done ? 'line-through' : 'none',
                  },
                ]}>
                {item.text}
              </Text>
            )}

            {canRemove ? (
              <Pressable
                onPress={() => removeAt(index)}
                disabled={disabled}
                hitSlop={8}
                accessibilityLabel="删除此项"
                style={{ opacity: disabled ? 0.4 : 1 }}>
                <MaterialIcons name="close" size={16} color={faintColor} />
              </Pressable>
            ) : (
              <View style={{ width: 16 }} />
            )}
          </View>
        );
      })}

      {mode === 'edit' && !disabled ? (
        <Pressable onPress={addRow} hitSlop={8} style={styles.addBtn} accessibilityLabel="添加验收项">
          <MaterialIcons name="add" size={14} color={frogColor} />
          <Text style={[styles.addText, { color: frogColor }]}>添加验收项</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 4, flex: 1, minWidth: 0 },
  progress: { fontSize: 10, fontWeight: '600', marginBottom: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 28,
    paddingVertical: 2,
  },
  cb: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    paddingVertical: 4,
    paddingHorizontal: 0,
  },
  label: {
    flex: 1,
    minWidth: 0,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '500',
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  addText: { fontSize: 12, fontWeight: '600' },
});
