import { AppIcon } from '@/components/ui/app-icon';
import {
  FoldCountUpText,
  FoldRiseIn,
  FOLD_MOTION_EASE,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import { Spacing } from '@/constants/design-tokens';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { toast, Alert } from '@/lib/app-feedback';
import {
  buildArchiveSummary,
  filterLogs,
  formatCompletedDayMeta,
  groupLogsByMonth,
  localMonthKey,
  sourceLabel,
  sourceShortLabel,
  sourceTone,
  type ArchiveFilterKey,
  type MonthSection,
} from '@/lib/project-completion-archive-ui';
import { formatPoints } from '@/lib/reward-points';
import {
  listProjectCompletionLogs,
  parseCompletionLogTagNames,
  type ProjectCompletionLogRow,
} from '@/lib/repositories/projects/project-completion-logs';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_KEY = 'project-completion-logs';

const FILTERS: { key: ArchiveFilterKey; label: (n: number) => string }[] = [
  { key: 'all', label: (n) => `全部 ${n}` },
  { key: 'month', label: (n) => `本月 ${n}` },
  { key: 'archive', label: (n) => `归档 ${n}` },
  { key: 'compress', label: (n) => `到期压缩 ${n}` },
  { key: 'manual_delete', label: (n) => `手动删除 ${n}` },
];

function pointsText(delta: number): string {
  if (delta > 0) return `+${formatPoints(delta)}`;
  if (delta < 0) return formatPoints(delta);
  return '±0';
}

function MonthCollapse({
  open,
  animate,
  estimatedHeight,
  children,
}: {
  open: boolean;
  animate: boolean;
  estimatedHeight: number;
  children: React.ReactNode;
}) {
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  const [measuredH, setMeasuredH] = useState(0);
  const targetH = Math.max(measuredH, estimatedHeight, 1);

  useEffect(() => {
    if (!animate) {
      progress.setValue(open ? 1 : 0);
      return;
    }
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: 380,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: false,
    }).start();
  }, [animate, open, progress]);

  const maxHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, targetH],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0, 0.45, 1],
  });

  return (
    <Animated.View style={{ maxHeight, opacity, overflow: 'hidden' }}>
      <View
        onLayout={(e) => {
          const h = Math.ceil(e.nativeEvent.layout.height);
          if (h > 0 && Math.abs(h - measuredH) > 2) setMeasuredH(h);
        }}>
        {children}
      </View>
    </Animated.View>
  );
}

