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
  formatWishTypeLabel,
  isMemoTagSelectFieldKey,
  isMultilineFieldKey,
  isNumericFieldKey,
  isSelectFieldKey,
  isWishTypeSelectFieldKey,
  WISH_TYPE_SELECT_OPTIONS,
} from '@/lib/assistant/confirm-card-fields';
import { formatSyncStatusLabel } from '@/lib/assistant/commit-result';
import {
  deriveDraftFields,
  isCommitConfirmAction,
  type DraftField,
} from '@/lib/assistant/write-operation';

type CategoryOption = { id: string; name: string };

type ListPickerState =
  | { kind: 'recipe_category'; fieldKey: string; options: CategoryOption[] }
  | {
      kind: 'memo_tags';
      fieldKey: string;
      options: CategoryOption[];
      selectedIds: string[];
    }
  | {
      kind: 'wish_type';
      fieldKey: string;
      options: CategoryOption[];
    };

function splitDraftList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map(x => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
      .filter(Boolean);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/[,，、]/)
      .map(s => s.trim())
      .filter(Boolean);
  }
  return [];
}

function resolveMemoTagIdsFromDraft(
  draft: Record<string, unknown> | undefined,
  displayNames: string,
  options: CategoryOption[],
): string[] {
  const byId = new Map(options.map(o => [o.id, o]));
  const byName = new Map(options.map(o => [o.name.trim().toLowerCase(), o.id]));
  const out: string[] = [];
  const push = (id: string) => {
    if (byId.has(id) && !out.includes(id)) out.push(id);
  };

  for (const id of splitDraftList(draft?.tagIds ?? draft?.tag_ids)) push(id);

  const names = displayNames.trim()
    ? splitDraftList(displayNames)
    : splitDraftList(draft?.tag_names ?? draft?.tags ?? draft?.tag_name);
  for (const name of names) {
    const id = byName.get(name.toLowerCase());
    if (id) push(id);
  }
  return out;
}

/** RN Text 只能吃 string/number；对象/数组会直接炸组件树。 */
function safeText(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (v == null) return fallback;
  return fallback;
}

/** 列表 insight 偶发复用同一 key；渲染前补后缀，避免 React duplicate key。 */
function uniqueInsightFields(
  raw: { key?: string; label?: string; value?: unknown; input?: string }[] | undefined,
): DraftField[] {
  const seen = new Map<string, number>();
  return (raw ?? []).map(f => {
    const base = safeText(f.key, 'field') || 'field';
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return {
      key: n === 0 ? base : `${base}__${n}`,
      label: safeText(f.label, safeText(f.key, '字段')),
      value: safeText(f.value),
      editable: false,
      input: f.input === 'select' ? 'select' : undefined,
    };
  });
}

export type ActionConfirmCardProps = {
  card: ActionCard;
  busy?: boolean;
  onConfirm?: (card: ActionCard) => void;
  onCancel?: (card: ActionCard) => void;
  onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
  /** 澄清卡选项点击（回投下一轮） */
  onClarifyChoice?: (card: ActionCard, choice: string) => void;
  /** 卡内输入框获得焦点：聊天列表据此滚入可视区，避免被输入法挡住 */
  onDraftFieldFocus?: () => void;
};

