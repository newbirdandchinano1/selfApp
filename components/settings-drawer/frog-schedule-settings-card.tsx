import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import {
  formatMinutesAsHm,
  parseHmToMinutes,
} from '@/lib/schedule/axis';
import type { ScheduleSlotHours } from '@/lib/schedule/types';
import {
  getOrphanedPlacementCount,
  saveScheduleAxisWithRemap,
} from '@/lib/schedule-service';
import {
  getScheduleAxisSettings,
} from '@/lib/repositories/schedule/schedule-store';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
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
};

const SLOT_OPTIONS: ScheduleSlotHours[] = [1, 2, 3, 4];

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

  const [startHm, setStartHm] = React.useState('08:00');
  const [endHm, setEndHm] = React.useState('22:00');
  const [slotHours, setSlotHours] = React.useState<ScheduleSlotHours>(2);
  const [orphanedCount, setOrphanedCount] = React.useState(0);
  const [saving, setSaving] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);

  const reload = React.useCallback(async () => {
    const axis = await getScheduleAxisSettings();
    setStartHm(formatMinutesAsHm(axis.startMinutes));
    setEndHm(formatMinutesAsHm(axis.endMinutes));
    setSlotHours(axis.slotHours);
    setOrphanedCount(await getOrphanedPlacementCount());
    setLoaded(true);
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const onSave = React.useCallback(async () => {
    const startMinutes = parseHmToMinutes(startHm);
    const endMinutes = parseHmToMinutes(endHm);
    if (startMinutes == null || endMinutes == null) {
      Alert.alert('格式错误', '请使用 HH:MM，例如 08:00');
      return;
    }
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
  }, [startHm, endHm, slotHours, logicalTodayYmd, reload]);

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <Text style={[styles.hint, { color: outline }]}>
        全周统一日开始 / 日结束 / 格宽。历史周使用当时快照，不受新设置影响。改格宽会对本周及未来已有占用按开始时间重映射；改起止若会裁掉占用则禁止保存。
      </Text>

      {!loaded ? (
        <ActivityIndicator color={primary} style={{ marginVertical: 12 }} />
      ) : (
        <>
          <View style={styles.row}>
            <Text style={[styles.label, { color: text }]}>日开始</Text>
            <TextInput
              value={startHm}
              onChangeText={setStartHm}
              placeholder="08:00"
              placeholderTextColor={outline}
              style={[
                styles.input,
                {
                  color: text,
                  borderColor: cardBorder,
                  backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : '#f8fafc',
                },
              ]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <View style={styles.row}>
            <Text style={[styles.label, { color: text }]}>日结束</Text>
            <TextInput
              value={endHm}
              onChangeText={setEndHm}
              placeholder="22:00"
              placeholderTextColor={outline}
              style={[
                styles.input,
                {
                  color: text,
                  borderColor: cardBorder,
                  backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : '#f8fafc',
                },
              ]}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <Text style={[styles.label, { color: text, marginTop: 4 }]}>格宽（小时）</Text>
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
            <View style={[styles.orphanBanner, { backgroundColor: isDark ? 'rgba(248,113,113,0.12)' : '#fef2f2' }]}>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: { fontSize: 14, fontWeight: '600', width: 64 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
  },
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
});
