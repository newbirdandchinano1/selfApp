  import {
  CLOSET_ORDER,
  isUncategorizedCategory,
  matchSeason,
  pad2,
  sortItems,
  UNCATEGORIZED_CATEGORY_NAME,
  type ClosetLayout,
  type ClosetSort,
  type SeasonFilter,
  type WardrobeCategory,
  type WardrobeItem,
} from '@/components/wardrobe/data';
import { EmptyCategoryCard, ItemCard } from '@/components/wardrobe/item-card';
import { IconArrow, IconFlame, IconMore, IconPlus } from '@/components/wardrobe/icons';
import { UsageRing } from '@/components/wardrobe/usage-ring';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { useWardrobeTheme, wardrobeEm, wardrobeFonts, wardrobeType, type WardrobePalette } from '@/constants/wardrobe-theme';
import { formatYmd, parseYmd } from '@/lib/date';
import type { WardrobeWearWeek } from '@/lib/repositories/wardrobe/wardrobe';
import React, { memo, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from 'react-native';

export type ClosetViewProps = {
  items: WardrobeItem[];
  categories: WardrobeCategory[];
  layout: ClosetLayout;
  sort: ClosetSort;
  season: SeasonFilter;
  wearWeek?: WardrobeWearWeek | null;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onOpenItem: (id: string) => void;
  onManageCategories: () => void;
  onAddToCategory: (name: string) => void;
  onCategoryMore: (name: string) => void;
  onJumpMine: () => void;
  onSeason?: (season: SeasonFilter) => void;
};

const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WEEKDAY_CN = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const MONTH_EN = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'] as const;

function WeekStrip({
  wearWeek,
  todayYmd,
  onTip,
}: {
  wearWeek: WardrobeWearWeek | null | undefined;
  todayYmd: string;
  onTip: (text: string, x: number) => void;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const days = useMemo(() => {
    if (wearWeek?.days?.length === 7) return wearWeek.days;
    // 接口未就绪时仍按本周一～日占位，避免再写死演示穿着点
    const anchor = todayYmd;
    const d = parseYmd(anchor) ?? new Date();
    const weekday = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - weekday);
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(d);
      day.setDate(d.getDate() + i);
      return { ymd: formatYmd(day), worn: false };
    });
  }, [todayYmd, wearWeek]);

  return (
    <View style={styles.weekStrip}>
      {days.map((entry, index) => {
        const day = parseYmd(entry.ymd) ?? new Date();
        const weekday = (day.getDay() + 6) % 7;
        const isToday = entry.ymd === todayYmd;
        const worn = Boolean(entry.worn);
        return (
          <Pressable
            key={entry.ymd}
            onPress={() => {
              const label = worn
                ? `${day.getMonth() + 1}/${day.getDate()} · 已穿搭`
                : `${day.getMonth() + 1}/${day.getDate()} · 未记录`;
              onTip(label, (index + 0.5) / 7);
            }}
            style={[styles.wday, isToday && styles.wdayToday]}>
            <Text style={[styles.wd, isToday && styles.wdToday]}>{DAY_NAMES[weekday]}</Text>
            <Text style={[styles.wn, isToday && styles.wnToday]}>{day.getDate()}</Text>
            <View style={[styles.wdot, worn && styles.wdotWorn, isToday && styles.wdotToday]} />
          </Pressable>
        );
      })}
    </View>
  );
}

function weekCopy(worn: number, prev: number): string {
  if (prev <= 0 && worn <= 0) return '本周还没有穿搭记录';
  if (prev <= 0) return '本周已穿搭 · 开了个好头';
  const delta = worn - prev;
  if (delta > 0) return `本周已穿搭 · 比上周多 ${delta} 次`;
  if (delta < 0) return `本周已穿搭 · 比上周少 ${Math.abs(delta)} 次`;
  return '本周已穿搭 · 与上周持平';
}

function streakFoot(streak: number): string {
  if (streak <= 0) return '今天还没记录 · 穿一套记一下';
  if (streak === 1) return '今天已记录 · 明天接着来';
  return `已连续记录 ${streak} 天 · 保持得很好`;
}

