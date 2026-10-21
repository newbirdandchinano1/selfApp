import { Layout } from '@/constants/design-tokens';
import type { WishBoxPalette, WishBoxShadowSet } from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type WishBoardTabId = 'ready' | 'waiting';

const TABS: { key: WishBoardTabId; label: string }[] = [
  { key: 'ready', label: '🎉 可兑换' },
  { key: 'waiting', label: '🔒 暂不可兑' },
];

type Props = {
  tab: WishBoardTabId;
  counts: Record<WishBoardTabId, number>;
  onChange: (tab: WishBoardTabId) => void;
};

export function WishBoardSegment({ tab, counts, onChange }: Props) {
  const { c, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);

  return (
    <View style={styles.track} accessibilityRole="tablist">
      {TABS.map(item => {
        const selected = item.key === tab;
        const count = counts[item.key];
        return (
          <Pressable
            key={item.key}
            onPress={() => onChange(item.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${item.label} ${count}`}
            style={({ pressed }) => [
              styles.btn,
              selected ? [styles.btnOn, shadows.soft] : styles.btnOff,
              {
                opacity: pressed ? 0.9 : 1,
                backgroundColor: selected ? c.ink : c.card,
                borderColor: selected ? c.ink : 'transparent',
              },
            ]}>
            <Text
              style={[styles.text, selected ? styles.textOn : styles.textOff, { color: selected ? c.onInk : c.muted }]}
              numberOfLines={1}>
              {item.label}
            </Text>
            <View
              style={[
                styles.badge,
                selected ? styles.badgeOn : styles.badgeOff,
                { backgroundColor: selected ? c.onInkSoft : c.graySoft },
              ]}>
              <Text style={[styles.badgeText, selected ? styles.badgeTextOn : styles.badgeTextOff, { color: selected ? c.onInk : c.muted }]}>
                {count}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function pickDefaultWishBoardTab(counts: Record<WishBoardTabId, number>): WishBoardTabId {
  if (counts.ready > 0) return 'ready';
  if (counts.waiting > 0) return 'waiting';
  return 'ready';
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
    track: {
      marginHorizontal: Layout.pagePaddingX,
      flexDirection: 'row',
      gap: 8,
    },
    btn: {
      flex: 1,
      height: 38,
      borderRadius: 13,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderWidth: 1.5,
    },
    btnOn: {
      backgroundColor: c.ink,
      borderColor: c.ink,
    },
    btnOff: {
      backgroundColor: c.card,
      borderColor: 'transparent',
    },
    text: {
      fontSize: 13,
      fontWeight: '800',
    },
    textOn: {
      color: c.onInk,
    },
    textOff: {
      color: c.muted,
    },
    badge: {
      borderRadius: 99,
      paddingHorizontal: 7,
      paddingVertical: 1,
    },
    badgeOn: {
      backgroundColor: c.onInkSoft,
    },
    badgeOff: {
      backgroundColor: c.graySoft,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    badgeTextOn: {
      color: c.onInk,
    },
    badgeTextOff: {
      color: c.muted,
    },
  });
}

