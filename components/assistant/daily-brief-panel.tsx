/**
 * 任务页「今日任务与习惯」简报：facts + ≤3 ActionCard；失败仅展示规则 facts。
 */
import type { ActionCard } from '@/lib/assistant/action-card';
import { confirmAssistantCard } from '@/lib/assistant/confirm-execute';
import { collectAllowedIdsFromBriefContext } from '@/lib/assistant/brief-context';
import {
  runAssistantDailyBrief,
  type AssistantDailyBriefClientResult,
} from '@/lib/assistant/daily-brief-client';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { useTaskFoldTheme } from '@/constants/task-fold-theme';
import { Layout, Spacing } from '@/constants/design-tokens';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Props = {
  /** 外部触发刷新（如下拉刷新完成） */
  refreshToken?: number;
};

export function DailyBriefPanel({ refreshToken = 0 }: Props) {
  const { tf } = useTaskFoldTheme();
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const [data, setData] = React.useState<AssistantDailyBriefClientResult | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const r = await runAssistantDailyBrief();
      setData(r);
    } catch (e) {
      toast.error(toUserMessage(e, '今日简报加载失败'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void load();
    }, [load]),
  );

  React.useEffect(() => {
    if (refreshToken > 0) void load();
  }, [refreshToken, load]);

  const onConfirm = React.useCallback(
    async (card: ActionCard) => {
      if (!data) return;
      setBusyId(card.id);
      try {
        const allowedIds = collectAllowedIdsFromBriefContext(data.brief_context);
        const assignYmd = data.brief_context.meta.today_ymd;
        const r = await confirmAssistantCard(card, { allowedIds, assignYmd });
        if (!r.ok) {
          if (r.plan.kind === 'clarify') toast.info(r.error);
          else toast.error(r.error);
          return;
        }
        if (r.plan.kind === 'frog_assign') {
          toast.success('已指派青蛙');
          void load();
        }
      } catch (e) {
        toast.error(toUserMessage(e, '执行失败'));
      } finally {
        setBusyId(null);
      }
    },
    [data, load],
  );

  if (loading && !data) {
    return (
      <View style={styles.wrap}>
        <View style={styles.headRow}>
          <Text style={[styles.title, { color: tf.ink }]}>今日任务与习惯</Text>
          <ActivityIndicator size="small" color={tf.frog} />
        </View>
      </View>
    );
  }

  if (!data) return null;

  const hasContent = data.facts.length > 0 || data.cards.length > 0 || !!data.headline;

  if (!hasContent) return null;

  return (
    <View style={styles.wrap}>
      <View style={styles.headRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: tf.ink }]}>今日任务与习惯</Text>
          <Text style={[styles.headline, { color: tf.frog }]} numberOfLines={2}>
            {data.headline}
          </Text>
        </View>
        <Pressable
          onPress={() => void load()}
          hitSlop={Layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="刷新今日任务与习惯简报"
          style={styles.refreshBtn}>
          {loading ? (
            <ActivityIndicator size="small" color={tf.frog} />
          ) : (
            <MaterialIcons name="refresh" size={18} color={tf.frog} />
          )}
        </Pressable>
      </View>

      {data.from_fallback ? (
        <Text style={[styles.fallbackHint, { color: tf.muted }]}>离线规则摘要</Text>
      ) : null}

      {data.facts.map((f, i) => (
        <Text key={`${f.domain}-${i}`} style={[styles.fact, { color: tf.ink2 }]}>
          · {f.text}
        </Text>
      ))}

      {data.cards.map(card => (
        <View
          key={card.id}
          style={[styles.card, { borderColor: tf.line, backgroundColor: tf.card }]}>
          <Text style={[styles.cardTitle, { color: tf.ink }]}>{card.title}</Text>
          {card.summary ? (
            <Text style={[styles.cardSummary, { color: tf.ink2 }]}>{card.summary}</Text>
          ) : null}
          <Pressable
            style={[styles.actionBtn, { backgroundColor: tf.pond }]}
            disabled={busyId === card.id}
            onPress={() => void onConfirm(card)}
            accessibilityRole="button"
            accessibilityLabel={card.needs_confirm ? `确认：${card.title}` : `打开：${card.title}`}>
            {busyId === card.id ? (
              <ActivityIndicator color={tf.onPond} />
            ) : (
              <Text style={[styles.actionText, { color: tf.onPond }]}>
                {card.needs_confirm ? '确认' : '打开'}
              </Text>
            )}
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: Spacing.sm,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  headline: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  refreshBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  fallbackHint: {
    fontSize: 11,
    fontWeight: '600',
  },
  fact: {
    fontSize: 13,
    lineHeight: 19,
  },
  card: {
    marginTop: 4,
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 6,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  cardSummary: {
    fontSize: 13,
    lineHeight: 18,
  },
  actionBtn: {
    marginTop: 4,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 10,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '700',
  },
});
