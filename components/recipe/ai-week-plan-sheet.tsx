import { useColorScheme } from '@/hooks/use-color-scheme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import type { RecipeWeekPlanEntryJson } from '@/lib/ai-api-client';
import {
  buildExistingPlanSummaries,
  buildRecipeAiSummaries,
  isMealSlot,
  weekRangeContaining,
} from '@/lib/recipe-ai-context';
import {
  addRecipePlanEntry,
  mealSlotLabel,
  type RecipePlanStore,
} from '@/lib/recipe-plan';
import { getRecipePalette } from '@/lib/recipe-theme';
import type { RecipeStore } from '@/lib/recipes';
import { suggestRecipeWeekPlan } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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

export type AiWeekPlanSheetProps = {
  visible: boolean;
  onClose: () => void;
  focusYmd: string;
  recipeStore: RecipeStore | null;
  planStore: RecipePlanStore;
  onApplied?: () => void;
};

type Candidate = RecipeWeekPlanEntryJson & { key: string };

export function AiWeekPlanSheet({
  visible,
  onClose,
  focusYmd,
  recipeStore,
  planStore,
  onApplied,
}: AiWeekPlanSheetProps) {
  const insets = useSafeAreaInsets();
  const p = getRecipePalette(useColorScheme());
  const range = useMemo(() => weekRangeContaining(focusYmd), [focusYmd]);

  const [preferences, setPreferences] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [notes, setNotes] = useState('');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [unmet, setUnmet] = useState<{ date: string; slot: string; hint: string }[]>([]);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!visible) {
      setPreferences('');
      setCandidates([]);
      setSelected(new Set());
      setNotes('');
      setDrafts([]);
      setUnmet([]);
      setFetched(false);
      setLoading(false);
      setSaving(false);
    }
  }, [visible]);

  const runSuggest = useCallback(async () => {
    if (!range) {
      toast.error('日期无效');
      return;
    }
    if (!recipeStore || recipeStore.recipes.length === 0) {
      toast.warn('请先在菜谱库添加几道菜');
      return;
    }
    setLoading(true);
    try {
      const recipes = await buildRecipeAiSummaries(recipeStore);
      const existingPlan = buildExistingPlanSummaries(planStore, range.start, range.end);
      const r = await suggestRecipeWeekPlan({
        startDate: range.start,
        endDate: range.end,
        recipes,
        existingPlan,
        preferences: preferences.trim() || undefined,
        targetSlots: ['lunch', 'dinner'],
      });
      if (!r.ok) {
        toast.error(r.error || 'AI 排餐失败');
        return;
      }
      const list: Candidate[] = r.data.entries
        .filter(e => isMealSlot(e.slot))
        .map(e => ({
          ...e,
          key: `${e.date}|${e.slot}|${e.recipeId}`,
        }));
      setCandidates(list);
      setSelected(new Set(list.map(c => c.key)));
      setNotes(r.data.notes || '');
      setDrafts(r.data.suggest_new_drafts || []);
      setUnmet(r.data.unmet_slots || []);
      setFetched(true);
      if (list.length === 0) {
        toast.info('本周暂无库内可排候选，可看下方建议');
      }
    } catch (e) {
      toast.error(toUserMessage(e, 'AI 排餐失败'));
    } finally {
      setLoading(false);
    }
  }, [planStore, preferences, range, recipeStore]);

  const toggle = useCallback((key: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const onConfirm = useCallback(async () => {
    const picked = candidates.filter(c => selected.has(c.key) && isMealSlot(c.slot));
    if (picked.length === 0) {
      toast.warn('请先勾选要写入的安排');
      return;
    }
    setSaving(true);
    try {
      for (const c of picked) {
        await addRecipePlanEntry({
          date: c.date,
          slot: c.slot as 'breakfast' | 'lunch' | 'dinner' | 'snack',
          recipeId: c.recipeId,
          recipeTitle: c.recipeTitle,
        });
      }
      toast.success(`已写入 ${picked.length} 项`);
      onApplied?.();
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '写入失败'));
    } finally {
      setSaving(false);
    }
  }, [candidates, onApplied, onClose, selected]);

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
            <Text style={[styles.title, { color: p.text }]}>AI 排本周</Text>
            <Pressable onPress={onClose} hitSlop={10} disabled={loading || saving}>
              <MaterialIcons name="close" size={22} color={p.outlineMuted} />
            </Pressable>
          </View>
          <Text style={[styles.sub, { color: p.outlineMuted }]}>
            {range ? `${range.start} ~ ${range.end}` : focusYmd} · 仅从你的菜谱库选 · 确认后写入
          </Text>

          <TextInput
            value={preferences}
            onChangeText={t => setPreferences(t.slice(0, 120))}
            placeholder="偏好（可选）：少油、不重复、清淡…"
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
                <MaterialIcons name="auto-awesome" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>{fetched ? '重新生成' : '生成候选'}</Text>
              </>
            )}
          </Pressable>

          <ScrollView
            style={styles.list}
            contentContainerStyle={{ paddingBottom: 8 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {candidates.map(c => {
              const on = selected.has(c.key);
              return (
                <Pressable
                  key={c.key}
                  onPress={() => toggle(c.key)}
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
                      {c.date.slice(5)} · {mealSlotLabel(c.slot as 'lunch')} · {c.recipeTitle}
                    </Text>
                    {c.reason ? (
                      <Text style={[styles.rowReason, { color: p.outlineMuted }]} numberOfLines={2}>
                        {c.reason}
                      </Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}

            {unmet.length > 0 ? (
              <View style={styles.metaBlock}>
                <Text style={[styles.metaTitle, { color: p.text }]}>未排满</Text>
                {unmet.map((u, i) => (
                  <Text key={`${u.date}-${u.slot}-${i}`} style={{ color: p.outlineMuted, fontSize: 12 }}>
                    {u.date.slice(5)} {mealSlotLabel(u.slot as 'lunch')}
                    {u.hint ? `：${u.hint}` : ''}
                  </Text>
                ))}
              </View>
            ) : null}

            {drafts.length > 0 ? (
              <View style={styles.metaBlock}>
                <Text style={[styles.metaTitle, { color: p.text }]}>建议新建</Text>
                <Text style={{ color: p.outlineMuted, fontSize: 12, lineHeight: 18 }}>
                  {drafts.join('、')}
                </Text>
              </View>
            ) : null}

            {notes ? (
              <Text style={[styles.notes, { color: p.outlineMuted }]}>{notes}</Text>
            ) : null}
          </ScrollView>

          <Pressable
            onPress={() => void onConfirm()}
            disabled={saving || loading || selected.size === 0}
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                backgroundColor: p.accent,
                opacity: pressed || saving || loading || selected.size === 0 ? 0.65 : 1,
              },
            ]}>
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.primaryBtnText}>写入已勾选（{selected.size}）</Text>
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
    maxHeight: '88%',
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '900' },
  sub: { fontSize: 12, fontWeight: '600', marginTop: 4, marginBottom: 10 },
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
  list: { maxHeight: 320 },
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
  metaBlock: { marginTop: 6, marginBottom: 8, gap: 4 },
  metaTitle: { fontSize: 13, fontWeight: '800' },
  notes: { fontSize: 12, fontWeight: '600', lineHeight: 18, marginBottom: 8 },
  confirmBtn: {
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: 4,
  },
});
