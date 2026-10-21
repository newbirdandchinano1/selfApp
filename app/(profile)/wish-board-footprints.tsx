import {
  formatWishBoxPoints,
  wishBoxTintWash,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { resolveWishBoardIconOption } from '@/lib/constants/wish-board-icons';
import {
  deleteWishRedeemRecord,
  listWishRedeemRecords,
} from '@/lib/repositories/wish-board/wish-board';
import type { WishRedeemRecord } from '@/lib/repositories/wish-board/wish-board.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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

type Section = {
  key: string;
  label: string;
  rows: { record: WishRedeemRecord; ordinal: number }[];
};

export default function WishBoardFootprintsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const animate = motionReady && !reduceMotion;

  const [records, setRecords] = useState<WishRedeemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const rows = await listWishRedeemRecords();
      setRecords(rows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  /** 同一心愿的累计兑换序号（第 N 次），按兑换时间升序编号 */
  const ordinalByLedger = useMemo(() => {
    const byWish = new Map<string, WishRedeemRecord[]>();
    for (const record of records) {
      const bucket = byWish.get(record.wish_id);
      if (bucket) bucket.push(record);
      else byWish.set(record.wish_id, [record]);
    }
    const map = new Map<string, number>();
    for (const bucket of byWish.values()) {
      bucket
        .slice()
        .sort(
          (a, b) =>
            a.redeemed_at.localeCompare(b.redeemed_at) || a.ledger_id.localeCompare(b.ledger_id),
        )
        .forEach((record, index) => map.set(record.ledger_id, index + 1));
    }
    return map;
  }, [records]);

  const sections = useMemo(() => {
    const out: Section[] = [];
    for (const record of records) {
      const key = monthKeyOf(record.redeemed_at);
      let section = out[out.length - 1];
      if (!section || section.key !== key) {
        section = { key, label: monthLabelOf(record.redeemed_at), rows: [] };
        out.push(section);
      }
      section.rows.push({
        record,
        ordinal: ordinalByLedger.get(record.ledger_id) ?? 1,
      });
    }
    return out;
  }, [records, ordinalByLedger]);

  const stats = useMemo(() => {
    const now = new Date();
    let spent = 0;
    let monthCount = 0;
    for (const record of records) {
      spent += Math.abs(record.cost_points);
      const d = parseRecordDate(record.redeemed_at);
      if (d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        monthCount += 1;
      }
    }
    return { total: records.length, spent, monthCount };
  }, [records]);

  const finalizeRemove = useCallback((ledgerId: string) => {
    setRecords(prev => prev.filter(row => row.ledger_id !== ledgerId));
    setRemovingId(prev => (prev === ledgerId ? null : prev));
  }, []);

  const confirmDelete = useCallback(async (record: WishRedeemRecord) => {
    setDeletingId(record.ledger_id);
    try {
      await deleteWishRedeemRecord(record);
      setRemovingId(record.ledger_id);
      toast.success('已删除该条足迹记录');
    } catch (e) {
      toast.error(toUserMessage(e, '删除失败，请稍后重试'));
    } finally {
      setDeletingId(null);
    }
  }, []);

  const askDelete = useCallback(
    (record: WishRedeemRecord) => {
      if (deletingId || removingId) return;
      Alert.alert('删除这条足迹？', '删除后不返还积分，心愿本身不受影响。', [
        { text: '取消', style: 'cancel' },
        { text: '删除', style: 'destructive', onPress: () => void confirmDelete(record) },
      ]);
    },
    [confirmDelete, deletingId, removingId],
  );

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
          <Text style={[styles.title, { color: c.ink }]}>兑换足迹</Text>
          <Text style={[styles.subtitle, { color: c.muted }]}>每一次热爱都有回响 🧾</Text>
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

      {loading && records.length === 0 ? (
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
            <StatItem label="累计兑换 · 次" value={formatWishBoxPoints(stats.total)} />
            <View style={styles.statDivider} />
            <StatItem label="累计消耗 · 积分" value={formatWishBoxPoints(stats.spent)} />
            <View style={styles.statDivider} />
            <StatItem label="本月兑换 · 次" value={formatWishBoxPoints(stats.monthCount)} />
          </View>

          {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

          {!loadError && records.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={styles.emptyEmoji}>🧾</Text>
              <Text style={styles.emptyTitle}>还没有兑换足迹</Text>
              <Text style={styles.emptySub}>兑换心愿后，这里会记录每一次达成 ✨</Text>
            </View>
          ) : null}

          {sections.map(section => (
            <View key={section.key}>
              <View style={styles.monthHead}>
                <Text style={styles.monthText}>{section.label}</Text>
                <View style={styles.monthLine} />
              </View>
              {section.rows.map(({ record, ordinal }, index) => (
                <FootprintRow
                  key={record.ledger_id}
                  record={record}
                  ordinal={ordinal}
                  index={index}
                  animate={animate}
                  editMode={editMode}
                  deleting={deletingId === record.ledger_id}
                  removing={removingId === record.ledger_id}
                  onDelete={() => askDelete(record)}
                  onRemoved={() => finalizeRemove(record.ledger_id)}
                />
              ))}
            </View>
          ))}

          {records.length > 0 ? (
            <Text style={styles.note}>
              单条足迹可点「删除」移除，删除后不返还积分，心愿本身不受影响。
            </Text>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function StatItem({ label, value }: { label: string; value: string }) {
  const styles = useWishStyles(makeStyles);
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

type FootprintRowProps = {
  record: WishRedeemRecord;
  ordinal: number;
  index: number;
  animate: boolean;
  editMode: boolean;
  deleting: boolean;
  removing: boolean;
  onDelete: () => void;
  onRemoved: () => void;
};

function FootprintRow({
  record,
  ordinal,
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

  const icon = resolveWishBoardIconOption(record.icon_key);
  const typeText = record.wish_type === 'repeat' ? '可重复' : '一次性';
  const tail = record.wish_type === 'repeat' ? `第 ${ordinal} 次` : '已结束';

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
            <View style={[styles.fpIcon, { backgroundColor: wishBoxTintWash(icon.tint) }]}>
              <Text style={styles.fpEmoji}>{icon.emoji}</Text>
            </View>
            <View style={styles.fpBody}>
              <Text style={styles.fpTitle} numberOfLines={1}>
                {record.title}
              </Text>
              <Text style={styles.fpSub} numberOfLines={1}>
                {formatFootprintAt(record.redeemed_at)} · {typeText} · {tail}
              </Text>
            </View>
            <Text style={styles.fpPts}>-{formatWishBoxPoints(Math.abs(record.cost_points))}</Text>
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
              accessibilityLabel={`删除「${record.title}」的足迹`}>
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
    marginBottom: 16,
    ...shadows.soft,
  },
  statItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 4,
  },
  statValue: {
    fontSize: 20,
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
    color: c.pri,
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
  note: {
    marginTop: 16,
    fontSize: 11,
    lineHeight: 18,
    color: c.muted,
    fontWeight: '600',
  },
  });
}
