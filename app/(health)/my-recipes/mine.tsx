import { recipeGlassTabBarContentInset } from '@/components/recipe/recipe-glass-tab-bar';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchProfileRecipes } from '@/lib/profile-page-api';
import {
  formatLocalYmd,
  loadRecipePlanStore,
  plannedDatesInMonth,
  type RecipePlanStore,
} from '@/lib/recipe-plan';
import {
  getRecipeHapticEnabled,
  recipeSelectionHaptic,
  setRecipeHapticEnabled,
} from '@/lib/recipe-haptic';
import { getRecipePalette, type RecipePalette } from '@/lib/recipe-theme';
import { loadRecipeStore, type RecipeItem, type RecipeStore } from '@/lib/recipes';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type KitchenStats = {
  favoriteCount: number;
  organizedCount: number;
  cookedTotal: number;
  monthCooked: number;
  monthAdded: number;
  planDays: number;
  cookStreak: number;
};

function isoInMonth(iso: string | undefined, year: number, monthIndex: number): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getFullYear() === year && d.getMonth() === monthIndex;
}

function ymdFromIso(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return formatLocalYmd(d);
}

/** 按 last_cooked_at 日期集合，从今天/昨天往前算连续下厨天数 */
function consecutiveCookStreak(recipes: RecipeItem[]): number {
  const days = new Set<string>();
  for (const r of recipes) {
    if (!r.last_cooked_at) continue;
    const ymd = ymdFromIso(r.last_cooked_at);
    if (ymd) days.add(ymd);
  }
  if (days.size === 0) return 0;

  const today = formatLocalYmd(new Date());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = formatLocalYmd(yesterdayDate);

  let cursor = days.has(today) ? today : days.has(yesterday) ? yesterday : null;
  if (!cursor) return 0;

  let streak = 0;
  while (cursor && days.has(cursor)) {
    streak += 1;
    const d = new Date(cursor + 'T12:00:00');
    d.setDate(d.getDate() - 1);
    cursor = formatLocalYmd(d);
  }
  return streak;
}

function computeStats(store: RecipeStore, plan: RecipePlanStore): KitchenStats {
  const now = new Date();
  const year = now.getFullYear();
  const monthIndex = now.getMonth();
  const recipes = store.recipes;

  let organizedCount = 0;
  let cookedTotal = 0;
  let monthCooked = 0;
  let monthAdded = 0;

  for (const r of recipes) {
    if (r.ingredients.length > 0 && r.steps.length > 0) organizedCount += 1;
    cookedTotal += Math.max(0, r.times_cooked | 0);
    if (isoInMonth(r.last_cooked_at, year, monthIndex)) monthCooked += 1;
    if (isoInMonth(r.created_at, year, monthIndex)) monthAdded += 1;
  }

  return {
    favoriteCount: recipes.length,
    organizedCount,
    cookedTotal,
    monthCooked,
    monthAdded,
    planDays: plannedDatesInMonth(plan, year, monthIndex).size,
    cookStreak: consecutiveCookStreak(recipes),
  };
}

function SectionLabel({ title, color }: { title: string; color: string }) {
  return <Text style={[styles.sectionLabel, { color }]}>{title}</Text>;
}

