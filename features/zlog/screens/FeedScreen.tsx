import React, { useEffect, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { fonts } from '../theme/colors';
import { useAppStore } from '../store/AppStore';
import { Chip } from '../components/Chip';
import { PostCard } from '../components/PostCard';
import { PressableScale } from '../components/PressableScale';
import { FeedSkeleton } from '../components/Skeleton';

export default function FeedScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const {
    posts,
    postsLoading,
    categories,
    offline,
    refreshPosts,
    refreshCategories,
  } = useAppStore();

  const [keyword, setKeyword] = useState('');
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    refreshCategories();
  }, [refreshCategories]);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshPosts({ keyword: keyword.trim() || undefined, categoryId });
    }, 320);
    return () => clearTimeout(timer);
  }, [keyword, categoryId, refreshPosts]);

  const featured = posts.find((p) => p.isFeatured) || posts[0];
  const initialLoading = postsLoading && posts.length === 0;

  const openDetail = (id: number) => {
    router.push({ pathname: '/blog/detail', params: { id: String(id) } });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshPosts({ keyword: keyword.trim() || undefined, categoryId });
    setRefreshing(false);
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: 18,
        paddingTop: insets.top + 56,
        paddingBottom: 160,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.sage}
        />
      }
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          backgroundColor: colors.surface,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 999,
          paddingHorizontal: 16,
          paddingVertical: 12,
          shadowColor: colors.shadow,
          shadowOpacity: 0.05,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        }}
      >
        <Ionicons name="search" size={17} color={colors.inkFaint} />
        <TextInput
          value={keyword}
          onChangeText={setKeyword}
          placeholder="搜索文章、标签、作者…"
          placeholderTextColor={colors.inkFaint}
          style={{
            flex: 1,
            fontSize: 14.5,
            color: colors.ink,
            padding: 0,
          }}
          returnKeyType="search"
        />
        {keyword.length > 0 ? (
          <Ionicons
            name="close-circle"
            size={18}
            color={colors.inkFaint}
            onPress={() => setKeyword('')}
          />
        ) : null}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingVertical: 14 }}
      >
        <Chip
          label="全部"
          active={categoryId === undefined}
          onPress={() => setCategoryId(undefined)}
        />
        {categories.map((c) => (
          <Chip
            key={c.id}
            label={c.name}
            color={c.color}
            active={categoryId === c.id}
            onPress={() => setCategoryId(c.id)}
          />
        ))}
      </ScrollView>

      {offline ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: colors.amberSoft,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 9,
            marginBottom: 10,
          }}
        >
          <Ionicons name="cloud-offline-outline" size={16} color={colors.amber} />
          <Text style={{ fontSize: 12, color: colors.inkSoft, flex: 1 }}>
            服务暂不可用，正在展示示例数据
          </Text>
        </View>
      ) : null}

      {featured ? (
        <View
          style={{
            marginTop: 2,
            borderRadius: 22,
            shadowColor: colors.shadow,
            shadowOpacity: 0.16,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 12 },
          }}
        >
          <PressableScale
            onPress={() => openDetail(featured.id)}
            style={{ borderRadius: 22, overflow: 'hidden' }}
          >
            <LinearGradient
              colors={[colors.brand, colors.sage] as [string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 20 }}
            >
              <View
                style={{
                  position: 'absolute',
                  width: 180,
                  height: 180,
                  borderRadius: 90,
                  top: -60,
                  right: -40,
                  backgroundColor: 'rgba(255,255,255,0.14)',
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  width: 120,
                  height: 120,
                  borderRadius: 60,
                  bottom: -40,
                  right: 20,
                  backgroundColor: colors.amber,
                  opacity: 0.45,
                }}
              />
              <Text
                style={{
                  fontSize: 11,
                  letterSpacing: 2,
                  color: colors.onBrand,
                  opacity: 0.8,
                  fontWeight: '600',
                }}
              >
                ✦ 精选 · FEATURED
              </Text>
              <Text
                numberOfLines={2}
                style={{
                  fontFamily: fonts.serif,
                  fontWeight: '700',
                  fontSize: 19,
                  lineHeight: 27,
                  color: colors.onBrand,
                  marginTop: 8,
                }}
              >
                {featured.title}
              </Text>
              <Text
                style={{
                  fontSize: 12.5,
                  color: colors.onBrand,
                  opacity: 0.85,
                  marginTop: 4,
                }}
              >
                本周编辑精选 · 阅读 {featured.readTime || 5} 分钟
              </Text>
              <View
                style={{
                  marginTop: 14,
                  alignSelf: 'flex-start',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  paddingHorizontal: 15,
                  paddingVertical: 8,
                  borderRadius: 999,
                }}
              >
                <Text style={{ color: colors.onBrand, fontSize: 13, fontWeight: '600' }}>
                  立即阅读
                </Text>
                <Ionicons name="arrow-forward" size={14} color={colors.onBrand} />
              </View>
            </LinearGradient>
          </PressableScale>
        </View>
      ) : null}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 22,
          marginBottom: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
          <LinearGradient
            colors={[colors.amber, colors.brand] as [string, string]}
            style={{ width: 8, height: 20, borderRadius: 4 }}
          />
          <Text
            style={{
              fontFamily: fonts.serif,
              fontWeight: '700',
              fontSize: 17,
              color: colors.ink,
            }}
          >
            最新发布
          </Text>
        </View>
        <Text style={{ fontSize: 12.5, color: colors.inkFaint }}>热门 ↗</Text>
      </View>

      {initialLoading ? (
        <FeedSkeleton />
      ) : posts.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 46 }}>
          <Text style={{ fontSize: 38, opacity: 0.6, marginBottom: 10 }}>🍃</Text>
          <Text style={{ fontSize: 13, color: colors.inkFaint }}>
            没有找到相关内容
          </Text>
        </View>
      ) : (
        posts.map((post, index) => (
          <PostCard
            key={post.id}
            post={post}
            index={index}
            onPress={() => openDetail(post.id)}
          />
        ))
      )}
    </ScrollView>
  );
}
