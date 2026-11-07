import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ChatSessionSummary } from '@/lib/assistant/chat-types';

type Props = {
  visible: boolean;
  sessions: ChatSessionSummary[];
  activeSessionId: string | null;
  onClose: () => void;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
  onNewChat: () => void;
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ChatSessionListModal({
  visible,
  sessions,
  activeSessionId,
  onClose,
  onSelect,
  onDelete,
  onNewChat,
}: Props) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              paddingBottom: Math.max(insets.bottom, 16),
            },
          ]}>
          <View style={styles.head}>
            <Text style={[styles.title, { color: colors.text }]}>历史对话</Text>
            <View style={styles.headActions}>
              <Pressable onPress={onNewChat} hitSlop={8}>
                <Text style={[styles.link, { color: colors.primary }]}>新建</Text>
              </Pressable>
              <Pressable onPress={onClose} hitSlop={8}>
                <Text style={[styles.link, { color: colors.textMuted }]}>关闭</Text>
              </Pressable>
            </View>
          </View>

          <FlatList
            data={sessions}
            keyExtractor={item => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: colors.textMuted }]}>还没有历史对话</Text>
            }
            renderItem={({ item }) => {
              const active = item.id === activeSessionId;
              return (
                <Pressable
                  onPress={() => onSelect(item.id)}
                  style={({ pressed }) => [
                    styles.row,
                    {
                      backgroundColor: active ? colors.primaryMuted : colors.surface,
                      borderColor: colors.outline,
                      opacity: pressed ? 0.9 : 1,
                    },
                  ]}>
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: colors.text }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Text style={[styles.rowPreview, { color: colors.textSecondary }]} numberOfLines={1}>
                      {item.preview}
                    </Text>
                  </View>
                  <Text style={[styles.time, { color: colors.textMuted }]}>
                    {formatTime(item.updatedAt)}
                  </Text>
                  <Pressable
                    onPress={() => onDelete(item.id)}
                    hitSlop={10}
                    accessibilityLabel="删除对话">
                    <MaterialIcons name="delete-outline" size={20} color={colors.textMuted} />
                  </Pressable>
                </Pressable>
              );
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    maxHeight: '78%',
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    paddingTop: Spacing.xl,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing['5xl'],
    marginBottom: Spacing.lg,
  },
  headActions: { flexDirection: 'row', gap: Spacing['3xl'] },
  title: { ...Typography.h3 },
  link: { ...Typography.bodyStrong, fontSize: 14 },
  list: {
    paddingHorizontal: Spacing['5xl'],
    paddingBottom: Spacing['5xl'],
    gap: Spacing.md,
  },
  empty: {
    ...Typography.body,
    textAlign: 'center',
    marginTop: Spacing['6xl'],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.xl,
    paddingVertical: Spacing.xl,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: { ...Typography.bodyStrong, fontSize: 15 },
  rowPreview: { ...Typography.caption, fontSize: 12 },
  time: { ...Typography.caption, minWidth: 40, textAlign: 'right' },
});
