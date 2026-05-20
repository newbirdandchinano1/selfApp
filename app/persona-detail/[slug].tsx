import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getHealthRecordsLast7Days } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';
import { fetchWeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import {
  getPersonaPortraitCache,
  PERSONA_PORTRAIT_SLUGS,
  savePersonaPortraitCache,
  type PersonaPortraitCacheSlug,
} from '@/lib/repositories/insights/persona-portrait-cache';
import { getDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { ensureDailyAiIntakeTargetsForToday } from '@/lib/daily-intake-ai-targets';
import {
  buildHealthNutrientStats,
  getIntakeTargetsSnapshot,
  ymdAddDays,
} from '@/lib/persona-health-context';
import { buildPersonaContextText, localLogicalTodayYmd } from '@/lib/persona-portrait-sync';
import {
  generatePersonaPortraitFromContext,
  getActiveAiLlmApiKey,
  PERSONA_PORTRAIT_OVERVIEW_MIN_LEN,
  type PersonaPortraitAiData,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, type DimensionValue } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PERSONA_SLUGS = PERSONA_PORTRAIT_SLUGS;
export type PersonaDetailSlug = PersonaPortraitCacheSlug;

function isPersonaSlug(s: string): s is PersonaDetailSlug {
  return (PERSONA_SLUGS as readonly string[]).includes(s);
}

function pickSlug(raw: string | string[] | undefined): string | undefined {
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

function hydrationBarPercent(healthRows: HealthRecordRow[]): { pct: number; avgMl: number; targetMl: number } {
  let total = 0;
  let maxTarget = 0;
  for (const r of healthRows) {
    total += r.hydration ?? 0;
    if ((r.target_hydration ?? 0) > maxTarget) maxTarget = r.target_hydration ?? 0;
  }
  const targetMl = maxTarget > 0 ? maxTarget : 2000;
  const avgMl = total / 7;
  const pct = targetMl > 0 ? Math.min(100, Math.round((avgMl / targetMl) * 100)) : 0;
  return { pct, avgMl, targetMl };
}

const FALLBACK_PLAN_STATS: { label: string; value: string; hint: string }[] = [
  { label: '按时完成', value: '72%', hint: '较上周 +6%' },
  { label: '高优任务', value: '8/10', hint: '青蛙完成度' },
  { label: '恢复速度', value: '快', hint: '延期后 48h 内补做' },
];

const FALLBACK_AI_DIMS: { icon: 'favorite' | 'fitness-center' | 'account-balance-wallet'; title: string; sub: string }[] = [
  { icon: 'favorite', title: '健康照料', sub: '身体档案与四营养维度' },
  { icon: 'fitness-center', title: '执行节奏', sub: '任务闭环与习惯打卡' },
  { icon: 'account-balance-wallet', title: '财务自律', sub: '延迟满足与目标感' },
];

const FALLBACK_HEALTH_BULLETS = [
  '500ml 保温杯随身，上午喝完第一杯再进入深度工作。',
  '将蛋白质优先安排在运动后 1 小时内，用小份加餐降低一次性进食压力。',
  '固定每周同一时段测量身高体重，用趋势代替对单日数字的苛责。',
];

const FALLBACK_HEALTH_STATS: { label: string; value: string; hint: string }[] = [
  { label: '饮水均值', value: '—', hint: '近 7 日按记录推算' },
  { label: '蛋白质', value: '—', hint: '对照首页目标' },
  { label: '碳水/钠', value: '—', hint: '四维度综合照料' },
];

const FALLBACK_PLAN_BULLETS = [
  '将「高认知成本」任务固定在精力峰值时段，避免与低收益琐事堆叠。',
  '每周保留一次「复盘块」，把未闭环项压缩到三条以内再排期。',
];

const FALLBACK_SAVINGS_MILESTONES = [
  '应急垫：优先于非必要支出',
  '心愿单：与欲望清单联动节流',
  '定投节律：固定扣款降低决策成本',
];

const DEFAULT_PLAN_OVERVIEW =
  '该维度聚焦任务与习惯的闭环节奏。近一周若「完成」与「新建」比例失衡，往往说明排期偏满或收尾窗口不足——可在周末留出固定复盘块，把未闭环项压缩为不超过三条的青蛙清单，再按精力峰值重排。高认知任务宜落在状态最好的时段，琐碎维护型事项则集中在低能耗时段批量处理。你不必追求每日打满，关键是让最重要的那一件事先落地，用完成感带动下一项。样本较少时，先选一件最容易收尾的小任务完成即可。以上为基于本地记录的模型侧写，仅供自我观察，不构成专业建议。';

const DEFAULT_HEALTH_OVERVIEW =
  '健康人格画像把身体档案与四营养维度放在同一张图里：身高体重推算的 BMI 只是粗线条参考，更适合观察长期趋势；水分、蛋白质、碳水与钠的日均达成率则反映自我照料是否均衡。稳定补水往往与固定锚点（起床后、运动前后、每个番茄钟结束）绑定；蛋白质窗口可与训练协同。若近一周记录天数偏少，解读会更偏通用建议——坚持在健康页打卡几天后刷新，模型会结合逐日明细给出更贴近你的节律。以上为生活方式参考，不构成医疗诊断或用药建议。';

const DEFAULT_SAVINGS_OVERVIEW =
  '储蓄人格侧写关注延迟满足与目标拆解：你是否愿意为远期目标压缩即时消费，以及记账、存钱与心愿清单是否形成闭环。近一周若支出偏高而储蓄入账偏少，不一定代表「自制力差」，更常见的是大额事项集中或分类口径变化——可先标出 1～2 笔最大支出，判断属于必要、改善还是冲动，再决定下周是否设「消费冷静期」。若储蓄入账稳定，说明你在现金流与目标之间已建立可复制的节律，值得把成功做法写下来（固定扣款日、先存后花等）。心愿清单的更新频率也反映你是否把欲望转化为可执行计划。以下为基于本地记账与存钱摘要的参考解读，不构成投资或法律建议。';

const DEFAULT_AI_INSIGHT_OVERVIEW =
  '综合洞察会把任务执行、健康照料（身体档案与四营养维度）与财务行为放在同一张图里看：它们往往互相牵引——任务压力大时饮水与睡眠容易失守，财务焦虑又会挤占复盘时间。近一周若某一维度明显拖后腿，不必同时改全部习惯，优先选「投入最小、反馈最快」的一条微行动（例如每天第一杯水、每天收尾一件小事、每周固定一笔储蓄）。若多维数据都偏少，说明记录还在起步阶段，先让数据长起来比追求满分更重要。你已经在用工具观察自己，这本身就是很关键的自律起点。刷新画像可让模型结合最新摘要更新解读。以下为综合侧写，仅供自我观察。';

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

function resolvePersonaNarrative(
  overview: string,
  status: 'idle' | 'loading' | 'ok' | 'error',
  fallback: string,
): string {
  if (status === 'loading') return '正在生成 AI 深度解读，篇幅约 300～400 字，请稍候…';
  const trimmed = overview.trim();
  if (trimmed.length > 0) return trimmed;
  if (status === 'ok' || status === 'idle') return fallback;
  return fallback;
}

function PersonaAiNarrative({
  overview,
  status,
  fallback,
  text,
  outline,
  surface,
  borderSoft,
  tertiary,
}: {
  overview: string;
  status: 'idle' | 'loading' | 'ok' | 'error';
  fallback: string;
  text: string;
  outline: string;
  surface: string;
  borderSoft: string;
  tertiary: string;
}) {
  const body = resolvePersonaNarrative(overview, status, fallback);
  const short =
    status === 'ok' && overview.trim().length > 0 && overview.trim().length < PERSONA_PORTRAIT_OVERVIEW_MIN_LEN;
  return (
    <SectionCard surface={surface} border={borderSoft}>
      <SectionTitle text="AI 深度解读" color={text} />
      {short ? (
        <Text style={[styles.aiNarrativeHint, { color: tertiary }]}>
          当前解读偏短（约 {overview.trim().length} 字），可点上方「手动刷新」重新生成完整版（目标 300～400 字）。
        </Text>
      ) : null}
      <Text style={[styles.aiNarrativePara, { color: outline }]}>{body}</Text>
    </SectionCard>
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
  const [healthRows, setHealthRows] = useState<HealthRecordRow[]>([]);
  const [portraitAi, setPortraitAi] = useState<PersonaPortraitAiData | null>(null);
  const [portraitStatus, setPortraitStatus] = useState<'idle' | 'loading' | 'ok' | 'error'>('idle');
  const [portraitError, setPortraitError] = useState('');
  /** 本次展示的文案是否来自「今日磁盘缓存」（非本次手动刷新产生的网络结果） */
  const [portraitFromDiskToday, setPortraitFromDiskToday] = useState(false);
  const [fetchGen, setFetchGen] = useState(0);
  const skipCacheNextRef = useRef(false);

  const requestManualPortraitRefresh = useCallback(() => {
    skipCacheNextRef.current = true;
    setFetchGen(n => n + 1);
  }, []);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    const skipCache = skipCacheNextRef.current;
    skipCacheNextRef.current = false;

    void (async () => {
      try {
        const today = localLogicalTodayYmd();
        const u = await getDefaultUser();
        if (!alive) return;
        setUser(u);
        const metrics = await fetchWeeklyReviewMetrics(new Date(), 'rolling-7');
        const prevEnd = ymdAddDays(today, -7);
        const rows = u?.id ? await getHealthRecordsLast7Days(u.id, today) : [];
        const prevRows = u?.id ? await getHealthRecordsLast7Days(u.id, prevEnd) : [];
        let dailyAiTargets = null;
        if (u) {
          const dailyRes = await ensureDailyAiIntakeTargetsForToday({ user: u, todayYmd: today });
          if (dailyRes.status === 'cached' || dailyRes.status === 'fresh') {
            dailyAiTargets = dailyRes.row;
          }
        }
        if (!alive) return;
        setHealthRows(rows);

        if (!skipCache) {
          const cached = await getPersonaPortraitCache(slug);
          if (cached && cached.cache_date_ymd === today) {
            if (!alive) return;
            setPortraitAi(cached.data);
            setPortraitStatus('ok');
            setPortraitError('');
            setPortraitFromDiskToday(true);
            return;
          }
        }

        if (!alive) return;
        setPortraitFromDiskToday(false);
        setPortraitStatus('loading');
        setPortraitError('');
        const context = buildPersonaContextText(slug as PersonaPortraitCacheSlug, u, metrics, rows, {
          prevWeekHealthRows: prevRows,
          dailyAiTargets,
          todayYmd: today,
        });
        const res = await generatePersonaPortraitFromContext({
          apiKey: getActiveAiLlmApiKey(),
          personaSlug: slug,
          contextText: context,
        });
        if (!alive) return;
        if (res.ok) {
          await savePersonaPortraitCache(slug, today, res.data);
          if (!alive) return;
          setPortraitAi(res.data);
          setPortraitStatus('ok');
        } else {
          setPortraitAi(null);
          setPortraitError(res.error);
          setPortraitStatus('error');
        }
      } catch (e) {
        if (!alive) return;
        setPortraitAi(null);
        setPortraitError(e instanceof Error ? e.message : String(e));
        setPortraitStatus('error');
      }
    })();
    return () => {
      alive = false;
    };
  }, [valid, slug, fetchGen]);

  const hydMemo = useMemo(() => hydrationBarPercent(healthRows), [healthRows]);

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
      health: '健康与营养',
      savings: '储蓄人格画像',
      'ai-insight': 'AI 智能人格洞察',
    };
    return titles[slug];
  }, [valid, slug]);

  const heroAccent = useMemo(() => {
    if (!valid) return primary;
    const map: Record<PersonaDetailSlug, string> = {
      'plan-completion': primary,
      health: secondary,
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
  const savingsBg = require('../../assets/profile/savings.png');
  const healthStats = useMemo(
    () => buildHealthNutrientStats(healthRows, getIntakeTargetsSnapshot()),
    [healthRows],
  );

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

    const ai = portraitStatus === 'ok' ? portraitAi : null;
    const hKicker = (ai?.hero_kicker ?? '').trim();
    const hMain = (ai?.hero_main ?? '').trim();
    const hCap = (ai?.hero_caption ?? '').trim();
    const overview = (ai?.overview ?? '').trim();

    const cacheToolbar =
      portraitStatus === 'ok' ? (
        <View style={[styles.cacheToolbar, { backgroundColor: surface, borderColor: borderSoft }]}>
          <MaterialIcons name={portraitFromDiskToday ? 'schedule' : 'cloud-done'} size={18} color={outline} />
          <Text style={[styles.cacheToolbarText, { color: outline }]}>
            {portraitFromDiskToday
              ? '今日已在应用启动时后台生成并缓存在本地（每个画像每天联网最多一次）'
              : '已联网更新并写入本地；你可随时手动刷新。'}
          </Text>
          <Pressable onPress={requestManualPortraitRefresh} hitSlop={8} style={styles.retryBtn}>
            <Text style={{ color: primary, fontWeight: '900', fontSize: 14 }}>手动刷新</Text>
          </Pressable>
        </View>
      ) : null;

    const statusHeader = (
      <>
        {cacheToolbar}
        {portraitStatus === 'loading' && (
          <View style={[styles.aiStatusBar, { backgroundColor: surface, borderColor: borderSoft }]}>
            <ActivityIndicator size="small" color={primary} />
            <Text style={[styles.aiStatusBarText, { color: outline }]}>正在生成或刷新画像（智谱 GLM）…</Text>
          </View>
        )}
        {portraitStatus === 'error' && (
          <View style={[styles.aiStatusBar, { backgroundColor: surface, borderColor: borderSoft }]}>
            <MaterialIcons name="error-outline" size={22} color={tertiary} />
            <Text style={[styles.aiStatusBarText, { flex: 1, color: outline }]}>{portraitError}</Text>
            <Pressable onPress={requestManualPortraitRefresh} hitSlop={10} style={styles.retryBtn}>
              <Text style={{ color: primary, fontWeight: '900', fontSize: 14 }}>重试</Text>
            </Pressable>
          </View>
        )}
      </>
    );

    const heroMainStyle = (main: string) => {
      const n = main.trim().length;
      if (n > 14) return { fontSize: 28 };
      if (n > 10) return { fontSize: 34 };
      if (n > 7) return { fontSize: 40 };
      return undefined;
    };

    switch (slug) {
      case 'plan-completion': {
        const planKicker = hKicker || 'EXECUTION';
        const planMain = hMain || '85%';
        const planCap = hCap || '本周目标达成率 · 参考侧写';
        const planStats = ai?.stats && ai.stats.length >= 3 ? ai.stats : FALLBACK_PLAN_STATS;
        const planBullets =
          ai?.bullets && ai.bullets.filter(b => b.trim()).length >= 2 ? ai.bullets.filter(b => b.trim()) : FALLBACK_PLAN_BULLETS;
        return (
          <>
            {statusHeader}
            <View style={[styles.heroImageCard, { overflow: 'hidden' }]}>
              <Image source={progressBg} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              <View style={[styles.heroTint, { backgroundColor: `${primary}99` }]} />
              <View style={styles.heroInner}>
                <Text style={styles.heroKicker}>{planKicker}</Text>
                <Text style={[styles.heroValue, heroMainStyle(planMain)]}>{planMain}</Text>
                <Text style={styles.heroCaption}>{planCap}</Text>
              </View>
            </View>
            <PersonaAiNarrative
              overview={overview}
              status={portraitStatus}
              fallback={DEFAULT_PLAN_OVERVIEW}
              text={text}
              outline={outline}
              surface={surface}
              borderSoft={borderSoft}
              tertiary={tertiary}
            />
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="数据速览" color={text} />
              <View style={styles.statGrid}>
                {planStats.map(row => (
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
              {planBullets.map((line, idx) => (
                <Bullet key={idx} muted={outline} text={line} />
              ))}
            </SectionCard>
            <RelLink label="前往任务中心" onPress={goTasks} primary={primary} />
          </>
        );
      }

      case 'health': {
        const healthKicker = hKicker || 'WELLNESS';
        const healthMain =
          hMain ||
          (bmiText !== '—'
            ? bmiText
            : hydMemo.avgMl >= 50
              ? `${(hydMemo.avgMl / 1000).toFixed(1)}L`
              : healthRows.length
                ? `${Math.round(hydMemo.avgMl)} ml`
                : '—');
        const healthCap = hCap || '身体档案 · 四营养维度 · 近 7 日';
        const healthBullets =
          ai?.bullets && ai.bullets.filter(b => b.trim()).length >= 2
            ? ai.bullets.filter(b => b.trim())
            : FALLBACK_HEALTH_BULLETS;
        const healthStatRows = ai?.stats && ai.stats.length >= 3 ? ai.stats : healthStats.length >= 3 ? healthStats : FALLBACK_HEALTH_STATS;
        const barW = `${Math.max(4, hydMemo.pct)}%` as DimensionValue;
        const hydCompareLabel = `饮水约 ${(hydMemo.avgMl / 1000).toFixed(2)} L / 日 · 目标 ${(hydMemo.targetMl / 1000).toFixed(1)} L / 日`;
        return (
          <>
            {statusHeader}
            <View style={[styles.heroImageCard, { overflow: 'hidden' }]}>
              <Image source={healthBg} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              <View style={[styles.heroTint, { backgroundColor: `${secondary}99` }]} />
              <View style={styles.heroInner}>
                <Text style={styles.heroKicker}>{healthKicker}</Text>
                <Text style={[styles.heroValue, heroMainStyle(healthMain)]}>{healthMain}</Text>
                <Text style={styles.heroCaption}>{healthCap}</Text>
              </View>
            </View>
            <PersonaAiNarrative
              overview={overview}
              status={portraitStatus}
              fallback={DEFAULT_HEALTH_OVERVIEW}
              text={text}
              outline={outline}
              surface={surface}
              borderSoft={borderSoft}
              tertiary={tertiary}
            />
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="数据速览" color={text} />
              <View style={styles.statGrid}>
                {healthStatRows.map(row => (
                  <View key={row.label} style={[styles.statCell, { borderColor: borderSoft }]}>
                    <Text style={[styles.statLabel, { color: outline }]}>{row.label}</Text>
                    <Text style={[styles.statValue, { color: text }]}>{row.value}</Text>
                    <Text style={[styles.statHint, { color: outline }]}>{row.hint}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="身体档案" color={text} />
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
              <SectionTitle text="饮水进度" color={text} />
              <View style={styles.waterCompare}>
                <View style={[styles.waterBarTrack, { backgroundColor: isDark ? 'rgba(148,163,184,0.2)' : '#e8ecff' }]}>
                  <View style={[styles.waterBarFill, { width: barW, backgroundColor: primary }]} />
                </View>
                <Text style={[styles.waterCompareText, { color: outline }]}>{hydCompareLabel}</Text>
              </View>
            </SectionCard>
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="可执行微习惯" color={text} />
              {healthBullets.map((line, idx) => (
                <Bullet key={idx} muted={outline} text={line} />
              ))}
            </SectionCard>
            <RelLink label="前往健康页" onPress={() => router.push('/(tabs)')} primary={secondary} />
            <RelLink label="健康日历" onPress={goHealth} primary={secondary} />
            <RelLink label="摄入记录" onPress={goIntake} primary={primary} />
            <RelLink label="编辑身体数据" onPress={goProfile} primary={primary} />
          </>
        );
      }

      case 'savings': {
        const savKicker = hKicker || 'WEALTH';
        const savMain = hMain || '储蓄侧写';
        const savCap = hCap || '基于近 7 日记账与存钱摘要';
        const savMilestones =
          ai?.milestones && ai.milestones.filter(m => m.trim()).length >= 2
            ? ai.milestones.filter(m => m.trim())
            : FALLBACK_SAVINGS_MILESTONES;
        return (
          <>
            {statusHeader}
            <View style={[styles.heroImageCard, { overflow: 'hidden' }]}>
              <Image source={savingsBg} style={StyleSheet.absoluteFillObject} contentFit="cover" />
              <View style={[styles.heroTint, { backgroundColor: `${tertiary}99` }]} />
              <View style={styles.heroInner}>
                <Text style={styles.heroKicker}>{savKicker}</Text>
                <Text style={[styles.heroValue, { fontSize: savMain.length > 8 ? 30 : 36 }]}>{savMain}</Text>
                <Text style={styles.heroCaption}>{savCap}</Text>
              </View>
            </View>
            <PersonaAiNarrative
              overview={overview}
              status={portraitStatus}
              fallback={DEFAULT_SAVINGS_OVERVIEW}
              text={text}
              outline={outline}
              surface={surface}
              borderSoft={borderSoft}
              tertiary={tertiary}
            />
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="阶段里程碑" color={text} />
              <View style={styles.milestoneList}>
                {savMilestones.map((t, i) => (
                  <View key={i} style={[styles.milestoneRow, { borderColor: borderSoft }]}>
                    <MaterialIcons name="savings" size={20} color={tertiary} />
                    <Text style={[styles.milestoneText, { color: text }]}>{t}</Text>
                  </View>
                ))}
              </View>
            </SectionCard>
            <RelLink label="储蓄计划" onPress={goSavings} primary={tertiary} />
            <RelLink label="欲望清单" onPress={goWishList} primary={primary} />
          </>
        );
      }

      case 'ai-insight': {
        const rawQuote = (ai?.ai_quote || '').trim();
        const quoteFallback =
          '你这周在任务、健康与财务之间呈现出可观察的联动：若某一维度暂时拖后腿，不必一次改全部习惯，先选投入最小、反馈最快的一条微行动即可。坚持记录几天后刷新画像，综合解读会更贴近你的真实节奏。';
        const quoteBody = resolvePersonaNarrative(rawQuote, portraitStatus, quoteFallback);
        const displayQuote = quoteBody.includes('「') ? quoteBody : `「${quoteBody}」`;
        const dimsToRender =
          ai && ai.dims.length >= 3
            ? ai.dims.slice(0, 3).map((d, i) => ({
                icon: FALLBACK_AI_DIMS[i]?.icon ?? 'local-drink',
                title: d.title.trim() || FALLBACK_AI_DIMS[i]?.title || '维度',
                sub: d.sub.trim() || FALLBACK_AI_DIMS[i]?.sub || '',
              }))
            : FALLBACK_AI_DIMS.map(d => ({ icon: d.icon, title: d.title, sub: d.sub }));
        return (
          <>
            {statusHeader}
            <View style={[styles.aiHero, { backgroundColor: surface, borderColor: borderSoft }]}>
              <View style={[styles.aiHeroIcon, { backgroundColor: primary }]}>
                <MaterialIcons name="auto-awesome" size={32} color="#fff" />
              </View>
              <Text style={[styles.aiHeroTitle, { color: text }]}>综合评语</Text>
              <Text style={[styles.aiQuoteBlock, { color: outline }]}>{displayQuote}</Text>
            </View>
            <PersonaAiNarrative
              overview={overview}
              status={portraitStatus}
              fallback={DEFAULT_AI_INSIGHT_OVERVIEW}
              text={text}
              outline={outline}
              surface={surface}
              borderSoft={borderSoft}
              tertiary={tertiary}
            />
            <SectionCard surface={surface} border={borderSoft}>
              <SectionTitle text="维度拆解" color={text} />
              {dimsToRender.map(dim => (
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
                文案由智谱 GLM-4-Flash 根据你近 7 日在 App 内的聚合摘要生成（长文约 300～400 字），仅供自我观察与习惯参考，不构成医疗、投资或法律建议。可点击上方刷新重新生成。
              </Text>
            </SectionCard>
            <RelLink label="编辑个人资料" onPress={goProfile} primary={primary} />
          </>
        );
      }

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
  aiNarrativeHint: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '700',
  },
  aiNarrativePara: {
    fontSize: 16,
    lineHeight: 26,
    fontWeight: '500',
    letterSpacing: 0.15,
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
  aiStatusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  aiStatusBarText: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  retryBtn: {
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  cacheToolbar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 16,
    borderWidth: 1,
    marginBottom: 4,
  },
  cacheToolbarText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
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
