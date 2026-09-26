import { Colors } from '@/constants/theme';
import { getTaskPriorityTone } from '@/constants/design-tokens';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchFrogCandidates, type FrogCandidate } from '@/lib/frog-candidates-api';
import { DEFAULT_PROJECT_TAG_COLOR } from '@/lib/repositories/projects/project-tag.types';
import { getProjectTags } from '@/lib/repositories/projects/project-tag';
import type { ScheduleSubjectKind } from '@/lib/schedule/types';
import { isTaskDueOverdue } from '@/lib/standalone-todo-visibility';
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
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SchedulePlaceResult = {
  kind: ScheduleSubjectKind;
  id: string;
  title: string;
  spanSlots: number;
  assignYmd: string;
};

export type SchedulePlaceTag = { name: string; color: string };

/** 从项目列表长按等入口预选主体时，跳过候选列表直接选格数 */
export type SchedulePlacePreselected = {
  kind: ScheduleSubjectKind;
  id: string;
  title: string;
  priority?: number;
  dueDate?: string | null;
  acceptanceCriteria?: string;
  rewardPoints?: number;
  projectId?: string | null;
  projectName?: string | null;
  tagNames?: string[];
  tags?: SchedulePlaceTag[];
  isOverdue?: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  assignYmd: string;
  maxSpan: number;
  lockedProjectIds?: Set<string>;
  /** 已选定主体时跳过列表，只选占用格数 */
  preselected?: SchedulePlacePreselected | null;
  onConfirm: (result: SchedulePlaceResult) => Promise<void> | void;
};

type DisplayCandidate = FrogCandidate & {
  tags: SchedulePlaceTag[];
  isOverdue: boolean;
};

function priorityLabel(p: number): string {
  if (p >= 4) return '紧急重要';
  if (p === 3) return '紧急不重要';
  if (p === 2) return '不紧急重要';
  if (p === 1) return '不紧急不重要';
  return '未设优先级';
}

function kindLabel(c: Pick<DisplayCandidate, 'kind' | 'projectId'>): string {
  if (c.kind === 'project') return '项目';
  if (!c.projectId) return '待办';
  return '任务';
}

function resolveTags(
  item: {
    tags?: SchedulePlaceTag[] | null;
    tagNames?: string[] | null;
  },
  colorByName: Map<string, string>,
): SchedulePlaceTag[] {
  if (Array.isArray(item.tags) && item.tags.length > 0) {
    return item.tags.map((t) => {
      const mapped = colorByName.get(t.name);
      const raw = (t.color ?? '').trim();
      const apiOk = /^#[0-9A-Fa-f]{6}$/.test(raw) ? raw.toUpperCase() : null;
      // 与项目列表同源：本地色表优先
      return { name: t.name, color: mapped ?? apiOk ?? DEFAULT_PROJECT_TAG_COLOR };
    });
  }
  return (item.tagNames ?? []).map((name) => ({
    name,
    color: colorByName.get(name) ?? DEFAULT_PROJECT_TAG_COLOR,
  }));
}

function resolveOverdue(
  item: { dueDate?: string | null; isOverdue?: boolean },
  logicalToday: string,
): boolean {
  if (typeof item.isOverdue === 'boolean') return item.isOverdue;
  const due = (item.dueDate ?? '').trim();
  if (!due || !logicalToday) return false;
  return isTaskDueOverdue(due, false, logicalToday);
}

function sortCandidates(items: DisplayCandidate[]): DisplayCandidate[] {
  return [...items].sort((a, b) => {
    if (a.alreadyAssigned !== b.alreadyAssigned) return a.alreadyAssigned ? 1 : -1;
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const dueA = a.dueDate ?? '9999-99-99';
    const dueB = b.dueDate ?? '9999-99-99';
    if (dueA !== dueB) return dueA.localeCompare(dueB);
    return a.title.localeCompare(b.title, 'zh');
  });
}

function toDisplayCandidate(
  item: FrogCandidate | SchedulePlacePreselected,
  colorByName: Map<string, string>,
  logicalToday: string,
): DisplayCandidate {
  const projectId =
    'projectId' in item ? (item.projectId ?? null) : item.kind === 'project' ? item.id : null;
  return {
    kind: item.kind,
    id: item.id,
    title: item.title,
    priority: item.priority ?? 0,
    dueDate: item.dueDate ?? null,
    acceptanceCriteria: item.acceptanceCriteria ?? '',
    rewardPoints: item.rewardPoints ?? 0,
    projectId,
    projectName: item.projectName ?? null,
    tagNames: item.tagNames ?? [],
    tags: resolveTags(item, colorByName),
    isOverdue: resolveOverdue(item, logicalToday),
    alreadyAssigned: 'alreadyAssigned' in item ? !!item.alreadyAssigned : false,
    blockedReason: 'blockedReason' in item ? item.blockedReason ?? null : null,
  };
}

