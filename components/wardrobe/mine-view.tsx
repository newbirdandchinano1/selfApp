import {
  parsePrice,
  type SeasonFilter,
  type WardrobeCategory,
  type WardrobeItem,
  type WardrobeOutfit,
} from '@/components/wardrobe/data';
import {
  IconArrow,
  IconChart,
  IconCloset,
  IconHeart,
  IconSeason,
  IconTag,
} from '@/components/wardrobe/icons';
import { PageTitleItal } from '@/components/wardrobe/page-title-ital';
import { UsageRing } from '@/components/wardrobe/usage-ring';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { useWardrobeTheme, wardrobeEm, wardrobeFonts, wardrobeType, type WardrobePalette } from '@/constants/wardrobe-theme';
import React, { memo, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from 'react-native';

export type MineViewProps = {
  items: WardrobeItem[];
  outfits: WardrobeOutfit[];
  categories: WardrobeCategory[];
  season: SeasonFilter;
  closetCount: number;
  closetName: string;
  establishedYear: number;
  bodySummary: string;
  optionCount: number;
  wornThisMonth: number;
  sparkDayCounts: number[];
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onSeason: (season: SeasonFilter) => void;
  onOpenSheet: (key: string) => void;
  /** 使用率区 → 闲置洞察 */
  onIdleInsights?: () => void;
};

const FALLBACK_SWATCHES = ['#C4B398', '#839A76', '#8FAFBB', '#BF8E62', '#A89B8C', '#9AA7B5'] as const;

type ColorGroup = { label: string; color: string; count: number };

function buildColorGroups(items: WardrobeItem[]): ColorGroup[] {
  const map = new Map<string, ColorGroup>();
  for (const item of items) {
    const raw = item.color?.trim();
    const label = raw && raw !== '—' ? raw : '未标注';
    const prev = map.get(label);
    if (prev) {
      prev.count += 1;
      continue;
    }
    map.set(label, {
      label,
      color: item.tint?.trim() || FALLBACK_SWATCHES[map.size % FALLBACK_SWATCHES.length],
      count: 1,
    });
  }
  return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 4);
}

function scaleSparkHeights(counts: number[]): number[] {
  const max = Math.max(1, ...counts);
  return counts.map((c) => (c <= 0 ? 3 : Math.round(4 + (c / max) * 14)));
}

function manageRows(w: WardrobePalette): {
  key: string;
  title: string;
  note: (ctx: {
    items: number;
    closetCount: number;
    seasonLabel: string;
    bodySummary: string;
    optionCount: number;
  }) => string;
  icon: React.ReactNode;
  tile: string;
}[] {
  return [
    {
      key: 'wardrobe',
      title: '衣橱管理',
      note: ({ closetCount, items }) => `${closetCount} 个衣橱 · ${items} 件单品`,
      icon: <IconCloset size={15} color={w.pine} />,
      tile: w.sage2,
    },
    {
      key: 'options',
      title: '选项管理',
      note: ({ optionCount }) =>
        optionCount > 0 ? `${optionCount} 个词条 · 颜色品牌季节` : '颜色 · 品牌 · 季节 · 版型',
      icon: <IconTag size={15} color={w.amber} />,
      tile: w.amber2,
    },
    {
      key: 'body',
      title: '身材数据',
      note: ({ bodySummary }) => bodySummary,
      icon: <IconSeason size={15} color={w.amber} />,
      tile: w.amber2,
    },
    {
      key: 'stats',
      title: '穿搭统计',
      note: () => '按分类、季节与色系查看',
      icon: <IconChart size={15} color={w.pine} />,
      tile: w.sage2,
    },
    {
      key: 'season',
      title: '衣橱季节',
      note: ({ seasonLabel }) => `当前：${seasonLabel}`,
      icon: <IconHeart size={15} color={w.clay} />,
      tile: w.clay2,
    },
  ];
}

