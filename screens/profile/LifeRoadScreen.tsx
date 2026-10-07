/**
 * 道路子页：总方向编辑 + 按时间桶分组的赌注列表 CRUD / 同桶排序。
 */
import {
  AppButton,
  AppInput,
  AppScreen,
  ScreenHeader,
  ScreenHeaderIconAction,
} from '@/components/ui';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import {
  getMinTouchTarget,
  getTaskUiColors,
  Radius,
  Spacing,
} from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  getLifeBetDerivedStats,
  listActiveProjectsForLifeBet,
  type LifeBetActiveProjectRef,
  type LifeBetDerivedStats,
} from '@/lib/life-road/life-road-derived';
import {
  formatLifeBetDerivedCaption,
  LIFE_BET_HORIZON_LABELS,
  LIFE_BET_STATUS_LABELS,
  lifeBetStatusTone,
} from '@/lib/life-road/life-road-labels';
import {
  currentCalendarYear,
  LIFE_BET_YEAR_ACTIVE_LIMIT,
  type LifeBetHorizon,
} from '@/lib/life-road/life-road-limits';
import {
  countActiveYearBetsLocal,
  deleteLifeBet,
  getLifeBets,
  updateLifeBet,
} from '@/lib/repositories/life-road/life-bet';
import type { LifeBetRow } from '@/lib/repositories/life-road/life-bet.types';
import {
  getLifeDirection,
  upsertLifeDirection,
} from '@/lib/repositories/life-road/life-direction';
import type { LifeDirectionRow } from '@/lib/repositories/life-road/life-direction.types';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';

const PAGE_KEY = 'life-road';
const MIN_TOUCH = getMinTouchTarget(Platform.OS);
const HORIZON_ORDER: LifeBetHorizon[] = ['year', 'multi', 'farther'];

type BetView = {
  bet: LifeBetRow;
  derived: LifeBetDerivedStats;
  projects: LifeBetActiveProjectRef[];
  projectTotal: number;
};

/** 同桶内交换 sort_order */
async function swapSortOrder(a: LifeBetRow, b: LifeBetRow): Promise<void> {
  const orderA = a.sort_order;
  const orderB = b.sort_order;
  if (orderA === orderB) {
    await updateLifeBet(a.id, { sort_order: orderA - 1 });
    await updateLifeBet(b.id, { sort_order: orderB + 1 });
    return;
  }
  await updateLifeBet(a.id, { sort_order: orderB });
  await updateLifeBet(b.id, { sort_order: orderA });
}

function IconAction({
  icon,
  label,
  color,
  disabled,
  onPress,
}: {
  icon: 'keyboard-arrow-up' | 'keyboard-arrow-down' | 'delete-outline';
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconAction,
        {
          opacity: disabled ? 0.28 : pressed ? 0.7 : 1,
          minWidth: MIN_TOUCH * 0.85,
          minHeight: MIN_TOUCH * 0.85,
        },
      ]}>
      <AppIcon name={icon} size={22} color={color} />
    </Pressable>
  );
}

