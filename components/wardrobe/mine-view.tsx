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
  IconHanger,
  IconHeart,
  IconSeason,
  IconTag,
} from '@/components/wardrobe/icons';
import { PageTitleItal } from '@/components/wardrobe/page-title-ital';
import { UsageRing } from '@/components/wardrobe/usage-ring';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { WARDROBE, wardrobeEm, wardrobeFonts, wardrobeType } from '@/constants/wardrobe-theme';
import React, { memo, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export type MineViewProps = {
  items: WardrobeItem[];
  outfits: WardrobeOutfit[];
  categories: WardrobeCategory[];
  season: SeasonFilter;
  onSeason: (season: SeasonFilter) => void;
  onOpenSheet: (key: string) => void;
};

const COLOR_GROUPS = [
  { label: '中性色', color: '#C4B398', colors: ['藏青', '燕麦白', '燕麦色', '炭灰', '杏色', '米灰', '奶油 / 棕'] },
  { label: '橄榄绿', color: '#839A76', colors: ['橄榄绿', '鼠尾草绿'] },
  { label: '丹宁蓝', color: '#8FAFBB', colors: ['靛蓝', '雾蓝'] },
  { label: '焦糖棕', color: '#BF8E62', colors: ['焦糖棕'] },
] as const;

const MANAGE_ROWS: {
  key: string;
  title: string;
  note: (ctx: { items: number; seasonLabel: string }) => string;
  icon: React.ReactNode;
  tile: string;
  tone: string;
}[] = [
  {
    key: 'wardrobe',
    title: '衣橱管理',
    note: ({ items }) => `2 个衣橱 · ${items} 件单品`,
    icon: <IconCloset size={15} color="#41604F" />,
    tile: '#E1E8E1',
    tone: '#41604F',
  },
  {
    key: 'options',
    title: '选项管理',
    note: () => '分类 · 颜色 · 品牌 · 季节',
    icon: <IconTag size={15} color="#8C6A3C" />,
    tile: '#F1E5D3',
    tone: '#8C6A3C',
  },
  {
    key: 'sizes',
    title: '详细尺码管理',
    note: () => '上装 M · 下装 27 · 鞋履 38',
    icon: <IconHanger size={15} color="#4A5F79" />,
    tile: '#E3E7EF',
    tone: '#4A5F79',
  },
  {
    key: 'body',
    title: '身材数据',
    note: () => '身高 165 · 肩宽 38 · 腰围 66',
    icon: <IconSeason size={15} color="#77694F" />,
    tile: '#E9E2D5',
    tone: '#77694F',
  },
  {
    key: 'stats',
    title: '穿搭统计',
    note: () => '按分类、季节与色系查看',
    icon: <IconChart size={15} color="#3E6150" />,
    tile: '#E0E9E4',
    tone: '#3E6150',
  },
  {
    key: 'season',
    title: '衣橱季节',
    note: ({ seasonLabel }) => `当前：${seasonLabel}`,
    icon: <IconHeart size={15} color="#8C5541" />,
    tile: '#F0DFD5',
    tone: '#8C5541',
  },
];

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
  onSeason,
  onOpenSheet,
}: MineViewProps) {
  void _categories;
  const { animate } = useFoldMotionGate();
  const totalValue = useMemo(() => items.reduce((sum, item) => sum + parsePrice(item.price), 0), [items]);
  const worn = items.filter((item) => item.wear > 0).length;
  const seasonLabel = { all: '不限制', ss: '春夏', aw: '秋冬' }[season];
  const itemCount = useCountUp(items.length, animate);
  const outfitCount = useCountUp(outfits.length, animate);
  const valueCount = useCountUp(totalValue, animate, 950);

  const groups = COLOR_GROUPS.map((group) => ({
    ...group,
    count: items.filter((item) => (group.colors as readonly string[]).includes(item.color)).length,
  }));

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
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
            已整理 {items.length} 件单品 · {outfits.length} 套搭配</Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={1} fromY={16}>
        <View style={styles.profile}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>衣</Text>
          </View>
          <View style={styles.profileCopy}>
            <Text style={styles.profileName}>我的衣橱</Text>
            <Text style={styles.profileMeta}>ATELIER MEMBER · 0286</Text>
          </View>
          <View style={styles.profileBadge}>
            <Text style={styles.profileBadgeText}>EST. 2025</Text>
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
        <View style={styles.usageCard}>
          <UsageRing percent={71} size={66} gradient={false} animate={animate} />
          <View style={styles.useCopy}>
            <View style={styles.kickerRow}>
              <View style={[styles.kickerLine, { backgroundColor: 'rgba(245,240,227,0.24)' }]} />
              <Text style={[styles.kicker, { color: 'rgba(245,240,227,0.55)' }]}>WARDROBE USAGE</Text>
            </View>
            <Text style={styles.useTitle}>衣橱使用率 71%</Text>
            <Text style={styles.useNote}>
              {worn} 件单品本月穿过 · {Math.max(0, items.length - worn)} 件仍在等待第一次出场</Text>
            <View style={styles.useBars}>
              {[9, 14, 10, 18, 12, 16, 11, 15].map((h, i) => (
                <View
                  key={i}
                  style={[
                    styles.useBar,
                    { height: h, backgroundColor: i % 2 ? 'rgba(245,240,227,0.22)' : 'rgba(230,184,120,0.38)' },
                  ]}
                />
              ))}
            </View>
          </View>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={4} fromY={16}>
        <View style={styles.colorCard}>
          <View style={styles.ccHead}>
            <Text style={styles.ccTitle}>色彩分布</Text>
            <Text style={styles.ccMeta}>{items.length} ITEMS</Text>
          </View>
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
              衣橱设置 <Text style={styles.sectionMeta}>6 项</Text>
            </Text>
          </View>
          <Pressable onPress={() => onOpenSheet('about')} style={styles.ghostPill}>
            <Text style={styles.ghostPillText}>关于</Text>
          </Pressable>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={7} fromY={16}>
        <View style={styles.manage}>
          {MANAGE_ROWS.map((row) => (
            <Pressable key={row.key} style={styles.manageRow} onPress={() => onOpenSheet(row.key)}>
              <View style={[styles.manageIco, { backgroundColor: row.tile }]}>{row.icon}</View>
              <View style={styles.manageCopy}>
                <Text style={styles.manageTitle}>{row.title}</Text>
                <Text style={styles.manageNote}>{row.note({ items: items.length, seasonLabel })}</Text>
              </View>
              <IconArrow size={11} color={WARDROBE.muted2} />
            </Pressable>
          ))}
        </View>
      </FoldRiseIn>

      <View style={styles.foot}>
        <Text style={styles.footText}>ATELIER · MEMBER 0286</Text>
        <Text style={styles.footText}>EST. 2025</Text>
      </View>
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 122 },
  intro: { paddingTop: 7 },
  kickerRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kickerLine: { width: 14, height: 1, backgroundColor: WARDROBE.line2 },
  kicker: {
    ...wardrobeType.kicker,
    color: WARDROBE.muted,
  },
  pageTitle: {
    ...wardrobeType.pageTitle,
    marginTop: 9,
    marginBottom: 0,
    color: WARDROBE.ink,
  },
  titleItalRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 7,
  },
  pageTitlePeriod: {
    ...wardrobeType.pageTitle,
    color: WARDROBE.ink,
  },
  pageSub: { ...wardrobeType.pageSub, color: WARDROBE.muted },
  profile: {
    marginTop: 13,
    padding: 14,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(255,253,247,0.95)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    overflow: 'hidden',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 17,
    backgroundColor: WARDROBE.pine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontFamily: wardrobeFonts.serif, fontSize: 22, color: '#F6F0E1' },
  profileCopy: { flex: 1 },
  profileName: {
    ...wardrobeType.profileName,
    color: WARDROBE.ink,
  },
  profileMeta: {
    ...wardrobeType.profileMeta,
    color: WARDROBE.muted,
    marginTop: 4,
  },
  profileBadge: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(211,154,85,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(211,154,85,0.24)',
  },
  profileBadgeText: {
    ...wardrobeType.profileBadge,
    color: '#9A6A2D',
  },
  statStrip: {
    flexDirection: 'row',
    marginTop: 11,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: WARDROBE.line3,
  },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  statMid: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: WARDROBE.line3,
  },
  statNum: {
    ...wardrobeType.statNum,
    color: WARDROBE.pine,
  },
  statLabel: {
    ...wardrobeType.statLabel,
    color: WARDROBE.muted,
    marginTop: 5,
  },
  usageCard: {
    marginTop: 11,
    padding: 14,
    paddingHorizontal: 15,
    borderRadius: 22,
    backgroundColor: '#1C3A30',
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
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(252,249,241,0.62)',
  },
  ccHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 9 },
  ccTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: wardrobeEm(0.04, 10),
    color: WARDROBE.ink2,
  },
  ccMeta: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6,
    letterSpacing: wardrobeEm(0.12, 6),
    color: WARDROBE.muted,
  },
  colorBar: { flexDirection: 'row', height: 12, borderRadius: 999, overflow: 'hidden', gap: 2 },
  colorLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8, columnGap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot: { width: 5, height: 5, borderRadius: 3 },
  legendText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: WARDROBE.muted,
    letterSpacing: wardrobeEm(0.03, 6.5),
  },
  seasonCard: {
    marginTop: 11,
    padding: 12,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(252,249,241,0.62)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  seasonTitle: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 10,
    letterSpacing: wardrobeEm(0.03, 10),
    color: WARDROBE.ink2,
  },
  seasonNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: WARDROBE.muted,
    marginTop: 2,
    letterSpacing: wardrobeEm(0.02, 6.5),
  },
  segmented: {
    flexDirection: 'row',
    gap: 2,
    padding: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(33,69,58,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(33,69,58,0.07)',
  },
  seg: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999 },
  segActive: {
    backgroundColor: WARDROBE.card2,
    shadowColor: WARDROBE.pine,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  },
  segText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7,
    letterSpacing: wardrobeEm(0.02, 7),
    color: WARDROBE.muted,
  },
  segTextActive: { color: WARDROBE.pine, fontFamily: wardrobeFonts.sansSemiBold },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 18,
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
  manage: {
    marginTop: 11,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: 'rgba(252,249,241,0.7)',
    overflow: 'hidden',
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: WARDROBE.line3,
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
    color: WARDROBE.ink2,
  },
  manageNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 6.5,
    color: WARDROBE.muted,
    marginTop: 2,
    letterSpacing: wardrobeEm(0.02, 6.5),
  },
  foot: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 26,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: WARDROBE.line3,
  },
  footText: {
    ...wardrobeType.foot,
    color: WARDROBE.muted2,
  },
});
