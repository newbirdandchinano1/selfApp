import type { WardrobeItem } from '@/components/wardrobe/data';
import { WardrobeGarment } from '@/components/wardrobe/garments';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { WARDROBE, wardrobeEm, wardrobeFonts, wardrobeType } from '@/constants/wardrobe-theme';
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type ItemCardProps = {
  item: WardrobeItem;
  index?: number;
  variant?: 'rail' | 'grid' | 'list';
  onPress: () => void;
  animate?: boolean;
};

function codeTail(code: string) {
  const parts = code.split('/');
  return (parts[1] ?? code).trim();
}

export const ItemCard = memo(function ItemCard({
  item,
  index = 0,
  variant = 'rail',
  onPress,
  animate: animateProp,
}: ItemCardProps) {
  const gate = useFoldMotionGate();
  const animate = animateProp ?? gate.animate;

  const isList = variant === 'list';
  const isGrid = variant === 'grid';
  const garmentW = isList ? 50 : isGrid ? 82 : 72;
  const garmentH = isList ? 58 : isGrid ? 96 : 84;

  const wrapStyle = isGrid ? styles.gridWrap : isList ? styles.listWrap : undefined;

  const card = (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`查看${item.name}`}
      style={({ pressed }) => [
        styles.card,
        isList && styles.cardList,
        isGrid && styles.cardGrid,
        !isList && !isGrid && styles.cardRail,
        pressed && styles.cardPressed,
      ]}>
      <View
        style={[
          styles.thumb,
          isList && styles.thumbList,
          isGrid && styles.thumbGrid,
          { backgroundColor: item.tint },
        ]}>
        <View style={[styles.thumbGlow, { backgroundColor: item.tint2 }]} />
        <View style={styles.thumbHighlight} />
        <View style={styles.tag}>
          <Text style={styles.tagText} numberOfLines={1}>
            {item.category.toUpperCase()}
          </Text>
        </View>
        <View style={styles.garmentWrap}>
          <WardrobeGarment item={item} width={garmentW} height={garmentH} />
        </View>
        <Text style={styles.index}>{codeTail(item.code)}</Text>
      </View>
      <View style={[styles.meta, isList && styles.metaList]}>
        <Text style={[styles.name, isList && styles.nameList, isGrid && styles.nameGrid]} numberOfLines={1}>
          {item.name}
        </Text>
        <View style={styles.sub}>
          <Text style={styles.brand} numberOfLines={1}>
            {item.brand}
          </Text>
          <Text style={styles.price}>{item.price}</Text>
        </View>
      </View>
    </Pressable>
  );

  return (
    <FoldRiseIn
      animate={animate}
      index={index}
      fromY={16}
      holdHidden={!gate.motionReduced}
      style={wrapStyle}>
      {card}
    </FoldRiseIn>
  );
});

export function EmptyCategoryCard({
  tone,
  tint,
  tint2,
  onPress,
}: {
  tone: string;
  tint: string;
  tint2: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        styles.cardRail,
        styles.emptyCard,
        { borderStyle: 'dashed', backgroundColor: tint, opacity: pressed ? 0.85 : 1 },
      ]}>
      <View style={[styles.emptyInner, { borderColor: tone }]}>
        <View style={[styles.emptyPlus, { borderColor: tone, backgroundColor: `${tint2}99` }]}>
          <Text style={{ color: tone, fontSize: 16, lineHeight: 18 }}>+</Text>
        </View>
        <Text style={[styles.emptyLabel, { color: tone }]}>添加第一件</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 19,
    borderWidth: 1,
    borderColor: WARDROBE.line,
    backgroundColor: WARDROBE.card,
    padding: 7,
    paddingBottom: 9,
    overflow: 'hidden',
  },
  /** 双列：宽度落在 FoldRiseIn 外层；与 flatGrid 的 space-between 搭配 */
  gridWrap: {
    width: '48.5%',
    flexGrow: 0,
    flexShrink: 0,
  },
  listWrap: {
    width: '100%',
  },
  cardRail: {
    width: 138,
  },
  cardGrid: {
    width: '100%',
    minWidth: 0,
    borderRadius: 21,
  },
  cardList: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 7,
    paddingLeft: 7,
    paddingRight: 12,
    borderRadius: 18,
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.98 }],
  },
  thumb: {
    height: 120,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbGrid: {
    height: 148,
  },
  thumbList: {
    width: 80,
    height: 86,
    flexShrink: 0,
  },
  thumbGlow: {
    position: 'absolute',
    width: 88,
    height: 88,
    borderRadius: 44,
    top: -30,
    right: -22,
    opacity: 0.55,
  },
  thumbHighlight: {
    position: 'absolute',
    width: 70,
    height: 70,
    borderRadius: 35,
    top: 8,
    left: 10,
    backgroundColor: 'rgba(255,253,248,0.45)',
  },
  tag: {
    position: 'absolute',
    left: 7,
    top: 7,
    zIndex: 2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,253,247,0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.62)',
  },
  tagText: {
    fontFamily: wardrobeFonts.sansBold,
    fontSize: 6.5,
    letterSpacing: wardrobeEm(0.07, 6.5),
    color: WARDROBE.pine,
  },
  garmentWrap: {
    zIndex: 1,
  },
  index: {
    position: 'absolute',
    right: 8,
    bottom: 6,
    zIndex: 2,
    fontFamily: wardrobeFonts.mono,
    fontSize: 6,
    letterSpacing: wardrobeEm(0.12, 6),
    color: 'rgba(44,64,55,0.42)',
  },
  meta: {
    gap: 2,
    paddingTop: 7,
    paddingHorizontal: 2,
  },
  metaList: {
    flex: 1,
    paddingTop: 0,
    minWidth: 0,
  },
  name: {
    ...wardrobeType.itemName,
    color: WARDROBE.ink,
  },
  nameGrid: {
    fontSize: 12,
  },
  nameList: {
    fontSize: 13,
  },
  sub: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 4,
  },
  brand: {
    flex: 1,
    ...wardrobeType.itemSub,
    color: WARDROBE.muted,
  },
  price: {
    ...wardrobeType.itemSub,
    fontFamily: wardrobeFonts.monoSemiBold,
    color: WARDROBE.clay,
  },
  emptyCard: {
    minHeight: 154,
    justifyContent: 'center',
    alignItems: 'center',
    shadowOpacity: 0,
    elevation: 0,
  },
  emptyInner: {
    alignItems: 'center',
    gap: 7,
  },
  emptyPlus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    fontFamily: wardrobeFonts.sans,
    fontSize: 7.5,
    letterSpacing: wardrobeEm(0.05, 7.5),
  },
});
