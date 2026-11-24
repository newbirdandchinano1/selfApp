import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Image as ExpoImage } from 'expo-image';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionConfirmCard } from '@/components/assistant/chat/action-confirm-card';
import { AgentThinkingIndicator } from '@/components/assistant/chat/agent-thinking-indicator';
import { StreamingCursor } from '@/components/assistant/chat/streaming-cursor';
import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { appFonts } from '@/constants/app-fonts';
import { useAppTheme } from '@/hooks/use-app-theme';
import { toast } from '@/lib/app-feedback';
import type { ActionCard } from '@/lib/assistant/action-card';
import type { AgentThinkingState } from '@/lib/assistant/agent-thinking-status';
import { shouldShowThinkingOrb } from '@/lib/assistant/agent-thinking-status';
import { ChatMarkdownText } from '@/lib/assistant/chat-markdown';
import {
  textFromParts,
  type ChatAnswerMeta,
  type ChatMessage,
  type ChatMessagePart,
  type ChatSourceLabel,
} from '@/lib/assistant/chat-types';

function formatBubbleClock(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

const SOURCE_CHIP_LABEL: Record<string, string> = {
  backend: '业务数据',
  brief_context: 'App 摘要',
  knowledge_base: '官方知识库',
  capability_registry: '能力清单',
  web: '外部网页',
  execution_result: '写入回执',
  model_generated: '模型生成',
  unofficial: '非官方说明',
  system: '系统',
};

/** 确认卡渲染异常时不拖垮整条气泡（否则只剩正文/工具条，像「卡消失了」） */
class ConfirmCardErrorBoundary extends React.Component<
  { cardTitle?: string; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.warn('[assistant] ActionConfirmCard render failed', error);
  }

  render() {
    if (this.state.failed) {
      return (
        <View style={styles.cardErrorBox}>
          <Text style={styles.cardErrorText}>
            确认卡「{this.props.cardTitle || '操作'}」显示异常。请再发一次同样请求，或到对应页面手动操作。
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

function MetaChip({
  label,
  danger,
  accent,
  /** 工具失败等长文：铺满气泡宽、不截行，便于读完整报错 */
  full,
}: {
  label: string;
  danger?: boolean;
  accent?: boolean;
  full?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.chip,
        full ? styles.chipFull : null,
        {
          backgroundColor: danger
            ? 'rgba(180,40,40,0.08)'
            : accent
              ? 'rgba(180,120,20,0.12)'
              : colors.surfaceMuted,
          borderColor: accent ? 'rgba(160,110,20,0.35)' : colors.outline,
        },
      ]}>
      <Text
        style={[
          styles.chipText,
          full ? styles.chipTextFull : null,
          { color: danger ? colors.danger : accent ? '#8a5a10' : colors.textMuted },
        ]}
        numberOfLines={full ? undefined : 2}
        selectable={Boolean(full)}>
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
      const failed = p.ok === false;
      const nameHint = p.toolName?.trim() ? `${p.toolName} · ` : '';
      return (
        <MetaChip
          key={`tool-${idx}`}
          label={`${failed ? '工具失败' : '已查询'} · ${nameHint}${p.summary}`}
          danger={failed}
          full={failed}
        />
      );
    });
}

function renderSourceLabels(labels: ChatSourceLabel[] | undefined) {
  if (!labels?.length) return null;
  // 非官方单独用下方卡片；来源条不重复塞「非官方说明」
  const visible = labels.filter(l => l.source !== 'unofficial');
  if (!visible.length) return null;
  return visible.map((l, idx) => (
    <MetaChip
      key={`src-${l.source}-${idx}`}
      label={`来源 · ${SOURCE_CHIP_LABEL[l.source] || l.span}`}
      accent={l.source === 'web'}
    />
  ));
}

function UnofficialAdviceBlock({ text }: { text: string }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={[
        styles.unofficialBox,
        {
          backgroundColor: 'rgba(180,120,20,0.08)',
          borderColor: 'rgba(160,110,20,0.35)',
        },
      ]}>
      <Text style={[styles.unofficialBadge, { color: '#8a5a10' }]}>非官方说明</Text>
      <Text style={[styles.unofficialText, { color: colors.text }]} selectable>
        {text}
      </Text>
    </View>
  );
}

function AnswerStatusHint({ status }: { status?: string }) {
  if (!status || status === 'answered') return null;
  const label =
    status === 'refused' ? '已拒答（无充分依据）' : status === 'partial' ? '部分依据' : null;
  if (!label) return null;
  return <MetaChip label={label} danger={status === 'refused'} accent={status === 'partial'} />;
}