function HistRow({
  item,
  fold,
  animate,
  index,
  onPress,
}: {
  item: ProjectCompletionLogRow;
  fold: ReturnType<typeof useFoldTheme>['fold'];
  animate: boolean;
  index: number;
  onPress: () => void;
}) {
  const tags = parseCompletionLogTagNames(item.tag_names);
  const tone = sourceTone(item.source);
  const isDelete = item.source === 'manual_delete';
  const scale = useRef(new Animated.Value(1)).current;

  const iconName: 'hourglass-empty' | 'folder-delete' | 'inventory-2' =
    tone === 'compressed'
      ? 'hourglass-empty'
      : tone === 'deleted'
        ? 'folder-delete'
        : 'inventory-2';

  const sourceColor =
    tone === 'compressed' ? '#8A6222' : tone === 'deleted' ? '#A05B48' : '#8E958E';

  const metaParts: string[] = [formatCompletedDayMeta(item.completed_ymd)];
  if (isDelete) {
    const undone = Math.max(0, item.task_count - item.done_task_count);
    metaParts.push(undone > 0 ? `未完成任务 ${undone} 个` : '细节已删');
    metaParts.push(item.points_delta === 0 ? '积分不变' : `积分 ${pointsText(item.points_delta)}`);
  } else {
    if (item.done_task_count > 0 || item.task_count > 0) {
      metaParts.push(`${item.done_task_count} 个任务完成`);
    }
    metaParts.push(`来源：${sourceLabel(item.source)}`);
  }

  return (
    <FoldRiseIn animate={animate} index={index} staggerMs={40} fromY={10} duration={360}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          if (!animate) return;
          Animated.spring(scale, {
            toValue: 0.985,
            friction: 6,
            tension: 220,
            useNativeDriver: true,
          }).start();
        }}
        onPressOut={() => {
          if (!animate) {
            scale.setValue(1);
            return;
          }
          Animated.spring(scale, {
            toValue: 1,
            friction: 5,
            tension: 180,
            useNativeDriver: true,
          }).start();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}，查看归档详情`}
        style={({ pressed }) => [{ opacity: pressed ? 0.96 : 1 }]}>
        <Animated.View
          style={[
            styles.histRow,
            {
              backgroundColor: 'rgba(255,252,245,0.88)',
              borderColor: fold.line,
              transform: [{ scale }],
            },
          ]}>
          <View style={[styles.histIc, { backgroundColor: '#EFEBDF' }]}>
            <AppIcon name={iconName} size={14} color={fold.pine2} />
          </View>
          <View style={styles.histMain}>
            <View style={styles.htRow}>
              <Text style={[styles.ht, { color: '#3E4B43' }]} numberOfLines={2}>
                {isDelete ? `删除「${item.name}」` : item.name}
              </Text>
              <View
                style={[
                  styles.tag,
                  {
                    backgroundColor: isDelete ? fold.clay2 : fold.sage2,
                  },
                ]}>
                <Text
                  style={[
                    styles.tagText,
                    { color: isDelete ? '#8F422B' : '#36594D' },
                  ]}>
                  {sourceShortLabel(item.source)}
                </Text>
              </View>
            </View>
            <Text style={[styles.hs, { color: '#969C94' }]} numberOfLines={2}>
              {metaParts.join(' · ')}
            </Text>
            <View style={styles.htagline}>
              {tags.slice(0, 3).map((t) => (
                <View key={t} style={[styles.tag, { backgroundColor: '#EAE6DC' }]}>
                  <Text style={[styles.tagText, { color: '#777B75' }]}>{t}</Text>
                </View>
              ))}
              <Text style={[styles.sourceInline, { color: sourceColor }]}>
                {tone === 'compressed' ? '⏳ ' : tone === 'deleted' ? '✕ ' : '📦 '}
                {sourceLabel(item.source)}
              </Text>
            </View>
            {item.note?.trim() ? (
              <Text style={[styles.hnote, { color: '#A2A79F' }]} numberOfLines={2}>
                {item.note.trim()}
              </Text>
            ) : null}
          </View>
          <Text
            style={[
              styles.ha,
              {
                color: item.points_delta === 0 ? '#A5A9A1' : item.points_delta < 0 ? '#B85B41' : '#3E7A5E',
                fontFamily: foldFonts.mono,
              },
            ]}>
            {pointsText(item.points_delta)}
            {item.points_delta !== 0 ? (
              <Text style={{ fontSize: 9, color: '#9AA097', fontWeight: '400' }}> 分</Text>
            ) : null}
          </Text>
        </Animated.View>
      </Pressable>
    </FoldRiseIn>
  );
}

function MonthBlock({
  section,
  open,
  onToggle,
  fold,
  animate,
  onOpenDetail,
}: {
  section: MonthSection;
  open: boolean;
  onToggle: () => void;
  fold: ReturnType<typeof useFoldTheme>['fold'];
  animate: boolean;
  onOpenDetail: (id: string) => void;
}) {
  const chev = useRef(new Animated.Value(open ? 0 : 1)).current;

  useEffect(() => {
    if (!animate) {
      chev.setValue(open ? 0 : 1);
      return;
    }
    Animated.timing(chev, {
      toValue: open ? 0 : 1,
      duration: 280,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    }).start();
  }, [animate, chev, open]);

  const rotate = chev.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '-90deg'],
  });

  const pts =
    section.points > 0
      ? `+${formatPoints(section.points)} 分`
      : section.points < 0
        ? `${formatPoints(section.points)} 分`
        : '0 分';

  return (
    <View style={{ marginBottom: 2 }}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${section.label}，${section.count} 项，${open ? '收起' : '展开'}`}
        style={styles.histMonth}>
        <Animated.Text style={[styles.chev, { color: '#9AA097', transform: [{ rotate }] }]}>
          ⌄
        </Animated.Text>
        <Text style={[styles.histMonthTitle, { color: '#5B6A61' }]}>{section.label}</Text>
        <Text style={[styles.histMonthMeta, { color: '#9AA097', fontFamily: foldFonts.mono }]}>
          {section.count} 项 · {pts}
        </Text>
      </Pressable>
      <MonthCollapse
        open={open}
        animate={animate}
        estimatedHeight={section.items.length * 96}>
        <View style={{ gap: 5, paddingBottom: 2 }}>
          {section.items.map((item, index) => (
            <HistRow
              key={item.id}
              item={item}
              fold={fold}
              animate={animate && open}
              index={index}
              onPress={() => onOpenDetail(item.id)}
            />
          ))}
        </View>
      </MonthCollapse>
    </View>
  );
}

