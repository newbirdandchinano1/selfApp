import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { AgentActivityLog } from '@/components/assistant/chat/agent-activity-log';
import { AgentHero } from '@/components/assistant/chat/agent-hero';
import { AgentSkillStrip } from '@/components/assistant/chat/agent-skill-strip';
import { AgentSkillsGrid } from '@/components/assistant/chat/agent-skills-grid';
import { ChatBubble } from '@/components/assistant/chat/chat-bubble';
import { Spacing } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ActionCard } from '@/lib/assistant/action-card';
import type { AgentThinkingState } from '@/lib/assistant/agent-thinking-status';
import type { AgentSkillPrompt } from '@/lib/assistant/agent-space-prompts';
import type { ChatMessage, ChatSessionSummary } from '@/lib/assistant/chat-types';

const NEAR_BOTTOM_PX = 96;

type Props = {
  messages: ChatMessage[];
  listRef?: React.RefObject<FlatList<ChatMessage> | null>;
  confirmingCardId?: string | null;
  onConfirmCard?: (card: ActionCard) => void;
  onCancelCard?: (card: ActionCard) => void;
  onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
  onClarifyChoice?: (card: ActionCard, choice: string) => void;
  streamingMessageId?: string | null;
  thinking?: AgentThinkingState | null;
  /** 外部可强制滚到底（发送后） */
  stickToBottomToken?: number;
  onSelectSkill?: (skill: AgentSkillPrompt) => void;
  skillsDisabled?: boolean;
  /** 空态「最近的行动」= 历史对话 */
  recentSessions?: ChatSessionSummary[];
  activeSessionId?: string | null;
  onSelectRecentSession?: (sessionId: string) => void;
};

function EmptyState({
  onSelectSkill,
  skillsDisabled,
  recentSessions,
  activeSessionId,
  onSelectRecentSession,
}: {
  onSelectSkill?: (skill: AgentSkillPrompt) => void;
  skillsDisabled?: boolean;
  recentSessions?: ChatSessionSummary[];
  activeSessionId?: string | null;
  onSelectRecentSession?: (sessionId: string) => void;
}) {
  return (
    <View style={styles.empty}>
      <AgentHero />
      {onSelectSkill ? (
        <AgentSkillsGrid onSelect={onSelectSkill} disabled={skillsDisabled} />
      ) : null}
      {onSelectRecentSession ? (
        <AgentActivityLog
          sessions={recentSessions ?? []}
          activeSessionId={activeSessionId}
          onSelectSession={onSelectRecentSession}
        />
      ) : null}
    </View>
  );
}

