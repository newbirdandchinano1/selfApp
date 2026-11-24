/**
 * 「最近的行动」— 历史对话入口；无会话时整栏不渲染。
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AgentSectionHead } from '@/components/assistant/chat/agent-section-head';
import { Spacing } from '@/constants/design-tokens';
import { appFonts } from '@/constants/app-fonts';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { ChatSessionSummary } from '@/lib/assistant/chat-types';

type Props = {
  sessions: ChatSessionSummary[];
  activeSessionId?: string | null;
  onSelectSession: (sessionId: string) => void;
  /** 最多展示条数 */
  limit?: number;
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

function sessionIcon(title: string, preview: string): string {
  const t = `${title} ${preview}`;
  if (/账|财务|¥|元/.test(t)) return '◈';
  if (/复盘|道路|晨间/.test(t)) return '✧';
  if (/任务|待办|项目|安排/.test(t)) return '✓';
  if (/吃|饮食|健康|菜谱/.test(t)) return '◌';
  return '⌁';
}

export function AgentActivityLog({
  sessions,
  activeSessionId,
  onSelectSession,
  limit = 5,
}: Props) {
  const { colors, isDark } = useAppTheme();

  // 只展示有内容的历史对话；无记录时整栏不渲染
  const rows = React.useMemo(() => {
    return sessions
      .filter(s => {
        if (!s.id) return false;
        if ((s.messageCount ?? 0) <= 0) return false;
        const preview = String(s.preview || '').trim();
        if (!preview || preview === '新对话') return false;
        // 当前空态会话若已在列表里且就是落地页自己，可保留以便回看；仍允许点进
        return true;
      })
      .slice(0, limit);
  }, [limit, sessions]);

  if (rows.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <AgentSectionHead title="最近的行动" meta="LIVE LOG" />
      <View
        style={[
          styles.card,
          {
            backgroundColor: isDark ? colors.surface : 'rgba(255,254,248,0.72)',
            borderColor: colors.outline,
          },
        ]}>
        {rows.map((row, idx) => {
          const active = row.id === activeSessionId;
          return (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              accessibilityLabel={`打开对话：${row.title}`}
              onPress={() => onSelectSession(row.id)}
              style={({ pressed }) => [
                styles.row,
                {
                  borderBottomColor: colors.outline,
                  borderBottomWidth: idx === rows.length - 1 ? 0 : StyleSheet.hairlineWidth,
                  backgroundColor: active
                    ? colors.primaryMuted
                    : pressed
                      ? colors.surfaceMuted
                      : 'transparent',
                },
              ]}>
              <View style={[styles.iconBox, { backgroundColor: colors.primaryMuted }]}>
                <Text style={styles.icon}>{sessionIcon(row.title, row.preview)}</Text>
              </View>
              <View style={styles.copy}>
                <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
                  {row.title || '对话'}
                </Text>
                <Text style={[styles.detail, { color: colors.textMuted }]} numberOfLines={1}>
                  {row.preview?.trim() || '暂无预览'}
                </Text>
              </View>
              <Text style={[styles.time, { color: colors.textMuted }]}>
                {formatTime(row.updatedAt)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: Spacing['3xl'],
  },
  card: {
    marginHorizontal: Spacing['5xl'],
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  iconBox: {
    width: 35,
    height: 35,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  icon: {
    fontSize: 16,
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 2,
  },
  detail: {
    fontSize: 11,
    lineHeight: 15,
  },
  time: {
    fontFamily: appFonts.mono,
    fontSize: 10,
  },
});
