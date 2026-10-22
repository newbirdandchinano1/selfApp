import { FoldCard, FoldIconButton, FoldPillButton, FoldSegment, foldFonts } from '@/components/review/fold-ui';
import { FoldDailyJournal } from '@/components/review/fold-daily-journal';
import { ReviewJournalScreen } from '@/components/review/review-journal-screen';
import {
  countDailyReviewStreak,
  countFilledDailyEntries,
  formatReviewHeaderDate,
  getYesterdayYmd,
  isoWeekNumber,
  loadDailyStreakEntries,
  loadReviewPeriodSnapshot,
  type DailyEntry,
} from '@/components/review/review-utils';
import { ReviewListSkeleton } from '@/components/skeletons/review';
import { Typography } from '@/constants/design-tokens';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { usePageDayBoundary } from '@/contexts/day-boundary-context';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { useLocalQuery } from '@/hooks/use-local-query';
import { listUiRefreshTables } from '@/lib/page-api-scope';
import { resetTabBarAutoHide } from '@/lib/tab-bar-auto-hide';
import { reviewContentMaxWidth } from '@/lib/review-layout';
import { WEEKLY_REVIEW_WEEKDAY_LABELS } from '@/lib/weekly-review-settings';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'tabs/review';
const LOCAL_TABLES = listUiRefreshTables(PAGE_API_KEY);

/** 主切换：日 / 周 / 月 三个尺度并列 */
type ReviewScope = 'daily' | 'weekly' | 'monthly';

const SCOPE_OPTIONS = [
  { value: 'daily' as const, label: '日' },
  { value: 'weekly' as const, label: '周' },
  { value: 'monthly' as const, label: '月' },
];

