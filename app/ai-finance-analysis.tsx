import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from 'react-native-svg';

export default function AiFinanceAnalysisScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const bg = isDark ? '#0f172a' : '#faf8ff';
  const surface = isDark ? '#1e293b' : '#ffffff';
  const surfaceLow = isDark ? 'rgba(148,163,184,0.10)' : '#f2f3ff';
  const text = isDark ? '#f8fafc' : '#131b2e';
  const subtle = isDark ? '#94a3b8' : '#64748b';
  const outline = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.5)';

  const tertiary = isDark ? '#fbbf24' : '#825100';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';

  const healthSize = 160;
  const healthStroke = 8;
  const healthR = (healthSize - healthStroke) / 2;
  const healthC = 2 * Math.PI * healthR;
  const healthPct = 0.85;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.82)' }]}>
        <View style={styles.headerLeft}>
          <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.75 }]}>
            <MaterialIcons name="arrow-back" size={22} color={text} />
          </Pressable>
          <Text style={[styles.headerTitle, { color: text }]}>AI 财务分析</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.gridGap}>
          <View style={[styles.summaryCard, { backgroundColor: surface }]}>
            <View style={[styles.leftAccent, { backgroundColor: tertiary }]} />
            <Text style={[styles.kicker, { color: subtle }]}>Monthly Summary</Text>
            <Text style={[styles.summaryTitle, { color: text }]}>本月收支概览</Text>

            <View style={styles.summaryRow}>
              <View>
                <Text style={[styles.label, { color: subtle }]}>Total Income</Text>
                <Text style={[styles.bigNum, { color: text }]}>¥42,850</Text>
              </View>
              <View>
                <Text style={[styles.label, { color: subtle }]}>Total Expense</Text>
                <Text style={[styles.bigNum, { color: tertiary }]}>¥18,240</Text>
              </View>
            </View>

            <View style={[styles.summaryFooter, { borderTopColor: outline }]}>
              <View style={styles.inlineRow}>
                <MaterialIcons name="trending-up" size={15} color={secondary} />
                <Text style={[styles.saveText, { color: secondary }]}>比上月节省 12%</Text>
              </View>
              <Pressable style={styles.inlineRow}>
                <Text style={[styles.linkText, { color: primary }]}>查看明细</Text>
                <MaterialIcons name="chevron-right" size={16} color={primary} />
              </Pressable>
            </View>
          </View>

          <View style={[styles.healthCard, { backgroundColor: surfaceLow }]}>
            <Text style={[styles.kicker, { color: subtle }]}>Health Score</Text>
            <View style={styles.healthWrap}>
              <Svg width={healthSize} height={healthSize} style={{ transform: [{ rotate: '-90deg' }] }}>
                <Circle cx={healthSize / 2} cy={healthSize / 2} r={healthR} stroke={isDark ? 'rgba(148,163,184,0.25)' : 'rgba(194,198,214,0.35)'} strokeWidth={2} fill="none" />
                <Circle cx={healthSize / 2} cy={healthSize / 2} r={healthR} stroke={tertiary} strokeWidth={healthStroke} strokeDasharray={`${healthC * healthPct} ${healthC * (1 - healthPct)}`} strokeLinecap="butt" fill="none" />
              </Svg>
              <View style={styles.healthCenter}>
                <Text style={[styles.healthScore, { color: text }]}>85</Text>
                <Text style={[styles.healthTotal, { color: subtle }]}>/ 100</Text>
              </View>
            </View>
            <Text style={[styles.healthTitle, { color: text }]}>财务健康分</Text>
            <Text style={[styles.healthDesc, { color: subtle }]}>您的财务状况处于优良等级，储蓄率稳定。</Text>
          </View>
        </View>

        <View style={styles.gridGap}>
          <View style={[styles.panelCard, { backgroundColor: surface }]}>
            <View style={styles.panelTitleRow}>
              <Text style={[styles.panelTitle, { color: text }]}>支出分类构成</Text>
              <MaterialIcons name="pie-chart" size={20} color={subtle} />
            </View>

            {[
              { name: '餐饮美食', val: '¥ 5,472 (30%)', pct: 0.3, color: tertiary },
              { name: '交通出行', val: '¥ 3,648 (20%)', pct: 0.2, color: '#94a3b8' },
              { name: '购物消费', val: '¥ 2,736 (15%)', pct: 0.15, color: '#cbd5e1' },
            ].map((row) => (
              <View key={row.name} style={styles.barBlock}>
                <View style={styles.barHead}>
                  <Text style={[styles.barName, { color: text }]}>{row.name}</Text>
                  <Text style={[styles.barVal, { color: text }]}>{row.val}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: isDark ? 'rgba(148,163,184,0.2)' : '#f1f5f9' }]}>
                  <View style={[styles.fill, { width: `${row.pct * 100}%`, backgroundColor: row.color }]} />
                </View>
              </View>
            ))}

            <View style={[styles.tipCard, { backgroundColor: isDark ? 'rgba(148,163,184,0.12)' : '#f8fafc', borderColor: outline }]}>
              <MaterialIcons name="lightbulb" size={18} color={tertiary} />
              <Text style={[styles.tipText, { color: subtle }]}>本月餐饮支出波动较大，主要集中在周末的社交活动。</Text>
            </View>
          </View>

          <View style={[styles.panelCard, { backgroundColor: surface }]}>
            <View style={styles.panelTitleRow}>
              <Text style={[styles.panelTitle, { color: text }]}>储蓄增长预测</Text>
              <View style={[styles.badge, { backgroundColor: isDark ? 'rgba(251,191,36,0.2)' : '#ffddb8' }]}>
                <Text style={[styles.badgeText, { color: tertiary }]}>FORECAST</Text>
              </View>
            </View>
            <Text style={[styles.healthDesc, { color: subtle, marginBottom: 8 }]}>基于当前收入与支出频率的未来 6 个月预估</Text>

            <View style={styles.chartBox}>
              <Svg width="100%" height="180" viewBox="0 0 400 200">
                {[180, 130, 80, 30].map((y) => (
                  <Line key={y} x1="0" y1={y} x2="400" y2={y} stroke={isDark ? 'rgba(148,163,184,0.16)' : '#f1f5f9'} strokeWidth="1" />
                ))}
                <Path d="M 0,160 Q 40,155 80,145 T 160,120 T 240,85 T 320,55 T 400,20" fill="none" stroke={tertiary} strokeWidth="3" />
                <Defs>
                  <LinearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={tertiary} stopOpacity="0.2" />
                    <Stop offset="1" stopColor={tertiary} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Path d="M 0,160 Q 40,155 80,145 T 160,120 T 240,85 T 320,55 T 400,20 V 200 H 0 Z" fill="url(#forecastGrad)" />
                {[{ x: 80, y: 145 }, { x: 160, y: 120 }, { x: 240, y: 85 }, { x: 320, y: 55 }, { x: 400, y: 20 }].map((p, i) => (
                  <Circle key={i} cx={p.x} cy={p.y} r={i === 4 ? 5 : 4} fill={tertiary} stroke={i === 4 ? '#fff' : 'none'} strokeWidth={2} />
                ))}
              </Svg>
              <View style={styles.monthLabels}>
                {['1月', '2月', '3月', '4月', '5月', '6月'].map((m, idx) => (
                  <Text key={m} style={[styles.monthLabel, { color: idx === 5 ? tertiary : subtle }]}>{m}</Text>
                ))}
              </View>
            </View>

            <View style={styles.forecastFooter}>
              <View style={styles.inlineRow}>
                <Text style={[styles.forecastValue, { color: text }]}>¥ 152,400</Text>
                <Text style={[styles.forecastUp, { color: secondary }]}>+18.5%</Text>
              </View>
              <Text style={[styles.forecastMeta, { color: subtle }]}>预计 2024.12 达成目标</Text>
            </View>
          </View>
        </View>

        <View style={styles.insightSection}>
          <View style={styles.insightHead}>
            <View style={[styles.insightLine, { backgroundColor: tertiary }]} />
            <Text style={[styles.insightTitle, { color: text }]}>AI 深度洞察</Text>
          </View>

          <View style={styles.gridGap}>
            <View style={[styles.insightCard, { backgroundColor: surfaceLow, borderColor: outline }]}>
              <View style={styles.inlineRow}>
                <MaterialIcons name="verified" size={18} color={secondary} />
                <Text style={[styles.insightKicker, { color: subtle }]}>Asset Safety</Text>
              </View>
              <Text style={[styles.insightBody, { color: subtle }]}>风险预警：下月有两笔固定保险扣款，建议提前在活期账户预留 ¥4,500 资金。</Text>
            </View>

            <View style={[styles.insightCard, { backgroundColor: surfaceLow, borderColor: outline }]}>
              <View style={styles.inlineRow}>
                <MaterialIcons name="savings" size={18} color={primary} />
                <Text style={[styles.insightKicker, { color: subtle }]}>Investment Opt.</Text>
              </View>
              <Text style={[styles.insightBody, { color: subtle }]}>投资建议：由于本月结余超出预期，建议将闲置的 ¥5,000 转入中低风险货币基金以对冲通胀。</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '900' },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 28, gap: 12 },
  gridGap: { gap: 12 },

  summaryCard: { borderRadius: 16, padding: 18, minHeight: 260, overflow: 'hidden' },
  leftAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  kicker: { fontSize: 11, fontWeight: '800', letterSpacing: 1.4, textTransform: 'uppercase' },
  summaryTitle: { marginTop: 10, marginBottom: 24, fontSize: 28, fontWeight: '900' },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 16 },
  label: { fontSize: 13, fontWeight: '600' },
  bigNum: { marginTop: 6, fontSize: 36, fontWeight: '900', letterSpacing: -0.5 },
  summaryFooter: { marginTop: 22, paddingTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1 },
  inlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  saveText: { fontSize: 13, fontWeight: '700' },
  linkText: { fontSize: 13, fontWeight: '700' },

  healthCard: { borderRadius: 16, padding: 18, alignItems: 'center' },
  healthWrap: { marginTop: 8, width: 160, height: 160, alignItems: 'center', justifyContent: 'center' },
  healthCenter: { position: 'absolute', alignItems: 'center' },
  healthScore: { fontSize: 42, fontWeight: '900' },
  healthTotal: { fontSize: 12, fontWeight: '800' },
  healthTitle: { marginTop: 12, fontSize: 22, fontWeight: '900' },
  healthDesc: { marginTop: 6, fontSize: 13, lineHeight: 20, fontWeight: '600' },

  panelCard: { borderRadius: 16, padding: 18 },
  panelTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  panelTitle: { fontSize: 22, fontWeight: '900' },
  barBlock: { marginBottom: 14 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  barName: { fontSize: 13, fontWeight: '700' },
  barVal: { fontSize: 13, fontWeight: '700' },
  track: { height: 6, borderRadius: 999, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
  tipCard: { marginTop: 12, borderRadius: 12, borderWidth: 1, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  tipText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600' },

  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  chartBox: { marginTop: 8 },
  monthLabels: { marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' },
  monthLabel: { fontSize: 10, fontWeight: '800' },
  forecastFooter: { marginTop: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  forecastValue: { fontSize: 28, fontWeight: '900' },
  forecastUp: { fontSize: 12, fontWeight: '900' },
  forecastMeta: { fontSize: 12, fontWeight: '600' },

  insightSection: { marginTop: 4, gap: 12 },
  insightHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  insightLine: { width: 48, height: 2 },
  insightTitle: { fontSize: 26, fontWeight: '900' },
  insightCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 8 },
  insightKicker: { fontSize: 11, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
  insightBody: { fontSize: 13, lineHeight: 20, fontWeight: '600' },
});
