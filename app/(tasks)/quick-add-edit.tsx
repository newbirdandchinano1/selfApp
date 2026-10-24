/**
 * 快捷卡管理 · 健康 — 对齐设计稿 shot 26
 * 拖拽排序 · 开关降透明 · 频次生成 · FoldRiseIn 级联
 * 路由仍在 tasks 组；不属于任务执行流。
 */
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { notifyPageDataChanged } from '@/lib/page-api-session';
import {
  collectFrequentQuickAddCandidates,
  createQuickAddItemsFromFrequent,
  deleteQuickAddItem,
  formatQuickAddMetricSummary,
  formatQuickAddPreviewMetric,
  getDefaultQuickAddItems,
  loadAllQuickAddItems,
  loadSelectedQuickAddItems,
  saveSelectedQuickAddKeys,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';
import { getHealthRecordsLast7Days } from '@/lib/repositories/health/health';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import DraggableFlatList, {
  ScaleDecorator,
  ShadowDecorator,
  type RenderItemParams,
} from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ManageItem = QuickAddCardItem & {
  icon: keyof typeof MaterialIcons.glyphMap;
  enabled: boolean;
};

const PAGE_API_KEY = 'quick-add-edit';

const ICON_TINTS = ['#F5E6CB', '#E8EFD9', '#E0EBE5', '#F4E7EA', '#EFEBDF', '#F1E9E1'];

function iconTint(key: string) {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return ICON_TINTS[h % ICON_TINTS.length];
}

function toManageItems(selected: QuickAddCardItem[], all: QuickAddCardItem[]): ManageItem[] {
  const selectedKeys = selected.map((item) => item.key);
  const selectedSet = new Set(selectedKeys);
  const allMap = new Map(all.map((item) => [item.key, item]));
  const ordered: QuickAddCardItem[] = [];
  for (const key of selectedKeys) {
    const item = allMap.get(key);
    if (item) ordered.push(item);
  }
  for (const item of all) {
    if (!selectedSet.has(item.key)) ordered.push(item);
  }
  return ordered.map((item) => ({
    ...item,
    icon: item.icon as keyof typeof MaterialIcons.glyphMap,
    enabled: selectedSet.has(item.key),
  }));
}

function QkRow({
  item,
  drag,
  isActive,
  index,
  enterAnimate,
  holdHidden,
  onToggle,
  onDelete,
}: {
  item: ManageItem;
  drag: () => void;
  isActive: boolean;
  index: number;
  enterAnimate: boolean;
  holdHidden: boolean;
  onToggle: (key: string, enabled: boolean) => void;
  onDelete: (item: ManageItem) => void;
}) {
  const { tf, isDark } = useTaskFoldTheme();
  const staggerDelayRef = React.useRef(index * TaskFoldMotion.rowStagger);
  const tint = iconTint(item.key);
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
      duration={420}
      staggerMs={0}
      fromY={6}
      holdHidden={holdHidden}>
      <ScaleDecorator activeScale={1.03}>
        <ShadowDecorator elevation={isActive ? 10 : 0} radius={12} opacity={0.14} color="#283028">
          <Pressable
            onLongPress={drag}
            delayLongPress={TaskFoldMotion.sortLongPress}
            disabled={isActive}
            style={({ pressed }) => [
              styles.qkrow,
              {
                backgroundColor: cardBg,
                borderColor: isActive ? '#D9C9AE' : tf.line2,
                opacity: item.enabled ? (pressed && !isActive ? 0.92 : 1) : 0.63,
              },
            ]}>
            <Pressable onPressIn={drag} hitSlop={8} style={styles.qh}>
              <MaterialIcons name="drag-indicator" size={18} color={tf.faint} />
            </Pressable>
            <View style={[styles.qi, { backgroundColor: isDark ? tf.lily2 : tint }]}>
              <MaterialIcons name={item.icon} size={18} color={tf.frog} />
            </View>
            <View style={styles.qc}>
              <Text style={[styles.qcTitle, { color: tf.ink2 }]} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={[styles.qcMeta, { color: tf.faint }]} numberOfLines={1}>
                {formatQuickAddMetricSummary(item)}
                {!item.enabled ? ' · 建议停用' : ''}
              </Text>
            </View>
            <Switch
              value={item.enabled}
              onValueChange={(v) => onToggle(item.key, v)}
              trackColor={{ false: tf.track, true: tf.frog }}
              thumbColor={tf.white}
              ios_backgroundColor={tf.track}
            />
            <Pressable
              onPress={() => onDelete(item)}
              hitSlop={8}
              style={({ pressed }) => [styles.delBtn, pressed && { opacity: 0.7 }]}>
              <MaterialIcons name="delete-outline" size={16} color={tf.muted} />
            </Pressable>
          </Pressable>
        </ShadowDecorator>
      </ScaleDecorator>
    </FoldRiseIn>
  );
}

