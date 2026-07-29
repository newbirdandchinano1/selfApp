import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

export function ReviewAiAnalysisPanel({
  text,
  busy,
  canRun,
  onAnalyze,
  disabledReason,
}: {
  text: string | null | undefined;
  busy: boolean;
  canRun: boolean;
  onAnalyze: () => void;
  disabledReason?: string;
}) {
  const { colors, isDark } = useAppTheme();
  const body = (text ?? '').trim();

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: isDark ? 'rgba(15,23,42,0.45)' : colors.surfaceMuted,
          borderColor: colors.outline,
        },
      ]}>
      <View style={styles.head}>
        <View style={styles.headLeft}>
          <MaterialIcons name="auto-awesome" size={18} color={colors.primary} />
          <Text style={[Typography.title, { color: colors.text, fontSize: 15 }]}>AI 分析</Text>
        </View>
        <Pressable
          onPress={onAnalyze}
          disabled={!canRun || busy}
          style={({ pressed }) => [
            styles.btn,
            {
              backgroundColor: colors.primary,
              opacity: !canRun || busy ? 0.45 : pressed ? 0.88 : 1,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="AI 分析">
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnText}>{body ? '重新分析' : 'AI 分析'}</Text>
          )}
        </Pressable>
      </View>
      {!canRun && disabledReason ? (
        <Text style={[Typography.caption, { color: colors.textMuted, lineHeight: 18 }]}>
          {disabledReason}
        </Text>
      ) : null}
      {body ? (
        <Text style={[Typography.body, { color: colors.text, lineHeight: 22 }]}>{body}</Text>
      ) : (
        <Text style={[Typography.body, { color: colors.textMuted, lineHeight: 21 }]}>
          填写一定内容后，可生成「目前的问题 / 潜在问题 / 建议」诊断分析。
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: Layout.pagePaddingX,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing['3xl'],
    gap: Spacing.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  headLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flex: 1,
  },
  btn: {
    borderRadius: 10,
    minHeight: 34,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '800',
  },
});
