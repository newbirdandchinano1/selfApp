import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { listEarnedRewards, redeemEarnedReward, unredeemEarnedReward } from '@/lib/repositories/earned-rewards/earned-reward';
import type { EarnedRewardRow } from '@/lib/repositories/earned-rewards/earned-reward.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function formatEarnedTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function sourceTypeLabel(type: EarnedRewardRow['source_type']): string {
  if (type === 'project') return '项目';
  if (type === 'habit') return '小习惯';
  return '任务';
}

const PAGE_API_KEY = 'earned-rewards';

export default function EarnedRewardsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#424754';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const borderSoft = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.25)';
  const cardBg = isDark ? '#111827' : '#ffffff';

  const [items, setItems] = useState<EarnedRewardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const reload = useCallback(async (forceApi = false) => {
    try {
      await wrapLoad(async () => {
        const rows = await listEarnedRewards();
        setItems(rows);
      }, forceApi);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const pending = useMemo(() => items.filter((r) => !r.redeemed_at), [items]);
  const redeemed = useMemo(() => items.filter((r) => !!r.redeemed_at), [items]);

  const confirmRedeem = useCallback(
    (row: EarnedRewardRow) => {
      Alert.alert('兑现奖励', `确定已兑现「${row.label}」？`, [
        { text: '取消', style: 'cancel' },
        {
          text: '兑现',
          onPress: () => {
            void (async () => {
              setRedeemingId(row.id);
              try {
                await redeemEarnedReward(row.id);
                await reload();
              } catch (e) {
                Alert.alert('兑现失败', e instanceof Error ? e.message : '请稍后重试');
              } finally {
                setRedeemingId(null);
              }
            })();
          },
        },
      ]);
    },
    [reload],
  );

  const confirmUnredeem = useCallback(
    (row: EarnedRewardRow) => {
      Alert.alert('取消兑现', `将「${row.label}」恢复为待兑现状态？`, [
        { text: '保留', style: 'cancel' },
        {
          text: '取消兑现',
          onPress: () => {
            void (async () => {
              setRedeemingId(row.id);
              try {
                await unredeemEarnedReward(row.id);
                await reload();
              } catch (e) {
                Alert.alert('操作失败', e instanceof Error ? e.message : '请稍后重试');
              } finally {
                setRedeemingId(null);
              }
            })();
          },
        },
      ]);
    },
    [reload],
  );

  const renderRow = ({ item }: { item: EarnedRewardRow }) => {
    const isRedeemed = !!item.redeemed_at;
    const busy = redeemingId === item.id;
    return (
      <View style={[styles.card, { backgroundColor: cardBg, borderColor: borderSoft }]}>
        <View style={styles.cardHead}>
          <View style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(130,81,0,0.1)' }]}>
            <MaterialIcons name="emoji-events" size={22} color={tertiary} />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.rewardLabel, { color: text }]} numberOfLines={2}>
              {item.label}
            </Text>
            <Text style={[styles.sourceLine, { color: outline }]} numberOfLines={2}>
              来自{sourceTypeLabel(item.source_type)}「{item.source_title}」
            </Text>
            <Text style={[styles.timeLine, { color: outline }]}>
              {isRedeemed ? `已于 ${formatEarnedTime(item.redeemed_at!)} 兑现` : `获得于 ${formatEarnedTime(item.earned_at)}`}
            </Text>
          </View>
        </View>
        {!isRedeemed ? (
          <Pressable
            onPress={() => confirmRedeem(item)}
            disabled={!!redeemingId}
            style={({ pressed }) => [
              styles.redeemBtn,
              { backgroundColor: pressed ? secondary : primary, opacity: busy || redeemingId ? 0.7 : 1 },
            ]}>
            {busy ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <MaterialIcons name="redeem" size={18} color="#fff" />
                <Text style={styles.redeemText}>兑现</Text>
              </>
            )}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => confirmUnredeem(item)}
            disabled={!!redeemingId}
            style={({ pressed }) => [
              styles.unredeemBtn,
              {
                borderColor: isDark ? 'rgba(52,211,153,0.35)' : 'rgba(0,108,73,0.35)',
                backgroundColor: pressed
                  ? isDark
                    ? 'rgba(52,211,153,0.2)'
                    : 'rgba(0,108,73,0.12)'
                  : isDark
                    ? 'rgba(52,211,153,0.14)'
                    : 'rgba(0,108,73,0.1)',
                opacity: busy || redeemingId ? 0.7 : 1,
              },
            ]}>
            {busy ? (
              <ActivityIndicator color={secondary} size="small" />
            ) : (
              <>
                <MaterialIcons name="verified" size={16} color={secondary} />
                <Text style={[styles.redeemedText, { color: secondary }]}>已兑现 · 点击取消</Text>
              </>
            )}
          </Pressable>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)',
            borderBottomColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(226,232,240,0.7)',
          },
        ]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: primary }]}>已获得奖励</Text>
        <View style={styles.iconBtn} />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <MaterialIcons name="emoji-events" size={48} color={outline} />
          <Text style={[styles.emptyTitle, { color: text }]}>还没有奖励</Text>
          <Text style={[styles.emptySub, { color: outline }]}>
            在任务、项目或小习惯中设置完成奖励，完成后会自动记录在这里。
          </Text>
        </View>
      ) : (
        <FlatList
          data={[...pending, ...redeemed]}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          refreshControl={refreshControl}
          contentContainerStyle={[styles.listContent, { paddingBottom: Math.max(insets.bottom, 24) }]}
          ListHeaderComponent={
            pending.length > 0 ? (
              <Text style={[styles.sectionKicker, { color: outline }]}>
                待兑现 {pending.length} 项{redeemed.length > 0 ? ` · 已兑现 ${redeemed.length} 项` : ''}
              </Text>
            ) : (
              <Text style={[styles.sectionKicker, { color: outline }]}>全部已兑现</Text>
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 22, fontWeight: '800', letterSpacing: -0.3 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10, paddingTop: 80 },
  emptyTitle: { fontSize: 18, fontWeight: '800', marginTop: 8 },
  emptySub: { fontSize: 14, fontWeight: '500', textAlign: 'center', lineHeight: 20 },
  listContent: { paddingTop: 92, paddingHorizontal: 18, gap: 12 },
  sectionKicker: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, marginBottom: 4 },
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  rewardLabel: { fontSize: 16, fontWeight: '800' },
  sourceLine: { fontSize: 13, fontWeight: '500' },
  timeLine: { fontSize: 12, fontWeight: '500' },
  redeemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
  },
  redeemText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  unredeemBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
  },
  redeemedText: { fontSize: 14, fontWeight: '700' },
});
