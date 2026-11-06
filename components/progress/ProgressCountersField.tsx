/**
 * 创建/编辑：进度计数轨配置（目标、单位、周期、初始完成量）。
 */
import {
  createEmptyProgressCounter,
  PROGRESS_COUNTER_CURRENT_MAX,
  PROGRESS_COUNTER_TARGET_MAX,
  PROGRESS_COUNTER_TARGET_MIN,
  PROGRESS_COUNTER_TITLE_MAX,
  PROGRESS_COUNTER_UNIT_MAX,
  type ProgressCounter,
  type ProgressCounterPeriod,
  type ProgressCounterPeriodReset,
} from '@/lib/repositories/progress/progress-counters';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

type ProgressCountersFieldProps = {
  counters: ProgressCounter[];
  disabled?: boolean;
  onChange: (counters: ProgressCounter[]) => void;
  anchorYmd: string;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLow: string;
  surfaceLowest: string;
};

export function ProgressCountersField({
  counters,
  disabled = false,
  onChange,
  anchorYmd,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLow,
  surfaceLowest,
}: ProgressCountersFieldProps) {
  const addCounter = useCallback(() => {
    if (disabled) return;
    onChange([
      ...counters,
      createEmptyProgressCounter({ title: '', target: 3, unit: '次', sinceYmd: anchorYmd }),
    ]);
  }, [anchorYmd, counters, disabled, onChange]);

  const patch = useCallback(
    (id: string, patchRow: Partial<ProgressCounter>) => {
      onChange(counters.map((c) => (c.id === id ? { ...c, ...patchRow } : c)));
    },
    [counters, onChange],
  );

  const remove = useCallback(
    (id: string) => {
      onChange(counters.filter((c) => c.id !== id));
    },
    [counters, onChange],
  );

  const setPeriod = useCallback(
    (id: string, period: ProgressCounterPeriod) => {
      patch(id, {
        period,
        periodReset: period === 'week' ? 'auto' : 'auto',
        periodKey: undefined,
      });
    },
    [patch],
  );

  const setPeriodReset = useCallback(
    (id: string, periodReset: ProgressCounterPeriodReset) => {
      patch(id, { periodReset });
    },
    [patch],
  );

  return (
    <View style={styles.wrap}>
      <Pressable
        onPress={addCounter}
        disabled={disabled}
        style={({ pressed }) => [
          styles.addBtn,
          {
            borderColor: placeholderColor,
            backgroundColor: surfaceLow,
            opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
          },
        ]}>
        <MaterialIcons name="add" size={16} color={primary} />
        <Text style={[styles.addText, { color: primary }]}>添加计数目标</Text>
      </Pressable>

      {counters.length > 0 ? (
        <View style={styles.list}>
          {counters.map((c) => {
            const targetText = c.target > 0 ? String(c.target) : '';
            const currentText = String(c.current);
            return (
              <View
                key={c.id}
                style={[
                  styles.card,
                  { backgroundColor: surfaceLow, borderColor: placeholderColor },
                ]}>
                <View style={styles.cardHead}>
                  <TextInput
                    value={c.title === '计数目标' ? '' : c.title}
                    onChangeText={(t) =>
                      patch(c.id, {
                        title: t.slice(0, PROGRESS_COUNTER_TITLE_MAX),
                      })
                    }
                    editable={!disabled}
                    placeholder="如：看书"
                    placeholderTextColor={placeholderColor}
                    style={[
                      styles.titleInput,
                      {
                        color: textColor,
                        borderColor: placeholderColor,
                        backgroundColor: surfaceLowest,
                      },
                    ]}
                  />
                  <Pressable
                    onPress={() => remove(c.id)}
                    disabled={disabled}
                    hitSlop={8}
                    accessibilityLabel="移除计数"
                    style={({ pressed }) => [{ opacity: disabled ? 0.5 : pressed ? 0.7 : 1 }]}>
                    <MaterialIcons name="close" size={18} color={outline} />
                  </Pressable>
                </View>

                <View style={styles.metaRow}>
                  <Text style={[styles.metaLab, { color: outline }]}>目标</Text>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() =>
                        patch(c.id, {
                          target: Math.max(
                            PROGRESS_COUNTER_TARGET_MIN,
                            (c.target || 0) - 1,
                          ),
                        })
                      }
                      disabled={disabled}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.stepBtn,
                        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
                      ]}>
                      <MaterialIcons name="remove" size={16} color={outline} />
                    </Pressable>
                    <TextInput
                      value={targetText}
                      onChangeText={(t) => {
                        const digits = t.replace(/[^\d]/g, '');
                        const parsed = digits === '' ? 0 : Math.floor(Number(digits));
                        patch(c.id, {
                          target: Number.isFinite(parsed)
                            ? Math.min(PROGRESS_COUNTER_TARGET_MAX, Math.max(0, parsed))
                            : 0,
                        });
                      }}
                      editable={!disabled}
                      keyboardType="number-pad"
                      maxLength={4}
                      placeholder={`${PROGRESS_COUNTER_TARGET_MIN}`}
                      placeholderTextColor={placeholderColor}
                      style={[
                        styles.numInput,
                        {
                          color: textColor,
                          borderColor: placeholderColor,
                          backgroundColor: surfaceLowest,
                        },
                      ]}
                    />
                    <Pressable
                      onPress={() =>
                        patch(c.id, {
                          target: Math.min(
                            PROGRESS_COUNTER_TARGET_MAX,
                            Math.max(PROGRESS_COUNTER_TARGET_MIN, (c.target || 0) + 1),
                          ),
                        })
                      }
                      disabled={disabled}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.stepBtn,
                        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
                      ]}>
                      <MaterialIcons name="add" size={16} color={outline} />
                    </Pressable>
                  </View>

                  <Text style={[styles.metaLab, { color: outline }]}>单位</Text>
                  <TextInput
                    value={c.unit}
                    onChangeText={(t) =>
                      patch(c.id, { unit: t.slice(0, PROGRESS_COUNTER_UNIT_MAX) })
                    }
                    editable={!disabled}
                    placeholder="次"
                    placeholderTextColor={placeholderColor}
                    style={[
                      styles.unitInput,
                      {
                        color: textColor,
                        borderColor: placeholderColor,
                        backgroundColor: surfaceLowest,
                      },
                    ]}
                  />
                </View>

                <View style={styles.metaRow}>
                  <Text style={[styles.metaLab, { color: outline }]}>已完成</Text>
                  <View style={styles.stepper}>
                    <Pressable
                      onPress={() =>
                        patch(c.id, { current: Math.max(0, (c.current || 0) - 1) })
                      }
                      disabled={disabled}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.stepBtn,
                        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
                      ]}>
                      <MaterialIcons name="remove" size={16} color={outline} />
                    </Pressable>
                    <TextInput
                      value={currentText}
                      onChangeText={(t) => {
                        const digits = t.replace(/[^\d]/g, '');
                        const parsed = digits === '' ? 0 : Math.floor(Number(digits));
                        patch(c.id, {
                          current: Number.isFinite(parsed)
                            ? Math.min(PROGRESS_COUNTER_CURRENT_MAX, Math.max(0, parsed))
                            : 0,
                        });
                      }}
                      editable={!disabled}
                      keyboardType="number-pad"
                      maxLength={5}
                      placeholder="0"
                      placeholderTextColor={placeholderColor}
                      style={[
                        styles.numInput,
                        {
                          color: textColor,
                          borderColor: placeholderColor,
                          backgroundColor: surfaceLowest,
                        },
                      ]}
                    />
                    <Pressable
                      onPress={() =>
                        patch(c.id, {
                          current: Math.min(
                            PROGRESS_COUNTER_CURRENT_MAX,
                            (c.current || 0) + 1,
                          ),
                        })
                      }
                      disabled={disabled}
                      hitSlop={6}
                      style={({ pressed }) => [
                        styles.stepBtn,
                        { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
                      ]}>
                      <MaterialIcons name="add" size={16} color={outline} />
                    </Pressable>
                  </View>
                </View>

                <View style={styles.periodRow}>
                  <Chip
                    label="累计"
                    active={c.period === 'none'}
                    disabled={disabled}
                    primary={primary}
                    outline={outline}
                    surfaceLowest={surfaceLowest}
                    onPress={() => setPeriod(c.id, 'none')}
                  />
                  <Chip
                    label="每周"
                    active={c.period === 'week'}
                    disabled={disabled}
                    primary={primary}
                    outline={outline}
                    surfaceLowest={surfaceLowest}
                    onPress={() => setPeriod(c.id, 'week')}
                  />
                  {c.period === 'week' ? (
                    <>
                      <Chip
                        label="跨周清零"
                        active={c.periodReset === 'auto'}
                        disabled={disabled}
                        primary={primary}
                        outline={outline}
                        surfaceLowest={surfaceLowest}
                        onPress={() => setPeriodReset(c.id, 'auto')}
                      />
                      <Chip
                        label="跨周保留"
                        active={c.periodReset === 'manual'}
                        disabled={disabled}
                        primary={primary}
                        outline={outline}
                        surfaceLowest={surfaceLowest}
                        onPress={() => setPeriodReset(c.id, 'manual')}
                      />
                    </>
                  ) : null}
                </View>
              </View>
            );
          })}
          <Text style={[styles.help, { color: outline }]}>
            打卡推进进度；满进度只提醒结案/完成，不会自动归档。
          </Text>
        </View>
      ) : (
        <Text style={[styles.help, { color: outline, marginTop: 4 }]}>
          适合「这周看 3 次书」这类有总数的目标，与习惯进度轨并列。
        </Text>
      )}
    </View>
  );
}

function Chip({
  label,
  active,
  disabled,
  primary,
  outline,
  surfaceLowest,
  onPress,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  primary: string;
  outline: string;
  surfaceLowest: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? primary : surfaceLowest,
          borderColor: active ? primary : outline,
          opacity: disabled ? 0.5 : pressed ? 0.75 : 1,
        },
      ]}>
      <Text style={[styles.chipText, { color: active ? '#FFF' : outline }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  addText: { fontSize: 12, fontWeight: '700' },
  list: { gap: 8 },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titleInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 13,
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaLab: { fontSize: 11, fontWeight: '700' },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numInput: {
    width: 48,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
  },
  unitInput: {
    width: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 4,
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '700',
  },
  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: { fontSize: 11, fontWeight: '700' },
  help: { fontSize: 11, fontWeight: '600', lineHeight: 15 },
});