export default function LifeRoadScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const taskUi = getTaskUiColors(isDark);
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(PAGE_KEY);

  const [direction, setDirection] = useState<LifeDirectionRow | null>(null);
  const [bets, setBets] = useState<BetView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingDirection, setEditingDirection] = useState(false);
  const editingDirectionRef = useRef(false);
  editingDirectionRef.current = editingDirection;
  const [bodyDraft, setBodyDraft] = useState('');
  const [themeDraft, setThemeDraft] = useState('');
  const [savingDirection, setSavingDirection] = useState(false);
  const [yearActiveCount, setYearActiveCount] = useState(0);
  const [showDropped, setShowDropped] = useState(false);

  const reload = useCallback(
    async (forceRefresh = false) => {
      setLoadError(null);
      try {
        await wrapLoad(async () => {
          const [nextDirection, nextBets] = await Promise.all([
            getLifeDirection({ serverFallback: true }),
            getLifeBets({ serverFallback: true }),
          ]);
          const views: BetView[] = await Promise.all(
            nextBets.map(async (bet) => {
              const [derived, linked] = await Promise.all([
                getLifeBetDerivedStats(bet.id, bet.status),
                listActiveProjectsForLifeBet(bet.id, 3),
              ]);
              return {
                bet,
                derived,
                projects: linked?.projects ?? [],
                projectTotal: linked?.total ?? 0,
              };
            }),
          );
          const activeYear = await countActiveYearBetsLocal(currentCalendarYear());
          setDirection(nextDirection);
          setBets(views);
          setYearActiveCount(activeYear);
          if (!editingDirectionRef.current) {
            setBodyDraft(nextDirection?.body ?? '');
            setThemeDraft(nextDirection?.year_theme ?? '');
          }
        }, forceRefresh);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [wrapLoad],
  );

  const { onRefresh: onRefreshData } = usePagePullRefresh(PAGE_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const grouped = useMemo(() => {
    const map: Record<LifeBetHorizon, BetView[]> = {
      year: [],
      multi: [],
      farther: [],
    };
    for (const view of bets) {
      if (!showDropped && view.bet.status === 'dropped') continue;
      map[view.bet.horizon].push(view);
    }
    return map;
  }, [bets, showDropped]);

  const droppedCount = useMemo(
    () => bets.filter((b) => b.bet.status === 'dropped').length,
    [bets],
  );

  const openAdd = useCallback(
    (horizon: LifeBetHorizon) => {
      if (horizon === 'year' && yearActiveCount >= LIFE_BET_YEAR_ACTIVE_LIMIT) {
        Alert.alert(
          '今年已满',
          `今年进行中的道路赌注最多 ${LIFE_BET_YEAR_ACTIVE_LIMIT} 条（在路上/暂搁）。已抵达或放弃不占名额。`,
        );
        return;
      }
      router.push({
        pathname: '/edit-life-bet/[id]',
        params: { id: 'new', horizon },
      });
    },
    [router, yearActiveCount],
  );

  const onSaveDirection = useCallback(async () => {
    if (!bodyDraft.trim()) {
      Alert.alert('请填写总方向');
      return;
    }
    setSavingDirection(true);
    try {
      const row = await upsertLifeDirection({
        id: direction?.id,
        body: bodyDraft,
        year_theme: themeDraft,
      });
      setDirection(row);
      setEditingDirection(false);
      notifyAncestorsDataChanged();
      await reload();
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请检查网络后重试');
    } finally {
      setSavingDirection(false);
    }
  }, [bodyDraft, themeDraft, direction?.id, notifyAncestorsDataChanged, reload]);

  const onDeleteBet = useCallback(
    (bet: LifeBetRow) => {
      Alert.alert('删除这条道路？', '项目不会被删除，只会取消归属。', [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteLifeBet(bet.id);
                notifyAncestorsDataChanged();
                await reload();
              } catch (e) {
                Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后重试');
              }
            })();
          },
        },
      ]);
    },
    [notifyAncestorsDataChanged, reload],
  );

  const onMove = useCallback(
    async (horizon: LifeBetHorizon, index: number, dir: -1 | 1) => {
      const list = grouped[horizon];
      const other = list[index + dir];
      const self = list[index];
      if (!self || !other) return;
      try {
        await swapSortOrder(self.bet, other.bet);
        notifyAncestorsDataChanged();
        await reload();
      } catch (e) {
        Alert.alert('排序失败', e instanceof Error ? e.message : '请稍后重试');
      }
    },
    [grouped, notifyAncestorsDataChanged, reload],
  );

  const muted = colors.textSecondary;

  return (
    <AppScreen
      loading={loading}
      onRefreshData={onRefreshData}
      header={
        <ScreenHeader
          title="道路"
          onBack={() => router.back()}
          right={
            <ScreenHeaderIconAction
              icon="add"
              onPress={() => openAdd('year')}
              accessibilityLabel="添加今年赌注"
            />
          }
        />
      }
      contentContainerStyle={styles.content}>
      {loadError ? (
        <View
          style={[
            styles.errorCard,
            { backgroundColor: taskUi.dangerSoftWash, borderColor: taskUi.dangerSoftBorder },
          ]}>
          <AppText variant="body" style={{ color: colors.danger, textAlign: 'center' }}>
            {loadError}
          </AppText>
          <AppButton label="重试" variant="outline" onPress={() => void reload(true)} />
        </View>
      ) : null}

      <View
        style={[
          styles.directionCard,
          { backgroundColor: colors.surface, borderColor: colors.outline },
        ]}>
        <View style={styles.sectionHeader}>
          <View style={styles.sectionTitleRow}>
            <View
              style={[
                styles.sectionIcon,
                { backgroundColor: taskUi.primaryWash, borderColor: taskUi.primaryWashBorder },
              ]}>
              <AppIcon name="explore" size={18} color={colors.primary} />
            </View>
            <AppText variant="title" style={{ color: colors.text, fontWeight: '700' }}>
              总方向
            </AppText>
          </View>
          {!editingDirection ? (
            <Pressable
              onPress={() => {
                setBodyDraft(direction?.body ?? '');
                setThemeDraft(direction?.year_theme ?? '');
                setEditingDirection(true);
              }}
              hitSlop={8}
              style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1 }]}>
              <AppText variant="bodyStrong" chrome style={{ color: colors.primary, fontSize: 14 }}>
                {direction ? '编辑' : '写下'}
              </AppText>
            </Pressable>
          ) : null}
        </View>

        {editingDirection ? (
          <View style={styles.formGap}>
            <AppInput
              label="总方向（1–200 字）"
              value={bodyDraft}
              onChangeText={setBodyDraft}
              multiline
              maxLength={200}
              inputStyle={{ minHeight: 96, textAlignVertical: 'top' }}
            />
            <AppInput
              label="年主题（可选，最多 40 字）"
              value={themeDraft}
              onChangeText={setThemeDraft}
              maxLength={40}
              placeholder="如 2026：底座年"
            />
            <View style={styles.rowActions}>
              <AppButton
                label="取消"
                variant="ghost"
                onPress={() => setEditingDirection(false)}
                style={{ flex: 1 }}
              />
              <AppButton
                label="保存"
                loading={savingDirection}
                onPress={() => void onSaveDirection()}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        ) : direction ? (
          <View style={styles.directionBodyWrap}>
            <AppText variant="body" style={[styles.directionBody, { color: colors.text }]}>
              {direction.body}
            </AppText>
            {direction.year_theme ? (
              <View
                style={[
                  styles.themeChip,
                  { backgroundColor: taskUi.primaryWash, borderColor: taskUi.primaryWashBorder },
                ]}>
                <AppText variant="caption" chrome style={{ color: colors.primary }}>
                  {direction.year_theme}
                </AppText>
              </View>
            ) : null}
          </View>
        ) : (
          <View
            style={[
              styles.emptyPanel,
              { backgroundColor: taskUi.primaryWash, borderColor: taskUi.primaryWashBorder },
            ]}>
            <AppText variant="body" style={{ color: muted, lineHeight: 22 }}>
              还没有写下方向。用来看清未来几年押什么，不是用来排任务。
            </AppText>
          </View>
        )}
      </View>

      {HORIZON_ORDER.map((horizon) => {
        const list = grouped[horizon];
        const yearFull =
          horizon === 'year' && yearActiveCount >= LIFE_BET_YEAR_ACTIVE_LIMIT;
        return (
          <View key={horizon} style={styles.sectionBlock}>
            <View style={styles.sectionHeader}>
              <AppText variant="title" style={{ color: colors.text, fontWeight: '700' }}>
                {LIFE_BET_HORIZON_LABELS[horizon]}
              </AppText>
              <Pressable
                onPress={() => openAdd(horizon)}
                disabled={yearFull}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.addChip,
                  {
                    backgroundColor: yearFull ? colors.surfaceMuted : taskUi.primaryWash,
                    borderColor: yearFull ? colors.outline : taskUi.primaryWashBorder,
                    opacity: yearFull ? 0.7 : pressed ? 0.85 : 1,
                  },
                ]}>
                <AppIcon
                  name="add"
                  size={16}
                  color={yearFull ? muted : colors.primary}
                />
                <AppText
                  variant="caption"
                  chrome
                  style={{ color: yearFull ? muted : colors.primary, fontWeight: '700' }}>
                  {yearFull ? '已满 5 条' : '添加'}
                </AppText>
              </Pressable>
            </View>

            {list.length === 0 ? (
              <View
                style={[
                  styles.emptySlot,
                  { borderColor: colors.outline, backgroundColor: colors.surfaceSubtle },
                ]}>
                <AppText variant="body" style={{ color: muted }}>
                  {horizon === 'year' ? '今年还没有下注' : '这一段还空着'}
                </AppText>
              </View>
            ) : (
              <View
                style={[
                  styles.betGroup,
                  { backgroundColor: colors.surface, borderColor: colors.outline },
                ]}>
                {list.map((view, index) => {
                  const caption = formatLifeBetDerivedCaption(view.derived);
                  const statusLabel = LIFE_BET_STATUS_LABELS[view.bet.status];
                  const tone = lifeBetStatusTone(view.bet.status, taskUi, colors);
                  const isLast = index === list.length - 1;
                  return (
                    <View
                      key={view.bet.id}
                      style={[
                        styles.betItem,
                        !isLast && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: colors.outline,
                        },
                      ]}>
                      <Pressable
                        onPress={() =>
                          router.push({
                            pathname: '/edit-life-bet/[id]',
                            params: { id: view.bet.id },
                          })
                        }
                        style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}>
                        <View style={styles.betTop}>
                          <AppText
                            variant="bodyStrong"
                            style={[styles.betTitle, { color: colors.text }]}
                            numberOfLines={2}>
                            {view.bet.title}
                          </AppText>
                          <View
                            style={[
                              styles.statusTag,
                              { backgroundColor: tone.bg, borderColor: tone.border },
                            ]}>
                            <AppText
                              variant="caption"
                              chrome
                              style={{ color: tone.text, fontWeight: '700' }}>
                              {statusLabel}
                            </AppText>
                          </View>
                        </View>
                        <AppText
                          variant="caption"
                          chrome
                          style={{ color: muted, marginTop: 4 }}
                          numberOfLines={2}>
                          {caption}
                        </AppText>
                        {view.projects.length > 0 ? (
                          <View style={styles.projectNamesRow}>
                            {view.projects.map((p, i) => (
                              <React.Fragment key={p.id}>
                                {i > 0 ? (
                                  <AppText variant="caption" chrome style={{ color: muted }}>
                                    {' · '}
                                  </AppText>
                                ) : null}
                                <Pressable
                                  onPress={(e) => {
                                    e.stopPropagation?.();
                                    router.push({
                                      pathname: '/edit-project',
                                      params: { id: p.id },
                                    });
                                  }}
                                  hitSlop={6}
                                  accessibilityRole="button"
                                  accessibilityLabel={`打开项目 ${p.name}`}>
                                  <AppText
                                    variant="caption"
                                    chrome
                                    style={{
                                      color: colors.primary,
                                      fontWeight: '700',
                                      lineHeight: 18,
                                    }}
                                    numberOfLines={1}>
                                    {p.name}
                                  </AppText>
                                </Pressable>
                              </React.Fragment>
                            ))}
                            {view.projectTotal > view.projects.length ? (
                              <AppText variant="caption" chrome style={{ color: muted, lineHeight: 18 }}>
                                {` 等 ${view.projectTotal - view.projects.length} 个`}
                              </AppText>
                            ) : null}
                          </View>
                        ) : null}
                        {view.bet.note ? (
                          <AppText
                            variant="caption"
                            chrome
                            style={{ color: muted, marginTop: 4, lineHeight: 18 }}
                            numberOfLines={2}>
                            {view.bet.note}
                          </AppText>
                        ) : null}
                      </Pressable>
                      <View style={styles.betActions}>
                        <IconAction
                          icon="keyboard-arrow-up"
                          label="上移"
                          color={colors.primary}
                          disabled={index === 0}
                          onPress={() => void onMove(horizon, index, -1)}
                        />
                        <IconAction
                          icon="keyboard-arrow-down"
                          label="下移"
                          color={colors.primary}
                          disabled={index >= list.length - 1}
                          onPress={() => void onMove(horizon, index, 1)}
                        />
                        <IconAction
                          icon="delete-outline"
                          label="删除"
                          color={colors.danger}
                          onPress={() => onDeleteBet(view.bet)}
                        />
                        <View style={{ flex: 1 }} />
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/edit-life-bet/[id]',
                              params: { id: view.bet.id },
                            })
                          }
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.editLink,
                            { opacity: pressed ? 0.75 : 1 },
                          ]}>
                          <AppText
                            variant="caption"
                            chrome
                            style={{ color: colors.primary, fontWeight: '700' }}>
                            编辑
                          </AppText>
                          <AppIcon name="chevron-right" size={16} color={colors.primary} />
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        );
      })}

      {droppedCount > 0 ? (
        <Pressable
          onPress={() => setShowDropped((v) => !v)}
          hitSlop={8}
          style={({ pressed }) => [
            styles.droppedToggle,
            {
              borderColor: colors.outline,
              backgroundColor: colors.surface,
              opacity: pressed ? 0.88 : 1,
            },
          ]}>
          <AppText variant="bodyStrong" chrome style={{ color: muted, fontSize: 13 }}>
            {showDropped ? '隐藏已放弃' : `显示已放弃（${droppedCount}）`}
          </AppText>
        </Pressable>
      ) : null}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing['6xl'],
    gap: Spacing['4xl'],
  },
  errorCard: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['3xl'],
    gap: Spacing.md,
  },
  directionCard: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['4xl'],
    gap: Spacing['3xl'],
  },
  sectionBlock: {
    gap: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  sectionIcon: {
    width: 32,
    height: 32,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionBodyWrap: {
    gap: Spacing.lg,
  },
  directionBody: {
    lineHeight: 24,
    fontWeight: '600',
  },
  themeChip: {
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
  },
  emptyPanel: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['3xl'],
  },
  emptySlot: {
    borderRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    paddingVertical: Spacing['4xl'],
    paddingHorizontal: Spacing['3xl'],
    alignItems: 'center',
  },
  formGap: {
    gap: Spacing.md,
  },
  rowActions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  betGroup: {
    borderRadius: Radius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  betItem: {
    paddingHorizontal: Spacing['3xl'],
    paddingTop: Spacing['3xl'],
    paddingBottom: Spacing.lg,
    gap: Spacing.sm,
  },
  betTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  betTitle: {
    flex: 1,
    lineHeight: 22,
  },
  projectNamesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    marginTop: 4,
  },
  statusTag: {
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  betActions: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.xs,
    gap: 2,
  },
  iconAction: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  editLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: Spacing.sm,
  },
  droppedToggle: {
    alignSelf: 'center',
    borderRadius: Radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: Spacing.lg,
  },
});
