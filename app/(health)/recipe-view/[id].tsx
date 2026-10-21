import { CrudDetailScreen } from '@/components/crud';
import { AddRecipeToPlanSheet } from '@/components/recipe/add-recipe-to-plan-sheet';
import { CompleteRecipeCookSheet } from '@/components/recipe/complete-recipe-cook-sheet';
import { RecipeMotionPressable } from '@/components/recipe/recipe-motion-pressable';
import { StoredImage } from '@/components/stored-image';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  averageRating,
  formatAverageRating,
  formatCookLogTime,
  loadRecipeCookLogStore,
  logsForRecipe,
  type RecipeCookLog,
} from '@/lib/recipe-cook-log';
import { addRecipeToShop } from '@/lib/recipe-shop';
import {
  getRecipe,
  getRecipeCategory,
  recipeListPreviewTitle,
  type RecipeItem,
} from '@/lib/recipes';
import { getRecipePalette } from '@/lib/recipe-theme';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router/react-navigation';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
  const reduceMotion = useReducedMotion();

  const colorScheme = useColorScheme();
  const p = getRecipePalette(colorScheme);

  const [row, setRow] = useState<RecipeItem | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [planSheetVisible, setPlanSheetVisible] = useState(false);
  const [cookSheetVisible, setCookSheetVisible] = useState(false);
  const [cookLogs, setCookLogs] = useState<RecipeCookLog[]>([]);
  const [shopBusy, setShopBusy] = useState(false);

  const heroOpacity = useRef(new Animated.Value(0)).current;
  const heroScale = useRef(new Animated.Value(1.06)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentY = useRef(new Animated.Value(18)).current;

  const playEnter = useCallback(() => {
    if (reduceMotion) {
      heroOpacity.setValue(1);
      heroScale.setValue(1);
      contentOpacity.setValue(1);
      contentY.setValue(0);
      return;
    }
    heroOpacity.setValue(0);
    heroScale.setValue(1.06);
    contentOpacity.setValue(0);
    contentY.setValue(18);
    Animated.parallel([
      Animated.timing(heroOpacity, {
        toValue: 1,
        duration: 420,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(heroScale, {
        toValue: 1,
        duration: 560,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(80),
        Animated.parallel([
          Animated.timing(contentOpacity, {
            toValue: 1,
            duration: 380,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(contentY, {
            toValue: 0,
            duration: 400,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
      ]),
    ]).start();
  }, [contentOpacity, contentY, heroOpacity, heroScale, reduceMotion]);

  const reloadCookLogs = useCallback(async (recipeId: string) => {
    try {
      const store = await loadRecipeCookLogStore();
      setCookLogs(logsForRecipe(store, recipeId));
    } catch {
      setCookLogs([]);
    }
  }, []);

  const reload = useCallback(
    async (forceRefresh = false) => {
      if (!id) {
        setLoading(false);
        return;
      }
      setError(null);
      try {
        await wrapLoad(async () => {
          const item = await getRecipe(id);
          if (!item) {
            setRow(null);
            setCookLogs([]);
            return;
          }
          const cat = await getRecipeCategory(item.category_id);
          setCategoryName(cat?.name ?? '');
          setRow(item);
          await reloadCookLogs(item.id);
        }, forceRefresh);
      } catch {
        setError('加载失败，请重试');
        setRow(null);
        setCookLogs([]);
      } finally {
        setLoading(false);
      }
    },
    [id, reloadCookLogs, wrapLoad],
  );

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    if (!loading && row) playEnter();
  }, [loading, playEnter, row]);

  const displayTitle = row ? recipeListPreviewTitle(row) : '';
  const avgRating = useMemo(() => averageRating(cookLogs), [cookLogs]);

  const onAddToShop = useCallback(async () => {
    if (!row || shopBusy) return;
    const hasIngredient = row.ingredients.some(ing => ing.name.trim());
    if (!hasIngredient) {
      toast.info('该菜谱还没有食材');
      return;
    }
    setShopBusy(true);
    try {
      const { alreadyAdded } = await addRecipeToShop({
        recipeId: row.id,
        recipeTitle: recipeListPreviewTitle(row),
      });
      toast.success(alreadyAdded ? '已在采购清单中' : '加入成功');
    } catch (e) {
      toast.error(toUserMessage(e, '加入失败'));
    } finally {
      setShopBusy(false);
    }
  }, [row, shopBusy]);

  if (!id) {
    return (
      <CrudDetailScreen
        title="菜谱"
        onBack={() => router.back()}
        missing
        missingMessage="缺少菜谱 ID"
        style={{ backgroundColor: p.bg }}
      />
    );
  }

  return (
    <CrudDetailScreen
      loading={loading}
      loadingHint="加载菜谱…"
      error={error}
      onRetryError={() => {
        setLoading(true);
        void reload(true);
      }}
      missing={!loading && !error && !row}
      missingMessage="未找到该菜谱"
      style={{ backgroundColor: p.bg }}>
      <View style={styles.container}>
        <View style={[styles.floatingBar, { paddingTop: insets.top + 8 }]} pointerEvents="box-none">
          <Pressable
            style={({ pressed }) => [
              styles.floatBtn,
              { backgroundColor: p.card, borderColor: p.border, opacity: pressed ? 0.8 : 1 },
            ]}
            onPress={() => router.back()}>
            <MaterialIcons name="arrow-back-ios-new" size={18} color={p.primary} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [
              styles.floatBtn,
              {
                backgroundColor: p.primarySoft,
                borderColor: p.border,
                opacity: pressed || !row ? 0.55 : 1,
              },
            ]}
            onPress={() => router.push({ pathname: '/recipe-edit/[id]', params: { id } })}
            disabled={!row}>
            <MaterialIcons name="edit" size={20} color={p.primary} />
          </Pressable>
        </View>

        {row ? (
          <ScrollView
            refreshControl={refreshControl}
            contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 20) + 36 }}
            showsVerticalScrollIndicator={false}>
            <Animated.View
              style={[
                styles.heroWrap,
                {
                  opacity: heroOpacity,
                  transform: [{ scale: heroScale }],
                },
              ]}>
              {row.finished_image_uri ? (
                <StoredImage uri={row.finished_image_uri} style={styles.heroImage} />
              ) : (
                <View style={[styles.heroPlaceholder, { backgroundColor: p.placeholderBg }]}>
                  <MaterialIcons name="restaurant" size={56} color={p.accent} />
                  <Text style={[styles.heroPlaceholderText, { color: p.outlineMuted }]}>还没有成品图</Text>
                </View>
              )}
              <View style={[styles.heroScrim, { height: insets.top + 72 }]} />
            </Animated.View>

            <Animated.View
              style={[
                styles.body,
                {
                  opacity: contentOpacity,
                  transform: [{ translateY: contentY }],
                },
              ]}>
              <View style={[styles.titleBlock, { backgroundColor: p.card, borderColor: p.border }]}>
                {categoryName ? (
                  <View style={[styles.categoryBadge, { backgroundColor: p.accentSoft, borderColor: p.border }]}>
                    <MaterialIcons name="auto-stories" size={14} color={p.accent} />
                    <Text style={[styles.categoryText, { color: p.accent }]}>{categoryName}</Text>
                  </View>
                ) : null}
                <Text style={[styles.title, { color: p.text }]}>{displayTitle}</Text>
                <View style={styles.metaChipRow}>
                  {row.ingredients.length > 0 ? (
                    <View style={[styles.metaChip, { backgroundColor: p.accentSoft }]}>
                      <Text style={[styles.metaChipText, { color: p.accent }]}>
                        {row.ingredients.length} 食材
                      </Text>
                    </View>
                  ) : null}
                  {row.steps.length > 0 ? (
                    <View style={[styles.metaChip, { backgroundColor: p.primarySoft }]}>
                      <Text style={[styles.metaChipText, { color: p.primary }]}>{row.steps.length} 步</Text>
                    </View>
                  ) : null}
                  {row.times_cooked > 0 ? (
                    <View style={[styles.metaChip, { backgroundColor: p.primarySoft }]}>
                      <Text style={[styles.metaChipText, { color: p.primary }]}>
                        做过 {row.times_cooked} 次
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={[styles.meta, { color: p.outlineMuted }]}>
                  更新于 {new Date(row.updated_at).toLocaleString('zh-CN')}
                </Text>
              </View>

              <View style={styles.actionBlock}>
                <View style={styles.actionRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="加入计划"
                    onPress={() => setPlanSheetVisible(true)}
                    style={({ pressed }) => [
                      styles.actionSecondary,
                      {
                        backgroundColor: p.card,
                        borderColor: p.border,
                        opacity: pressed ? 0.82 : 1,
                      },
                    ]}>
                    <MaterialIcons name="event-note" size={18} color={p.primary} />
                    <Text style={[styles.actionSecondaryText, { color: p.primary }]}>加入计划</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="加入采购"
                    onPress={() => void onAddToShop()}
                    disabled={shopBusy}
                    style={({ pressed }) => [
                      styles.actionSecondary,
                      {
                        backgroundColor: p.card,
                        borderColor: p.border,
                        opacity: pressed || shopBusy ? 0.55 : 1,
                      },
                    ]}>
                    <MaterialIcons name="add-shopping-cart" size={18} color={p.accent} />
                    <Text style={[styles.actionSecondaryText, { color: p.accent }]}>加入采购</Text>
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="完成制作＆评分"
                  onPress={() => setCookSheetVisible(true)}
                  style={({ pressed }) => [
                    styles.actionPrimary,
                    { backgroundColor: p.primary, opacity: pressed ? 0.88 : 1 },
                  ]}>
                  <MaterialIcons name="restaurant" size={18} color="#fff" />
                  <Text style={styles.actionPrimaryText}>完成制作＆评分</Text>
                </Pressable>
              </View>

              <View style={[styles.sectionCard, { backgroundColor: p.card, borderColor: p.border }]}>
                <View style={styles.sectionHead}>
                  <View style={[styles.sectionIcon, { backgroundColor: p.accentSoft }]}>
                    <MaterialIcons name="rate-review" size={18} color={p.accent} />
                  </View>
                  <Text style={[styles.sectionTitle, { color: p.text }]}>制作记录与评分</Text>
                </View>
                <View style={styles.cookSummaryRow}>
                  <View style={[styles.cookStat, { backgroundColor: p.inputBg }]}>
                    <Text style={[styles.cookStatValue, { color: p.text }]}>{row.times_cooked}</Text>
                    <Text style={[styles.cookStatLabel, { color: p.outlineMuted }]}>做过次数</Text>
                  </View>
                  <View style={[styles.cookStat, { backgroundColor: p.inputBg }]}>
                    <Text style={[styles.cookStatValue, { color: p.text }]}>
                      {formatAverageRating(avgRating)}
                    </Text>
                    <Text style={[styles.cookStatLabel, { color: p.outlineMuted }]}>平均评分</Text>
                  </View>
                  <View style={[styles.cookStat, { backgroundColor: p.inputBg }]}>
                    <Text style={[styles.cookStatValue, { color: p.text }]} numberOfLines={1}>
                      {row.last_cooked_at
                        ? new Date(row.last_cooked_at).toLocaleDateString('zh-CN')
                        : '—'}
                    </Text>
                    <Text style={[styles.cookStatLabel, { color: p.outlineMuted }]}>最近制作</Text>
                  </View>
                </View>
                {cookLogs.length === 0 ? (
                  <Text style={[styles.cookEmpty, { color: p.outlineMuted }]}>
                    还没有制作记录。点上方「完成制作＆评分」记一次。
                  </Text>
                ) : (
                  cookLogs.slice(0, 8).map((log, i) => (
                    <View
                      key={log.id}
                      style={[
                        styles.cookLogRow,
                        i < Math.min(cookLogs.length, 8) - 1
                          ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.border }
                          : null,
                      ]}>
                      <View style={styles.cookLogMain}>
                        <Text style={[styles.cookLogTime, { color: p.outlineMuted }]}>
                          {formatCookLogTime(log.cookedAt)}
                        </Text>
                        <View style={styles.cookLogStars}>
                          {[1, 2, 3, 4, 5].map(n => (
                            <MaterialIcons
                              key={n}
                              name={n <= log.rating ? 'star' : 'star-border'}
                              size={14}
                              color={n <= log.rating ? p.accent : p.outlineMuted}
                            />
                          ))}
                        </View>
                      </View>
                      {log.note?.trim() ? (
                        <Text style={[styles.cookLogNote, { color: p.text }]} numberOfLines={2}>
                          {log.note.trim()}
                        </Text>
                      ) : null}
                    </View>
                  ))
                )}
                {cookLogs.length > 8 ? (
                  <Text style={[styles.cookMore, { color: p.outlineMuted }]}>
                    还有 {cookLogs.length - 8} 条更早记录
                  </Text>
                ) : null}
              </View>

              {row.ingredients.length > 0 ? (
                <View style={[styles.sectionCard, { backgroundColor: p.card, borderColor: p.border }]}>
                  <View style={styles.sectionHead}>
                    <View style={[styles.sectionIcon, { backgroundColor: p.accentSoft }]}>
                      <MaterialIcons name="shopping-basket" size={18} color={p.accent} />
                    </View>
                    <Text style={[styles.sectionTitle, { color: p.text }]}>食材</Text>
                  </View>
                  {row.ingredients.map((item, i) => (
                    <RecipeMotionPressable
                      key={`ing-${i}`}
                      enterDelay={60 + i * 40}
                      style={[
                        styles.ingCard,
                        { borderColor: p.border, backgroundColor: p.inputBg },
                        i < row.ingredients.length - 1 && styles.ingCardSpacing,
                      ]}>
                      <View style={styles.ingMainRow}>
                        <Text style={[styles.ingName, { color: p.text }]}>{item.name}</Text>
                        <Text style={[styles.ingAmount, { color: item.amount ? p.text : p.outlineMuted }]}>
                          {item.amount || '—'}
                        </Text>
                      </View>
                      {item.remark?.trim() ? (
                        <Text style={[styles.ingRemarkLine, { color: p.outline }]}>
                          备注：{item.remark.trim()}
                        </Text>
                      ) : null}
                    </RecipeMotionPressable>
                  ))}
                </View>
              ) : null}

              {row.steps.length > 0 ? (
                <View style={[styles.sectionCard, { backgroundColor: p.card, borderColor: p.border }]}>
                  <View style={styles.sectionHead}>
                    <View style={[styles.sectionIcon, { backgroundColor: p.primarySoft }]}>
                      <MaterialIcons name="format-list-numbered" size={18} color={p.primary} />
                    </View>
                    <Text style={[styles.sectionTitle, { color: p.text }]}>步骤</Text>
                  </View>
                  {row.steps.map((line, i) => (
                    <RecipeMotionPressable key={`step-${i}`} enterDelay={80 + i * 50} style={styles.stepRow}>
                      <View style={[styles.stepBadge, { backgroundColor: p.primary }]}>
                        <Text style={styles.stepBadgeText}>{i + 1}</Text>
                      </View>
                      <Text style={[styles.listText, { color: p.text }]}>{line}</Text>
                    </RecipeMotionPressable>
                  ))}
                </View>
              ) : null}

              {row.notes?.trim() ? (
                <View style={[styles.sectionCard, { backgroundColor: p.card, borderColor: p.border }]}>
                  <View style={styles.sectionHead}>
                    <View style={[styles.sectionIcon, { backgroundColor: p.placeholderBg }]}>
                      <MaterialIcons name="notes" size={18} color={p.outline} />
                    </View>
                    <Text style={[styles.sectionTitle, { color: p.text }]}>备注</Text>
                  </View>
                  <Text style={[styles.notesText, { color: p.text }]}>{row.notes.trim()}</Text>
                </View>
              ) : null}

              {row.ingredients.length === 0 &&
              row.steps.length === 0 &&
              !row.notes?.trim() &&
              !row.finished_image_uri ? (
                <View style={[styles.emptyCard, { borderColor: p.border, backgroundColor: p.card }]}>
                  <MaterialIcons name="edit-note" size={32} color={p.outlineMuted} />
                  <Text style={[styles.emptyHint, { color: p.outline }]}>暂无详细内容</Text>
                  <Pressable
                    onPress={() => router.push({ pathname: '/recipe-edit/[id]', params: { id } })}
                    style={({ pressed }) => [
                      styles.emptyEditBtn,
                      { backgroundColor: p.primary, opacity: pressed ? 0.88 : 1 },
                    ]}>
                    <Text style={styles.emptyEditBtnText}>去编辑</Text>
                  </Pressable>
                </View>
              ) : null}
            </Animated.View>
          </ScrollView>
        ) : null}

        {row ? (
          <>
            <AddRecipeToPlanSheet
              visible={planSheetVisible}
              onClose={() => setPlanSheetVisible(false)}
              recipeId={row.id}
              recipeTitle={displayTitle}
              categoryName={categoryName}
            />
            <CompleteRecipeCookSheet
              visible={cookSheetVisible}
              onClose={() => setCookSheetVisible(false)}
              recipeId={row.id}
              recipeTitle={displayTitle}
              onSaved={updated => {
                setRow(updated);
                void reloadCookLogs(updated.id);
              }}
            />
          </>
        ) : null}
      </View>
    </CrudDetailScreen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  floatingBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
  },
  floatBtn: {
    width: 42,
    height: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroWrap: {
    width: '100%',
    height: 300,
    overflow: 'hidden',
  },
  heroImage: { width: '100%', height: '100%' },
  heroPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  heroPlaceholderText: { fontSize: 13, fontWeight: '700' },
  heroScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'transparent',
  },
  body: { paddingHorizontal: 18, marginTop: -28 },
  titleBlock: {
    marginBottom: 16,
    gap: 10,
    padding: 18,
    borderRadius: 22,
    borderWidth: 1,
  },
  categoryBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 10,
    borderWidth: 1,
  },
  categoryText: { fontSize: 12, fontWeight: '800' },
  title: { fontSize: 28, fontWeight: '900', lineHeight: 36, letterSpacing: 0.2 },
  metaChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metaChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 },
  metaChipText: { fontSize: 12, fontWeight: '800' },
  meta: { fontSize: 12, fontWeight: '600' },
  actionBlock: { marginBottom: 16, gap: 10 },
  actionRow: { flexDirection: 'row', gap: 10 },
  actionSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 46,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  actionSecondaryText: { fontSize: 14, fontWeight: '800' },
  actionPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: 14,
    paddingHorizontal: 16,
  },
  actionPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },
  cookSummaryRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  cookStat: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 4,
  },
  cookStatValue: { fontSize: 15, fontWeight: '900' },
  cookStatLabel: { fontSize: 11, fontWeight: '700' },
  cookEmpty: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
  cookLogRow: { paddingVertical: 10, gap: 6 },
  cookLogMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  cookLogTime: { fontSize: 12, fontWeight: '600', flex: 1 },
  cookLogStars: { flexDirection: 'row', gap: 1 },
  cookLogNote: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
  cookMore: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  sectionCard: {
    borderWidth: 1,
    borderRadius: 20,
    padding: 16,
    marginBottom: 14,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  sectionIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: { fontSize: 17, fontWeight: '900' },
  ingCard: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 6,
  },
  ingCardSpacing: { marginBottom: 8 },
  ingMainRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  ingName: { flex: 1, fontSize: 15, lineHeight: 22, fontWeight: '700' },
  ingAmount: { fontSize: 15, lineHeight: 22, fontWeight: '600', textAlign: 'right', maxWidth: '42%' },
  ingRemarkLine: { fontSize: 13, lineHeight: 20, fontWeight: '500' },
  listText: { fontSize: 15, lineHeight: 24, fontWeight: '500', flex: 1 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 8 },
  stepBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepBadgeText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  notesText: { fontSize: 15, lineHeight: 24, fontWeight: '500' },
  emptyCard: {
    alignItems: 'center',
    padding: 28,
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    marginTop: 8,
  },
  emptyHint: { fontSize: 14, fontWeight: '600' },
  emptyEditBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 12 },
  emptyEditBtnText: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
