/**
 * 创建/编辑：进度计数轨配置（目标、单位、周期、初始完成量）。
 * 「添加计数目标」走底部弹层。
 */
import {
  FoldBottomSheet,
  useFoldBottomSheetRequestClose,
} from '@/components/ui/fold-bottom-sheet';
import {
  createEmptyProgressCounter,
  PROGRESS_COUNTER_CURRENT_MAX,
  PROGRESS_COUNTER_TARGET_MAX,
  PROGRESS_COUNTER_TARGET_MIN,
  PROGRESS_COUNTER_UNIT_MAX,
  type ProgressCounter,
  type ProgressCounterPeriod,
  type ProgressCounterPeriodReset,
} from '@/lib/repositories/progress/progress-counters';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
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

function parseNonNegInt(raw: string, max: number): number {
  const digits = raw.replace(/[^\d]/g, '');
  if (digits === '') return 0;
  // 超长数字串用 BigInt 截到安全整数，避免 Number 精度丢失后变 Infinity
  try {
    const n = BigInt(digits);
    const capped = n > BigInt(max) ? BigInt(max) : n;
    return Number(capped);
  } catch {
    return 0;
  }
}

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
  const [addOpen, setAddOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState('计数目标');
  const [draftTarget, setDraftTarget] = useState(3);
  const [draftCurrent, setDraftCurrent] = useState(0);
  const [draftUnit, setDraftUnit] = useState('次');
  const [draftPeriod, setDraftPeriod] = useState<ProgressCounterPeriod>('none');

  const openAddSheet = useCallback(() => {
    if (disabled) return;
    setDraftTitle('计数目标');
    setDraftTarget(3);
    setDraftCurrent(0);
    setDraftUnit('次');
    setDraftPeriod('none');
    setAddOpen(true);
  }, [disabled]);

  const handleAddSheetClose = useCallback(() => {
    setAddOpen(false);
  }, []);

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
        onPress={openAddSheet}
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
                        patch(c.id, {
                          target: parseNonNegInt(t, PROGRESS_COUNTER_TARGET_MAX),
                        });
                      }}
                      editable={!disabled}
                      keyboardType="number-pad"
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

                  <Pressable
                    onPress={() => remove(c.id)}
                    disabled={disabled}
                    hitSlop={8}
                    accessibilityLabel="移除计数"
                    style={({ pressed }) => [
                      styles.removeBtn,
                      { opacity: disabled ? 0.5 : pressed ? 0.7 : 1 },
                    ]}>
                    <MaterialIcons name="close" size={18} color={outline} />
                  </Pressable>
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
                        patch(c.id, {
                          current: parseNonNegInt(t, PROGRESS_COUNTER_CURRENT_MAX),
                        });
                      }}
                      editable={!disabled}
                      keyboardType="number-pad"
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

      <FoldBottomSheet
        visible={addOpen}
        onClose={handleAddSheetClose}
        accessibilityLabel="关闭添加计数目标">
        <AddCounterSheetBody
          draftTitle={draftTitle}
          setDraftTitle={setDraftTitle}
          draftTarget={draftTarget}
          setDraftTarget={setDraftTarget}
          draftCurrent={draftCurrent}
          setDraftCurrent={setDraftCurrent}
          draftUnit={draftUnit}
          setDraftUnit={setDraftUnit}
          draftPeriod={draftPeriod}
          setDraftPeriod={setDraftPeriod}
          textColor={textColor}
          outline={outline}
          placeholderColor={placeholderColor}
          primary={primary}
          surfaceLowest={surfaceLowest}
          onConfirm={() => {
            onChange([
              ...counters,
              createEmptyProgressCounter({
                title: draftTitle.trim() || '计数目标',
                target: draftTarget,
                current: draftCurrent,
                unit: draftUnit.trim() || '次',
                period: draftPeriod,
                sinceYmd: anchorYmd,
              }),
            ]);
          }}
        />
      </FoldBottomSheet>
    </View>
  );
}

