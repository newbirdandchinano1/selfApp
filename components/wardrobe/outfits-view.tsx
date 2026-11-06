import {
  OCCASIONS,
  itemById,
  pad2,
  type WardrobeItem,
  type WardrobeOutfit,
} from '@/components/wardrobe/data';
import { WardrobeGarment, wardrobeItemPhotoSurface } from '@/components/wardrobe/garments';
import { IconArrow } from '@/components/wardrobe/icons';
import { PageTitleItal } from '@/components/wardrobe/page-title-ital';
import { FoldRiseIn, FOLD_MOTION_SPRING, useFoldMotionGate } from '@/components/review/fold-motion';
import { useWardrobeTheme, wardrobeEm, wardrobeFonts, wardrobeType, type WardrobePalette } from '@/constants/wardrobe-theme';
import React, { memo, useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type OutfitsViewProps = {
  outfits: WardrobeOutfit[];
  items: WardrobeItem[];
  occasion: string;
  occasions?: readonly string[];
  refreshControl?: React.ReactElement<RefreshControlProps>;
  onOccasion: (occasion: string) => void;
  onOpenOutfit: (id: string) => void;
  onSort?: () => void;
  /** AI 按场合组一套 */
  onSuggestOutfit?: () => void;
};

function Collage({
  outfit,
  items,
  compact,
}: {
  outfit: WardrobeOutfit;
  items: WardrobeItem[];
  compact?: boolean;
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const size = compact ? { w: 52, h: 66, gw: 33, gh: 41 } : { w: 64, h: 80, gw: 40, gh: 49 };
  return (
    <View style={[styles.collage, compact && styles.collageCompact]}>
      {outfit.items.map((id, index) => {
        const item = itemById(id, items);
        if (!item) return null;
        const big = !compact && index === 1;
        return (
          <View
            key={id}
            style={[
              styles.mini,
              {
                width: big ? 72 : size.w,
                height: big ? 90 : size.h,
                backgroundColor: wardrobeItemPhotoSurface(item, w.card),
              },
              index === 0 && styles.mini0,
              index === 1 && styles.mini1,
              index === 2 && styles.mini2,
            ]}>
            <WardrobeGarment
              item={item}
              width={big ? 45 : size.gw}
              height={big ? 55 : size.gh}
            />
          </View>
        );
      })}
    </View>
  );
}

function EmptyHangar({
  onPick,
  suggestions,
}: {
  onPick: (o: string) => void;
  suggestions: readonly string[];
}) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const swing = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(swing, { toValue: 1, duration: 2200, easing: FOLD_MOTION_SPRING, useNativeDriver: true }),
        Animated.timing(swing, { toValue: -1, duration: 2200, easing: FOLD_MOTION_SPRING, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [swing]);
  const rotate = swing.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] });

  return (
    <View style={styles.empty}>
      <Animated.View style={[styles.hanger, { transform: [{ rotate }] }]}>
        <Svg width={88} height={58} viewBox="0 0 100 70">
          <Path
            d="M50 8a9 9 0 1 1 9 9c-3 0-5 2-5 5v5l34 24c5 4 2 11-4 11H16c-6 0-9-7-4-11l35-25v-4c0-5 2-8 8-8"
            fill="none"
            stroke={w.pine}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
      </Animated.View>
      <Text style={styles.emptyTitle}>这个场合还没有搭配</Text>
      <Text style={styles.emptyCopy}>换一个场合，或把喜欢的单品组合起来，保存你的穿搭灵感。</Text>
      <View style={styles.emptyChips}>
        {suggestions.map((value) => (
          <Pressable key={value} onPress={() => onPick(value)} style={styles.chip}>
            <Text style={styles.chipText}>{value}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export const OutfitsView = memo(function OutfitsView({
  outfits,
  items,
  occasion,
  occasions: occasionsProp,
  refreshControl,
  onOccasion,
  onOpenOutfit,
  onSort,
  onSuggestOutfit,
}: OutfitsViewProps) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const { animate } = useFoldMotionGate();
  const occasionChips = occasionsProp?.length ? occasionsProp : OCCASIONS;
  const filtered = useMemo(
    () => (occasion === '全部' ? outfits : outfits.filter((o) => o.occasion === occasion)),
    [occasion, outfits],
  );

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
            <Text style={styles.kicker}>OUTFITS · {pad2(filtered.length)}</Text>
          </View>
          <Text style={styles.pageTitle}>穿成</Text>
          <View style={styles.titleItalRow}>
            <PageTitleItal>自己</PageTitleItal>
            <Text style={styles.pageTitlePeriod}>。</Text>
          </View>
          <Text style={styles.pageSub}>把喜欢的单品组合起来，保存每一次灵感。</Text>
          {onSuggestOutfit ? (
            <Pressable style={styles.aiPill} onPress={onSuggestOutfit}>
              <Text style={styles.aiPillText}>AI 组一套</Text>
            </Pressable>
          ) : null}
        </View>
      </FoldRiseIn>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {occasionChips.map((o) => {
          const count = o === '全部' ? outfits.length : outfits.filter((x) => x.occasion === o).length;
          const active = occasion === o;
          return (
            <Pressable
              key={o}
              onPress={() => onOccasion(o)}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{o}</Text>
              <Text style={[styles.chipEm, active && styles.chipEmActive]}>{pad2(count)}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {!filtered.length ? (
        <FoldRiseIn animate={animate} index={1} fromY={16}>
          <EmptyHangar
            onPick={onOccasion}
            suggestions={occasionChips.filter((v) => v !== '全部').slice(0, 4)}
          />
        </FoldRiseIn>
      ) : (
        <>
          <FoldRiseIn animate={animate} index={1} fromY={16}>
            <Pressable style={styles.feature} onPress={() => onOpenOutfit(filtered[0].id)}>
              <View style={styles.fTop}>
                <View style={styles.fTag}>
                  <View style={styles.fTagDot} />
                  <Text style={styles.fTagText}>本周灵感 · EDITOR’S PICK</Text>
                </View>
                <Text style={styles.fEdit}>LOOK 01 / 08</Text>
              </View>
              <View style={styles.fMain}>
                <View style={styles.fCopy}>
                  <View style={styles.kickerRow}>
                    <View style={styles.kickerLine} />
                    <Text style={styles.kicker}>CURATED LOOK</Text>
                  </View>
                  <Text style={styles.featureTitle}>{filtered[0].name}</Text>
                  <Text style={styles.fNote}>{filtered[0].note}</Text>
                  <View style={styles.fItems}>
                    {filtered[0].items.map((id) => {
                      const item = itemById(id, items);
                      return item ? (
                        <View key={id} style={styles.fItemChip}>
                          <Text style={styles.fItemText}>{item.name}</Text>
                        </View>
                      ) : null;
                    })}
                  </View>
                </View>
                <View style={styles.fCollage}>
                  <Collage outfit={filtered[0]} items={items} />
                </View>
              </View>
              <View style={styles.fFoot}>
                <View style={styles.fMeta}>
                  <View style={styles.fMetaDot} />
                  <Text style={styles.fMetaText}>
                    {filtered[0].occasion} · {filtered[0].date}
                  </Text>
                  <Text style={styles.fMetaText}>·</Text>
                  <Text style={styles.fMetaText}>{filtered[0].items.length} 件单品</Text>
                </View>
                <Pressable
                  style={styles.btnPrimary}
                  onPress={() => onOpenOutfit(filtered[0].id)}>
                  <Text style={styles.btnPrimaryText}>查看搭配</Text>
                  <IconArrow size={11} color={w.onPine} />
                </Pressable>
              </View>
            </Pressable>
          </FoldRiseIn>

          <FoldRiseIn animate={animate} index={2} fromY={16}>
            <View style={styles.sectionHead}>
              <View>
                <View style={styles.kickerRow}>
                  <View style={styles.kickerLine} />
                  <Text style={styles.kicker}>YOUR EDIT</Text>
                </View>
                <Text style={styles.sectionTitle}>
                  已保存 <Text style={styles.sectionMeta}>{filtered.length} 套灵感</Text>
                </Text>
              </View>
              <Pressable onPress={onSort} style={styles.ghostPill}>
                <Text style={styles.ghostPillText}>最近添加</Text>
              </Pressable>
            </View>
          </FoldRiseIn>

          <View style={styles.grid}>
            {filtered.slice(1).map((outfit, index) => (
              <FoldRiseIn key={outfit.id} animate={animate} index={3 + index} fromY={16} style={styles.gridItem}>
                <Pressable style={styles.outfitCard} onPress={() => onOpenOutfit(outfit.id)}>
                  <View style={styles.ocTag}>
                    <Text style={styles.ocTagText}>{outfit.occasion.toUpperCase()}</Text>
                  </View>
                  <Collage outfit={outfit} items={items} compact />
                  <Text style={styles.ocTitle}>{outfit.name}</Text>
                  <View style={styles.ocMeta}>
                    <Text style={styles.ocMetaText}>{outfit.date}</Text>
                    <Text style={styles.ocMetaText}>·</Text>
                    <Text style={styles.ocMetaText}>{outfit.items.length} 件</Text>
                    <Text style={[styles.ocMetaText, styles.worn]}>穿着 {outfit.wear} 次</Text>
                  </View>
                </Pressable>
              </FoldRiseIn>
            ))}
          </View>
        </>
      )}

      <View style={styles.foot}>
        <Text style={styles.footText}>ATELIER · OUTFITS</Text>
        <Text style={styles.footText}>{filtered.length} 套搭配</Text>
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
    gap: 0,
  },
  pageTitlePeriod: {
    ...wardrobeType.pageTitle,
    color: w.ink,
    marginBottom: 0,
  },
  pageSub: { ...wardrobeType.pageSub, color: w.muted, maxWidth: 238 },
  aiPill: {
    alignSelf: 'flex-start',
    marginTop: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: w.pine,
    backgroundColor: w.paper2,
  },
  aiPillText: {
    fontFamily: wardrobeFonts.sansSemiBold,
    fontSize: 13,
    color: w.pine,
  },
  chipRow: { gap: 6, paddingVertical: 13, paddingHorizontal: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.glass,
  },
  chipActive: {
    backgroundColor: w.pineSolid,
    borderColor: w.pineSolid,
  },
  chipText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8.5,
    color: w.ink3,
    letterSpacing: wardrobeEm(0.04, 8.5),
  },
  chipTextActive: { color: w.onPine },
  chipEm: {
    fontFamily: wardrobeFonts.mono,
    fontStyle: 'normal',
    fontSize: 6,
    color: w.muted2,
    letterSpacing: wardrobeEm(0.05, 6),
  },
  chipEmActive: { color: 'rgba(247,242,229,0.52)' },
  feature: {
    marginTop: 12,
    padding: 15,
    paddingBottom: 13,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.card,
    overflow: 'hidden',
  },
  fTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  fTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: w.amberMark,
    borderWidth: 1,
    borderColor: w.amberMark,
  },
  fTagDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: w.amber },
  fTagText: {
    fontFamily: wardrobeFonts.sansBold,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.08, 6.5),
    color: w.amber,
  },
  fEdit: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6,
    letterSpacing: wardrobeEm(0.2, 6),
    color: w.muted,
  },
  fMain: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  fCopy: { flex: 1, minWidth: 0, paddingRight: 4 },
  featureTitle: {
    ...wardrobeType.featureTitle,
    marginVertical: 5,
    color: w.ink,
  },
  fNote: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8,
    lineHeight: 13,
    color: w.muted,
    maxWidth: 146,
  },
  fItems: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, marginTop: 9, maxWidth: 150 },
  fItemChip: {
    paddingHorizontal: 5,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: w.pineWash,
    backgroundColor: w.glass,
  },
  fItemText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 5.5,
    color: w.ink3,
    letterSpacing: wardrobeEm(0.01, 5.5),
  },
  fCollage: { width: 142, height: 144 },
  collage: { position: 'relative', width: '100%', height: '100%' },
  collageCompact: { height: 112, marginBottom: 7 },
  mini: {
    position: 'absolute',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: w.glassBorder,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mini0: { left: '5%', top: '18%', transform: [{ rotate: '-10deg' }] },
  mini1: { left: '50%', top: '1%', marginLeft: -32, zIndex: 2, transform: [{ rotate: '1.5deg' }] },
  mini2: { right: '5%', top: '20%', transform: [{ rotate: '10deg' }] },
  fFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 9,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: w.pineWash,
    gap: 8,
  },
  fMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  fMetaDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: w.sage },
  fMetaText: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.04, 6.5),
    color: w.muted,
  },
  btnPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: w.pineSolid,
  },
  btnPrimaryText: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8.5,
    color: w.onPine,
    letterSpacing: wardrobeEm(0.04, 8.5),
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 18,
    marginBottom: 2,
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
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  gridItem: { width: '48%' as unknown as number, flexGrow: 1, flexBasis: '47%' },
  outfitCard: {
    padding: 8,
    paddingBottom: 10,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: w.line,
    backgroundColor: w.card,
    overflow: 'hidden',
  },
  ocTag: {
    position: 'absolute',
    left: 8,
    top: 8,
    zIndex: 3,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,253,247,0.8)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.7)',
  },
  ocTagText: {
    fontFamily: wardrobeFonts.sansBold,
    fontSize: 6,
    letterSpacing: wardrobeEm(0.08, 6),
    color: w.pine4,
  },
  ocTitle: {
    ...wardrobeType.outfitTitle,
    marginBottom: 4,
    color: w.ink,
  },
  ocMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  ocMetaText: {
    fontFamily: wardrobeFonts.mono,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.03, 6.5),
    color: w.muted,
  },
  worn: { marginLeft: 'auto', color: w.clay },
  empty: {
    marginTop: 14,
    padding: 38,
    paddingBottom: 34,
    borderRadius: 24,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: w.line2,
    backgroundColor: w.glass,
    alignItems: 'center',
  },
  hanger: { marginBottom: 10 },
  emptyTitle: {
    ...wardrobeType.emptyTitle,
    color: w.ink,
    marginBottom: 5,
  },
  emptyCopy: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 8.5,
    lineHeight: 14,
    color: w.muted,
    textAlign: 'center',
    maxWidth: 190,
    marginBottom: 13,
  },
  emptyChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
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
