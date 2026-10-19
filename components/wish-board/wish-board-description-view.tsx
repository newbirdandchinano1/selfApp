import { StoredImage } from '@/components/stored-image';
import { Radius, Spacing } from '@/constants/design-tokens';
import { parseWishDescription, wishDescriptionPreview } from '@/lib/wish-description';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  description: string | null | undefined;
  color: string;
  /** 列表紧凑模式：只显示文字预览，不渲染大图 */
  compact?: boolean;
  numberOfLines?: number;
};

export function WishBoardDescriptionView({
  description,
  color,
  compact = false,
  numberOfLines,
}: Props) {
  const parts = useMemo(() => parseWishDescription(description), [description]);

  if (compact) {
    const preview = wishDescriptionPreview(description);
    if (!preview) return null;
    return (
      <Text style={[styles.compactText, { color }]} numberOfLines={numberOfLines ?? 2}>
        {preview}
      </Text>
    );
  }

  if (!parts.text.trim() && parts.imageUris.length === 0) return null;

  return (
    <View style={styles.root}>
      {parts.text.trim() ? (
        <Text style={[styles.text, { color }]} numberOfLines={numberOfLines}>
          {parts.text}
        </Text>
      ) : null}
      {parts.imageUris.length > 0 ? (
        <View style={styles.images}>
          {parts.imageUris.map((uri) => (
            <StoredImage key={uri} uri={uri} style={styles.image} contentFit="cover" />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: Spacing.sm,
  },
  text: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  compactText: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
  images: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  image: {
    width: 96,
    height: 96,
    borderRadius: Radius.md,
  },
});
