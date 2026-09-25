import { AppCard, AppScreen, ScreenHeader } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import {
  listProjectCompletionLogs,
  parseCompletionLogTagNames,
  type ProjectCompletionLogRow,
} from '@/lib/repositories/projects/project-completion-logs';
import { formatPoints } from '@/lib/reward-points';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

function formatCompletedAt(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

function monthLabelFromYmd(ymd: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(ymd.trim());
  if (!m) return '更早';
  return `${Number(m[1])}年${Number(m[2])}月`;
}

function sourceLabel(source: string): string {
  if (source === 'compress') return '到期压缩';
  if (source === 'manual_delete') return '手动删除细节';
  return '归档';
}

export default function ProjectCompletionLogsScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const [items, setItems] = useState<ProjectCompletionLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    setLoading(true);
    try {
      const rows = await listProjectCompletionLogs();
      setItems(rows);
    } catch (e) {
      console.warn('加载完成履历失败', e);
      setLoadError('加载失败，请稍后重试');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const sections = useMemo(() => {
    const map = new Map<string, ProjectCompletionLogRow[]>();
    for (const row of items) {
      const key = monthLabelFromYmd(row.completed_ymd);
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return [...map.entries()].map(([title, data]) => ({ title, data }));
  }, [items]);

  return (
    <AppScreen>
      <ScreenHeader title="完成履历" onBack={() => router.back()} />
      <View style={styles.body}>
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          已完成项目的轻量记录。收集箱中的完整细节会在保留期后自动压缩到此处。
        </Text>
        {loading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: Spacing.xl }} />
        ) : loadError ? (
          <Pressable onPress={() => void load()} style={styles.retry}>
            <Text style={{ color: colors.primary }}>{loadError} · 点此重试</Text>
          </Pressable>
        ) : items.length === 0 ? (
          <View style={styles.empty}>
            <MaterialIcons name="history" size={36} color={colors.textMuted} />
            <Text style={[styles.emptyTitle, { color: colors.textSecondary }]}>暂无完成履历</Text>
            <Text style={[styles.emptySub, { color: colors.textMuted }]}>
              完成并归档项目后会出现在这里
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id}
            stickySectionHeadersEnabled={false}
            contentContainerStyle={{ paddingBottom: Spacing['6xl'] }}
            renderSectionHeader={({ section }) => (
              <Text style={[styles.sectionTitle, { color: colors.text }]}>{section.title}</Text>
            )}
            renderItem={({ item }) => {
              const tags = parseCompletionLogTagNames(item.tag_names);
              const points =
                item.points_delta > 0
                  ? `+${formatPoints(item.points_delta)}`
                  : item.points_delta < 0
                    ? formatPoints(item.points_delta)
                    : null;
              return (
                <AppCard
                  style={[
                    styles.card,
                    {
                      backgroundColor: isDark ? colors.surfaceMuted : colors.surfaceSubtle,
                      borderColor: colors.outline,
                    },
                  ]}>
                  <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={2}>
                    {item.completed_ymd}
                    {formatCompletedAt(item.completed_at)
                      ? ` · ${formatCompletedAt(item.completed_at)}`
                      : ''}
                    {item.task_count > 0
                      ? ` · ${item.done_task_count}/${item.task_count} 任务`
                      : ''}
                    {points ? ` · ${points} 积分` : ''}
                  </Text>
                  <Text style={[styles.source, { color: colors.textMuted }]}>
                    {sourceLabel(item.source)}
                  </Text>
                  {tags.length > 0 ? (
                    <Text style={[styles.tags, { color: colors.textSecondary }]} numberOfLines={1}>
                      {tags.join(' · ')}
                    </Text>
                  ) : null}
                  {item.note?.trim() ? (
                    <Text style={[styles.note, { color: colors.textSecondary }]} numberOfLines={3}>
                      {item.note.trim()}
                    </Text>
                  ) : null}
                </AppCard>
              );
            }}
          />
        )}
      </View>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  hint: {
    ...Typography.caption,
    marginBottom: Spacing.md,
    lineHeight: 18,
  },
  retry: {
    marginTop: Spacing.xl,
    alignItems: 'center',
  },
  empty: {
    marginTop: Spacing['3xl'],
    alignItems: 'center',
    gap: Spacing.sm,
  },
  emptyTitle: {
    ...Typography.body,
    fontWeight: '600',
  },
  emptySub: {
    ...Typography.caption,
  },
  sectionTitle: {
    ...Typography.body,
    fontWeight: '700',
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  card: {
    marginBottom: Spacing.sm,
    padding: Spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  name: {
    ...Typography.body,
    fontWeight: '600',
  },
  meta: {
    ...Typography.caption,
    marginTop: 4,
  },
  source: {
    ...Typography.caption,
    marginTop: 4,
  },
  tags: {
    ...Typography.caption,
    marginTop: 4,
  },
  note: {
    ...Typography.caption,
    marginTop: 6,
    lineHeight: 18,
  },
});