export const ClosetView = memo(function ClosetView({
  items,
  categories,
  layout,
  sort,
  season,
  wearWeek,
  refreshControl,
  onOpenItem,
  onManageCategories,
  onAddToCategory,
  onCategoryMore,
  onJumpMine,
}: ClosetViewProps) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const { animate } = useFoldMotionGate();
  const [tip, setTip] = useState<{ text: string; ratio: number } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const todayYmd = useMemo(() => formatYmd(new Date()), []);
  const wornDays = wearWeek?.wornDaysThisWeek ?? 0;
  const streakDays = wearWeek?.streakDays ?? 0;
  const prevWornDays = wearWeek?.prevWornDays ?? 0;
  const weekPercent = Math.round((wornDays / 7) * 100);

  const visibleCats = useMemo(() => {
    const hasVisibleItem = (ids: string[]) =>
      ids.some((id) => {
        const item = items.find((i) => i.id === id);
        return item ? matchSeason(item, season) : false;
      });

    const ordered = categories
      .filter((c) => (CLOSET_ORDER as readonly string[]).includes(c.name))
      .filter((category) => {
        // 「未分类」无单品时默认不展示；其余空分类仍保留「添加第一件」
        if (isUncategorizedCategory(category.name)) return hasVisibleItem(category.ids);
        if (season === 'all') return true;
        return hasVisibleItem(category.ids);
      });

    // 分类行已删、单品还在（如手滑删「未分类」）时，合成兜底分类，避免列表空白
    const linked = new Set(categories.flatMap((c) => c.ids));
    const orphanIds = items
      .filter((item) => !linked.has(item.id) && matchSeason(item, season))
      .map((item) => item.id);
    if (!orphanIds.length) return ordered;

    const existingUncategorized = ordered.find((c) => isUncategorizedCategory(c.name));
    if (existingUncategorized) {
      return ordered.map((c) =>
        isUncategorizedCategory(c.name)
          ? { ...c, ids: [...new Set([...c.ids, ...orphanIds])] }
          : c,
      );
    }
    return [
      {
        name: UNCATEGORIZED_CATEGORY_NAME,
        ids: orphanIds,
        tint: '#DCE8E5',
        tint2: '#C3D6D0',
        tone: '#36584F',
      },
      ...ordered,
    ];
  }, [categories, items, season]);

  const total = useMemo(() => {
    if (season === 'all') return items.length;
    return items.filter((item) => matchSeason(item, season)).length;
  }, [items, season]);

  /** 双列 / 单列：全量季节匹配单品（含孤儿），不再只靠 category.ids */
  const flatItems = useMemo(
    () => sortItems(items.filter((item) => matchSeason(item, season)), sort),
    [items, season, sort],
  );

  const heroDate = useMemo(() => {
    const d = parseYmd(todayYmd) ?? new Date();
    return {
      stampDay: pad2(d.getDate()),
      stampMon: MONTH_EN[d.getMonth()],
      kicker: `${MONTH_EN[d.getMonth()]} ${pad2(d.getDate())}`,
      line: `${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAY_CN[d.getDay()]}`,
    };
  }, [todayYmd]);

  const showTip = (text: string, ratio: number) => {
    if (tipTimer.current) clearTimeout(tipTimer.current);
    setTip({ text, ratio });
    tipTimer.current = setTimeout(() => setTip(null), 1900);
  };

  const renderItems = (list: WardrobeItem[], variant: 'rail' | 'grid' | 'list') =>
    list.map((item, index) => (
      <ItemCard
        key={item.id}
        item={item}
        index={index}
        variant={variant}
        animate={animate}
        onPress={() => onOpenItem(item.id)}
      />
    ));

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}>
      <FoldRiseIn animate={animate} index={0} fromY={16}>
        <View style={styles.hero}>
          <View style={{ flex: 1 }}>
            <View style={styles.kickerRow}>
              <View style={styles.kickerLine} />
              <Text style={styles.kicker}>COLLECTION · {heroDate.kicker}</Text>
            </View>
            <View style={styles.heroTitleRow}>
              <Text style={styles.heroTitle}>今天穿什么</Text>
              <Text style={styles.heroQ}>?</Text>
            </View>
            <View style={styles.heroSub}>
              <Text style={styles.heroSubText}>{heroDate.line}</Text>
              <View style={styles.dot} />
              <Text style={styles.heroSubText}>
                已整理 <Text style={styles.heroSubBold}>{total}</Text> 件</Text>
            </View>
          </View>
          <View style={styles.stamp}>
            <View style={styles.stampSun} />
            <Text style={styles.stampDay}>{heroDate.stampDay}</Text>
            <Text style={styles.stampMon}>{heroDate.stampMon}</Text>
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={1} fromY={16} style={styles.weekRise}>
        <View style={styles.weekWrap}>
          <WeekStrip wearWeek={wearWeek} todayYmd={todayYmd} onTip={showTip} />
          {/* 常驻预留 tip 槽位，避免盖住下方卡片 / 弹出时再顶开布局 */}
          <View style={styles.dayTipSlot} pointerEvents="none">
            {tip ? (
              <View style={[styles.dayTip, { left: `${tip.ratio * 100}%` as unknown as number }]}>
                <Text style={styles.dayTipText}>{tip.text}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={2} fromY={16} style={styles.weekCardRise}>
        <View style={styles.weekCard}>
          <View style={styles.wcTop}>
            <Text style={styles.wcKicker}>THIS WEEK · 本周穿搭</Text>
            <View style={styles.streak}>
              <IconFlame size={9} color="#F0D5A9" />
              <Text style={styles.streakText}>
                {streakDays > 0 ? `连续 ${streakDays} 天` : '待开启'}
              </Text>
            </View>
          </View>
          <View style={styles.wcBody}>
            <View>
              <View style={styles.wcBigRow}>
                <Text style={styles.wcBig}>{wornDays}</Text>
                <Text style={styles.wcBigEm}>/ 7 天</Text>
              </View>
              <Text style={styles.wcCopy}>{weekCopy(wornDays, prevWornDays)}</Text>
            </View>
            <UsageRing percent={weekPercent} size={78} gradient animate={animate} />
          </View>
          <View style={styles.wcFoot}>
            <Text style={styles.wcFootText}>{streakFoot(streakDays)}</Text>
            <Pressable onPress={onJumpMine} style={styles.wcFootBtn} hitSlop={8}>
              <Text style={styles.wcFootBtnText}>查看统计</Text>
              <IconArrow size={9} color="#F0D5A9" />
            </Pressable>
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={3} fromY={16}>
        <View style={styles.sectionHead}>
          <View>
            <View style={styles.kickerRow}>
              <View style={styles.kickerLine} />
              <Text style={styles.kicker}>CATEGORIES</Text>
            </View>
            <Text style={styles.sectionTitle}>
              分类{' '}
              <Text style={styles.sectionMeta}>
                {visibleCats.length} 类 · {total} 件</Text>
            </Text>
          </View>
          <Pressable onPress={onManageCategories} style={styles.ghostPill}>
            <Text style={styles.ghostPillText}>管理</Text>
          </Pressable>
        </View>
      </FoldRiseIn>

      {layout === 'card' ? (
        visibleCats.map((category, catIndex) => {
          const catItems = sortItems(
            category.ids
              .map((id) => items.find((i) => i.id === id))
              .filter((item): item is WardrobeItem => !!item && matchSeason(item, season)),
            sort,
          );
          return (
            <FoldRiseIn key={category.name} animate={animate} index={4 + catIndex} fromY={16}>
              <View style={styles.catBlock}>
                <View style={styles.catHead}>
                  <View style={styles.catTitleRow}>
                    <Text style={styles.catTitle}>{category.name}</Text>
                    <View style={styles.catNum}>
                      <Text style={styles.catNumText}>{pad2(catItems.length)} 件</Text>
                    </View>
                  </View>
                  <View style={styles.catTools}>
                    <Pressable
                      onPress={() => onAddToCategory(category.name)}
                      style={styles.tinyBtn}
                      accessibilityLabel={`添加到${category.name}`}>
                      <IconPlus size={13} color={w.muted} />
                    </Pressable>
                    {isUncategorizedCategory(category.name) ? null : (
                      <Pressable
                        onPress={() => onCategoryMore(category.name)}
                        style={styles.tinyBtn}
                        accessibilityLabel={`${category.name}选项`}>
                        <IconMore size={13} color={w.muted} />
                      </Pressable>
                    )}
                  </View>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail}>
                  {catItems.length
                    ? renderItems(catItems, 'rail')
                    : [
                        <EmptyCategoryCard
                          key="empty"
                          tone={category.tone}
                          tint={category.tint}
                          tint2={category.tint2}
                          onPress={() => onAddToCategory(category.name)}
                        />,
                      ]}
                </ScrollView>
              </View>
            </FoldRiseIn>
          );
        })
      ) : (
        <View
          key={layout}
          style={layout === 'double' ? styles.flatGrid : styles.flatList}>
          {flatItems.length
            ? renderItems(flatItems, layout === 'double' ? 'grid' : 'list')
            : (
              <Text style={styles.flatEmpty}>
                {season === 'all' ? '还没有单品，先添加一件吧' : '当前季节筛选下暂无单品'}
              </Text>
            )}
        </View>
      )}

      <View style={styles.foot}>
        <Text style={styles.footText}>ATELIER · WARDROBE</Text>
        <Text style={styles.footText}>{total} 件珍藏</Text>
      </View>
    </ScrollView>
  );
});

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 122 },
  hero: {
    paddingTop: 8,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerLine: { width: 14, height: 1, backgroundColor: w.line2 },
  kicker: {
    ...wardrobeType.kicker,
    color: w.muted,
  },
  heroTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 8,
    marginBottom: 9,
    paddingTop: 3,
    overflow: 'visible',
  },
  heroTitle: {
    ...wardrobeType.heroTitle,
    color: w.ink,
    overflow: 'visible',
  },
  heroQ: {
    ...wardrobeType.heroQ,
    color: w.amber,
    // 独立 Text 才能吃到 skew；Android 无 Georgia 斜体面
    ...(Platform.OS === 'android'
      ? { fontStyle: 'normal' as const, transform: [{ skewX: '-14deg' }] }
      : null),
  },
  heroSub: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  heroSubText: { ...wardrobeType.heroSub, color: w.muted },
  heroSubBold: { fontFamily: wardrobeFonts.sansSemiBold, color: w.ink2 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: w.line2 },
  stamp: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.paper2,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stampSun: {
    position: 'absolute',
    top: 1,
    right: 6,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: w.amber,
  },
  stampDay: {
    ...wardrobeType.stampDay,
    color: w.pine,
    textAlign: 'center',
  },
  stampMon: {
    ...wardrobeType.stampMon,
    color: w.clay,
    marginTop: 4,
    textAlign: 'center',
  },
  weekRise: { zIndex: 6 },
  weekCardRise: { zIndex: 1 },
  weekWrap: { marginTop: 14, position: 'relative', zIndex: 6 },
  weekStrip: { flexDirection: 'row', gap: 2 },
  wday: {
    flex: 1,
    paddingVertical: 5,
    paddingBottom: 7,
    borderRadius: 14,
    alignItems: 'center',
    gap: 4,
  },
  wdayToday: {
    backgroundColor: w.pineSolid,
    transform: [{ translateY: -2 }],
  },
  wd: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 7.5,
    letterSpacing: wardrobeEm(0.05, 7.5),
    color: w.muted,
  },
  wdToday: { color: '#F6F2E6' },
  wn: {
    fontFamily: wardrobeFonts.monoSemiBold,
    fontSize: 12,
    color: w.ink2,
  },
  wnToday: { color: '#FFF8EA' },
  wdot: { width: 3, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  wdotWorn: { backgroundColor: w.sage },
  wdotToday: { backgroundColor: w.amber },
  /** 提前预留 tip 高度，与下方 week-card 分隔 */
  dayTipSlot: {
    height: 28,
    marginTop: 4,
    position: 'relative',
    zIndex: 24,
  },
  dayTip: {
    position: 'absolute',
    top: 0,
    transform: [{ translateX: -50 }],
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 9,
    backgroundColor: 'rgba(29,42,36,0.94)',
    zIndex: 24,
  },
  dayTipText: {
    fontFamily: wardrobeFonts.sans,
    color: '#F6F1E4',
    fontSize: 8.5,
    letterSpacing: wardrobeEm(0.04, 8.5),
  },
  weekCard: {
    marginTop: 6,
    paddingHorizontal: 17,
    paddingTop: 16,
    paddingBottom: 13,
    borderRadius: 26,
    backgroundColor: w.weekCard1,
    overflow: 'hidden',
  },
  wcTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wcKicker: {
    fontFamily: wardrobeFonts.monoSemiBold,
    fontSize: 7,
    letterSpacing: wardrobeEm(0.2, 7),
    color: 'rgba(245,240,227,0.5)',
    
  },
  streak: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: w.amberMark,
    backgroundColor: w.amberMark,
  },
  streakText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    color: '#F0D5A9',
    letterSpacing: wardrobeEm(0.04, 7.5),
  },
  wcBody: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 10,
  },
  wcBigRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  wcBig: {
    ...wardrobeType.wcBig,
    color: '#FFF9EA',
  },
  wcBigEm: {
    fontFamily: wardrobeFonts.sansMedium,
    fontStyle: 'normal',
    fontSize: 11,
    color: 'rgba(245,240,227,0.55)',
    letterSpacing: wardrobeEm(0.03, 11),
  },
  wcCopy: {
    fontFamily: wardrobeFonts.sans,
    marginTop: 5,
    fontSize: 9,
    letterSpacing: wardrobeEm(0.02, 9),
    color: 'rgba(245,240,227,0.6)',
  },
  wcFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 11,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(245,240,227,0.1)',
  },
  wcFootText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    color: 'rgba(245,240,227,0.48)',
    flex: 1,
  },
  wcFootBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  wcFootBtnText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    color: '#F0D5A9',
    letterSpacing: wardrobeEm(0.03, 7.5),
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 22,
    marginBottom: 2,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    ...wardrobeType.sectionTitle,
    marginTop: 5,
    color: w.ink,
  },
  sectionMeta: {
    ...wardrobeType.sectionMeta,
    color: w.muted,
  },
  ghostPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
  },
  ghostPillText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    color: w.ink3,
    letterSpacing: wardrobeEm(0.06, 8),
  },
  catBlock: { marginTop: 15 },
  catHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingBottom: 7,
  },
  catTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  catTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 12.5,
    color: w.ink2,
    letterSpacing: wardrobeEm(0.04, 12.5),
  },
  catNum: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: w.glass,
    borderWidth: 1,
    borderColor: w.line3,
  },
  catNumText: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6.5,
    color: w.muted,
    letterSpacing: wardrobeEm(0.06, 6.5),
  },
  catTools: { flexDirection: 'row', gap: 3 },
  tinyBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: w.glass,
  },
  rail: { gap: 9, paddingVertical: 2, paddingBottom: 9 },
  flatGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignContent: 'flex-start',
    rowGap: 10,
    marginTop: 8,
  },
  flatList: {
    width: '100%',
    gap: 8,
    marginTop: 8,
  },
  flatEmpty: {
    width: '100%',
    paddingVertical: 28,
    textAlign: 'center',
    fontFamily: wardrobeFonts.sans,
    fontSize: 12,
    color: w.muted,
    letterSpacing: wardrobeEm(0.04, 12),
  },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: w.line3,
  },
  footText: {
    ...wardrobeType.foot,
    color: w.muted2,
  },
  });
}
