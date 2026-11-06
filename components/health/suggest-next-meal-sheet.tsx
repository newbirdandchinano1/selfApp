/**
 * 「补一餐」：今日缺口 → AI 建议（tips / 快捷卡 / 菜谱 / 草稿）；不自动写库。
 */
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import type { FoodQuickAddHint, FoodRecipeHint } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { formatDietaryPrefsForAi, loadDietaryPrefs } from '@/lib/dietary-prefs';
import {
  formatQuickAddMetricSummary,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';
import { buildRecipeAiSummaries } from '@/lib/recipe-ai-context';
import { loadRecipeStore } from '@/lib/recipes';
import {
  suggestFoodNextMeal,
  type FoodSuggestNextMealDraft,
  type FoodSuggestNextMealJson,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SuggestNextMealGapContext = {
  todayYmd: string;
  hour: number;
  totals: { hydration: number; protein: number; carbohydrate: number; calories: number };
  targets: { hydration: number; protein: number; carbohydrate: number; calories: number };
};

export type SuggestNextMealSheetProps = {
  visible: boolean;
  onClose: () => void;
  gap: SuggestNextMealGapContext | null;
  quickAddCatalog: QuickAddCardItem[];
  onQuickAdd: (item: QuickAddCardItem) => void;
  onOpenRecipe: (recipeId: string) => void;
  onUseDraft: (draft: FoodSuggestNextMealDraft) => void;
};

function remain(target: number, current: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return Math.max(0, Math.round(target - Math.max(0, current)));
}

function buildGapContextBlock(gap: SuggestNextMealGapContext, dietaryLine: string | null): string {
  const rH = remain(gap.targets.hydration, gap.totals.hydration);
  const rP = remain(gap.targets.protein, gap.totals.protein);
  const rC = remain(gap.targets.carbohydrate, gap.totals.carbohydrate);
  const rK = remain(gap.targets.calories, gap.totals.calories);
  const lines = [
    `日期：${gap.todayYmd}；当前时刻约 ${gap.hour}:00`,
    `今日已摄入：水分 ${Math.round(gap.totals.hydration)}ml / 蛋白 ${Math.round(gap.totals.protein)}g / 碳水 ${Math.round(gap.totals.carbohydrate)}g / 热量 ${Math.round(gap.totals.calories)}kcal`,
    `今日目标：水分 ${gap.targets.hydration}ml / 蛋白 ${gap.targets.protein}g / 碳水 ${gap.targets.carbohydrate}g / 热量 ${gap.targets.calories}kcal`,
    `缺口：水分 ${rH}ml / 蛋白 ${rP}g / 碳水 ${rC}g / 热量 ${rK}kcal`,
  ];
  if (dietaryLine) lines.push(`饮食偏好：${dietaryLine}`);
  return lines.join('\n');
}

export function SuggestNextMealSheet({
  visible,
  onClose,
  gap,
  quickAddCatalog,
  onQuickAdd,
  onOpenRecipe,
  onUseDraft,
}: SuggestNextMealSheetProps) {
  const insets = useSafeAreaInsets();
  const { hh } = useHealthHomeTheme();
  const styles = useMemo(() => createStyles(hh), [hh]);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<FoodSuggestNextMealJson | null>(null);
  const [recipeTitles, setRecipeTitles] = useState<Record<string, string>>({});
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setData(null);
      setRecipeTitles({});
      setFetched(false);
      setLoading(false);
    }
  }, [visible]);

  const runSuggest = useCallback(async () => {
    if (!gap) {
      toast.info('暂无今日摄入数据');
      return;
    }
    setLoading(true);
    try {
      const [dietary, recipeStore] = await Promise.all([
        loadDietaryPrefs(),
        loadRecipeStore().catch(() => null),
      ]);
      const dietaryLine = formatDietaryPrefsForAi(dietary);
      const quick_adds: FoodQuickAddHint[] = quickAddCatalog.slice(0, 24).map((item) => ({
        key: item.key,
        name: item.label,
        nutrition_summary: formatQuickAddMetricSummary(item),
      }));
      let recipes: FoodRecipeHint[] = [];
      const titleMap: Record<string, string> = {};
      if (recipeStore && recipeStore.recipes.length > 0) {
        const summaries = await buildRecipeAiSummaries(recipeStore, { max: 24 });
        recipes = summaries.map((r) => {
          titleMap[r.id] = r.title;
          return { id: r.id, title: r.title };
        });
      }
      const r = await suggestFoodNextMeal({
        contextBlock: buildGapContextBlock(gap, dietaryLine),
        quickAdds: quick_adds,
        recipes,
      });
      if (!r.ok) {
        toast.error(r.error || '补餐建议失败');
        return;
      }
      setData(r.data);
      setRecipeTitles(titleMap);
      setFetched(true);
      if (
        !r.data.tips.length &&
        !r.data.quick_add_keys.length &&
        !r.data.recipe_ids.length &&
        !r.data.draft_intake
      ) {
        toast.info('暂无明确建议，可稍后再试');
      }
    } catch (e) {
      toast.error(toUserMessage(e, '补餐建议失败'));
    } finally {
      setLoading(false);
    }
  }, [gap, quickAddCatalog]);

  useEffect(() => {
    if (!visible || !gap || fetched || loading) return;
    void runSuggest();
  }, [visible, gap, fetched, loading, runSuggest]);

  const quickByKey = useMemo(() => {
    const map = new Map<string, QuickAddCardItem>();
    for (const item of quickAddCatalog) map.set(item.key, item);
    return map;
  }, [quickAddCatalog]);

  if (!visible) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="关闭" />
        <View style={[styles.sheet, { backgroundColor: hh.card, borderColor: hh.line }]}>
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: hh.ink }]}>补一餐</Text>
              <Text style={[styles.sub, { color: hh.muted }]}>按今日缺口给建议 · 需你确认再写入</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="关闭补餐建议">
              <MaterialIcons name="close" size={22} color={hh.inkSoft} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}>
            {loading && !data ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator color={hh.pine} />
                <Text style={[styles.loadingText, { color: hh.muted }]}>正在看缺口…</Text>
              </View>
            ) : null}

            {data?.tips?.length ? (
              <View style={styles.block}>
                <Text style={[styles.blockTitle, { color: hh.ink }]}>建议</Text>
                {data.tips.map((tip, i) => (
                  <Text key={`tip-${i}`} style={[styles.tip, { color: hh.inkSoft }]}>
                    · {tip}
                  </Text>
                ))}
              </View>
            ) : null}

            {data?.quick_add_keys?.length ? (
              <View style={styles.block}>
                <Text style={[styles.blockTitle, { color: hh.ink }]}>可点快捷卡</Text>
                <View style={styles.chipRow}>
                  {data.quick_add_keys.map((key) => {
                    const item = quickByKey.get(key);
                    if (!item) return null;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => {
                          onQuickAdd(item);
                          onClose();
                        }}
                        style={[styles.chip, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                        <Text style={[styles.chipText, { color: hh.ink }]}>{item.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ) : null}

            {data?.recipe_ids?.length ? (
              <View style={styles.block}>
                <Text style={[styles.blockTitle, { color: hh.ink }]}>库内菜谱</Text>
                {data.recipe_ids.map((id) => (
                  <Pressable
                    key={id}
                    onPress={() => {
                      onOpenRecipe(id);
                      onClose();
                    }}
                    style={[styles.recipeRow, { borderColor: hh.line }]}>
                    <MaterialIcons name="restaurant-menu" size={18} color={hh.pine} />
                    <Text style={[styles.recipeTitle, { color: hh.ink }]} numberOfLines={1}>
                      {recipeTitles[id] || id}
                    </Text>
                    <MaterialIcons name="chevron-right" size={18} color={hh.muted} />
                  </Pressable>
                ))}
              </View>
            ) : null}

            {data?.draft_intake ? (
              <View style={[styles.draftCard, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                <Text style={[styles.blockTitle, { color: hh.ink }]}>一餐草稿</Text>
                <Text style={[styles.draftSummary, { color: hh.ink }]}>
                  {data.draft_intake.food_summary}
                </Text>
                <Text style={[styles.draftMetrics, { color: hh.muted }]}>
                  {Math.round(data.draft_intake.hydration_ml)}ml · 蛋白{' '}
                  {Math.round(data.draft_intake.protein_g)}g · 碳水{' '}
                  {Math.round(data.draft_intake.carbohydrate_g)}g ·{' '}
                  {Math.round(data.draft_intake.calories_kcal)}kcal
                </Text>
                {data.draft_intake.ai_evaluation ? (
                  <Text style={[styles.draftEval, { color: hh.inkSoft }]} numberOfLines={4}>
                    {data.draft_intake.ai_evaluation}
                  </Text>
                ) : null}
                <Pressable
                  onPress={() => {
                    if (!data.draft_intake) return;
                    onUseDraft(data.draft_intake);
                    onClose();
                  }}
                  style={[styles.primaryBtn, { backgroundColor: hh.pine }]}>
                  <Text style={[styles.primaryBtnText, { color: hh.onPine }]}>预填到记饮食</Text>
                </Pressable>
              </View>
            ) : null}

            {!loading && fetched && !data?.tips?.length && !data?.draft_intake ? (
              <Text style={[styles.empty, { color: hh.muted }]}>暂时没有更具体的补餐建议</Text>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={() => {
                setFetched(false);
                setData(null);
                void runSuggest();
              }}
              disabled={loading}
              style={[styles.secondaryBtn, { borderColor: hh.line, opacity: loading ? 0.5 : 1 }]}>
              <Text style={[styles.secondaryBtnText, { color: hh.pine }]}>
                {loading ? '生成中…' : '再生成一次'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles(_hh: ReturnType<typeof useHealthHomeTheme>['hh']) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(20, 28, 22, 0.45)',
      paddingHorizontal: 12,
    },
    sheet: {
      borderRadius: 22,
      borderWidth: StyleSheet.hairlineWidth,
      maxHeight: '82%',
      overflow: 'hidden',
    },
    head: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 10,
    },
    title: { fontSize: 17, fontWeight: '800' },
    sub: { marginTop: 4, fontSize: 12, fontWeight: '500' },
    scroll: { maxHeight: 420 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 12, gap: 14 },
    loadingBox: { alignItems: 'center', paddingVertical: 28, gap: 10 },
    loadingText: { fontSize: 13, fontWeight: '600' },
    block: { gap: 8 },
    blockTitle: { fontSize: 13, fontWeight: '800' },
    tip: { fontSize: 13, fontWeight: '500', lineHeight: 20 },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    chipText: { fontSize: 13, fontWeight: '700' },
    recipeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingVertical: 12,
    },
    recipeTitle: { flex: 1, fontSize: 14, fontWeight: '700' },
    draftCard: {
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 14,
      gap: 8,
    },
    draftSummary: { fontSize: 15, fontWeight: '800' },
    draftMetrics: { fontSize: 12, fontWeight: '600' },
    draftEval: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
    primaryBtn: {
      marginTop: 4,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
    },
    primaryBtnText: { fontSize: 14, fontWeight: '800' },
    empty: { fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 18 },
    footer: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4 },
    secondaryBtn: {
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 12,
      alignItems: 'center',
    },
    secondaryBtnText: { fontSize: 14, fontWeight: '700' },
  });
}
