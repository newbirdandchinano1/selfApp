import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

export default function AssetsScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const surface = isDark ? 'rgba(15,23,42,0.9)' : theme.background;
  const card = theme.surface;
  const outlineVariant = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(226,232,240,0.75)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(100,116,139,0.8)';

  const primaryBlue = isDark ? '#60a5fa' : '#0058be';
  const secondaryGreen = isDark ? '#34d399' : '#006c49';
  const tertiaryAmber = isDark ? '#fbbf24' : '#825100';
  const errorRed = isDark ? '#f87171' : '#ba1a1a';

  const ringSize = 128;
  const ringStroke = 6;
  const r = (ringSize - ringStroke) / 2;
  const c = 2 * Math.PI * r;

  const cashPct = 0.12;
  const bankPct = 0.45;
  const investPct = 0.43;

  const dash = (p: number) => `${c * p} ${c * (1 - p)}`;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: surface }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)' }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="arrow-back" size={22} color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: isDark ? 'rgba(248,250,252,0.95)' : 'rgba(15,23,42,0.95)' }]}>资产</Text>
        <Pressable style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}>
          <MaterialIcons name="calendar-today" size={22} color={isDark ? 'rgba(148,163,184,0.9)' : 'rgba(100,116,139,0.9)'} />
        </Pressable>
      </View>
      <View style={[styles.headerDivider, { backgroundColor: outlineVariant }]} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Text style={[styles.kicker, { color: outline }]}>当前净资产</Text>
          <View style={styles.heroRow}>
            <Text style={[styles.netWorth, { color: theme.text }]}>¥1,452,080</Text>
            <View style={[styles.pill, { backgroundColor: `${secondaryGreen}1A` }]}>
              <MaterialIcons name="trending-up" size={16} color={secondaryGreen} />
              <Text style={[styles.pillText, { color: secondaryGreen }]}>2.4%</Text>
            </View>
          </View>

          <View style={styles.totalsRow}>
            <View style={styles.totalBlock}>
              <Text style={[styles.totalLabel, { color: outline }]}>总资产</Text>
              <Text style={[styles.totalValue, { color: theme.text }]}>¥1,824,300</Text>
            </View>
            <View style={[styles.vDivider, { backgroundColor: `${outlineVariant}80` }]} />
            <View style={styles.totalBlock}>
              <Text style={[styles.totalLabel, { color: outline }]}>总负债</Text>
              <Text style={[styles.totalValue, { color: errorRed }]}>¥372,220</Text>
            </View>
          </View>
        </View>

        <View style={styles.bento}>
          <View style={[styles.assetCard, { backgroundColor: card, borderColor: `${outlineVariant}40` }]}>
            <Text style={[styles.cardTitle, { color: theme.text }]}>资产配置</Text>
            <View style={styles.assetRow}>
              <View style={styles.ringWrap}>
                <Svg width={ringSize} height={ringSize} viewBox={`0 0 ${ringSize} ${ringSize}`} style={{ transform: [{ rotate: '-90deg' }] }}>
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={isDark ? 'rgba(148,163,184,0.12)' : 'rgba(226,231,255,0.95)'} strokeWidth={2} fill="none" />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={tertiaryAmber} strokeWidth={ringStroke} strokeDasharray={dash(cashPct)} strokeDashoffset={c * (1 - cashPct)} fill="none" />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={primaryBlue} strokeWidth={ringStroke} strokeDasharray={dash(bankPct)} strokeDashoffset={c * (1 - bankPct)} fill="none" transform={`rotate(${cashPct * 360} ${ringSize / 2} ${ringSize / 2})`} />
                  <Circle cx={ringSize / 2} cy={ringSize / 2} r={r} stroke={secondaryGreen} strokeWidth={ringStroke} strokeDasharray={dash(investPct)} strokeDashoffset={c * (1 - investPct)} fill="none" transform={`rotate(${(cashPct + bankPct) * 360} ${ringSize / 2} ${ringSize / 2})`} />
                </Svg>
                <Text style={[styles.ringText, { color: theme.text }]}>75%</Text>
              </View>

              <View style={styles.legend}>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: tertiaryAmber }]} />
                  <Text style={[styles.legendText, { color: theme.text }]}>现金 (12%)</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: primaryBlue }]} />
                  <Text style={[styles.legendText, { color: theme.text }]}>银行 (45%)</Text>
                </View>
                <View style={styles.legendRow}>
                  <View style={[styles.legendDot, { backgroundColor: secondaryGreen }]} />
                  <Text style={[styles.legendText, { color: theme.text }]}>投资 (43%)</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={[styles.growthCard, { backgroundColor: tertiaryAmber }]}>
            <View style={styles.growthTop}>
              <Text style={styles.growthKicker}>增长预测</Text>
              <Text style={styles.growthTitle}>预计下月增长 +¥12k</Text>
            </View>
            <Pressable
              onPress={() => router.push('/ai-finance-analysis')}
              style={({ pressed }) => [styles.growthBtn, pressed && { opacity: 0.8 }]}>
              <Text style={styles.growthBtnText}>查看分析</Text>
              <MaterialIcons name="arrow-forward" size={16} color="#fff" />
            </Pressable>
            <View style={[styles.growthGlow, { backgroundColor: isDark ? 'rgba(217,119,6,0.45)' : 'rgba(163,103,0,0.35)' }]} />
          </View>
        </View>

        <View style={styles.accounts}>
          <View style={styles.addAccountRow}>
            <Pressable
              onPress={() => router.push('/add-account')}
              style={({ pressed }) => [styles.addAccountBtn, { backgroundColor: `${primaryBlue}1A` }, pressed && { opacity: 0.85 }]}>
              <MaterialIcons name="add" size={18} color={primaryBlue} />
              <Text style={[styles.addAccountText, { color: primaryBlue }]}>添加新账户</Text>
            </Pressable>
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="wallet" size={20} color={tertiaryAmber} />
                <Text style={[styles.groupTitle, { color: theme.text }]}>现金与钱包</Text>
              </View>
              <Text style={[styles.groupSum, { color: tertiaryAmber }]}>¥218,440</Text>
            </View>

            <Pressable style={({ pressed }) => [styles.accountRow, { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: tertiaryAmber }, pressed && { opacity: 0.85 }]}>
              <View style={styles.accountLeft}>
                <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                  <MaterialIcons name="payments" size={20} color={tertiaryAmber} />
                </View>
                <View>
                  <Text style={[styles.accountName, { color: theme.text }]}>实库现金</Text>
                  <Text style={[styles.accountMeta, { color: outline }]}>手持现金</Text>
                </View>
              </View>
              <Text style={[styles.accountAmount, { color: theme.text }]}>¥12,400</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.accountRow, { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: tertiaryAmber }, pressed && { opacity: 0.85 }]}>
              <View style={styles.accountLeft}>
                <Image
                  source={{ uri: 'https://lh3.googleusercontent.com/aida-public/AB6AXuBNP3WIUjApmbo6iDZWpuMOlVC8c9VpoSJaFIQiEwMXQSzCPo4ImTnKcjWQeASz1Xv-oXq45m_4IvZpG7CmAAjhDyS3kcRBltWAG76Dwj8E7DC7R-5Rvj6qFaX6XWGdm2hCEOFmCo2KIw0Q-f-X4yGrfFIGSualv0ei-hIlxHKgLdMP8urS7jxFEaa0rB5XKkVQ33B29pG7XTlv02QsX2rpOHqQ1JlOtVku2n3hW20uyOD4x0Dplx2-6ytBP50sGBDl1ZuYfbJW_haz' }}
                  style={styles.accountImage}
                />
                <View>
                  <Text style={[styles.accountName, { color: theme.text }]}>支付宝</Text>
                  <Text style={[styles.accountMeta, { color: outline }]}>数字钱包</Text>
                </View>
              </View>
              <Text style={[styles.accountAmount, { color: theme.text }]}>¥206,040</Text>
            </Pressable>
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="account-balance" size={20} color={primaryBlue} />
                <Text style={[styles.groupTitle, { color: theme.text }]}>银行账户</Text>
              </View>
              <Text style={[styles.groupSum, { color: primaryBlue }]}>¥820,500</Text>
            </View>

            <Pressable style={({ pressed }) => [styles.accountRow, { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: primaryBlue }, pressed && { opacity: 0.85 }]}>
              <View style={styles.accountLeft}>
                <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                  <MaterialIcons name="domain" size={20} color={primaryBlue} />
                </View>
                <View>
                  <Text style={[styles.accountName, { color: theme.text }]}>中国工商银行</Text>
                  <Text style={[styles.accountMeta, { color: outline }]}>工资卡 (**** 8821)</Text>
                </View>
              </View>
              <Text style={[styles.accountAmount, { color: theme.text }]}>¥540,500</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.accountRow, { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: primaryBlue }, pressed && { opacity: 0.85 }]}>
              <View style={styles.accountLeft}>
                <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                  <MaterialIcons name="savings" size={20} color={primaryBlue} />
                </View>
                <View>
                  <Text style={[styles.accountName, { color: theme.text }]}>招商银行</Text>
                  <Text style={[styles.accountMeta, { color: outline }]}>储蓄账户 (**** 3302)</Text>
                </View>
              </View>
              <Text style={[styles.accountAmount, { color: theme.text }]}>¥280,000</Text>
            </Pressable>
          </View>

          <View style={styles.group}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="show-chart" size={20} color={secondaryGreen} />
                <Text style={[styles.groupTitle, { color: theme.text }]}>投资项目</Text>
              </View>
              <Text style={[styles.groupSum, { color: secondaryGreen }]}>¥785,360</Text>
            </View>

            <Pressable style={({ pressed }) => [styles.accountRow, { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: secondaryGreen }, pressed && { opacity: 0.85 }]}>
              <View style={styles.accountLeft}>
                <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                  <MaterialIcons name="bar-chart" size={20} color={secondaryGreen} />
                </View>
                <View>
                  <Text style={[styles.accountName, { color: theme.text }]}>公募基金</Text>
                  <Text style={[styles.accountMeta, { color: outline }]}>多元化投资组合</Text>
                </View>
              </View>
              <Text style={[styles.accountAmount, { color: theme.text }]}>¥412,000</Text>
            </Pressable>

            <Pressable style={({ pressed }) => [styles.accountRow, { backgroundColor: isDark ? 'rgba(148,163,184,0.10)' : 'rgba(242,243,255,0.9)', borderLeftColor: secondaryGreen }, pressed && { opacity: 0.85 }]}>
              <View style={styles.accountLeft}>
                <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                  <MaterialIcons name="show-chart" size={20} color={secondaryGreen} />
                </View>
                <View>
                  <Text style={[styles.accountName, { color: theme.text }]}>股票</Text>
                  <Text style={[styles.accountMeta, { color: outline }]}>NASDAQ & HKG</Text>
                </View>
              </View>
              <Text style={[styles.accountAmount, { color: theme.text }]}>¥373,360</Text>
            </Pressable>
          </View>

          <View style={[styles.group, { borderTopColor: `${outlineVariant}80`, borderTopWidth: 1, paddingTop: 18 }]}>
            <View style={styles.groupHeader}>
              <View style={styles.groupHeaderLeft}>
                <MaterialIcons name="credit-card-off" size={20} color={errorRed} />
                <Text style={[styles.groupTitle, { color: errorRed }]}>负债</Text>
              </View>
              <Text style={[styles.groupSum, { color: errorRed }]}>¥372,220</Text>
            </View>

            <View style={styles.debtList}>
              <View style={[styles.debtRow, { backgroundColor: `${errorRed}1A`, borderLeftColor: errorRed }]}>
                <View style={styles.accountLeft}>
                  <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                    <MaterialIcons name="credit-card" size={20} color={errorRed} />
                  </View>
                  <View>
                    <Text style={[styles.accountName, { color: theme.text }]}>信用卡</Text>
                    <Text style={[styles.accountMeta, { color: outline }]}>当前账单余额</Text>
                  </View>
                </View>
                <Text style={[styles.accountAmount, { color: errorRed }]}>¥42,220</Text>
              </View>

              <View style={[styles.debtRow, { backgroundColor: `${errorRed}1A`, borderLeftColor: errorRed }]}>
                <View style={styles.accountLeft}>
                  <View style={[styles.accountIconBox, { backgroundColor: card }]}>
                    <MaterialIcons name="real-estate-agent" size={20} color={errorRed} />
                  </View>
                  <View>
                    <Text style={[styles.accountName, { color: theme.text }]}>个人贷款</Text>
                    <Text style={[styles.accountMeta, { color: outline }]}>待还本金</Text>
                  </View>
                </View>
                <Text style={[styles.accountAmount, { color: errorRed }]}>¥330,000</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 12 },
  headerIconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 16, fontWeight: '800', letterSpacing: -0.3 },
  headerDivider: { height: 1, width: '100%', opacity: 0.6 },
  content: { paddingHorizontal: 18, paddingTop: 18, paddingBottom: 110, gap: 18 },
  hero: { gap: 10, paddingTop: 6, paddingBottom: 10 },
  kicker: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' },
  netWorth: { fontSize: 44, fontWeight: '900', letterSpacing: -1.4, lineHeight: 52 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999 },
  pillText: { fontSize: 14, fontWeight: '900' },
  totalsRow: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 4 },
  totalBlock: { gap: 4 },
  totalLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase' },
  totalValue: { fontSize: 15, fontWeight: '800' },
  vDivider: { width: 1, height: 28, borderRadius: 1 },
  bento: { gap: 12 },
  assetCard: { borderRadius: 16, padding: 16, borderWidth: 1 },
  cardTitle: { fontSize: 18, fontWeight: '900', marginBottom: 14 },
  assetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 18 },
  ringWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  ringText: { position: 'absolute', fontSize: 16, fontWeight: '900' },
  legend: { flex: 1, gap: 10 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 14, fontWeight: '600' },
  growthCard: { borderRadius: 16, padding: 16, overflow: 'hidden', minHeight: 160, justifyContent: 'space-between' },
  growthTop: { gap: 6, zIndex: 2 },
  growthKicker: { color: 'rgba(255,255,255,0.85)', fontSize: 10, fontWeight: '900', letterSpacing: 2, textTransform: 'uppercase' },
  growthTitle: { color: '#fff', fontSize: 20, fontWeight: '900', letterSpacing: -0.4 },
  growthBtn: { zIndex: 2, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', backgroundColor: 'rgba(255,255,255,0.10)' },
  growthBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  growthGlow: { position: 'absolute', right: -60, bottom: -60, width: 220, height: 220, borderRadius: 999, opacity: 0.55 },
  accounts: { gap: 18 },
  addAccountRow: { alignItems: 'flex-end' },
  addAccountBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999 },
  addAccountText: { fontSize: 14, fontWeight: '900' },
  group: { gap: 12 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  groupHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupTitle: { fontSize: 16, fontWeight: '900' },
  groupSum: { fontSize: 12, fontWeight: '900', letterSpacing: 1.6, textTransform: 'uppercase' },
  accountRow: { borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderLeftWidth: 4 },
  accountLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, paddingRight: 12 },
  accountIconBox: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  accountImage: { width: 40, height: 40, borderRadius: 12 },
  accountName: { fontSize: 14, fontWeight: '800', marginBottom: 2 },
  accountMeta: { fontSize: 12, fontWeight: '600' },
  accountAmount: { fontSize: 16, fontWeight: '900' },
  debtList: {
    gap: 10,
    opacity: 0.92,
  },
  debtRow: {
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderLeftWidth: 4,
  },
});
