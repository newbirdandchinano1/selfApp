import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type WishItem = {
  id: string;
  name: string;
  category: string;
  price: number;
  priority: '高' | '中' | '低';
  reason: string;
};

const wishItems: WishItem[] = [
  { id: '1', name: 'iPad Pro 11"', category: '数码', price: 6999, priority: '高', reason: '学习和做笔记' },
  { id: '2', name: '人体工学椅', category: '家居', price: 2899, priority: '高', reason: '久坐办公保护腰背' },
  { id: '3', name: '降噪耳机', category: '数码', price: 1999, priority: '中', reason: '提升专注效率' },
  { id: '4', name: '周末短途旅行', category: '体验', price: 1800, priority: '低', reason: '放松和充电' },
];

const budgetCap = 15000;

function formatCny(value: number): string {
  return `¥${value.toLocaleString('zh-CN')}`;
}

export default function WishListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? theme.surface : '#ffffff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.85)' : '#727785';
  const accent = isDark ? '#f472b6' : '#b42375';
  const accentSoft = isDark ? 'rgba(244,114,182,0.18)' : 'rgba(180,35,117,0.12)';

  const summary = useMemo(() => {
    const total = wishItems.reduce((sum, item) => sum + item.price, 0);
    const remaining = budgetCap - total;
    const progress = Math.min(100, Math.round((total / budgetCap) * 100));
    return { total, remaining, progress };
  }, []);

  const priorityColor = (priority: WishItem['priority']) => {
    if (priority === '高') return '#ef4444';
    if (priority === '中') return '#f59e0b';
    return '#10b981';
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 12) + 32 }]}
      >
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={[styles.backBtn, { borderColor: `${accent}33` }]}>
            <MaterialIcons name="arrow-back-ios-new" size={18} color={accent} />
          </Pressable>
          <View style={styles.headerTextWrap}>
            <Text style={[styles.headerKicker, { color: outline }]}>MONEY INTENTION</Text>
            <Text style={[styles.headerTitle, { color: text }]}>欲望清单</Text>
          </View>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: surface, borderColor: `${accent}22` }]}>
          <View style={[styles.summaryLine, { backgroundColor: `${accent}66` }]} />
          <Text style={[styles.summaryLabel, { color: outline }]}>预计总支出</Text>
          <Text style={[styles.summaryTotal, { color: text }]}>{formatCny(summary.total)}</Text>
          <Text style={[styles.summarySub, { color: outline }]}>
            预算上限 {formatCny(budgetCap)} · 剩余 {formatCny(summary.remaining)}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: accentSoft }]}>
            <View style={[styles.progressFill, { width: `${summary.progress}%`, backgroundColor: accent }]} />
          </View>
          <Text style={[styles.progressText, { color: accent }]}>{summary.progress}% 已占用预算</Text>
        </View>

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: text }]}>想买的东西</Text>
          <Text style={[styles.sectionMeta, { color: outline }]}>{wishItems.length} 项</Text>
        </View>

        <View style={styles.listWrap}>
          {wishItems.map(item => (
            <View key={item.id} style={[styles.itemCard, { backgroundColor: surface, borderColor: `${accent}1A` }]}>
              <View style={styles.itemTop}>
                <View>
                  <Text style={[styles.itemName, { color: text }]}>{item.name}</Text>
                  <Text style={[styles.itemCategory, { color: outline }]}>{item.category}</Text>
                </View>
                <Text style={[styles.itemPrice, { color: accent }]}>{formatCny(item.price)}</Text>
              </View>
              <View style={styles.itemBottom}>
                <View style={[styles.priorityPill, { backgroundColor: `${priorityColor(item.priority)}1A` }]}>
                  <Text style={[styles.priorityText, { color: priorityColor(item.priority) }]}>
                    {item.priority}优先级
                  </Text>
                </View>
                <Text style={[styles.itemReason, { color: outline }]}>{item.reason}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.sectionHead}>
          <Text style={[styles.sectionTitle, { color: text }]}>AI 评审（预留）</Text>
        </View>

        <View style={[styles.aiPlaceholder, { backgroundColor: surface, borderColor: `${accent}22` }]}>
          <View style={[styles.aiIcon, { backgroundColor: accent }]}>
            <MaterialIcons name="auto-awesome" size={22} color="#fff" />
          </View>
          <View style={styles.aiTextWrap}>
            <Text style={[styles.aiTitle, { color: text }]}>智能消费评审位</Text>
            <Text style={[styles.aiDesc, { color: outline }]}>
              这里后续可以接入 AI，从必要性、性价比、预算压力三个角度给出购买建议。
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 16,
    gap: 16,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextWrap: {
    flex: 1,
  },
  headerKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  headerTitle: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  summaryCard: {
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
    gap: 6,
  },
  summaryLine: {
    height: 3,
    width: '100%',
    borderRadius: 999,
    marginBottom: 2,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  summaryTotal: {
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -1,
  },
  summarySub: {
    fontSize: 13,
    fontWeight: '600',
  },
  progressTrack: {
    marginTop: 8,
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressText: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: '700',
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  sectionMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  listWrap: {
    gap: 10,
  },
  itemCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  itemTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  itemName: {
    fontSize: 18,
    fontWeight: '800',
  },
  itemCategory: {
    marginTop: 4,
    fontSize: 12,
    fontWeight: '600',
  },
  itemPrice: {
    fontSize: 19,
    fontWeight: '900',
  },
  itemBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  priorityPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '800',
  },
  itemReason: {
    fontSize: 12,
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  aiPlaceholder: {
    borderWidth: 1,
    borderRadius: 24,
    padding: 16,
    flexDirection: 'row',
    gap: 12,
  },
  aiIcon: {
    width: 46,
    height: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiTextWrap: {
    flex: 1,
    gap: 6,
  },
  aiTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  aiDesc: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
  },
});