function ChatBubbleImpl({
  message,
  confirmingCardId,
  onConfirmCard,
  onCancelCard,
  onDraftFieldChange,
  onClarifyChoice,
  onDraftFieldFocus,
  thinking,
}: {
  message: ChatMessage;
  confirmingCardId?: string | null;
  onConfirmCard?: (card: ActionCard) => void;
  onCancelCard?: (card: ActionCard) => void;
  onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
  onClarifyChoice?: (card: ActionCard, choice: string) => void;
  onDraftFieldFocus?: () => void;
  thinking?: AgentThinkingState | null;
}) {
  const { colors } = useAppTheme();
  const isUser = message.role === 'user';
  const text = textFromParts(message.parts);
  const imagePart = message.parts.find(p => p.type === 'image');
  const actionCards = message.parts.filter(
    (p): p is Extract<ChatMessagePart, { type: 'action_card' }> =>
      p.type === 'action_card' && Boolean(p.card && typeof p.card === 'object'),
  );
  const pending = message.status === 'sending' || message.status === 'streaming';
  const errored = message.status === 'error';
  const answerMeta: ChatAnswerMeta | undefined = !isUser ? message.meta : undefined;
  const toolMeta = !isUser ? renderMetaParts(message.parts) : null;
  const sourceMeta = !isUser ? renderSourceLabels(answerMeta?.source_labels) : null;
  const showStatusHint =
    !isUser &&
    Boolean(
      answerMeta?.answer_status &&
        answerMeta.answer_status !== 'answered',
    );
  const unofficial =
    !isUser && answerMeta?.unofficial_advice?.trim()
      ? answerMeta.unofficial_advice.trim()
      : '';
  const hasTopMeta =
    Boolean(toolMeta && toolMeta.length) ||
    Boolean(sourceMeta && sourceMeta.length) ||
    showStatusHint;
  const showThinking =
    !isUser && pending && shouldShowThinkingOrb(thinking, Boolean(text.trim()));

  // 无 thinking 对象时（边缘态）也立刻出三点气泡
  const showFallbackTyping = !isUser && pending && !text.trim() && !showThinking;
  const canCopy = !isUser && !pending && Boolean(text.trim());
  const [copied, setCopied] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const onCopyAnswer = useCallback(async () => {
    const payload = unofficial ? `${text.trim()}\n\n非官方说明\n${unofficial}` : text.trim();
    if (!payload) return;
    try {
      await Clipboard.setStringAsync(payload);
      setCopied(true);
      toast.success('已复制回答');
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error('复制失败');
    }
  }, [text, unofficial]);

  const roleMeta = `${isUser ? 'YOU' : 'AGENT'} · ${formatBubbleClock(message.createdAt)}`;

  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View style={[styles.col, !isUser && styles.colAssistant]}>
        <View
          style={[
            styles.bubble,
            isUser
              ? {
                  backgroundColor: colors.primary,
                  borderBottomRightRadius: 5,
                  shadowColor: colors.primary,
                  shadowOpacity: 0.12,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 2,
                }
              : {
                  backgroundColor: colors.surface,
                  borderColor: colors.outline,
                  borderWidth: StyleSheet.hairlineWidth,
                  borderBottomLeftRadius: 5,
                  shadowColor: colors.primary,
                  shadowOpacity: 0.04,
                  shadowRadius: 10,
                  shadowOffset: { width: 0, height: 4 },
                  elevation: 1,
                },
          ]}>
          <Text
            style={[
              styles.roleMeta,
              { color: isUser ? 'rgba(255,255,255,0.62)' : colors.textMuted },
            ]}>
            {roleMeta}
          </Text>
          {hasTopMeta ? (
            <View style={styles.metaCol}>
              {showStatusHint ? (
                <AnswerStatusHint status={answerMeta?.answer_status} />
              ) : null}
              {sourceMeta}
              {toolMeta}
            </View>
          ) : null}
          {imagePart && imagePart.type === 'image' ? (
            <Pressable
              onPress={() => setImagePreviewOpen(true)}
              accessibilityRole="imagebutton"
              accessibilityLabel="查看大图">
              <Image source={{ uri: imagePart.uri }} style={styles.image} resizeMode="cover" />
            </Pressable>
          ) : null}
          {showThinking && thinking ? <AgentThinkingIndicator state={thinking} /> : null}
          {showFallbackTyping ? (
            <AgentThinkingIndicator
              state={{
                phase: 'thinking',
                label: hasTopMeta ? '正在整理回答…' : '正在思考…',
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
          {unofficial ? <UnofficialAdviceBlock text={unofficial} /> : null}
          {!isUser && actionCards.length > 0
            ? actionCards.map(({ card }) => (
                <ConfirmCardErrorBoundary
                  key={card.operation_id || card.id}
                  cardTitle={typeof card.title === 'string' ? card.title : undefined}>
                  <ActionConfirmCard
                    card={card}
                    busy={
                      confirmingCardId === card.id ||
                      confirmingCardId === card.operation_id ||
                      card.write_status === 'committing'
                    }
                    onConfirm={onConfirmCard}
                    onCancel={onCancelCard}
                    onDraftFieldChange={onDraftFieldChange}
                    onClarifyChoice={onClarifyChoice}
                    onDraftFieldFocus={onDraftFieldFocus}
                  />
                </ConfirmCardErrorBoundary>
              ))
            : null}
        </View>
        {canCopy ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="复制回答"
            hitSlop={8}
            onPress={() => void onCopyAnswer()}
            style={({ pressed }) => [
              styles.copyBtn,
              {
                borderColor: colors.outline,
                backgroundColor: colors.surfaceMuted,
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <MaterialIcons
              name={copied ? 'check' : 'content-copy'}
              size={14}
              color={copied ? colors.primary : colors.textMuted}
            />
            <Text
              style={[
                styles.copyBtnText,
                { color: copied ? colors.primary : colors.textMuted },
              ]}>
              {copied ? '已复制' : '复制'}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {imagePart && imagePart.type === 'image' ? (
        <Modal
          visible={imagePreviewOpen}
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={() => setImagePreviewOpen(false)}>
          <View style={styles.lightboxRoot}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setImagePreviewOpen(false)}
              accessibilityLabel="关闭大图"
            />
            <ExpoImage
              source={{ uri: imagePart.uri }}
              style={{ width: winW, height: winH * 0.82 }}
              contentFit="contain"
            />
            <Pressable
              onPress={() => setImagePreviewOpen(false)}
              hitSlop={12}
              accessibilityLabel="关闭"
              style={({ pressed }) => [
                styles.lightboxClose,
                { top: Math.max(12, insets.top + 8), opacity: pressed ? 0.7 : 1 },
              ]}>
              <MaterialIcons name="close" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </Modal>
      ) : null}
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
    onClarifyChoice?: (card: ActionCard, choice: string) => void;
    onDraftFieldFocus?: () => void;
    thinking?: AgentThinkingState | null;
  }>,
  next: Readonly<{
    message: ChatMessage;
    confirmingCardId?: string | null;
    onConfirmCard?: (card: ActionCard) => void;
    onCancelCard?: (card: ActionCard) => void;
    onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
    onClarifyChoice?: (card: ActionCard, choice: string) => void;
    onDraftFieldFocus?: () => void;
    thinking?: AgentThinkingState | null;
  }>,
): boolean {
  if (prev.message !== next.message) {
    if (
      prev.message.id !== next.message.id ||
      prev.message.status !== next.message.status ||
      prev.message.parts !== next.message.parts ||
      prev.message.meta !== next.message.meta
    ) {
      return false;
    }
  }
  if (prev.confirmingCardId !== next.confirmingCardId) return false;
  if (prev.onConfirmCard !== next.onConfirmCard) return false;
  if (prev.onCancelCard !== next.onCancelCard) return false;
  if (prev.onClarifyChoice !== next.onClarifyChoice) return false;
  if (prev.onDraftFieldChange !== next.onDraftFieldChange) return false;
  if (prev.onDraftFieldFocus !== next.onDraftFieldFocus) return false;
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
  col: {
    maxWidth: '86%',
    minWidth: 0,
    flexShrink: 1,
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  // 助手气泡拉满可用宽度（仍受 maxWidth 86% 约束），避免确认卡/长字段把气泡撑破
  colAssistant: {
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },
  bubble: {
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: Spacing.sm,
  },
  roleMeta: {
    fontFamily: appFonts.mono,
    fontSize: 9,
    letterSpacing: 0.4,
    marginBottom: 2,
  },
  copyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  copyBtnText: {
    fontSize: 12,
    lineHeight: 16,
  },

  text: {
    ...Typography.body,
    fontSize: 13,
    lineHeight: 22,
  },
  image: {
    width: 180,
    height: 140,
    borderRadius: Radius.sm,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  lightboxRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  lightboxClose: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaCol: {
    gap: 6,
    marginBottom: 2,
  },
  cardErrorBox: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(180,40,40,0.35)',
    backgroundColor: 'rgba(180,40,40,0.08)',
  },
  cardErrorText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#8a3030',
  },
  chip: {
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  chipFull: {
    alignSelf: 'stretch',
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 12,
    lineHeight: 16,
  },
  chipTextFull: {
    lineHeight: 18,
  },
  unofficialBox: {
    marginTop: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  unofficialBadge: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  unofficialText: {
    ...Typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
});