export default function ProjectCompletionLogsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_KEY);

  const [items, setItems] = useState<ProjectCompletionLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ArchiveFilterKey>('all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [entered, setEntered] = useState(false);

  const monthNow = localMonthKey();

  const reload = useCallback(
    async (forceRefresh = false) => {
      setLoadError(null);
      try {
        await wrapLoad(async () => {
          const rows = await listProjectCompletionLogs();
          setItems(rows);
        }, forceRefresh);
      } catch (e) {
        console.warn('加载完成履历失败', e);
        setLoadError('加载失败，请稍后重试');
        setItems([]);
      } finally {
        setLoading(false);
        setEntered(true);
      }
    },
    [wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const summary = useMemo(() => buildArchiveSummary(items), [items]);
  const filtered = useMemo(() => filterLogs(items, filter, monthNow), [filter, items, monthNow]);
  const sections = useMemo(() => groupLogsByMonth(filtered), [filtered]);

  useEffect(() => {
    if (sections.length === 0) return;
    setCollapsed((prev) => {
      const next = { ...prev };
      let changed = false;
      sections.forEach((s, i) => {
        if (next[s.key] === undefined) {
          next[s.key] = i !== 0;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [sections]);

  const sparkMax = Math.max(1, ...summary.spark);

  const showRules = () => {
    Alert.alert(
      '归档规则',
      '完成履历是只读快照，不占道路名额。\n\n· 归档：项目完成后写入履历\n· 到期压缩：收集箱保留期满后压缩为履历\n· 手动删除细节：任务细节清除，履历仍保留\n\n如需重做，请从原项目新建一次。',
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.appBar, { paddingTop: insets.top + 4, borderBottomColor: fold.line }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={20} color={fold.ink} />
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[styles.appTitle, { color: fold.ink }]}>完成履历</Text>
          <Text style={[styles.appSub, { color: fold.muted }]} numberOfLines={1}>
            只读归档 · {summary.total} 项完成
          </Text>
        </View>
        <Pressable
          onPress={() => toast.info('年度回看将在后续版本开放')}
          accessibilityRole="button"
          accessibilityLabel="年度回看"
          style={({ pressed }) => [
            styles.pillBtn,
            { borderColor: fold.line2, backgroundColor: 'rgba(255,252,245,0.66)' },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="inventory" size={12} color={fold.ink2} />
          <Text style={[styles.pillBtnLabel, { color: fold.ink2 }]}>年度回看</Text>
        </Pressable>
      </View>

      {loading && !entered ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 16) + 28 },
          ]}
          showsVerticalScrollIndicator={false}>
          {loadError ? (
            <Pressable onPress={() => void reload(true)} style={styles.retry}>
              <Text style={{ color: fold.pine, fontWeight: '700' }}>{loadError} · 点此重试</Text>
            </Pressable>
          ) : null}

          <FoldRiseIn animate={motionOn && entered} index={0} staggerMs={45} fromY={12}>
            <View
              style={[
                styles.archSummary,
                { backgroundColor: fold.card, borderColor: 'rgba(216,205,187,0.75)' },
              ]}>
              <View style={styles.decorRing} pointerEvents="none" />
              <View style={styles.rowline}>
                <Text style={[styles.kicker, { color: fold.muted }]}>LIFETIME ARCHIVE</Text>
                <View style={[styles.tag, { backgroundColor: fold.sage2 }]}>
                  <Text style={[styles.tagText, { color: '#36594D' }]}>{summary.total} 项</Text>
                </View>
              </View>
              <View style={[styles.rowline, { marginTop: 4 }]}>
                <FoldCountUpText
                  value={summary.yearCount}
                  animate={motionOn && entered}
                  duration={760}
                  textStyle={[styles.archYear, { color: fold.pine, fontFamily: foldFonts.mono }]}
                />
                <Text style={[styles.archYearUnit, { color: fold.muted }]}>
                  项完成 · {summary.year}
                </Text>
                <Text style={[styles.streakHint, { color: '#8B6126' }]}>
                  {summary.streakMonths > 0
                    ? `连续 ${summary.streakMonths} 个月有记录`
                    : '本月暂无记录'}
                </Text>
              </View>
              <View style={styles.archKpis}>
                {[
                  { v: summary.monthCount, label: '本月完成', signed: false },
                  { v: summary.monthPoints, label: '本月积分', signed: true },
                  { v: summary.monthTasks, label: '完成任务', signed: false },
                ].map((kpi) => (
                  <View key={kpi.label} style={styles.kpiCell}>
                    <FoldCountUpText
                      value={kpi.v}
                      animate={motionOn && entered}
                      duration={760}
                      delayMs={80}
                      formatter={(n) =>
                        kpi.signed
                          ? n > 0
                            ? `+${formatPoints(Math.round(n))}`
                            : formatPoints(Math.round(n))
                          : String(Math.round(n))
                      }
                      textStyle={[styles.kpiVal, { color: '#3E4B43', fontFamily: foldFonts.mono }]}
                    />
                    <Text style={styles.kpiLabel}>{kpi.label}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.spark}>
                {summary.spark.map((v, i) => {
                  const h = 8 + Math.round((v / sparkMax) * 22);
                  const hot = i === summary.spark.length - 1;
                  return (
                    <View
                      key={`sp-${i}`}
                      style={[
                        styles.sparkBar,
                        {
                          height: h,
                          backgroundColor: hot ? fold.amber : fold.sage,
                          opacity: v === 0 ? 0.28 : hot ? 1 : 0.72,
                        },
                      ]}
                    />
                  );
                })}
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn && entered} index={1} staggerMs={45} fromY={10}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
              style={{ marginBottom: 4 }}>
              {FILTERS.map((f) => {
                const on = filter === f.key;
                const n = summary.counts[f.key];
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setFilter(f.key)}
                    style={[
                      styles.editPill,
                      on
                        ? { backgroundColor: fold.pine, borderColor: fold.pine }
                        : {
                            backgroundColor: 'rgba(255,252,245,0.45)',
                            borderColor: fold.line,
                          },
                    ]}>
                    <Text
                      style={[
                        styles.editPillText,
                        { color: on ? '#F8F3E9' : fold.muted, fontWeight: on ? '700' : '600' },
                      ]}>
                      {f.label(n)}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </FoldRiseIn>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <AppIcon name="history" size={36} color={fold.faint} />
              <Text style={[styles.emptyTitle, { color: fold.ink2 }]}>暂无完成履历</Text>
              <Text style={[styles.emptySub, { color: fold.faint }]}>
                完成并归档项目后会出现在这里
              </Text>
            </View>
          ) : sections.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyTitle, { color: fold.ink2 }]}>此筛选下暂无记录</Text>
            </View>
          ) : (
            sections.map((section, si) => (
              <FoldRiseIn
                key={section.key}
                animate={motionOn && entered}
                index={2 + si}
                staggerMs={45}
                fromY={10}>
                <MonthBlock
                  section={section}
                  open={!collapsed[section.key]}
                  onToggle={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [section.key]: !prev[section.key],
                    }))
                  }
                  fold={fold}
                  animate={motionOn}
                  onOpenDetail={(id) =>
                    router.push({
                      pathname: '/project-completion-log/[id]',
                      params: { id },
                    })
                  }
                />
              </FoldRiseIn>
            ))
          )}

          <View style={[styles.footerRow, { marginTop: 10 }]}>
            <Text style={{ fontSize: 11, color: '#A0A69D', flex: 1 }}>
              只读 · 不占道路名额 · 重做请从原项目新建
            </Text>
            <Pressable onPress={showRules} hitSlop={8}>
              <Text style={{ fontSize: 11, color: '#8B6126', fontWeight: '700' }}>归档规则 ›</Text>
            </Pressable>
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
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0 },
  appTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  appSub: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  pillBtn: {
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pillBtnLabel: { fontSize: 12, fontWeight: '700' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 15, paddingTop: 10 },
  retry: { alignItems: 'center', paddingVertical: 12, marginBottom: 6 },
  archSummary: {
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  decorRing: {
    position: 'absolute',
    right: -26,
    top: -34,
    width: 104,
    height: 104,
    borderRadius: 52,
    borderWidth: 1,
    borderColor: 'rgba(127,166,149,0.22)',
  },
  rowline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  kicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
  },
  archYear: { fontSize: 28, fontWeight: '700', letterSpacing: -0.4 },
  archYearUnit: { fontSize: 12, marginLeft: 2 },
  streakHint: { marginLeft: 'auto', fontSize: 11, fontWeight: '700' },
  archKpis: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 8,
  },
  kpiCell: {
    flex: 1,
    backgroundColor: 'rgba(239,235,223,0.56)',
    borderRadius: 9,
    paddingHorizontal: 6,
    paddingVertical: 6,
  },
  kpiVal: { fontSize: 14, fontWeight: '700', lineHeight: 18 },
  kpiLabel: { fontSize: 10, color: '#9AA097', marginTop: 2 },
  spark: {
    height: 28,
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    opacity: 0.85,
  },
  sparkBar: {
    flex: 1,
    borderRadius: 2,
    minHeight: 6,
  },
  filterRow: { gap: 5, paddingVertical: 2, paddingRight: 8 },
  editPill: {
    height: 30,
    paddingHorizontal: 11,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editPillText: { fontSize: 12 },
  histMonth: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  chev: { fontSize: 14, fontWeight: '700', width: 14, textAlign: 'center' },
  histMonthTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  histMonthMeta: { marginLeft: 'auto', fontSize: 11, fontWeight: '400' },
  histRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
  },
  histIc: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  histMain: { flex: 1, minWidth: 0 },
  htRow: { flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' },
  ht: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  hs: { fontSize: 11, marginTop: 3, lineHeight: 15 },
  htagline: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    alignItems: 'center',
  },
  sourceInline: { fontSize: 10, fontWeight: '600' },
  hnote: { fontSize: 10, marginTop: 3, lineHeight: 14, paddingRight: 28 },
  ha: { fontSize: 13, fontWeight: '700', marginLeft: 2, textAlign: 'right' },
  tag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '700' },
  empty: {
    marginTop: Spacing['3xl'],
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: 28,
  },
  emptyTitle: { fontSize: 15, fontWeight: '700' },
  emptySub: { fontSize: 12 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
});
