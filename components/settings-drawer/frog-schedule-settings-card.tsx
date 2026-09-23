import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { formatMinutesAsHm } from '@/lib/schedule/axis';
import type { ScheduleSlotHours } from '@/lib/schedule/types';
import {
  getOrphanedPlacementCount,
  saveScheduleAxisWithRemap,
} from '@/lib/schedule-service';
import { getScheduleAxisSettings } from '@/lib/repositories/schedule/schedule-store';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Props = {
  cardBg: string;
  cardBorder: string;
  text: string;
  outline: string;
  primary: string;
};

const SLOT_OPTIONS: ScheduleSlotHours[] = [1, 2, 3, 4];

type PickerTarget = 'start' | 'end';

function minutesToDate(minutes: number): Date {
  const m = ((Math.round(minutes) % (24 * 60)) + 24 * 60) % (24 * 60);
  return new Date(2000, 0, 1, Math.floor(m / 60), m % 60, 0, 0);
}

function dateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

export function FrogScheduleSettingsCard({
  cardBg,
  cardBorder,
  text,
  outline,
  primary,
}: Props) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const { logicalTodayYmd } = usePageDayBoundary('tasks');

  const [startMinutes, setStartMinutes] = React.useState(8 * 60);
  const [endMinutes, setEndMinutes] = React.useState(22 * 60);
  const [slotHours, setSlotHours] = React.useState<ScheduleSlotHours>(2);
  const [orphanedCount, setOrphanedCount] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  const [pickerTarget, setPickerTarget] = React.useState<PickerTarget | null>(null);
  const [draftMinutes, setDraftMinutes] = React.useState(8 * 60);

  const reload = React.useCallback(async () => {
    const axis = await getScheduleAxisSettings();
    setStartMinutes(axis.startMinutes);
    setEndMinutes(axis.endMinutes);
    setSlotHours(axis.slotHours);
    setOrphanedCount(await getOrphanedPlacementCount());
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const openPicker = (target: PickerTarget) => {
    setDraftMinutes(target === 'start' ? startMinutes : endMinutes);
    setPickerTarget(target);
  };

  const confirmPicker = () => {
    if (pickerTarget === 'start') setStartMinutes(draftMinutes);
    if (pickerTarget === 'end') setEndMinutes(draftMinutes);
    setPickerTarget(null);
  };

  const onAndroidTimeChange = (_: unknown, date?: Date) => {
    // Android default display closes itself after one change
    if (Platform.OS === 'android') {
      const target = pickerTarget;
      setPickerTarget(null);
      if (!date || !target) return;
      const mins = dateToMinutes(date);
      if (target === 'start') setStartMinutes(mins);
      else setEndMinutes(mins);
      return;
    }
    if (date) setDraftMinutes(dateToMinutes(date));
  };

  const onSave = React.useCallback(async () => {
    setSaving(true);
    try {
      const result = await saveScheduleAxisWithRemap(
        { startMinutes, endMinutes, slotHours },
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
      const remapHint =
        result.remappedCount > 0 ? `\n已重映射 ${result.remappedCount} 条占用。` : '';
      const orphanHint =
        result.orphanedCount > 0
          ? `\n有 ${result.orphanedCount} 条无法落入新格，已标为「未入格」（数据未删除）。`
          : '';
      Alert.alert('已保存', `课程表时间轴已更新。${remapHint}${orphanHint}`);
      await reload();
    } catch (err) {
      Alert.alert('保存失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [startMinutes, endMinutes, slotHours, logicalTodayYmd, reload]);

  const pickerCardBg = isDark ? '#1e293b' : '#ffffff';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <Text style={[styles.hint, { color: outline }]}>
        全周统一日开始 / 日结束 / 格宽。历史周使用当时快照，不受新设置影响。改格宽会对本周及未来已有占用按开始时间重映射；改起止若会裁掉占用则禁止保存。
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
              const active = slotHours === n;
              return (
                <Pressable
                  key={n}
                  onPress={() => setSlotHours(n)}
                  style={[
                    styles.slotChip,
                    {
                      borderColor: active ? primary : cardBorder,
                      backgroundColor: active ? `${primary}18` : 'transparent',
                    },
                  ]}>
                  <Text style={{ color: active ? primary : text, fontWeight: '700' }}>{n}h</Text>
                </Pressable>
              );
            })}
          </View>

          {orphanedCount > 0 ? (
            <View
              style={[
                styles.orphanBanner,
                { backgroundColor: isDark ? 'rgba(248,113,113,0.12)' : '#fef2f2' },
              ]}>
              <MaterialIcons name="warning-amber" size={18} color="#ef4444" />
              <Text style={{ color: text, flex: 1, fontSize: 13, lineHeight: 18 }}>
                当前有 {orphanedCount} 条占用「未入格」。调整格宽或起止后可再次尝试入格；数据不会静默丢失。
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
              <Text style={styles.saveText}>保存课程表设置</Text>
            )}
          </Pressable>
        </>
      )}

      {/* Android：系统时间弹层；iOS：底部确认弹层 */}
      {Platform.OS === 'android' && pickerTarget != null ? (
        <DateTimePicker
          value={minutesToDate(draftMinutes)}
          mode="time"
          is24Hour
          display="default"
          onChange={onAndroidTimeChange}
        />
      ) : null}

      <Modal
        visible={Platform.OS === 'ios' && pickerTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerTarget(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setPickerTarget(null)} />
          <View style={[styles.modalCard, { backgroundColor: pickerCardBg }]}>
            <Text style={[styles.modalTitle, { color: text }]}>
              {pickerTarget === 'end' ? '日结束时间' : '日开始时间'}
            </Text>
            <DateTimePicker
              value={minutesToDate(draftMinutes)}
              mode="time"
              is24Hour
              display="spinner"
              themeVariant={isDark ? 'dark' : 'light'}
              onChange={(_, date) => {
                if (date) setDraftMinutes(dateToMinutes(date));
              }}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setPickerTarget(null)}>
                <Text style={{ color: outline, fontWeight: '700' }}>取消</Text>
              </Pressable>
              <Pressable onPress={confirmPicker}>
                <Text style={{ color: primary, fontWeight: '800' }}>确定</Text>
              </Pressable>
            </View>
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
    opacity: 1,
    overflow: 'hidden',
  },
  modalTitle: { fontSize: 17, fontWeight: '800' },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 20,
    marginTop: 8,
    paddingTop: 4,
  },
});