function statusLabel(card: ActionCard): string | null {
  switch (card.write_status) {
    case 'committing':
      return '正在保存…';
    case 'succeeded': {
      const custom = safeText(card.result?.message).trim();
      const sync = formatSyncStatusLabel(card.result?.sync_status);
      if (custom && /同步|已保存/.test(custom)) return custom;
      if (custom) return `${custom}${custom.endsWith('。') ? '' : '。'}${sync}`;
      return sync || '已保存';
    }
    case 'failed':
      return safeText(card.error?.message).trim() || '保存失败';
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
  onDraftFieldFocus,
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
    card.intent === 'clarify' || Boolean(safeText(card.clarify_question).trim())
      ? (card.clarify_choices ?? [])
          .map(c => safeText(c).trim())
          .filter(Boolean)
          .slice(0, 8)
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
    : uniqueInsightFields(card.draft_fields);
  const isInsightDisplay =
    !isCommit && (card.intent === 'insight' || (!canAct && fields.length > 0));
  const statusText = statusLabel(card);
  const cardTitle = safeText(card.title, '助手建议');
  const cardSummary = safeText(card.summary).trim();
  const clarifyQuestion = safeText(card.clarify_question).trim();
  const [listPicker, setListPicker] = React.useState<ListPickerState | null>(null);
  /** 文本编辑用本地态，避免每键 setSession 导致输入法被顶掉 */
  const [localValues, setLocalValues] = React.useState<Record<string, string>>({});
  const cardOpId = card.operation_id || card.idempotency_key || card.id;

  React.useEffect(() => {
    setLocalValues({});
  }, [cardOpId]);

  const fieldValue = React.useCallback(
    (f: DraftField) => {
      const raw =
        localValues[f.key] !== undefined ? localValues[f.key] : safeText(f.value);
      if (isWishTypeSelectFieldKey(f.key, confirmAction)) {
        return formatWishTypeLabel(raw);
      }
      return raw;
    },
    [confirmAction, localValues],
  );

  const flushLocalToDraft = React.useCallback((): ActionCard => {
    const draft = { ...(card.draft ?? {}) };
    for (const [key, value] of Object.entries(localValues)) {
      draft[key] = value;
      onDraftFieldChange?.(card, key, value);
    }
    return { ...card, draft };
  }, [card, localValues, onDraftFieldChange]);

  const pickSelectField = React.useCallback(
    async (fieldKey: string) => {
      if (!onDraftFieldChange) return;
      try {
        if (isWishTypeSelectFieldKey(fieldKey, confirmAction)) {
          setListPicker({
            kind: 'wish_type',
            fieldKey,
            options: WISH_TYPE_SELECT_OPTIONS.map(o => ({ id: o.id, name: o.name })),
          });
          return;
        }
        if (isMemoTagSelectFieldKey(fieldKey, confirmAction)) {
          const { getMemoTags } = await import('@/lib/repositories/tags/tag');
          const tags = await getMemoTags();
          if (!tags.length) {
            toast.info('还没有备忘标签，请先在「标签管理」里新建');
            return;
          }
          const options = tags.map(t => ({ id: t.id, name: t.name }));
          const display =
            localValues[fieldKey] !== undefined
              ? localValues[fieldKey]
              : safeText(
                  fields.find(f => f.key === fieldKey)?.value ?? card.draft?.tag_names,
                );
          setListPicker({
            kind: 'memo_tags',
            fieldKey,
            options,
            selectedIds: resolveMemoTagIdsFromDraft(card.draft, display, options),
          });
          return;
        }
        const { listRecipeCategories } = await import('@/lib/recipes');
        const cats = await listRecipeCategories();
        if (!cats.length) {
          toast.info('还没有菜谱分类，请先在「我的菜谱」里新建');
          return;
        }
        setListPicker({
          kind: 'recipe_category',
          fieldKey,
          options: cats.map(c => ({ id: c.id, name: c.name })),
        });
      } catch (e) {
        toast.error(
          e instanceof Error
            ? e.message
            : isMemoTagSelectFieldKey(fieldKey, confirmAction)
              ? '加载标签失败'
              : isWishTypeSelectFieldKey(fieldKey, confirmAction)
                ? '加载类型失败'
                : '加载分类失败',
        );
      }
    },
    [card.draft, confirmAction, fields, localValues, onDraftFieldChange],
  );

  const applyCategory = React.useCallback(
    (opt: CategoryOption) => {
      if (!onDraftFieldChange || listPicker?.kind !== 'recipe_category') return;
      const fieldKey = listPicker.fieldKey;
      setLocalValues(prev => ({ ...prev, [fieldKey]: opt.name }));
      onDraftFieldChange(card, fieldKey, opt.name);
      onDraftFieldChange(card, 'category_id', opt.id);
      if (fieldKey !== 'category_hint') {
        onDraftFieldChange(card, 'category_hint', opt.name);
      }
      setListPicker(null);
    },
    [card, listPicker, onDraftFieldChange],
  );

  const applyWishType = React.useCallback(
    (opt: CategoryOption) => {
      if (!onDraftFieldChange || listPicker?.kind !== 'wish_type') return;
      const fieldKey = listPicker.fieldKey;
      // draft 存 once/repeat；展示层再转中文
      setLocalValues(prev => ({ ...prev, [fieldKey]: opt.id }));
      onDraftFieldChange(card, fieldKey, opt.id);
      onDraftFieldChange(card, 'wish_type', opt.id);
      onDraftFieldChange(card, 'type', opt.id);
      setListPicker(null);
    },
    [card, listPicker, onDraftFieldChange],
  );

  const toggleMemoTagOption = React.useCallback((tagId: string) => {
    setListPicker(prev => {
      if (!prev || prev.kind !== 'memo_tags') return prev;
      const selectedIds = prev.selectedIds.includes(tagId)
        ? prev.selectedIds.filter(id => id !== tagId)
        : [...prev.selectedIds, tagId];
      return { ...prev, selectedIds };
    });
  }, []);

  const applyMemoTags = React.useCallback(() => {
    if (!onDraftFieldChange || listPicker?.kind !== 'memo_tags') return;
    const { fieldKey, options, selectedIds } = listPicker;
    const selected = options.filter(o => selectedIds.includes(o.id));
    const names = selected.map(o => o.name).join('、');
    const ids = selected.map(o => o.id).join(',');
    setLocalValues(prev => ({ ...prev, [fieldKey]: names }));
    onDraftFieldChange(card, fieldKey, names);
    onDraftFieldChange(card, 'tag_names', names);
    onDraftFieldChange(card, 'tagIds', ids);
    onDraftFieldChange(card, 'tag_ids', ids);
    onDraftFieldChange(card, 'new_tag_names', '');
    setListPicker(null);
  }, [card, listPicker, onDraftFieldChange]);

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
        {cardTitle}
      </Text>
      {cardSummary ? (
        <Text
          style={[styles.cardSummary, { color: colors.textMuted }]}
          numberOfLines={isInsightDisplay ? 6 : 3}
          selectable={isInsightDisplay}>
          {cardSummary}
        </Text>
      ) : null}
      {clarifyQuestion ? (
        <Text style={[styles.cardSummary, { color: colors.textMuted }]} numberOfLines={3}>
          {clarifyQuestion}
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
                        onPress={() => void pickSelectField(f.key)}
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
                          {fieldValue(f).trim() ||
                            (isWishTypeSelectFieldKey(f.key, confirmAction)
                              ? '点击选择类型'
                              : isMemoTagSelectFieldKey(f.key, confirmAction)
                                ? '点击选择现有标签'
                                : '点击选择现有分类')}
                        </Text>
                        <Text style={{ color: colors.textMuted, fontSize: 12 }}>
                          {fieldValue(f).trim() ? '更换' : '选择'}
                        </Text>
                      </Pressable>
                    ) : (
                      <TextInput
                        value={fieldValue(f)}
                        onChangeText={v =>
                          setLocalValues(prev => ({ ...prev, [f.key]: v }))
                        }
                        onFocus={() => {
                          onDraftFieldFocus?.();
                        }}
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
                        placeholder={
                          f.key === 'title'
                            ? '可选标题'
                            : isMultilineFieldKey(f.key)
                              ? '填写正文'
                              : undefined
                        }
                        placeholderTextColor={colors.textMuted}
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

      {clarifyChoices.length > 0 && onClarifyChoice ? (
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
                accessibilityLabel={`取消：${cardTitle}`}
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
                  ? `重试：${cardTitle}`
                  : card.intent === 'delete' ||
                      (card.confirm_action || card.commit_action || '').includes('_delete')
                    ? `确认删除：${cardTitle}`
                    : `确认保存：${cardTitle}`
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
            accessibilityLabel={card.needs_confirm ? `确认：${cardTitle}` : `打开：${cardTitle}`}
            style={styles.cardBtn}
          />
        )
      ) : null}

      <Modal
        visible={Boolean(listPicker)}
        transparent
        animationType="fade"
        onRequestClose={() => setListPicker(null)}>
        <View style={styles.pickerBackdrop}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setListPicker(null)}
            accessibilityLabel={
              listPicker?.kind === 'memo_tags'
                ? '关闭标签选择'
                : listPicker?.kind === 'wish_type'
                  ? '关闭类型选择'
                  : '关闭分类选择'
            }
          />
          <View
            style={[
              styles.pickerSheet,
              { backgroundColor: colors.surface, borderColor: colors.outline },
            ]}>
            <Text style={[styles.pickerTitle, { color: colors.text }]}>
              {listPicker?.kind === 'memo_tags'
                ? '选择备忘标签'
                : listPicker?.kind === 'wish_type'
                  ? '选择心愿类型'
                  : '选择目标分类'}
            </Text>
            <Text style={[styles.pickerHint, { color: colors.textMuted }]}>
              {listPicker?.kind === 'memo_tags'
                ? '仅可选择现有标签（可多选），不会新建'
                : listPicker?.kind === 'wish_type'
                  ? '一次性兑完即结束；可重复可多次兑换'
                  : '仅可选择现有分类，不会新建'}
            </Text>
            <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
              {(listPicker?.options ?? []).map(opt => {
                const fieldKey = listPicker?.fieldKey || '';
                const rawSelected =
                  localValues[fieldKey] !== undefined
                    ? localValues[fieldKey]
                    : fields.find(f => f.key === fieldKey)?.value || '';
                const selected =
                  listPicker?.kind === 'memo_tags'
                    ? listPicker.selectedIds.includes(opt.id)
                    : listPicker?.kind === 'wish_type'
                      ? formatWishTypeLabel(rawSelected) === opt.name ||
                        String(rawSelected).trim().toLowerCase() === opt.id
                      : String(rawSelected).trim().toLowerCase() ===
                          opt.name.trim().toLowerCase();
                return (
                  <Pressable
                    key={opt.id}
                    onPress={() =>
                      listPicker?.kind === 'memo_tags'
                        ? toggleMemoTagOption(opt.id)
                        : listPicker?.kind === 'wish_type'
                          ? applyWishType(opt)
                          : applyCategory(opt)
                    }
                    style={({ pressed }) => [
                      styles.pickerRow,
                      {
                        borderColor: colors.outline,
                        backgroundColor: selected ? colors.surfaceMuted : colors.surface,
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={
                      listPicker?.kind === 'memo_tags'
                        ? `${selected ? '取消' : '选择'}标签 ${opt.name}`
                        : listPicker?.kind === 'wish_type'
                          ? `选择类型 ${opt.name}`
                          : `选择分类 ${opt.name}`
                    }>
                    <Text style={{ color: colors.text, fontSize: 15, lineHeight: 22, flex: 1 }}>
                      {opt.name}
                      {listPicker?.kind === 'wish_type'
                        ? ` · ${
                            WISH_TYPE_SELECT_OPTIONS.find(o => o.id === opt.id)?.hint ?? ''
                          }`
                        : ''}
                    </Text>
                    {listPicker?.kind === 'memo_tags' ? (
                      <Text style={{ color: colors.primary, fontSize: 13 }}>
                        {selected ? '已选' : ''}
                      </Text>
                    ) : listPicker?.kind === 'wish_type' && selected ? (
                      <Text style={{ color: colors.primary, fontSize: 13 }}>已选</Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            {listPicker?.kind === 'memo_tags' ? (
              <View style={styles.btnRow}>
                <AppButton
                  label="取消"
                  size="sm"
                  variant="ghost"
                  onPress={() => setListPicker(null)}
                  accessibilityLabel="取消选择标签"
                  style={styles.btnFlex}
                />
                <AppButton
                  label="完成"
                  size="sm"
                  variant="primary"
                  onPress={applyMemoTags}
                  accessibilityLabel="完成标签选择"
                  style={styles.btnFlex}
                />
              </View>
            ) : (
              <AppButton
                label="取消"
                size="sm"
                variant="ghost"
                onPress={() => setListPicker(null)}
                accessibilityLabel={
                  listPicker?.kind === 'wish_type' ? '取消选择类型' : '取消选择分类'
                }
              />
            )}
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
