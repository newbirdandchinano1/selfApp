import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  createQuickAddItemMap,
  getQuickAddMetricType,
  loadAllQuickAddItems,
  type QuickAddCardItem,
} from '@/lib/quick-add-cards';
import { getHealthRecordsForUserOnDate } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type FilterKey = 'all' | 'hydration' | 'protein' | 'sodium';

type IntakeHistoryLine = {
  key: string;
  title: string;
  amount: string;
  time: string;
  note: string;
  aiComment: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  category: Exclude<FilterKey, 'all'>;
  iconBgLight: string;
  iconBgDark: string;
  iconColor: string;
};

function normalizeDate(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatLocalYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function toDateFromYmd(raw: string | string[] | undefined) {
  const rawValue = Array.isArray(raw) ? raw[0] : raw;
  if (!rawValue) return normalizeDate(new Date());
  const d = new Date(rawValue);
  if (Number.isNaN(d.getTime())) return normalizeDate(new Date());
  return normalizeDate(d);
}

function formatRecordTime(createdAt: string): string {
  const normalized = createdAt.includes('T') ? createdAt : `${createdAt.replace(' ', 'T')}`;
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatIntakeAmount(value: number, unit: 'ml' | 'g' | 'mg'): string {
  const formatted = Number(value.toFixed(2)).toString();
  return `${formatted}${unit}`;
}

function formatHistoryDateLabel(d: Date): string {
  const today = normalizeDate(new Date());
  if (today.getTime() === d.getTime()) {
    return `今天 (${d.getMonth() + 1}月${d.getDate()}日)`;
  }
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function buildHistoryLines(rows: HealthRecordRow[], quickAddCatalog: QuickAddCardItem[]): IntakeHistoryLine[] {
  const lines: IntakeHistoryLine[] = [];
  const quickAddByKey = createQuickAddItemMap(quickAddCatalog);
  for (const row of rows) {
    const time = formatRecordTime(row.created_at);
    if (row.hydration > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      lines.push({
        key: `${row.id}-h`,
        title: qa && getQuickAddMetricType(qa) === 'hydration' ? qa.label : '水分',
        amount: formatIntakeAmount(row.hydration, 'ml'),
        time,
        note: '备注：暂无备注',
        aiComment: 'AI评价：待分析',
        icon: qa && getQuickAddMetricType(qa) === 'hydration' ? (qa.icon as keyof typeof MaterialIcons.glyphMap) : 'water-drop',
        category: 'hydration',
        iconBgLight: 'rgba(16,185,129,0.12)',
        iconBgDark: 'rgba(6,78,59,0.32)',
        iconColor: '#10b981',
      });
    }
    if (row.protein > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      lines.push({
        key: `${row.id}-p`,
        title: qa && getQuickAddMetricType(qa) === 'protein' ? qa.label : '蛋白质',
        amount: formatIntakeAmount(row.protein, 'g'),
        time,
        note: '备注：暂无备注',
        aiComment: 'AI评价：待分析',
        icon: qa && getQuickAddMetricType(qa) === 'protein' ? (qa.icon as keyof typeof MaterialIcons.glyphMap) : 'restaurant',
        category: 'protein',
        iconBgLight: 'rgba(245,158,11,0.14)',
        iconBgDark: 'rgba(120,53,15,0.32)',
        iconColor: '#f59e0b',
      });
    }
    if (row.sodium > 0) {
      const qa = row.quick_add_key ? quickAddByKey.get(row.quick_add_key) : undefined;
      lines.push({
        key: `${row.id}-s`,
        title: qa && getQuickAddMetricType(qa) === 'sodium' ? qa.label : '钠',
        amount: formatIntakeAmount(row.sodium, 'mg'),
        time,
        note: '备注：暂无备注',
        aiComment: 'AI评价：待分析',
        icon: qa && getQuickAddMetricType(qa) === 'sodium' ? (qa.icon as keyof typeof MaterialIcons.glyphMap) : 'science',
        category: 'sodium',
        iconBgLight: 'rgba(168,85,247,0.14)',
        iconBgDark: 'rgba(88,28,135,0.32)',
        iconColor: '#a855f7',
      });
    }
  }
  return lines;
}

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'hydration', label: '水分' },
  { key: 'protein', label: '蛋白质' },
  { key: 'sodium', label: '钠' },
];

export default function IntakeHistoryScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const { date } = useLocalSearchParams<{ date?: string }>();
  const selectedDate = React.useMemo(() => toDateFromYmd(date), [date]);
  const selectedDateYmd = React.useMemo(() => formatLocalYmd(selectedDate), [selectedDate]);

  const [filter, setFilter] = React.useState<FilterKey>('all');
  const [lines, setLines] = React.useState<IntakeHistoryLine[]>([]);

  useFocusEffect(
    React.useCallback(() => {
      let cancelled = false;
      const load = async () => {
        const [user, catalog] = await Promise.all([getDefaultUser(), loadAllQuickAddItems()]);
        if (!user?.id) {
          if (!cancelled) setLines([]);
          return;
        }
        const records = await getHealthRecordsForUserOnDate(user.id, selectedDateYmd);
        if (!cancelled) {
          setLines(buildHistoryLines(records, catalog));
        }
      };
      void load();
      return () => {
        cancelled = true;
      };
    }, [selectedDateYmd])
  );

  const filteredLines = React.useMemo(() => {
    if (filter === 'all') return lines;
    return lines.filter((line) => line.category === filter);
  }, [filter, lines]);

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(248, 250, 252, 0.92)',
            borderBottomColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(148,163,184,0.16)',
          },
        ]}
      >
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back" size={22} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: theme.text }]}>摄入历史</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.filterRow}>
          {FILTERS.map((item) => {
            const active = filter === item.key;
            return (
              <Pressable
                key={item.key}
                onPress={() => setFilter(item.key)}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? theme.primary : theme.surface,
                    borderColor: active ? theme.primary : isDark ? 'rgba(148,163,184,0.25)' : '#e2e8f0',
                  },
                ]}
              >
                <Text style={[styles.filterText, { color: active ? '#fff' : theme.textSecondary }]}>{item.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={[styles.groupTitle, { color: theme.textSecondary }]}>{formatHistoryDateLabel(selectedDate)}</Text>

        {filteredLines.length === 0 ? (
          <View
            style={[
              styles.emptyBox,
              {
                backgroundColor: theme.surface,
                borderColor: isDark ? 'rgba(148,163,184,0.14)' : '#e2e8f0',
              },
            ]}
          >
            <Text style={[styles.emptyText, { color: theme.textSecondary }]}>当天暂无摄入记录</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {filteredLines.map((line) => (
              <View
                key={line.key}
                style={[
                  styles.row,
                  {
                    backgroundColor: theme.surface,
                    borderColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(226,232,240,0.9)',
                  },
                ]}
              >
                <View style={styles.rowLeft}>
                  <View
                    style={[
                      styles.iconWrap,
                      {
                        backgroundColor: isDark ? line.iconBgDark : line.iconBgLight,
                      },
                    ]}
                  >
                    <MaterialIcons name={line.icon} size={22} color={line.iconColor} />
                  </View>
                  <View style={styles.rowTextWrap}>
                    <View style={styles.rowHeader}>
                      <Text style={[styles.rowTitle, { color: theme.text }]}>{line.title}</Text>
                      <Text style={[styles.rowTime, { color: theme.textSecondary }]}>{line.time}</Text>
                    </View>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={1}>
                      {line.note}
                    </Text>
                    <Text style={[styles.rowMeta, { color: theme.textSecondary }]} numberOfLines={2}>
                      {line.aiComment}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.rowAmount, { color: theme.text }]}>{line.amount}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: {
    height: 58,
    borderBottomWidth: 1,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 28,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  filterChip: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  filterText: {
    fontSize: 13,
    fontWeight: '600',
  },
  groupTitle: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 10,
  },
  emptyBox: {
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 26,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 13,
    fontWeight: '600',
  },
  list: {
    gap: 10,
  },
  row: {
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    minWidth: 0,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  rowTime: {
    fontSize: 12,
    fontWeight: '500',
    flexShrink: 0,
  },
  rowMeta: {
    marginTop: 4,
    fontSize: 11,
    fontWeight: '500',
    lineHeight: 16,
  },
  rowAmount: {
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 10,
    alignSelf: 'flex-start',
  },
});
