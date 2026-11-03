/**
 * 项目「推进进度 · 小习惯」编辑区（双轨）。
 * - 有自身目标：只读跟随养成 expectedGoal / 戒除连续天数
 * - 无自身目标：可填项目侧目标天数（达标日累计）
 * 周期配额不纳入。
 */
import { BoundHabitPickerField } from '@/components/tasks/BoundHabitPickerField';
import type { HabitRow } from '@/lib/repositories/habits/habit.types';
import {
  PROGRESS_HABIT_TARGET_DAYS_MAX,
  PROGRESS_HABIT_TARGET_DAYS_MIN,
  resolveHabitNativeProgressFuel,
  snapshotProgressTargetDaysForHabit,
  type ProjectProgressHabitBinding,
} from '@/lib/repositories/projects/project-progress-habits';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useMemo } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type HabitSection = {
  contextId: string;
  contextName: string;
  habits: HabitRow[];
};

const DEFAULT_FALLBACK_DAYS = 21;

type ProgressHabitBindingsFieldProps = {
  bindings: ProjectProgressHabitBinding[];
  sections: HabitSection[];
  loading?: boolean;
  disabled?: boolean;
  onChange: (bindings: ProjectProgressHabitBinding[]) => void;
  /** 首次绑定写入的 since_ymd（逻辑今日） */
  anchorYmd: string;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
  isDark: boolean;
};

