/**
 * 提醒设置 · 已预约通知：按天分组、单条静音开关、全部暂停。
 * 对齐设计稿 10。
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import {
  deleteScheduledAppNotification,
  listScheduledAppNotifications,
  restoreMutedAppNotification,
  type ScheduledAppNotificationItem,
} from '@/lib/notification-center';
import {
  getNotificationCenterSettings,
  type NotificationCenterSettings,
} from '@/lib/notification-center-settings';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type DayBucket = {
  key: string;
  label: string;
  items: ScheduledAppNotificationItem[];
};

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function clockFromIso(iso: string | null): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatBucketLabel(dayStart: number, todayStart: number): string {
  const d = new Date(dayStart);
  const md = `${d.getMonth() + 1}月${d.getDate()}日`;
  if (dayStart === todayStart) return `今天 · ${md}`;
  if (dayStart === todayStart + 86_400_000) return `明天 · ${md}`;
  if (dayStart > todayStart && dayStart < todayStart + 7 * 86_400_000) {
    const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    return `周${wd} · ${md}`;
  }
  return md;
}

function groupByDay(items: ScheduledAppNotificationItem[]): DayBucket[] {
  const todayStart = startOfLocalDay(new Date());
  const weekEnd = todayStart + 7 * 86_400_000;
  const map = new Map<string, ScheduledAppNotificationItem[]>();
  const rest: ScheduledAppNotificationItem[] = [];

  for (const item of items) {
    const ms = item.fireAtIso ? Date.parse(item.fireAtIso) : NaN;
    if (!Number.isFinite(ms)) {
      rest.push(item);
      continue;
    }
    const day = startOfLocalDay(new Date(ms));
    if (day >= weekEnd) {
      rest.push(item);
      continue;
    }
    const key = String(day);
    const list = map.get(key) ?? [];
    list.push(item);
    map.set(key, list);
  }

  const buckets: DayBucket[] = [...map.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([key, list]) => ({
      key,
      label: formatBucketLabel(Number(key), todayStart),
      items: list.sort((a, b) => {
        const ta = a.fireAtIso ? Date.parse(a.fireAtIso) : 0;
        const tb = b.fireAtIso ? Date.parse(b.fireAtIso) : 0;
        return ta - tb;
      }),
    }));

  if (rest.length > 0) {
    buckets.push({
      key: 'rest',
      label: '本周其余 / 更晚',
      items: rest,
    });
  }
  return buckets;
}

function formatCountdown(iso: string | null): string {
  if (!iso) return '时间待定';
  const ms = Date.parse(iso) - Date.now();
  if (!Number.isFinite(ms)) return '时间待定';
  if (ms <= 0) return '即将触发';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `距现在 ${mins} 分`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return `距现在 ${hours} 小时 ${rem} 分`;
  const days = Math.floor(hours / 24);
  return `距现在 ${days} 天`;
}

function nextProgress(iso: string | null): number {
  if (!iso) return 0;
  const fire = Date.parse(iso);
  if (!Number.isFinite(fire)) return 0;
  const span = 6 * 60 * 60 * 1000;
  const start = fire - span;
  const now = Date.now();
  if (now <= start) return 0.08;
  if (now >= fire) return 1;
  return Math.max(0.08, Math.min(1, (now - start) / span));
}

export default function NotificationCenterScheduledScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<NotificationCenterSettings | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledAppNotificationItem[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextScheduled] = await Promise.all([
        getNotificationCenterSettings(),
        listScheduledAppNotifications(),
      ]);
      setSettings(nextSettings);
      setScheduled(nextScheduled);
    } catch (e) {
      console.warn('加载已预约通知失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const buckets = useMemo(() => groupByDay(scheduled), [scheduled]);
  const activeItems = useMemo(
    () => scheduled.filter((s) => s.status === 'active'),
    [scheduled],
  );
  const nextItem = useMemo(() => {
    const withTime = activeItems
      .filter((s) => s.fireAtIso)
      .sort((a, b) => Date.parse(a.fireAtIso!) - Date.parse(b.fireAtIso!));
    return withTime[0] ?? activeItems[0] ?? null;
  }, [activeItems]);

  const channelCount = useMemo(() => {
    const set = new Set(scheduled.map((s) => s.category).filter(Boolean));
    return set.size;
  }, [scheduled]);

  const allPaused =
    scheduled.length > 0 && scheduled.every((s) => s.status === 'muted' || s.status === 'blocked');

  const onToggleItem = useCallback(
    async (item: ScheduledAppNotificationItem, enable: boolean) => {
      setBusy(true);
      try {
        if (enable) {
          await restoreMutedAppNotification(item.identifier);
        } else {
          await deleteScheduledAppNotification(item.identifier);
        }
        const [nextSettings, nextScheduled] = await Promise.all([
          getNotificationCenterSettings(),
          listScheduledAppNotifications(),
        ]);
        setSettings(nextSettings);
        setScheduled(nextScheduled);
      } catch (e) {
        console.warn('切换预约通知失败', e);
        toast.error(toUserMessage(e, '操作失败，请稍后再试'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const onPauseAll = useCallback(() => {
    if (scheduled.length === 0) return;
    const pause = !allPaused;
    Alert.alert(
      pause ? '全部暂停' : '全部恢复',
      pause
        ? '将静音本页全部预约；恢复后按原时间继续，错过的不会补发。'
        : '将重新允许这些预约写入系统队列。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: pause ? '暂停' : '恢复',
          style: pause ? 'destructive' : 'default',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                if (pause) {
                  for (const item of scheduled) {
                    if (item.status !== 'muted') {
                      await deleteScheduledAppNotification(item.identifier);
                    }
                  }
                } else {
                  for (const item of scheduled) {
                    if (item.status === 'muted') {
                      await restoreMutedAppNotification(item.identifier);
                    }
                  }
                }
                const [nextSettings, nextScheduled] = await Promise.all([
                  getNotificationCenterSettings(),
                  listScheduledAppNotifications(),
                ]);
                setSettings(nextSettings);
                setScheduled(nextScheduled);
                toast.success(pause ? '本地预约已全部暂停' : '本地预约已恢复');
              } catch (e) {
                toast.error(toUserMessage(e, '操作失败'));
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, [allPaused, scheduled]);

  const masterOn = settings?.masterEnabled !== false;
  const progress = nextProgress(nextItem?.fireAtIso ?? null);
  const sub =
    scheduled.length > 0
      ? `${scheduled.length} 条${nextItem?.fireAtLabel ? ` · 最近 ${nextItem.fireAtLabel}` : ''}`
      : '暂无预约';

  const switchTrack = { false: fold.trackOff, true: fold.pineButton } as const;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <View style={[styles.appBar, { paddingTop: insets.top + 4 }]}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={18} color={fold.ink2} />
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: fold.ink }]}>已预约通知</Text>
          <Text style={[styles.sub, { color: fold.muted }]} numberOfLines={1}>
            {sub}
          </Text>
        </View>
        <Pressable
          onPress={onPauseAll}
          disabled={busy || scheduled.length === 0}
          style={({ pressed }) => [
            styles.pillBtn,
            {
              borderColor: fold.line2,
              backgroundColor: 'rgba(255,252,245,0.66)',
              opacity: scheduled.length === 0 ? 0.4 : pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.pillLabel, { color: fold.ink2 }]}>
            {allPaused ? '全部恢复' : '全部暂停'}
          </Text>
        </Pressable>
      </View>

      {loading || !settings ? (
        <View style={styles.centered}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: Math.max(insets.bottom, 24) + 16 }]}
          showsVerticalScrollIndicator={false}>
          {!masterOn ? (
            <View style={[styles.card, { backgroundColor: fold.amber2, borderColor: '#E7CFA6' }]}>
              <Text style={{ fontSize: 11, color: '#8B5A1E', fontWeight: '700' }}>
                总开关已关闭 · 列表仍可查看与静音，恢复总开关后才会重新登记
              </Text>
            </View>
          ) : null}

          <FoldRiseIn animate={motionOn} index={0} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={styles.nextHead}>
                <Text style={styles.nextLabel}>下一次</Text>
                <Text style={[styles.nextValue, { color: '#8B6126' }]} numberOfLines={1}>
                  {nextItem
                    ? `${nextItem.fireAtLabel || clockFromIso(nextItem.fireAtIso)} · ${nextItem.title}`
                    : '暂无'}
                </Text>
              </View>
              <View style={[styles.progressTrack, { backgroundColor: '#E7E2D5' }]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${Math.round(progress * 100)}%`,
                      backgroundColor: fold.amber,
                    },
                  ]}
                />
              </View>
              <View style={styles.nextFoot}>
                <Text style={styles.nextMeta}>{formatCountdown(nextItem?.fireAtIso ?? null)}</Text>
                <Text style={styles.nextMeta}>共 {channelCount} 个频道</Text>
              </View>
            </View>
          </FoldRiseIn>

          {scheduled.length === 0 ? (
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={styles.emptyTitle}>暂无已预约</Text>
              <Text style={styles.emptyHint}>
                在提醒设置中打开频道与模块提醒后，将出现在此列表。
              </Text>
            </View>
          ) : (
            buckets.map((bucket, bIdx) => (
              <View key={bucket.key}>
                <View style={styles.bucketCap}>
                  <Text style={styles.bucketLabel}>{bucket.label}</Text>
                  <Text style={styles.bucketCount}>{bucket.items.length} 条</Text>
                </View>
                {bucket.items.map((item, i) => {
                  const muted = item.status === 'muted' || item.status === 'blocked';
                  const isRest = bucket.key === 'rest';
                  return (
                    <FoldRiseIn
                      key={item.identifier}
                      animate={motionOn}
                      index={bIdx * 3 + i}
                      staggerMs={40}
                      fromY={10}>
                      <View
                        style={[
                          styles.schedRow,
                          {
                            backgroundColor: muted
                              ? 'rgba(255,252,245,0.5)'
                              : 'rgba(255,252,245,0.88)',
                            borderColor: fold.line,
                            borderStyle: isRest ? 'dashed' : 'solid',
                            opacity: muted ? 0.55 : 1,
                          },
                        ]}>
                        <Text
                          style={[
                            styles.schedTime,
                            {
                              color: isRest ? '#9AA097' : '#2F5A4C',
                              fontFamily: foldFonts.mono,
                            },
                          ]}>
                          {isRest && !item.fireAtIso
                            ? '—'
                            : clockFromIso(item.fireAtIso) !== '--:--'
                              ? clockFromIso(item.fireAtIso)
                              : item.fireAtLabel.slice(0, 5)}
                        </Text>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text
                            style={[styles.schedTitle, { color: muted ? '#7A857D' : '#3F4C44' }]}
                            numberOfLines={1}>
                            {item.title}
                          </Text>
                          <Text style={styles.schedDesc} numberOfLines={1}>
                            {muted ? '已静音 · ' : ''}
                            {item.body || item.statusLabel} · {item.sourceLabel}
                          </Text>
                        </View>
                        <Switch
                          value={!muted}
                          disabled={busy}
                          onValueChange={(v) => void onToggleItem(item, v)}
                          trackColor={switchTrack}
                          thumbColor="#ffffff"
                        />
                      </View>
                    </FoldRiseIn>
                  );
                })}
              </View>
            ))
          )}

          <View style={[styles.card, styles.noteCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
            <AppIcon name="lock" size={12} color={fold.sage} />
            <Text style={[styles.noteText, { color: fold.muted }]}>
              暂停不会清除预约；恢复后按原时间继续，错过的不会补发。
            </Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 10,
  },
  iconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 10, marginTop: 2 },
  pillBtn: {
    height: 28,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillLabel: { fontSize: 10, fontWeight: '650' as never },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 15, gap: 8 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  nextHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  nextLabel: { fontSize: 11, color: '#5E6B62' },
  nextValue: { flex: 1, textAlign: 'right', fontSize: 11, fontWeight: '700' },
  progressTrack: {
    height: 3,
    borderRadius: 3,
    marginTop: 6,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', borderRadius: 3 },
  nextFoot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  nextMeta: { fontSize: 9, color: '#A0A69D' },
  bucketCap: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
    marginBottom: 6,
    paddingHorizontal: 1,
  },
  bucketLabel: { fontSize: 10, color: '#9A9F97' },
  bucketCount: { fontSize: 10, color: '#9A9F97' },
  schedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 9,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 5,
  },
  schedTime: { fontSize: 13, fontWeight: '700', width: 42 },
  schedTitle: { fontSize: 12, fontWeight: '700' },
  schedDesc: { fontSize: 10, color: '#969C94', marginTop: 1 },
  emptyTitle: { fontSize: 13, fontWeight: '700', color: '#3F4C44' },
  emptyHint: { fontSize: 11, color: '#9A9F97', marginTop: 4, lineHeight: 16 },
  noteCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 4 },
  noteText: { flex: 1, fontSize: 10, lineHeight: 15 },
});
