/**
 * 习惯情境 — 对齐设计稿 shot 25
 * 锁行降透明度 · 内联改名 · 添加弹簧 · FoldRiseIn 级联
 */
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { TaskFoldMotion, useTaskFoldTheme } from '@/constants/task-fold-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import {
  createHabitContext,
  deleteHabitContexts,
  getHabitContexts,
  renameHabitContext,
  updateHabitContextsSortOrder,
} from '@/lib/repositories/habits/habit-context';
import { getHabits } from '@/lib/repositories/habits/habit';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import React from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
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
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type ContextRow = {
  id: string;
  name: string;
  count: number;
  isDefault?: boolean;
  /** 库中无记录的遗留情境名（仅展示，不可改名删改） */
  isLegacy?: boolean;
};

const PAGE_API_KEY = 'habit-context';

const CTX_EMOJIS = ['☀️', '🚇', '🏃', '🌙', '☕', '🌆', '📚', '🌿', '🎯', '🧺', '💡', '🪴'];
const CTX_TINTS = ['#F5E6CB', '#E0EBE5', '#E9E4EF', '#EFEBDF', '#F5E6CB', '#E0EBE5', '#E8EFD9', '#F1E9E1'];

function contextVisual(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return {
    emoji: CTX_EMOJIS[h % CTX_EMOJIS.length],
    tint: CTX_TINTS[h % CTX_TINTS.length],
  };
}

function CtxRow({
  item,
  drag,
  isActive,
  index,
  enterAnimate,
  holdHidden,
  onRename,
  onDelete,
  onMigrate,
}: {
  item: ContextRow;
  drag: () => void;
  isActive: boolean;
  index: number;
  enterAnimate: boolean;
  holdHidden: boolean;
  onRename: (item: ContextRow) => void;
  onDelete: (item: ContextRow) => void;
  onMigrate: () => void;
}) {
  const { tf, isDark } = useTaskFoldTheme();
  /** 冻结首屏错峰，避免拖拽换序后 index 变化重播入场 */
  const staggerDelayRef = React.useRef(index * TaskFoldMotion.rowStagger);
  const locked = item.count > 0;
  const { emoji, tint } = contextVisual(item.name);
  const cardBg = isActive
    ? isDark
      ? 'rgba(255,252,245,0.12)'
      : '#FFFDF8'
    : locked
      ? isDark
        ? 'rgba(245,237,224,0.12)'
        : 'rgba(245,237,224,0.7)'
      : isDark
        ? 'rgba(255,252,245,0.06)'
        : 'rgba(255,252,245,0.8)';

  const meta = locked
    ? `被 ${item.count} 个习惯占用 · 删除前先迁移`
    : item.count > 0
      ? `${item.count} 个习惯`
      : '暂无习惯';

  return (
    <FoldRiseIn
      animate={enterAnimate}
      index={0}
      delayMs={staggerDelayRef.current}
      duration={420}
      staggerMs={0}
      fromY={6}
      holdHidden={holdHidden}>
      <ScaleDecorator activeScale={1.02}>
        <ShadowDecorator elevation={isActive ? 12 : 0} radius={14} opacity={0.16} color="#283028">
          <Pressable
            onLongPress={item.isLegacy ? undefined : drag}
            delayLongPress={TaskFoldMotion.sortLongPress}
            disabled={item.isLegacy}
            style={({ pressed }) => [
              styles.ctxrow,
              {
                backgroundColor: cardBg,
                borderColor: isActive ? '#D9C9AE' : tf.line2,
                opacity: locked ? (pressed && !isActive ? 0.7 : 0.78) : pressed && !isActive ? 0.92 : 1,
                transform: isActive ? [{ rotate: '-0.4deg' }] : undefined,
              },
            ]}>
            <View style={[styles.ctxic, { backgroundColor: isDark ? tf.lily2 : tint }]}>
              {locked ? (
                <MaterialIcons name="lock-outline" size={16} color={tf.faint} />
              ) : (
                <Text style={styles.ctxEmoji}>{emoji}</Text>
              )}
            </View>
            <View style={styles.ctxcopy}>
              <Text style={[styles.ctxTitle, { color: tf.ink2 }]} numberOfLines={1}>
                {item.name}
                {item.isDefault ? (
                  <Text style={{ color: tf.faint, fontWeight: '500' }}> · 系统</Text>
                ) : null}
              </Text>
              <Text style={[styles.ctxMeta, { color: tf.faint }]} numberOfLines={1}>
                {item.isLegacy ? `遗留情境 · ${meta}` : meta}
              </Text>
            </View>
            <View style={styles.ca}>
              {locked ? (
                <Pressable
                  onPress={onMigrate}
                  hitSlop={6}
                  style={({ pressed }) => [
                    styles.lockTag,
                    { backgroundColor: isDark ? tf.mist : '#E8EBE4', opacity: pressed ? 0.8 : 1 },
                  ]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#7A857D' }}>锁定</Text>
                </Pressable>
              ) : item.isLegacy ? null : (
                <>
                  <Pressable
                    onPress={() => onRename(item)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.caBtn, pressed && { opacity: 0.7 }]}>
                    <MaterialIcons name="edit" size={16} color={tf.muted} />
                  </Pressable>
                  <Pressable
                    onPress={() => onDelete(item)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.caBtn, pressed && { opacity: 0.7 }]}>
                    <MaterialIcons name="delete-outline" size={16} color={tf.muted} />
                  </Pressable>
                </>
              )}
            </View>
          </Pressable>
        </ShadowDecorator>
      </ScaleDecorator>
    </FoldRiseIn>
  );
}

