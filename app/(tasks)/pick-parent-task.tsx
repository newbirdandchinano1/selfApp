/**
 * 选择父任务 — 对齐设计稿 shot 16
 * 不可选行锁定 · 路径芯片 · 选中弹簧 · 搜索过滤可选项
 */
import { ComposerTopBar } from '@/components/composer';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { toast } from '@/lib/app-feedback';
import { getProjectById } from '@/lib/repositories/projects/project';
import {
  getEligibleParentTaskCandidates,
  getTaskById,
  getTasksByProjectId,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

declare global {
  // eslint-disable-next-line no-var
  var __pickParentTaskResult:
    | {
        source: string;
        parentTaskId: string | null;
      }
    | undefined;
}

type FlatPickRow = {
  task: TaskRow;
  depth: number;
  childDone: number;
  childTotal: number;
  locked: boolean;
  lockReason: string;
};

function flattenTree(
  nodes: TaskTreeNode[],
  lockedIds: Set<string>,
  currentTaskId: string,
  depth = 0,
): FlatPickRow[] {
  const out: FlatPickRow[] = [];
  for (const node of nodes) {
    const children = Array.isArray(node.children) ? node.children : [];
    let childDone = 0;
    for (const c of children) {
      if (c.status === 'done' || c.status === 'cancelled') childDone += 1;
    }
    const isSelf = String(node.id) === currentTaskId;
    const locked = lockedIds.has(String(node.id));
    out.push({
      task: node,
      depth,
      childDone,
      childTotal: children.length,
      locked,
      lockReason: isSelf ? '当前任务' : locked ? '子孙 · 不可选' : '',
    });
    if (children.length > 0) {
      out.push(...flattenTree(children, lockedIds, currentTaskId, depth + 1));
    }
  }
  return out;
}

function collectPathTitles(
  nodes: TaskTreeNode[],
  targetId: string,
  trail: string[] = [],
): string[] | null {
  for (const node of nodes) {
    const next = [...trail, node.title?.trim() || '（无标题）'];
    if (String(node.id) === targetId) return next;
    const hit = collectPathTitles(node.children ?? [], targetId, next);
    if (hit) return hit;
  }
  return null;
}

function PickParentRow({
  row,
  selected,
  onSelect,
  onLockedPress,
}: {
  row: FlatPickRow;
  selected: boolean;
  onSelect: () => void;
  onLockedPress: () => void;
}) {
  const { tf } = useTaskFoldTheme();
  const scale = React.useRef(new Animated.Value(1)).current;

  React.useEffect(() => {
    if (!selected) {
      scale.setValue(1);
      return;
    }
    scale.setValue(0.96);
    Animated.spring(scale, {
      toValue: 1,
      friction: 5,
      tension: 220,
      useNativeDriver: true,
    }).start();
  }, [scale, selected]);

  const padLeft = 2 + Math.min(row.depth, 5) * 14;

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => {
          if (row.locked) {
            onLockedPress();
            return;
          }
          onSelect();
        }}
        style={({ pressed }) => [
          styles.trow,
          {
            paddingLeft: padLeft,
            opacity: row.locked ? 0.45 : pressed ? 0.88 : 1,
            backgroundColor: selected ? 'rgba(232,239,217,0.45)' : 'transparent',
            borderRadius: selected ? 8 : 0,
            marginHorizontal: selected ? -4 : 0,
            paddingHorizontal: selected ? 6 : 2,
          },
        ]}>
        {row.childTotal > 0 ? (
          <MaterialIcons
            name="chevron-right"
            size={14}
            color={tf.faint}
            style={{ transform: [{ rotate: '90deg' }] }}
          />
        ) : (
          <View style={{ width: 14 }} />
        )}
        <View
          style={[
            styles.cb,
            {
              borderColor: selected || row.task.status === 'done' ? tf.frog : '#C8D1C0',
              backgroundColor:
                selected || row.task.status === 'done' ? tf.frog : 'rgba(255,255,255,0.5)',
            },
          ]}>
          {(selected || row.task.status === 'done') && (
            <MaterialIcons name="check" size={10} color={tf.onPond} />
          )}
        </View>
        <Text
          style={[
            styles.tn,
            {
              color: row.task.status === 'done' ? '#A8AFA6' : tf.ink2,
              textDecorationLine: row.task.status === 'done' ? 'line-through' : 'none',
            },
          ]}
          numberOfLines={1}>
          {row.task.title?.trim() || '（无标题）'}
          {row.lockReason === '当前任务' ? '（自身）' : ''}
        </Text>
        {selected ? (
          <View style={[styles.selectedTag, { backgroundColor: tf.sage2 }]}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#36594D' }}>已选</Text>
          </View>
        ) : row.locked ? (
          <Text style={[styles.metaRight, { color: tf.faint }]}>{row.lockReason}</Text>
        ) : row.childTotal > 0 ? (
          <Text style={[styles.metaRight, { color: tf.faint }]}>
            {row.childDone} / {row.childTotal}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export default function PickParentTaskScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ taskId?: string; source?: string; currentParentId?: string }>();
  const insets = useSafeAreaInsets();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate } = useFoldMotionGate();

  const taskId = typeof params.taskId === 'string' ? params.taskId : '';
  const currentParentId =
    typeof params.currentParentId === 'string' && params.currentParentId.trim()
      ? params.currentParentId.trim()
      : null;
  const pickSource = normalizeRouteParam(params.source as string | string[] | undefined) || 'pick-parent-task';

  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [tree, setTree] = React.useState<TaskTreeNode[]>([]);
  const [lockedIds, setLockedIds] = React.useState<Set<string>>(() => new Set());
  const [eligibleCount, setEligibleCount] = React.useState(0);
  const [selectedId, setSelectedId] = React.useState<string | null>(currentParentId);
  const [currentTitle, setCurrentTitle] = React.useState('');
  const [projectName, setProjectName] = React.useState('');

  const foldCardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.86)';
  const foldCardBorder = tf.line2;

  React.useEffect(() => {
    if (!taskId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [current, eligible] = await Promise.all([
          getTaskById(taskId),
          getEligibleParentTaskCandidates(taskId),
        ]);
        if (cancelled) return;
        setCurrentTitle(current?.title?.trim() || '当前任务');
        setEligibleCount(eligible.length);
        setSelectedId(currentParentId);

        const eligibleIds = new Set(eligible.map((t) => String(t.id)));
        const projectId = current?.project_id?.trim() || '';
        let nodes: TaskTreeNode[] = [];
        if (projectId) {
          nodes = await getTasksByProjectId(projectId);
          try {
            const project = await getProjectById(projectId);
            if (!cancelled) setProjectName(project?.name?.trim() || '当前项目');
          } catch {
            if (!cancelled) setProjectName('当前项目');
          }
        } else {
          // 无项目：仅展示可选候选为扁平列表
          nodes = eligible.map((t) => ({ ...t, children: [] as TaskTreeNode[] }));
          setProjectName('独立任务');
        }

        const allIds = new Set<string>();
        const walk = (list: TaskTreeNode[]) => {
          for (const n of list) {
            allIds.add(String(n.id));
            walk(n.children ?? []);
          }
        };
        walk(nodes);
        const locked = new Set<string>();
        for (const id of allIds) {
          if (!eligibleIds.has(id)) locked.add(id);
        }
        // 当前任务自身一定锁定
        locked.add(taskId);

        if (!cancelled) {
          setTree(nodes);
          setLockedIds(locked);
        }
      } catch (error) {
        console.warn('加载可选父任务失败', error);
        if (!cancelled) {
          setTree([]);
          setLockedIds(new Set([taskId]));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentParentId, taskId]);

  const flatRows = React.useMemo(
    () => flattenTree(tree, lockedIds, taskId),
    [lockedIds, taskId, tree],
  );

  const filteredRows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flatRows;
    // 搜索只过滤可选项；锁定行若标题匹配仍保留说明
    return flatRows.filter((row) => {
      const title = (row.task.title ?? '').toLowerCase();
      if (!title.includes(q)) return false;
      return true;
    });
  }, [flatRows, query]);

  const selectedTitle = React.useMemo(() => {
    if (!selectedId) return '';
    const hit = flatRows.find((r) => String(r.task.id) === selectedId);
    return hit?.task.title?.trim() || '';
  }, [flatRows, selectedId]);

  const pathChips = React.useMemo(() => {
    const chips: string[] = [];
    if (projectName) chips.push(projectName);
    if (selectedId) {
      const trail = collectPathTitles(tree, selectedId);
      if (trail && trail.length > 0) {
        // trail 已含从根到父；只追加父节点名若与项目不同
        const parentTitle = trail[trail.length - 1];
        if (parentTitle && parentTitle !== projectName) chips.push(parentTitle);
      } else if (selectedTitle) {
        chips.push(selectedTitle);
      }
    }
    chips.push(currentTitle || '当前任务');
    return chips;
  }, [currentTitle, projectName, selectedId, selectedTitle, tree]);

  const confirmPick = () => {
    if (!selectedId) {
      toast.warn('请先选择一个父任务');
      return;
    }
    globalThis.__pickParentTaskResult = {
      source: pickSource,
      parentTaskId: selectedId,
    };
    toast.success(selectedTitle ? `已选择：${selectedTitle}` : '已选择父任务');
    router.back();
  };

  const clearParent = () => {
    globalThis.__pickParentTaskResult = {
      source: pickSource,
      parentTaskId: null,
    };
    router.back();
  };

  const onLockedPress = (reason: string) => {
    toast.warn(reason || '自身与子孙不可选');
  };

  const footPad = Math.max(insets.bottom, 12);
  const eligibleShown = filteredRows.filter((r) => !r.locked).length;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <ComposerTopBar
        title="选择父任务"
        subtitle={`${projectName || '项目'} · 当前：${currentTitle || '…'}`}
        onBack={() => router.back()}
        onSubmit={confirmPick}
        submitLabel="确定"
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.foldContent, { paddingBottom: 110 + footPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={foldAnimate} index={0} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
            <View style={[styles.search, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
              <MaterialIcons name="search" size={16} color={tf.faint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="搜索任务名称…"
                placeholderTextColor={tf.faint}
                style={[styles.searchInput, { color: tf.ink }]}
              />
              <Text style={{ fontSize: 11, color: tf.faint }}>
                {loading ? '…' : `${eligibleShown} 个可选项`}
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={1} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
            <View
              style={[
                styles.fbox,
                {
                  backgroundColor: isDark ? tf.amber2 : '#F8ECD7',
                  borderColor: isDark ? tf.scoreBorder : '#E8CDA2',
                },
              ]}>
              <Text style={[styles.fboxText, { color: tf.amberInk }]}>
                <Text style={{ fontWeight: '800' }}>为当前任务选择父级</Text>
                {'\n'}自身与子孙不可选；移动后项目进度与四象限位置同步更新。
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={2} duration={520} staggerMs={42} fromY={10} holdHidden={foldAnimate}>
            <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
              <View style={styles.cardHead}>
                <Text style={{ fontSize: 12, fontWeight: '800', color: tf.muted }} numberOfLines={1}>
                  {projectName || '项目任务'}
                </Text>
                <Text style={{ fontSize: 11, color: tf.faint, fontFamily: fonts.mono }}>
                  {eligibleCount} / {flatRows.length} 任务
                </Text>
              </View>

              {loading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator size="large" color={tf.frog} />
                </View>
              ) : filteredRows.length === 0 ? (
                <View style={styles.emptyRow}>
                  <MaterialIcons name="inbox" size={18} color={tf.faint} />
                  <Text style={{ flex: 1, fontSize: 13, color: tf.muted, fontWeight: '600' }}>
                    {flatRows.length === 0 ? '暂无可选父任务' : '没有匹配的任务'}
                  </Text>
                </View>
              ) : (
                filteredRows.map((row) => (
                  <PickParentRow
                    key={row.task.id}
                    row={row}
                    selected={selectedId === row.task.id}
                    onSelect={() => setSelectedId(row.task.id)}
                    onLockedPress={() => onLockedPress(row.lockReason)}
                  />
                ))
              )}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={3} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
            <View style={styles.hintline}>
              <MaterialIcons name="lightbulb-outline" size={14} color={tf.faint} />
              <Text style={{ flex: 1, fontSize: 11, color: tf.faint, lineHeight: 16 }}>
                {selectedTitle
                  ? `选择「${selectedTitle}」后，当前任务会移动到它的子任务层。`
                  : '选择父任务后，当前任务会移动到对应子任务层。'}
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={4} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
            <View
              style={[
                styles.fbox,
                { backgroundColor: foldCardBg, borderColor: foldCardBorder, marginTop: 2 },
              ]}>
              <Text style={[styles.fboxText, { color: tf.muted }]}>
                <Text style={{ fontWeight: '800', color: tf.ink2 }}>为什么是灰的？</Text>
                {'  '}
                当前任务自身与全部子孙不可选；已完成、搁置或不属于同一项目的任务不会出现在可选项里。
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldAnimate} index={5} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
            <View style={[styles.fcard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
              <Text style={{ fontSize: 11, color: tf.faint, marginBottom: 6 }}>移动后路径</Text>
              <View style={styles.pathRow}>
                {pathChips.map((chip, i) => (
                  <React.Fragment key={`${chip}-${i}`}>
                    {i > 0 ? (
                      <MaterialIcons name="chevron-right" size={12} color={tf.faint} />
                    ) : null}
                    <Text
                      style={{
                        fontSize: 12,
                        color: i === pathChips.length - 1 ? '#36563C' : '#5C6E5E',
                        fontWeight: i === pathChips.length - 1 ? '800' : '600',
                        maxWidth: 120,
                      }}
                      numberOfLines={1}>
                      {chip}
                    </Text>
                  </React.Fragment>
                ))}
              </View>
            </View>
          </FoldRiseIn>

          {currentParentId ? (
            <FoldRiseIn animate={foldAnimate} index={6} duration={520} staggerMs={42} fromY={8} holdHidden={foldAnimate}>
              <Pressable
                onPress={clearParent}
                style={({ pressed }) => [
                  styles.clearBtn,
                  { borderColor: foldCardBorder, opacity: pressed ? 0.85 : 1 },
                ]}>
                <Text style={{ fontSize: 13, fontWeight: '700', color: tf.muted }}>移除父任务</Text>
              </Pressable>
            </FoldRiseIn>
          ) : null}
        </ScrollView>

        <View style={[styles.foldFoot, { paddingBottom: footPad, backgroundColor: tf.paper }]}>
          <Pressable
            onPress={confirmPick}
            disabled={!selectedId}
            style={({ pressed }) => [
              styles.foldPrimary,
              {
                backgroundColor: tf.pond,
                opacity: !selectedId ? 0.45 : pressed ? 0.9 : 1,
              },
            ]}>
            <Text style={[styles.foldPrimaryText, { color: tf.onPond }]}>选择此父任务</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  foldContent: {
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 8,
    maxWidth: 560,
    width: '100%',
    alignSelf: 'center',
  },
  search: {
    height: 40,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0, fontWeight: '500' },
  fbox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  fboxText: { fontSize: 12, lineHeight: 18 },
  fcard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 4,
    paddingHorizontal: 2,
  },
  trow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.5)',
  },
  cb: {
    width: 14,
    height: 14,
    borderRadius: 4,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tn: { flex: 1, fontSize: 13, fontWeight: '600', minWidth: 0 },
  metaRight: { fontSize: 10, fontWeight: '600', marginLeft: 4 },
  selectedTag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingWrap: { paddingVertical: 28, alignItems: 'center' },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
    paddingHorizontal: 4,
  },
  hintline: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 4 },
  pathRow: { flexDirection: 'row', alignItems: 'center', gap: 4, flexWrap: 'wrap' },
  clearBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  foldFoot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  foldPrimary: {
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foldPrimaryText: { fontSize: 14, fontWeight: '700' },
});
