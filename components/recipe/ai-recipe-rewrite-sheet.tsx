import { useColorScheme } from '@/hooks/use-color-scheme';
import type { RecipeScaleRewriteJson } from '@/lib/ai-api-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getRecipePalette } from '@/lib/recipe-theme';
import {
  RECIPE_NOTES_MAX,
  RECIPE_TITLE_MAX,
  updateRecipe,
  type RecipeIngredient,
  type RecipeItem,
} from '@/lib/recipes';
import { scaleOrRewriteRecipe } from '@/lib/zhipu-image-parse';
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

const GOAL_PRESETS = ['改成 2 人份', '改成 4 人份', '步骤更短', '写得更口语'] as const;

export type AiRecipeRewriteSheetProps = {
  visible: boolean;
  onClose: () => void;
  recipe: RecipeItem | null;
  onApplied?: (next: RecipeItem) => void;
};

export function AiRecipeRewriteSheet({
  visible,
  onClose,
  recipe,
  onApplied,
}: AiRecipeRewriteSheetProps) {
  const insets = useSafeAreaInsets();
  const p = getRecipePalette(useColorScheme());

  const [goal, setGoal] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<RecipeScaleRewriteJson | null>(null);

  useEffect(() => {
    if (!visible) {
      setGoal('');
      setDraft(null);
      setLoading(false);
      setSaving(false);
    }
  }, [visible]);

  const runRewrite = useCallback(async () => {
    if (!recipe) return;
    const g = goal.trim();
    if (!g) {
      toast.warn('请填写或点选改写目标');
      return;
    }
    setLoading(true);
    try {
      const r = await scaleOrRewriteRecipe({
        title: recipe.title,
        ingredients: recipe.ingredients.map(ing => ({
          name: ing.name,
          amount: ing.amount,
          ...(ing.remark ? { remark: ing.remark } : {}),
        })),
        steps: recipe.steps,
        notes: recipe.notes,
        goal: g,
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 改写失败');
        return;
      }
      setDraft(r.data);
      if (r.data.summary) toast.info(r.data.summary);
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 改写失败'));
    } finally {
      setLoading(false);
    }
  }, [goal, recipe]);

  const onConfirm = useCallback(async () => {
    if (!recipe || !draft) return;
    setSaving(true);
    try {
      const ingredients: RecipeIngredient[] = draft.ingredients.map(ing => ({
        name: ing.name,
        amount: ing.amount,
        ...(ing.remark ? { remark: ing.remark } : {}),
      }));
      const title = (draft.title.trim() || recipe.title).slice(0, RECIPE_TITLE_MAX);
      const notes = draft.notes.trim()
        ? draft.notes.trim().slice(0, RECIPE_NOTES_MAX)
        : null;
      const next = await updateRecipe(recipe.id, {
        title,
        ingredients,
        steps: draft.steps,
        notes,
      });
      if (!next) {
        toast.error('保存失败，菜谱可能已删除');
        return;
      }
      toast.success('已应用改写');
      onApplied?.(next);
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  }, [draft, onApplied, onClose, recipe]);

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
            <Text style={[styles.title, { color: p.text }]}>AI 改写菜谱</Text>
            <Pressable onPress={onClose} hitSlop={10} disabled={loading || saving}>
              <MaterialIcons name="close" size={22} color={p.outlineMuted} />
            </Pressable>
          </View>
          <Text style={[styles.sub, { color: p.outlineMuted }]}>
            预览草稿后确认才写入；不会自动覆盖
          </Text>

          <View style={styles.presets}>
            {GOAL_PRESETS.map(item => (
              <Pressable
                key={item}
                onPress={() => setGoal(item)}
                disabled={loading || saving}
                style={({ pressed }) => [
                  styles.presetChip,
                  {
                    borderColor: goal === item ? p.primary : p.border,
                    backgroundColor: goal === item ? p.primarySoft : p.inputBg,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}>
                <Text
                  style={{
                    color: goal === item ? p.primary : p.textSecondary,
                    fontSize: 12,
                    fontWeight: '700',
                  }}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>

          <TextInput
            value={goal}
            onChangeText={t => setGoal(t.slice(0, 120))}
            placeholder="或自定义目标，如：少油少盐、适合上班族"
            placeholderTextColor={p.outlineMuted}
            editable={!loading && !saving}
            style={[
              styles.goalInput,
              { color: p.text, borderColor: p.border, backgroundColor: p.inputBg },
            ]}
          />

          <Pressable
            onPress={() => void runRewrite()}
            disabled={loading || saving || !recipe}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: p.primary,
                opacity: pressed || loading || saving || !recipe ? 0.7 : 1,
              },
            ]}>
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <MaterialIcons name="auto-awesome" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>{draft ? '重新生成' : '生成草稿'}</Text>
              </>
            )}
          </Pressable>

          <ScrollView
            style={styles.preview}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {draft ? (
              <View style={styles.previewBody}>
                {draft.summary ? (
                  <Text style={[styles.summary, { color: p.accent }]}>{draft.summary}</Text>
                ) : null}
                <Text style={[styles.previewTitle, { color: p.text }]}>
                  {draft.title || '（保留原菜名）'}
                </Text>
                <Text style={[styles.sectionLabel, { color: p.outlineMuted }]}>食材</Text>
                {draft.ingredients.length === 0 ? (
                  <Text style={{ color: p.outlineMuted, fontSize: 13 }}>（空）</Text>
                ) : (
                  draft.ingredients.map((ing, i) => (
                    <Text key={`ing-${i}`} style={[styles.line, { color: p.text }]}>
                      · {ing.name}
                      {ing.amount ? ` ${ing.amount}` : ''}
                      {ing.remark ? `（${ing.remark}）` : ''}
                    </Text>
                  ))
                )}
                <Text style={[styles.sectionLabel, { color: p.outlineMuted, marginTop: 10 }]}>
                  步骤
                </Text>
                {draft.steps.length === 0 ? (
                  <Text style={{ color: p.outlineMuted, fontSize: 13 }}>（空）</Text>
                ) : (
                  draft.steps.map((s, i) => (
                    <Text key={`step-${i}`} style={[styles.line, { color: p.text }]}>
                      {i + 1}. {s}
                    </Text>
                  ))
                )}
                {draft.notes ? (
                  <>
                    <Text style={[styles.sectionLabel, { color: p.outlineMuted, marginTop: 10 }]}>
                      备注
                    </Text>
                    <Text style={[styles.line, { color: p.text }]}>{draft.notes}</Text>
                  </>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.emptyHint, { color: p.outlineMuted }]}>
                生成后在此预览改写结果
              </Text>
            )}
          </ScrollView>

          <Pressable
            onPress={() => void onConfirm()}
            disabled={!draft || loading || saving}
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                backgroundColor: p.accent,
                opacity: pressed || !draft || loading || saving ? 0.65 : 1,
              },
            ]}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>确认写入菜谱</Text>
            )}
          </Pressable>
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
    maxHeight: '90%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '900' },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 10 },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  presetChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  goalInput: {
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
  preview: { maxHeight: 280 },
  previewBody: { paddingBottom: 8 },
  summary: { fontSize: 13, fontWeight: '800', marginBottom: 8 },
  previewTitle: { fontSize: 16, fontWeight: '900', marginBottom: 8 },
  sectionLabel: { fontSize: 12, fontWeight: '800', marginBottom: 4 },
  line: { fontSize: 13, fontWeight: '600', lineHeight: 20 },
  emptyHint: { textAlign: 'center', paddingVertical: 24, fontSize: 13, fontWeight: '600' },
  confirmBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: 6,
  },
});
