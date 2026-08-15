import { AddWishBoardModal } from '@/components/wish-board/add-wish-board-modal';
import { AppButton, AppCard, AppScreen, ScreenHeader } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { resolveWishBoardIcon } from '@/lib/constants/wish-board-icons';
import {
  deleteWishBoardItem,
  getPointsBalance,
  listWishBoardItems,
  redeemWishBoardItem,
} from '@/lib/repositories/wish-board/wish-board';
import type { WishBoardItemRow } from '@/lib/repositories/wish-board/wish-board.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

const WISH_BOARD_PAGE_KEY = 'wish-board';

export default function WishBoardScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { wrapLoad } = usePageApiSync(WISH_BOARD_PAGE_KEY);

  const [balance, setBalance] = useState(0);
  const [items, setItems] = useState<WishBoardItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [addVisible, setAddVisible] = useState(false);

  const reload = useCallback(
    async (forceApi = false) => {
      setLoadError(null);
      try {
        await wrapLoad(async () => {
          const [nextBalance, nextItems] = await Promise.all([
            getPointsBalance(),
            listWishBoardItems(),
          ]);
          setBalance(nextBalance);
          setItems(nextItems);
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

  const onRedeem = useCallback(
    (item: WishBoardItemRow) => {
      if (item.wish_type === 'once' && item.status === 'redeemed') return;
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
    [reload],
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
        </AppCard>

        <AppButton
          label="添加新心愿"
          fullWidth
          onPress={() => setAddVisible(true)}
          style={styles.addBtn}
        />

        <Text style={[styles.sectionTitle, { color: colors.text }]}>心愿列表</Text>

        {loadError ? (
          <Text style={[styles.empty, { color: colors.danger }]}>{loadError}</Text>
        ) : null}

        {items.length === 0 && !loadError ? (
          <View style={styles.emptyWrap}>
            <MaterialIcons name="card-giftcard" size={36} color={muted} />
            <Text style={[styles.empty, { color: muted }]}>还没有心愿，点上方按钮添加一条吧</Text>
          </View>
        ) : null}

        {items.map(item => {
          const redeemedOnce = item.wish_type === 'once' && item.status === 'redeemed';
          const canRedeem = !redeemedOnce;
          const iconName = resolveWishBoardIcon(item.icon_key);
          return (
            <Swipeable
              key={item.id}
              overshootRight={false}
              renderRightActions={() => (
                <View style={styles.swipeTrack}>
                  {canRedeem ? (
                    <Pressable
                      onPress={() => onRedeem(item)}
                      style={[styles.swipeAction, { backgroundColor: accent }]}>
                      <MaterialIcons name="redeem" size={20} color="#fff" />
                      <Text style={styles.swipeText}>兑换</Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    onPress={() => onDelete(item)}
                    style={[styles.swipeAction, { backgroundColor: colors.danger }]}>
                    <MaterialIcons name="delete-outline" size={20} color="#fff" />
                    <Text style={styles.swipeText}>删除</Text>
                  </Pressable>
                </View>
              )}>
              <Pressable
                onPress={() => {
                  if (!redeemedOnce) router.push(`/edit-wish-board-item/${item.id}`);
                }}
                style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}>
                <AppCard style={[styles.itemCard, redeemedOnce && { opacity: 0.72 }]}>
                  <View style={styles.itemRow}>
                    <View
                      style={[
                        styles.iconBadge,
                        { backgroundColor: isDark ? 'rgba(244,114,182,0.15)' : 'rgba(190,24,93,0.08)' },
                      ]}>
                      <MaterialIcons name={iconName} size={22} color={accent} />
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
                        {redeemedOnce ? ' · 已兑换' : ''}
                      </Text>
                    </View>
                    <View style={styles.costWrap}>
                      <Text style={[styles.costValue, { color: accent }]}>{item.cost_points}</Text>
                      <Text style={[styles.costUnit, { color: muted }]}>积分</Text>
                    </View>
                  </View>
                </AppCard>
              </Pressable>
            </Swipeable>
          );
        })}
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
  addBtn: {
    marginTop: Spacing.xs,
  },
  sectionTitle: {
    ...Typography.h3,
    marginTop: Spacing.sm,
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
  itemTitle: {
    ...Typography.bodyStrong,
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
  costValue: {
    fontSize: 22,
    fontWeight: '800',
  },
  costUnit: {
    fontSize: 11,
    fontWeight: '600',
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
