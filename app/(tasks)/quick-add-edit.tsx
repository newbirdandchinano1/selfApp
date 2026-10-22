import { HealthRiseIn, useHealthMotionGate } from '@/components/health/health-motion';
import { useHealthHomeTheme } from '@/constants/health-home-theme';
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
import DraggableFlatList, { type RenderItemParams, ScaleDecorator } from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ManageItem = QuickAddCardItem & {
  icon: keyof typeof MaterialIcons.glyphMap;
  enabled: boolean;
};

const PAGE_API_KEY = 'quick-add-edit';

const WRITE_RULES = [
  { label: '多次点击', detail: '按次数累加，不覆盖' },
  { label: '删除记录', detail: '重算当天总量与积分' },
  { label: '停用卡片', detail: '只隐藏，不删除历史' },
] as const;

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

export default function QuickAddEditScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { hh } = useHealthHomeTheme();
  const { animate: entranceOn } = useHealthMotionGate();

  const [items, setItems] = React.useState<ManageItem[]>(() =>
    toManageItems(getDefaultQuickAddItems(), getDefaultQuickAddItems()),
  );
  const [itemsLoading, setItemsLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [generating, setGenerating] = React.useState(false);
  /** 首屏列表就绪后再播级联入场，避免加载闪一下 */
  const [listReady, setListReady] = React.useState(false);
  const enterPlayedRef = React.useRef(false);

  const enabledItems = React.useMemo(() => items.filter((item) => item.enabled), [items]);

  const applyLoaded = React.useCallback((selected: QuickAddCardItem[], all: QuickAddCardItem[]) => {
    setItems(toManageItems(selected, all));
  }, []);

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      setItemsLoading(true);
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
        setItemsLoading(false);
        if (!enterPlayedRef.current) {
          enterPlayedRef.current = true;
          setListReady(true);
        }
      }
    },
    [applyLoaded, wrapLoad],
  );

  const rowEnterOn = entranceOn && listReady;

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
      const created = await createQuickAddItemsFromFrequent(candidates.slice(0, 5));
      await reload();
      notifyPageDataChanged(PAGE_API_KEY);
      toast.success(created.length > 0 ? `已生成 ${created.length} 张快捷卡` : '没有可写入的新卡片');
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
      toast.success('已保存');
      router.back();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setSaving(false);
    }
  }, [items, itemsLoading, persistEnabledOrder, router, saving]);

  const openAdd = React.useCallback(() => {
    router.push('/add-item');
  }, [router]);

  const listHeader = (
    <View style={styles.headerBlock}>
      <View style={styles.navRow}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.7 }]}
        >
          <MaterialIcons name="arrow-back" size={22} color={hh.ink} />
        </Pressable>
        <Pressable
          onPress={openAdd}
          style={({ pressed }) => [
            styles.addPill,
            { borderColor: hh.lineStrong, backgroundColor: hh.card },
            pressed && { opacity: 0.8 },
          ]}
        >
          <MaterialIcons name="add" size={16} color={hh.pine} />
          <Text style={[styles.addPillText, { color: hh.pine }]}>新增</Text>
        </Pressable>
      </View>

      <Text style={[styles.title, { color: hh.ink }]}>快捷卡管理</Text>
      <Text style={[styles.subtitle, { color: hh.muted }]}>
        QUICK ADD · {items.length} 张
      </Text>
      <Text style={[styles.hint, { color: hh.faint }]}>
        长按拖动排序；关闭后不在今日快捷栏显示。点卡会立即写入一条当日增量记录。
      </Text>
    </View>
  );

  const listFooter = (
    <View style={[styles.footerBlock, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]}>
      <View style={[styles.generateCard, { backgroundColor: hh.sageSoft, borderColor: hh.line }]}>
        <View style={[styles.generateIcon, { backgroundColor: hh.card }]}>
          <MaterialIcons name="auto-awesome" size={18} color={hh.pine} />
        </View>
        <View style={styles.generateBody}>
          <Text style={[styles.generateTitle, { color: hh.ink }]}>从常用记录生成</Text>
          <Text style={[styles.generateHint, { color: hh.muted }]}>
            把最近 7 天出现 ≥3 次的食物变成快捷卡
          </Text>
        </View>
        <Pressable
          onPress={() => void onGenerate()}
          disabled={generating}
          style={({ pressed }) => [
            styles.generateBtn,
            { backgroundColor: hh.pine },
            (pressed || generating) && { opacity: 0.85 },
          ]}
        >
          {generating ? (
            <ActivityIndicator color={hh.onPine} size="small" />
          ) : (
            <Text style={[styles.generateBtnText, { color: hh.onPine }]}>生成</Text>
          )}
        </Pressable>
      </View>

      <View style={styles.previewHeader}>
        <Text style={[styles.previewTitle, { color: hh.ink }]}>今日快捷栏预览</Text>
        <Text style={[styles.previewSide, { color: hh.faint }]}>从左到右</Text>
      </View>

      {enabledItems.length === 0 ? (
        <View style={[styles.previewEmpty, { backgroundColor: hh.card, borderColor: hh.line }]}>
          <Text style={[styles.previewEmptyText, { color: hh.muted }]}>开启上方开关后会出现在预览</Text>
        </View>
      ) : (
        <View style={styles.previewRow}>
          {enabledItems.slice(0, 6).map((item) => (
            <View
              key={`preview-${item.key}`}
              style={[styles.previewTile, { backgroundColor: hh.card, borderColor: hh.line }]}
            >
              <View style={[styles.previewIcon, { backgroundColor: hh.sageSoft }]}>
                <MaterialIcons name={item.icon} size={20} color={hh.pine} />
              </View>
              <Text style={[styles.previewLabel, { color: hh.ink }]} numberOfLines={1}>
                {item.label}
              </Text>
              <Text style={[styles.previewMetric, { color: hh.muted }]} numberOfLines={1}>
                {formatQuickAddPreviewMetric(item)}
              </Text>
            </View>
          ))}
        </View>
      )}

      <Pressable
        onPress={openAdd}
        style={({ pressed }) => [
          styles.primaryBtn,
          { backgroundColor: hh.pine },
          pressed && { opacity: 0.9 },
        ]}
      >
        <MaterialIcons name="add" size={20} color={hh.onPine} />
        <Text style={[styles.primaryBtnText, { color: hh.onPine }]}>新增快捷卡</Text>
      </Pressable>

      <View style={[styles.rulesCard, { backgroundColor: hh.card, borderColor: hh.line }]}>
        <View style={styles.rulesHeader}>
          <Text style={[styles.rulesTitle, { color: hh.ink }]}>写入规则</Text>
          <Text style={[styles.rulesSide, { color: hh.faint }]}>所有入口一致</Text>
        </View>
        {WRITE_RULES.map((rule, index) => (
          <View
            key={rule.label}
            style={[
              styles.ruleRow,
              index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hh.line },
            ]}
          >
            <Text style={[styles.ruleLabel, { color: hh.inkSoft }]}>{rule.label}</Text>
            <Text style={[styles.ruleDetail, { color: hh.muted }]}>{rule.detail}</Text>
          </View>
        ))}
      </View>

      <Pressable
        onPress={() => void onSaveAndBack()}
        disabled={itemsLoading || saving}
        style={({ pressed }) => [
          styles.saveOutline,
          { borderColor: hh.lineStrong },
          (pressed || itemsLoading || saving) && { opacity: 0.75 },
        ]}
      >
        <Text style={[styles.saveOutlineText, { color: hh.pine }]}>
          {saving ? '保存中…' : '完成并返回'}
        </Text>
      </Pressable>
    </View>
  );

  const renderItem = React.useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<ManageItem>) => {
      const index = getIndex?.() ?? 0;
      return (
        <ScaleDecorator activeScale={1.03}>
          <HealthRiseIn animate={rowEnterOn} index={Math.min(index, 12)} staggerMs={45} duration={420}>
            <Pressable
              onLongPress={drag}
              delayLongPress={160}
              disabled={isActive}
              style={[
                styles.cardRow,
                {
                  backgroundColor: hh.card,
                  borderColor: hh.line,
                  opacity: isActive ? 0.92 : item.enabled ? 1 : 0.72,
                  shadowColor: hh.shadow,
                  shadowOpacity: isActive ? 0.18 : 0,
                  shadowRadius: isActive ? 12 : 0,
                  shadowOffset: { width: 0, height: isActive ? 6 : 0 },
                  elevation: isActive ? 4 : 0,
                },
              ]}
            >
              <Pressable onPressIn={drag} hitSlop={8} style={styles.dragHandle}>
                <MaterialIcons name="drag-indicator" size={20} color={hh.faint} />
              </Pressable>
              <View style={[styles.cardIcon, { backgroundColor: hh.sageSoft }]}>
                <MaterialIcons name={item.icon} size={22} color={hh.pine} />
              </View>
              <View style={styles.cardBody}>
                <Text style={[styles.cardTitle, { color: hh.ink }]} numberOfLines={1}>
                  {item.label}
                </Text>
                <Text style={[styles.cardMeta, { color: hh.muted }]} numberOfLines={2}>
                  {formatQuickAddMetricSummary(item)}
                </Text>
              </View>
              <Switch
                value={item.enabled}
                onValueChange={(v) => onToggle(item.key, v)}
                trackColor={{ false: hh.track, true: hh.pine }}
                thumbColor={hh.card}
              />
              <Pressable
                onPress={() => onDelete(item)}
                hitSlop={8}
                style={({ pressed }) => [styles.editBtn, pressed && { opacity: 0.7 }]}
              >
                <MaterialIcons name="edit" size={18} color={hh.muted} />
              </Pressable>
            </Pressable>
          </HealthRiseIn>
        </ScaleDecorator>
      );
    },
    [hh, onDelete, onToggle, rowEnterOn],
  );

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaView style={[styles.container, { backgroundColor: hh.paper }]} edges={['top']}>
        {itemsLoading && items.length === 0 ? (
          <View style={styles.loadingWrap}>
            {listHeader}
            <ActivityIndicator color={hh.pine} />
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
  listContent: { paddingHorizontal: 18, paddingTop: 4 },
  loadingWrap: { flex: 1, paddingHorizontal: 18, gap: 24 },
  headerBlock: { paddingTop: 4, paddingBottom: 14, gap: 6 },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  addPillText: { fontSize: 13, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  hint: { fontSize: 12, fontWeight: '600', lineHeight: 18, marginTop: 4 },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 10,
    marginBottom: 10,
  },
  dragHandle: { paddingHorizontal: 2 },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardBody: { flex: 1, minWidth: 0, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardMeta: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  editBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerBlock: { gap: 14, paddingTop: 6 },
  generateCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  generateIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  generateBody: { flex: 1, minWidth: 0, gap: 2 },
  generateTitle: { fontSize: 14, fontWeight: '800' },
  generateHint: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  generateBtn: {
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 56,
    alignItems: 'center',
  },
  generateBtnText: { fontSize: 13, fontWeight: '800' },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  previewTitle: { fontSize: 15, fontWeight: '800' },
  previewSide: { fontSize: 12, fontWeight: '600' },
  previewEmpty: {
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 20,
    alignItems: 'center',
  },
  previewEmptyText: { fontSize: 13, fontWeight: '600' },
  previewRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  previewTile: {
    width: '22%',
    minWidth: 72,
    flexGrow: 1,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 6,
  },
  previewIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewLabel: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  previewMetric: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 18,
    minHeight: 52,
    marginTop: 4,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '800' },
  rulesCard: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  rulesHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rulesTitle: { fontSize: 14, fontWeight: '800' },
  rulesSide: { fontSize: 11, fontWeight: '600' },
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 12,
  },
  ruleLabel: { fontSize: 13, fontWeight: '700' },
  ruleDetail: { fontSize: 12, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  saveOutline: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  saveOutlineText: { fontSize: 14, fontWeight: '800' },
});