export default function HabitContextScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { tf, fonts, isDark } = useTaskFoldTheme();
  const { animate: foldAnimate, motionReduced, motionReady } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [contextData, setContextData] = React.useState<ContextRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [inlineName, setInlineName] = React.useState('');
  const [adding, setAdding] = React.useState(false);
  const [renameTarget, setRenameTarget] = React.useState<ContextRow | null>(null);
  const [renameDraft, setRenameDraft] = React.useState('');
  const initialLoadDoneRef = React.useRef(false);

  const addSpring = useSharedValue(1);
  const addSpringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: addSpring.value }],
  }));

  /** 数据 + 动效偏好都就绪后再挂载，避免空壳闪一下再入场 */
  const enterReady = motionReady && !loading;
  const showContent = enterReady || (motionReady && motionReduced);
  const enterAnimate = foldAnimate && enterReady;
  const holdEntrance = !motionReduced;

  const reload = React.useCallback(
    async (forceRefresh = false) => {
      if (!initialLoadDoneRef.current) setLoading(true);
      await wrapLoad(async () => {
        try {
          const [contexts, habits] = await Promise.all([getHabitContexts(), getHabits()]);
          const countByContext = new Map<string, number>();
          habits.forEach((r) => {
            countByContext.set(r.context, (countByContext.get(r.context) ?? 0) + 1);
          });

          const orderedContexts = contexts.map((c) => ({ id: c.id, name: c.name }));
          const knownNames = new Set(orderedContexts.map((c) => c.name));
          const legacyContexts = Array.from(countByContext.keys())
            .filter((ctx) => !knownNames.has(ctx))
            .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));

          const next: ContextRow[] = [
            ...orderedContexts.map((ctx) => ({
              id: ctx.id,
              name: ctx.name,
              count: countByContext.get(ctx.name) ?? 0,
              isDefault: ctx.name === '全天',
            })),
            ...legacyContexts.map((name) => ({
              id: `legacy:${name}`,
              name,
              count: countByContext.get(name) ?? 0,
              isLegacy: true,
            })),
          ];
          setContextData(next);
        } catch (err) {
          console.warn('加载习惯情境失败', err);
        } finally {
          initialLoadDoneRef.current = true;
          setLoading(false);
        }
      }, forceRefresh);
    },
    [wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload]),
  );

  const persistOrder = React.useCallback(async (rows: ContextRow[]) => {
    try {
      const ids = rows.filter((r) => !r.isLegacy).map((r) => r.id);
      await updateHabitContextsSortOrder(ids);
    } catch (err) {
      console.warn('更新情境排序失败', err);
      toast.error(toUserMessage(err, '排序未能保存'));
    }
  }, []);

  const confirmDelete = React.useCallback(
    (item: ContextRow) => {
      if (item.isLegacy) return;
      if (item.count > 0) {
        Alert.alert(
          '无法删除',
          `「${item.name}」下仍有 ${item.count} 个习惯，请先在「打卡管理」中迁移或移除后再删除。`,
          [
            { text: '去打卡管理', onPress: () => router.push('/habit-manage') },
            { text: '知道了', style: 'cancel' },
          ],
        );
        return;
      }
      if (item.isDefault) {
        Alert.alert('无法删除', '系统默认情境「全天」不可删除。');
        return;
      }
      Alert.alert('删除情境', `确认删除「${item.name}」吗？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteHabitContexts([item.id]);
                await reload();
                toast.success('已删除');
              } catch (err) {
                toast.error(toUserMessage(err, '删除失败，请稍后重试'));
              }
            })();
          },
        },
      ]);
    },
    [reload, router],
  );

  const openRename = (item: ContextRow) => {
    if (item.isLegacy || item.isDefault) {
      if (item.isDefault) toast.info('系统默认情境不可改名');
      return;
    }
    setRenameDraft(item.name);
    setRenameTarget(item);
  };

  const saveRename = React.useCallback(() => {
    const target = renameTarget;
    const name = renameDraft.trim();
    if (!target || !name) return;
    void (async () => {
      try {
        await renameHabitContext(target.id, name);
        setRenameTarget(null);
        await reload();
        toast.success('已改名');
      } catch (err) {
        toast.error(toUserMessage(err, '改名失败'));
      }
    })();
  }, [reload, renameDraft, renameTarget]);

  const saveInlineAdd = React.useCallback(() => {
    const name = inlineName.trim();
    if (!name || adding) return;
    setAdding(true);
    addSpring.value = withSequence(
      withSpring(1.04, { damping: 14, stiffness: 220 }),
      withTiming(1, { duration: 160 }),
    );
    void (async () => {
      try {
        await createHabitContext(name);
        setInlineName('');
        await reload();
        toast.success(`已添加情境 · ${name}`);
      } catch (err) {
        toast.error(toUserMessage(err, '添加情境失败'));
      } finally {
        setAdding(false);
      }
    })();
  }, [addSpring, adding, inlineName, reload]);

  const totalHabits = React.useMemo(
    () => contextData.reduce((s, r) => s + r.count, 0),
    [contextData],
  );
  const activeContexts = React.useMemo(
    () => contextData.filter((r) => r.count > 0).length,
    [contextData],
  );
  const pendingMigrate = React.useMemo(
    () => contextData.filter((r) => r.isLegacy && r.count > 0),
    [contextData],
  );
  const orderPreview = React.useMemo(
    () =>
      contextData
        .filter((r) => !r.isLegacy && r.count > 0)
        .slice(0, 4)
        .map((r) => r.name)
        .join(' → ') || '按创建顺序',
    [contextData],
  );

  const footPad = Math.max(insets.bottom, 12);
  const cardBg = isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.86)';
  const footerRiseIndex = Math.min(contextData.length + 1, 14);

  const listHeader = showContent ? (
    <View style={styles.headerBlock}>
      <FoldRiseIn
        animate={enterAnimate}
        index={0}
        duration={420}
        staggerMs={TaskFoldMotion.rowStagger}
        fromY={6}
        holdHidden={holdEntrance}>
        <View style={[styles.fbox, { backgroundColor: isDark ? tf.amber2 : '#F8ECD7', borderColor: '#E8CDA2' }]}>
          <Text style={[styles.fboxText, { color: tf.amberInk }]}>
            <Text style={{ fontWeight: '800' }}>情境是习惯的容器</Text>
            {' · '}
            主屏小习惯窗格按情境折叠；删除前必须没有习惯占用，或先迁移。
          </Text>
        </View>
      </FoldRiseIn>
    </View>
  ) : null;

  const listFooter = showContent ? (
    <View style={[styles.footerBlock, { paddingBottom: 8 }]}>
      <FoldRiseIn
        animate={enterAnimate}
        index={footerRiseIndex}
        duration={420}
        staggerMs={TaskFoldMotion.rowStagger}
        fromY={6}
        holdHidden={holdEntrance}>
        {pendingMigrate.length > 0 ? (
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: tf.line2 }]}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardTitle, { color: tf.ink2 }]}>待迁移习惯</Text>
              <Pressable onPress={() => router.push('/habit-manage')} hitSlop={6}>
                <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>迁移 ›</Text>
              </Pressable>
            </View>
            {pendingMigrate.slice(0, 3).map((row) => (
              <View key={row.id} style={styles.histrow}>
                <Text style={styles.histEmoji}>🗓️</Text>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.histTitle, { color: tf.ink2 }]} numberOfLines={1}>
                    {row.name}
                  </Text>
                  <Text style={[styles.histMeta, { color: tf.faint }]} numberOfLines={1}>
                    仍有 {row.count} 个习惯占用 · 请先迁移
                  </Text>
                </View>
                <View style={[styles.amberTag, { backgroundColor: tf.amber2 }]}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: tf.amberInk }}>{row.count} 项</Text>
                </View>
              </View>
            ))}
          </View>
        ) : null}

        <View style={[styles.card, { backgroundColor: cardBg, borderColor: tf.line2, marginTop: 6 }]}>
          <View style={styles.cardHead}>
            <Text style={[styles.cardTitle, { color: tf.ink2 }]}>情境统计</Text>
            <Text style={{ fontSize: 11, color: tf.faint }}>本周</Text>
          </View>
          <View style={styles.miniStat3}>
            <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
              <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>{totalHabits}</Text>
              <Text style={[styles.miniStatLabel, { color: tf.faint }]}>全部习惯</Text>
            </View>
            <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
              <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>{activeContexts}</Text>
              <Text style={[styles.miniStatLabel, { color: tf.faint }]}>活跃情境</Text>
            </View>
            <View style={[styles.miniStatCell, { backgroundColor: isDark ? tf.paper2 : 'rgba(255,252,245,0.62)' }]}>
              <Text style={[styles.miniStatNum, { color: '#4E6552', fontFamily: fonts.mono }]}>
                {pendingMigrate.length}
              </Text>
              <Text style={[styles.miniStatLabel, { color: tf.faint }]}>待迁移</Text>
            </View>
          </View>
        </View>

        <Animated.View style={[styles.ctxadd, addSpringStyle]}>
          <TextInput
            value={inlineName}
            onChangeText={setInlineName}
            placeholder="输入情境名称，如「午休后」…"
            placeholderTextColor={tf.faint}
            style={[
              styles.finput,
              {
                color: tf.ink,
                borderColor: tf.line2,
                backgroundColor: isDark ? 'rgba(255,252,245,0.06)' : 'rgba(255,252,245,0.9)',
              },
            ]}
            onSubmitEditing={saveInlineAdd}
            returnKeyType="done"
          />
          <Pressable
            onPress={saveInlineAdd}
            disabled={!inlineName.trim() || adding}
            style={({ pressed }) => [
              styles.addBtn,
              {
                backgroundColor: tf.pond,
                opacity: !inlineName.trim() || adding ? 0.45 : pressed ? 0.88 : 1,
              },
            ]}>
            <Text style={{ color: tf.onPond, fontSize: 13, fontWeight: '800' }}>添加</Text>
          </Pressable>
        </Animated.View>

        <View style={styles.hintline}>
          <MaterialIcons name="lightbulb-outline" size={13} color={tf.sun} />
          <Text style={[styles.hintText, { color: tf.muted }]}>
            情境名称在同一账号内不可重复；排序跟随创建顺序，长按拖动可调整。
          </Text>
        </View>

        <View style={[styles.card, { backgroundColor: cardBg, borderColor: tf.line2, marginTop: 4 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={[styles.frogmark, { backgroundColor: tf.lily2 }]}>
              <MaterialIcons name="spa" size={16} color={tf.frog} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.cardTitle, { color: '#536155' }]}>主屏展示顺序</Text>
              <Text style={{ fontSize: 11, color: tf.faint }} numberOfLines={1}>
                {orderPreview}
              </Text>
            </View>
            <Text style={{ fontSize: 11, color: '#6F856B', fontWeight: '600' }}>调整 ›</Text>
          </View>
        </View>
      </FoldRiseIn>
    </View>
  ) : null;

  const renderItem = React.useCallback(
    ({ item, drag, isActive, getIndex }: RenderItemParams<ContextRow>) => {
      const index = getIndex?.() ?? 0;
      return (
        <CtxRow
          item={item}
          drag={drag}
          isActive={isActive}
          index={index}
          enterAnimate={enterAnimate}
          holdHidden={holdEntrance}
          onRename={openRename}
          onDelete={confirmDelete}
          onMigrate={() => router.push('/habit-manage')}
        />
      );
    },
    [confirmDelete, enterAnimate, holdEntrance, router],
  );

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
          <Text style={[styles.appbarTitle, { color: tf.ink }]}>习惯情境</Text>
          <Text style={[styles.appbarSub, { color: tf.muted }]} numberOfLines={1}>
            主屏按情境分组 · {contextData.filter((r) => !r.isLegacy).length} 个情境 · {totalHabits}{' '}
            个习惯
          </Text>
        </View>
        <Pressable
          onPress={() => {
            /* 聚焦底部输入 */
          }}
          style={({ pressed }) => [
            styles.pillbtn,
            {
              borderColor: tf.line2,
              backgroundColor: isDark ? 'rgba(255,252,245,0.08)' : 'rgba(255,252,245,0.66)',
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: tf.ink2 }}>＋ 新建</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={8}>
        {!showContent ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={tf.frog} />
          </View>
        ) : (
          <DraggableFlatList
            data={contextData}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            refreshControl={refreshControl}
            ListHeaderComponent={listHeader}
            ListFooterComponent={listFooter}
            contentContainerStyle={[styles.content, { paddingBottom: 72 + footPad }]}
            showsVerticalScrollIndicator={false}
            activationDistance={12}
            onDragEnd={({ data }) => {
              setContextData(data);
              void persistOrder(data);
            }}
          />
        )}
      </KeyboardAvoidingView>

      <View
        style={[
          styles.foot,
          {
            paddingBottom: footPad,
            backgroundColor: isDark ? 'rgba(20,28,24,0.94)' : 'rgba(244,240,232,0.94)',
            borderTopColor: tf.line,
          },
        ]}>
        <Pressable
          onPress={() => {
            toast.success('情境设置已保存');
            router.back();
          }}
          style={({ pressed }) => [
            styles.primary,
            { backgroundColor: tf.pond, opacity: pressed ? 0.9 : 1 },
          ]}>
          <Text style={{ color: tf.onPond, fontSize: 15, fontWeight: '800' }}>完成</Text>
        </Pressable>
      </View>

      <Modal
        visible={renameTarget != null}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameTarget(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setRenameTarget(null)} />
        <View
          style={[
            styles.modalCard,
            {
              backgroundColor: isDark ? tf.paper2 : '#FFFDF8',
              borderColor: tf.line2,
            },
          ]}>
          <Text style={[styles.modalTitle, { color: tf.ink }]}>内联改名</Text>
          <TextInput
            value={renameDraft}
            onChangeText={setRenameDraft}
            autoFocus
            placeholder="情境名称"
            placeholderTextColor={tf.faint}
            style={[
              styles.input,
              {
                color: tf.ink,
                borderColor: tf.line2,
                backgroundColor: isDark ? 'rgba(255,252,245,0.06)' : '#fff',
              },
            ]}
            onSubmitEditing={saveRename}
          />
          <View style={styles.modalActions}>
            <Pressable onPress={() => setRenameTarget(null)} style={styles.modalBtn}>
              <Text style={{ color: tf.muted, fontWeight: '700' }}>取消</Text>
            </Pressable>
            <Pressable
              onPress={saveRename}
              disabled={!renameDraft.trim()}
              style={[
                styles.modalBtnPrimary,
                { backgroundColor: tf.pond, opacity: !renameDraft.trim() ? 0.5 : 1 },
              ]}>
              <Text style={{ color: tf.onPond, fontWeight: '800' }}>保存</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  content: { paddingHorizontal: 14, paddingTop: 4 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerBlock: { marginBottom: 4 },
  footerBlock: { gap: 0, marginTop: 4 },
  fbox: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
  },
  fboxText: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
  ctxrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 6,
  },
  ctxic: {
    width: 36,
    height: 36,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctxEmoji: { fontSize: 16 },
  ctxcopy: { flex: 1, minWidth: 0, gap: 2 },
  ctxTitle: { fontSize: 14, fontWeight: '700' },
  ctxMeta: { fontSize: 11, fontWeight: '600' },
  ca: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  caBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  cardTitle: { fontSize: 13, fontWeight: '800' },
  histrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  histEmoji: { fontSize: 16 },
  histTitle: { fontSize: 13, fontWeight: '700' },
  histMeta: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  amberTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  miniStat3: { flexDirection: 'row', gap: 8 },
  miniStatCell: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 2,
  },
  miniStatNum: { fontSize: 18, fontWeight: '800' },
  miniStatLabel: { fontSize: 10, fontWeight: '600' },
  ctxadd: { flexDirection: 'row', gap: 8, marginTop: 10 },
  finput: {
    flex: 1,
    height: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '600',
  },
  addBtn: {
    width: 72,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintline: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  hintText: { flex: 1, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  frogmark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  primary: {
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(25,34,28,0.42)',
  },
  modalCard: {
    position: 'absolute',
    left: 22,
    right: 22,
    top: '28%',
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 16,
    gap: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '800' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    fontWeight: '600',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  modalBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  modalBtnPrimary: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
  },
});
