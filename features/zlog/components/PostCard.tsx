import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import type { PostVO } from '../api/types';
import { useTheme } from '../theme/ThemeContext';
import { fonts } from '../theme/colors';
import { fmtCount } from '../utils/format';
import { Avatar } from './Avatar';
import { GradientCover } from './GradientCover';
import { PressableScale } from './PressableScale';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface Props {
  post: PostVO;
  index: number;
  onPress: () => void;
}

export function PostCard({ post, index, onPress }: Props) {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(0)).current;

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
  const glyph = (post.categoryName || post.title || 'z').slice(0, 1);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY }],
        marginBottom: 16,
        borderRadius: 22,
        shadowColor: colors.shadow,
        shadowOpacity: 0.07,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
      }}
    >
      <PressableScale
        onPress={onPress}
        style={{
          backgroundColor: colors.surface,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
        }}
      >
        <GradientCover seed={post.id || index + 1} glyph={glyph} height={170} radius={0} />

        <View style={{ position: 'absolute', top: 12, left: 12, flexDirection: 'row', gap: 6 }}>
          {post.isTop ? <Badge label="置顶" bg={colors.amber} fg="#3A2A08" /> : null}
          {post.isFeatured ? <Badge label="精选" bg={colors.brand} fg={colors.onBrand} /> : null}
        </View>

        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: post.categoryColor || colors.sage,
              }}
            />
            <Text style={{ fontSize: 11.5, fontWeight: '600', color: colors.sage }}>
              {post.categoryName || '未分类'}
            </Text>
          </View>

          <Text
            style={{
              fontFamily: fonts.serif,
              fontWeight: '700',
              fontSize: 17.5,
              lineHeight: 25,
              color: colors.ink,
            }}
          >
            {post.title}
          </Text>

          {post.summary ? (
            <Text
              numberOfLines={2}
              style={{
                fontSize: 13,
                lineHeight: 21,
                color: colors.inkSoft,
                marginTop: 8,
              }}
            >
              {post.summary}
            </Text>
          ) : null}

          {post.tags && post.tags.length ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 12 }}>
              {post.tags.slice(0, 3).map((t) => (
                <Text
                  key={`${t.id}-${t.name}`}
                  style={{
                    fontSize: 11,
                    color: colors.inkSoft,
                    backgroundColor: colors.sageSoft,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  #{t.name}
                </Text>
              ))}
            </View>
          ) : null}

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 14,
              paddingTop: 12,
              borderTopWidth: 1,
              borderTopColor: colors.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Avatar name={post.authorName} color={post.authorColor} size={30} radius={15} />
              <Text style={{ fontSize: 12.5, color: colors.inkSoft }}>
                {post.authorName || '匿名'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Stat icon="eye-outline" value={fmtCount(post.views)} />
              <Stat icon="heart-outline" value={fmtCount(post.likes)} />
              <Stat icon="chatbubble-outline" value={fmtCount(post.comments)} />
            </View>
          </View>
        </View>
      </PressableScale>
    </Animated.View>
  );
}

function Badge({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View
      style={{
        backgroundColor: bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
      }}
    >
      <Text style={{ color: fg, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.4 }}>
        {label}
      </Text>
    </View>
  );
}

function Stat({ icon, value }: { icon: any; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Ionicons name={icon} size={13} color={colors.inkFaint} />
      <Text style={{ fontSize: 12, color: colors.inkFaint }}>{value}</Text>
    </View>
  );
}
