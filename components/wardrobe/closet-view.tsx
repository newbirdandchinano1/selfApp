import {
  CLOSET_ORDER,
  matchSeason,
  pad2,
  sortItems,
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
import { WARDROBE, wardrobeEm, wardrobeFonts, wardrobeType } from '@/constants/wardrobe-theme';
import React, { memo, useMemo, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export type ClosetViewProps = {
  items: WardrobeItem[];
  categories: WardrobeCategory[];
  layout: ClosetLayout;
  sort: ClosetSort;
  season: SeasonFilter;
  onOpenItem: (id: string) => void;
  onManageCategories: () => void;
  onAddToCategory: (name: string) => void;
  onCategoryMore: (name: string) => void;
  onJumpMine: () => void;
  onSeason?: (season: SeasonFilter) => void;
};

const DAY_NAMES = ['一', '二', '三', '四', '五', '六', '日'] as const;
const WORN_OFFSETS = new Set([0, 1, 2, 3, 5]);

function WeekStrip({ onTip }: { onTip: (text: string, x: number) => void }) {
  const today = useMemo(() => new Date(2026, 10, 2), []);
  const days = useMemo(() => {
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    return Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start);
      day.setDate(start.getDate() + index);
      return { day, index };
    });
  }, [today]);

  return (
    <View style={styles.weekStrip}>
      {days.map(({ day, index }) => {
        const weekday = (day.getDay() + 6) % 7;
        const isToday = index === 6;
        const worn = WORN_OFFSETS.has(index);
        return (
          <Pressable
            key={index}
            onPress={(e) => {
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

export const ClosetView = memo(function ClosetView({
  items,
  categories,
  layout,
  sort,
  season,
  onOpenItem,
  onManageCategories,
  onAddToCategory,
  onCategoryMore,
  onJumpMine,
}: ClosetViewProps) {
  const { animate } = useFoldMotionGate();
  const [tip, setTip] = useState<{ text: string; ratio: number } | null>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleCats = useMemo(
    () =>
      categories.filter((c) => (CLOSET_ORDER as readonly string[]).includes(c.name)).filter((category) => {
        if (season === 'all') return true;
        return category.ids.some((id) => {
          const item = items.find((i) => i.id === id);
          return item ? matchSeason(item, season) : false;
        });
      }),
    [categories, items, season],
  );

  const total = useMemo(() => {
    if (season === 'all') return items.length;
    return items.filter((item) => matchSeason(item, season)).length;
  }, [items, season]);

  const heroDate = useMemo(() => {
    const d = new Date(2026, 10, 2);
    const days = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    return {
      stampDay: pad2(d.getDate()),
      stampMon: 'NOV',
      kicker: `NOV ${pad2(d.getDate())}`,
      line: `${d.getMonth() + 1}月${d.getDate()}日 ${days[d.getDay()]}`,
    };
  }, []);

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
      showsVerticalScrollIndicator={false}>
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
              <Text style={styles.heroSubText}>晴 18°C</Text>
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
          <WeekStrip onTip={showTip} />
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
              <Text style={styles.streakText}>连续 9 天</Text>
            </View>
          </View>
          <View style={styles.wcBody}>
            <View>
              <View style={styles.wcBigRow}>
                <Text style={styles.wcBig}>5</Text>
                <Text style={styles.wcBigEm}>/ 7 天</Text>
              </View>
              <Text style={styles.wcCopy}>本周已穿搭 · 比上周多 2 次</Text>
            </View>
            <UsageRing percent={71} size={78} gradient animate={animate} />
          </View>
          <View style={styles.wcFoot}>
            <Text style={styles.wcFootText}>已连续记录 9 天 · 保持得很好</Text>
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
                      <IconPlus size={13} color={WARDROBE.muted} />
                    </Pressable>
                    <Pressable
                      onPress={() => onCategoryMore(category.name)}
                      style={styles.tinyBtn}
                      accessibilityLabel={`${category.name}选项`}>
                      <IconMore size={13} color={WARDROBE.muted} />
                    </Pressable>
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
        <View style={layout === 'double' ? styles.flatGrid : styles.flatList}>
          {renderItems(
            sortItems(
              visibleCats
                .flatMap((c) => c.ids.map((id) => items.find((i) => i.id === id)))
                .filter((item): item is WardrobeItem => !!item && matchSeason(item, season)),
              sort,
            ),
            layout === 'double' ? 'grid' : 'list',
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

const styles = StyleSheet.create({
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
  kickerLine: { width: 14, height: 1, backgroundColor: WARDROBE.line2 },
  kicker: {
    ...wardrobeType.kicker,
    color: WARDROBE.muted,
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
    color: WARDROBE.ink,
    overflow: 'visible',
  },
  heroQ: {
    ...wardrobeType.heroQ,
    color: WARDROBE.amber,
    // 独立 Text 才能吃到 skew；Android 无 Georgia 斜体面
    ...(Platform.OS === 'android'
      ? { fontStyle: 'normal' as const, transform: [{ skewX: '-14deg' }] }
      : null),
  },
  heroSub: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  heroSubText: { ...wardrobeType.heroSub, color: WARDROBE.muted },
  heroSubBold: { fontFamily: wardrobeFonts.sansSemiBold, color: WARDROBE.ink2 },
  dot: { width: 3, height: 3, borderRadius: 2, backgroundColor: WARDROBE.line2 },
  stamp: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: '#F3ECDD',
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
    backgroundColor: WARDROBE.amber,
  },
  stampDay: {
    ...wardrobeType.stampDay,
    color: WARDROBE.pine,
    textAlign: 'center',
  },
  stampMon: {
    ...wardrobeType.stampMon,
    color: WARDROBE.clay,
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
    backgroundColor: WARDROBE.pine,
    transform: [{ translateY: -2 }],
  },
  wd: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 7.5,
    letterSpacing: wardrobeEm(0.05, 7.5),
    color: WARDROBE.muted,
  },
  wdToday: { color: '#F6F2E6' },
  wn: {
    fontFamily: wardrobeFonts.monoSemiBold,
    fontSize: 12,
    color: WARDROBE.ink2,
  },
  wnToday: { color: '#FFF8EA' },
  wdot: { width: 3, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  wdotWorn: { backgroundColor: WARDROBE.sage },
  wdotToday: { backgroundColor: WARDROBE.amber },
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
    backgroundColor: WARDROBE.weekCard1,
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
    borderColor: 'rgba(211,154,85,0.34)',
    backgroundColor: 'rgba(211,154,85,0.13)',
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
    color: WARDROBE.ink,
  },
  sectionMeta: {
    ...wardrobeType.sectionMeta,
    color: WARDROBE.muted,
  },
  ghostPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(252,249,241,0.6)',
  },
  ghostPillText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    color: WARDROBE.ink3,
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
    color: WARDROBE.ink2,
    letterSpacing: wardrobeEm(0.04, 12.5),
  },
  catNum: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(252,249,241,0.8)',
    borderWidth: 1,
    borderColor: WARDROBE.line3,
  },
  catNumText: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6.5,
    color: WARDROBE.muted,
    letterSpacing: wardrobeEm(0.06, 6.5),
  },
  catTools: { flexDirection: 'row', gap: 3 },
  tinyBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(252,249,241,0.5)',
  },
  rail: { gap: 9, paddingVertical: 2, paddingBottom: 9 },
  flatGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
    marginTop: 8,
  },
  flatList: {
    gap: 8,
    marginTop: 8,
  },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 26,
    marginBottom: 4,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: WARDROBE.line3,
  },
  footText: {
    ...wardrobeType.foot,
    color: WARDROBE.muted2,
  },
});
