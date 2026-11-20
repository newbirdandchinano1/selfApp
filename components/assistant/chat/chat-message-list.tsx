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
  onClarifyChoice?: (card: ActionCard, choice: string) => void;
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
  onClarifyChoice,
  streamingMessageId,
  thinking,
  stickToBottomToken = 0,
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

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={renderItem}
        // parts（含确认卡）变更时强制刷新气泡，避免只更文字不挂卡
        extraData={`${messages.length}:${streamingMessageId ?? ''}:${confirmingCardId ?? ''}:${thinking?.phase ?? ''}:${messages.map(m => m.parts.length).join(',')}`}
        style={[styles.list, { backgroundColor: colors.background }]}
        contentContainerStyle={[
          styles.content,
          focusPad > 0 ? { paddingBottom: Spacing['6xl'] + focusPad } : null,
          messages.length === 0 ? styles.contentEmpty : null,
        ]}
        ListEmptyComponent={<EmptyState />}
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
