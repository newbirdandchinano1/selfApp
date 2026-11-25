import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Linking,
  Pressable,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { MomentVO } from '../api/types';
import { imageUrl } from '../api/client';
import { useTheme } from '../theme/ThemeContext';
import { glyphs } from '../theme/colors';
import { formatTime } from '../utils/format';
import { Avatar } from './Avatar';
import { GradientCover } from './GradientCover';
import { ImageLightbox } from './ImageLightbox';
import { useToast } from './Toast';

interface Props {
  moment: MomentVO;
  index: number;
  onMenu: () => void;
}

export function MomentCard({ moment, index, onMenu }: Props) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const { show } = useToast();
  const anim = useRef(new Animated.Value(0)).current;
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const openLink = useCallback(async () => {
    const raw = moment.linkCard?.url?.trim();
    if (!raw) {
      show('链接无效', 'warn');
      return;
    }
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      const can = await Linking.canOpenURL(href);
      if (!can) {
        show('无法打开该链接', 'warn');
        return;
      }
      await Linking.openURL(href);
    } catch {
      show('打开链接失败', 'err');
    }
  }, [moment.linkCard?.url, show]);

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 14,
        bounciness: 5,
      }).start();
    }, Math.min(index, 6) * 55);
    return () => clearTimeout(timer);
  }, [anim, index]);

  const translateY = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [22, 0],
  });

  // 屏幕水平内边距 18*2，卡片内边距 16*2
  const contentWidth = Math.min(width, 560) - 36 - 32;
  const images = moment.images || [];
  const previewUris = useMemo(
    () => images.map((img) => imageUrl(img)).filter((u): u is string => Boolean(u)),
    [images],
  );
  const count = images.length;
  const size =
    count <= 1 ? contentWidth * 0.62 : count === 2 ? (contentWidth - 6) / 2 : (contentWidth - 12) / 3;

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY }],
        marginBottom: 14,
      }}
    >
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 16,
          shadowColor: colors.shadow,
          shadowOpacity: 0.07,
          shadowRadius: 16,
          shadowOffset: { width: 0, height: 8 },
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 11 }}>
          <Avatar name={moment.author} color={moment.authorColor} size={40} radius={14} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>
              {moment.author || '匿名'}
            </Text>
            <Text style={{ fontSize: 11.5, color: colors.inkFaint, marginTop: 2 }}>
              {formatTime(moment.timestamp)}
            </Text>
          </View>
          <Pressable onPress={onMenu} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal" size={18} color={colors.inkFaint} />
          </Pressable>
        </View>

        {moment.content ? (
          <Text style={{ fontSize: 14.5, lineHeight: 25, color: colors.ink, marginBottom: 12 }}>
            {moment.content}
          </Text>
        ) : null}

        {count > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
            {images.slice(0, 9).map((img, i) => {
              const uri = imageUrl(img);
              if (uri) {
                const previewAt = previewUris.indexOf(uri);
                return (
                  <Pressable
                    key={`${moment.id}-${i}`}
                    onPress={() => setPreviewIndex(previewAt >= 0 ? previewAt : 0)}
                    accessibilityRole="imagebutton"
                    accessibilityLabel="查看大图"
                  >
                    <Image
                      source={{ uri }}
                      style={{
                        width: size,
                        height: size,
                        borderRadius: 10,
                        backgroundColor: colors.surface2,
                      }}
                    />
                  </Pressable>
                );
              }
              return (
                <GradientCover
                  key={`${moment.id}-${i}`}
                  seed={(moment.id || 0) + i + 1}
                  glyph={glyphs[i % glyphs.length]}
                  width={size}
                  height={size}
                  radius={10}
                  fontSize={Math.round(size * 0.36)}
                />
              );
            })}
          </View>
        ) : null}

        {moment.linkCard ? (
          <Pressable
            onPress={openLink}
            accessibilityRole="link"
            accessibilityLabel={`打开外链 ${moment.linkCard.title || ''}`}
            style={({ pressed }) => ({
              flexDirection: 'row',
              gap: 12,
              alignItems: 'center',
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 16,
              padding: 10,
              marginBottom: 12,
              backgroundColor: colors.surface2,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {imageUrl(moment.linkCard.cover) ? (
              <Image
                source={{ uri: imageUrl(moment.linkCard.cover) }}
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 10,
                  backgroundColor: colors.surface,
                }}
              />
            ) : (
              <GradientCover
                seed={(moment.id || 0) + 9}
                glyph={moment.linkCard.platform === 'bilibili' ? 'B' : '链'}
                width={56}
                height={56}
                radius={10}
                fontSize={20}
              />
            )}
            <View style={{ flex: 1 }}>
              <Text
                style={{
                  fontSize: 10.5,
                  color: colors.sage,
                  fontWeight: '700',
                  letterSpacing: 0.8,
                }}
              >
                {(moment.linkCard.platform || 'link').toUpperCase()}
              </Text>
              <Text
                numberOfLines={1}
                style={{ fontSize: 13, fontWeight: '600', color: colors.ink, marginTop: 2 }}
              >
                {moment.linkCard.title}
              </Text>
              {moment.linkCard.description ? (
                <Text
                  numberOfLines={1}
                  style={{ fontSize: 11.5, color: colors.inkFaint, marginTop: 2 }}
                >
                  {moment.linkCard.description}
                </Text>
              ) : null}
            </View>
            <Ionicons name="open-outline" size={16} color={colors.inkFaint} />
          </Pressable>
        ) : null}

      </View>

      <ImageLightbox
        uris={previewUris}
        initialIndex={previewIndex ?? 0}
        visible={previewIndex != null}
        onClose={() => setPreviewIndex(null)}
      />
    </Animated.View>
  );
}