function AddCounterSheetBody({
  draftTitle,
  setDraftTitle,
  draftTarget,
  setDraftTarget,
  draftCurrent,
  setDraftCurrent,
  draftUnit,
  setDraftUnit,
  draftPeriod,
  setDraftPeriod,
  textColor,
  outline,
  placeholderColor,
  primary,
  surfaceLowest,
  onConfirm,
}: {
  draftTitle: string;
  setDraftTitle: (v: string) => void;
  draftTarget: number;
  setDraftTarget: (v: number) => void;
  draftCurrent: number;
  setDraftCurrent: (v: number) => void;
  draftUnit: string;
  setDraftUnit: (v: string) => void;
  draftPeriod: ProgressCounterPeriod;
  setDraftPeriod: (v: ProgressCounterPeriod) => void;
  textColor: string;
  outline: string;
  placeholderColor: string;
  primary: string;
  surfaceLowest: string;
  onConfirm: () => void;
}) {
  const requestClose = useFoldBottomSheetRequestClose();

  const confirm = useCallback(() => {
    onConfirm();
    requestClose();
  }, [onConfirm, requestClose]);

  return (
    <View style={styles.sheetBody}>
      <View style={styles.sheetHead}>
        <Text style={[styles.sheetTitle, { color: textColor }]}>添加计数目标</Text>
        <Pressable onPress={requestClose} hitSlop={10} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name="close" size={22} color={outline} />
        </Pressable>
      </View>
      <Text style={[styles.help, { color: outline }]}>设定目标、已完成次数与单位，确认后加入推进列表。</Text>

      <View style={styles.sheetField}>
        <Text style={[styles.metaLab, { color: outline }]}>名称</Text>
        <TextInput
          value={draftTitle}
          onChangeText={setDraftTitle}
          placeholder="计数目标"
          placeholderTextColor={placeholderColor}
          style={[
            styles.titleInput,
            { color: textColor, borderColor: placeholderColor, backgroundColor: surfaceLowest },
          ]}
        />
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.metaLab, { color: outline }]}>目标</Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => {
              const next = Math.max(PROGRESS_COUNTER_TARGET_MIN, draftTarget - 1);
              setDraftTarget(next);
              if (draftCurrent > next) setDraftCurrent(next);
            }}
            hitSlop={6}
            style={({ pressed }) => [styles.stepBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="remove" size={16} color={outline} />
          </Pressable>
          <TextInput
            value={draftTarget > 0 ? String(draftTarget) : ''}
            onChangeText={(t) => {
              const next = parseNonNegInt(t, PROGRESS_COUNTER_TARGET_MAX);
              setDraftTarget(next);
              if (draftCurrent > next) setDraftCurrent(next);
            }}
            keyboardType="number-pad"
            placeholder={`${PROGRESS_COUNTER_TARGET_MIN}`}
            placeholderTextColor={placeholderColor}
            style={[
              styles.numInput,
              { color: textColor, borderColor: placeholderColor, backgroundColor: surfaceLowest },
            ]}
          />
          <Pressable
            onPress={() =>
              setDraftTarget(
                Math.min(
                  PROGRESS_COUNTER_TARGET_MAX,
                  Math.max(PROGRESS_COUNTER_TARGET_MIN, draftTarget + 1),
                ),
              )
            }
            hitSlop={6}
            style={({ pressed }) => [styles.stepBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="add" size={16} color={outline} />
          </Pressable>
        </View>
        <Text style={[styles.metaLab, { color: outline }]}>单位</Text>
        <TextInput
          value={draftUnit}
          onChangeText={(t) => setDraftUnit(t.slice(0, PROGRESS_COUNTER_UNIT_MAX))}
          placeholder="次"
          placeholderTextColor={placeholderColor}
          style={[
            styles.unitInput,
            { color: textColor, borderColor: placeholderColor, backgroundColor: surfaceLowest },
          ]}
        />
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.metaLab, { color: outline }]}>已完成</Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => setDraftCurrent(Math.max(0, draftCurrent - 1))}
            hitSlop={6}
            style={({ pressed }) => [styles.stepBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="remove" size={16} color={outline} />
          </Pressable>
          <TextInput
            value={String(draftCurrent)}
            onChangeText={(t) => {
              const cap = Math.min(
                Math.max(draftTarget, 0),
                PROGRESS_COUNTER_CURRENT_MAX,
              );
              setDraftCurrent(Math.min(cap, parseNonNegInt(t, PROGRESS_COUNTER_CURRENT_MAX)));
            }}
            keyboardType="number-pad"
            placeholder="0"
            placeholderTextColor={placeholderColor}
            style={[
              styles.numInput,
              { color: textColor, borderColor: placeholderColor, backgroundColor: surfaceLowest },
            ]}
          />
          <Pressable
            onPress={() => {
              const cap = Math.min(Math.max(draftTarget, 0), PROGRESS_COUNTER_CURRENT_MAX);
              setDraftCurrent(Math.min(cap, draftCurrent + 1));
            }}
            hitSlop={6}
            style={({ pressed }) => [styles.stepBtn, { opacity: pressed ? 0.7 : 1 }]}>
            <MaterialIcons name="add" size={16} color={outline} />
          </Pressable>
        </View>
      </View>

      <View style={styles.periodRow}>
        <Chip
          label="累计"
          active={draftPeriod === 'none'}
          primary={primary}
          outline={outline}
          surfaceLowest={surfaceLowest}
          onPress={() => setDraftPeriod('none')}
        />
        <Chip
          label="每周"
          active={draftPeriod === 'week'}
          primary={primary}
          outline={outline}
          surfaceLowest={surfaceLowest}
          onPress={() => setDraftPeriod('week')}
        />
      </View>

      <Pressable
        onPress={confirm}
        style={({ pressed }) => [styles.confirmBtn, { backgroundColor: primary, opacity: pressed ? 0.9 : 1 }]}>
        <Text style={styles.confirmBtnText}>添加</Text>
      </Pressable>
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
  sheetBody: { gap: 10, paddingBottom: 4 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sheetTitle: { fontSize: 16, fontWeight: '800' },
  sheetField: { gap: 6 },
  titleInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  confirmBtn: { marginTop: 4, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  list: { gap: 8 },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
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
    minWidth: 64,
    maxWidth: 140,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
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
  removeBtn: {
    marginLeft: 'auto',
    padding: 2,
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