function useCountUp(target: number, animate: boolean, duration = 850) {
  const [value, setValue] = useState(animate ? 0 : target);
  useEffect(() => {
    if (!animate) {
      setValue(target);
      return;
    }
    const start = Date.now();
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(target * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [animate, duration, target]);
  return value;
}

export const MineView = memo(function MineView({
  items,
  outfits,
  categories: _categories,
  season,
  closetCount,
  closetName,
  establishedYear,
  bodySummary,
  optionCount,
  wornThisMonth,
  sparkDayCounts,
  refreshControl,
  onSeason,
  onOpenSheet,
  onIdleInsights,
}: MineViewProps) {
  void _categories;
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const { animate } = useFoldMotionGate();
  const totalValue = useMemo(() => items.reduce((sum, item) => sum + parsePrice(item.price), 0), [items]);
  const everWorn = items.filter((item) => item.wear > 0).length;
  const neverWorn = Math.max(0, items.length - everWorn);
  const usagePercent = items.length ? Math.round((everWorn / items.length) * 100) : 0;
  const seasonLabel = { all: '不限制', ss: '春夏', aw: '秋冬' }[season];
  const itemCount = useCountUp(items.length, animate);
  const outfitCount = useCountUp(outfits.length, animate);
  const valueCount = useCountUp(totalValue, animate, 950);
  const sparkHeights = useMemo(() => scaleSparkHeights(sparkDayCounts), [sparkDayCounts]);

  const groups = useMemo(() => buildColorGroups(items), [items]);
  const displayName = closetName.trim() || '我的衣橱';

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}>
      <FoldRiseIn animate={animate} index={0} fromY={16}>
        <View style={styles.intro}>
          <View style={styles.kickerRow}>
            <View style={styles.kickerLine} />
            <Text style={styles.kicker}>PROFILE · ATELIER</Text>
          </View>
          <Text style={styles.pageTitle}>我的</Text>
          <View style={styles.titleItalRow}>
            <PageTitleItal>衣橱</PageTitleItal>
            <Text style={styles.pageTitlePeriod}>。</Text>
          </View>
          <Text style={styles.pageSub}>
            已整理 {items.length} 件单品 · {outfits.length} 套搭配
          </Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={1} fromY={16}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>衣</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName}>{displayName}</Text>
            <Text style={styles.profileMeta}>
              ATELIER · {items.length} ITEMS · {closetCount} CLOSETS
            </Text>
          </View>
          <View style={styles.profileBadge}>
            <Text style={styles.profileBadgeText}>EST. {establishedYear}</Text>
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={2} fromY={16}>
        <View style={styles.statStrip}>
          <View style={styles.stat}>
            <Text style={styles.statNum}>{itemCount}</Text>
            <Text style={styles.statLabel}>单品</Text>
          </View>
          <View style={[styles.stat, styles.statMid]}>
            <Text style={styles.statNum}>{outfitCount}</Text>
            <Text style={styles.statLabel}>搭配</Text>
          </View>
          <View style={styles.stat}>
            <Text style={styles.statNum}>¥{valueCount.toLocaleString('en-US')}</Text>
            <Text style={styles.statLabel}>总价</Text>
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={3} fromY={16}>
        <Pressable
          style={styles.usageCard}
          onPress={onIdleInsights}
          disabled={!onIdleInsights}
          accessibilityRole={onIdleInsights ? 'button' : undefined}
          accessibilityLabel="闲置洞察">
          <UsageRing percent={usagePercent} size={66} gradient={false} animate={animate} />
          <View style={styles.useCopy}>
            <View style={styles.kickerRow}>
              <View style={[styles.kickerLine, { backgroundColor: 'rgba(245,240,227,0.24)' }]} />
              <Text style={[styles.kicker, { color: 'rgba(245,240,227,0.55)' }]}>WARDROBE USAGE</Text>
            </View>
            <Text style={styles.useTitle}>衣橱使用率 {usagePercent}%</Text>
            <Text style={styles.useNote}>
              本月穿过 {wornThisMonth} 件 · {neverWorn} 件仍在等待第一次出场
              {onIdleInsights ? ' · 点按闲置洞察' : ''}
            </Text>
            <View style={styles.useBars}>
              {sparkHeights.map((h, i) => (
                <View
                  key={i}
                  style={[
                    styles.useBar,
                    {
                      height: h,
                      backgroundColor: i % 2 ? 'rgba(245,240,227,0.22)' : 'rgba(230,184,120,0.38)',
                    },
                  ]}
                />
              ))}
            </View>
          </View>
        </Pressable>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={4} fromY={16}>
        <View style={styles.colorCard}>
          <View style={styles.ccHead}>
            <Text style={styles.ccTitle}>色彩分布</Text>
            <Text style={styles.ccMeta}>{items.length} ITEMS</Text>
          </View>
          {groups.length ? (
            <>
              <View style={styles.colorBar}>
                {groups.map((g) => (
                  <View
                    key={g.label}
                    style={{
                      flex: Math.max(g.count, 0.2),
                      backgroundColor: g.color,
                      height: 12,
                    }}
                  />
                ))}
              </View>
              <View style={styles.colorLegend}>
                {groups.map((g) => (
                  <View key={g.label} style={styles.legendItem}>
                    <View style={[styles.legendDot, { backgroundColor: g.color }]} />
                    <Text style={styles.legendText}>
                      {g.label} {g.count}
                    </Text>
                  </View>
                ))}
              </View>
            </>
          ) : (
            <Text style={styles.colorEmpty}>还没有单品色彩数据</Text>
          )}
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={5} fromY={16}>
        <View style={styles.seasonCard}>
          <View>
            <Text style={styles.seasonTitle}>衣橱季节</Text>
            <Text style={styles.seasonNote}>当前显示：{seasonLabel}</Text>
          </View>
          <View style={styles.segmented}>
            {(
              [
                ['all', '不限制'],
                ['ss', '春夏'],
                ['aw', '秋冬'],
              ] as const
            ).map(([value, label]) => (
              <Pressable
                key={value}
                onPress={() => onSeason(value)}
                style={[styles.seg, season === value && styles.segActive]}>
                <Text style={[styles.segText, season === value && styles.segTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={6} fromY={16}>
        <View style={styles.sectionHead}>
          <View>
            <View style={styles.kickerRow}>
              <View style={styles.kickerLine} />
              <Text style={styles.kicker}>MANAGE</Text>
            </View>
            <Text style={styles.sectionTitle}>
              衣橱设置 <Text style={styles.sectionMeta}>5 项</Text>
            </Text>
          </View>
          <Pressable onPress={() => onOpenSheet('about')} style={styles.ghostPill}>
            <Text style={styles.ghostPillText}>关于</Text>
          </Pressable>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={7} fromY={16}>
        <View style={styles.manage}>
          {manageRows(w).map((row) => (
            <Pressable key={row.key} style={styles.manageRow} onPress={() => onOpenSheet(row.key)}>
              <View style={[styles.manageIco, { backgroundColor: row.tile }]}>{row.icon}</View>
              <View style={styles.manageCopy}>
                <Text style={styles.manageTitle}>{row.title}</Text>
                <Text style={styles.manageNote}>
                  {row.note({
                    items: items.length,
                    closetCount,
                    seasonLabel,
                    bodySummary,
                    optionCount,
                  })}
                </Text>
              </View>
              <IconArrow size={11} color={w.muted2} />
            </Pressable>
          ))}
        </View>
      </FoldRiseIn>

      <View style={styles.foot}>
        <Text style={styles.footText}>ATELIER · {displayName}</Text>
        <Text style={styles.footText}>EST. {establishedYear}</Text>
      </View>
    </ScrollView>
  );
});

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 122 },
  intro: { paddingTop: 7 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerLine: { width: 14, height: 1, backgroundColor: w.line2 },
  kicker: {
    ...wardrobeType.kicker,
    color: w.muted,
  },
  pageTitle: {
    ...wardrobeType.pageTitle,
    marginTop: 9,
    marginBottom: 0,
    color: w.ink,
  },
  titleItalRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 7,
  },
  pageTitlePeriod: {
    ...wardrobeType.pageTitle,
    color: w.ink,
  },
  pageSub: { ...wardrobeType.pageSub, color: w.muted },
  profile: {
    marginTop: 13,
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glassStrong,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: w.pineSolid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: wardrobeFonts.serif, fontSize: 22, color: w.onPine },
  profileCopy: { flex: 1 },
  profileName: {
    ...wardrobeType.profileName,
    color: w.ink,
  },
  profileMeta: {
    ...wardrobeType.profileMeta,
    color: w.muted,
    marginTop: 4,
  },
  profileBadge: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: w.amberMark,
    borderWidth: 1,
    borderColor: w.amberMark,
  },
  profileBadgeText: {
    ...wardrobeType.profileBadge,
    color: w.amber,
  },
  statStrip: {
    flexDirection: 'row',
    marginTop: 11,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: w.line3,
  },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statMid: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: w.line3,
  },
  statNum: {
    ...wardrobeType.statNum,
    color: w.pine,
  },
  statLabel: {
    ...wardrobeType.statLabel,
    color: w.muted,
    marginTop: 5,
  },
  usageCard: {
    marginTop: 11,
    padding: 14,
    paddingHorizontal: 15,
    borderRadius: 22,
    backgroundColor: w.weekCard1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    overflow: 'hidden',
  },
  useCopy: { flex: 1 },
  useTitle: {
    ...wardrobeType.useTitle,
    color: '#F5F0E3',
    marginVertical: 3,
  },
  useNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    lineHeight: 12,
    color: 'rgba(245,240,227,0.55)',
  },
  useBars: { flexDirection: 'row', alignItems: 'flex-end', gap: 3, height: 18, marginTop: 7 },
  useBar: { width: 4, borderRadius: 2 },
  colorCard: {
    marginTop: 11,
    padding: 13,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
  },
  ccHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9 },
  ccTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: wardrobeEm(0.04, 10),
    color: w.ink2,
  },
  ccMeta: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6,
    letterSpacing: wardrobeEm(0.12, 6),
    color: w.muted,
  },
  colorBar: { flexDirection: 'row', height: 12, borderRadius: 999, overflow: 'hidden', gap: 2 },
  colorLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8, columnGap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 5, height: 5, borderRadius: 3 },
  legendText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: w.muted,
    letterSpacing: wardrobeEm(0.03, 6.5),
  },
  colorEmpty: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    color: w.muted,
    letterSpacing: wardrobeEm(0.02, 7.5),
  },
  seasonCard: {
    marginTop: 11,
    padding: 12,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  seasonTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: wardrobeEm(0.03, 10),
    color: w.ink2,
  },
  seasonNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: w.muted,
    marginTop: 2,
    letterSpacing: wardrobeEm(0.02, 6.5),
  },
  segmented: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 999,
    backgroundColor: w.pineWash,
    borderWidth: 1,
    borderColor: w.pineWash,
  },
  seg: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  segActive: {
    backgroundColor: w.card2,
    shadowColor: w.pine,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  segText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7,
    letterSpacing: wardrobeEm(0.02, 7),
    color: w.muted,
  },
  segTextActive: { color: w.pine, fontFamily: wardrobeFonts.sansSemiBold },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 18,
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
  manage: {
    marginTop: 11,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
    overflow: 'hidden',
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: w.line3,
  },
  manageIco: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manageCopy: { flex: 1 },
  manageTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10.5,
    letterSpacing: wardrobeEm(0.02, 10.5),
    color: w.ink2,
  },
  manageNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: w.muted,
    marginTop: 2,
    letterSpacing: wardrobeEm(0.02, 6.5),
  },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 26,
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