function CandidateMetaChips({
  candidate,
  isDark,
  outline,
  errorColor,
}: {
  candidate: DisplayCandidate;
  isDark: boolean;
  outline: string;
  errorColor: string;
}) {
  const priority = candidate.priority ?? 0;
  const priorityColor = getTaskPriorityTone(priority, isDark);
  const chips: {
    key: string;
    label: string;
    color: string;
    icon?: keyof typeof MaterialIcons.glyphMap;
    overdue?: boolean;
  }[] = [
    {
      key: 'kind',
      label: kindLabel(candidate),
      color: outline,
      icon: candidate.kind === 'project' ? 'folder' : !candidate.projectId ? 'inbox' : 'check-circle-outline',
    },
  ];

  if (priority >= 1) {
    chips.push({
      key: 'priority',
      label: priorityLabel(priority),
      color: priorityColor,
      icon: 'flag',
    });
  }
  if (candidate.dueDate) {
    chips.push({
      key: 'due',
      label: candidate.dueDate,
      color: candidate.isOverdue ? errorColor : outline,
      icon: candidate.isOverdue ? 'event-busy' : 'event',
      overdue: candidate.isOverdue,
    });
  }
  if (candidate.isOverdue) {
    chips.push({
      key: 'overdue',
      label: '已过期',
      color: errorColor,
      icon: 'warning',
      overdue: true,
    });
  }
  if (candidate.kind === 'task' && candidate.projectName) {
    chips.push({
      key: 'project',
      label: candidate.projectName,
      color: outline,
      icon: 'folder-open',
    });
  }
  if (candidate.rewardPoints > 0) {
    chips.push({
      key: 'pts',
      label: `${candidate.rewardPoints} 分`,
      color: outline,
      icon: 'stars',
    });
  }
  if (candidate.alreadyAssigned) {
    chips.push({
      key: 'assigned',
      label: '当日已指派',
      color: outline,
      icon: 'event-available',
    });
  }

  return (
    <View style={styles.chipWrap}>
      {chips.map((chip) => (
        <View
          key={chip.key}
          style={[
            styles.metaChip,
            {
              backgroundColor: chip.overdue
                ? `${errorColor}1a`
                : isDark
                  ? `${chip.color}28`
                  : `${chip.color}14`,
              borderColor: chip.overdue
                ? `${errorColor}44`
                : isDark
                  ? `${chip.color}44`
                  : `${chip.color}30`,
            },
          ]}>
          {chip.icon ? <MaterialIcons name={chip.icon} size={12} color={chip.color} /> : null}
          <Text style={[styles.metaChipText, { color: chip.color }]} numberOfLines={1}>
            {chip.label}
          </Text>
        </View>
      ))}
      {candidate.tags.slice(0, 3).map((tag) => (
        <View
          key={`tag-${tag.name}`}
          style={[
            styles.metaChip,
            {
              backgroundColor: `${tag.color}18`,
              borderColor: `${tag.color}44`,
            },
          ]}>
          <View style={[styles.tagDot, { backgroundColor: tag.color }]} />
          <Text style={[styles.metaChipText, { color: tag.color }]} numberOfLines={1}>
            {tag.name}
          </Text>
        </View>
      ))}
    </View>
  );
}

