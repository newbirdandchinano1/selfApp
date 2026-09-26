import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type EntityFormScheduleFieldProps = {
  deadlineText: string;
  reminderText: string;
  repeatText: string;
  onPress: () => void;
  locked?: boolean;
  /** 锁定时展示文案前缀，默认「与项目一致」 */
  lockedPrefix?: string;
  label?: string;
};

/**
 * 各表单共用的「时间安排」行（点击打开 schedule-picker）。
 */
export function EntityFormScheduleField({
  deadlineText,
  reminderText,
  repeatText,
  onPress,
  locked = false,
  lockedPrefix = '与项目一致',
  label = '时间安排',
}: EntityFormScheduleFieldProps) {
  const { colors, isDark } = useAppTheme();
  const fieldBg = isDark ? 'rgba(15,23,42,0.45)' : colors.input;

  const valueText = locked
    ? `${lockedPrefix}：${deadlineText || '未设置'}`
    : deadlineText || '未设置';

  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.scheduleRow,
        {
          backgroundColor: fieldBg,
          opacity: pressed && !locked ? 0.85 : 1,
        },
      ]}>
      <View style={[styles.scheduleIcon, { backgroundColor: colors.surfaceSubtle }]}>
        <MaterialIcons name="event-note" size={20} color={colors.primary} />
      </View>
      <View style={styles.scheduleBody}>
        <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
        <Text style={[styles.fieldValue, { color: colors.text }]}>{valueText}</Text>
        {!!(reminderText || repeatText) && (
          <View style={styles.tagRow}>
            {!!reminderText && (
              <View
                style={[
                  styles.metaTag,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline },
                ]}>
                <MaterialIcons name="notifications-active" size={13} color={colors.primary} />
                <Text style={[styles.metaTagText, { color: colors.text }]}>{reminderText}</Text>
              </View>
            )}
            {!!repeatText && (
              <View
                style={[
                  styles.metaTag,
                  { backgroundColor: colors.surfaceSubtle, borderColor: colors.outline },
                ]}>
                <MaterialIcons name="repeat" size={13} color={colors.primary} />
                <Text style={[styles.metaTagText, { color: colors.text }]}>{repeatText}</Text>
              </View>
            )}
          </View>
        )}
      </View>
      {locked ? null : <MaterialIcons name="chevron-right" size={20} color={colors.textSecondary} />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  scheduleIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleBody: { flex: 1, gap: 4, minWidth: 0 },
  fieldLabel: { fontSize: 12, fontWeight: '600' },
  fieldValue: { fontSize: 14, fontWeight: '600' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  metaTag: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 3,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaTagText: { fontSize: 11, fontWeight: '600' },
});
