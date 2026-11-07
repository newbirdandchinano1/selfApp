import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { ChatBubble } from '@/components/assistant/chat/chat-bubble';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ActionCard } from '@/lib/assistant/action-card';
import type { AgentThinkingState } from '@/lib/assistant/agent-thinking-status';
import type { ChatMessage } from '@/lib/assistant/chat-types';

const NEAR_BOTTOM_PX = 96;

type Props = {
  messages: ChatMessage[];
  listRef?: React.RefObject<FlatList<ChatMessage> | null>;
  confirmingCardId?: string | null;
  onConfirmCard?: (card: ActionCard) => void;
  onCancelCard?: (card: ActionCard) => void;
  onDraftFieldChange?: (card: ActionCard, key: string, value: string) => void;
  streamingMessageId?: string | null;
  thinking?: AgentThinkingState | null;
  /** 外部可强制滚到底（发送后） */
  stickToBottomToken?: number;
};

function EmptyState() {
  const { colors } = useAppTheme();
  return (
    <View style={styles.empty}>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>有什么想聊的？</Text>
      <Text style={[styles.emptyBody, { color: colors.textSecondary }]}>
        可以随便问技术、生活或点子；涉及本 App 的记账、待办、饮食时，我也会尽量帮你。
      </Text>
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
  streamingMessageId,
  thinking,
  stickToBottomToken = 0,
}: Props) {
  const { colors } = useAppTheme();
  const nearBottomRef = React.useRef(true);
  const [showJump, setShowJump] = React.useState(false);
  const scrollRafRef = React.useRef<number | null>(null);

  const scrollToEnd = React.useCallback((animated: boolean) => {
    if (scrollRafRef.current != null) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      listRef?.current?.scrollToEnd({ animated });
    });
  }, [listRef]);

  React.useEffect(() => {
    return () => {
      if (scrollRafRef.current != null) cancelAnimationFrame(scrollRafRef.current);
    };
  }, []);

  // 发送消息后强制贴底
  React.useEffect(() => {
    if (!stickToBottomToken) return;
    nearBottomRef.current = true;
    setShowJump(false);
    scrollToEnd(true);
  }, [scrollToEnd, stickToBottomToken]);

  const onScroll = React.useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const dist = contentSize.height - layoutMeasurement.height - contentOffset.y;
    const near = dist <= NEAR_BOTTOM_PX;
    nearBottomRef.current = near;
    setShowJump(prev => (prev === !near ? !near : prev));
  }, []);

  const onContentSizeChange = React.useCallback(() => {
    if (!nearBottomRef.current) return;
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
          thinking={item.id === streamingMessageId ? thinking : null}
        />
      );
    },
    [
      confirmingCardId,
      onConfirmCard,
      onCancelCard,
      onDraftFieldChange,
      streamingMessageId,
      thinking,
    ],
  );

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        style={[styles.list, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.content,
          messages.length === 0 ? styles.contentEmpty : null,
        ]}
        ListEmptyComponent={<EmptyState />}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onContentSizeChange={onContentSizeChange}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        // 流式时维持可视项，减少整表重绘
        maintainVisibleContentPosition={
          nearBottomRef.current
            ? undefined
            : { minIndexForVisible: 0, autoscrollToTopThreshold: 0 }
        }
        removeClippedSubviews
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
    paddingTop: Spacing['3xl'],
    paddingBottom: Spacing['6xl'],
  },
  contentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  empty: {
    paddingHorizontal: Spacing['6xl'],
    alignItems: 'center',
    gap: Spacing.lg,
  },
  emptyTitle: {
    ...Typography.h3,
    textAlign: 'center',
  },
  emptyBody: {
    ...Typography.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    maxWidth: 320,
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
