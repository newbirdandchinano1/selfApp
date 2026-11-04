import type { WardrobeItem } from '@/components/wardrobe/data';
import {
  WardrobeGarment,
  wardrobeItemHasCutout,
  wardrobeItemPhotoSurface,
} from '@/components/wardrobe/garments';
import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import {
  useWardrobeTheme,
  wardrobeEm,
  wardrobeFonts,
  wardrobeType,
  type WardrobePalette,
} from '@/constants/wardrobe-theme';
import React, { memo, useMemo } from 'react';
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

function createStyles(w: WardrobePalette) {
  return StyleSheet.create({
    card: {
      borderRadius: 19,
      borderWidth: 1,
      borderColor: w.line,
      backgroundColor: w.card,
      padding: 7,
      paddingBottom: 9,
      overflow: 'hidden',
    },
    /**
     * 双列：宽度落在 FoldRiseIn 外层。
     * 必须带 flexBasis；纯百分比 width 在 flexWrap + Animated.View 上常塌成 0。
     */
    gridWrap: {
      width: '48%' as unknown as number,
      flexBasis: '47%',
      flexGrow: 0,
      flexShrink: 0,
      maxWidth: '48.5%',
    },
    listWrap: {
      width: '100%' as unknown as number,
      alignSelf: 'stretch',
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
      backgroundColor: w.glass,
    },
    tag: {
      position: 'absolute',
      left: 7,
      top: 7,
      zIndex: 2,
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: 999,
      /** 叠在 pastel 缩略图上，两侧都用半透霜面，避免夜间 glassStrong 变成深底 */
      backgroundColor: 'rgba(255,253,247,0.78)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.62)',
    },
    tagText: {
      fontFamily: wardrobeFonts.sansBold,
      fontSize: 6.5,
      letterSpacing: wardrobeEm(0.07, 6.5),
      color: w.pine4,
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
      color: 'rgba(44,64,55,0.45)',
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
      color: w.ink,
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
      color: w.muted,
    },
    price: {
      ...wardrobeType.itemSub,
      fontFamily: wardrobeFonts.monoSemiBold,
      color: w.clay,
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
}

export const ItemCard = memo(function ItemCard({
  item,
  index = 0,
  variant = 'rail',
  onPress,
  animate: animateProp,
}: ItemCardProps) {
  const { w } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const gate = useFoldMotionGate();
  const animate = animateProp ?? gate.animate;

  const isList = variant === 'list';
  const isGrid = variant === 'grid';
  const garmentW = isList ? 50 : isGrid ? 82 : 72;
  const garmentH = isList ? 58 : isGrid ? 96 : 84;
  const hasCutout = wardrobeItemHasCutout(item);
  const thumbBg = wardrobeItemPhotoSurface(item, w.card);

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
          { backgroundColor: thumbBg },
        ]}>
        {!hasCutout ? (
          <>
            <View style={[styles.thumbGlow, { backgroundColor: item.tint2 }]} />
            <View style={styles.thumbHighlight} />
          </>
        ) : null}
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
      index={Math.min(index, 12)}
      fromY={16}
      /** 布局切换会整表重挂；holdHidden 易把双列/单列卡在 opacity:0 */
      holdHidden={false}
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
  const { w, isDark } = useWardrobeTheme();
  const styles = useMemo(() => createStyles(w), [w]);
  const bg = isDark ? w.card2 : tint;
  const fg = isDark ? w.pine : tone;
  const plusBg = isDark ? w.pineWash : `${tint2}99`;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        styles.cardRail,
        styles.emptyCard,
        { borderStyle: 'dashed', backgroundColor: bg, opacity: pressed ? 0.85 : 1 },
      ]}>
      <View style={[styles.emptyInner, { borderColor: fg }]}>
        <View style={[styles.emptyPlus, { borderColor: fg, backgroundColor: plusBg }]}>
          <Text style={{ color: fg, fontSize: 16, lineHeight: 18 }}>+</Text>
        </View>
        <Text style={[styles.emptyLabel, { color: fg }]}>添加第一件</Text>
      </View>
    </Pressable>
  );
}
