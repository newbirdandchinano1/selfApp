import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { formatMinutesAsHm, formatMinuteRangeLabel, snapToHourMinutes } from '@/lib/schedule/axis';
import type { ScheduleBreak, ScheduleSlotHours } from '@/lib/schedule/types';
import {
  SCHEDULE_BREAK_LABEL_MAX_LEN,
  SCHEDULE_BREAKS_MAX,
} from '@/lib/schedule/types';
import {
  getOrphanedPlacementCount,
  saveScheduleAxisWithRemap,
} from '@/lib/schedule-service';
import { getScheduleAxisSettings } from '@/lib/repositories/schedule/schedule-store';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type Props = {
  cardBg: string;
  cardBorder: string;
  text: string;
  outline: string;
  primary: string;
  /** 为 false 时不加载；弹窗打开时传 true 以刷新 */
  active?: boolean;
};

const SLOT_OPTIONS: ScheduleSlotHours[] = [1, 2, 3, 4];

type PickerTarget =
  | 'start'
  | 'end'
  | { kind: 'breakStart'; index: number }
  | { kind: 'breakEnd'; index: number };

/** 日开始：00:00–23:00；日结束：01:00–24:00（整点） */
function hourOptionsFor(target: PickerTarget): number[] {
  if (target === 'start' || (typeof target === 'object' && target.kind === 'breakStart')) {
    return Array.from({ length: 24 }, (_, h) => h * 60);
  }
  return Array.from({ length: 24 }, (_, i) => (i + 1) * 60);
}

