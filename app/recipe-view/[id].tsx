import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  getRecipe,
  getRecipeCategory,
  recipeListPreviewTitle,
  type RecipeItem,
} from '@/lib/recipes';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
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

const PAGE_API_KEY = 'recipe-view';

export default function RecipeViewScreen() {
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
  const outline = isDark ? 'rgba(148,163,184,0.85)' : '#5c6370';
  const outlineMuted = isDark ? 'rgba(148,163,184,0.55)' : '#8b92a0';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const accent = isDark ? '#fb923c' : '#ea580c';
  const accentSoft = isDark ? 'rgba(251,146,60,0.18)' : 'rgba(234,88,12,0.1)';
  const primarySoft = isDark ? 'rgba(96,165,250,0.15)' : 'rgba(0,88,190,0.08)';
  const borderSoft = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(0,88,190,0.08)';
  const cardBg = isDark ? '#1e293b' : '#ffffff';
  const headerBg = isDark ? 'rgba(15,23,42,0.96)' : 'rgba(255,255,255,0.96)';

  const [row, setRow] = useState<RecipeItem | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async (forceApi = false) => {
    if (!id) {
      setLoading(false);
      return;
    }
    try {
      await wrapLoad(async () => {
        const item = await getRecipe(id);
        if (!item) {
          Alert.alert('未找到', '该菜谱可能已删除', [{ text: '确定', onPress: () => router.back() }]);
          setRow(null);
          return;
        }
        const cat = await getRecipeCategory(item.category_id);
        setCategoryName(cat?.name ?? '');
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

  const displayTitle = row ? recipeListPreviewTitle(row) : '';

  if (!id) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ fontSize: 15, fontWeight: '600' }}>缺少菜谱 ID</Text>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <View
        style={[
          styles.topBarWrap,
          { paddingTop: insets.top, backgroundColor: headerBg, borderBottomColor: borderSoft },
        ]}
      >
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [
              styles.headerIconBtn,
              { backgroundColor: isDark ? 'rgba(30,41,59,0.6)' : '#fff', opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => router.back()}
          >
            <MaterialIcons name="arrow-back-ios-new" size={18} color={primary} />
          </Pressable>
          <Text style={[styles.topBarTitle, { color: text }]} numberOfLines={1}>
            菜谱详情
          </Text>
          <Pressable
            style={({ pressed }) => [
              styles.headerIconBtn,
              { backgroundColor: primarySoft, opacity: pressed || !row ? 0.6 : 1 },
            ]}
            onPress={() => router.push({ pathname: '/recipe-edit/[id]', params: { id } })}
            disabled={!row}
          >
            <MaterialIcons name="edit" size={20} color={primary} />
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
          {row.finished_image_uri ? (
            <View style={styles.heroWrap}>
              <Image
                source={{ uri: row.finished_image_uri }}
                style={styles.heroImage}
                contentFit="cover"
              />
            </View>
          ) : null}

          <View style={styles.titleBlock}>
            {categoryName ? (
              <View style={[styles.categoryBadge, { backgroundColor: accentSoft, borderColor: borderSoft }]}>
                <MaterialIcons name="folder" size={14} color={accent} />
                <Text style={[styles.categoryText, { color: accent }]}>{categoryName}</Text>
              </View>
            ) : null}
            <Text style={[styles.title, { color: text }]}>{displayTitle}</Text>
            <View style={styles.metaChipRow}>
              {row.ingredients.length > 0 ? (
                <View style={[styles.metaChip, { backgroundColor: accentSoft }]}>
                  <Text style={[styles.metaChipText, { color: accent }]}>{row.ingredients.length} 食材</Text>
                </View>
              ) : null}
              {row.steps.length > 0 ? (
                <View style={[styles.metaChip, { backgroundColor: primarySoft }]}>
                  <Text style={[styles.metaChipText, { color: primary }]}>{row.steps.length} 步</Text>
                </View>
              ) : null}
            </View>
            <Text style={[styles.meta, { color: outlineMuted }]}>
              更新于 {new Date(row.updated_at).toLocaleString('zh-CN')}
            </Text>
          </View>

          {row.ingredients.length > 0 ? (
            <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <View style={styles.sectionHead}>
                <View style={[styles.sectionIcon, { backgroundColor: accentSoft }]}>
                  <MaterialIcons name="shopping-basket" size={18} color={accent} />
                </View>
                <Text style={[styles.sectionTitle, { color: text }]}>食材</Text>
              </View>
              {row.ingredients.map((line, i) => (
                <View
                  key={`ing-${i}`}
                  style={[styles.listRow, i < row.ingredients.length - 1 && { borderBottomColor: borderSoft, borderBottomWidth: StyleSheet.hairlineWidth }]}
                >
                  <View style={[styles.bullet, { backgroundColor: accent }]} />
                  <Text style={[styles.listText, { color: text }]}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {row.steps.length > 0 ? (
            <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <View style={styles.sectionHead}>
                <View style={[styles.sectionIcon, { backgroundColor: primarySoft }]}>
                  <MaterialIcons name="format-list-numbered" size={18} color={primary} />
                </View>
                <Text style={[styles.sectionTitle, { color: text }]}>步骤</Text>
              </View>
              {row.steps.map((line, i) => (
                <View key={`step-${i}`} style={styles.stepRow}>
                  <View style={[styles.stepBadge, { backgroundColor: primary }]}>
                    <Text style={styles.stepBadgeText}>{i + 1}</Text>
                  </View>
                  <Text style={[styles.listText, { color: text, flex: 1 }]}>{line}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {row.notes?.trim() ? (
            <View style={[styles.sectionCard, { backgroundColor: cardBg, borderColor: borderSoft }]}>
              <View style={styles.sectionHead}>
                <View style={[styles.sectionIcon, { backgroundColor: isDark ? 'rgba(30,41,59,0.6)' : 'rgba(0,0,0,0.05)' }]}>
                  <MaterialIcons name="notes" size={18} color={outline} />
                </View>
                <Text style={[styles.sectionTitle, { color: text }]}>备注</Text>
              </View>
              <Text style={[styles.notesText, { color: text }]}>{row.notes.trim()}</Text>
            </View>
          ) : null}

          {row.ingredients.length === 0 &&
          row.steps.length === 0 &&
          !row.notes?.trim() &&
          !row.finished_image_uri ? (
            <View style={[styles.emptyCard, { borderColor: borderSoft, backgroundColor: cardBg }]}>
              <MaterialIcons name="edit-note" size={32} color={outlineMuted} />
              <Text style={[styles.emptyHint, { color: outline }]}>暂无详细内容</Text>
              <Pressable
                onPress={() => router.push({ pathname: '/recipe-edit/[id]', params: { id } })}
                style={({ pressed }) => [
                  styles.emptyEditBtn,
                  { backgroundColor: primary, opacity: pressed ? 0.88 : 1 },
                ]}
              >
                <Text style={styles.emptyEditBtnText}>去编辑</Text>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <View style={styles.loadingWrap}>
          <Text style={{ color: outline, fontWeight: '600' }}>未找到该菜谱</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBarWrap: { borderBottomWidth: StyleSheet.hairlineWidth, zIndex: 10, elevation: 4 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 12,
    gap: 10,
  },
  headerIconBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '900',
  },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrollInner: { paddingHorizontal: 16 },
  heroWrap: { marginHorizontal: -16, marginBottom: 16 },
  heroImage: { width: '100%', height: 240 },
  titleBlock: { marginBottom: 16, gap: 8 },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
  },
  categoryText: { fontSize: 12, fontWeight: '800' },
  title: { fontSize: 26, fontWeight: '900', lineHeight: 34, letterSpacing: 0.2 },
  metaChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaChip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  metaChipText: { fontSize: 12, fontWeight: '800' },
  meta: { fontSize: 12, fontWeight: '600' },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 16,
    padding: 14,
    marginBottom: 12,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: 17, fontWeight: '900' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 10,
  },
  bullet: { width: 7, height: 7, borderRadius: 4, marginTop: 8 },
  listText: { fontSize: 15, lineHeight: 24, fontWeight: '500', flex: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  stepBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBadgeText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  notesText: { fontSize: 15, lineHeight: 24, fontWeight: '500' },
  emptyCard: {
    alignItems: 'center',
    padding: 28,
    borderRadius: 16,
    borderWidth: 1,
    gap: 10,
    marginTop: 8,
  },
  emptyHint: { fontSize: 14, fontWeight: '600' },
  emptyEditBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 10 },
  emptyEditBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
