import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { ActionConfirmCard } from '@/components/assistant/chat/action-confirm-card';
import { AgentThinkingIndicator } from '@/components/assistant/chat/agent-thinking-indicator';
import { StreamingCursor } from '@/components/assistant/chat/streaming-cursor';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ActionCard } from '@/lib/assistant/action-card';
import type { AgentThinkingState } from '@/lib/assistant/agent-thinking-status';
import { shouldShowThinkingOrb } from '@/lib/assistant/agent-thinking-status';
import { ChatMarkdownText } from '@/lib/assistant/chat-markdown';
import { textFromParts, type ChatMessage, type ChatMessagePart } from '@/lib/assistant/chat-types';

function MetaChip({
  label,
  danger,
}: {
  label: string;
  danger?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.chip,
        {
          backgroundColor: danger ? 'rgba(180,40,40,0.08)' : colors.surfaceMuted,
          borderColor: colors.outline,
        },
      ]}>
      <Text
        style={[styles.chipText, { color: danger ? colors.danger : colors.textMuted }]}
        numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function renderMetaParts(parts: ChatMessagePart[]) {
  return parts
    .filter(p => p.type === 'tool_result' || p.type === 'kb_hits')
    .map((p, idx) => {
      if (p.type === 'kb_hits') {
        return <MetaChip key={`kb-${idx}`} label={`知识库 · ${p.summary}`} />;
      }
      return (
        <MetaChip
          key={`tool-${idx}`}
          label={`${p.ok === false ? '工具失败' : '已查询'} · ${p.summary}`}
          danger={p.ok === false}
        />
      );
    });
}

function ChatBubbleImpl({
  message,
  confirmingCardId,
  onConfirmCard,
  onCancelCard,
  onDraftFieldChange,
  thinking,
}: {
  message: ChatMessage;
  confirmingCardId?: string | null;
  onConfirmCard?: (card: ActionCard) => void;
  onCancelCard?: (card: ActionCard) => void;
  onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
  thinking?: AgentThinkingState | null;
}) {
  const { colors } = useAppTheme();
  const isUser = message.role === 'user';
  const text = textFromParts(message.parts);
  const imagePart = message.parts.find(p => p.type === 'image');
  const actionCards = message.parts.filter(
    (p): p is Extract<ChatMessagePart, { type: 'action_card' }> => p.type === 'action_card',
  );
  const pending = message.status === 'sending' || message.status === 'streaming';
  const errored = message.status === 'error';
  const meta = !isUser ? renderMetaParts(message.parts) : null;
  const showThinking =
    !isUser && pending && shouldShowThinkingOrb(thinking, Boolean(text.trim()));

  // 无 thinking 对象时（边缘态）也立刻出三点气泡
  const showFallbackTyping = !isUser && pending && !text.trim() && !showThinking;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          isUser
            ? { backgroundColor: colors.primary, borderBottomRightRadius: 6 }
            : {
                backgroundColor: colors.surface,
                borderColor: colors.outline,
                borderWidth: StyleSheet.hairlineWidth,
                borderBottomLeftRadius: 6,
              },
        ]}>
        {meta && meta.length ? <View style={styles.metaCol}>{meta}</View> : null}
        {imagePart && imagePart.type === 'image' ? (
          <Image source={{ uri: imagePart.uri }} style={styles.image} resizeMode="cover" />
        ) : null}
        {showThinking && thinking ? <AgentThinkingIndicator state={thinking} /> : null}
        {showFallbackTyping ? (
          <AgentThinkingIndicator
            state={{
              phase: 'thinking',
              label: meta && meta.length ? '正在整理回答…' : '正在思考…',
              visual: 'calm',
            }}
          />
        ) : null}
        {text ? (
          isUser || errored ? (
            <Text
              style={[
                styles.text,
                { color: isUser ? colors.onPrimary : colors.text },
                errored && { color: colors.danger },
              ]}
              selectable>
              {text}
            </Text>
          ) : (
            <ChatMarkdownText
              text={text}
              color={colors.text}
              mutedColor={colors.textMuted}
              codeBg={colors.surfaceMuted}
              selectable
              trailing={pending ? <StreamingCursor color={colors.primarySoft} /> : null}
            />
          )
        ) : null}
        {!isUser && actionCards.length
          ? actionCards.map(({ card }) => (
              <ActionConfirmCard
                key={card.operation_id || card.id}
                card={card}
                busy={
                  confirmingCardId === card.id ||
                  confirmingCardId === card.operation_id ||
                  card.write_status === 'committing'
                }
                onConfirm={onConfirmCard}
                onCancel={onCancelCard}
                onDraftFieldChange={onDraftFieldChange}
              />
            ))
          : null}
      </View>
    </View>
  );
}

function bubblePropsEqual(
  prev: Readonly<{
    message: ChatMessage;
    confirmingCardId?: string | null;
    onConfirmCard?: (card: ActionCard) => void;
    onCancelCard?: (card: ActionCard) => void;
    onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
    thinking?: AgentThinkingState | null;
  }>,
  next: Readonly<{
    message: ChatMessage;
    confirmingCardId?: string | null;
    onConfirmCard?: (card: ActionCard) => void;
    onCancelCard?: (card: ActionCard) => void;
    onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
    thinking?: AgentThinkingState | null;
  }>,
): boolean {
  if (prev.message !== next.message) {
    if (
      prev.message.id !== next.message.id ||
      prev.message.status !== next.message.status ||
      prev.message.parts !== next.message.parts
    ) {
      return false;
    }
  }
  if (prev.confirmingCardId !== next.confirmingCardId) return false;
  if (prev.onConfirmCard !== next.onConfirmCard) return false;
  if (prev.onCancelCard !== next.onCancelCard) return false;
  if (prev.onDraftFieldChange !== next.onDraftFieldChange) return false;
  if (prev.thinking !== next.thinking) {
    if (
      prev.thinking?.phase !== next.thinking?.phase ||
      prev.thinking?.label !== next.thinking?.label
    ) {
      return false;
    }
  }
  return true;
}

export const ChatBubble = React.memo(ChatBubbleImpl, bubblePropsEqual);

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginBottom: Spacing.xl,
    paddingHorizontal: Spacing['5xl'],
  },
  rowUser: { alignItems: 'flex-end' },
  rowAssistant: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '86%',
    borderRadius: Radius.xl,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  text: {
    ...Typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  image: {
    width: 180,
    height: 140,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  metaCol: {
    gap: 6,
    marginBottom: 2,
  },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 16,
  },
});