export function ChatMessageList({
  messages,
  listRef,
  confirmingCardId,
  onConfirmCard,
  onCancelCard,
  onDraftFieldChange,
  onClarifyChoice,
  streamingMessageId,
  thinking,
  stickToBottomToken = 0,
  onSelectSkill,
  skillsDisabled = false,
  recentSessions,
  activeSessionId,
  onSelectRecentSession,
}: Props) {
  const { colors } = useAppTheme();
  const nearBottomRef = React.useRef(true);
  const fieldFocusRef = React.useRef(false);
  const [showJump, setShowJump] = React.useState(false);
  /** 编辑确认卡字段时垫高列表，scrollToEnd 后输入框能停在键盘上方 */
  const [focusPad, setFocusPad] = React.useState(0);
  const scrollRafRef = React.useRef<number | null>(null);
  const scrollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollToEnd = React.useCallback((animated: boolean) => {
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      listRef?.current?.scrollToEnd({ animated });
    });
  }, [listRef]);

  const scrollToEndSoon = React.useCallback(
    (delayMs: number) => {
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        scrollTimerRef.current = null;
        nearBottomRef.current = true;
        setShowJump(false);
        scrollToEnd(true);
        // 键盘动画后再贴一次底，避免首帧高度未结算
        scrollTimerRef.current = setTimeout(() => {
          scrollTimerRef.current = null;
          scrollToEnd(true);
        }, 80);
      }, delayMs);
    },
    [scrollToEnd],
  );

  React.useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
      if (scrollTimerRef.current) clearTimeout(scrollTimerRef.current);
    };
  }, []);

  // 发送消息后强制贴底
  React.useEffect(() => {
    if (!stickToBottomToken) return;
    nearBottomRef.current = true;
    setShowJump(false);
    scrollToEnd(true);
  }, [scrollToEnd, stickToBottomToken]);

  React.useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = () => {
      if (nearBottomRef.current || fieldFocusRef.current) {
        scrollToEndSoon(Platform.OS === 'ios' ? 16 : 48);
      }
    };
    const onHide = () => {
      fieldFocusRef.current = false;
      setFocusPad(0);
    };
    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [scrollToEndSoon]);

  const onDraftFieldFocus = React.useCallback(() => {
    fieldFocusRef.current = true;
    nearBottomRef.current = true;
    setShowJump(false);
    setFocusPad(140);
    scrollToEndSoon(Platform.OS === 'ios' ? 60 : 100);
  }, [scrollToEndSoon]);

  const onScroll = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const dist = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const near = dist <= NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    setShowJump(prev => (prev === !near ? !near : prev));
  }, []);

  const onContentSizeChange = React.useCallback(() => {
    if (!nearBottomRef.current && !fieldFocusRef.current) return;
    scrollToEnd(false);
  }, [scrollToEnd]);

  const renderItem = React.useCallback(
    ({ item }: ListRenderItemInfo<ChatMessage>) => {
      return (
        <ChatBubble
          message={item}
          confirmingCardId={confirmingCardId}
          onConfirmCard={onConfirmCard}
          onCancelCard={onCancelCard}
          onDraftFieldChange={onDraftFieldChange}
          onClarifyChoice={onClarifyChoice}
          onDraftFieldFocus={onDraftFieldFocus}
          thinking={item.id === streamingMessageId ? thinking : null}
        />
      );
    },
    [
      confirmingCardId,
      onConfirmCard,
      onCancelCard,
      onDraftFieldChange,
      onClarifyChoice,
      onDraftFieldFocus,
      streamingMessageId,
      thinking,
    ],
  );

  const listHeader =
    messages.length > 0 && onSelectSkill ? (
      <View style={styles.headerStrip}>
        <AgentSkillStrip onSelect={onSelectSkill} disabled={skillsDisabled} />
      </View>
    ) : null;

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        // parts（含确认卡）变更时强制刷新气泡，避免只更文字不挂卡
        extraData={`${messages.length}:${streamingMessageId ?? ''}:${confirmingCardId ?? ''}:${thinking?.phase ?? ''}:${messages.map(m => m.parts.length).join(',')}`}
        style={[styles.list, { backgroundColor: 'transparent' }]}
        contentContainerStyle={[
          styles.content,
          focusPad > 0 ? { paddingBottom: Spacing['6xl'] + focusPad } : null,
          messages.length === 0 ? styles.contentEmpty : null,
        ]}
        ListHeaderComponent={listHeader}
        ListEmptyComponent={
          <EmptyState
            onSelectSkill={onSelectSkill}
            skillsDisabled={skillsDisabled}
            recentSessions={recentSessions}
            activeSessionId={activeSessionId}
            onSelectRecentSession={onSelectRecentSession}
          />
        }
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        keyboardShouldPersistTaps="always"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        // 流式时维持可视项，减少整表重绘
        maintainVisibleContentPosition={
          nearBottomRef.current
            ? undefined
            : { minIndexForVisible: 0, autoscrollToTopThreshold: 0 }
        }
        // Android 上 true 会导致确认卡 TextInput 焦点/输入法异常
        removeClippedSubviews={false}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={9}
      />
      {showJump ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="回到最新消息"
          onPress={() => {
            nearBottomRef.current = true;
            setShowJump(false);
            scrollToEnd(true);
          }}
          style={({ pressed }) => [
            styles.jumpBtn,
            {
              backgroundColor: colors.surface,
              borderColor: colors.outline,
              opacity: pressed ? 0.88 : 1,
            },
          ]}>
          <MaterialIcons name="arrow-downward" size={18} color={colors.primary} />
          <Text style={[styles.jumpText, { color: colors.text }]}>最新</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  list: { flex: 1 },
  content: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing['6xl'],
  },
  contentEmpty: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    paddingTop: Spacing.sm,
  },
  empty: {
    paddingBottom: Spacing['3xl'],
  },
  headerStrip: {
    marginBottom: Spacing.sm,
  },
  jumpBtn: {
    position: 'absolute',
    right: Spacing['5xl'],
    bottom: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 3,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  jumpText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