export function ProgressHabitBindingsField({
  bindings,
  sections,
  loading = false,
  disabled = false,
  onChange,
  anchorYmd,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
  isDark,
}: ProgressHabitBindingsFieldProps) {
  const selectedIds = useMemo(() => bindings.map((b) => b.habitId), [bindings]);

  const habitById = useMemo(() => {
    const map = new Map<string, HabitRow>();
    for (const section of sections) {
      for (const habit of section.habits) {
        map.set(habit.id, habit);
      }
    }
    return map;
  }, [sections]);

  const handleIdsChange = useCallback(
    (habitIds: string[]) => {
      const prevById = new Map(bindings.map((b) => [b.habitId, b]));
      const next: ProjectProgressHabitBinding[] = [];
      for (const id of habitIds) {
        const existing = prevById.get(id);
        const habit = habitById.get(id);
        const targetDays = habit
          ? snapshotProgressTargetDaysForHabit(
              habit,
              existing?.targetDays ?? DEFAULT_FALLBACK_DAYS,
            )
          : (existing?.targetDays ?? DEFAULT_FALLBACK_DAYS);
        next.push({
          habitId: id,
          targetDays,
          sinceYmd: existing?.sinceYmd ?? anchorYmd,
        });
      }
      onChange(next);
    },
    [anchorYmd, bindings, habitById, onChange],
  );

  const setTargetDaysText = useCallback(
    (habitId: string, text: string) => {
      const digits = text.replace(/[^\d]/g, '');
      const parsed = digits === '' ? 0 : Math.floor(Number(digits));
      onChange(
        bindings.map((b) =>
          b.habitId === habitId
            ? {
                ...b,
                sinceYmd: b.sinceYmd ?? anchorYmd,
                targetDays: Number.isFinite(parsed)
                  ? Math.min(PROGRESS_HABIT_TARGET_DAYS_MAX, Math.max(0, parsed))
                  : 0,
              }
            : b,
        ),
      );
    },
    [anchorYmd, bindings, onChange],
  );

  const bumpTargetDays = useCallback(
    (habitId: string, delta: number) => {
      onChange(
        bindings.map((b) => {
          if (b.habitId !== habitId) return b;
          const next = Math.min(
            PROGRESS_HABIT_TARGET_DAYS_MAX,
            Math.max(PROGRESS_HABIT_TARGET_DAYS_MIN, (b.targetDays || 0) + delta),
          );
          return { ...b, sinceYmd: b.sinceYmd ?? anchorYmd, targetDays: next };
        }),
      );
    },
    [anchorYmd, bindings, onChange],
  );

  const removeBinding = useCallback(
    (habitId: string) => {
      onChange(bindings.filter((b) => b.habitId !== habitId));
    },
    [bindings, onChange],
  );

  return (
    <View style={styles.wrap}>
      <BoundHabitPickerField
        selectedHabitIds={selectedIds}
        sections={sections}
        loading={loading}
        disabled={disabled}
        onChange={handleIdsChange}
        textColor={textColor}
        outline={outline}
        placeholderColor={placeholderColor}
        primary={primary}
        surfaceLow={surfaceLow}
        surfaceLowest={surfaceLowest}
        isDark={isDark}
        emptyHint="可选养成/戒除；有自身目标则跟随，否则填目标天数"
        selectedHint="满进度只提醒结案，不会自动归档"
        modalTitle="推进进度 · 小习惯"
        modalDesc="可多选养成/戒除（不含周期配额）。已设养成目标或戒除连续天数的，进度跟习惯自身；未设的，按项目目标天数累计达标日。"
      />
      {bindings.length > 0 ? (
        <View style={styles.list}>
          {bindings.map((binding) => {
            const habit = habitById.get(binding.habitId);
            const native = habit ? resolveHabitNativeProgressFuel(habit) : null;
            const name = habit?.name?.trim() || '未知习惯';
            const daysText = binding.targetDays > 0 ? String(binding.targetDays) : '';
            return (
              <View
                key={binding.habitId}
                style={[
                  styles.row,
                  {
                    backgroundColor: surfaceLow,
                    borderColor: placeholderColor,
                  },
                ]}>
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={[styles.name, { color: textColor }]} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={[styles.sub, { color: outline }]} numberOfLines={2}>
                    {native
                      ? `${native.kindLabel}目标 ${native.goalShort}（跟随习惯）`
                      : '未设自身目标 · 按达标日累计'}
                  </Text>
                </View>
                {!native ? (
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() => bumpTargetDays(binding.habitId, -1)}
                      disabled={disabled}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.stepBtn,
                        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
                      ]}>
                      <MaterialIcons name="remove" size={16} color={outline} />
                    </Pressable>
                    <TextInput
                      value={daysText}
                      onChangeText={(t) => setTargetDaysText(binding.habitId, t)}
                      editable={!disabled}
                      keyboardType="number-pad"
                      maxLength={3}
                      placeholder={`${PROGRESS_HABIT_TARGET_DAYS_MIN}`}
                      placeholderTextColor={placeholderColor}
                      style={[
                        styles.daysInput,
                        {
                          color: textColor,
                          borderColor: placeholderColor,
                          backgroundColor: surfaceLowest,
                        },
                      ]}
                    />
                    <Pressable
                      onPress={() => bumpTargetDays(binding.habitId, 1)}
                      disabled={disabled}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.stepBtn,
                        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
                      ]}>
                      <MaterialIcons name="add" size={16} color={outline} />
                    </Pressable>
                  </View>
                ) : null}
                <Pressable
                  onPress={() => removeBinding(binding.habitId)}
                  disabled={disabled}
                  hitSlop={8}
                  accessibilityLabel={`移除 ${name}`}
                  style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
                  <MaterialIcons name="close" size={18} color={outline} />
                </Pressable>
              </View>
            );
          })}
          <Text style={[styles.help, { color: outline }]}>
            有自身目标跟习惯；没有则填天数按达标日推进。满进度不会自动归档。
          </Text>
        </View>
      ) : (
        <Text style={[styles.help, { color: outline, marginTop: 6 }]}>
          有自身目标跟习惯；没有则填天数按达标日推进。满进度不会自动归档。
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  name: { fontSize: 13, fontWeight: '700' },
  sub: { fontSize: 10, fontWeight: '600', lineHeight: 14 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  daysInput: {
    width: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
  },
  help: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
});
