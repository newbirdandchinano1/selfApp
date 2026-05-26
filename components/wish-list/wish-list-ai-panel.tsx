import { AppButton, AppCard } from '@/components/ui';
import { Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

export type WishListAiPanelProps = {
  activeCount: number;
  totalItems: number;
  totalAmountLabel: string;
  topDesireName: string | null;
  headline: string;
  review: string | null;
  loading: boolean;
  error: string | null;
  zhipuReady: boolean;
  showPending: boolean;
  onRefresh: () => void;
};

export function WishListAiPanel({
  activeCount,
  totalItems,
  totalAmountLabel,
  topDesireName,
  headline,
  review,
  loading,
  error,
  zhipuReady,
  showPending,
  onRefresh,
}: WishListAiPanelProps) {
  const { colors } = useAppTheme();

  return (
    <AppCard variant="muted" style={styles.card}>
      <View style={styles.head}>
        <View style={styles.kickerRow}>
          <MaterialIcons name="auto-awesome" size={16} color={colors.primary} />
          <Text style={[Typography.label, { color: colors.primary }]}>AI 理性评审</Text>
        </View>
        <Text style={[Typography.h3, { color: colors.text }]}>{headline}</Text>
      </View>

      <View style={[styles.body, { borderTopColor: colors.outline }]}>
        {activeCount === 0 ? (
          <Text style={[Typography.body, { color: colors.textSecondary, lineHeight: 21 }]}>
            {totalItems === 0
              ? '清单为空时暂无消费压力分析。添加好物后，AI 会根据本地数据生成理性消费观察。'
              : '当前无待购条目，AI 评审仅针对未实现的心愿。可将已实现条目恢复后再生成。'}
          </Text>
        ) : (
          <>
            {review?.trim() ? (
              <Text style={[Typography.body, { color: colors.textSecondary, lineHeight: 21 }]}>{review.trim()}</Text>
            ) : (
              <>
                <Text style={[Typography.body, { color: colors.textSecondary, lineHeight: 21 }]}>
                  当前共
                  <Text style={{ color: colors.text, fontWeight: '800' }}> {activeCount} </Text>
                  条待购心愿，总预估
                  <Text style={{ color: colors.text, fontWeight: '800' }}> {totalAmountLabel} </Text>
                  。
                  {topDesireName ? (
                    <>
                      {' '}
                      其中
                      <Text style={{ color: colors.text, fontWeight: '800' }}> {topDesireName} </Text>
                      心动等级较高，可优先评估必要性再下单。
                    </>
                  ) : null}
                </Text>
                {showPending ? (
                  <View style={styles.pendingRow}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[Typography.caption, { color: colors.textSecondary }]}>正在请求智谱 GLM…</Text>
                  </View>
                ) : null}
                {error ? (
                  <Text style={[Typography.body, { color: colors.danger, lineHeight: 21 }]}>
                    生成失败：{error}。可点击下方按钮重试。
                  </Text>
                ) : null}
              </>
            )}

            {!zhipuReady ? (
              <Text style={[Typography.caption, { color: colors.textSecondary, lineHeight: 18 }]}>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>提示：</Text>
                配置智谱 API 密钥后，可由模型根据清单明细生成理性消费评审。
              </Text>
            ) : null}

            {review?.trim() ? (
              <Text style={[Typography.caption, { color: colors.textSecondary, lineHeight: 18 }]}>
                <Text style={{ color: colors.primary, fontWeight: '800' }}>说明：</Text>
                内容由智谱模型根据本地清单生成，仅供自我观察参考，不构成消费或投资建议。
              </Text>
            ) : null}

            {zhipuReady && activeCount > 0 ? (
              <AppButton
                label={loading ? '刷新中…' : '刷新 AI 评审'}
                variant="secondary"
                size="sm"
                loading={loading}
                disabled={loading}
                onPress={onRefresh}
                style={styles.refreshBtn}
              />
            ) : null}
          </>
        )}
      </View>
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: Spacing.lg,
  },
  head: {
    gap: Spacing.sm,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  body: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.lg,
    gap: Spacing.lg,
  },
  pendingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
  },
  refreshBtn: {
    alignSelf: 'flex-start',
  },
});
