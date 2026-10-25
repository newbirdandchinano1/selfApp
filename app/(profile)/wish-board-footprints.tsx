import {
  formatWishBoxPoints,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import {
  appPointsListLedger,
  type AppPointsLedgerItem,
} from '@/lib/api-app-domain';
import {
  formatDailyReviewLedgerRefTitle,
  formatHealthMetricLedgerRefTitle,
  formatPointsLedgerReasonLabel,
} from '@/lib/points-ledger-reason-label';
import { deletePointsLedgerRecord } from '@/lib/repositories/points/points';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_LIMIT = 50;

type FilterKey = 'all' | 'earn' | 'spend';

function parseRecordDate(raw: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 设计稿行内时间：10-20 21:08 */
function formatFootprintAt(raw: string): string {
  const d = parseRecordDate(raw);
  if (!d) return raw;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${mm}-${dd} ${hh}:${mi}`;
}

function monthKeyOf(raw: string): string {
  const d = parseRecordDate(raw);
  if (!d) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelOf(raw: string): string {
  const d = parseRecordDate(raw);
  if (!d) return '更早';
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
}

function formatDelta(delta: number): string {
  const body = formatWishBoxPoints(Math.abs(delta));
  if (delta > 0) return `+${body}`;
  if (delta < 0) return `-${body}`;
  return body;
}

function rollbackHint(delta: number): string {
  if (delta > 0) return `删除后将扣回 ${formatWishBoxPoints(delta)} 积分`;
  if (delta < 0) return `删除后将返还 ${formatWishBoxPoints(Math.abs(delta))} 积分`;
  return '删除后积分余额不变';
}

function ledgerTitle(item: AppPointsLedgerItem): string {
  return formatPointsLedgerReasonLabel(item.reason, item.reason_label);
}

function ledgerRefTitle(item: AppPointsLedgerItem): string | null {
  const fromApi = item.ref_title?.trim() || null;
  if (fromApi) return fromApi;
  return (
    formatHealthMetricLedgerRefTitle(item.ref_type, item.ref_id) ??
    formatDailyReviewLedgerRefTitle(item.ref_type, item.ref_id)
  );
}

function ledgerEmoji(item: AppPointsLedgerItem): string {
  const reason = String(item.reason ?? '');
  if (reason.startsWith('wish_redeem')) return '🎁';
  if (reason.startsWith('habit') || reason.startsWith('break_habit')) return '✅';
  if (reason.startsWith('task')) return '📝';
  if (reason.startsWith('project')) return '🏁';
  if (reason.startsWith('daily_review')) return '📔';
  if (reason.startsWith('health_metric')) return '🫀';
  if (reason.includes('manual') || reason.includes('adjust')) return '✏️';
  if (item.delta > 0) return '✦';
  return '🧾';
}

type Section = {
  key: string;
  label: string;
  rows: AppPointsLedgerItem[];
};

export default function WishBoardFootprintsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const animate = motionReady && !reduceMotion;

  const [items, setItems] = useState<AppPointsLedgerItem[]>([]);
  const [balance, setBalance] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');

  const loadPage = useCallback(async (nextPage: number, append: boolean) => {
    setLoadError(null);
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const result = await appPointsListLedger({
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
    setRefreshing(true);
    try {
      await loadPage(1, false);
    } finally {
      setRefreshing(false);
    }
  }, [loadPage]);

  const visibleItems = useMemo(() => {
    if (filter === 'earn') return items.filter(row => row.delta > 0);
    if (filter === 'spend') return items.filter(row => row.delta < 0);
    return items;
  }, [filter, items]);

  const sections = useMemo(() => {
    const out: Section[] = [];
    for (const item of visibleItems) {
      const key = monthKeyOf(item.created_at);
      let section = out[out.length - 1];
      if (!section || section.key !== key) {
        section = { key, label: monthLabelOf(item.created_at), rows: [] };
        out.push(section);
      }
      section.rows.push(item);
    }
    return out;
  }, [visibleItems]);

  const stats = useMemo(() => {
    let earned = 0;
    let spent = 0;
    for (const item of items) {
      if (item.delta > 0) earned += item.delta;
      else if (item.delta < 0) spent += Math.abs(item.delta);
    }
    return { earned, spent, balance };
  }, [items, balance]);

  const finalizeRemove = useCallback((ledgerId: string) => {
    setItems(prev => prev.filter(row => row.id !== ledgerId));
    setTotal(prev => Math.max(0, prev - 1));
    setRemovingId(prev => (prev === ledgerId ? null : prev));
  }, []);

  const confirmDelete = useCallback(async (item: AppPointsLedgerItem) => {
    setDeletingId(item.id);
    try {
      const result = await deletePointsLedgerRecord(item.id);
      setBalance(result.balance);
      setRemovingId(item.id);
      toast.success('已删除并回退积分');
    } catch (e) {
      toast.error(toUserMessage(e, '删除失败，请稍后重试'));
    } finally {
      setDeletingId(null);
    }
  }, []);

  const askDelete = useCallback(
    (item: AppPointsLedgerItem) => {
      if (deletingId || removingId) return;
      const title = ledgerTitle(item);
      const ref = ledgerRefTitle(item);
      const titleHint = ref ? `「${ref}」` : '';
      Alert.alert(
        '删除这条足迹？',
        `确定删除「${title}」${titleHint}？\n${rollbackHint(item.delta)}。`,
        [
          { text: '取消', style: 'cancel' },
          {
            text: '删除并回退',
            style: 'destructive',
            onPress: () => void confirmDelete(item),
          },
        ],
      );
    },
    [confirmDelete, deletingId, removingId],
  );

  const canLoadMore = page < totalPages && !loading && !loadingMore;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}>
      <View style={styles.appbar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.86 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <MaterialIcons name="arrow-back-ios-new" size={16} color={c.ink} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: c.ink }]}>积分足迹</Text>
          <Text style={[styles.subtitle, { color: c.muted }]}>
            {total > 0 ? `共 ${total} 条 · 获得与兑换都在这里` : '获得与兑换都在这里'}
          </Text>
        </View>
        <Pressable
          onPress={() => setEditMode(prev => !prev)}
          style={({ pressed }) => [
            styles.iconBtn,
            editMode && styles.iconBtnActive,
            { opacity: pressed ? 0.86 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={editMode ? '完成编辑' : '编辑足迹'}>
          <MaterialIcons
            name={editMode ? 'check' : 'tune'}
            size={19}
            color={editMode ? c.pri : c.ink2}
          />
        </Pressable>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.centerBox}>
          <ActivityIndicator color={c.pri} />
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void onRefresh()}
              tintColor={c.pri}
            />
          }>
          <View style={styles.stat3}>
            <StatItem label="已加载 · 获得" value={`+${formatWishBoxPoints(stats.earned)}`} accent="mint" />
            <View style={styles.statDivider} />
            <StatItem label="已加载 · 消耗" value={`-${formatWishBoxPoints(stats.spent)}`} accent="pri" />
            <View style={styles.statDivider} />
            <StatItem label="当前余额" value={formatWishBoxPoints(stats.balance)} />
          </View>

          <View style={styles.filterRow}>
            {(
              [
                { key: 'all', label: '全部' },
                { key: 'earn', label: '获得' },
                { key: 'spend', label: '扣除' },
              ] as const
            ).map(chip => {
              const on = filter === chip.key;
              return (
                <Pressable
                  key={chip.key}
                  onPress={() => setFilter(chip.key)}
                  style={[styles.filterChip, on && styles.filterChipOn]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={chip.label}>
                  <Text style={[styles.filterChipText, on && styles.filterChipTextOn]}>{chip.label}</Text>
                </Pressable>
              );
            })}
          </View>

          {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

          {!loadError && visibleItems.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyEmoji}>🧾</Text>
              <Text style={styles.emptyTitle}>
                {filter === 'earn'
                  ? '还没有获得积分'
                  : filter === 'spend'
                    ? '还没有扣除记录'
                    : '还没有积分足迹'}
              </Text>
              <Text style={styles.emptySub}>
                {filter === 'all'
                  ? '完成任务或兑换心愿后，这里会记下每一次变动 ✨'
                  : '切换筛选看看其他记录'}
              </Text>
            </View>
          ) : null}

          {sections.map(section => (
            <View key={section.key}>
              <View style={styles.monthHead}>
                <Text style={styles.monthText}>{section.label}</Text>
                <View style={styles.monthLine} />
              </View>
              {section.rows.map((item, index) => (
                <FootprintRow
                  key={item.id}
                  item={item}
                  index={index}
                  animate={animate}
                  editMode={editMode}
                  deleting={deletingId === item.id}
                  removing={removingId === item.id}
                  onDelete={() => askDelete(item)}
                  onRemoved={() => finalizeRemove(item.id)}
                />
              ))}
            </View>
          ))}

          {canLoadMore ? (
            <Pressable
              onPress={() => void loadPage(page + 1, true)}
              style={({ pressed }) => [styles.loadMoreBtn, { opacity: pressed ? 0.86 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="加载更多">
              <Text style={styles.loadMoreText}>加载更多</Text>
            </Pressable>
          ) : null}

          {loadingMore ? (
            <ActivityIndicator color={c.pri} style={{ marginVertical: 12 }} />
          ) : null}

          {items.length > 0 ? (
            <Text style={styles.note}>
              编辑模式下可删除单条足迹；删除后会按该笔变动方向回退积分余额。
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function StatItem({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: 'mint' | 'pri';
}) {
  const { c } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const color = accent === 'mint' ? c.mint : accent === 'pri' ? c.pri : c.ink;
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type FootprintRowProps = {
  item: AppPointsLedgerItem;
  index: number;
  animate: boolean;
  editMode: boolean;
  deleting: boolean;
  removing: boolean;
  onDelete: () => void;
  onRemoved: () => void;
};

function FootprintRow({
  item,
  index,
  animate,
  editMode,
  deleting,
  removing,
  onDelete,
  onRemoved,
}: FootprintRowProps) {
  const { c } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const [rise] = useState(() => new Animated.Value(animate ? 0 : 1));
  const [collapse] = useState(() => new Animated.Value(1));

  useEffect(() => {
    if (!animate) {
      rise.setValue(1);
      return;
    }
    rise.setValue(0);
    const anim = Animated.timing(rise, {
      toValue: 1,
      duration: 460,
      delay: Math.min(index, 8) * 55 + 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animate, index, rise]);

  useEffect(() => {
    if (!removing) return;
    const anim = Animated.timing(collapse, {
      toValue: 0,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) onRemoved();
    });
    return () => {
      anim.stop();
    };
  }, [collapse, onRemoved, removing]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const maxHeight = collapse.interpolate({ inputRange: [0, 1], outputRange: [0, 96] });
  const marginBottom = collapse.interpolate({ inputRange: [0, 1], outputRange: [0, 10] });
  const opacity = collapse;

  const isGain = item.delta > 0;
  const title = ledgerTitle(item);
  const refTitle = ledgerRefTitle(item);
  const subParts = [
    formatFootprintAt(item.created_at),
    refTitle ? `「${refTitle}」` : null,
    item.note?.trim() || null,
  ].filter(Boolean);

  return (
    <Animated.View
      style={{
        maxHeight: removing ? maxHeight : undefined,
        marginBottom,
        opacity,
        overflow: removing ? 'hidden' : 'visible',
      }}>
      <Animated.View style={{ opacity: rise, transform: [{ translateY }] }}>
        <View style={[styles.fpWrap, editMode && styles.fpWrapEditing]}>
          <View style={styles.fpRow}>
            <View
              style={[
                styles.fpIcon,
                { backgroundColor: isGain ? c.mintSoft : c.priSoft },
              ]}>
              <Text style={styles.fpEmoji}>{ledgerEmoji(item)}</Text>
            </View>
            <View style={styles.fpBody}>
              <Text style={styles.fpTitle} numberOfLines={1}>
                {title}
              </Text>
              <Text style={styles.fpSub} numberOfLines={1}>
                {subParts.join(' · ')}
              </Text>
            </View>
            <Text style={[styles.fpPts, { color: isGain ? c.mint : c.pri }]}>
              {formatDelta(item.delta)}
            </Text>
          </View>
          {editMode ? (
            <Pressable
              onPress={onDelete}
              disabled={deleting}
              style={({ pressed }) => [
                styles.fpDelete,
                { opacity: deleting ? 0.7 : pressed ? 0.86 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`删除「${title}」的足迹`}>
              {deleting ? (
                <ActivityIndicator size="small" color={c.pri} />
              ) : (
                <Text style={styles.fpDeleteText}>删除</Text>
              )}
            </Pressable>
          ) : null}
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function makeStyles(c: WishBoxPalette, shadows: WishBoxShadowSet) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.bg,
    },
    appbar: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 6,
      paddingBottom: 8,
      gap: 8,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 14,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
      alignItems: 'center',
      justifyContent: 'center',
      ...shadows.soft,
    },
    iconBtnActive: {
      backgroundColor: c.priSoft,
      borderColor: c.priLine,
    },
    titleWrap: {
      flex: 1,
      alignItems: 'center',
      minWidth: 0,
    },
    title: {
      fontSize: 21,
      fontWeight: '800',
      letterSpacing: 1,
      color: c.ink,
    },
    subtitle: {
      marginTop: 2,
      fontSize: 11,
      fontWeight: '600',
      color: c.muted,
      letterSpacing: 0.2,
    },
    scroll: {
      paddingHorizontal: 16,
      paddingBottom: 44,
    },
    centerBox: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    loadingText: {
      color: c.muted,
      fontWeight: '600',
    },
    stat3: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.line,
      paddingVertical: 12,
      paddingHorizontal: 6,
      marginTop: 4,
      marginBottom: 12,
      ...shadows.soft,
    },
    statItem: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 4,
    },
    statValue: {
      fontSize: 18,
      fontWeight: '800',
      color: c.ink,
      fontVariant: ['tabular-nums'],
      letterSpacing: 0.2,
    },
    statLabel: {
      fontSize: 10.5,
      fontWeight: '700',
      color: c.muted,
      letterSpacing: 0.3,
    },
    statDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      marginVertical: 6,
      backgroundColor: c.line,
    },
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 14,
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: c.card,
      borderWidth: 1,
      borderColor: c.line,
    },
    filterChipOn: {
      backgroundColor: c.priSoft,
      borderColor: c.priLine,
    },
    filterChipText: {
      fontSize: 12.5,
      fontWeight: '700',
      color: c.muted,
    },
    filterChipTextOn: {
      color: c.pri,
    },
    monthHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 6,
      marginBottom: 8,
    },
    monthText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: c.muted,
      letterSpacing: 1,
    },
    monthLine: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: c.line,
    },
    fpWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.card,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.line,
      overflow: 'hidden',
      ...shadows.soft,
    },
    fpWrapEditing: {
      borderColor: c.lineStrong,
    },
    fpRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 11,
      paddingVertical: 11,
      paddingLeft: 11,
      paddingRight: 12,
      minWidth: 0,
    },
    fpIcon: {
      width: 46,
      height: 46,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fpEmoji: {
      fontSize: 24,
    },
    fpBody: {
      flex: 1,
      minWidth: 0,
      gap: 4,
    },
    fpTitle: {
      fontSize: 14,
      fontWeight: '800',
      color: c.ink,
    },
    fpSub: {
      fontSize: 10.5,
      fontWeight: '600',
      color: c.muted,
      fontVariant: ['tabular-nums'],
    },
    fpPts: {
      fontSize: 14.5,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    fpDelete: {
      width: 64,
      alignSelf: 'stretch',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.dangerSoft,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: c.priLine,
    },
    fpDeleteText: {
      fontSize: 12.5,
      fontWeight: '800',
      color: c.pri,
      letterSpacing: 1,
    },
    emptyBox: {
      alignItems: 'center',
      paddingVertical: 56,
      gap: 8,
    },
    emptyEmoji: {
      fontSize: 40,
    },
    emptyTitle: {
      fontSize: 15,
      fontWeight: '800',
      color: c.ink,
    },
    emptySub: {
      fontSize: 12,
      color: c.muted,
      textAlign: 'center',
    },
    errorText: {
      textAlign: 'center',
      color: c.danger,
      fontWeight: '600',
      marginBottom: 10,
    },
    loadMoreBtn: {
      marginTop: 8,
      alignSelf: 'center',
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.line,
      backgroundColor: c.card,
    },
    loadMoreText: {
      fontSize: 13,
      fontWeight: '800',
      color: c.pri,
    },
    note: {
      marginTop: 16,
      fontSize: 11,
      lineHeight: 18,
      color: c.muted,
      fontWeight: '600',
    },
  });
}