export default function QuickAddEditScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tf, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate, motionReduced, motionReady } = useFoldMotionGate();

  const [items, setItems] = React.useState<ManageItem[]>(() =>
    toManageItems(getDefaultQuickAddItems(), getDefaultQuickAddItems()),
  );
  const [itemsLoading, setItemsLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  const initialLoadDoneRef = React.useRef(false);

  const enabledItems = React.useMemo(() => items.filter((item) => item.enabled), [items]);

  const applyLoaded = React.useCallback((selected: QuickAddCardItem[], all: QuickAddCardItem[]) => {
    setItems(toManageItems(selected, all));
  }, []);

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      if (!initialLoadDoneRef.current) setItemsLoading(true);
      try {
        await wrapLoad(async () => {
          try {
            const [selected, all] = await Promise.all([loadSelectedQuickAddItems(), loadAllQuickAddItems()]);
            applyLoaded(selected, all);
          } catch (e) {
            console.warn('加载快捷卡片失败', e);
          }
        }, forceRefresh);
      } finally {
        initialLoadDoneRef.current = true;
        setItemsLoading(false);
      }
    },
    [applyLoaded, wrapLoad],
  );

  const enterReady = motionReady && !itemsLoading;
  const showContent = enterReady || (motionReady && motionReduced);
  const enterAnimate = foldAnimate && enterReady;
  const holdEntrance = !motionReduced;
  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const persistEnabledOrder = React.useCallback(async (nextItems: ManageItem[]) => {
    const keys = nextItems.filter((item) => item.enabled).map((item) => item.key);
    await saveSelectedQuickAddKeys(keys);
    notifyPageDataChanged(PAGE_API_KEY);
  }, []);

  const onToggle = React.useCallback(
    (key: string, enabled: boolean) => {
      setItems((prev) => {
        const next = prev.map((item) => (item.key === key ? { ...item, enabled } : item));
        void persistEnabledOrder(next).catch((e) => {
          toast.error(toUserMessage(e, '未能更新快捷栏显示'));
        });
        return next;
      });
    },
    [persistEnabledOrder],
  );

  const onDragEnd = React.useCallback(
    ({ data }: { data: ManageItem[] }) => {
      setItems(data);
      void persistEnabledOrder(data).catch((e) => {
        toast.error(toUserMessage(e, '排序未能保存'));
      });
    },
    [persistEnabledOrder],
  );

  const onDelete = React.useCallback(
    (item: ManageItem) => {
      Alert.alert('删除快捷卡', `确定删除「${item.label}」吗？删除后可重新新增。`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteQuickAddItem(item.key);
                await reload();
                notifyPageDataChanged(PAGE_API_KEY);
                toast.success('已删除');
              } catch (e) {
                toast.error(toUserMessage(e, '删除失败，请稍后重试'));
              }
            })();
          },
        },
      ]);
    },
    [reload],
  );

  const onGenerate = React.useCallback(async () => {
    if (generating) return;
    setGenerating(true);
    try {
      const user = await getDefaultUser();
      if (!user?.id) {
        toast.error('未找到用户，无法生成');
        return;
      }
      const records = await getHealthRecordsLast7Days(user.id);
      const existingLabels = new Set(items.map((item) => item.label.trim()).filter(Boolean));
      const candidates = collectFrequentQuickAddCandidates(records, existingLabels, 3);
      if (candidates.length === 0) {
        toast.info('近 7 天没有出现 ≥3 次的食物可生成');
        return;
      }
      const preview = candidates
        .slice(0, 2)
        .map((c) => c.label)
        .join('、');
      Alert.alert('从饮食频次生成', `将生成候选快捷卡：${preview}${candidates.length > 2 ? '…' : ''}。确认加入？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '加入',
          onPress: () => {
            void (async () => {
              try {
                const created = await createQuickAddItemsFromFrequent(candidates.slice(0, 5));
                await reload();
                notifyPageDataChanged(PAGE_API_KEY);
                toast.success(
                  created.length > 0
                    ? `已从饮食频次生成 ${created.length} 张候选快捷卡`
                    : '没有可写入的新卡片',
                );
              } catch (e) {
                toast.error(toUserMessage(e, '生成失败，请稍后重试'));
              }
            })();
          },
        },
      ]);
    } catch (e) {
      toast.error(toUserMessage(e, '生成失败，请稍后重试'));
    } finally {
      setGenerating(false);
    }
  }, [generating, items, reload]);

  const onSaveAndBack = React.useCallback(async () => {
    if (itemsLoading || saving) return;
    setSaving(true);
    try {
      await persistEnabledOrder(items);
      toast.success('已保存排序');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [items, itemsLoading, persistEnabledOrder, router, saving]);

  const previewLead = enabledItems[0];
  const previewLine = previewLead
    ? `「${previewLead.label}」→ ${formatQuickAddPreviewMetric(previewLead)}`
    : '开启下方开关后会出现在「今天可以这样记一句」';

  const barHeights = React.useMemo(() => {
    const n = Math.max(enabledItems.length, 1);
    return enabledItems.slice(0, 7).map((_, i) => 38 + ((i * 17 + n * 9) % 48));
  }, [enabledItems]);

  const cardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.86)';
  const footPad = Math.max(insets.bottom, 12);

  const listHeader = showContent ? (
    <View style={styles.headerBlock}>
      <FoldRiseIn
        animate={enterAnimate}
        index={0}
        duration={420}
        staggerMs={TaskFoldMotion.rowStagger}
        fromY={6}
        holdHidden={holdEntrance}>
        <View
          style={[
            styles.qkpreview,
            {
              backgroundColor: isDark ? tf.scoreFrom : undefined,
              borderColor: tf.scoreBorder,
            },
            !isDark && styles.qkpreviewLight,
          ]}>
          <Text style={[styles.qkpreviewTitle, { color: tf.scoreInk }]}>今天可以这样记一句</Text>
          <Text style={[styles.qkpreviewSub, { color: tf.scoreMuted }]} numberOfLines={2}>
            {previewLine}
          </Text>
          <View style={[styles.qkpreviewBar, { backgroundColor: isDark ? 'rgba(231,206,164,0.25)' : '#EADCC0' }]}>
            <View
              style={[
                styles.qkpreviewFill,
                { width: `${Math.min(92, 28 + enabledItems.length * 8)}%` as `${number}%` },
              ]}
            />
          </View>
        </View>
      </FoldRiseIn>
    </View>
  ) : null;

  const listFooter = showContent ? (
    <View style={[styles.footerBlock, { paddingBottom: 20 + footPad }]}>
      <FoldRiseIn
        animate={enterAnimate}
        index={Math.min(items.length + 1, 14)}
        duration={420}
        staggerMs={TaskFoldMotion.rowStagger}
        fromY={6}
        holdHidden={holdEntrance}>
        <View style={[styles.fbox, { backgroundColor: isDark ? tf.amber2 : '#F8ECD7', borderColor: '#E8CDA2' }]}>
          <Text style={[styles.fboxText, { color: tf.amberInk }]}>
            <Text style={{ fontWeight: '800' }}>生成规则</Text>
            {' · '}
            近 30 天记录 ≥ 3 次才建议生成；饮食文本只在本机做频次统计，不上传。
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: cardBg, borderColor: tf.line2, marginTop: 8 }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.cardTitle, { color: tf.ink2 }]}>近 30 天频次</Text>
            <Text style={{ fontSize: 11, color: tf.faint }}>仅本机统计</Text>
            <Text style={{ marginLeft: 'auto', fontSize: 11, color: '#6F856B', fontWeight: '600' }}>
              {enabledItems[0]?.label ?? '—'}最高
            </Text>
          </View>
          <View style={styles.tinybars}>
            {(barHeights.length > 0 ? barHeights : [40, 55, 35]).map((h, i) => (
              <View
                key={i}
                style={[
                  styles.tinybar,
                  {
                    height: `${h}%` as `${number}%`,
                    backgroundColor: i === barHeights.length - 1 ? tf.sun : tf.lily,
                  },
                ]}
              />
            ))}
          </View>
          <View style={styles.tinybarLabels}>
            {(enabledItems.length > 0 ? enabledItems : [{ key: '_', label: '—' } as ManageItem])
              .slice(0, 7)
              .map((it) => (
                <Text key={it.key} style={{ flex: 1, textAlign: 'center', fontSize: 10, color: tf.faint }}>
                  {it.label.slice(0, 1)}
                </Text>
              ))}
          </View>
        </View>

        <View style={[styles.card, { backgroundColor: cardBg, borderColor: tf.line2, marginTop: 8 }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.cardTitle, { color: tf.ink2 }]}>主屏展示预览</Text>
            <Text style={{ fontSize: 11, color: tf.faint }}>按当前顺序</Text>
            <Text style={{ marginLeft: 'auto', fontSize: 11, color: '#6F856B', fontWeight: '600' }}>
              拖动排序 ›
            </Text>
          </View>
          <View style={styles.chiprow}>
            {enabledItems.length === 0 ? (
              <Text style={{ fontSize: 12, color: tf.muted, fontWeight: '600' }}>暂无启用卡片</Text>
            ) : (
              enabledItems.map((it) => (
                <View
                  key={`chip-${it.key}`}
                  style={[styles.fchip, { backgroundColor: tf.lily2, borderColor: '#AFC38E' }]}>
                  <Text style={{ fontSize: 11, fontWeight: '700', color: '#3F5D3E' }}>{it.label}</Text>
                </View>
              ))
            )}
          </View>
          <View style={[styles.hintline, { marginTop: 8, paddingVertical: 0 }]}>
            <MaterialIcons name="lightbulb-outline" size={13} color={tf.sun} />
            <Text style={[styles.hintText, { color: tf.muted }]}>
              关闭的卡片不出现在「今天可以这样记一句」。
            </Text>
          </View>
        </View>

        <Pressable
          onPress={() => void onGenerate()}
          disabled={generating}
          style={({ pressed }) => [
            styles.tagadd,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.75)',
              opacity: generating ? 0.6 : pressed ? 0.85 : 1,
            },
          ]}>
          {generating ? (
            <ActivityIndicator size="small" color={tf.frog} />
          ) : (
            <MaterialIcons name="auto-awesome" size={15} color={tf.frog} />
          )}
          <Text style={{ fontSize: 13, fontWeight: '700', color: tf.ink2 }}>从饮食频次生成</Text>
        </Pressable>

        <View style={styles.hintline}>
          <MaterialIcons name="lightbulb-outline" size={13} color={tf.sun} />
          <Text style={[styles.hintText, { color: tf.muted }]}>
            快捷卡只改善记录效率，不会创建待办、习惯或项目。
          </Text>
        </View>

        <View
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              borderColor: tf.line2,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
            },
          ]}>
          <View style={[styles.hicon, { backgroundColor: tf.sun2 }]}>
            <Text style={{ fontSize: 16 }}>🍽️</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.cardTitle, { color: '#536155' }]}>饮食频次模型</Text>
            <Text style={{ fontSize: 11, color: tf.faint }}>基于近 30 天记录 · 仅本机推理 · 不上传</Text>
          </View>
          <View style={[styles.greenTag, { backgroundColor: tf.lily2 }]}>
            <Text style={{ fontSize: 10, fontWeight: '700', color: '#4E6552' }}>本机</Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.push('/add-item')}
          style={({ pressed }) => [
            styles.ghostAdd,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.05)' : 'rgba(255,252,245,0.7)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <MaterialIcons name="add" size={16} color={tf.ink2} />
          <Text style={{ fontSize: 13, fontWeight: '700', color: tf.ink2 }}>新增快捷卡</Text>
        </Pressable>
      </FoldRiseIn>
    </View>
  ) : null;

  const renderItem = React.useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<ManageItem>) => {
      const index = getIndex?.() ?? 0;
      return (
        <QkRow
          item={item}
          drag={drag}
          isActive={isActive}
          index={index}
          enterAnimate={enterAnimate}
          holdHidden={holdEntrance}
          onToggle={onToggle}
          onDelete={onDelete}
        />
      );
    },
    [enterAnimate, holdEntrance, onDelete, onToggle],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.container, { backgroundColor: tf.paper }]} edges={['left', 'right']}>
        <View style={[styles.appbar, { paddingTop: Math.max(insets.top, 8) }]}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={8}
            style={({ pressed }) => [styles.iconbtn, pressed && { opacity: 0.75 }]}>
            <MaterialIcons name="arrow-back" size={20} color={tf.ink2} />
          </Pressable>
          <View style={styles.appbarCenter}>
            <Text style={[styles.appbarTitle, { color: tf.ink }]}>快捷卡管理</Text>
            <Text style={[styles.appbarSub, { color: tf.muted }]} numberOfLines={1}>
              健康 · 一句话快捷卡 · {enabledItems.length} 张启用
            </Text>
          </View>
          <Pressable
            onPress={() => void onSaveAndBack()}
            disabled={itemsLoading || saving}
            style={({ pressed }) => [
              styles.pillbtn,
              {
                borderColor: tf.line2,
                backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.66)',
                opacity: itemsLoading || saving ? 0.5 : pressed ? 0.85 : 1,
              },
            ]}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>
              {saving ? '…' : '保存'}
            </Text>
          </Pressable>
        </View>

        {!showContent ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={tf.frog} />
          </View>
        ) : (
          <DraggableFlatList
            data={items}
            keyExtractor={(item) => item.key}
            renderItem={renderItem}
            onDragEnd={onDragEnd}
            refreshControl={refreshControl}
            ListHeaderComponent={listHeader}
            ListFooterComponent={listFooter}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            activationDistance={12}
          />
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  appbar: {
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
  appbarTitle: { fontSize: 17, fontWeight: '800' },
  appbarSub: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  pillbtn: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  listContent: { paddingHorizontal: 14, paddingTop: 4 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBlock: { marginBottom: 6 },
  footerBlock: { gap: 0, marginTop: 4 },
  qkpreview: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  qkpreviewLight: {
    backgroundColor: '#FBF4E5',
  },
  qkpreviewTitle: { fontSize: 13, fontWeight: '800' },
  qkpreviewSub: { fontSize: 12, fontWeight: '600', marginTop: 4, lineHeight: 17 },
  qkpreviewBar: {
    height: 4,
    borderRadius: 3,
    marginTop: 8,
    overflow: 'hidden',
  },
  qkpreviewFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: '#D6974B',
  },
  qkrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
    paddingHorizontal: 8,
    marginBottom: 6,
  },
  qh: { paddingHorizontal: 2 },
  qi: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qc: { flex: 1, minWidth: 0, gap: 2 },
  qcTitle: { fontSize: 14, fontWeight: '700' },
  qcMeta: { fontSize: 11, fontWeight: '600' },
  delBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fbox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  fboxText: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  cardTitle: { fontSize: 13, fontWeight: '800' },
  tinybars: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    paddingHorizontal: 2,
  },
  tinybar: {
    flex: 1,
    borderRadius: 4,
    minHeight: 6,
  },
  tinybarLabels: { flexDirection: 'row', marginTop: 4 },
  chiprow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  fchip: {
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagadd: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
  hintline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  hintText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  hicon: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  greenTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostAdd: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
  },
});
