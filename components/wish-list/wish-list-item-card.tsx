import { AppCard } from '@/components/ui';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { WishItemRow } from '@/lib/repositories/wish-list/wish-list.types';
import {
  clampWishDesireLevel,
  formatWishCategoryLabel,
  formatWishDesireLevelShort,
  wishReasonPreviewOrNull,
} from '@/lib/wish-list-present';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

function formatCny(value: number): string {
  return `¥ ${value.toLocaleString('zh-CN')}`;
}

function DesireStars({
  level,
  activeColor,
  inactiveColor,
}: {
  level: number;
  activeColor: string;
  inactiveColor: string;
}) {
  const lv = clampWishDesireLevel(level);
  return (
    <View style={styles.stars} accessibilityLabel={`心动等级 ${lv} / 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <MaterialIcons
          key={i}
          name={i <= lv ? 'star' : 'star-border'}
          size={13}
          color={i <= lv ? activeColor : inactiveColor}
        />
      ))}
    </View>
  );
}

export type WishListItemCardProps = {
  row: WishItemRow;
  fulfilled?: boolean;
  saved?: number;
  savingsPct?: number | null;
  onPress: () => void;
};

export function WishListItemCard({
  row,
  fulfilled = false,
  saved = 0,
  savingsPct = null,
  onPress,
}: WishListItemCardProps) {
  const { colors, isDark } = useAppTheme();
  const thumb = row.reference_image_uri;
  const desireLevel = clampWishDesireLevel(row.desire_level);
  const desireHighlight = !fulfilled && desireLevel >= 4;
  const categoryText = formatWishCategoryLabel(row.category_label);
  const reasonPreview = wishReasonPreviewOrNull(row.reason);
  const doneMuted = colors.textMuted;
  const metaMuted = fulfilled ? doneMuted : colors.textSecondary;
  const metaAccent = fulfilled ? doneMuted : colors.primary;
  const starInactive = fulfilled
    ? doneMuted
    : isDark
      ? 'rgba(148,163,184,0.35)'
      : 'rgba(148,163,184,0.55)';
  const doneSurface = isDark ? colors.surfaceMuted : colors.capsule;

  return (
    <AppCard
      padded={false}
      style={[
        styles.card,
        desireHighlight && { borderLeftWidth: 3, borderLeftColor: colors.primary },
        fulfilled && { backgroundColor: doneSurface, opacity: 0.9 },
      ]}>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.tap, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLabel={fulfilled ? `查看已实现 ${row.name}` : `编辑 ${row.name}`}>
        <View style={[styles.thumbWrap, { backgroundColor: colors.capsule }, fulfilled && { opacity: 0.65 }]}>
          {thumb ? (
            <Image source={{ uri: thumb }} style={styles.thumb} contentFit="cover" transition={150} />
          ) : (
            <MaterialIcons
              name={fulfilled ? 'check-circle' : 'card-giftcard'}
              size={28}
              color={fulfilled ? colors.success : colors.textMuted}
            />
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text
              style={[
                Typography.title,
                styles.title,
                { color: fulfilled ? doneMuted : colors.text },
                fulfilled && styles.titleDone,
                fulfilled && Platform.OS === 'android' ? styles.titleDoneAndroid : null,
              ]}
              numberOfLines={2}>
              {row.name}
            </Text>
            <Text
              style={[
                Typography.title,
                styles.price,
                { color: fulfilled ? doneMuted : colors.tertiary },
                fulfilled && styles.priceDone,
              ]}
              numberOfLines={1}>
              {formatCny(row.price)}
            </Text>
          </View>

          {fulfilled ? (
            <View style={[styles.fulfilledBadge, { backgroundColor: isDark ? 'rgba(52,211,153,0.18)' : 'rgba(0,108,73,0.1)' }]}>
              <Text style={[styles.fulfilledBadgeText, { color: colors.success }]}>已实现</Text>
            </View>
          ) : (
            <View
              style={[
                styles.metaStrip,
                {
                  backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(99,102,241,0.06)',
                  borderColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(99,102,241,0.12)',
                },
              ]}>
              <View style={styles.metaMain}>
                <Text style={[styles.metaCategory, { color: metaMuted }]} numberOfLines={1}>
                  {categoryText}
                </Text>
                <View style={[styles.metaDot, { backgroundColor: metaMuted }]} />
                <DesireStars level={desireLevel} activeColor={metaAccent} inactiveColor={starInactive} />
                <Text style={[styles.metaLevel, { color: metaMuted }]}>{formatWishDesireLevelShort(desireLevel)}</Text>
              </View>
              {reasonPreview ? (
                <Text style={[styles.metaReason, { color: metaMuted }]} numberOfLines={1}>
                  {reasonPreview}
                </Text>
              ) : null}
            </View>
          )}

          {!fulfilled && savingsPct != null ? (
            <View style={styles.savingsRow}>
              <View style={[styles.savingsTrack, { backgroundColor: colors.progressTrack }]}>
                <View
                  style={[
                    styles.savingsFill,
                    { width: `${savingsPct}%`, backgroundColor: colors.progressFill },
                  ]}
                />
              </View>
              <Text style={[Typography.caption, { color: colors.primary }]}>
                已存 {formatCny(saved)} · {savingsPct}%
              </Text>
            </View>
          ) : null}

          {!fulfilled && row.ai_comment?.trim() ? (
            <View
              style={[
                styles.aiComment,
                {
                  backgroundColor: isDark ? 'rgba(30,41,59,0.55)' : 'rgba(99,102,241,0.07)',
                  borderColor: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(99,102,241,0.12)',
                },
              ]}>
              <MaterialIcons name="auto-awesome" size={13} color={colors.primary} />
              <Text style={[styles.aiCommentText, { color: metaMuted }]} numberOfLines={2}>
                {row.ai_comment.trim()}
              </Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginBottom: Spacing.md,
  },
  tap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.xl,
    padding: Spacing['4xl'],
  },
  pressed: {
    opacity: 0.92,
  },
  thumbWrap: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumb: {
    width: 64,
    height: 64,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: Spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.lg,
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  titleDone: {
    textDecorationLine: 'line-through',
    opacity: 0.72,
  },
  titleDoneAndroid: {
    textDecorationLine: 'none',
    opacity: 0.55,
  },
  price: {
    flexShrink: 0,
    letterSpacing: -0.4,
  },
  priceDone: {
    textDecorationLine: 'line-through',
    fontSize: 14,
    fontWeight: '700',
  },
  fulfilledBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.sm,
  },
  fulfilledBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  metaStrip: {
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    gap: 4,
  },
  metaMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  metaCategory: {
    fontSize: 11,
    fontWeight: '700',
    maxWidth: '42%',
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    opacity: 0.6,
  },
  stars: {
    flexDirection: 'row',
    gap: 1,
  },
  metaLevel: {
    fontSize: 10,
    fontWeight: '700',
  },
  metaReason: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  savingsRow: {
    gap: 6,
  },
  savingsTrack: {
    height: 4,
    borderRadius: Radius.pill,
    overflow: 'hidden',
  },
  savingsFill: {
    height: '100%',
    borderRadius: Radius.pill,
  },
  aiComment: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  aiCommentText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
});
