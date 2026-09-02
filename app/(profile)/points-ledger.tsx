import { AppCard, AppScreen, ScreenHeader } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  appWishBoardListPointsLedger,
  type AppPointsLedgerItem,
} from '@/lib/api-app-domain';
import { deletePointsLedgerRecord } from '@/lib/repositories/wish-board/wish-board';
import { formatPoints } from '@/lib/reward-points';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';

const PAGE_LIMIT = 50;

function formatLedgerAt(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function formatDelta(delta: number): string {
  const n = formatPoints(delta);
  if (delta > 0) return `+${n}`;
  return n;
}

function rollbackHint(delta: number): string {
  if (delta > 0) return `删除后将扣回 ${formatPoints(delta)} 积分`;
  if (delta < 0) return `删除后将返还 ${formatPoints(Math.abs(delta))} 积分`;
  return '删除后积分余额不变';
}

export default function PointsLedgerScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();

  const [items, setItems] = useState<AppPointsLedgerItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadPage = useCallback(async (nextPage: number, append: boolean) => {
    setLoadError(null);
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = await appWishBoardListPointsLedger({
        page: nextPage,
        limit: PAGE_LIMIT,
      });
      setBalance(result.balance);
      setPage(result.pagination.page);
      setTotalPages(result.pagination.totalPages);
      setTotal(result.pagination.total);
      setItems(prev => (append ? [...prev, ...result.items] : result.items));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '加载失败');
      if (!append) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPage(1, false);
    }, [loadPage]),
  );

  const onRefresh = useCallback(async () => {
    await loadPage(1, false);
  }, [loadPage]);

  const onDelete = useCallback((item: AppPointsLedgerItem) => {
    if (deletingId) return;
    const label = item.reason_label || item.reason || '这条记录';
    const titleHint = item.ref_title ? `「${item.ref_title}」` : '';
    Alert.alert(
      '删除积分记录',
      `确定删除「${label}」${titleHint}？\n${rollbackHint(item.delta)}。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除并回退',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingId(item.id);
              try {
                const result = await deletePointsLedgerRecord(item.id);
                setBalance(result.balance);
                setItems(prev => prev.filter(row => row.id !== item.id));
                setTotal(prev => Math.max(0, prev - 1));
              } catch (e) {
                Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后重试');
              } finally {
                setDeletingId(null);
              }
            })();
          },
        },
      ],
    );
  }, [deletingId]);

  const canLoadMore = page < totalPages && !loading && !loadingMore;

  const accent = isDark ? '#f472b6' : '#be185d';
  const gainColor = isDark ? '#34d399' : '#059669';
  const lossColor = isDark ? '#fb7185' : '#e11d48';
  const muted = colors.textSecondary;

  return (
    <AppScreen
      loading={loading && items.length === 0}
      onRefreshData={onRefresh}
      header={<ScreenHeader title="积分记录" onBack={() => router.back()} />}
      contentContainerStyle={styles.content}>
      <AppCard variant="accent" style={styles.balanceCard}>
        <Text style={[styles.balanceLabel, { color: 'rgba(255,255,255,0.72)' }]}>当前积分</Text>
        <Text style={[styles.balanceValue, { color: colors.onAccent }]}>{formatPoints(balance)}</Text>
        <Text style={[styles.balanceHint, { color: 'rgba(255,255,255,0.65)' }]}>
          {total > 0 ? `共 ${total} 条变动记录` : '暂无积分变动'}
        </Text>
      </AppCard>

      <Text style={[styles.sectionTitle, { color: colors.text }]}>变动明细</Text>
      <Text style={[styles.sectionHint, { color: muted }]}>
        左滑可删除并回退该笔积分变动
      </Text>

      {loadError ? (
        <Text style={[styles.empty, { color: colors.danger }]}>{loadError}</Text>
      ) : null}

      {!loadError && !loading && items.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MaterialIcons name="receipt-long" size={36} color={muted} />
          <Text style={[styles.empty, { color: muted }]}>还没有积分记录</Text>
        </View>
      ) : null}

      {items.map(item => {
        const isGain = item.delta > 0;
        const deltaColor = item.delta === 0 ? muted : isGain ? gainColor : lossColor;
        const timeLabel = formatLedgerAt(item.created_at);
        const subtitleParts = [
          item.ref_title ? `「${item.ref_title}」` : null,
          item.note ? item.note : null,
        ].filter(Boolean);
        const isDeleting = deletingId === item.id;
        return (
          <Swipeable
            key={item.id}
            overshootRight={false}
            enabled={!isDeleting}
            renderRightActions={() => (
              <View style={styles.swipeTrack}>
                <Pressable
                  onPress={() => onDelete(item)}
                  disabled={isDeleting}
                  style={[styles.swipeAction, { backgroundColor: colors.danger }]}>
                  {isDeleting ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <>
                      <MaterialIcons name="delete-outline" size={20} color="#fff" />
                      <Text style={styles.swipeText}>删除</Text>
                    </>
                  )}
                </Pressable>
              </View>
            )}>
            <AppCard style={[styles.itemCard, isDeleting ? { opacity: 0.55 } : null]}>
              <View style={styles.itemRow}>
                <View
                  style={[
                    styles.deltaBadge,
                    {
                      backgroundColor: isGain
                        ? isDark
                          ? 'rgba(52,211,153,0.16)'
                          : 'rgba(5,150,105,0.12)'
                        : isDark
                          ? 'rgba(251,113,133,0.16)'
                          : 'rgba(225,29,72,0.1)',
                    },
                  ]}>
                  <MaterialIcons
                    name={isGain ? 'arrow-upward' : 'arrow-downward'}
                    size={16}
                    color={deltaColor}
                  />
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={[styles.itemTitle, { color: colors.text }]} numberOfLines={2}>
                    {item.reason_label || item.reason || '积分变动'}
                  </Text>
                  {subtitleParts.length > 0 ? (
                    <Text style={[styles.itemSub, { color: muted }]} numberOfLines={2}>
                      {subtitleParts.join(' · ')}
                    </Text>
                  ) : null}
                  {timeLabel ? (
                    <Text style={[styles.itemTime, { color: muted }]}>{timeLabel}</Text>
                  ) : null}
                </View>
                <View style={styles.amountCol}>
                  <Text style={[styles.deltaText, { color: deltaColor }]}>
                    {formatDelta(item.delta)}
                  </Text>
                  <Text style={[styles.afterText, { color: muted }]}>
                    余额 {formatPoints(item.balance_after)}
                  </Text>
                </View>
              </View>
            </AppCard>
          </Swipeable>
        );
      })}

      {canLoadMore ? (
        <Pressable
          onPress={() => void loadPage(page + 1, true)}
          style={({ pressed }) => [
            styles.loadMoreBtn,
            {
              borderColor: colors.outline,
              opacity: pressed ? 0.85 : 1,
              backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.03)',
            },
          ]}>
          <Text style={[styles.loadMoreText, { color: accent }]}>加载更多</Text>
        </Pressable>
      ) : null}

      {loadingMore ? (
        <ActivityIndicator color={accent} style={{ marginVertical: Spacing.md }} />
      ) : null}
    </AppScreen>
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
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  balanceHint: {
    ...Typography.caption,
    lineHeight: 18,
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
  deltaBadge: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: {
    ...Typography.bodyStrong,
  },
  itemSub: {
    ...Typography.caption,
    lineHeight: 18,
  },
  itemTime: {
    ...Typography.label,
    marginTop: 2,
  },
  amountCol: {
    alignItems: 'flex-end',
    minWidth: 72,
    gap: 2,
  },
  deltaText: {
    fontSize: 18,
    fontWeight: '800',
  },
  afterText: {
    fontSize: 11,
    fontWeight: '600',
  },
  loadMoreBtn: {
    marginTop: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  loadMoreText: {
    fontSize: 14,
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
