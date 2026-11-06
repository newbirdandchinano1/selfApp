/**
 * 复盘 P2：跨周期洞察 / 语音记一笔 / 模板文案建议 Modal。
 */
import { useFoldTheme } from '@/constants/review-fold-theme';
import type {
  ReviewPeriodInsightsResult,
  ReviewSuggestTemplateCopyResult,
  ReviewTemplateCopyColumn,
} from '@/lib/ai-api-client';
import { REVIEW_AI_ACTION_META } from '@/lib/review-ai-quick-create';
import type { ReviewAiSuggestion, ReviewAiSuggestionAction } from '@/lib/review-ai-sections';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
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

function toSuggestion(action: {
  action?: string;
  draft_title?: string;
  draft_body?: string;
  text?: string;
}): ReviewAiSuggestion {
  const text = (action.text || action.draft_title || '').trim();
  const draftTitle = (action.draft_title || text).trim();
  const raw = String(action.action || 'todo').toLowerCase();
  const mapped: ReviewAiSuggestionAction =
    raw === 'memo' || raw === 'project' || raw === 'habit' || raw === 'todo' ? raw : 'todo';
  return {
    text,
    action: mapped,
    draftTitle,
    draftBody: (action.draft_body || '').trim(),
  };
}

export function ReviewPeriodInsightsSheet({
  visible,
  loading,
  error,
  data,
  scopeLabel,
  onClose,
  onRetry,
  onAddSuggestion,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  data: ReviewPeriodInsightsResult | null;
  scopeLabel: string;
  onClose: () => void;
  onRetry: () => void;
  onAddSuggestion: (suggestion: ReviewAiSuggestion, action: ReviewAiSuggestionAction) => void;
}) {
  const { fold } = useFoldTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: fold.card,
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: '84%',
            },
          ]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
            近月模式
          </Text>
          <Text style={[styles.sub, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
            基于近几期{scopeLabel}的只读洞察；不会改历史刊。可选「+」落到备忘/待办等。
          </Text>

          {loading ? (
            <View style={styles.centerBlock}>
              <ActivityIndicator color={fold.pine} />
              <Text style={[styles.hint, { color: fold.muted }]}>正在提炼跨周期模式…</Text>
            </View>
          ) : error || !data ? (
            <>
              <Text style={[styles.body, { color: fold.amber }]}>{error || '暂无洞察'}</Text>
              <Pressable
                onPress={onRetry}
                style={[styles.primaryBtn, { backgroundColor: fold.pineButton }]}>
                <Text style={[styles.primaryBtnText, { color: fold.onPineButton }]}>重试</Text>
              </Pressable>
            </>
          ) : (
            <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
              {data.themes.length > 0 ? (
                <>
                  <Text style={[styles.kicker, { color: fold.muted }]}>主题</Text>
                  <Text style={[styles.body, { color: fold.ink }]}>{data.themes.join(' · ')}</Text>
                </>
              ) : null}
              {data.recurring_defects.length > 0 ? (
                <>
                  <Text style={[styles.kicker, { color: fold.muted }]}>反复缺陷</Text>
                  {data.recurring_defects.map((t, i) => (
                    <Text key={`${t}-${i}`} style={[styles.body, { color: fold.inkSoft }]}>
                      · {t}
                    </Text>
                  ))}
                </>
              ) : null}
              {data.tips.length > 0 ? (
                <>
                  <Text style={[styles.kicker, { color: fold.muted }]}>提示</Text>
                  {data.tips.map((t, i) => (
                    <Text key={`${t}-${i}`} style={[styles.body, { color: fold.inkSoft }]}>
                      · {t}
                    </Text>
                  ))}
                </>
              ) : null}
              {data.suggested_actions.length > 0 ? (
                <>
                  <Text style={[styles.kicker, { color: fold.muted }]}>可确认行动</Text>
                  {data.suggested_actions.map((item, index) => {
                    const suggestion = toSuggestion(item);
                    const meta = REVIEW_AI_ACTION_META[suggestion.action];
                    return (
                      <View
                        key={`${suggestion.draftTitle}-${index}`}
                        style={[styles.actionRow, { borderColor: fold.line, backgroundColor: fold.paper }]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.outlineTitle, { color: fold.ink }]} numberOfLines={2}>
                            {suggestion.draftTitle || suggestion.text}
                          </Text>
                          <Text style={[styles.hint, { color: fold.muted }]} numberOfLines={2}>
                            {meta.label}
                            {suggestion.draftBody ? ` · ${suggestion.draftBody}` : ''}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => onAddSuggestion(suggestion, suggestion.action)}
                          accessibilityRole="button"
                          accessibilityLabel={`新建${meta.label}`}
                          style={[styles.plusBtn, { backgroundColor: fold.sage2 }]}>
                          <MaterialIcons name="add" size={20} color={fold.pine} />
                        </Pressable>
                      </View>
                    );
                  })}
                </>
              ) : null}
              {!data.themes.length &&
              !data.recurring_defects.length &&
              !data.tips.length &&
              !data.suggested_actions.length ? (
                <Text style={[styles.body, { color: fold.muted }]}>近期复盘偏少，暂无明显模式。</Text>
              ) : null}
            </ScrollView>
          )}

          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { borderColor: fold.line }]}
            accessibilityRole="button"
            accessibilityLabel="关闭">
            <Text style={{ color: fold.ink2, fontWeight: '600' }}>关闭</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ReviewVoiceDraftSheet({
  visible,
  loading,
  error,
  value,
  onChangeText,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  value: string;
  onChangeText: (t: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { fold } = useFoldTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: fold.card,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
            语音记一笔
          </Text>
          <Text style={[styles.sub, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
            粘贴系统语音转写文本，或直接打字；走 AI 起草进编辑缓冲，确认保存后才落库。
          </Text>
          <TextInput
            value={value}
            onChangeText={onChangeText}
            multiline
            placeholder="例如：下午把周报交了，报销还没办，晚上刷手机有点久…"
            placeholderTextColor={fold.faint}
            style={[
              styles.input,
              {
                color: fold.ink2,
                borderColor: fold.line,
                backgroundColor: fold.paper,
              },
            ]}
            textAlignVertical="top"
            editable={!loading}
          />
          {error ? (
            <Text style={[styles.body, { color: fold.amber }]} maxFontSizeMultiplier={1.3}>
              {error}
            </Text>
          ) : null}
          <Pressable
            onPress={onSubmit}
            disabled={loading || !value.trim()}
            style={[
              styles.primaryBtn,
              {
                backgroundColor: fold.pineButton,
                opacity: loading || !value.trim() ? 0.55 : 1,
              },
            ]}>
            {loading ? (
              <ActivityIndicator color={fold.onPineButton} />
            ) : (
              <Text style={[styles.primaryBtnText, { color: fold.onPineButton }]}>生成草稿</Text>
            )}
          </Pressable>
          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { borderColor: fold.line }]}
            accessibilityRole="button"
            accessibilityLabel="关闭">
            <Text style={{ color: fold.ink2, fontWeight: '600' }}>关闭</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ReviewTemplateCopySheet({
  visible,
  loading,
  error,
  goal,
  onChangeGoal,
  data,
  onClose,
  onGenerate,
  onApplyColumn,
  onApplyAll,
}: {
  visible: boolean;
  loading: boolean;
  error: string | null;
  goal: string;
  onChangeGoal: (t: string) => void;
  data: ReviewSuggestTemplateCopyResult | null;
  onClose: () => void;
  onGenerate: () => void;
  onApplyColumn: (col: ReviewTemplateCopyColumn) => void;
  onApplyAll: () => void;
}) {
  const { fold } = useFoldTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.card,
            {
              backgroundColor: fold.card,
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: '84%',
            },
          ]}
          onPress={e => e.stopPropagation()}>
          <Text style={[styles.title, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
            AI 建议栏目说明
          </Text>
          <Text style={[styles.sub, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
            只改 placeholder 草稿，确认后再保存模板；不改内置维度结构。
          </Text>
          <TextInput
            value={goal}
            onChangeText={onChangeGoal}
            placeholder="一句目标，例如：更关注睡眠与青蛙收口"
            placeholderTextColor={fold.faint}
            style={[
              styles.goalInput,
              {
                color: fold.ink2,
                borderColor: fold.line,
                backgroundColor: fold.paper,
              },
            ]}
            editable={!loading}
          />
          <Pressable
            onPress={onGenerate}
            disabled={loading}
            style={[
              styles.primaryBtn,
              { backgroundColor: fold.pineButton, opacity: loading ? 0.7 : 1 },
            ]}>
            {loading ? (
              <ActivityIndicator color={fold.onPineButton} />
            ) : (
              <Text style={[styles.primaryBtnText, { color: fold.onPineButton }]}>
                {data ? '重新生成' : '生成建议'}
              </Text>
            )}
          </Pressable>
          {error ? (
            <Text style={[styles.body, { color: fold.amber }]} maxFontSizeMultiplier={1.3}>
              {error}
            </Text>
          ) : null}
          {data ? (
            <ScrollView style={styles.previewScroll} showsVerticalScrollIndicator={false}>
              {data.columns.map((col, index) => (
                <View
                  key={`${col.dimension_title}-${col.column_title}-${index}`}
                  style={[styles.outlineRow, { borderColor: fold.line, backgroundColor: fold.paper }]}>
                  <Text style={[styles.outlineTitle, { color: fold.ink }]} numberOfLines={1}>
                    {col.dimension_title}
                    {col.column_title ? ` · ${col.column_title}` : ''}
                  </Text>
                  <Text style={[styles.outlinePrompt, { color: fold.inkSoft }]}>{col.placeholder}</Text>
                  {col.hint ? (
                    <Text style={[styles.hint, { color: fold.muted }]}>{col.hint}</Text>
                  ) : null}
                  <Pressable
                    onPress={() => onApplyColumn(col)}
                    style={[styles.secondaryBtn, { borderColor: fold.line }]}>
                    <Text style={{ color: fold.pine, fontWeight: '600', fontSize: 13 }}>应用到该栏</Text>
                  </Pressable>
                </View>
              ))}
              <Pressable
                onPress={onApplyAll}
                style={[styles.primaryBtn, { backgroundColor: fold.sage2, marginTop: 4 }]}>
                <Text style={[styles.primaryBtnText, { color: fold.pine }]}>全部写入草稿</Text>
              </Pressable>
            </ScrollView>
          ) : null}
          <Pressable
            onPress={onClose}
            style={[styles.closeBtn, { borderColor: fold.line }]}
            accessibilityRole="button"
            accessibilityLabel="关闭">
            <Text style={{ color: fold.ink2, fontWeight: '600' }}>关闭</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20, 24, 18, 0.45)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  card: {
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sub: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  primaryBtn: {
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  body: {
    fontSize: 14,
    lineHeight: 22,
  },
  hint: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
  kicker: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 10,
    marginBottom: 4,
    letterSpacing: 0.4,
  },
  previewScroll: {
    maxHeight: 360,
  },
  centerBlock: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 24,
  },
  outlineRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 4,
  },
  outlineTitle: {
    fontSize: 14,
    fontWeight: '700',
  },
  outlinePrompt: {
    fontSize: 12.5,
    lineHeight: 18,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  plusBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 120,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
  },
  goalInput: {
    minHeight: 42,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  closeBtn: {
    marginTop: 4,
    minHeight: 42,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
