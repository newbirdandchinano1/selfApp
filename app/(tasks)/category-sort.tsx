/**
 * 分类排序 — 对齐设计稿 shot 19
 * 长按 300ms 抬起 · 拖起阴影/缩放 · 虚线占位 · 收集箱锁定底部 · 完成写回
 */
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { toast } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { formatWriteError } from '@/lib/format-write-error';
import {
  INBOX_PROJECT_CATEGORY_ID,
  INBOX_PROJECT_CATEGORY_NAME,
} from '@/lib/repositories/projects/constants';
import {
  createProjectCategory,
  getProjectCategories,
  getProjects,
  reorderProjectCategories,
} from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow } from '@/lib/repositories/projects/project.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DraggableFlatList, {
  ScaleDecorator,
  ShadowDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const CAT_EMOJIS = ['💼', '🏠', '📚', '🌿', '💡', '🎒', '👥', '✈️', '🧺', '🎯', '🛠️', '🎨'];
const CAT_TINTS = [
  '#F4E7EA',
  '#F7E6DE',
  '#E8EFD9',
  '#E0EBE5',
  '#F5E6CB',
  '#EFEBDF',
  '#F1E9E1',
  '#E7EEF2',
  '#F3EDDF',
  '#E8F0EA',
];

function categoryVisual(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return {
    emoji: CAT_EMOJIS[h % CAT_EMOJIS.length],
    tint: CAT_TINTS[h % CAT_TINTS.length],
  };
}

function buildCategoryId() {
  return makeTimestampEntityId('pc_', 8);
}

type SortRowProps = {
  item: ProjectCategoryRow;
  drag: () => void;
  isActive: boolean;
  count: number;
  saving: boolean;
  index: number;
  enterAnimate: boolean;
  holdHidden: boolean;
};

function SortRow({
  item,
  drag,
  isActive,
  count,
  saving,
  index,
  enterAnimate,
  holdHidden,
}: SortRowProps) {
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { emoji, tint } = categoryVisual(item.name);
  /** 冻结首屏错峰，避免拖拽换序后 index 变化重播入场 */
  const staggerDelayRef = React.useRef((index + 1) * 40);
  const cardBg = isActive
    ? isDark
      ? 'rgba(255,252,245,0.12)'
      : '#FFFDF8'
    : isDark
      ? 'rgba(255,252,245,0.06)'
      : 'rgba(255,252,245,0.8)';

  return (
    <FoldRiseIn
      animate={enterAnimate}
      index={0}
      delayMs={staggerDelayRef.current}
      duration={480}
      staggerMs={0}
      fromY={10}
      holdHidden={holdHidden}>
      <ScaleDecorator activeScale={1.02}>
        <ShadowDecorator elevation={isActive ? 12 : 0} radius={14} opacity={0.16} color="#283028">
          <Pressable
            onLongPress={drag}
            delayLongPress={TaskFoldMotion.sortLongPress}
            disabled={saving}
            style={({ pressed }) => [
              styles.sortrow,
              {
                backgroundColor: cardBg,
                borderColor: isActive ? '#D9C9AE' : tf.line2,
                opacity: pressed && !isActive ? 0.92 : 1,
                transform: isActive ? [{ rotate: '-0.5deg' }] : undefined,
                zIndex: isActive ? 2 : 0,
              },
            ]}>
            <View style={styles.dragh}>
              <MaterialIcons name="drag-indicator" size={18} color={tf.faint} />
            </View>
            <View style={[styles.sic, { backgroundColor: isDark ? tf.lily2 : tint }]}>
              <Text style={styles.sicEmoji}>{emoji}</Text>
            </View>
            <View style={styles.sn}>
              <Text style={[styles.snTitle, { color: tf.ink2 }]} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={[styles.snMeta, { color: tf.faint }]} numberOfLines={1}>
                {count} 个项目{isActive ? ' · 拖动中' : ''}
              </Text>
            </View>
            <Text style={[styles.cnt2, { color: tf.faint, fontFamily: fonts.mono }]}>{count}</Text>
          </Pressable>
        </ShadowDecorator>
      </ScaleDecorator>
    </FoldRiseIn>
  );
}

