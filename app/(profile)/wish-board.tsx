import { AddWishBoardModal } from '@/components/wish-board/add-wish-board-modal';
import { AppButton, AppCard, AppScreen, ScreenHeader } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { fetchProfileWishBoard } from '@/lib/profile-page-api';
import {
  resolveWishBoardIconOption,
  wishBoardIconTintSoft,
} from '@/lib/constants/wish-board-icons';
import { subscribePointsBalanceChanged } from '@/lib/points-balance-events';
import {
  deleteWishBoardItem,
  deleteWishRedeemRecord,
  getPointsBalance,
  listWishBoardItems,
  listWishRedeemRecords,
  redeemWishBoardItem,
  resetPointsBalance,
} from '@/lib/repositories/wish-board/wish-board';
import type { WishBoardItemRow, WishRedeemRecord } from '@/lib/repositories/wish-board/wish-board.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

const WISH_BOARD_PAGE_KEY = 'wish-board';

function formatRedeemedAt(raw: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function WishBoardScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { wrapLoad, notifyAncestorsDataChanged } = usePageApiSync(WISH_BOARD_PAGE_KEY);

  const [balance, setBalance] = useState(0);
  const [items, setItems] = useState<WishBoardItemRow[]>([]);
  const [redeemRecords, setRedeemRecords] = useState<WishRedeemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addVisible, setAddVisible] = useState(false);
  const [resetting, setResetting] = useState(false);

  const activeItems = useMemo(() => items.filter(i => i.status === 'active'), [items]);

  const reload = useCallback(
    async (forceApi = false) => {
      setLoadError(null);
      try {
        await wrapLoad(async () => {
          await fetchProfileWishBoard({ offlineFallback: true });
          const [nextBalance, nextItems, nextRedeems] = await Promise.all([
            getPointsBalance(),
            listWishBoardItems(),
            listWishRedeemRecords(),
          ]);
          setBalance(nextBalance);
          setItems(nextItems);
          setRedeemRecords(nextRedeems);
        }, forceApi);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : '加载失败');
      } finally {
        setLoading(false);
      }
    },
    [wrapLoad],
  );

  const { onRefresh: onRefreshData } = usePagePullRefresh(WISH_BOARD_PAGE_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    return subscribePointsBalanceChanged(setBalance);
  }, []);

  const onResetPoints = useCallback(() => {
    if (balance <= 0 || resetting) return;
    Alert.alert(
      '重置积分',
      `确定将当前 ${balance} 积分清零吗？此操作会写入流水，不可自动恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清零',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setResetting(true);
              try {
                const result = await resetPointsBalance();
                setBalance(result.balance);
                notifyAncestorsDataChanged();
                await reload();
              } catch (e) {
                Alert.alert('重置失败', e instanceof Error ? e.message : '请稍后重试');
              } finally {
                setResetting(false);
              }
            })();
          },
        },
      ],
    );
  }, [balance, notifyAncestorsDataChanged, reload, resetting]);

  const onRedeem = useCallback(
    (item: WishBoardItemRow) => {
      if (item.wish_type === 'once' && item.status === 'redeemed') return;
      if (balance < item.cost_points) {
        Alert.alert('积分不足', `兑换「${item.title}」需要 ${item.cost_points} 积分，当前余额 ${balance}。`);
        return;
      }
      const typeHint = item.wish_type === 'repeat' ? '（可重复兑换）' : '';
      Alert.alert(
        '兑换心愿',
        `确认花费 ${item.cost_points} 积分兑换「${item.title}」${typeHint}？`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '兑换',
            style: 'default',
            onPress: () => {
              void (async () => {
                try {
                  const result = await redeemWishBoardItem(item.id);
                  setBalance(result.balance);
                  notifyAncestorsDataChanged();
                  await reload();
                } catch (e) {
                  Alert.alert('兑换失败', e instanceof Error ? e.message : '请稍后重试');
                }
              })();
            },
          },
        ],
      );
    },
    [balance, notifyAncestorsDataChanged, reload],
  );

  const onDelete = useCallback(
    (item: WishBoardItemRow) => {
      Alert.alert('删除心愿', `确定删除「${item.title}」？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteWishBoardItem(item.id);
                await reload();
              } catch (e) {
                Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后重试');
              }
            })();
          },
        },
      ]);
    },
    [reload],
  );

  const onDeleteRedeemRecord = useCallback(
    (record: WishRedeemRecord) => {
      Alert.alert('删除兑换记录', `确定删除「${record.title}」这条兑换记录？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteWishRedeemRecord(record);
                await reload();
              } catch (e) {
                Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后重试');
              }
            })();
          },
        },
      ]);
    },
    [reload],
  );

  const accent = isDark ? '#f472b6' : '#be185d';
  const muted = colors.textSecondary;

  return (
    <>
      <AppScreen
        loading={loading}
        onRefreshData={onRefreshData}
        header={<ScreenHeader title="心愿板" onBack={() => router.back()} />}
        contentContainerStyle={styles.content}>
        <AppCard variant="accent" style={styles.balanceCard}>
          <Text style={[styles.balanceLabel, { color: 'rgba(255,255,255,0.72)' }]}>积分余额</Text>
          <Text style={[styles.balanceValue, { color: colors.onAccent }]}>{balance}</Text>
          <Text style={[styles.balanceHint, { color: 'rgba(255,255,255,0.65)' }]}>
            完成任务等行为可获得积分，用于兑换心愿
          </Text>
          <Pressable
            onPress={onResetPoints}
            disabled={balance <= 0 || resetting}
            style={({ pressed }) => [
              styles.resetBtn,
              {
                borderColor: 'rgba(255,255,255,0.35)',
                opacity: balance <= 0 || resetting ? 0.45 : pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="重置积分">
            {resetting ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialIcons name="restart-alt" size={16} color="#fff" />
                <Text style={styles.resetBtnText}>重置积分</Text>
              </>
            )}
          </Pressable>
        </AppCard>

        <AppButton
          label="添加新心愿"
          fullWidth
          onPress={() => setAddVisible(true)}
          style={styles.addBtn}
        />

        <Text style={[styles.sectionTitle, { color: colors.text }]}>心愿列表</Text>
        <Text style={[styles.sectionHint, { color: muted }]}>
          左滑可删除 · 点击编辑
        </Text>

        {loadError ? (
          <Text style={[styles.empty, { color: colors.danger }]}>{loadError}</Text>
        ) : null}

        {items.length === 0 && !loadError ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyEmoji}>🎁</Text>
            <Text style={[styles.empty, { color: muted }]}>还没有心愿，点上方按钮添加一条吧</Text>
          </View>
        ) : null}

        {!loadError && items.length > 0 && activeItems.length === 0 ? (
          <Text style={[styles.empty, { color: muted }]}>
            可兑换心愿已全部兑完，可在下方「已兑换」中查看记录。
          </Text>
        ) : null}

        {activeItems.map(item => {
          const icon = resolveWishBoardIconOption(item.icon_key);
          const lastRedeemed = item.wish_type === 'repeat' ? formatRedeemedAt(item.redeemed_at) : null;
          const canRedeem = balance >= item.cost_points;
          return (
            <Swipeable
              key={item.id}
              overshootRight={false}
              renderRightActions={() => (
                <View style={styles.swipeTrack}>
                  <Pressable
                    onPress={() => onDelete(item)}
                    style={[styles.swipeAction, { backgroundColor: colors.danger }]}>
                    <MaterialIcons name="delete-outline" size={20} color="#fff" />
                    <Text style={styles.swipeText}>删除</Text>
                  </Pressable>
                </View>
              )}>
              <Pressable
                onPress={() => router.push(`/edit-wish-board-item/${item.id}`)}
                style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
                <AppCard style={styles.itemCard}>
                  <View style={styles.itemRow}>
                    <View
                      style={[
                        styles.iconBadge,
                        { backgroundColor: wishBoardIconTintSoft(icon.tint, isDark) },
                      ]}>
                      <Text style={styles.iconEmoji}>{icon.emoji}</Text>
                    </View>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      {item.description ? (
                        <Text style={[styles.itemNote, { color: muted }]} numberOfLines={2}>
                          {item.description}
                        </Text>
                      ) : null}
                      <Text style={[styles.typeTag, { color: muted }]}>
                        {item.wish_type === 'repeat' ? '重复性心愿' : '一次性心愿'}
                        {lastRedeemed ? ` · 上次兑换 ${lastRedeemed}` : ''}
                      </Text>
                    </View>
                    {canRedeem ? (
                      <Pressable
                        onPress={() => onRedeem(item)}
                        style={({ pressed }) => [
                          styles.redeemBtn,
                          { backgroundColor: accent, opacity: pressed ? 0.88 : 1 },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel={`兑换${item.title}`}>
                        <Text style={styles.redeemBtnText}>兑换</Text>
                      </Pressable>
                    ) : (
                      <View
                        style={[
                          styles.redeemBtn,
                          styles.insufficientBtn,
                          {
                            backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                          },
                        ]}
                        accessibilityRole="button"
                        accessibilityLabel="积分不足"
                        accessibilityState={{ disabled: true }}>
                        <Text style={[styles.insufficientBtnText, { color: muted }]}>积分不足</Text>
                      </View>
                    )}
                  </View>
                  <View style={styles.costBottom}>
                    {item.wish_type === 'repeat' ? (
                      <View
                        style={[
                          styles.repeatBadge,
                          {
                            backgroundColor: isDark
                              ? 'rgba(255,255,255,0.12)'
                              : `${accent}18`,
                          },
                        ]}
                        accessibilityLabel="重复性心愿">
                        <MaterialIcons name="repeat" size={12} color={accent} />
                        <Text style={[styles.repeatBadgeText, { color: accent }]}>重复</Text>
                      </View>
                    ) : (
                      <View />
                    )}
                    <View style={styles.costWrapInline}>
                      <Text style={[styles.costValue, { color: accent }]}>{item.cost_points}</Text>
                      <Text style={[styles.costUnit, { color: muted }]}>积分</Text>
                    </View>
                  </View>
                </AppCard>
              </Pressable>
            </Swipeable>
          );
        })}

        {redeemRecords.length > 0 ? (
          <>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>已兑换</Text>
            <Text style={[styles.sectionHint, { color: muted }]}>
              {redeemRecords.length} 条 · 仅作记录不可编辑 · 左滑可删除
            </Text>
            {redeemRecords.map(record => {
              const icon = resolveWishBoardIconOption(record.icon_key);
              const redeemedAtLabel = formatRedeemedAt(record.redeemed_at);
              const typeLabel =
                record.wish_type === 'repeat' ? '重复性心愿 · 兑换记录' : '一次性心愿 · 已兑换';
              return (
                <Swipeable
                  key={record.ledger_id}
                  overshootRight={false}
                  renderRightActions={() => (
                    <View style={styles.swipeTrack}>
                      <Pressable
                        onPress={() => onDeleteRedeemRecord(record)}
                        style={[styles.swipeAction, { backgroundColor: colors.danger }]}>
                        <MaterialIcons name="delete-outline" size={20} color="#fff" />
                        <Text style={styles.swipeText}>删除</Text>
                      </Pressable>
                    </View>
                  )}>
                  <AppCard style={[styles.itemCard, { opacity: 0.72 }]}>
                    <View style={styles.itemRow}>
                      <View
                        style={[
                          styles.iconBadge,
                          { backgroundColor: wishBoardIconTintSoft(icon.tint, isDark) },
                        ]}>
                        <Text style={styles.iconEmoji}>{icon.emoji}</Text>
                      </View>
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>
                          {record.title}
                        </Text>
                        {record.description ? (
                          <Text style={[styles.itemNote, { color: muted }]} numberOfLines={2}>
                            {record.description}
                          </Text>
                        ) : null}
                        <Text style={[styles.typeTag, { color: muted }]}>
                          {typeLabel}
                          {redeemedAtLabel ? ` · ${redeemedAtLabel}` : ''}
                        </Text>
                      </View>
                      <View style={styles.costWrap}>
                        <Text style={[styles.costValue, { color: accent }]}>{record.cost_points}</Text>
                        <Text style={[styles.costUnit, { color: muted }]}>积分</Text>
                      </View>
                    </View>
                  </AppCard>
                </Swipeable>
              );
            })}
          </>
        ) : null}
      </AppScreen>

      <AddWishBoardModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onCreated={() => void reload()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing['6xl'],
    gap: Spacing.md,
  },
  balanceCard: {
    alignItems: 'flex-start',
    gap: 6,
    marginTop: Spacing.sm,
  },
  balanceLabel: {
    ...Typography.caption,
  },
  balanceValue: {
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  balanceHint: {
    ...Typography.caption,
    lineHeight: 18,
  },
  resetBtn: {
    marginTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  resetBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
  addBtn: {
    marginTop: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.h3,
    marginTop: Spacing.sm,
  },
  sectionHint: {
    ...Typography.caption,
    marginTop: -Spacing.xs,
    marginBottom: Spacing.xs,
  },
  emptyWrap: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xl,
  },
  empty: {
    ...Typography.body,
    textAlign: 'center',
  },
  itemCard: {
    marginBottom: 2,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconEmoji: {
    fontSize: 22,
    lineHeight: 28,
  },
  emptyEmoji: {
    fontSize: 36,
    lineHeight: 44,
  },
  itemTitle: {
    ...Typography.bodyStrong,
  },
  repeatBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
  },
  repeatBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
  itemNote: {
    ...Typography.caption,
    lineHeight: 18,
  },
  typeTag: {
    ...Typography.label,
    marginTop: 2,
  },
  costWrap: {
    alignItems: 'flex-end',
    minWidth: 56,
  },
  costWrapInline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  costBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(127,127,127,0.25)',
  },
  costValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  costUnit: {
    fontSize: 12,
    fontWeight: '600',
  },
  redeemBtn: {
    minWidth: 72,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  redeemBtnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
  insufficientBtn: {
    minWidth: 80,
  },
  insufficientBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  swipeTrack: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginBottom: 2,
  },
  swipeAction: {
    width: 76,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
});
