/**
 * S9.2 ConfirmCard：draft_fields + 确认/取消双按钮 + write_status。
 * S9.7：分域字段模板（中文标签 / 金额数字键盘 / 正文多行）。
 * 可复用于任意域；preview_* 仍用单按钮兼容路径。
 */
import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { toast } from '@/lib/app-feedback';
import type { ActionCard } from '@/lib/assistant/action-card';
import {
  isMultilineFieldKey,
  isNumericFieldKey,
  isSelectFieldKey,
} from '@/lib/assistant/confirm-card-fields';
import { formatSyncStatusLabel } from '@/lib/assistant/commit-result';
import {
  deriveDraftFields,
  isCommitConfirmAction,
  type DraftField,
} from '@/lib/assistant/write-operation';

type CategoryOption = { id: string; name: string };

export type ActionConfirmCardProps = {
  card: ActionCard;
  busy?: boolean;
  onConfirm?: (card: ActionCard) => void;
  onCancel?: (card: ActionCard) => void;
  onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
  /** 澄清卡选项点击（回投下一轮） */
  onClarifyChoice?: (card: ActionCard, choice: string) => void;
};

function statusLabel(card: ActionCard): string | null {
  switch (card.write_status) {
    case 'committing':
      return '正在保存…';
    case 'succeeded': {
      const custom = card.result?.message?.trim();
      const sync = formatSyncStatusLabel(card.result?.sync_status);
      if (custom && /同步|已保存/.test(custom)) return custom;
      if (custom) return `${custom}${custom.endsWith('。') ? '' : '。'}${sync}`;
      return sync || '已保存';
    }
    case 'failed':
      return card.error?.message?.trim() || '保存失败';
    case 'cancelled':
      return '已取消';
    default:
      return null;
  }
}

