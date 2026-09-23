import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { resolveAcceptanceCriteria } from '@/lib/acceptance-criteria';
import { assignFrogForDay, fetchFrogCandidates, type FrogCandidate } from '@/lib/frog-candidates-api';
import { isFrogAssignedOn } from '@/lib/frog-assignment';
import { isProjectEligibleAsFrog } from '@/lib/project-frog';
import type { ProjectLockInfo } from '@/lib/repositories/projects/project-prerequisites';
import type { ProjectTagRow } from '@/lib/repositories/projects/project-tag.types';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { parseRewardPointsFromExtraData } from '@/lib/reward-points';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AssignFrogSubject = {
  kind: 'task' | 'project';
  id: string;
  title: string;
  priority: number;
  dueDate: string | null;
  acceptanceCriteria: string;
  rewardPoints: number;
  projectName: string | null;
  tagNames: string[];
  blockedReason: string | null;
  extraData: string | null;
};

export type AssignFrogSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** pick：栏内轻量入口选对象；direct：长按已定对象 */
  mode: 'pick' | 'direct';
  subject: AssignFrogSubject | null;
  defaultYmd: string;
  lockedProjectIds?: Set<string>;
  projectLockMap?: Map<string, ProjectLockInfo>;
  onAssigned?: (assignYmd: string) => void;
};

function formatPriority(priority: number): string {
  if (priority >= 4) return '紧急重要';
  if (priority === 3) return '紧急不重要';
  if (priority === 2) return '不紧急重要';
  if (priority === 1) return '不紧急不重要';
  return '未设优先级';
}

