/**
 * 摄入详情「份量修正」：原四项 + 用户修正句 → AI 草稿 → 确认后由调用方 updateHealthRecord。
 */
import { useHealthHomeTheme } from '@/constants/health-home-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  adjustFoodIntake,
  type FoodAdjustIntakeJson,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
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

export type AdjustIntakeSource = {
  title: string;
  hydration: number;
  protein: number;
  carbohydrate: number;
  calories: number;
  aiComment?: string | null;
};

export type AdjustIntakeSheetProps = {
  visible: boolean;
  onClose: () => void;
  source: AdjustIntakeSource | null;
  onConfirm: (draft: FoodAdjustIntakeJson) => void | Promise<void>;
};

const PRESETS = ['其实只吃了一半', '加一份菜', '少算了汤', '两人分食我只吃一份'] as const;

export function AdjustIntakeSheet({ visible, onClose, source, onConfirm }: AdjustIntakeSheetProps) {
  const insets = useSafeAreaInsets();
  const { hh } = useHealthHomeTheme();
  const styles = useMemo(() => createStyles(), []);

  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<FoodAdjustIntakeJson | null>(null);

  useEffect(() => {
    if (!visible) {
      setText('');
      setDraft(null);
      setLoading(false);
      setSaving(false);
    }
  }, [visible]);

  const runAdjust = async (override?: string) => {
    if (!source || loading) return;
    const adjustment = (override ?? text).trim();
    if (!adjustment) {
      toast.info('请先写一句修正说明');
      return;
    }
    if (override) setText(override);
    setLoading(true);
    setDraft(null);
    try {
      const r = await adjustFoodIntake({
        title: source.title,
        hydrationMl: source.hydration,
        proteinG: source.protein,
        carbohydrateG: source.carbohydrate,
        caloriesKcal: source.calories,
        aiComment: source.aiComment?.trim() || undefined,
        adjustmentText: adjustment,
      });
      if (!r.ok) {
        toast.error(r.error || '修正失败');
        return;
      }
      setDraft(r.data);
    } catch (e) {
      toast.error(toUserMessage(e, '修正失败'));
    } finally {
      setLoading(false);
    }
  };

  const handleConfirm = async () => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      await onConfirm(draft);
      onClose();
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  if (!visible || !source) return null;

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} accessibilityLabel="关闭" />
        <View style={[styles.sheet, { backgroundColor: hh.card, borderColor: hh.line }]}>
          <View style={styles.head}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.title, { color: hh.ink }]}>份量修正</Text>
              <Text style={[styles.sub, { color: hh.muted }]} numberOfLines={2}>
                {source.title || '这条记录'} · 确认后写入
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="关闭份量修正">
              <MaterialIcons name="close" size={22} color={hh.inkSoft} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <Text style={[styles.blockTitle, { color: hh.ink }]}>原四项</Text>
            <Text style={[styles.metrics, { color: hh.muted }]}>
              {Math.round(source.hydration)}ml · 蛋白 {Math.round(source.protein)}g · 碳水{' '}
              {Math.round(source.carbohydrate)}g · {Math.round(source.calories)}kcal
            </Text>

            <Text style={[styles.blockTitle, { color: hh.ink, marginTop: 8 }]}>怎么改</Text>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="例如：其实只吃了一半"
              placeholderTextColor={hh.faint}
              multiline
              style={[styles.input, { color: hh.ink, borderColor: hh.line, backgroundColor: hh.cardMuted }]}
              editable={!loading && !saving}
            />
            <View style={styles.presetRow}>
              {PRESETS.map((p) => (
                <Pressable
                  key={p}
                  onPress={() => void runAdjust(p)}
                  disabled={loading || saving}
                  style={[styles.preset, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                  <Text style={[styles.presetText, { color: hh.inkSoft }]}>{p}</Text>
                </Pressable>
              ))}
            </View>

            <Pressable
              onPress={() => void runAdjust()}
              disabled={loading || saving || !text.trim()}
              style={[
                styles.secondaryBtn,
                { borderColor: hh.pine, opacity: loading || !text.trim() ? 0.5 : 1 },
              ]}>
              {loading ? (
                <ActivityIndicator color={hh.pine} />
              ) : (
                <Text style={[styles.secondaryBtnText, { color: hh.pine }]}>AI 重新估算</Text>
              )}
            </Pressable>

            {draft ? (
              <View style={[styles.draftCard, { backgroundColor: hh.cardMuted, borderColor: hh.line }]}>
                <Text style={[styles.blockTitle, { color: hh.ink }]}>修正预览</Text>
                <Text style={[styles.draftSummary, { color: hh.ink }]}>{draft.food_summary}</Text>
                <Text style={[styles.metrics, { color: hh.muted }]}>
                  {Math.round(draft.hydration_ml)}ml · 蛋白 {Math.round(draft.protein_g)}g · 碳水{' '}
                  {Math.round(draft.carbohydrate_g)}g · {Math.round(draft.calories_kcal)}kcal
                </Text>
                {draft.ai_evaluation ? (
                  <Text style={[styles.eval, { color: hh.inkSoft }]}>{draft.ai_evaluation}</Text>
                ) : null}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.footer}>
            <Pressable
              onPress={() => void handleConfirm()}
              disabled={!draft || saving || loading}
              style={[
                styles.primaryBtn,
                { backgroundColor: hh.pine, opacity: !draft || saving || loading ? 0.5 : 1 },
              ]}>
              <Text style={[styles.primaryBtnText, { color: hh.onPine }]}>
                {saving ? '保存中…' : '确认写入'}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function createStyles() {
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
      maxHeight: '88%',
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
    scroll: { maxHeight: 460 },
    scrollContent: { paddingHorizontal: 16, paddingBottom: 12, gap: 8 },
    blockTitle: { fontSize: 13, fontWeight: '800' },
    metrics: { fontSize: 12, fontWeight: '600' },
    input: {
      minHeight: 72,
      borderRadius: 14,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      fontWeight: '600',
      textAlignVertical: 'top',
    },
    presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    preset: {
      borderRadius: 999,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    presetText: { fontSize: 12, fontWeight: '600' },
    secondaryBtn: {
      marginTop: 4,
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 12,
      alignItems: 'center',
    },
    secondaryBtnText: { fontSize: 14, fontWeight: '700' },
    draftCard: {
      marginTop: 8,
      borderRadius: 16,
      borderWidth: StyleSheet.hairlineWidth,
      padding: 14,
      gap: 6,
    },
    draftSummary: { fontSize: 15, fontWeight: '800' },
    eval: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
    footer: { paddingHorizontal: 16, paddingBottom: 14, paddingTop: 4 },
    primaryBtn: {
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
    },
    primaryBtnText: { fontSize: 14, fontWeight: '800' },
  });
}