export default function CategorySortScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate, motionReduced, motionReady } = useFoldMotionGate();

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [projectInbox, setProjectInbox] = React.useState<ProjectCategoryRow | null>(null);
  const [projectCategories, setProjectCategories] = React.useState<ProjectCategoryRow[]>([]);
  const [countByCat, setCountByCat] = React.useState<Record<string, number>>({});
  const [createVisible, setCreateVisible] = React.useState(false);
  const [newName, setNewName] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const persistLockRef = React.useRef(false);

  const foldCardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.86)';
  const foldCardBorder = tf.line2;
  const footPad = Math.max(insets.bottom, 12);
  /** 数据 + 动效偏好都就绪后才挂载，FoldRiseIn 才能从 0 起播 */
  const enterReady = motionReady && !loading;
  const showContent = enterReady || (motionReady && motionReduced);
  const enterAnimate = foldAnimate && enterReady;
  const holdEntrance = !motionReduced;

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [rows, projects] = await Promise.all([getProjectCategories(), getProjects()]);
      const inbox = rows.find((r) => r.id === INBOX_PROJECT_CATEGORY_ID) ?? null;
      setProjectInbox(
        inbox ?? {
          id: INBOX_PROJECT_CATEGORY_ID,
          name: INBOX_PROJECT_CATEGORY_NAME,
          sort_order: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          sync_status: 'synced',
          extra_data: null,
        },
      );
      setProjectCategories(rows.filter((r) => r.id !== INBOX_PROJECT_CATEGORY_ID));
      const counts: Record<string, number> = {};
      for (const p of projects) {
        const key = p.category_id?.trim() || INBOX_PROJECT_CATEGORY_ID;
        counts[key] = (counts[key] ?? 0) + 1;
      }
      setCountByCat(counts);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const persistOrder = React.useCallback(async (ordered: ProjectCategoryRow[]) => {
    if (persistLockRef.current) return;
    persistLockRef.current = true;
    setSaving(true);
    try {
      await reorderProjectCategories(ordered.map((c) => c.id));
    } catch (err) {
      console.warn('分类排序写回失败', err);
      toast.error(formatWriteError(err, '顺序保存失败，请稍后重试。'));
    } finally {
      setSaving(false);
      persistLockRef.current = false;
    }
  }, []);

  const finishAndBack = async () => {
    await persistOrder(projectCategories);
    toast.success('顺序已写回 · 项目 Tab 已更新');
    router.back();
  };

  const createCategory = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      toast.warn('请输入分类名称');
      return;
    }
    if (projectCategories.some((c) => c.name.trim() === trimmed) || trimmed === INBOX_PROJECT_CATEGORY_NAME) {
      toast.warn('分类名称不能重复');
      return;
    }
    setCreating(true);
    try {
      await createProjectCategory({ id: buildCategoryId(), name: trimmed });
      setCreateVisible(false);
      setNewName('');
      toast.success('已新建分类');
      await load();
    } catch (err) {
      console.warn('新建分类失败', err);
      toast.error(formatWriteError(err, '新建失败，请稍后重试。'));
    } finally {
      setCreating(false);
    }
  };

  const footerStartIndex = projectCategories.length + 1;

  const renderItem = React.useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<ProjectCategoryRow>) => (
      <SortRow
        item={item}
        drag={drag}
        isActive={isActive}
        count={countByCat[item.id] ?? 0}
        saving={saving}
        index={getIndex() ?? 0}
        enterAnimate={enterAnimate}
        holdHidden={holdEntrance}
      />
    ),
    [countByCat, enterAnimate, holdEntrance, saving],
  );

  const listHeader = showContent ? (
    <FoldRiseIn
      animate={enterAnimate}
      index={0}
      duration={480}
      staggerMs={40}
      fromY={10}
      holdHidden={holdEntrance}>
      <View
        style={[
          styles.fbox,
          {
            backgroundColor: isDark ? tf.amber2 : '#F8ECD7',
            borderColor: isDark ? tf.scoreBorder : '#E8CDA2',
          },
        ]}>
        <Text style={[styles.fboxText, { color: tf.amberInk }]}>
          <Text style={{ fontWeight: '800' }}>长按拖动排序</Text>
          {' · '}松手后立即写回本地；收集箱始终固定在底部，不参与排序。
        </Text>
      </View>
    </FoldRiseIn>
  ) : undefined;

  const listFooter = showContent ? (
    <View style={styles.footerBlock}>
      <FoldRiseIn
        animate={enterAnimate}
        index={footerStartIndex}
        duration={480}
        staggerMs={40}
        fromY={8}
        holdHidden={holdEntrance}>
        <Pressable
          onPress={() => {
            setNewName('');
            setCreateVisible(true);
          }}
          style={({ pressed }) => [
            styles.tagadd,
            { borderColor: tf.line2, opacity: pressed ? 0.85 : 1 },
          ]}>
          <MaterialIcons name="add" size={14} color={tf.muted} />
          <Text style={{ fontSize: 12, fontWeight: '600', color: tf.muted }}>新建分类</Text>
        </Pressable>
      </FoldRiseIn>

      {projectInbox ? (
        <FoldRiseIn
          animate={enterAnimate}
          index={footerStartIndex + 1}
          duration={480}
          staggerMs={40}
          fromY={8}
          holdHidden={holdEntrance}>
          <View
            style={[
              styles.sortrow,
              styles.lockedRow,
              {
                backgroundColor: isDark ? 'rgba(245,237,224,0.08)' : 'rgba(245,237,224,0.7)',
                borderColor: foldCardBorder,
              },
            ]}>
            <View style={styles.dragh}>
              <MaterialIcons name="lock" size={16} color={tf.faint} />
            </View>
            <View style={[styles.sic, { backgroundColor: isDark ? tf.lily2 : '#EFEBDF' }]}>
              <Text style={styles.sicEmoji}>📥</Text>
            </View>
            <View style={styles.sn}>
              <Text style={[styles.snTitle, { color: tf.ink2 }]}>{projectInbox.name}</Text>
              <Text style={[styles.snMeta, { color: tf.faint }]}>
                系统分类 · 固定底部 · {countByCat[INBOX_PROJECT_CATEGORY_ID] ?? 0} 个项目
              </Text>
            </View>
            <Text style={{ fontSize: 11, color: tf.faint, fontWeight: '600' }}>锁定</Text>
          </View>
        </FoldRiseIn>
      ) : null}

      <FoldRiseIn
        animate={enterAnimate}
        index={footerStartIndex + 2}
        duration={480}
        staggerMs={40}
        fromY={8}
        holdHidden={holdEntrance}>
        <View style={[styles.impactCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
          <View style={styles.impactHead}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: tf.ink2 }}>排序影响</Text>
            <Text style={{ fontSize: 10, color: tf.faint }}>只改展示</Text>
          </View>
          {[
            { icon: 'layers' as const, title: '项目 Tab 顺序', sub: '主屏与宽屏左栏同步', val: '即时' },
            { icon: 'grid-view' as const, title: '四象限与截止排序', sub: '不受分类顺序影响', val: '不变' },
            { icon: 'sync' as const, title: '多设备', sub: '松手后先写本机，再增量同步', val: '本机优先' },
          ].map((row, i) => (
            <View key={row.title} style={[styles.setrow, i === 0 && { borderTopWidth: 0 }]}>
              <View style={[styles.si, { backgroundColor: isDark ? tf.paper2 : '#F1EDE1' }]}>
                <MaterialIcons name={row.icon} size={14} color={tf.muted} />
              </View>
              <View style={styles.sc}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: tf.ink2 }}>{row.title}</Text>
                <Text style={{ fontSize: 10, color: tf.faint, marginTop: 1 }}>{row.sub}</Text>
              </View>
              <Text style={{ fontSize: 11, color: tf.muted }}>{row.val}</Text>
            </View>
          ))}
        </View>
      </FoldRiseIn>

      <FoldRiseIn
        animate={enterAnimate}
        index={footerStartIndex + 3}
        duration={480}
        staggerMs={40}
        fromY={6}
        holdHidden={holdEntrance}>
        <View style={styles.hintline}>
          <MaterialIcons name="lightbulb-outline" size={14} color={tf.faint} />
          <Text style={{ flex: 1, fontSize: 11, color: tf.faint, lineHeight: 16, textAlign: 'center' }}>
            排序只改变展示，不改变项目归属与任务优先级。
          </Text>
        </View>
      </FoldRiseIn>
    </View>
  ) : undefined;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
      <View style={[styles.appbar, { paddingTop: Math.max(insets.top, 8) }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => [styles.iconbtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={20} color={tf.ink2} />
        </Pressable>
        <View style={styles.appbarCenter}>
          <Text style={[styles.appbarTitle, { color: tf.ink }]}>分类排序</Text>
          <Text style={[styles.appbarSub, { color: tf.muted }]} numberOfLines={1}>
            长按拖动 · 收集箱锁定 · 影响项目 Tab 顺序
          </Text>
        </View>
        <Pressable
          onPress={() => void finishAndBack()}
          disabled={saving}
          style={({ pressed }) => [
            styles.pillbtn,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.66)',
              opacity: saving ? 0.55 : pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>
            {saving ? '保存中' : '完成'}
          </Text>
        </Pressable>
      </View>

      {!showContent ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={tf.frog} />
          <Text style={{ fontSize: 12, color: tf.faint, marginTop: 10 }}>加载中…</Text>
        </View>
      ) : (
        <DraggableFlatList
          data={projectCategories}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          onDragEnd={({ data: next }) => {
            setProjectCategories(next);
            void persistOrder(next);
          }}
          activationDistance={8}
          containerStyle={styles.listFlex}
          contentContainerStyle={[styles.listContent, { paddingBottom: 88 + footPad }]}
          ListHeaderComponent={listHeader}
          ListFooterComponent={listFooter}
          ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          renderPlaceholder={() => (
            <View style={[styles.dragspace, { borderColor: tf.line2 }]} />
          )}
        />
      )}

      <View style={[styles.foldFoot, { paddingBottom: footPad, backgroundColor: tf.paper }]}>
        <Pressable
          onPress={() => void finishAndBack()}
          disabled={saving}
          style={({ pressed }) => [
            styles.foldPrimary,
            {
              backgroundColor: tf.pond,
              opacity: saving ? 0.55 : pressed ? 0.9 : 1,
            },
          ]}>
          <Text style={[styles.foldPrimaryText, { color: tf.onPond }]}>
            {saving ? '保存中…' : '完成排序'}
          </Text>
        </Pressable>
      </View>

      <Modal visible={createVisible} transparent animationType="fade" onRequestClose={() => setCreateVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => !creating && setCreateVisible(false)} />
          <View style={[styles.editorCard, { backgroundColor: foldCardBg, borderColor: foldCardBorder }]}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: tf.ink }}>新建分类</Text>
            <TextInput
              value={newName}
              onChangeText={setNewName}
              placeholder="例如：工作 / 生活"
              placeholderTextColor={tf.faint}
              maxLength={24}
              autoFocus
              style={[
                styles.input,
                { color: tf.ink, backgroundColor: isDark ? tf.paper2 : '#F1EDE1', borderColor: tf.line },
              ]}
            />
            <View style={styles.editorActions}>
              <Pressable onPress={() => setCreateVisible(false)} disabled={creating}>
                <Text style={{ fontSize: 14, color: tf.muted }}>取消</Text>
              </Pressable>
              <Pressable
                onPress={() => void createCategory()}
                disabled={creating}
                style={[styles.primaryMini, { backgroundColor: tf.pond, opacity: creating ? 0.6 : 1 }]}>
                <Text style={{ color: tf.onPond, fontWeight: '700' }}>{creating ? '创建中' : '创建'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  appbar: {
    height: undefined,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconbtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appbarCenter: { flex: 1, minWidth: 0 },
  appbarTitle: { fontSize: 15, fontWeight: '700' },
  appbarSub: { fontSize: 10, marginTop: 2 },
  pillbtn: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  listFlex: { flex: 1 },
  listContent: {
    paddingHorizontal: 14,
    paddingTop: 4,
    gap: 0,
  },
  fbox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  fboxText: { fontSize: 12, lineHeight: 18 },
  sortrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 11,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  lockedRow: { opacity: 0.72, marginTop: 8 },
  dragh: { width: 18, alignItems: 'center', justifyContent: 'center' },
  sic: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sicEmoji: { fontSize: 13 },
  sn: { flex: 1, minWidth: 0 },
  snTitle: { fontSize: 13, fontWeight: '700' },
  snMeta: { fontSize: 10, marginTop: 2 },
  cnt2: { fontSize: 11, fontWeight: '600' },
  dragspace: {
    height: 48,
    borderRadius: 11,
    borderWidth: 1,
    borderStyle: 'dashed',
    marginVertical: 2,
    backgroundColor: 'transparent',
  },
  footerBlock: { marginTop: 6, gap: 6, paddingBottom: 8 },
  tagadd: {
    height: 36,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  impactCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 4,
  },
  impactHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  setrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(232,224,210,0.5)',
  },
  si: {
    width: 24,
    height: 24,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sc: { flex: 1, minWidth: 0 },
  hintline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
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
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  modalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(25,34,28,0.42)',
  },
  editorCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: 18,
    gap: 12,
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  editorActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 16,
    marginTop: 4,
  },
  primaryMini: {
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
});
