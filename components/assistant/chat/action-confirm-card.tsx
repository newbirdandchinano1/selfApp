/**
 * S9.2 ConfirmCard：draft_fields + 确认/取消双按钮 + write_status。
 * S9.7：分域字段模板（中文标签 / 金额数字键盘 / 正文多行）。
 * 可复用于任意域；preview_* 仍用单按钮兼容路径。
 */
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { AppButton } from '@/components/ui/app-button';
import { Radius, Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ActionCard } from '@/lib/assistant/action-card';
import {
  isMultilineFieldKey,
  isNumericFieldKey,
} from '@/lib/assistant/confirm-card-fields';
import { formatSyncStatusLabel } from '@/lib/assistant/commit-result';
import {
  deriveDraftFields,
  isCommitConfirmAction,
  type DraftField,
} from '@/lib/assistant/write-operation';

export type ActionConfirmCardProps = {
  card: ActionCard;
  busy?: boolean;
  onConfirm?: (card: ActionCard) => void;
  onCancel?: (card: ActionCard) => void;
  onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
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
}: ActionConfirmCardProps) {
  const { colors } = useAppTheme();
  const isCommit =
    isCommitConfirmAction(card.confirm_action) ||
    isCommitConfirmAction(card.commit_action);
  const writeStatus = card.write_status;
  const terminal =
    writeStatus === 'succeeded' || writeStatus === 'cancelled';
  const committing = writeStatus === 'committing' || busy;
  const canAct =
    Boolean(card.confirm_action || card.commit_action) &&
    card.intent !== 'clarify' &&
    !terminal;
  const fields: DraftField[] = isCommit
    ? deriveDraftFields(card.draft, card.draft_fields, {
        confirmAction: card.confirm_action || card.commit_action,
        domain: card.domain,
      })
    : [];
  const statusText = statusLabel(card);

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
        <Text style={[styles.cardSummary, { color: colors.textMuted }]} numberOfLines={3}>
          {card.summary}
        </Text>
      ) : null}
      {card.clarify_question ? (
        <Text style={[styles.cardSummary, { color: colors.textMuted }]} numberOfLines={3}>
          {card.clarify_question}
        </Text>
      ) : null}

      {fields.length ? (
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
                  <TextInput
                    value={f.value}
                    onChangeText={v => onDraftFieldChange(card, f.key, v)}
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
                  />
                ) : (
                  <Text style={[styles.fieldValue, { color: colors.text }]} numberOfLines={2}>
                    {f.value || '—'}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
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
          numberOfLines={3}>
          {statusText}
        </Text>
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
              label={writeStatus === 'failed' ? '重试' : '确认保存'}
              size="sm"
              variant="primary"
              loading={committing}
              disabled={committing}
              onPress={() => onConfirm(card)}
              accessibilityLabel={
                writeStatus === 'failed' ? `重试：${card.title}` : `确认保存：${card.title}`
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
            onPress={() => onConfirm(card)}
            accessibilityLabel={card.needs_confirm ? `确认：${card.title}` : `打开：${card.title}`}
            style={styles.cardBtn}
          />
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 6,
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
  fields: {
    gap: 6,
    marginTop: 2,
  },
  fieldRow: {
    gap: 2,
  },
  fieldLabel: {
    fontSize: 11,
    lineHeight: 14,
  },
  fieldValue: {
    fontSize: 13,
    lineHeight: 18,
  },
  fieldInput: {
    fontSize: 13,
    lineHeight: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 32,
  },
  fieldInputMultiline: {
    minHeight: 56,
    textAlignVertical: 'top',
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
});
