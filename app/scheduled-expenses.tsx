import { AppButton, AppCard, AppInput, ScreenHeader } from '@/components/ui';
import { Layout, Radius, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { usePageApiSync } from '@/hooks/use-page-api-sync';
import {
  deleteScheduledFinanceExpense,
  describeScheduledFinanceExpense,
  formatScheduledExpenseTime,
  loadScheduledFinanceExpenses,
  upsertScheduledFinanceExpense,
  type ScheduledFinanceExpense,
} from '@/lib/finance-scheduled-expense';
import { scheduleRunScheduledFinanceExpenses } from '@/lib/finance-scheduled-expense-runner';
import { getFinanceAccountsWithBalance } from '@/lib/repositories/finance/finance';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import React from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'scheduled-expenses';

function formatCurrency(amount: number): string {
  return `¥${amount.toFixed(2)}`;
}

export default function ScheduledExpensesScreen() {
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark, shadows } = useAppTheme();

  const [items, setItems] = React.useState<ScheduledFinanceExpense[]>([]);
  const [accounts, setAccounts] = React.useState<FinanceAccountBalanceRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const reload = React.useCallback(async () => {
    setLoading(true);
    await wrapLoad(async () => {
      try {
        const [rows, accts] = await Promise.all([loadScheduledFinanceExpenses(), getFinanceAccountsWithBalance()]);
        setItems(rows);
        setAccounts(accts);
      } catch (e) {
        console.warn('Failed to load scheduled expenses:', e);
      } finally {
        setLoading(false);
      }
    });
  }, [wrapLoad]);

  useFocusEffect(
    React.useCallback(() => {
      scheduleRunScheduledFinanceExpenses('scheduled-expenses-focus');
      void reload();
    }, [reload]),
  );

  const accountNameById = React.useMemo(() => new Map(accounts.map((a) => [a.id, a.name])), [accounts]);

  const handleToggle = React.useCallback(async (item: ScheduledFinanceExpense, enabled: boolean) => {
    try {
      await upsertScheduledFinanceExpense({ ...item, enabled });
      setItems((prev) => prev.map((row) => (row.id === item.id ? { ...row, enabled } : row)));
      if (enabled) scheduleRunScheduledFinanceExpenses('toggle-on');
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : '请稍后重试');
    }
  }, []);

  const handleDelete = React.useCallback((item: ScheduledFinanceExpense) => {
    Alert.alert('删除定时支出', `确定删除「${item.name}」？已自动记下的流水不会删除。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteScheduledFinanceExpense(item.id);
              setItems((prev) => prev.filter((row) => row.id !== item.id));
            } catch (e) {
              Alert.alert('删除失败', e instanceof Error ? e.message : '请稍后重试');
            }
          })();
        },
      },
    ]);
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['left', 'right', 'bottom']}>
      <ScreenHeader
        title="定时支出"
        onBack={() => router.back()}
        right={
          <Pressable
            onPress={() => router.push('/add-scheduled-expense')}
            hitSlop={Layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="添加定时支出">
            <MaterialIcons name="add" size={24} color={colors.text} />
          </Pressable>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + Spacing.xl }]}
        showsVerticalScrollIndicator={false}>
        <Text style={[Typography.caption, styles.intro, { color: colors.textSecondary }]}>
          设置后会在指定日期与时间自动记一笔支出，无需每天手动记账。应用打开或回到前台时会补记近 14 天内遗漏的记录。
        </Text>

        {loading ? (
          <Text style={[Typography.body, { color: colors.textSecondary }]}>加载中…</Text>
        ) : items.length === 0 ? (
          <AppCard variant="muted" padded style={styles.emptyCard}>
            <MaterialIcons name="event-repeat" size={32} color={colors.textSecondary} />
            <Text style={[Typography.bodyStrong, { color: colors.text, marginTop: Spacing.sm }]}>暂无定时支出</Text>
            <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: 4, textAlign: 'center' }]}>
              例如每日通勤、每周订阅、每月房租等固定开销
            </Text>
            <AppButton
              label="添加定时支出"
              onPress={() => router.push('/add-scheduled-expense')}
              style={{ marginTop: Spacing.md, alignSelf: 'stretch' }}
            />
          </AppCard>
        ) : (
          <View style={styles.list}>
            {items.map((item) => {
              const accountName = accountNameById.get(item.accountId) ?? '未知账户';
              return (
                <AppCard key={item.id} variant="default" padded style={styles.itemCard}>
                  <View style={styles.itemTop}>
                    <View style={styles.itemMain}>
                      <Text style={[Typography.bodyStrong, { color: colors.text }]} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                        {describeScheduledFinanceExpense(item)}
                      </Text>
                      <Text style={[Typography.caption, { color: colors.textSecondary, marginTop: 2 }]}>
                        {accountName}
                        {item.timesPerDay > 1 ? ` · 每次 ${formatCurrency(item.amount)}` : ` · ${formatCurrency(item.amount)}`}
                      </Text>
                    </View>
                    <Switch
                      value={item.enabled}
                      onValueChange={(v) => void handleToggle(item, v)}
                      trackColor={{ false: colors.capsule, true: colors.successSwitch }}
                    />
                  </View>
                  <View style={styles.itemActions}>
                    <Pressable
                      onPress={() => router.push({ pathname: '/add-scheduled-expense', params: { id: item.id } })}
                      style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.75 }]}>
                      <MaterialIcons name="edit" size={18} color={colors.primary} />
                      <Text style={[Typography.caption, { color: colors.primary }]}>编辑</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => handleDelete(item)}
                      style={({ pressed }) => [styles.actionBtn, pressed && { opacity: 0.75 }]}>
                      <MaterialIcons name="delete-outline" size={18} color={colors.danger} />
                      <Text style={[Typography.caption, { color: colors.danger }]}>删除</Text>
                    </Pressable>
                  </View>
                </AppCard>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: {
    paddingHorizontal: Layout.pagePaddingX,
    paddingTop: Spacing.md,
    gap: Spacing.md,
  },
  intro: {
    lineHeight: 20,
  },
  emptyCard: {
    alignItems: 'center',
    paddingVertical: Spacing.xl,
  },
  list: {
    gap: Spacing.sm,
  },
  itemCard: {
    gap: Spacing.sm,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  itemMain: {
    flex: 1,
    minWidth: 0,
  },
  itemActions: {
    flexDirection: 'row',
    gap: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.35)',
    paddingTop: Spacing.sm,
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
});
