import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { fonts } from '../theme/colors';
import { api } from '../api/client';
import type { PostVO } from '../api/types';
import { useAppStore } from '../store/AppStore';
import { GradientCover } from '../components/GradientCover';
import { PressableScale } from '../components/PressableScale';
import { fmtCount, formatTime } from '../utils/format';
import { htmlToBlocks } from '../utils/html';
import { resolveAvatarColor } from '../utils/avatarColor';
import { useToast } from '../components/Toast';

const COVER_HEIGHT = 260;

export default function DetailScreen() {
  const { id: idParam } = useLocalSearchParams<{ id?: string }>();
  const postId = Number(idParam);
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const { posts } = useAppStore();

  const cached = posts.find((p) => p.id === postId);
  const [post, setPost] = useState<PostVO | null>(cached ?? null);
  const [loading, setLoading] = useState(!cached);

  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!Number.isFinite(postId) || postId <= 0) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading((prev) => (post ? prev : true));
    api
      .getPost(postId)
      .then((data) => {
        if (!alive) return;
        setPost((prev) => ({ ...(prev || {}), ...data }));
      })
      .catch(() => {
        if (!alive) return;
        if (!post) show('详情加载失败', 'err');
        else show('详情加载失败，展示缓存内容', 'warn');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postId]);

  const coverTranslateY = scrollY.interpolate({
    inputRange: [0, COVER_HEIGHT],
    outputRange: [0, COVER_HEIGHT * 0.35],
    extrapolate: 'clamp',
  });
  const coverScale = scrollY.interpolate({
    inputRange: [-120, 0],
    outputRange: [1.4, 1],
    extrapolateRight: 'clamp',
  });
  const coverOpacity = scrollY.interpolate({
    inputRange: [0, COVER_HEIGHT * 0.8],
    outputRange: [1, 0.35],
    extrapolate: 'clamp',
  });

  if (loading && !post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.sage} />
      </View>
    );
  }

  if (!post) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <Text style={{ color: colors.inkSoft }}>文章不存在或已下架</Text>
        <PressableScale onPress={() => router.back()}>
          <Text style={{ color: colors.sage, fontWeight: '600' }}>返回</Text>
        </PressableScale>
      </View>
    );
  }

  const blocks = htmlToBlocks(post.contentHtml, post.summary);
  const glyph = (post.categoryName || post.title || 'z').slice(0, 1);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <StatusBar style="light" />
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: COVER_HEIGHT,
          transform: [{ translateY: coverTranslateY }, { scale: coverScale }],
          opacity: coverOpacity,
        }}
      >
        <GradientCover seed={post.id} glyph={glyph} height={COVER_HEIGHT} radius={0} />
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.10)', colors.bg] as [string, string, string]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.ScrollView
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: insets.bottom + 40 }}
      >
        <View style={{ height: COVER_HEIGHT - 46 }} />

        <View
          style={{
            backgroundColor: colors.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingHorizontal: 20,
            paddingTop: 24,
          }}
        >
          <Text
            style={{
              fontFamily: fonts.serif,
              fontWeight: '900',
              fontSize: 25,
              lineHeight: 35,
              color: colors.ink,
            }}
          >
            {post.title}
          </Text>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              marginTop: 16,
              paddingBottom: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <View
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                backgroundColor: resolveAvatarColor(post.authorColor, colors.sage),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#FFF', fontWeight: '700', fontSize: 17 }}>
                {(post.authorName || '臻').slice(0, 1)}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.ink }}>
                {post.authorName || '臻'}
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 2 }}>
                <Text style={{ fontSize: 12, color: colors.inkFaint }}>
                  {formatTime(post.createTime)}
                </Text>
                <Text style={{ fontSize: 12, color: colors.inkFaint }}>
                  · 约 {post.readTime || 5} 分钟
                </Text>
              </View>
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: 16, marginVertical: 16 }}>
            <Meta icon="eye-outline" value={`${fmtCount(post.views)} 阅读`} />
            <Meta icon="chatbubble-outline" value={`${fmtCount(post.comments)} 评论`} />
            <Meta icon="heart-outline" value={`${fmtCount(post.likes)} 喜欢`} />
          </View>

          <View>
            {blocks.map((block, i) => {
              if (block.type === 'h1' || block.type === 'h2' || block.type === 'h3') {
                return (
                  <Text
                    key={i}
                    style={{
                      fontFamily: fonts.serif,
                      fontWeight: '700',
                      fontSize: block.type === 'h1' ? 22 : block.type === 'h2' ? 20 : 17,
                      color: colors.ink,
                      marginTop: i === 0 ? 0 : 22,
                      marginBottom: 10,
                      lineHeight: 30,
                    }}
                  >
                    {block.text}
                  </Text>
                );
              }
              if (block.type === 'quote') {
                return (
                  <View
                    key={i}
                    style={{
                      borderLeftWidth: 3,
                      borderLeftColor: colors.amber,
                      backgroundColor: colors.amberSoft,
                      borderRadius: 12,
                      paddingVertical: 12,
                      paddingHorizontal: 16,
                      marginVertical: 10,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 14,
                        lineHeight: 24,
                        color: colors.inkSoft,
                        fontStyle: 'italic',
                      }}
                    >
                      {block.text}
                    </Text>
                  </View>
                );
              }
              return (
                <Text
                  key={i}
                  style={{
                    fontSize: 15.5,
                    lineHeight: 29,
                    color: colors.ink,
                    marginBottom: 14,
                  }}
                >
                  {block.text}
                </Text>
              );
            })}
          </View>
        </View>
      </Animated.ScrollView>

      <BlurView
        intensity={isDark ? 40 : 70}
        tint={isDark ? 'dark' : 'light'}
        style={{
          position: 'absolute',
          top: insets.top + 6,
          left: 16,
          width: 42,
          height: 42,
          borderRadius: 14,
          overflow: 'hidden',
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <PressableScale
          onPress={() => router.back()}
          style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center' }}
          hitSlop={10}
        >
          <Ionicons name="chevron-back" size={22} color={colors.ink} />
        </PressableScale>
      </BlurView>
    </View>
  );
}

function Meta({ icon, value }: { icon: any; value: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Ionicons name={icon} size={14} color={colors.inkFaint} />
      <Text style={{ fontSize: 13, color: colors.inkSoft }}>{value}</Text>
    </View>
  );
}
