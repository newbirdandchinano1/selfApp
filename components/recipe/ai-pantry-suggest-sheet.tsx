import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RecipePantrySuggestionJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { addRecipeToBasket } from '@/lib/recipe-basket';
import { buildRecipeAiSummaries, parsePantryText } from '@/lib/recipe-ai-context';
import { addRecipeToShop } from '@/lib/recipe-shop';
import { getRecipePalette } from '@/lib/recipe-theme';
import type { RecipeStore } from '@/lib/recipes';
import { suggestRecipeFromPantry } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type AiPantrySuggestSheetProps = {
  visible: boolean;
  onClose: () => void;
  recipeStore: RecipeStore | null;
  /** 写入菜单篮或采购后回调 */
  onApplied?: () => void;
};

export function AiPantrySuggestSheet({
  visible,
  onClose,
  recipeStore,
  onApplied,
}: AiPantrySuggestSheetProps) {
  const insets = useSafeAreaInsets();
  const p = getRecipePalette(useColorScheme());

  const [pantryText, setPantryText] = useState('');
  const [preferences, setPreferences] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [suggestions, setSuggestions] = useState<RecipePantrySuggestionJson[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [notes, setNotes] = useState('');
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPantryText('');
      setPreferences('');
      setSuggestions([]);
      setSelected(new Set());
      setNotes('');
      setFetched(false);
      setLoading(false);
      setSaving(false);
    }
  }, [visible]);

  const runSuggest = useCallback(async () => {
    const pantry = parsePantryText(pantryText);
    if (pantry.length === 0) {
      toast.warn('请输入现有食材，用顿号或换行分隔');
      return;
    }
    if (!recipeStore || recipeStore.recipes.length === 0) {
      toast.warn('请先在菜谱库添加几道菜');
      return;
    }
    setLoading(true);
    try {
      const recipes = await buildRecipeAiSummaries(recipeStore);
      const r = await suggestRecipeFromPantry({
        pantry,
        recipes,
        preferences: preferences.trim() || undefined,
        limit: 6,
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 选菜失败');
        return;
      }
      setSuggestions(r.data.suggestions);
      setSelected(new Set(r.data.suggestions.map(s => s.recipeId)));
      setNotes(r.data.notes || '');
      setFetched(true);
      if (r.data.suggestions.length === 0) {
        toast.info('库内暂无匹配菜谱');
      }
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 选菜失败'));
    } finally {
      setLoading(false);
    }
  }, [pantryText, preferences, recipeStore]);

  const toggle = useCallback((id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const picked = suggestions.filter(s => selected.has(s.recipeId));

  const applyToBasket = useCallback(async () => {
    if (picked.length === 0) {
      toast.warn('请先勾选推荐');
      return;
    }
    setSaving(true);
    try {
      for (const s of picked) {
        await addRecipeToBasket({ recipeId: s.recipeId, recipeTitle: s.recipeTitle });
      }
      toast.success(`已加入菜单篮 ${picked.length} 道`);
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '加入菜单篮失败'));
    } finally {
      setSaving(false);
    }
  }, [onApplied, onClose, picked]);

  const applyToShop = useCallback(async () => {
    if (picked.length === 0) {
      toast.warn('请先勾选推荐');
      return;
    }
    setSaving(true);
    try {
      for (const s of picked) {
        await addRecipeToShop({ recipeId: s.recipeId, recipeTitle: s.recipeTitle });
      }
      // 缺口食材提示：已通过「加入采购」挂上菜谱，清单会汇总缺料
      const missing = [
        ...new Set(picked.flatMap(s => s.missing_ingredients).map(x => x.trim()).filter(Boolean)),
      ];
      toast.success(
        missing.length > 0
          ? `已加入采购；缺口参考：${missing.slice(0, 6).join('、')}`
          : `已加入采购 ${picked.length} 道`,
      );
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '加入采购失败'));
    } finally {
      setSaving(false);
    }
  }, [onApplied, onClose, picked]);

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: p.overlay }]}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: p.card,
              borderColor: p.border,
              paddingBottom: Math.max(insets.bottom, 12),
            },
          ]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: p.text }]}>冰箱里有什么</Text>
            <Pressable onPress={onClose} hitSlop={10} disabled={loading || saving}>
              <MaterialIcons name="close" size={22} color={p.outlineMuted} />
            </Pressable>
          </View>
          <Text style={[styles.sub, { color: p.outlineMuted }]}>
            从你的菜谱库选菜；勾选后可进菜单篮或采购
          </Text>

          <TextInput
            value={pantryText}
            onChangeText={t => setPantryText(t.slice(0, 400))}
            placeholder="例如：鸡蛋、番茄、青椒、土豆"
            placeholderTextColor={p.outlineMuted}
            multiline
            textAlignVertical="top"
            editable={!loading && !saving}
            style={[
              styles.pantryInput,
              { color: p.text, borderColor: p.border, backgroundColor: p.inputBg },
            ]}
          />
          <TextInput
            value={preferences}
            onChangeText={t => setPreferences(t.slice(0, 80))}
            placeholder="偏好（可选）：少油、快手…"
            placeholderTextColor={p.outlineMuted}
            editable={!loading && !saving}
            style={[
              styles.prefInput,
              { color: p.text, borderColor: p.border, backgroundColor: p.inputBg },
            ]}
          />

          <Pressable
            onPress={() => void runSuggest()}
            disabled={loading || saving}
            style={({ pressed }) => [
              styles.primaryBtn,
              { backgroundColor: p.primary, opacity: pressed || loading || saving ? 0.7 : 1 },
            ]}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialIcons name="kitchen" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>{fetched ? '重新推荐' : 'AI 选菜'}</Text>
              </>
            )}
          </Pressable>

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {suggestions.map(s => {
              const on = selected.has(s.recipeId);
              return (
                <Pressable
                  key={s.recipeId}
                  onPress={() => toggle(s.recipeId)}
                  disabled={saving}
                  style={({ pressed }) => [
                    styles.row,
                    { borderColor: p.border, opacity: pressed ? 0.8 : 1 },
                  ]}>
                  <View
                    style={[
                      styles.check,
                      {
                        borderColor: on ? p.primary : p.outlineMuted,
                        backgroundColor: on ? p.primary : 'transparent',
                      },
                    ]}>
                    {on ? <MaterialIcons name="check" size={14} color="#fff" /> : null}
                  </View>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: p.text }]} numberOfLines={1}>
                      {s.recipeTitle}
                    </Text>
                    {s.reason ? (
                      <Text style={[styles.rowReason, { color: p.outlineMuted }]} numberOfLines={2}>
                        {s.reason}
                      </Text>
                    ) : null}
                    {s.missing_ingredients.length > 0 ? (
                      <Text style={[styles.missing, { color: p.accent }]} numberOfLines={2}>
                        缺口：{s.missing_ingredients.join('、')}
                      </Text>
                    ) : (
                      <Text style={[styles.missing, { color: p.outlineMuted }]}>食材基本齐</Text>
                    )}
                  </View>
                </Pressable>
              );
            })}
            {notes ? (
              <Text style={[styles.notes, { color: p.outlineMuted }]}>{notes}</Text>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Pressable
              onPress={() => void applyToBasket()}
              disabled={saving || loading || picked.length === 0}
              style={({ pressed }) => [
                styles.secondaryBtn,
                {
                  borderColor: p.border,
                  backgroundColor: p.inputBg,
                  opacity: pressed || saving || loading || picked.length === 0 ? 0.65 : 1,
                },
              ]}>
              <Text style={{ color: p.text, fontWeight: '800' }}>进菜单篮</Text>
            </Pressable>
            <Pressable
              onPress={() => void applyToShop()}
              disabled={saving || loading || picked.length === 0}
              style={({ pressed }) => [
                styles.confirmBtn,
                {
                  backgroundColor: p.accent,
                  opacity: pressed || saving || loading || picked.length === 0 ? 0.65 : 1,
                },
              ]}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.primaryBtnText}>加入采购（{picked.length}）</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'center', paddingHorizontal: 18 },
  card: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    maxHeight: '88%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '900' },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 10 },
  pantryInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    minHeight: 72,
    marginBottom: 8,
  },
  prefInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 10,
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 14,
    paddingVertical: 12,
    marginBottom: 10,
    minHeight: 44,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  list: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: '800' },
  rowReason: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  missing: { fontSize: 12, fontWeight: '700', marginTop: 2 },
  notes: { fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
  },
  confirmBtn: {
    flex: 1.3,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
});
