import { MemoFormattedBody } from '@/components/memo/memo-formatted-body';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { memoHasAiReview } from '@/lib/memo-format';
import {
    getMemo,
    memoListPreviewTitle,
    type MemoItem,
} from '@/lib/memos';
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

export default function MemoViewScreen() {
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
  const quoteBg = isDark ? 'rgba(30,41,59,0.55)' : 'rgba(0,88,190,0.06)';
  const headerBg = isDark ? 'rgba(17,24,39,0.98)' : 'rgba(255,255,255,0.98)';

  const [row, setRow] = useState<MemoItem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      const item = await getMemo(id);
      if (!item) {
        Alert.alert('未找到', '该备忘可能已删除', [{ text: '确定', onPress: () => router.back() }]);
        setRow(null);
        return;
      }
      setRow(item);
    } catch {
      Alert.alert('加载失败', '请返回重试', [{ text: '确定', onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load]),
  );

  const displayTitle = row ? memoListPreviewTitle(row) : '';
  const showAi = row ? memoHasAiReview(row) : false;

  if (!id) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>缺少备忘 ID</Text>
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
            查看备忘
          </Text>
          <Pressable
            style={styles.roundIconBtn}
            onPress={() => router.push({ pathname: '/memo-edit/[id]', params: { id } })}
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

          <View style={[styles.bodyCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
            <MemoFormattedBody
              body={row.body}
              color={text}
              mutedColor={outline}
              quoteBg={quoteBg}
            />
          </View>

          {showAi ? (
            <View style={[styles.aiCard, { borderColor: borderSoft, backgroundColor: cardBg }]}>
              <View style={styles.aiHeader}>
                <MaterialIcons name="auto-awesome" size={18} color={primary} />
                <Text style={[styles.aiTitle, { color: text }]}>AI 评价与建议</Text>
              </View>

              <Text style={[styles.aiKicker, { color: outline }]}>评价</Text>
              <Text style={[styles.aiText, { color: text }]}>
                {row.ai_evaluation?.trim() || '（暂无评价内容）'}
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
          <Text style={{ color: outline, fontWeight: '600' }}>未找到该备忘</Text>
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
    minHeight: 120,
  },
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
