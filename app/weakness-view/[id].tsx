import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  getUserWeakness,
  weaknessHasAiReview,
  weaknessListPreviewTitle,
  type UserWeaknessItem,
} from '@/lib/user-weaknesses';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

function normalizeId(raw: string | string[] | undefined): string {
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw) && raw[0]) return raw[0];
  return '';
}

const PAGE_API_KEY = 'weakness-view';

export default function WeaknessViewScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id: idParam } = useLocalSearchParams<{ id: string }>();
  const id = normalizeId(idParam);

  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#424754';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const borderSoft = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.25)';
  const cardBg = isDark ? '#111827' : '#ffffff';
  const headerBg = isDark ? 'rgba(17,24,39,0.98)' : 'rgba(255,255,255,0.98)';

  const [row, setRow] = useState<UserWeaknessItem | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (forceApi = false) => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      await wrapLoad(async () => {
        const item = await getUserWeakness(id);
        if (!item) {
          Alert.alert('未找到', '该记录可能已删除', [{ text: '确定', onPress: () => router.back() }]);
          setRow(null);
          return;
        }
        setRow(item);
      }, forceApi);
    } catch {
      Alert.alert('加载失败', '请返回重试', [{ text: '确定', onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [id, router, wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void reload();
    }, [reload]),
  );

  const displayTitle = row ? weaknessListPreviewTitle(row) : '';
  const showAi = row ? weaknessHasAiReview(row) : false;

  if (!id) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>缺少记录 ID</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View
        style={[
          styles.topBarWrap,
          {
            paddingTop: insets.top,
            backgroundColor: headerBg,
            borderBottomColor: borderSoft,
          },
        ]}
      >
        <View style={styles.topBar}>
          <Pressable style={styles.roundIconBtn} onPress={() => router.back()}>
            <MaterialIcons name="arrow-back-ios-new" size={20} color={primary} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: text }]} numberOfLines={1}>
            查看缺点
          </Text>
          <Pressable
            style={styles.roundIconBtn}
            onPress={() => router.push({ pathname: '/weakness-edit/[id]', params: { id } })}
            disabled={!row}
          >
            <MaterialIcons name="edit" size={22} color={primary} />
          </Pressable>
        </View>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={primary} />
        </View>
      ) : row ? (
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.scrollInner,
            { paddingBottom: Math.max(insets.bottom, 20) + 32 },
          ]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.title, { color: text }]}>{displayTitle}</Text>
          <Text style={[styles.meta, { color: outline }]}>
            更新于 {new Date(row.updated_at).toLocaleString('zh-CN')}
            {row.created_at !== row.updated_at
              ? ` · 创建于 ${new Date(row.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric' })}`
              : ''}
          </Text>

          {row.detail.trim() ? (
            <View style={[styles.bodyCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <Text style={[styles.bodyText, { color: text }]}>{row.detail.trim()}</Text>
            </View>
          ) : (
            <View style={[styles.bodyCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <Text style={[styles.bodyText, { color: outline }]}>（无详情）</Text>
            </View>
          )}

          {showAi ? (
            <View style={[styles.aiCard, { borderColor: borderSoft, backgroundColor: cardBg }]}>
              <View style={styles.aiHeader}>
                <MaterialIcons name="auto-awesome" size={18} color={primary} />
                <Text style={[styles.aiTitle, { color: text }]}>AI 分析与建议</Text>
              </View>

              <Text style={[styles.aiKicker, { color: outline }]}>分析</Text>
              <Text style={[styles.aiText, { color: text }]}>
                {row.ai_evaluation?.trim() || '（暂无分析内容）'}
              </Text>

              <Text style={[styles.aiKicker, { color: outline, marginTop: 16 }]}>建议</Text>
              <Text style={[styles.aiText, { color: secondary }]}>
                {row.ai_suggestions?.trim() || '（暂无建议内容）'}
              </Text>

              {row.ai_review_at ? (
                <Text style={[styles.aiTime, { color: outline }]}>
                  生成于 {new Date(row.ai_review_at).toLocaleString('zh-CN')}
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <View style={styles.loadingWrap}>
          <Text style={{ color: outline, fontWeight: '600' }}>未找到该记录</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBarWrap: {
    borderBottomWidth: 1,
    zIndex: 10,
    elevation: 6,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    minHeight: 48,
    paddingBottom: 8,
  },
  roundIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    marginHorizontal: 4,
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollInner: { paddingHorizontal: 18, paddingTop: 20 },
  title: { fontSize: 24, fontWeight: '900', lineHeight: 32 },
  meta: { fontSize: 12, fontWeight: '600', marginTop: 8, marginBottom: 18 },
  bodyCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
    minHeight: 80,
  },
  bodyText: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
  aiCard: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  aiTitle: { fontSize: 16, fontWeight: '800' },
  aiKicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.1, marginBottom: 8 },
  aiText: { fontSize: 15, fontWeight: '600', lineHeight: 24 },
  aiTime: { fontSize: 11, fontWeight: '600', marginTop: 14 },
});