function clockNow(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function HubBrand({
  dateLabel,
  weeklyHint,
  onTemplate,
  onMore,
}: {
  dateLabel: string;
  weeklyHint: string | null;
  onTemplate: () => void;
  onMore: () => void;
}) {
  const { palette } = useFoldTheme();
  return (
    <View style={styles.brandRow}>
      <View style={styles.brandLeft}>
        <View style={styles.brandTitleRow}>
          <Text style={[styles.brandMark, { color: palette.pine }]} maxFontSizeMultiplier={1.35}>
            折页
          </Text>
          <Text style={[styles.brandEn, { color: palette.sage }]} maxFontSizeMultiplier={1.35}>
            FOLD / REVIEW
          </Text>
        </View>
        <View style={styles.brandDateRow}>
          <View style={[styles.liveDot, { backgroundColor: palette.amber }]} />
          <Text style={[styles.brandDate, { color: palette.inkSoft }]} maxFontSizeMultiplier={1.35}>
            {dateLabel}
          </Text>
          {weeklyHint ? (
            <Text style={[styles.brandDate, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
              {weeklyHint}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={styles.brandTools}>
        <FoldPillButton label="模板" icon="grid-view" onPress={onTemplate} accessibilityLabel="编辑复盘标题与栏目" />
        <FoldIconButton icon="more-horiz" onPress={onMore} accessibilityLabel="更多：复盘日历与设置" variant="soft" />
      </View>
    </View>
  );
}

/**
 * Hub 右上「更多」浮层：复盘日历 / 复盘设置。
 * 月复盘已在主切换并列，不再收进这里。轻遮罩淡入 + popover 从 .92 弹性放大，点击外部关闭。
 */
function MoreMenu({
  open,
  anim,
  top,
  right,
  onClose,
  onCalendar,
  onSettings,
}: {
  open: boolean;
  anim: Animated.Value;
  top: number;
  right: number;
  onClose: () => void;
  onCalendar: () => void;
  onSettings: () => void;
}) {
  const { fold, palette } = useFoldTheme();
  const items = [
    { key: 'calendar', label: '复盘日历', sub: '42 格 · 找到任意一天', icon: 'date-range' as const, onPress: onCalendar },
    { key: 'settings', label: '复盘设置', sub: '复盘日 / 提醒 / 积分', icon: 'settings' as const, onPress: onSettings },
  ];

  return (
    <>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.scrim,
          {
            opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.16] }),
          },
        ]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭更多菜单"
        />
      </Animated.View>
      <Animated.View
        pointerEvents={open ? 'auto' : 'none'}
        style={[
          styles.popover,
          {
            top,
            right,
            backgroundColor: fold.card,
            borderColor: fold.line2,
            opacity: anim,
            transform: [
              { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
            ],
          },
        ]}>
        <View style={[styles.popoverCaret, { backgroundColor: fold.card, borderColor: fold.line2 }]} />
        <View style={[styles.popoverHead, { borderBottomColor: fold.line }]}>
          <Text style={[styles.popoverHeadTitle, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
            MORE · 更多
          </Text>
          <Text style={[styles.popoverHeadSub, { color: fold.faint }]} maxFontSizeMultiplier={1.25}>
            日历与设置
          </Text>
        </View>
        {items.map(item => (
          <Pressable
            key={item.key}
            onPress={item.onPress}
            accessibilityRole="button"
            accessibilityLabel={`${item.label}，${item.sub}`}
            style={({ pressed }) => [
              styles.popoverItem,
              { borderTopColor: fold.line, backgroundColor: pressed ? fold.paper2 : 'transparent' },
            ]}>
            <View style={[styles.popoverIcon, { backgroundColor: fold.paper2 }]}>
              <MaterialIcons name={item.icon} size={15} color={palette.pine} />
            </View>
            <View style={styles.popoverTextWrap}>
              <Text style={[styles.popoverTitle, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
                {item.label}
              </Text>
              <Text style={[styles.popoverSub, { color: fold.faint }]} numberOfLines={1} maxFontSizeMultiplier={1.25}>
                {item.sub}
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={16} color={fold.faint} />
          </Pressable>
        ))}
      </Animated.View>
    </>
  );
}

export function ReviewHubScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { palette } = useFoldTheme();
  const { width } = useWindowDimensions();
  const { logicalTodayYmd: todayYmd } = usePageDayBoundary('review');
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);

  const [scope, setScope] = useState<ReviewScope>('daily');
  const [loading, setLoading] = useState(true);
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const [monthLabel, setMonthLabel] = useState('');
  const [lastSyncLabel, setLastSyncLabel] = useState<string | null>(null);
  const [entries, setEntries] = useState<DailyEntry[]>([]);
  const [dailyTemplate, setDailyTemplate] = useState<ReviewDimensionTemplate[]>([]);
  const [reviewCycleEndYmd, setReviewCycleEndYmd] = useState('');
  const [configuredDow, setConfiguredDow] = useState<number | null>(null);
  const [streakEntries, setStreakEntries] = useState<DailyEntry[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreAnim] = useState(() => new Animated.Value(0));

  const scopeRef = useRef(scope);
  const weeklyReloadRef = useRef<(() => Promise<void>) | null>(null);
  const monthlyReloadRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  const contentMaxWidth = useMemo(() => reviewContentMaxWidth(width), [width]);

  useEffect(() => {
    resetTabBarAutoHide();
  }, [scope]);

  const reloadSnapshot = useCallback(
    async (forceRefresh = false) => {
      try {
        await wrapLoad(async () => {
          const snapshot = await loadReviewPeriodSnapshot(todayYmd);
          setWeekRangeLabel(snapshot.weekRangeLabel);
          setEntries(snapshot.dailyEntries);
          setDailyTemplate(snapshot.dailyTemplate);
          setReviewCycleEndYmd(snapshot.reviewCycleEndYmd);
          setConfiguredDow(snapshot.configuredDow);
          setLastSyncLabel(clockNow());

          const streak = await loadDailyStreakEntries(todayYmd).catch(() => []);
          setStreakEntries(streak);
        }, forceRefresh);
      } finally {
        setLoading(false);
      }
    },
    [todayYmd, wrapLoad],
  );

  const reload = useCallback(
    async (forceRefresh = false) => {
      await reloadSnapshot(forceRefresh);
      if (scopeRef.current === 'weekly') {
        await weeklyReloadRef.current?.();
      } else if (scopeRef.current === 'monthly') {
        await monthlyReloadRef.current?.();
      }
    },
    [reloadSnapshot],
  );

  const registerWeeklyReload = useCallback((fn: () => Promise<void>) => {
    weeklyReloadRef.current = fn;
  }, []);
  const registerMonthlyReload = useCallback((fn: () => Promise<void>) => {
    monthlyReloadRef.current = fn;
  }, []);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);
  usePageFocusReload(PAGE_API_KEY, forceRefresh => reload(forceRefresh ?? false), {
    observeLocal: false,
  });
  useLocalQuery(LOCAL_TABLES, () => {
    void reload(false);
  });

  const openHeaderMore = useCallback(() => setMoreOpen(true), []);
  const closeHeaderMore = useCallback(() => setMoreOpen(false), []);

  useEffect(() => {
    if (moreOpen) {
      Animated.spring(moreAnim, {
        toValue: 1,
        speed: 20,
        bounciness: 6,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(moreAnim, {
        toValue: 0,
        duration: 160,
        useNativeDriver: true,
      }).start();
    }
  }, [moreAnim, moreOpen]);

  const openDay = useCallback(
    (ymd: string) => {
      router.push({ pathname: '/daily-review/[ymd]', params: { ymd } });
    },
    [router],
  );

  const filledCount = useMemo(
    () => countFilledDailyEntries(entries, reviewCycleEndYmd, configuredDow),
    [configuredDow, entries, reviewCycleEndYmd],
  );
  const totalCount = useMemo(() => Math.max(entries.length, 1), [entries.length]);
  const streak = useMemo(
    () => countDailyReviewStreak(streakEntries, reviewCycleEndYmd, configuredDow, todayYmd),
    [configuredDow, reviewCycleEndYmd, streakEntries, todayYmd],
  );
  const weekNumber = useMemo(() => isoWeekNumber(todayYmd), [todayYmd]);

  const headerSubtitle =
    scope === 'daily'
      ? formatReviewHeaderDate(todayYmd)
      : scope === 'weekly'
        ? weekRangeLabel || formatReviewHeaderDate(todayYmd)
        : monthLabel || formatReviewHeaderDate(todayYmd);

  const weeklyHint = useMemo(() => {
    if (configuredDow === null) return null;
    const label = WEEKLY_REVIEW_WEEKDAY_LABELS[configuredDow] ?? '';
    return `每${label}复盘`;
  }, [configuredDow]);

  const headerDateLabel = useMemo(() => {
    if (scope === 'daily') return `${headerSubtitle} · 第${isoWeekNumber(todayYmd)}周`;
    return headerSubtitle;
  }, [headerSubtitle, scope, todayYmd]);

  const moreTop = insets.top + 50;
  const moreRight =
    contentMaxWidth != null ? Math.max(16, (width - contentMaxWidth) / 2 + 16) : 16;
  const closeAnd = useCallback(
    (fn: () => void) => () => {
      closeHeaderMore();
      fn();
    },
    [closeHeaderMore],
  );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: palette.paper }]}
      edges={['left', 'right']}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <View style={[styles.headerInner, contentMaxWidth != null ? { maxWidth: contentMaxWidth } : null]}>
          <HubBrand
            dateLabel={headerDateLabel}
            weeklyHint={weeklyHint}
            onTemplate={() => router.push(`/review-template-settings?scope=${scope}`)}
            onMore={openHeaderMore}
          />

          <FoldSegment
            options={SCOPE_OPTIONS}
            value={scope}
            onChange={next => {
              setScope(next);
            }}
            style={styles.segment}
          />
        </View>
      </View>

      <View style={[styles.body, contentMaxWidth != null ? { maxWidth: contentMaxWidth } : null]}>
        {scope === 'daily' ? (
          loading && entries.length === 0 ? (
            <ReviewListSkeleton />
          ) : dailyTemplate.length === 0 && entries.length === 0 ? (
            <ScrollView contentContainerStyle={styles.emptyWrap} refreshControl={refreshControl}>
              <FoldCard tone="muted" style={styles.emptyCard}>
                <Text style={[Typography.bodyStrong, { color: palette.ink }]} maxFontSizeMultiplier={1.35}>
                  还没有日刊
                </Text>
                <Text style={[Typography.body, { color: palette.muted, lineHeight: 20 }]} maxFontSizeMultiplier={1.35}>
                  请先在右上角「模板」里设置日复盘维度，再回来写今天。
                </Text>
              </FoldCard>
            </ScrollView>
          ) : (
            <FoldDailyJournal
              entries={entries}
              template={dailyTemplate}
              todayYmd={todayYmd}
              yesterdayYmd={getYesterdayYmd(todayYmd)}
              filledCount={filledCount}
              totalCount={totalCount}
              streak={streak}
              configuredDow={configuredDow}
              reviewCycleEndYmd={reviewCycleEndYmd}
              lastSyncLabel={lastSyncLabel}
              weekNumber={weekNumber}
              onOpenDay={openDay}
              refreshControl={refreshControl}
            />
          )
        ) : scope === 'weekly' ? (
          <ReviewJournalScreen
            scope="weekly"
            pageApiKey={PAGE_API_KEY}
            refreshControl={refreshControl}
            onRegisterReload={registerWeeklyReload}
            onSwitchToMonthly={() => setScope('monthly')}
          />
        ) : (
          <ReviewJournalScreen
            scope="monthly"
            pageApiKey={PAGE_API_KEY}
            refreshControl={refreshControl}
            onRegisterReload={registerMonthlyReload}
            onMonthLabelChange={setMonthLabel}
          />
        )}
      </View>

      <MoreMenu
        open={moreOpen}
        anim={moreAnim}
        top={moreTop}
        right={moreRight}
        onClose={closeHeaderMore}
        onCalendar={closeAnd(() => router.push('/review-calendar'))}
        onSettings={closeAnd(() => router.push('/review-settings'))}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    width: '100%',
  },
  headerInner: {
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 16,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  brandLeft: {
    flex: 1,
    minWidth: 0,
  },
  brandTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  brandMark: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 1.2,
    fontFamily: foldFonts.serif,
  },
  brandEn: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 2.6,
  },
  brandDateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 5,
    flexWrap: 'wrap',
  },
  liveDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
  },
  brandDate: {
    fontSize: 12,
    fontWeight: '600',
  },
  brandTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 2,
  },
  segment: {
    marginTop: 12,
  },
  body: {
    flex: 1,
    width: '100%',
    alignSelf: 'center',
  },
  emptyWrap: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  emptyCard: {
    gap: 6,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1B241F',
    zIndex: 40,
  },
  popover: {
    position: 'absolute',
    width: 228,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    zIndex: 42,
    transformOrigin: 'top right',
    shadowColor: '#1B241F',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 12,
  },
  popoverCaret: {
    position: 'absolute',
    top: -6,
    right: 20,
    width: 12,
    height: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    transform: [{ rotate: '45deg' }],
  },
  popoverHead: {
    paddingHorizontal: 12,
    paddingTop: 11,
    paddingBottom: 9,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  popoverHeadTitle: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  popoverHeadSub: {
    marginTop: 3,
    fontSize: 10.5,
  },
  popoverItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  popoverIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  popoverTextWrap: { flex: 1, minWidth: 0 },
  popoverTitle: { fontSize: 13, fontWeight: '800' },
  popoverSub: { marginTop: 2, fontSize: 10.5 },
});
