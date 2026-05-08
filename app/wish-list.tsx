import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type WishTarget = {
  id: string;
  name: string;
  subtitle: string;
  price: number;
  priorityText: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  highlighted?: boolean;
};

const wishItems: WishTarget[] = [
  {
    id: '1',
    name: '索尼 WH-1000XM5',
    subtitle: '专注深度工作',
    price: 2499,
    priorityText: '高优先级',
    icon: 'headset',
  },
  {
    id: '2',
    name: '赫曼米勒 Embody',
    subtitle: '人体工学健康',
    price: 10500,
    priorityText: 'AI 重点标注',
    icon: 'chair',
    highlighted: true,
  },
  {
    id: '3',
    name: 'Flos Bellhop 台灯',
    subtitle: '氛围营造',
    price: 1251,
    priorityText: '低优先级',
    icon: 'lightbulb-outline',
  },
];

const quarterTarget = 120000;

function formatCny(value: number): string {
  return `¥ ${value.toLocaleString('zh-CN')}`;
}

export default function WishListScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#faf8ff';
  const cardBg = isDark ? '#111827' : '#ffffff';
  const cardSoft = isDark ? '#1f2937' : '#f2f3ff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#424754';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const borderSoft = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.25)';

  const summary = useMemo(() => {
    const total = wishItems.reduce((sum, item) => sum + item.price, 0);
    const progress = Math.round((total / quarterTarget) * 100);
    return { total, progress };
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right', 'top']}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: Math.max(insets.top, 10) + 6,
            backgroundColor: isDark ? 'rgba(17,24,39,0.8)' : 'rgba(255,255,255,0.8)',
            borderBottomColor: borderSoft,
          },
        ]}>
        <Pressable style={styles.roundIconBtn} onPress={() => router.back()}>
          <MaterialIcons name="arrow-back-ios-new" size={20} color={primary} />
        </Pressable>
        <Text style={[styles.topBarTitle, { color: text }]}>量化生活清单</Text>
        <View style={styles.topBarRightSpacer} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: Math.max(insets.bottom, 12) + 100 }]}>
        <View style={styles.hero}>
          <Text style={[styles.heroTitle, { color: text }]}>欲望清单</Text>
          <Text style={[styles.heroSub, { color: outline }]}>精选心头好与理性消费计划。</Text>
        </View>

        <View style={[styles.summaryCard, { backgroundColor: cardBg }]}>
          <View style={[styles.summaryGlow, { backgroundColor: `${tertiary}14` }]} />
          <View>
            <Text style={[styles.summaryLabel, { color: outline }]}>总预估支出</Text>
            <Text style={[styles.summaryTotal, { color: tertiary }]}>{formatCny(summary.total)}</Text>
          </View>
          <View style={[styles.progressPill, { backgroundColor: `${tertiary}1F` }]}>
            <MaterialIcons name="trending-up" size={20} color={tertiary} />
            <Text style={[styles.progressPillText, { color: tertiary }]}>占Q3目标的{summary.progress}%</Text>
          </View>
        </View>

        <View style={[styles.aiReviewCard, { backgroundColor: cardSoft }]}>
          <View style={[styles.aiDecor, { backgroundColor: `${primary}12` }]} />
          <View style={styles.aiHead}>
            <View style={styles.aiKickerRow}>
              <MaterialIcons name="auto-awesome" size={18} color={primary} />
              <Text style={[styles.aiKicker, { color: primary }]}>AI 理性评审</Text>
            </View>
            <Text style={[styles.aiHeading, { color: text }]}>建议策略性延后</Text>
          </View>
          <View style={[styles.aiBody, { borderTopColor: borderSoft }]}>
            <Text style={[styles.aiText, { color: outline }]}>
              基于您当前的消费速度，本月购买
              <Text style={[styles.aiTextStrong, { color: text }]}> Herman Miller Embody </Text>
              椅子将导致您的储蓄目标达成率下降 30%。
            </Text>
            <Text style={[styles.aiText, { color: outline }]}>
              <Text style={[styles.aiAdviceTag, { color: primary }]}>评审建议：</Text>
              建议将该项支出延后至11月下旬，以匹配年度奖金发放，确保Q4流动性指标稳健。
            </Text>
          </View>
        </View>

        <View style={styles.listSection}>
          <Text style={[styles.listKicker, { color: outline }]}>目标好物</Text>
          {wishItems.map(item => (
            <View
              key={item.id}
              style={[
                styles.itemCard,
                {
                  backgroundColor: cardBg,
                  borderLeftColor: item.highlighted ? primary : 'transparent',
                  borderLeftWidth: item.highlighted ? 4 : 0,
                },
              ]}>
              <View style={[styles.itemIconWrap, { backgroundColor: cardSoft }]}>
                <MaterialIcons name={item.icon} size={28} color={text} />
              </View>
              <View style={styles.itemContent}>
                <View style={styles.itemTextWrap}>
                  <Text style={[styles.itemName, { color: text }]}>{item.name}</Text>
                  <Text style={[styles.itemSubtitle, { color: outline }]}>{item.subtitle}</Text>
                </View>
                <View style={styles.itemPriceWrap}>
                  <Text style={[styles.itemPrice, { color: tertiary }]}>{formatCny(item.price)}</Text>
                  <Text style={[styles.itemPriority, { color: item.highlighted ? primary : outline }]}>
                    {item.priorityText}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Pressable
        onPress={() => router.push('/add-wish-item' as any)}
        style={[
          styles.fab,
          {
            bottom: Math.max(insets.bottom, 12) + 12,
            backgroundColor: primary,
            shadowColor: '#131b2e',
          },
        ]}>
        <MaterialIcons name="add" size={20} color="#fff" />
        <Text style={styles.fabText}>添加新项目</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roundIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  topBarRightSpacer: {
    width: 36,
    height: 36,
  },
  scrollContent: {
    maxWidth: 900,
    width: '100%',
    alignSelf: 'center',
    paddingHorizontal: 22,
    paddingTop: 132,
    gap: 18,
  },
  hero: {
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  heroTitle: {
    fontSize: 52,
    lineHeight: 56,
    letterSpacing: -1.2,
    fontWeight: '900',
  },
  heroSub: {
    fontSize: 18,
    fontWeight: '500',
  },
  summaryCard: {
    borderRadius: 20,
    padding: 24,
    gap: 14,
    overflow: 'hidden',
  },
  summaryGlow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: '100%',
  },
  summaryLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  summaryTotal: {
    marginTop: 4,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: '900',
    letterSpacing: -1,
  },
  progressPill: {
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  progressPillText: {
    fontSize: 13,
    fontWeight: '700',
  },
  aiReviewCard: {
    borderRadius: 20,
    padding: 22,
    overflow: 'hidden',
    gap: 14,
  },
  aiDecor: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 999,
    right: -80,
    top: -130,
  },
  aiHead: {
    gap: 8,
  },
  aiKickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  aiKicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  aiHeading: {
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.8,
    fontWeight: '900',
  },
  aiBody: {
    borderTopWidth: 1,
    paddingTop: 12,
    gap: 10,
  },
  aiText: {
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '500',
  },
  aiTextStrong: {
    fontWeight: '700',
  },
  aiAdviceTag: {
    fontWeight: '700',
  },
  listSection: {
    gap: 12,
  },
  listKicker: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  itemCard: {
    borderRadius: 20,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  itemIconWrap: {
    width: 56,
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  itemTextWrap: {
    flex: 1,
  },
  itemName: {
    fontSize: 18,
    fontWeight: '900',
  },
  itemSubtitle: {
    marginTop: 4,
    fontSize: 14,
    fontWeight: '500',
  },
  itemPriceWrap: {
    alignItems: 'flex-end',
    gap: 4,
  },
  itemPrice: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  itemPriority: {
    fontSize: 12,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 20,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowOpacity: 0.24,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 16,
    elevation: 7,
  },
  fabText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.4,
  },
});
