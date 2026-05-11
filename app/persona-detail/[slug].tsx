import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PERSONA_SLUGS = ['plan-completion', 'body-composition', 'hydration', 'savings', 'ai-insight'] as const;
export type PersonaDetailSlug = (typeof PERSONA_SLUGS)[number];

function isPersonaSlug(s: string): s is PersonaDetailSlug {
  return (PERSONA_SLUGS as readonly string[]).includes(s);
}

function pickSlug(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function SectionCard({
  children,
  surface,
  border,
}: {
  children: React.ReactNode;
  surface: string;
  border: string;
}) {
  return <View style={[styles.sectionCard, { backgroundColor: surface, borderColor: border }]}>{children}</View>;
}

function SectionTitle({ text, color }: { text: string; color: string }) {
  return (
    <Text style={[styles.sectionTitle, { color }]}>
      {text}
    </Text>
  );
}

function Bullet({ text, muted }: { text: string; muted: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={[styles.bulletDot, { backgroundColor: muted }]} />
      <Text style={[styles.bulletText, { color: muted }]}>{text}</Text>
    </View>
  );
}

function RelLink({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.relLink, { opacity: pressed ? 0.85 : 1 }]}
    >
      <Text style={[styles.relLinkText, { color: primary }]}>{label}</Text>
      <MaterialIcons name="chevron-right" size={22} color={primary} />
    </Pressable>
  );
}

