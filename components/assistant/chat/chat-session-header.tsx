import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader, ScreenHeaderIconAction } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';

type Props = {
  title: string;
  onBack: () => void;
  onNewChat: () => void;
  onOpenHistory: () => void;
};

export function ChatSessionHeader({ title, onBack, onNewChat, onOpenHistory }: Props) {
  const { colors } = useAppTheme();

  return (
    <ScreenHeader
      title={title || '助手'}
      onBack={onBack}
      right={
        <View style={styles.right}>
          <Pressable onPress={onOpenHistory} hitSlop={8} accessibilityLabel="历史对话">
            <Text style={[styles.link, { color: colors.textSecondary }]}>历史</Text>
          </Pressable>
          <ScreenHeaderIconAction
            icon="edit"
            onPress={onNewChat}
            accessibilityLabel="新建对话"
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  link: {
    ...Typography.label,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 4,
  },
});
