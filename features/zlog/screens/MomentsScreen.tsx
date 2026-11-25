import React, { useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { useAppStore } from '../store/AppStore';
import { useToast } from '../components/Toast';
import { MomentCard } from '../components/MomentCard';
import { MomentSkeleton } from '../components/Skeleton';
import type { MomentVO } from '../api/types';

export default function MomentsScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { show } = useToast();
  const { moments, momentsLoading, refreshMoments, removeMoment } = useAppStore();

  const [keyword, setKeyword] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      refreshMoments(keyword.trim() || undefined);
    }, 320);
    return () => clearTimeout(timer);
  }, [keyword, refreshMoments]);

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshMoments(keyword.trim() || undefined);
    setRefreshing(false);
  };

  const onMenu = (moment: MomentVO) => {
    Alert.alert('说说', '要删除这条说说吗？删除后不可恢复。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeMoment(moment.id);
            show('说说已删除', 'ok');
          } catch (err: any) {
            show(err?.message || '删除失败', 'err');
          }
        },
      },
    ]);
  };

  const initialLoading = momentsLoading && moments.length === 0;

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
      <Text style={{ fontSize: 15, color: colors.inkFaint, marginBottom: 12 }}>
        此刻 ·{' '}
        <Text style={{ color: colors.ink, fontWeight: '700' }}>Moments</Text>
        <Text style={{ color: colors.inkFaint }}> —— 记录眼前的光。</Text>
      </Text>

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
          marginBottom: 16,
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
          placeholder="搜搜说说…"
          placeholderTextColor={colors.inkFaint}
          style={{ flex: 1, fontSize: 14.5, color: colors.ink, padding: 0 }}
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

      {initialLoading ? (
        <MomentSkeleton />
      ) : moments.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: 46 }}>
          <Text style={{ fontSize: 38, opacity: 0.6, marginBottom: 10 }}>🕊️</Text>
          <Text style={{ fontSize: 13, color: colors.inkFaint }}>
            还没有说说，写一条吧
          </Text>
        </View>
      ) : (
        moments.map((moment, index) => (
          <MomentCard
            key={moment.id}
            moment={moment}
            index={index}
            onMenu={() => onMenu(moment)}
          />
        ))
      )}
    </ScrollView>
  );
}