export default function PersonaDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const raw = useLocalSearchParams<{ slug: string | string[] }>().slug;
  const slug = pickSlug(raw) ?? '';
  const valid = isPersonaSlug(slug);

  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.9)' : '#424754';
  const borderSoft = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.25)';
  const surface = isDark ? '#111827' : '#ffffff';
  const bg = isDark ? theme.background : '#faf8ff';

  const [user, setUser] = useState<UserRow | null>(null);
  useEffect(() => {
    if (!valid || slug !== 'body-composition') return;
    let alive = true;
    void (async () => {
      try {
        const u = await getDefaultUser();
        if (alive) setUser(u);
      } catch {
        if (alive) setUser(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [valid, slug]);

  const bmiText = useMemo(() => {
    if (!user || !user.height || !user.weight) return '—';
    const h = user.height / 100;
    const v = user.weight / (h * h);
    return Number.isFinite(v) ? v.toFixed(1) : '—';
  }, [user]);

  const pageTitle = useMemo(() => {
    if (!valid) return '画像详情';
    const titles: Record<PersonaDetailSlug, string> = {
      'plan-completion': '计划完成情况',
      'body-composition': '体脂与身体成分',
      hydration: '饮水与代谢',
      savings: '储蓄人格画像',
      'ai-insight': 'AI 智能人格洞察',
    };
    return titles[slug];
  }, [valid, slug]);

  const heroAccent = useMemo(() => {
    if (!valid) return primary;
    const map: Record<PersonaDetailSlug, string> = {
      'plan-completion': primary,
      'body-composition': secondary,
      hydration: primary,
      savings: tertiary,
      'ai-insight': primary,
    };
    return map[slug];
  }, [valid, slug, primary, secondary, tertiary]);

  const goTasks = useCallback(() => router.push('/(tabs)/tasks'), [router]);
  const goHealth = useCallback(() => router.push('/health-calendar'), [router]);
  const goIntake = useCallback(() => router.push('/intake-history'), [router]);
  const goSavings = useCallback(() => router.push('/savings-plan'), [router]);
  const goProfile = useCallback(() => router.push('/edit-profile'), [router]);
  const goWishList = useCallback(() => router.push('/wish-list'), [router]);

  const progressBg = require('../../assets/profile/progress.png');
  const healthBg = require('../../assets/profile/health.png');
  const waterBg = require('../../assets/profile/water.png');
  const savingsBg = require('../../assets/profile/savings.png');

  const renderBody = () => {
    if (!valid) {
      return (
        <View style={styles.emptyWrap}>
          <MaterialIcons name="sentiment-dissatisfied" size={48} color={outline} />
          <Text style={[styles.emptyTitle, { color: text }]}>未找到该画像卡片</Text>
          <Text style={[styles.emptySub, { color: outline }]}>请从个人资料页的 AI 人格画像入口进入。</Text>
        </View>
      );
    }

    switch (slug) {
      case 'plan-completion':
        return (
          <>
            <View style={[styles.heroImageCard, { overflow: 'hidden' }]}>
              <Image source={progressBg} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              <View style={[styles.heroTint, { backgroundColor: `${primary}99` }]} />
              <View style={styles.heroInner}>
                <Text style={styles.heroKicker}>EXECUTION</Text>
                <Text style={styles.heroValue}>85%</Text>
                <Text style={styles.heroCaption}>本周目标达成率 · 卓越区间</Text>
              </View>
            </View>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="执行概览" color={text} />
              <Text style={[styles.para, { color: outline }]}>
                该维度综合统计你在任务与习惯上的闭环速度：按时完成率、延期恢复率与「青蛙」优先级执行情况。当前样本为画像示意数据，后续可与任务模块实时同步。
              </Text>
              <View style={styles.statGrid}>
                {[
                  { label: '按时完成', value: '72%', hint: '较上周 +6%' },
                  { label: '高优任务', value: '8/10', hint: '青蛙完成度' },
                  { label: '恢复速度', value: '快', hint: '延期后 48h 内补做' },
                ].map(row => (
                  <View key={row.label} style={[styles.statCell, { borderColor: borderSoft }]}>
                    <Text style={[styles.statLabel, { color: outline }]}>{row.label}</Text>
                    <Text style={[styles.statValue, { color: text }]}>{row.value}</Text>
                    <Text style={[styles.statHint, { color: outline }]}>{row.hint}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="节奏建议" color={text} />
              <Bullet
                muted={outline}
                text="将「高认知成本」任务固定在精力峰值时段，避免与低收益琐事堆叠。"
              />
              <Bullet muted={outline} text="每周保留一次「复盘块」，把未闭环项压缩到三条以内再排期。" />
            </SectionCard>
            <RelLink label="前往任务中心" onPress={goTasks} primary={primary} />
          </>
        );

      case 'body-composition':
        return (
          <>
            <View style={[styles.heroImageCard, { overflow: 'hidden' }]}>
              <Image source={healthBg} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              <View style={[styles.heroTint, { backgroundColor: `${secondary}99` }]} />
              <View style={styles.heroInner}>
                <Text style={styles.heroKicker}>BODY</Text>
                <Text style={styles.heroValue}>18%</Text>
                <Text style={styles.heroCaption}>体脂率 · 健康态（示意）</Text>
              </View>
            </View>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="与档案联动" color={text} />
              <Text style={[styles.para, { color: outline }]}>
                你在资料页填写的身高、体重用于推算 BMI，与体脂趋势一起构成「身体自律」人格侧写。
              </Text>
              <View style={styles.profileFacts}>
                <View style={[styles.factRow, { borderColor: borderSoft }]}>
                  <Text style={[styles.factLabel, { color: outline }]}>身高</Text>
                  <Text style={[styles.factValue, { color: text }]}>{user?.height ? `${user.height} cm` : '—'}</Text>
                </View>
                <View style={[styles.factRow, { borderColor: borderSoft }]}>
                  <Text style={[styles.factLabel, { color: outline }]}>体重</Text>
                  <Text style={[styles.factValue, { color: text }]}>{user?.weight ? `${user.weight} kg` : '—'}</Text>
                </View>
                <View style={[styles.factRow, { borderColor: borderSoft }]}>
                  <Text style={[styles.factLabel, { color: outline }]}>BMI</Text>
                  <Text style={[styles.factValue, { color: text }]}>{bmiText}</Text>
                </View>
              </View>
            </SectionCard>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="解读备忘" color={text} />
              <Bullet
                muted={outline}
                text="体脂率需结合训练量与饮食结构解读，单点数值不构成医疗建议。"
              />
              <Bullet muted={outline} text="若处于增肌期，短期体脂波动属于正常现象。" />
            </SectionCard>
            <RelLink label="健康日历" onPress={goHealth} primary={secondary} />
            <RelLink label="编辑身体数据" onPress={goProfile} primary={primary} />
          </>
        );

      case 'hydration':
        return (
          <>
            <View style={[styles.heroImageCard, { overflow: 'hidden' }]}>
              <Image source={waterBg} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              <View style={[styles.heroTint, { backgroundColor: `${primary}88` }]} />
              <View style={styles.heroInner}>
                <Text style={styles.heroKicker}>HYDRATION</Text>
                <Text style={styles.heroValue}>1.8L</Text>
                <Text style={styles.heroCaption}>近 7 日饮水均值（示意）</Text>
              </View>
            </View>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="水分人格" color={text} />
              <Text style={[styles.para, { color: outline }]}>
                稳定饮水反映节律感与自我照料意愿。将「喝水」与固定锚点绑定（起床后、运动前后）更容易长期保持。
              </Text>
              <View style={styles.waterCompare}>
                <View style={[styles.waterBarTrack, { backgroundColor: isDark ? 'rgba(148,163,184,0.2)' : '#e8ecff' }]}>
                  <View style={[styles.waterBarFill, { width: '90%', backgroundColor: primary }]} />
                </View>
                <Text style={[styles.waterCompareText, { color: outline }]}>
                  当前示意：1.8L / 目标 2.0L
                </Text>
              </View>
            </SectionCard>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="可执行微习惯" color={text} />
              <Bullet muted={outline} text="500ml 保温杯随身，上午喝完第一杯再进入深度工作。" />
              <Bullet muted={outline} text="每完成一个番茄钟，起身补水 100–150ml。" />
            </SectionCard>
            <RelLink label="饮水记录" onPress={goIntake} primary={primary} />
          </>
        );

      case 'savings':
        return (
          <>
            <View style={[styles.heroImageCard, { overflow: 'hidden' }]}>
              <Image source={savingsBg} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              <View style={[styles.heroTint, { backgroundColor: `${tertiary}99` }]} />
              <View style={styles.heroInner}>
                <Text style={styles.heroKicker}>WEALTH</Text>
                <Text style={[styles.heroValue, { fontSize: 36 }]}>稳步增长</Text>
                <Text style={styles.heroCaption}>目标进度 · 30,000 CNY（示意）</Text>
              </View>
            </View>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="储蓄人格侧写" color={text} />
              <Text style={[styles.para, { color: outline }]}>
                该卡片描述你在「延迟满足」与「目标拆解」上的倾向：是否愿意为远期目标压缩即时消费，以及你对现金流的敏感度。
              </Text>
              <View style={styles.milestoneList}>
                {['应急垫：优先于非必要支出', '心愿单：与欲望清单联动节流', '定投节律：固定扣款降低决策成本'].map(
                  (t, i) => (
                    <View key={i} style={[styles.milestoneRow, { borderColor: borderSoft }]}>
                      <MaterialIcons name="savings" size={20} color={tertiary} />
                      <Text style={[styles.milestoneText, { color: text }]}>{t}</Text>
                    </View>
                  ),
                )}
              </View>
            </SectionCard>
            <RelLink label="储蓄计划" onPress={goSavings} primary={tertiary} />
            <RelLink label="欲望清单" onPress={goWishList} primary={primary} />
          </>
        );

      case 'ai-insight':
        return (
          <>
            <View style={[styles.aiHero, { backgroundColor: surface, borderColor: borderSoft }]}>
              <View style={[styles.aiHeroIcon, { backgroundColor: primary }]}>
                <MaterialIcons name="auto-awesome" size={32} color="#fff" />
              </View>
              <Text style={[styles.aiHeroTitle, { color: text }]}>综合洞察</Text>
              <Text style={[styles.aiQuoteBlock, { color: outline }]}>
                「你这周的饮水量提升了 15%，非常棒。考虑增加 10g 蛋白质摄入以支持健身训练。在执行储蓄计划方面你做得也很出色，请继续保持你的节奏！」
              </Text>
            </View>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="维度拆解" color={text} />
              {[
                { icon: 'local-drink' as const, title: '饮水节律', sub: '执行力 + 自我照料' },
                { icon: 'fitness-center' as const, title: '营养结构', sub: '训练协同与蛋白质窗口' },
                { icon: 'account-balance-wallet' as const, title: '财务自律', sub: '延迟满足与目标感' },
              ].map(dim => (
                <View key={dim.title} style={[styles.dimRow, { borderColor: borderSoft }]}>
                  <View style={[styles.dimIcon, { backgroundColor: `${primary}18` }]}>
                    <MaterialIcons name={dim.icon} size={22} color={primary} />
                  </View>
                  <View style={styles.dimText}>
                    <Text style={[styles.dimTitle, { color: text }]}>{dim.title}</Text>
                    <Text style={[styles.dimSub, { color: outline }]}>{dim.sub}</Text>
                  </View>
                </View>
              ))}
            </SectionCard>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="说明" color={text} />
              <Text style={[styles.para, { color: outline }]}>
                当前文案为产品占位示意，未接入真实模型。后续可接入健康、任务与账本数据生成个性化段落。
              </Text>
            </SectionCard>
            <RelLink label="编辑个人资料" onPress={goProfile} primary={primary} />
          </>
        );

      default:
        return null;
    }
  };

  const topBarPaddingTop = Math.max(insets.top, 10) + 4;
  const topBarPaddingBottom = 12;
  const topBarRowHeight = 44;
  const topBarTotalHeight = topBarPaddingTop + topBarPaddingBottom + topBarRowHeight;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: bg }]} edges={['left', 'right', 'bottom']}>
      <View
        style={[
          styles.topBar,
          {
            paddingTop: topBarPaddingTop,
            paddingBottom: topBarPaddingBottom,
            borderBottomColor: borderSoft,
            backgroundColor: isDark ? '#0f172a' : '#ffffff',
            shadowColor: '#000',
            shadowOpacity: isDark ? 0.35 : 0.08,
            shadowOffset: { width: 0, height: 4 },
            shadowRadius: 8,
            elevation: 6,
          },
        ]}
      >
        <Pressable onPress={() => router.back()} style={styles.backBtn} hitSlop={12}>
          <MaterialIcons name="arrow-back-ios-new" size={20} color={primary} />
        </Pressable>
        <Text style={[styles.topTitle, { color: text }]} numberOfLines={1}>
          {pageTitle}
        </Text>
        <View style={styles.topBarSpacer} />
      </View>

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingTop: topBarTotalHeight + 10,
            paddingBottom: Math.max(insets.bottom, 16) + 24,
          },
        ]}
      >
        <View style={[styles.accentLine, { backgroundColor: heroAccent }]} />
        {renderBody()}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  scrollView: {
    flex: 1,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  topBarSpacer: { width: 40 },
  scroll: {
    paddingHorizontal: 20,
    gap: 16,
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  accentLine: {
    height: 4,
    borderRadius: 4,
    width: 48,
    alignSelf: 'center',
    marginBottom: 4,
  },
  heroImageCard: {
    borderRadius: 22,
    minHeight: 168,
    justifyContent: 'flex-end',
  },
  heroTint: {
    ...StyleSheet.absoluteFillObject,
  },
  heroInner: {
    padding: 22,
    gap: 6,
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
  },
  heroValue: {
    color: '#fff',
    fontSize: 52,
    fontWeight: '900',
    letterSpacing: -2,
  },
  heroCaption: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 15,
    fontWeight: '600',
  },
  sectionCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    gap: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  para: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '500',
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  statCell: {
    flexGrow: 1,
    flexBasis: '28%',
    minWidth: 100,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
    gap: 4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  statValue: {
    fontSize: 22,
    fontWeight: '900',
  },
  statHint: {
    fontSize: 12,
    fontWeight: '600',
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: '600',
  },
  relLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 14,
  },
  relLinkText: {
    fontSize: 16,
    fontWeight: '800',
  },
  profileFacts: {
    gap: 0,
    marginTop: 4,
  },
  factRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  factLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  factValue: {
    fontSize: 16,
    fontWeight: '800',
  },
  waterCompare: {
    gap: 8,
    marginTop: 4,
  },
  waterBarTrack: {
    height: 10,
    borderRadius: 999,
    overflow: 'hidden',
  },
  waterBarFill: {
    height: '100%',
    borderRadius: 999,
  },
  waterCompareText: {
    fontSize: 13,
    fontWeight: '600',
  },
  milestoneList: {
    gap: 10,
    marginTop: 4,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  milestoneText: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    lineHeight: 21,
  },
  aiHero: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 22,
    alignItems: 'center',
    gap: 14,
  },
  aiHeroIcon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiHeroTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  aiQuoteBlock: {
    fontSize: 16,
    lineHeight: 26,
    fontWeight: '600',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  dimRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dimIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimText: {
    flex: 1,
    gap: 4,
  },
  dimTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  dimSub: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 48,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '900',
  },
  emptySub: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 12,
  },
});