export function ActionConfirmCard({
  card,
  busy,
  onConfirm,
  onCancel,
  onDraftFieldChange,
  onClarifyChoice,
}: ActionConfirmCardProps) {
  const { colors } = useAppTheme();
  const isCommit =
    isCommitConfirmAction(card.confirm_action) ||
    isCommitConfirmAction(card.commit_action);
  const writeStatus = card.write_status;
  const terminal =
    writeStatus === 'succeeded' || writeStatus === 'cancelled';
  const committing = writeStatus === 'committing' || busy;
  const clarifyChoices =
    card.intent === 'clarify' || Boolean(card.clarify_question?.trim())
      ? (card.clarify_choices ?? []).map(c => c.trim()).filter(Boolean).slice(0, 8)
      : [];
  const canAct =
    Boolean(card.confirm_action || card.commit_action) &&
    card.intent !== 'clarify' &&
    !terminal;
  const confirmAction = card.confirm_action || card.commit_action;
  const fields: DraftField[] = isCommit
    ? deriveDraftFields(card.draft, card.draft_fields, {
        confirmAction,
        domain: card.domain,
      })
    : // 只读 insight / 无确认动作：直接展示 draft_fields（不可编辑）
      (card.draft_fields ?? []).map(f => ({ ...f, editable: false }));
  const isInsightDisplay =
    !isCommit && (card.intent === 'insight' || (!canAct && fields.length > 0));
  const statusText = statusLabel(card);
  const [categoryPicker, setCategoryPicker] = React.useState<{
    fieldKey: string;
    options: CategoryOption[];
  } | null>(null);
  /** 文本编辑用本地态，避免每键 setSession 导致输入法被顶掉 */
  const [localValues, setLocalValues] = React.useState<Record<string, string>>({});
  const cardOpId = card.operation_id || card.idempotency_key || card.id;

  React.useEffect(() => {
    setLocalValues({});
  }, [cardOpId]);

  const fieldValue = React.useCallback(
    (f: DraftField) => (localValues[f.key] !== undefined ? localValues[f.key] : f.value),
    [localValues],
  );

  const flushLocalToDraft = React.useCallback((): ActionCard => {
    const draft = { ...(card.draft ?? {}) };
    for (const [key, value] of Object.entries(localValues)) {
      draft[key] = value;
      onDraftFieldChange?.(card, key, value);
    }
    return { ...card, draft };
  }, [card, localValues, onDraftFieldChange]);

  const pickRecipeCategory = React.useCallback(
    async (fieldKey: string) => {
      if (!onDraftFieldChange) return;
      try {
        const { listRecipeCategories } = await import('@/lib/recipes');
        const cats = await listRecipeCategories();
        if (!cats.length) {
          toast.info('还没有菜谱分类，请先在「我的菜谱」里新建');
          return;
        }
        setCategoryPicker({
          fieldKey,
          options: cats.map(c => ({ id: c.id, name: c.name })),
        });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : '加载分类失败');
      }
    },
    [onDraftFieldChange],
  );

  const applyCategory = React.useCallback(
    (opt: CategoryOption) => {
      if (!onDraftFieldChange || !categoryPicker) return;
      const fieldKey = categoryPicker.fieldKey;
      setLocalValues(prev => ({ ...prev, [fieldKey]: opt.name }));
      onDraftFieldChange(card, fieldKey, opt.name);
      onDraftFieldChange(card, 'category_id', opt.id);
      if (fieldKey !== 'category_hint') {
        onDraftFieldChange(card, 'category_hint', opt.name);
      }
      setCategoryPicker(null);
    },
    [card, categoryPicker, onDraftFieldChange],
  );

  const handleConfirm = React.useCallback(() => {
    if (!onConfirm) return;
    const nextCard = flushLocalToDraft();
    onConfirm(nextCard);
  }, [flushLocalToDraft, onConfirm]);

  return (
    <View
      style={[
        styles.card,
        { borderColor: colors.outline, backgroundColor: colors.surfaceMuted },
      ]}>
      <Text style={[styles.cardTitle, { color: colors.text }]} numberOfLines={2}>
        {card.title}
      </Text>
      {card.summary ? (
        <Text
          style={[styles.cardSummary, { color: colors.textMuted }]}
          numberOfLines={isInsightDisplay ? 6 : 3}
          selectable={isInsightDisplay}>
          {card.summary}
        </Text>
      ) : null}
      {card.clarify_question ? (
        <Text style={[styles.cardSummary, { color: colors.textMuted }]} numberOfLines={3}>
          {card.clarify_question}
        </Text>
      ) : null}

      {fields.length ? (
        isInsightDisplay ? (
          <ScrollView
            style={styles.insightScroll}
            contentContainerStyle={styles.fields}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={fields.length > 6}>
            {fields.map(f => (
              <View key={f.key} style={styles.fieldRow}>
                <Text style={[styles.fieldLabel, { color: colors.textMuted }]} numberOfLines={1}>
                  {f.label}
                </Text>
                <Text
                  style={[styles.fieldValue, { color: colors.text }]}
                  selectable
                  numberOfLines={isMultilineFieldKey(f.key) ? 12 : 4}>
                  {fieldValue(f) || '—'}
                </Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={styles.fields}>
            {fields.map(f => {
              const editable =
                Boolean(f.editable) &&
                !committing &&
                !terminal &&
                (writeStatus === 'awaiting_confirmation' ||
                  writeStatus === 'failed' ||
                  writeStatus === 'drafted' ||
                  !writeStatus);
              return (
                <View key={f.key} style={styles.fieldRow}>
                  <Text style={[styles.fieldLabel, { color: colors.textMuted }]} numberOfLines={1}>
                    {f.label}
                  </Text>
                  {editable && onDraftFieldChange ? (
                    f.input === 'select' || isSelectFieldKey(f.key, confirmAction) ? (
                      <Pressable
                        onPress={() => void pickRecipeCategory(f.key)}
                        disabled={committing}
                        accessibilityRole="button"
                        accessibilityLabel={`选择${f.label}`}
                        style={({ pressed }) => [
                          styles.fieldInput,
                          styles.fieldSelect,
                          {
                            borderColor: colors.outline,
                            backgroundColor: colors.surface,
                            opacity: pressed || committing ? 0.75 : 1,
                          },
                        ]}>
                        <Text
                          style={{
                            color: fieldValue(f).trim() ? colors.text : colors.textMuted,
                            fontSize: 13,
                            lineHeight: 18,
                            flex: 1,
                          }}
                          numberOfLines={1}>
                          {fieldValue(f).trim() || '点击选择现有分类'}
                        </Text>
                        <Text style={{ color: colors.textMuted, fontSize: 12 }}>更换</Text>
                      </Pressable>
                    ) : (
                      <TextInput
                        value={fieldValue(f)}
                        onChangeText={v =>
                          setLocalValues(prev => ({ ...prev, [f.key]: v }))
                        }
                        onBlur={() => {
                          const v = localValues[f.key];
                          if (v !== undefined) onDraftFieldChange(card, f.key, v);
                        }}
                        style={[
                          styles.fieldInput,
                          isMultilineFieldKey(f.key) ? styles.fieldInputMultiline : null,
                          {
                            color: colors.text,
                            borderColor: colors.outline,
                            backgroundColor: colors.surface,
                          },
                        ]}
                        editable={!committing}
                        multiline={isMultilineFieldKey(f.key)}
                        keyboardType={isNumericFieldKey(f.key) ? 'decimal-pad' : 'default'}
                        accessibilityLabel={`编辑 ${f.label}`}
                        blurOnSubmit={false}
                      />
                    )
                  ) : (
                    <Text
                      style={[styles.fieldValue, { color: colors.text }]}
                      numberOfLines={isMultilineFieldKey(f.key) ? 6 : 2}>
                      {fieldValue(f) || '—'}
                    </Text>
                  )}
                </View>
              );
            })}
          </View>
        )
      ) : null}

      {statusText ? (
        <Text
          style={[
            styles.status,
            {
              color:
                writeStatus === 'failed'
                  ? colors.danger
                  : writeStatus === 'succeeded'
                    ? colors.primary
                    : colors.textMuted,
            },
          ]}
          // 失败原因可能较长，聊天内需完整展示；成功/进行中仍限 3 行
          numberOfLines={writeStatus === 'failed' ? undefined : 3}
          selectable={writeStatus === 'failed'}>
          {statusText}
        </Text>
      ) : null}

      {clarifyChoices.length && onClarifyChoice ? (
        <View style={styles.choiceWrap}>
          {clarifyChoices.map(choice => (
            <AppButton
              key={choice}
              label={choice}
              size="sm"
              variant="secondary"
              disabled={Boolean(busy)}
              onPress={() => onClarifyChoice(card, choice)}
              accessibilityLabel={`选择：${choice}`}
              style={styles.choiceBtn}
            />
          ))}
        </View>
      ) : null}

      {canAct && onConfirm ? (
        isCommit ? (
          <View style={styles.btnRow}>
            {onCancel ? (
              <AppButton
                label="取消"
                size="sm"
                variant="ghost"
                disabled={committing}
                onPress={() => onCancel(card)}
                accessibilityLabel={`取消：${card.title}`}
                style={styles.btnFlex}
              />
            ) : null}
            <AppButton
              label={
                writeStatus === 'failed'
                  ? '重试'
                  : card.intent === 'delete' ||
                      (card.confirm_action || card.commit_action || '').includes('_delete')
                    ? '确认删除'
                    : '确认保存'
              }
              size="sm"
              variant="primary"
              loading={committing}
              disabled={committing}
              onPress={handleConfirm}
              accessibilityLabel={
                writeStatus === 'failed'
                  ? `重试：${card.title}`
                  : card.intent === 'delete' ||
                      (card.confirm_action || card.commit_action || '').includes('_delete')
                    ? `确认删除：${card.title}`
                    : `确认保存：${card.title}`
              }
              style={styles.btnFlex}
            />
          </View>
        ) : (
          <AppButton
            label={card.needs_confirm ? '确认' : '打开'}
            size="sm"
            variant={card.needs_confirm ? 'primary' : 'secondary'}
            loading={busy}
            disabled={busy}
            onPress={handleConfirm}
            accessibilityLabel={card.needs_confirm ? `确认：${card.title}` : `打开：${card.title}`}
            style={styles.cardBtn}
          />
        )
      ) : null}

      <Modal
        visible={Boolean(categoryPicker)}
        transparent
        animationType="fade"
        onRequestClose={() => setCategoryPicker(null)}>
        <View style={styles.pickerBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setCategoryPicker(null)}
            accessibilityLabel="关闭分类选择"
          />
          <View
            style={[
              styles.pickerSheet,
              { backgroundColor: colors.surface, borderColor: colors.outline },
            ]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>选择目标分类</Text>
            <Text style={[styles.pickerHint, { color: colors.textMuted }]}>
              仅可选择现有分类，不会新建
            </Text>
            <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
              {(categoryPicker?.options ?? []).map(opt => {
                const selected =
                  (fields.find(f => f.key === (categoryPicker?.fieldKey || ''))?.value || '')
                    .trim()
                    .toLowerCase() === opt.name.trim().toLowerCase();
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() => applyCategory(opt)}
                    style={({ pressed }) => [
                      styles.pickerRow,
                      {
                        borderColor: colors.outline,
                        backgroundColor: selected ? colors.surfaceMuted : colors.surface,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`选择分类 ${opt.name}`}>
                    <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22 }}>
                      {opt.name}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>
            <AppButton
              label="取消"
              size="sm"
              variant="ghost"
              onPress={() => setCategoryPicker(null)}
              accessibilityLabel="取消选择分类"
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
    alignSelf: 'stretch',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 20,
  },
  cardSummary: {
    fontSize: 13,
    lineHeight: 18,
  },
  insightScroll: {
    maxHeight: 280,
    marginTop: 2,
  },
  fields: {
    gap: 6,
    marginTop: 2,
    minWidth: 0,
  },
  fieldRow: {
    gap: 2,
    minWidth: 0,
  },
  fieldLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  fieldValue: {
    fontSize: 13,
    lineHeight: 18,
    flexShrink: 1,
  },
  fieldInput: {
    fontSize: 13,
    lineHeight: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 32,
    maxWidth: '100%',
  },
  fieldInputMultiline: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  fieldSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  status: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  btnFlex: {
    flex: 1,
  },
  cardBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
  },
  choiceWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
    maxWidth: '100%',
  },
  choiceBtn: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    padding: Spacing['3xl'],
  },
  pickerSheet: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
    gap: Spacing.md,
    maxHeight: '70%',
  },
  pickerTitle: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
  },
  pickerHint: {
    fontSize: 12,
    lineHeight: 16,
  },
  pickerList: {
    maxHeight: 320,
  },
  pickerRow: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
  },
});
