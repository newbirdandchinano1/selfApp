import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { RecipeIngredient } from '@/lib/recipes';

export const RECIPE_INGREDIENT_NAME_MAX = 200;
export const RECIPE_INGREDIENT_AMOUNT_MAX = 200;
export const RECIPE_INGREDIENTS_MAX = 80;

const EMPTY_ROW: RecipeIngredient = { name: '', amount: '' };

type Props = {
  rows: RecipeIngredient[];
  onChange: (rows: RecipeIngredient[]) => void;
  textColor: string;
  outlineColor: string;
  borderColor: string;
  inputBg: string;
  primary: string;
};

function clampName(value: string): string {
  return value.length > RECIPE_INGREDIENT_NAME_MAX ? value.slice(0, RECIPE_INGREDIENT_NAME_MAX) : value;
}

function clampAmount(value: string): string {
  return value.length > RECIPE_INGREDIENT_AMOUNT_MAX ? value.slice(0, RECIPE_INGREDIENT_AMOUNT_MAX) : value;
}

export function ensureMinIngredientRows(rows: RecipeIngredient[]): RecipeIngredient[] {
  return rows.length > 0 ? rows : [{ ...EMPTY_ROW }];
}

export function trimIngredientRows(rows: RecipeIngredient[]): RecipeIngredient[] {
  return rows
    .map(r => ({ name: r.name.trim(), amount: r.amount.trim() }))
    .filter(r => r.name.length > 0);
}

export function IngredientInputs({
  rows,
  onChange,
  textColor,
  outlineColor,
  borderColor,
  inputBg,
  primary,
}: Props) {
  const safeRows = ensureMinIngredientRows(rows);

  const setField = useCallback(
    (index: number, field: keyof RecipeIngredient, value: string) => {
      const next = safeRows.map((row, i) => {
        if (i !== index) return row;
        return field === 'name'
          ? { ...row, name: clampName(value) }
          : { ...row, amount: clampAmount(value) };
      });
      const row = next[index];
      const isLast = index === next.length - 1;
      const hasContent = row.name.trim() || row.amount.trim();
      if (isLast && hasContent && next.length < RECIPE_INGREDIENTS_MAX) {
        next.push({ ...EMPTY_ROW });
      }
      onChange(next);
    },
    [onChange, safeRows],
  );

  const removeRow = useCallback(
    (index: number) => {
      const row = safeRows[index];
      if (safeRows.length <= 1) {
        onChange([{ ...EMPTY_ROW }]);
        return;
      }
      const next = safeRows.filter((_, i) => i !== index);
      onChange(ensureMinIngredientRows(next));
    },
    [onChange, safeRows],
  );

  const addRow = useCallback(() => {
    if (safeRows.length >= RECIPE_INGREDIENTS_MAX) return;
    const last = safeRows[safeRows.length - 1];
    if (!last?.name.trim() && !last?.amount.trim()) return;
    onChange([...safeRows, { ...EMPTY_ROW }]);
  }, [onChange, safeRows]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, { color: outlineColor }]}>食材</Text>
      <Text style={[styles.hint, { color: outlineColor }]}>
        填写食材名称与用量，填写一项后出现下一项，也可点「添加一项」
      </Text>
      <View style={[styles.headerRow, { borderBottomColor: borderColor }]}>
        <Text style={[styles.colHeader, styles.nameCol, { color: outlineColor }]}>食材</Text>
        <Text style={[styles.colHeader, styles.amountCol, { color: outlineColor }]}>用量</Text>
        <View style={styles.removePlaceholder} />
      </View>
      <View style={styles.list}>
        {safeRows.map((row, index) => {
          const canRemove = safeRows.length > 1 || row.name.trim().length > 0 || row.amount.trim().length > 0;
          return (
            <View key={`ing-${index}`} style={styles.row}>
              <TextInput
                value={row.name}
                onChangeText={v => setField(index, 'name', v)}
                placeholder="例如：鸡蛋"
                placeholderTextColor={outlineColor}
                textAlignVertical="center"
                style={[
                  styles.input,
                  styles.nameCol,
                  Platform.OS === 'android' && styles.inputAndroid,
                  { color: textColor, borderColor, backgroundColor: inputBg },
                ]}
              />
              <TextInput
                value={row.amount}
                onChangeText={v => setField(index, 'amount', v)}
                placeholder="例如：2 个"
                placeholderTextColor={outlineColor}
                textAlignVertical="center"
                style={[
                  styles.input,
                  styles.amountCol,
                  Platform.OS === 'android' && styles.inputAndroid,
                  { color: textColor, borderColor, backgroundColor: inputBg },
                ]}
              />
              {canRemove ? (
                <Pressable
                  onPress={() => removeRow(index)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.removeBtn, { opacity: pressed ? 0.65 : 1 }]}
                  accessibilityLabel="删除此项"
                >
                  <MaterialIcons name="remove-circle-outline" size={22} color={outlineColor} />
                </Pressable>
              ) : (
                <View style={styles.removePlaceholder} />
              )}
            </View>
          );
        })}
      </View>
      {safeRows.length < RECIPE_INGREDIENTS_MAX ? (
        <Pressable
          onPress={addRow}
          style={({ pressed }) => [
            styles.addBtn,
            { borderColor, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <MaterialIcons name="add" size={20} color={primary} />
          <Text style={[styles.addBtnText, { color: primary }]}>添加一项</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontSize: 12, fontWeight: '700' },
  hint: { fontSize: 11, lineHeight: 16 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginTop: 2,
  },
  colHeader: { fontSize: 11, fontWeight: '700' },
  list: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  nameCol: { flex: 1.2 },
  amountCol: { flex: 1 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    fontSize: 15,
    lineHeight: 20,
    ...Platform.select({
      ios: { paddingVertical: 11 },
      default: { paddingVertical: 0 },
    }),
  },
  inputAndroid: {
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  removeBtn: { width: 28, alignItems: 'center' },
  removePlaceholder: { width: 28 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addBtnText: { fontSize: 14, fontWeight: '700' },
});