export function FrogScheduleSettingsCard({
  cardBg,
  cardBorder,
  text,
  outline,
  primary,
  active = true,
}: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { logicalTodayYmd } = usePageDayBoundary('tasks');

  const [startMinutes, setStartMinutes] = React.useState(8 * 60);
  const [endMinutes, setEndMinutes] = React.useState(22 * 60);
  const [slotHours, setSlotHours] = React.useState<ScheduleSlotHours>(2);
  const [breaks, setBreaks] = React.useState<ScheduleBreak[]>([]);
  const [orphanedCount, setOrphanedCount] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  const [pickerTarget, setPickerTarget] = React.useState<PickerTarget | null>(null);

  const reload = React.useCallback(async () => {
    const axis = await getScheduleAxisSettings();
    setStartMinutes(axis.startMinutes);
    setEndMinutes(axis.endMinutes);
    setSlotHours(axis.slotHours);
    setBreaks(axis.breaks ?? []);
    setOrphanedCount(await getOrphanedPlacementCount());
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    if (!active) return;
    setLoaded(false);
    void reload();
  }, [active, reload]);

  const openPicker = (target: PickerTarget) => {
    setPickerTarget(target);
  };

  const pickHour = (mins: number) => {
    if (pickerTarget === 'start') {
      setStartMinutes(snapToHourMinutes(mins, { allow24: false }));
    } else if (pickerTarget === 'end') {
      setEndMinutes(snapToHourMinutes(mins, { allow24: true }));
    } else if (pickerTarget && typeof pickerTarget === 'object') {
      const { kind, index } = pickerTarget;
      setBreaks((prev) =>
        prev.map((b, i) => {
          if (i !== index) return b;
          if (kind === 'breakStart') {
            return { ...b, startMinutes: snapToHourMinutes(mins, { allow24: false }) };
          }
          return { ...b, endMinutes: snapToHourMinutes(mins, { allow24: true }) };
        }),
      );
    }
    setPickerTarget(null);
  };

  const addBreak = () => {
    if (breaks.length >= SCHEDULE_BREAKS_MAX) {
      Alert.alert('已达上限', `最多添加 ${SCHEDULE_BREAKS_MAX} 个断开时段。`);
      return;
    }
    const noon = 12 * 60;
    const defaultStart = Math.max(startMinutes, Math.min(noon, endMinutes - 60));
    const defaultEnd = Math.min(endMinutes, defaultStart + 2 * 60);
    setBreaks((prev) => [
      ...prev,
      { startMinutes: defaultStart, endMinutes: defaultEnd, label: '午休' },
    ]);
  };

  const removeBreak = (index: number) => {
    setBreaks((prev) => prev.filter((_, i) => i !== index));
  };

  const onSave = React.useCallback(async () => {
    setSaving(true);
    try {
      const result = await saveScheduleAxisWithRemap(
        {
          startMinutes: snapToHourMinutes(startMinutes, { allow24: false }),
          endMinutes: snapToHourMinutes(endMinutes, { allow24: true }),
          slotHours,
          breaks,
        },
        logicalTodayYmd,
      );
      if (!result.ok) {
        const detail =
          result.conflicts && result.conflicts.length > 0
            ? `\n\n冲突示例：\n${result.conflicts
                .slice(0, 3)
                .map((c) => c.reason)
                .join('\n')}`
            : '';
        Alert.alert('无法保存', `${result.error}${detail}`);
        return;
      }
      setOrphanedCount(result.orphanedCount);
      setStartMinutes(result.axis.startMinutes);
      setEndMinutes(result.axis.endMinutes);
      setSlotHours(result.axis.slotHours);
      setBreaks(result.axis.breaks ?? []);
      const remapHint =
        result.remappedCount > 0 ? `\n已重映射 ${result.remappedCount} 条占用。` : '';
      const orphanHint =
        result.orphanedCount > 0
          ? `\n有 ${result.orphanedCount} 条无法落入新格（含落入断开时段），已标为「未入格」。`
          : '';
      Alert.alert('已保存', `日程表时间轴已更新。${remapHint}${orphanHint}`);
      await reload();
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [startMinutes, endMinutes, slotHours, breaks, logicalTodayYmd, reload]);

  const pickerCardBg = isDark ? '#1e293b' : '#ffffff';
  const selectedMinutes = (() => {
    if (pickerTarget === 'end') return endMinutes;
    if (pickerTarget === 'start') return startMinutes;
    if (pickerTarget && typeof pickerTarget === 'object') {
      const b = breaks[pickerTarget.index];
      if (!b) return null;
      return pickerTarget.kind === 'breakEnd' ? b.endMinutes : b.startMinutes;
    }
    return null;
  })();
  const hourChoices = pickerTarget ? hourOptionsFor(pickerTarget) : [];
  const pickerTitle =
    pickerTarget === 'end'
      ? '日结束（整点）'
      : pickerTarget === 'start'
        ? '日开始（整点）'
        : pickerTarget && typeof pickerTarget === 'object' && pickerTarget.kind === 'breakEnd'
          ? '断开结束（整点）'
          : '断开开始（整点）';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <Text style={[styles.hint, { color: outline }]}>
        日开始 / 日结束仅可选整点。可添加断开时段（如午休），日程表中对应行呈灰色不可入格；格宽遇上断开会自动截断。落入断开的占用会标为「未入格」。
      </Text>

      {!loaded ? (
        <ActivityIndicator color={primary} style={{ marginVertical: 12 }} />
      ) : (
        <>
          <Pressable
            onPress={() => openPicker('start')}
            style={({ pressed }) => [
              styles.timeBtn,
              {
                borderColor: cardBorder,
                backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : '#f8fafc',
                opacity: pressed ? 0.88 : 1,
              },
            ]}>
            <MaterialIcons name="schedule" size={20} color={primary} />
            <Text style={[styles.timeLabel, { color: text }]}>日开始</Text>
            <Text style={[styles.timeValue, { color: text }]}>{formatMinutesAsHm(startMinutes)}</Text>
            <MaterialIcons name="chevron-right" size={20} color={outline} />
          </Pressable>

          <Pressable
            onPress={() => openPicker('end')}
            style={({ pressed }) => [
              styles.timeBtn,
              {
                borderColor: cardBorder,
                backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : '#f8fafc',
                opacity: pressed ? 0.88 : 1,
              },
            ]}>
            <MaterialIcons name="schedule" size={20} color={primary} />
            <Text style={[styles.timeLabel, { color: text }]}>日结束</Text>
            <Text style={[styles.timeValue, { color: text }]}>{formatMinutesAsHm(endMinutes)}</Text>
            <MaterialIcons name="chevron-right" size={20} color={outline} />
          </Pressable>

          <Text style={[styles.sectionLabel, { color: text }]}>格宽（小时）</Text>
          <View style={styles.slotRow}>
            {SLOT_OPTIONS.map((n) => {
              const on = slotHours === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => setSlotHours(n)}
                  style={[
                    styles.slotChip,
                    {
                      borderColor: on ? primary : cardBorder,
                      backgroundColor: on ? `${primary}18` : 'transparent',
                    },
                  ]}>
                  <Text style={{ color: on ? primary : text, fontWeight: '700' }}>{n}h</Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.breakHeader}>
            <Text style={[styles.sectionLabel, { color: text, marginTop: 0 }]}>断开时段</Text>
            <Pressable
              onPress={addBreak}
              hitSlop={8}
              style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
              <Text style={{ color: primary, fontWeight: '700', fontSize: 13 }}>添加</Text>
            </Pressable>
          </View>
          <Text style={[styles.breakHint, { color: outline }]}>
            例如 12:00–14:00 午休；最多 {SCHEDULE_BREAKS_MAX} 段，标签最多{' '}
            {SCHEDULE_BREAK_LABEL_MAX_LEN} 字。
          </Text>

          {breaks.length === 0 ? (
            <Text style={{ color: outline, fontSize: 13 }}>暂无断开，整天连续排格。</Text>
          ) : (
            breaks.map((b, index) => (
              <View
                key={`${b.startMinutes}-${b.endMinutes}-${index}`}
                style={[
                  styles.breakCard,
                  {
                    borderColor: cardBorder,
                    backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : '#f8fafc',
                  },
                ]}>
                <TextInput
                  value={b.label}
                  onChangeText={(t) =>
                    setBreaks((prev) =>
                      prev.map((x, i) =>
                        i === index
                          ? { ...x, label: t.replace(/\s+/g, '').slice(0, SCHEDULE_BREAK_LABEL_MAX_LEN) }
                          : x,
                      ),
                    )
                  }
                  placeholder="标签"
                  placeholderTextColor={outline}
                  style={[styles.breakLabelInput, { color: text, borderColor: cardBorder }]}
                />
                <View style={styles.breakTimeRow}>
                  <Pressable
                    onPress={() => openPicker({ kind: 'breakStart', index })}
                    style={[styles.breakTimeBtn, { borderColor: cardBorder }]}>
                    <Text style={{ color: text, fontWeight: '700' }}>
                      {formatMinutesAsHm(b.startMinutes)}
                    </Text>
                  </Pressable>
                  <Text style={{ color: outline }}>–</Text>
                  <Pressable
                    onPress={() => openPicker({ kind: 'breakEnd', index })}
                    style={[styles.breakTimeBtn, { borderColor: cardBorder }]}>
                    <Text style={{ color: text, fontWeight: '700' }}>
                      {formatMinutesAsHm(b.endMinutes)}
                    </Text>
                  </Pressable>
                  <Text style={{ color: outline, fontSize: 12, flex: 1 }}>
                    {formatMinuteRangeLabel(b.startMinutes, b.endMinutes)}
                  </Text>
                  <Pressable onPress={() => removeBreak(index)} hitSlop={8}>
                    <MaterialIcons name="delete-outline" size={20} color="#ef4444" />
                  </Pressable>
                </View>
              </View>
            ))
          )}

          {orphanedCount > 0 ? (
            <View
              style={[
                styles.orphanBanner,
                { backgroundColor: isDark ? 'rgba(248,113,113,0.12)' : '#fef2f2' },
              ]}>
              <MaterialIcons name="warning-amber" size={18} color="#ef4444" />
              <Text style={{ color: text, flex: 1, fontSize: 13, lineHeight: 18 }}>
                当前有 {orphanedCount} 条占用「未入格」。调整格宽、起止或断开后可再次尝试入格。
              </Text>
            </View>
          ) : null}

          <Pressable
            onPress={() => void onSave()}
            disabled={saving}
            style={({ pressed }) => [
              styles.saveBtn,
              { backgroundColor: primary, opacity: saving ? 0.6 : pressed ? 0.88 : 1 },
            ]}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.saveText}>保存日程表设置</Text>
            )}
          </Pressable>
        </>
      )}

      <Modal
        visible={pickerTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerTarget(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPickerTarget(null)} />
          <View style={[styles.modalCard, { backgroundColor: pickerCardBg }]}>
            <Text style={[styles.modalTitle, { color: text }]}>{pickerTitle}</Text>
            <Text style={[styles.modalHint, { color: outline }]}>仅可选整点</Text>
            <ScrollView
              style={styles.hourScroll}
              contentContainerStyle={styles.hourGrid}
              showsVerticalScrollIndicator={false}>
              {hourChoices.map((mins) => {
                const on = selectedMinutes === mins;
                return (
                  <Pressable
                    key={mins}
                    onPress={() => pickHour(mins)}
                    style={[
                      styles.hourChip,
                      {
                        borderColor: on ? primary : cardBorder,
                        backgroundColor: on ? `${primary}18` : 'transparent',
                      },
                    ]}>
                    <Text
                      style={{
                        color: on ? primary : text,
                        fontWeight: '800',
                        fontVariant: ['tabular-nums'],
                      }}>
                      {formatMinutesAsHm(mins)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable onPress={() => setPickerTarget(null)} style={styles.modalCancel}>
              <Text style={{ color: outline, fontWeight: '700' }}>取消</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 10,
  },
  hint: { fontSize: 12, lineHeight: 18 },
  timeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  timeLabel: { fontSize: 14, fontWeight: '600', flex: 1 },
  timeValue: { fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  sectionLabel: { fontSize: 14, fontWeight: '600', marginTop: 4 },
  slotRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  slotChip: {
    minWidth: 52,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  breakHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  breakHint: { fontSize: 12, lineHeight: 17, marginTop: -4 },
  breakCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 8,
  },
  breakLabelInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  breakTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  breakTimeBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  orphanBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 10,
    borderRadius: 10,
  },
  saveBtn: {
    marginTop: 4,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  modalRoot: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  modalCard: {
    borderRadius: 16,
    padding: 16,
    gap: 8,
    maxHeight: '72%',
    overflow: 'hidden',
  },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  modalHint: { fontSize: 12, lineHeight: 17, marginBottom: 4 },
  hourScroll: { maxHeight: 320 },
  hourGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
  },
  hourChip: {
    width: '22%',
    minWidth: 64,
    flexGrow: 1,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancel: {
    alignSelf: 'flex-end',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
});
