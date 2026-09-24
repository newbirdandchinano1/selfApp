import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { resolveAcceptanceCriteria } from '@/lib/acceptance-criteria';
import { isFrogSubjectDeleted } from '@/lib/repositories/tasks/frog-completion-events';
import type { ScheduleBreak, SchedulePlacementRow } from '@/lib/schedule/types';
import {
  formatMinutesAsHm,
  placementEndMinutes,
  slotStartMinutes,
} from '@/lib/schedule/axis';
import { ymdForWeekday } from '@/lib/schedule/week';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type ScheduleSubjectInfo = {
  kind: 'task' | 'project';
  id: string;
  title: string;
  priority: number;
  dueDate: string | null;
  acceptanceCriteria: string;
  projectName: string | null;
  extraData: string | null;
  status: string;
  done: boolean;
  deletedSnapshot: boolean;
};

type Axis = {
  startMinutes: number;
  endMinutes: number;
  slotHours: number;
  breaks?: ScheduleBreak[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  placement: SchedulePlacementRow | null;
  axis: Axis;
  subject: ScheduleSubjectInfo | null;
  editable: boolean;
  onToggleDone: () => void;
  onRemoveSegment: () => void;
  onCancelAssign: () => void;
  onEdit: () => void;
};

function priorityLabel(p: number): string {
  if (p >= 4) return '紧急重要';
  if (p === 3) return '紧急不重要';
  if (p === 2) return '不紧急重要';
  if (p === 1) return '不紧急不重要';
  return '未设优先级';
}

export function SchedulePlacementDetailSheet({
  visible,
  onClose,
  placement,
  axis,
  subject,
  editable,
  onToggleDone,
  onRemoveSegment,
  onCancelAssign,
  onEdit,
}: Props) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const primary = theme.primary;
  const outline = theme.textSecondary;
  const surface = isDark ? '#1e293b' : '#fff';
  const deleted = subject?.deletedSnapshot || isFrogSubjectDeleted(subject?.extraData ?? null);
  const readOnly = !editable || deleted;

  const timeLabel = React.useMemo(() => {
    if (!placement || placement.startSlotIndex == null) return '未入格';
    const start = slotStartMinutes(axis, placement.startSlotIndex);
    const end = placementEndMinutes(axis, placement.startSlotIndex, placement.spanSlots);
    return `${formatMinutesAsHm(start)} – ${formatMinutesAsHm(end)} · ${placement.spanSlots} 格`;
  }, [placement, axis]);

  const assignYmd = placement
    ? ymdForWeekday(placement.weekStartYmd, placement.weekday)
    : '';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: surface,
              paddingBottom: Math.max(insets.bottom, 16),
              borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(203,213,225,0.9)',
            },
          ]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
              {subject?.title ?? '青蛙详情'}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <MaterialIcons name="close" size={22} color={outline} />
            </Pressable>
          </View>

          <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
            <View style={styles.metaBlock}>
              <Text style={[styles.metaLine, { color: outline }]}>指派日 {assignYmd}</Text>
              <Text style={[styles.metaLine, { color: outline }]}>时段 {timeLabel}</Text>
              <Text style={[styles.metaLine, { color: outline }]}>
                优先级 {priorityLabel(subject?.priority ?? 0)}
              </Text>
              {subject?.dueDate ? (
                <Text style={[styles.metaLine, { color: outline }]}>截止 {subject.dueDate}</Text>
              ) : null}
              {subject?.projectName ? (
                <Text style={[styles.metaLine, { color: outline }]}>
                  所属项目 {subject.projectName}
                </Text>
              ) : null}
              {deleted ? (
                <Text style={[styles.metaLine, { color: theme.danger }]}>
                  主体已删除（只读快照）
                </Text>
              ) : null}
            </View>

            <Text style={[styles.sectionLabel, { color: outline }]}>验收标准</Text>
            <Text style={{ color: theme.text, lineHeight: 20, marginBottom: 14 }}>
              {(subject?.acceptanceCriteria || '').trim() || '未填写'}
            </Text>
          </ScrollView>

          <View style={styles.actions}>
            {!deleted ? (
              <Pressable
                disabled={readOnly}
                onPress={onToggleDone}
                style={[styles.actionBtn, { borderColor: `${primary}55`, opacity: readOnly ? 0.4 : 1 }]}>
                <MaterialIcons
                  name={subject?.done ? 'undo' : 'check-circle'}
                  size={18}
                  color={primary}
                />
                <Text style={{ color: primary, fontWeight: '700' }}>
                  {subject?.done ? '取消完成' : '完成'}
                </Text>
              </Pressable>
            ) : null}

            <Pressable
              disabled={readOnly}
              onPress={() => {
                Alert.alert('从本格段移除', '仅删除这一段占用；若该日已无其它占用将取消当日指派。', [
                  { text: '取消', style: 'cancel' },
                  { text: '移除', style: 'destructive', onPress: onRemoveSegment },
                ]);
              }}
              style={[styles.actionBtn, { borderColor: `${outline}55`, opacity: readOnly ? 0.4 : 1 }]}>
              <MaterialIcons name="remove-circle-outline" size={18} color={outline} />
              <Text style={{ color: theme.text, fontWeight: '600' }}>从本格段移除</Text>
            </Pressable>

            <Pressable
              disabled={readOnly}
              onPress={() => {
                Alert.alert('取消指派', '将去掉该日全部占用并取消该日青蛙指派（其它日保留）。', [
                  { text: '保留', style: 'cancel' },
                  { text: '取消指派', style: 'destructive', onPress: onCancelAssign },
                ]);
              }}
              style={[styles.actionBtn, { borderColor: `${outline}55`, opacity: readOnly ? 0.4 : 1 }]}>
              <MaterialIcons name="link-off" size={18} color={outline} />
              <Text style={{ color: theme.text, fontWeight: '600' }}>取消指派（整日）</Text>
            </Pressable>

            <Pressable
              disabled={deleted}
              onPress={onEdit}
              style={[styles.actionBtn, { borderColor: `${primary}55`, opacity: deleted ? 0.4 : 1 }]}>
              <MaterialIcons name="edit" size={18} color={primary} />
              <Text style={{ color: primary, fontWeight: '700' }}>跳转编辑</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** 供外部组装 subject 信息时复用 */
export function buildAcceptance(description: string | null, note: string | null): string {
  return resolveAcceptanceCriteria(description, note);
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 4,
  },
  title: { fontSize: 17, fontWeight: '700', flex: 1 },
  metaBlock: { gap: 4, marginBottom: 10 },
  metaLine: { fontSize: 13, lineHeight: 18 },
  sectionLabel: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  actions: { gap: 8, marginTop: 4 },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
});