function ymdToDate(ymd: string): Date {
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return new Date();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function dateToYmd(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

export function buildSubjectFromTask(
  task: TaskRow,
  opts?: {
    projectName?: string | null;
    tags?: ProjectTagRow[];
    blockedReason?: string | null;
  },
): AssignFrogSubject {
  return {
    kind: 'task',
    id: task.id,
    title: task.title,
    priority: task.priority ?? 0,
    dueDate: task.due_date?.slice(0, 10) ?? null,
    acceptanceCriteria: resolveAcceptanceCriteria(task.description, task.note),
    rewardPoints: parseRewardPointsFromExtraData(task.extra_data),
    projectName: opts?.projectName ?? null,
    tagNames: (opts?.tags ?? []).map((t) => t.name).filter(Boolean),
    blockedReason: opts?.blockedReason ?? null,
    extraData: task.extra_data,
  };
}

export function buildSubjectFromProject(
  project: ProjectRow,
  opts?: {
    tags?: ProjectTagRow[];
    taskCount?: number;
    locked?: boolean;
    lockInfo?: ProjectLockInfo | null;
  },
): AssignFrogSubject {
  const taskCount = opts?.taskCount ?? 0;
  const locked = opts?.locked ?? false;
  let blockedReason: string | null = null;
  if (!isProjectEligibleAsFrog(project, taskCount, locked)) {
    if (taskCount > 0) blockedReason = '有子任务的项目请指派具体任务';
    else if (locked && opts?.lockInfo?.unmetPrerequisiteNames?.length) {
      blockedReason = `等待前置：${opts.lockInfo.unmetPrerequisiteNames.join('、')}`;
    } else if (locked && opts?.lockInfo?.scheduleNotStarted) {
      blockedReason = opts.lockInfo.scheduleStartYmd
        ? `计划尚未开始（${opts.lockInfo.scheduleStartYmd}）`
        : '计划尚未开始';
    } else if (project.status !== 'active') blockedReason = '项目非活跃状态';
    else blockedReason = '收集箱项目不可指派为青蛙';
  }
  return {
    kind: 'project',
    id: project.id,
    title: project.name,
    priority: project.priority ?? 0,
    dueDate: project.due_date?.slice(0, 10) ?? null,
    acceptanceCriteria: resolveAcceptanceCriteria(null, project.note),
    rewardPoints: parseRewardPointsFromExtraData(project.extra_data),
    projectName: project.name,
    tagNames: (opts?.tags ?? []).map((t) => t.name).filter(Boolean),
    blockedReason,
    extraData: project.extra_data,
  };
}

function candidateToSubject(item: FrogCandidate): AssignFrogSubject {
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    priority: item.priority,
    dueDate: item.dueDate,
    acceptanceCriteria: item.acceptanceCriteria,
    rewardPoints: item.rewardPoints,
    projectName: item.projectName,
    tagNames: item.tagNames ?? [],
    blockedReason: item.blockedReason,
    extraData: null,
  };
}

export function AssignFrogSheet({
  visible,
  onClose,
  mode,
  subject,
  defaultYmd,
  lockedProjectIds,
  onAssigned,
}: AssignFrogSheetProps) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const primary = theme.primary;
  const outline = theme.textSecondary;
  const surface = isDark ? '#1e293b' : '#fff';
  const surfaceLow = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(241,245,249,0.95)';

  const [assignYmd, setAssignYmd] = React.useState(defaultYmd);
  const [showPicker, setShowPicker] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [loadingCandidates, setLoadingCandidates] = React.useState(false);
  const [candidates, setCandidates] = React.useState<FrogCandidate[]>([]);
  const [picked, setPicked] = React.useState<AssignFrogSubject | null>(null);

  const activeSubject = mode === 'direct' ? subject : picked;

  React.useEffect(() => {
    if (!visible) return;
    setAssignYmd(defaultYmd);
    setPicked(null);
    setShowPicker(false);
  }, [visible, defaultYmd, subject?.id, mode]);

  React.useEffect(() => {
    if (!visible || mode !== 'pick') return;
    let cancelled = false;
    setLoadingCandidates(true);
    void fetchFrogCandidates({ assignYmd })
      .then((res) => {
        if (cancelled) return;
        const locked = lockedProjectIds ?? new Set<string>();
        const filtered = res.items.filter((it) => {
          if (it.alreadyAssigned) return false;
          if (it.blockedReason) return false;
          if (it.kind === 'task' && it.projectId && locked.has(it.projectId)) return false;
          if (it.kind === 'project' && locked.has(it.id)) return false;
          return true;
        });
        setCandidates(filtered);
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, mode, assignYmd, lockedProjectIds]);

  const alreadyAssigned =
    !!activeSubject &&
    (activeSubject.extraData
      ? isFrogAssignedOn(activeSubject.extraData, assignYmd)
      : false);

  const canAssign =
    !!activeSubject && !activeSubject.blockedReason && !alreadyAssigned && !saving;

  const onConfirm = React.useCallback(async () => {
    if (!activeSubject || !canAssign) return;
    setSaving(true);
    try {
      await assignFrogForDay({
        kind: activeSubject.kind,
        id: activeSubject.id,
        assignYmd,
      });
      onAssigned?.(assignYmd);
      onClose();
    } catch (err) {
      console.warn('指派青蛙失败', err);
      Alert.alert('指派失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [activeSubject, canAssign, assignYmd, onAssigned, onClose]);

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
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: outline }]} />
          </View>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>添加青蛙</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="关闭">
              <MaterialIcons name="close" size={22} color={outline} />
            </Pressable>
          </View>

          <Pressable
            onPress={() => setShowPicker(true)}
            style={[styles.dateRow, { backgroundColor: surfaceLow }]}>
            <MaterialIcons name="event" size={20} color={primary} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.dateLabel, { color: outline }]}>指派日期</Text>
              <Text style={[styles.dateValue, { color: theme.text }]}>{assignYmd}</Text>
            </View>
            <Text style={[styles.dateHint, { color: primary }]}>更改</Text>
          </Pressable>

          {showPicker ? (
            <DateTimePicker
              value={ymdToDate(assignYmd)}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={(_, date) => {
                if (Platform.OS !== 'ios') setShowPicker(false);
                if (date) setAssignYmd(dateToYmd(date));
              }}
            />
          ) : null}
          {showPicker && Platform.OS === 'ios' ? (
            <Pressable onPress={() => setShowPicker(false)} style={styles.iosPickerDone}>
              <Text style={{ color: primary, fontWeight: '700' }}>完成选日</Text>
            </Pressable>
          ) : null}

          {mode === 'pick' && !picked ? (
            <View style={styles.pickBlock}>
              <Text style={[styles.sectionLabel, { color: outline }]}>选择项目或任务</Text>
              {loadingCandidates ? (
                <ActivityIndicator color={primary} style={{ marginVertical: 24 }} />
              ) : candidates.length === 0 ? (
                <Text style={[styles.emptyText, { color: outline }]}>
                  当日暂无可指派项。也可长按项目列表中的项目或任务添加。
                </Text>
              ) : (
                <ScrollView style={styles.candidateList} nestedScrollEnabled>
                  {candidates.slice(0, 40).map((item) => (
                    <Pressable
                      key={`${item.kind}-${item.id}`}
                      onPress={() => setPicked(candidateToSubject(item))}
                      style={({ pressed }) => [
                        styles.candidateRow,
                        { backgroundColor: surfaceLow, opacity: pressed ? 0.85 : 1 },
                      ]}>
                      <MaterialIcons
                        name={item.kind === 'project' ? 'folder-special' : 'eco'}
                        size={18}
                        color={primary}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.candidateTitle, { color: theme.text }]} numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Text style={[styles.candidateMeta, { color: outline }]} numberOfLines={1}>
                          {item.kind === 'project' ? '项目' : item.projectName || '待办'} ·{' '}
                          {formatPriority(item.priority)}
                        </Text>
                      </View>
                      <MaterialIcons name="chevron-right" size={20} color={outline} />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          ) : activeSubject ? (
            <ScrollView style={styles.metaScroll} nestedScrollEnabled>
              {mode === 'pick' ? (
                <Pressable onPress={() => setPicked(null)} style={styles.backPick}>
                  <MaterialIcons name="arrow-back" size={16} color={primary} />
                  <Text style={{ color: primary, fontWeight: '700' }}>重选对象</Text>
                </Pressable>
              ) : null}
              <Text style={[styles.subjectTitle, { color: theme.text }]}>{activeSubject.title}</Text>
              <View style={styles.chipRow}>
                {activeSubject.tagNames.map((tag) => (
                  <View key={tag} style={[styles.chip, { borderColor: `${primary}44`, backgroundColor: `${primary}12` }]}>
                    <Text style={[styles.chipText, { color: primary }]}>{tag}</Text>
                  </View>
                ))}
                <View style={[styles.chip, { borderColor: `${outline}55`, backgroundColor: surfaceLow }]}>
                  <MaterialIcons name="flag" size={12} color={outline} />
                  <Text style={[styles.chipText, { color: outline }]}>
                    {formatPriority(activeSubject.priority)}
                  </Text>
                </View>
                {activeSubject.dueDate ? (
                  <View style={[styles.chip, { borderColor: `${outline}55`, backgroundColor: surfaceLow }]}>
                    <MaterialIcons name="schedule" size={12} color={outline} />
                    <Text style={[styles.chipText, { color: outline }]}>{activeSubject.dueDate}</Text>
                  </View>
                ) : null}
                {activeSubject.rewardPoints !== 0 ? (
                  <View style={[styles.chip, { borderColor: `${outline}55`, backgroundColor: surfaceLow }]}>
                    <MaterialIcons name="stars" size={12} color={outline} />
                    <Text style={[styles.chipText, { color: outline }]}>
                      {activeSubject.rewardPoints} 积分
                    </Text>
                  </View>
                ) : null}
              </View>
              {activeSubject.projectName && activeSubject.kind === 'task' ? (
                <Text style={[styles.metaLine, { color: outline }]}>
                  所属项目：{activeSubject.projectName}
                </Text>
              ) : null}
              <Text style={[styles.sectionLabel, { color: outline, marginTop: 12 }]}>验收标准</Text>
              <Text style={[styles.acceptance, { color: theme.text }]}>
                {activeSubject.acceptanceCriteria || '暂无验收标准'}
              </Text>
              {activeSubject.blockedReason ? (
                <Text style={[styles.blocked, { color: '#ba1a1a' }]}>{activeSubject.blockedReason}</Text>
              ) : alreadyAssigned ? (
                <Text style={[styles.blocked, { color: outline }]}>该日已指派为青蛙</Text>
              ) : null}
            </ScrollView>
          ) : null}

          <Pressable
            onPress={() => void onConfirm()}
            disabled={!canAssign}
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                backgroundColor: canAssign ? primary : outline,
                opacity: !canAssign ? 0.45 : pressed ? 0.88 : 1,
              },
            ]}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialIcons name="eco" size={18} color="#fff" />
                <Text style={styles.confirmText}>添加青蛙</Text>
              </>
            )}
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15,23,42,0.45)',
  },
  sheet: {
    maxHeight: '88%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  handleRow: { alignItems: 'center', paddingVertical: 4 },
  handle: { width: 40, height: 4, borderRadius: 2, opacity: 0.35 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 18, fontWeight: '800' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dateLabel: { fontSize: 11, fontWeight: '600' },
  dateValue: { fontSize: 16, fontWeight: '800', marginTop: 2 },
  dateHint: { fontSize: 13, fontWeight: '700' },
  iosPickerDone: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 8 },
  pickBlock: { minHeight: 160, maxHeight: 320 },
  sectionLabel: { fontSize: 12, fontWeight: '700', marginBottom: 8 },
  emptyText: { fontSize: 13, lineHeight: 20, paddingVertical: 12 },
  candidateList: { maxHeight: 280 },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 8,
  },
  candidateTitle: { fontSize: 14, fontWeight: '700' },
  candidateMeta: { fontSize: 11, marginTop: 2 },
  metaScroll: { maxHeight: 280 },
  backPick: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 8 },
  subjectTitle: { fontSize: 17, fontWeight: '800', marginBottom: 10 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: { fontSize: 11, fontWeight: '700' },
  metaLine: { fontSize: 12, marginTop: 8 },
  acceptance: { fontSize: 13, lineHeight: 20, fontWeight: '500' },
  blocked: { marginTop: 10, fontSize: 13, fontWeight: '700' },
  confirmBtn: {
    marginTop: 4,
    borderRadius: 14,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  confirmText: { color: '#fff', fontSize: 15, fontWeight: '800' },
});