function SettingsRow({
  icon,
  title,
  subtitle,
  p,
  onPress,
  trailing,
  separator,
}: {
  icon: keyof typeof MaterialIcons.glyphMap;
  title: string;
  subtitle: string;
  p: RecipePalette;
  onPress?: () => void;
  trailing?: React.ReactNode;
  separator?: boolean;
}) {
  const body = (
    <View
      style={[
        styles.settingsRow,
        separator
          ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: p.border }
          : null,
      ]}>
      <MaterialIcons name={icon} size={22} color={p.primary} />
      <View style={styles.settingsCopy}>
        <Text style={[styles.rowTitle, { color: p.text }]}>{title}</Text>
        <Text style={[styles.rowSub, { color: p.textSecondary }]}>{subtitle}</Text>
      </View>
      {trailing}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}，${subtitle}`}
      style={({ pressed }) => [{ opacity: pressed ? 0.72 : 1 }]}>
      {body}
    </Pressable>
  );
}

export default function RecipeMineScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const p = getRecipePalette(useColorScheme());
  const tabBarInset = recipeGlassTabBarContentInset(insets.bottom);

  const [loading, setLoading] = useState(true);
  const [hapticOn, setHapticOn] = useState(true);
  const [store, setStore] = useState<RecipeStore>({ version: 2, categories: [], recipes: [] });
  const [plan, setPlan] = useState<RecipePlanStore>({ version: 1, entries: [] });

  const reload = useCallback(async () => {
    try {
      await fetchProfileRecipes({ serverFallback: true });
      const [recipeStore, planStore, haptic] = await Promise.all([
        loadRecipeStore(),
        loadRecipePlanStore(),
        getRecipeHapticEnabled(),
      ]);
      setStore(recipeStore);
      setPlan(planStore);
      setHapticOn(haptic);
    } catch {
      /* 保留上次数据 */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const stats = useMemo(() => computeStats(store, plan), [store, plan]);

  const onToggleHaptic = useCallback(async (next: boolean) => {
    setHapticOn(next);
    await setRecipeHapticEnabled(next);
    if (next) recipeSelectionHaptic();
  }, []);

  const goManageCategories = useCallback(() => {
    recipeSelectionHaptic();
    router.push('/recipe-categories');
  }, [router]);

  const goKitchen = useCallback(() => {
    recipeSelectionHaptic();
    router.navigate('/(health)/my-recipes');
  }, [router]);

  if (loading && store.recipes.length === 0) {
    return (
      <View style={[styles.root, styles.centered, { backgroundColor: p.bg }]}>
        <ActivityIndicator color={p.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: p.bg }]}
      contentContainerStyle={[styles.content, { paddingBottom: tabBarInset + 16 }]}
      showsVerticalScrollIndicator={false}>
      <Text style={[styles.pageTitle, { color: p.text }]}>我的</Text>

      <SectionLabel title="设置" color={p.text} />
      <View style={[styles.card, { backgroundColor: p.card, borderColor: p.border }]}>
        <SettingsRow
          icon="folder-open"
          title="菜谱分类"
          subtitle="新建、编辑、排序和删除分类"
          p={p}
          separator
          onPress={goManageCategories}
          trailing={<MaterialIcons name="chevron-right" size={22} color={p.outlineMuted} />}
        />
        <SettingsRow
          icon="touch-app"
          title="触觉反馈"
          subtitle="操作时提供轻微震动"
          p={p}
          trailing={
            <Switch
              value={hapticOn}
              onValueChange={v => void onToggleHaptic(v)}
              trackColor={{ false: p.border, true: p.primary }}
              thumbColor="#ffffff"
              ios_backgroundColor={p.border}
            />
          }
        />
      </View>

      <SectionLabel title="我的厨房" color={p.text} />
      <View style={[styles.card, { backgroundColor: p.card, borderColor: p.border }]}>
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: p.text }]}>{stats.favoriteCount} 道</Text>
            <Text style={[styles.statLabel, { color: p.textSecondary }]}>收藏菜谱</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: p.border }]} />
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: p.text }]}>{stats.organizedCount} 道</Text>
            <Text style={[styles.statLabel, { color: p.textSecondary }]}>已整理</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: p.border }]} />
          <View style={styles.statCell}>
            <Text style={[styles.statValue, { color: p.text }]}>{stats.cookedTotal} 次</Text>
            <Text style={[styles.statLabel, { color: p.textSecondary }]}>完成制作</Text>
          </View>
        </View>
        <View style={[styles.kitchenDivider, { backgroundColor: p.border }]} />
        <Pressable
          onPress={goKitchen}
          accessibilityRole="button"
          accessibilityLabel="我的厨房"
          style={({ pressed }) => [styles.kitchenLink, { opacity: pressed ? 0.72 : 1 }]}>
          <MaterialIcons name="home" size={20} color={p.primary} />
          <Text style={[styles.kitchenLinkText, { color: p.text }]}>我的厨房</Text>
          <MaterialIcons name="edit" size={18} color={p.outlineMuted} />
        </Pressable>
      </View>

      <SectionLabel title="本月表现" color={p.text} />
      <View style={[styles.card, { backgroundColor: p.card, borderColor: p.border }]}>
        <View style={styles.monthGrid}>
          <View style={[styles.monthCell, styles.monthCellTL]}>
            <Text style={[styles.monthLabel, { color: p.textSecondary }]}>本月完成制作</Text>
            <Text style={[styles.monthValue, { color: p.text }]}>{stats.monthCooked} 次</Text>
          </View>
          <View style={[styles.monthVLine, { backgroundColor: p.border }]} />
          <View style={styles.monthCell}>
            <Text style={[styles.monthLabel, { color: p.textSecondary }]}>本月新增收藏</Text>
            <Text style={[styles.monthValue, { color: p.text }]}>{stats.monthAdded} 道</Text>
          </View>
        </View>
        <View style={[styles.monthHLine, { backgroundColor: p.border }]} />
        <View style={styles.monthGrid}>
          <View style={[styles.monthCell, styles.monthCellBL]}>
            <Text style={[styles.monthLabel, { color: p.textSecondary }]}>菜单规划天数</Text>
            <Text style={[styles.monthValue, { color: p.text }]}>{stats.planDays} 天</Text>
          </View>
          <View style={[styles.monthVLine, { backgroundColor: p.border }]} />
          <View style={styles.monthCell}>
            <Text style={[styles.monthLabel, { color: p.textSecondary }]}>连续下厨</Text>
            <Text style={[styles.monthValue, { color: p.text }]}>{stats.cookStreak} 天</Text>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: { alignItems: 'center', justifyContent: 'center' },
  content: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 0,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.4,
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
    marginTop: 8,
  },
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    marginBottom: 16,
  },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 64,
  },
  settingsCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { fontSize: 16, fontWeight: '700' },
  rowSub: { fontSize: 12, fontWeight: '500', lineHeight: 16 },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 18,
    paddingHorizontal: 8,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
  },
  statDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: 4 },
  statValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  statLabel: { fontSize: 12, fontWeight: '500' },
  kitchenDivider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },
  kitchenLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  kitchenLinkText: { flex: 1, fontSize: 15, fontWeight: '700' },
  monthGrid: { flexDirection: 'row', alignItems: 'stretch' },
  monthCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 16,
    gap: 8,
  },
  monthCellTL: {},
  monthCellBL: {},
  monthVLine: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' },
  monthHLine: { height: StyleSheet.hairlineWidth, marginHorizontal: 0 },
  monthLabel: { fontSize: 13, fontWeight: '500', flexShrink: 1 },
  monthValue: { fontSize: 15, fontWeight: '800' },
});