export function SchedulePlaceFrogSheet({
  visible,
  onClose,
  assignYmd,
  maxSpan,
  lockedProjectIds,
  preselected,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const primary = theme.primary;
  const outline = theme.textSecondary;
  const errorColor = theme.danger;
  const surface = isDark ? '#1e293b' : '#fff';
  const surfaceLow = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(241,245,249,0.95)';

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [candidates, setCandidates] = React.useState<DisplayCandidate[]>([]);
  const [picked, setPicked] = React.useState<DisplayCandidate | null>(null);
  const [span, setSpan] = React.useState(1);
  const [logicalToday, setLogicalToday] = React.useState(assignYmd);
  const [tagColorByName, setTagColorByName] = React.useState<Map<string, string>>(() => new Map());
  const [listFilter, setListFilter] = React.useState<'all' | 'todo' | 'task' | 'project'>('all');

  React.useEffect(() => {
    if (!visible) return;
    setListFilter('all');
  }, [visible, assignYmd]);

  React.useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getProjectTags()
      .then((rows) => {
        if (cancelled) return;
        const map = new Map<string, string>();
        for (const t of rows) {
          const name = t.name?.trim();
          if (!name) continue;
          map.set(name, t.color || DEFAULT_PROJECT_TAG_COLOR);
        }
        setTagColorByName(map);
      })
      .catch(() => {
        if (!cancelled) setTagColorByName(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    setSpan(1);
    if (preselected) {
      setPicked(toDisplayCandidate(preselected, tagColorByName, logicalToday || assignYmd));
      setCandidates([]);
      setLoading(false);
      return;
    }
    setPicked(null);
    let cancelled = false;
    setLoading(true);
    void fetchFrogCandidates({ assignYmd })
      .then((res) => {
        if (cancelled) return;
        const today = res.logicalToday || assignYmd;
        setLogicalToday(today);
        const locked = lockedProjectIds ?? new Set<string>();
        const filtered = res.items
          .filter((it) => {
            if (it.blockedReason) return false;
            if (it.kind === 'task' && it.projectId && locked.has(it.projectId)) return false;
            if (it.kind === 'project' && locked.has(it.id)) return false;
            return true;
          })
          .map((it) => toDisplayCandidate(it, tagColorByName, today));
        setCandidates(sortCandidates(filtered));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // tagColorByName 变化时由下方 effect 仅重着色，避免重复请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, assignYmd, lockedProjectIds, preselected]);

  // 标签色加载完成后给候选 / 预选项补色
  React.useEffect(() => {
    if (!visible) return;
    const today = logicalToday || assignYmd;
    if (preselected) {
      setPicked(toDisplayCandidate(preselected, tagColorByName, today));
      return;
    }
    setCandidates((prev) =>
      sortCandidates(prev.map((c) => toDisplayCandidate(c, tagColorByName, today))),
    );
  }, [visible, tagColorByName, preselected, logicalToday, assignYmd]);

  const canConfirm = !!picked && span >= 1 && span <= maxSpan && !saving;
  const showList = !preselected && !picked;

  const visibleCandidates = React.useMemo(() => {
    if (listFilter === 'all') return candidates;
    if (listFilter === 'project') return candidates.filter((c) => c.kind === 'project');
    if (listFilter === 'todo') {
      return candidates.filter((c) => c.kind === 'task' && !c.projectId);
    }
    return candidates.filter((c) => c.kind === 'task' && !!c.projectId);
  }, [candidates, listFilter]);

  const filterCounts = React.useMemo(() => {
    let todo = 0;
    let task = 0;
    let project = 0;
    for (const c of candidates) {
      if (c.kind === 'project') project += 1;
      else if (!c.projectId) todo += 1;
      else task += 1;
    }
    return { all: candidates.length, todo, task, project };
  }, [candidates]);

  const submit = React.useCallback(async () => {
    if (!picked || !canConfirm) return;
    setSaving(true);
    try {
      await onConfirm({
        kind: picked.kind,
        id: picked.id,
        title: picked.title,
        spanSlots: span,
        assignYmd,
      });
      onClose();
    } catch (err) {
      Alert.alert('入格失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [picked, canConfirm, onConfirm, span, assignYmd, onClose]);

  const renderPickedSummary = (item: DisplayCandidate) => {
    const acceptance = (item.acceptanceCriteria || '').trim();
    return (
      <View style={{ gap: 8 }}>
        <Text
          style={{
            color: item.isOverdue ? errorColor : theme.text,
            fontWeight: item.isOverdue ? '800' : '700',
            fontSize: 16,
          }}>
          {item.title}
        </Text>
        <CandidateMetaChips
          candidate={item}
          isDark={isDark}
          outline={outline}
          errorColor={errorColor}
        />
        {acceptance ? (
          <Text style={{ color: outline, fontSize: 13, lineHeight: 18 }} numberOfLines={3}>
            验收：{acceptance}
          </Text>
        ) : null}
      </View>
    );
  };

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
            <Text style={[styles.title, { color: theme.text }]}>
              {showList ? '添加青蛙入格' : '选择占用格数'}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <MaterialIcons name="close" size={22} color={outline} />
            </Pressable>
          </View>

          <View style={[styles.dateChip, { backgroundColor: surfaceLow }]}>
            <MaterialIcons name="event" size={18} color={primary} />
            <Text style={{ color: theme.text, fontWeight: '600' }}>{assignYmd}</Text>
            <Text style={{ color: outline, fontSize: 12, marginLeft: 'auto' }}>
              过期优先 · 按优先级
            </Text>
          </View>

          {showList ? (
            <View style={{ flexGrow: 1, minHeight: 160 }}>
              {loading ? (
                <ActivityIndicator color={primary} style={{ marginVertical: 28 }} />
              ) : candidates.length === 0 ? (
                <Text style={{ color: outline, paddingVertical: 20, lineHeight: 20 }}>
                  当日暂无可指派项（截止/锁定/子任务未完成等规则仍生效）。
                </Text>
              ) : (
                <>
                  <View style={styles.filterRow}>
                    {(
                      [
                        { key: 'all' as const, label: '全部' },
                        { key: 'todo' as const, label: '待办' },
                        { key: 'task' as const, label: '任务' },
                        { key: 'project' as const, label: '项目' },
                      ] as const
                    ).map((tab) => {
                      const active = listFilter === tab.key;
                      const count = filterCounts[tab.key];
                      return (
                        <Pressable
                          key={tab.key}
                          onPress={() => setListFilter(tab.key)}
                          style={[
                            styles.filterChip,
                            {
                              borderColor: active ? primary : `${outline}44`,
                              backgroundColor: active ? `${primary}18` : 'transparent',
                            },
                          ]}>
                          <Text
                            style={{
                              color: active ? primary : outline,
                              fontWeight: active ? '700' : '600',
                              fontSize: 12,
                            }}>
                            {tab.label}
                            {count > 0 ? ` ${count}` : ''}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  {visibleCandidates.length === 0 ? (
                    <Text style={{ color: outline, paddingVertical: 16, lineHeight: 20 }}>
                      当前分类下暂无可指派项。
                    </Text>
                  ) : (
                    <ScrollView
                      style={{ maxHeight: 400 }}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}>
                      {visibleCandidates.map((c) => {
                        const acceptance = (c.acceptanceCriteria || '').trim();
                        return (
                          <Pressable
                            key={`${c.kind}-${c.id}`}
                            onPress={() => {
                              setPicked(c);
                            }}
                            style={({ pressed }) => [
                              styles.candidateCard,
                              {
                                backgroundColor: c.isOverdue
                                  ? `${errorColor}10`
                                  : surfaceLow,
                                opacity: pressed ? 0.85 : 1,
                                borderColor: c.isOverdue
                                  ? `${errorColor}55`
                                  : isDark
                                    ? 'rgba(148,163,184,0.22)'
                                    : 'rgba(203,213,225,0.85)',
                                borderWidth: c.isOverdue ? 1.5 : StyleSheet.hairlineWidth,
                              },
                            ]}>
                            <View style={styles.candidateTitleRow}>
                              <Text
                                style={{
                                  color: c.isOverdue ? errorColor : theme.text,
                                  fontWeight: c.isOverdue ? '800' : '700',
                                  flex: 1,
                                  fontSize: 15,
                                }}
                                numberOfLines={2}>
                                {c.title}
                              </Text>
                              <MaterialIcons
                                name="chevron-right"
                                size={20}
                                color={outline}
                              />
                            </View>
                            <CandidateMetaChips
                              candidate={c}
                              isDark={isDark}
                              outline={outline}
                              errorColor={errorColor}
                            />
                            {acceptance ? (
                              <Text
                                style={{
                                  color: outline,
                                  fontSize: 12,
                                  lineHeight: 17,
                                  marginTop: 2,
                                }}
                                numberOfLines={2}>
                                验收：{acceptance}
                              </Text>
                            ) : null}
                          </Pressable>
                        );
                      })}
                    </ScrollView>
                  )}
                </>
              )}
            </View>
          ) : picked ? (
            <View style={{ gap: 12 }}>
              {renderPickedSummary(picked)}
              <Text style={{ color: outline, fontSize: 13 }}>
                连续占用 N 格（最多 {maxSpan}）
              </Text>
              <View style={styles.spanRow}>
                {Array.from({ length: maxSpan }, (_, i) => i + 1).map((n) => {
                  const active = span === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setSpan(n)}
                      style={[
                        styles.spanChip,
                        {
                          borderColor: active ? primary : `${outline}55`,
                          backgroundColor: active ? `${primary}18` : 'transparent',
                        },
                      ]}>
                      <Text style={{ color: active ? primary : theme.text, fontWeight: '700' }}>
                        {n}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.footerRow}>
                {!preselected ? (
                  <Pressable onPress={() => setPicked(null)} style={styles.ghostBtn}>
                    <Text style={{ color: outline, fontWeight: '600' }}>重选青蛙</Text>
                  </Pressable>
                ) : (
                  <Pressable onPress={onClose} style={styles.ghostBtn}>
                    <Text style={{ color: outline, fontWeight: '600' }}>取消</Text>
                  </Pressable>
                )}
                <Pressable
                  onPress={() => void submit()}
                  disabled={!canConfirm}
                  style={[
                    styles.primaryBtn,
                    { backgroundColor: primary, opacity: canConfirm ? 1 : 0.45 },
                  ]}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontWeight: '700' }}>确认入格</Text>
                  )}
                </Pressable>
              </View>
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
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
  title: { fontSize: 17, fontWeight: '700' },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  filterChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  candidateCard: {
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  candidateTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: '100%',
  },
  metaChipText: { fontSize: 11, fontWeight: '600', maxWidth: 140 },
  tagDot: { width: 7, height: 7, borderRadius: 3.5 },
  spanRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spanChip: {
    minWidth: 44,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 12,
  },
  ghostBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  primaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
