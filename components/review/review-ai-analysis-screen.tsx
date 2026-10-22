/**
 * AI 复盘分析全屏页 · 对齐 `复盘页动效规范.html` 第 11 屏
 * 动效：骨架 shimmer 1.2s → 关键词 pop → 正文 28ms/字流式 → 卡片 riseIn
 */
import {
  FoldPopIn,
  FoldRiseIn,
  FoldStreamText,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { FoldCard, foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import type { DailyEntry } from '@/components/review/review-utils';
import { Skeleton } from '@/components/ui/skeleton';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { generateReviewAiAnalysis, reviewHasEnoughTextForAi, type ReviewAiScope } from '@/lib/review-ai-analysis';
import { parseReviewAiDigest } from '@/lib/review-ai-sections';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import {
  parseDailyReviewJournal,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

const CHART_W = 310;
const CHART_H = 52;
const CHART_INSET_X = 4;
const CHART_INSET_Y = 6;
/** 设计稿 AI 面板：骨架至少 shimmer 1.2s */
const SHIMMER_MS = 1200;

const MOOD_SCORE: Record<string, number> = {
  '😀': 1,
  '🥳': 0.92,
  '😎': 0.82,
  '🙂': 0.66,
  '😐': 0.5,
  '😴': 0.36,
  '😤': 0.28,
  '😔': 0.18,
};

const INSIGHT_META = [
  { icon: 'gps-fixed' as const, tint: 'sage' as const },
  { icon: 'local-fire-department' as const, tint: 'amber' as const },
  { icon: 'favorite' as const, tint: 'clay' as const },
];

type InsightCardModel = {
  key: string;
  title: string;
  body: string;
  conf: string;
  icon: (typeof INSIGHT_META)[number]['icon'];
  tint: (typeof INSIGHT_META)[number]['tint'];
};

function plainLength(fields: ReviewFieldValues): number {
  let total = 0;
  for (const value of Object.values(fields ?? {})) {
    total += (value ?? '').replace(/\s+/g, '').length;
  }
  return total;
}

function firstSentence(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  return (flat.split(/(?<=[。！？!?])/)[0] ?? flat).trim();
}

function splitInsight(item: string): { title: string; body: string } {
  const raw = item.replace(/\s+/g, ' ').trim();
  const dash = raw.split(/\s*(?:——|→|›)\s*/);
  if (dash.length >= 2 && dash[0]!.length >= 4) {
    return { title: dash[0]!.trim(), body: dash.slice(1).join('').trim() || dash[0]!.trim() };
  }
  const title = firstSentence(raw).replace(/[。！？!?]$/, '');
  const rest = raw.slice(title.length).replace(/^[。！？!?\s]+/, '').trim();
  return { title: title || raw.slice(0, 18), body: rest || raw };
}

function confidenceFor(item: string, index: number): string {
  const base = 0.86 - index * 0.06;
  const boost = Math.min(0.06, item.replace(/\s+/g, '').length / 400);
  return (Math.max(0.62, Math.min(0.92, base + boost))).toFixed(2);
}

function seriesPoints(values: (number | null)[]): { x: number; y: number }[] {
  const innerW = CHART_W - CHART_INSET_X * 2;
  const innerH = CHART_H - CHART_INSET_Y * 2;
  const n = Math.max(1, values.length - 1);
  const pts: { x: number; y: number }[] = [];
  values.forEach((value, index) => {
    if (value == null) return;
    pts.push({
      x: CHART_INSET_X + (index / n) * innerW,
      y: CHART_INSET_Y + (1 - value) * innerH,
    });
  });
  return pts;
}

function buildSeriesPath(values: (number | null)[]): string {
  const pts = seriesPoints(values);
  if (pts.length === 0) return '';
  return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

function buildAreaPath(values: (number | null)[]): string {
  const pts = seriesPoints(values);
  if (pts.length === 0) return '';
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = pts[pts.length - 1]!;
  const first = pts[0]!;
  return `${line} L${last.x.toFixed(1)},${CHART_H} L${first.x.toFixed(1)},${CHART_H} Z`;
}

function trendArrow(values: (number | null)[]): string {
  const nums = values.filter((v): v is number => v != null);
  if (nums.length < 2) return '→';
  const delta = nums[nums.length - 1]! - nums[0]!;
  if (delta > 0.08) return '↗';
  if (delta < -0.08) return '↘';
  return '→';
}

export type ReviewAiAnalysisScreenProps = {
  visible: boolean;
  onClose: () => void;
  scope: ReviewAiScope;
  scopeLabel: string;
  weekNo: number;
  periodLabel: string;
  weekStartYmd: string;
  template: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
  dailyEntries: DailyEntry[];
  initialText: string | null;
  canEdit: boolean;
  onPersist: (text: string) => Promise<void> | void;
};

export function ReviewAiAnalysisScreen({
  visible,
  onClose,
  scope,
  scopeLabel,
  weekNo,
  periodLabel,
  weekStartYmd,
  template,
  fields,
  dailyEntries,
  initialText,
  canEdit,
  onPersist,
}: ReviewAiAnalysisScreenProps) {
  const { fold } = useFoldTheme();
  const insets = useSafeAreaInsets();
  const { animate: motionOk } = useFoldMotionGate();

  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [moodByYmd, setMoodByYmd] = useState<Record<string, string>>({});
  /** shimmer → reveal：对齐设计稿 AI 面板时序 */
  const [phase, setPhase] = useState<'idle' | 'shimmer' | 'reveal'>('idle');
  const [streamReady, setStreamReady] = useState(false);
  const [headlineDone, setHeadlineDone] = useState(false);
  const [bodyDone, setBodyDone] = useState(false);
  const revealTokenRef = useRef(0);
  const shimmerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const text = draft ?? initialText ?? '';
  const hasBody = text.trim().length > 0;
  const showMotion = motionOk && visible;

  useEffect(() => {
    if (!visible || !weekStartYmd) return;
    let cancelled = false;
    const start = new Date(
      Number(weekStartYmd.slice(0, 4)),
      Number(weekStartYmd.slice(5, 7)) - 1,
      Number(weekStartYmd.slice(8, 10)),
    );
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    const endYmd = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(
      end.getDate(),
    ).padStart(2, '0')}`;

    void (async () => {
      try {
        const rows = await listDailyReviewsBetween(weekStartYmd, endYmd);
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const row of rows) {
          const mood = parseDailyReviewJournal(row.body ?? '', []).meta.mood;
          if (mood) map[row.record_date_ymd] = mood;
        }
        setMoodByYmd(map);
      } catch {
        if (!cancelled) setMoodByYmd({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible, weekStartYmd]);

  const resetStreamFlags = useCallback(() => {
    setStreamReady(false);
    setHeadlineDone(false);
    setBodyDone(false);
  }, []);

  const startRevealNow = useCallback(() => {
    resetStreamFlags();
    setPhase('reveal');
    // 下一帧再开流式，避免与 phase 切换抢同一帧
    requestAnimationFrame(() => setStreamReady(true));
  }, [resetStreamFlags]);

  // 打开已有内容：直接 reveal；空内容 idle
  useEffect(() => {
    if (!visible) {
      setPhase('idle');
      setDraft(null);
      resetStreamFlags();
      if (shimmerTimerRef.current) {
        clearTimeout(shimmerTimerRef.current);
        shimmerTimerRef.current = null;
      }
      return;
    }
    if ((initialText ?? '').trim()) {
      revealTokenRef.current += 1;
      startRevealNow();
    } else {
      setPhase('idle');
      resetStreamFlags();
    }
  }, [initialText, resetStreamFlags, startRevealNow, visible]);

  const digest = useMemo(() => parseReviewAiDigest(text), [text]);

  const filledDimensions = useMemo(
    () =>
      template
        .map(dim => ({
          title: dim.title,
          filled: dim.columns.some(col => (fields[col.id] ?? '').trim().length > 0),
        }))
        .filter(item => item.filled),
    [fields, template],
  );

  const heroTags = useMemo(
    () =>
      filledDimensions.length > 0
        ? filledDimensions.slice(0, 4).map(item => item.title)
        : ['本周暂无记录'],
    [filledDimensions],
  );

  const headline = useMemo(() => {
    if (digest.headline) return digest.headline;
    if (filledDimensions.length === 0) return '这一周，还没有留下可以被观察的文字。';
    return `这一周，你在${filledDimensions
      .slice(0, 2)
      .map(item => item.title)
      .join('、')}之间留下了痕迹。`;
  }, [digest.headline, filledDimensions]);

  const heroBody = useMemo(() => {
    const intro = digest.intro.replace(digest.headline, '').trim();
    if (intro) return intro;
    return `不是所有进展都需要被量化。分析只基于你在${periodLabel}写下的内容，以及近 7 天日复盘。`;
  }, [digest.headline, digest.intro, periodLabel]);

  const insights = useMemo((): InsightCardModel[] => {
    const pool: { item: string; key: string }[] = [];
    for (const section of digest.sections) {
      if (section.key === 'suggestions') continue;
      section.items.forEach((item, i) => {
        pool.push({ item, key: `${section.key}-${i}` });
      });
    }
    return pool.slice(0, 3).map((row, index) => {
      const { title, body } = splitInsight(row.item);
      const meta = INSIGHT_META[index % INSIGHT_META.length]!;
      return {
        key: row.key,
        title,
        body,
        conf: confidenceFor(row.item, index),
        icon: meta.icon,
        tint: meta.tint,
      };
    });
  }, [digest.sections]);

  const moodValues = useMemo(
    () =>
      dailyEntries.map(entry => {
        const mood = moodByYmd[entry.ymd];
        if (!mood) return null;
        const score = MOOD_SCORE[mood];
        return score == null ? null : score;
      }),
    [dailyEntries, moodByYmd],
  );

  /** 设计稿「精力」：用当日书写密度作代理 */
  const energyValues = useMemo(() => {
    const lengths = dailyEntries.map(entry => plainLength(entry.fields));
    const max = Math.max(1, ...lengths);
    return lengths.map(length => (length > 0 ? length / max : null));
  }, [dailyEntries]);

  const suggestionItems = useMemo(
    () => digest.sections.find(section => section.key === 'suggestions')?.items ?? [],
    [digest.sections],
  );

  const generate = useCallback(async () => {
    if (!canEdit) {
      toast.error('请在每周复盘日生成 AI 分析');
      return;
    }
    if (!reviewHasEnoughTextForAi(fields)) {
      toast.error('内容偏少，请先写满约 30 字再生成');
      return;
    }
    const token = ++revealTokenRef.current;
    setBusy(true);
    resetStreamFlags();
    setPhase('shimmer');
    const startedAt = Date.now();
    try {
      const result = await generateReviewAiAnalysis({
        scope,
        periodLabel,
        template,
        fields,
      });
      if (revealTokenRef.current !== token) return;
      setDraft(result);
      await onPersist(result);
      const remain = motionOk ? Math.max(0, SHIMMER_MS - (Date.now() - startedAt)) : 0;
      if (remain > 0) {
        await new Promise<void>(resolve => {
          shimmerTimerRef.current = setTimeout(resolve, remain);
        });
      }
      if (revealTokenRef.current !== token) return;
      startRevealNow();
      toast.success('已生成新的 AI 分析');
    } catch (e) {
      console.warn('review ai analysis', e);
      toast.error(toUserMessage(e, '生成失败，请检查网络后重试'));
      if (revealTokenRef.current !== token) return;
      if ((draft ?? initialText ?? '').trim()) startRevealNow();
      else setPhase('idle');
    } finally {
      if (revealTokenRef.current === token) setBusy(false);
    }
  }, [
    canEdit,
    draft,
    fields,
    initialText,
    motionOk,
    onPersist,
    periodLabel,
    resetStreamFlags,
    scope,
    startRevealNow,
    template,
  ]);

  const writeIn = useCallback(async () => {
    if (!text.trim()) {
      await generate();
      return;
    }
    try {
      await onPersist(text);
      toast.success('已写入 AI 分析');
    } catch (e) {
      console.warn('review ai persist', e);
      toast.error(toUserMessage(e, '写入失败，请稍后重试'));
    }
  }, [generate, onPersist, text]);

  const handleClose = useCallback(() => {
    setDraft(null);
    setPhase('idle');
    onClose();
  }, [onClose]);

  const copyText = useCallback(async () => {
    if (!text.trim()) {
      toast.error('还没有可复制的内容');
      return;
    }
    await Clipboard.setStringAsync(text);
    toast.success('已复制分析');
  }, [text]);

  const chartMoodPath = useMemo(() => buildSeriesPath(moodValues), [moodValues]);
  const chartMoodArea = useMemo(() => buildAreaPath(moodValues), [moodValues]);
  const chartEnergyPath = useMemo(() => buildSeriesPath(energyValues), [energyValues]);
  const moodPts = useMemo(() => seriesPoints(moodValues), [moodValues]);
  const energyPts = useMemo(() => seriesPoints(energyValues), [energyValues]);
  const moodEnd = moodPts[moodPts.length - 1];
  const energyEnd = energyPts[energyPts.length - 1];

  const showShimmer = phase === 'shimmer' || (busy && !hasBody);
  const showContent = hasBody && phase !== 'shimmer';
  const cardsAnimate = showMotion && bodyDone;

  const tintColors = (tint: InsightCardModel['tint']) =>
    tint === 'clay'
      ? { bg: fold.clay2, fg: fold.clay }
      : tint === 'amber'
        ? { bg: fold.amber2, fg: fold.amber }
        : { bg: '#E8EFEA', fg: '#4A675A' };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={handleClose}
      presentationStyle="fullScreen"
      statusBarTranslucent>
      <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
        <View style={[styles.header, { paddingTop: Math.max(insets.top, 8) }]}>
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="返回"
            style={({ pressed }) => [styles.headerBack, { opacity: pressed ? 0.6 : 1 }]}>
            <MaterialIcons name="arrow-back-ios-new" size={18} color={fold.ink2} />
          </Pressable>
          <View style={styles.headerCenter}>
            <Text style={[styles.headerTitle, { color: fold.ink }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
              AI 复盘分析
            </Text>
            <Text style={[styles.headerSub, { color: fold.muted }]} numberOfLines={1} maxFontSizeMultiplier={1.2}>
              GLM · 基于近 7 天日刊
            </Text>
          </View>
          <Pressable
            onPress={() => void generate()}
            disabled={!canEdit || busy}
            accessibilityRole="button"
            accessibilityLabel="重新生成 AI 分析"
            style={({ pressed }) => [
              styles.headerPill,
              {
                borderColor: fold.line2,
                backgroundColor: fold.cardSoft,
                opacity: !canEdit || busy ? 0.45 : pressed ? 0.8 : 1,
              },
            ]}>
            {busy ? (
              <ActivityIndicator size="small" color={fold.ink2} />
            ) : (
              <>
                <MaterialIcons name="refresh" size={13} color={fold.ink2} />
                <Text style={[styles.headerPillText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.25}>
                  重新生成
                </Text>
              </>
            )}
          </Pressable>
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: 12 + Math.max(insets.bottom, 10) },
          ]}>
          <View style={[styles.hero, { backgroundColor: fold.summaryBg }]}>
            <View style={styles.heroRingA} pointerEvents="none" />
            <View style={styles.heroRingB} pointerEvents="none" />
            <View style={styles.heroKicker}>
              <MaterialIcons name="auto-awesome" size={11} color={fold.badgeText} />
              <Text style={[styles.heroKickerText, { color: fold.summaryMuted }]} maxFontSizeMultiplier={1.2}>
                AI OBSERVATION · 第 {weekNo} 周
              </Text>
            </View>
            {showContent ? (
              <>
                <FoldStreamText
                  text={headline}
                  animate={showMotion && streamReady}
                  msPerChar={28}
                  delayMs={80}
                  style={[styles.heroTitle, { color: fold.summaryText }]}
                  maxFontSizeMultiplier={1.25}
                  onDone={() => setHeadlineDone(true)}
                />
                <FoldStreamText
                  text={heroBody}
                  animate={showMotion && headlineDone}
                  msPerChar={28}
                  delayMs={40}
                  style={[styles.heroBody, { color: fold.summaryMuted }]}
                  maxFontSizeMultiplier={1.3}
                  onDone={() => setBodyDone(true)}
                />
                <View style={styles.heroTags}>
                  {heroTags.map((tag, i) => (
                    <FoldPopIn
                      key={tag}
                      animate={showMotion && streamReady}
                      index={i}
                      staggerMs={70}
                      delayMs={120}
                      duration={340}>
                      <View
                        style={[
                          styles.heroTag,
                          {
                            borderColor: fold.badgeBorder,
                            backgroundColor: fold.badgeBg,
                          },
                        ]}>
                        <Text
                          style={[styles.heroTagText, { color: fold.badgeText }]}
                          maxFontSizeMultiplier={1.2}>
                          {tag}
                        </Text>
                      </View>
                    </FoldPopIn>
                  ))}
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.heroTitle, { color: fold.summaryText }]} maxFontSizeMultiplier={1.25}>
                  {busy ? '正在观察这一周…' : headline}
                </Text>
                <Text style={[styles.heroBody, { color: fold.summaryMuted }]} maxFontSizeMultiplier={1.3}>
                  {busy
                    ? '骨架准备中，随后会流式写出观察与建议。'
                    : `写下${scopeLabel}内容后，这里会整理出观察、风险与三条可执行的小动作。`}
                </Text>
              </>
            )}
          </View>

          {showShimmer ? (
            <View style={styles.skeletonBlock}>
              {[0, 1, 2].map(i => (
                <FoldCard key={`sk-${i}`} style={styles.skeletonCard}>
                  <View style={styles.skeletonRow}>
                    <Skeleton width={25} height={25} borderRadius={8} />
                    <View style={styles.skeletonCol}>
                      <Skeleton width="70%" height={11} borderRadius={4} />
                      <Skeleton width="100%" height={9} borderRadius={4} />
                      <Skeleton width="88%" height={9} borderRadius={4} />
                    </View>
                  </View>
                </FoldCard>
              ))}
            </View>
          ) : null}

          {showContent && insights.length > 0
            ? insights.map((card, index) => {
                const tint = tintColors(card.tint);
                return (
                  <FoldRiseIn
                    key={card.key}
                    animate={cardsAnimate}
                    index={index}
                    staggerMs={70}
                    delayMs={100}
                    duration={350}>
                    <FoldCard style={styles.insightCard}>
                      <View style={[styles.insightIcon, { backgroundColor: tint.bg }]}>
                        <MaterialIcons name={card.icon} size={14} color={tint.fg} />
                      </View>
                      <View style={styles.insightCopy}>
                        <Text
                          style={[styles.insightTitle, { color: fold.ink2 }]}
                          numberOfLines={2}
                          maxFontSizeMultiplier={1.3}>
                          {card.title}
                        </Text>
                        <Text
                          style={[styles.insightBody, { color: fold.muted }]}
                          maxFontSizeMultiplier={1.35}>
                          {card.body}
                        </Text>
                      </View>
                      <Text style={[styles.insightConf, { color: fold.faint }]} maxFontSizeMultiplier={1.2}>
                        {card.conf}
                      </Text>
                    </FoldCard>
                  </FoldRiseIn>
                );
              })
            : null}

          {showContent && insights.length === 0 && hasBody ? (
            <FoldRiseIn animate={cardsAnimate} index={0} delayMs={100} duration={350}>
              <FoldCard style={styles.rawCard}>
                <Text style={[styles.rawText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.35}>
                  {text}
                </Text>
              </FoldCard>
            </FoldRiseIn>
          ) : null}

          {!showShimmer && !hasBody ? (
            <FoldCard tone="muted" style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: fold.sage2 }]}>
                <MaterialIcons name="auto-awesome" size={17} color={fold.pine} />
              </View>
              <Text style={[styles.emptyText, { color: fold.muted }]} maxFontSizeMultiplier={1.35}>
                {canEdit
                  ? `写下${scopeLabel}内容后，点「生成 AI 分析」即可看到骨架、流式正文与下一步动作。`
                  : '请在每周复盘日生成 AI 分析；在此之前可以先写日复盘。'}
              </Text>
            </FoldCard>
          ) : null}

          <FoldRiseIn
            animate={showMotion && (bodyDone || (!hasBody && phase === 'idle'))}
            index={insights.length}
            staggerMs={70}
            delayMs={hasBody ? 160 : 0}
            duration={350}>
            <FoldCard style={styles.chartCard}>
              <View style={styles.chartHead}>
                <Text style={[styles.chartTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                  7 天心情 / 精力
                </Text>
                <Text style={[styles.chartTrend, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                  心情{' '}
                  <Text style={{ color: fold.sage, fontWeight: '700' }}>{trendArrow(moodValues)}</Text>
                  {' · '}
                  精力{' '}
                  <Text style={{ color: fold.amber, fontWeight: '700' }}>{trendArrow(energyValues)}</Text>
                </Text>
              </View>
              <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
                <Defs>
                  <LinearGradient id="moodFill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={fold.sage} stopOpacity={0.3} />
                    <Stop offset="1" stopColor={fold.sage} stopOpacity={0} />
                  </LinearGradient>
                </Defs>
                {chartMoodArea ? <Path d={chartMoodArea} fill="url(#moodFill)" /> : null}
                {chartMoodPath ? (
                  <Path
                    d={chartMoodPath}
                    fill="none"
                    stroke={fold.sage}
                    strokeWidth={1.6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ) : null}
                {chartEnergyPath ? (
                  <Path
                    d={chartEnergyPath}
                    fill="none"
                    stroke={fold.amber}
                    strokeWidth={1.1}
                    strokeDasharray="2.5 2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.85}
                  />
                ) : null}
                {moodEnd ? <Circle cx={moodEnd.x} cy={moodEnd.y} r={3} fill={fold.sage} /> : null}
                {energyEnd ? <Circle cx={energyEnd.x} cy={energyEnd.y} r={2.5} fill={fold.amber} /> : null}
              </Svg>
              <View style={styles.chartLabels}>
                {dailyEntries.map(entry => (
                  <Text
                    key={entry.ymd}
                    style={[styles.chartLabel, { color: fold.faint }]}
                    maxFontSizeMultiplier={1.2}>
                    {entry.label.replace(/^\d+月\d+日\s*/, '').replace(/^周/, '')}
                  </Text>
                ))}
              </View>
            </FoldCard>
          </FoldRiseIn>

          {showContent && suggestionItems.length > 0 ? (
            <FoldRiseIn
              animate={cardsAnimate}
              index={insights.length + 1}
              staggerMs={70}
              delayMs={180}
              duration={350}>
              <FoldCard style={styles.suggestCard}>
                <View style={styles.suggestHead}>
                  <Text style={[styles.suggestTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                    下周可以试试
                  </Text>
                  <Text style={[styles.suggestCount, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                    {Math.min(3, suggestionItems.length)} 个很小的动作
                  </Text>
                </View>
                {suggestionItems.slice(0, 3).map((item, index) => (
                  <View key={`suggest-${index}`}>
                    {index > 0 ? <View style={[styles.divider, { backgroundColor: fold.line }]} /> : null}
                    <View style={styles.suggestRow}>
                      <View style={[styles.suggestBadge, { borderColor: '#E7CDA2' }]}>
                        <Text
                          style={[styles.suggestIndex, { color: fold.amber }]}
                          maxFontSizeMultiplier={1.2}>
                          {String(index + 1).padStart(2, '0')}
                        </Text>
                      </View>
                      <Text style={[styles.suggestText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.35}>
                        {item}
                      </Text>
                    </View>
                  </View>
                ))}
              </FoldCard>
            </FoldRiseIn>
          ) : null}

          <FoldRiseIn
            animate={showMotion && (bodyDone || !hasBody)}
            index={insights.length + 2}
            staggerMs={55}
            delayMs={hasBody ? 220 : 40}
            duration={320}>
            <View style={styles.aiActions}>
              <Pressable
                onPress={() => void writeIn()}
                disabled={busy || (!hasBody && !canEdit)}
                accessibilityRole="button"
                accessibilityLabel={hasBody ? '写入 AI 分析' : '生成 AI 分析'}
                style={({ pressed }) => [
                  styles.primaryBtn,
                  {
                    backgroundColor: fold.pineButton,
                    opacity: busy || (!hasBody && !canEdit) ? 0.5 : pressed ? 0.88 : 1,
                  },
                ]}>
                {busy ? (
                  <ActivityIndicator color={fold.onPineButton} />
                ) : (
                  <>
                    <MaterialIcons name="check" size={16} color={fold.onPineButton} />
                    <Text
                      style={[styles.primaryBtnText, { color: fold.onPineButton }]}
                      maxFontSizeMultiplier={1.3}>
                      {hasBody ? '写入 AI 分析' : '生成 AI 分析'}
                    </Text>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={() => void copyText()}
                disabled={!hasBody}
                accessibilityRole="button"
                accessibilityLabel="复制分析"
                style={({ pressed }) => [
                  styles.copyBtn,
                  {
                    borderColor: fold.line2,
                    backgroundColor: fold.cardSoft,
                    opacity: !hasBody ? 0.45 : pressed ? 0.82 : 1,
                  },
                ]}>
                <MaterialIcons name="content-copy" size={14} color={fold.ink2} />
                <Text style={[styles.copyBtnText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
                  复制
                </Text>
              </Pressable>
            </View>
            <Text style={[styles.footnote, { color: fold.faint }]} maxFontSizeMultiplier={1.25}>
              内容仅基于你本机的复盘数据生成 · 不用于训练
            </Text>
          </FoldRiseIn>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    height: undefined,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 6,
    gap: 8,
  },
  headerBack: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '700', letterSpacing: 0.1 },
  headerSub: { fontSize: 9.5, marginTop: 1 },
  headerPill: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 20,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerPillText: { fontSize: 10, fontWeight: '700' },
  scroll: {
    paddingHorizontal: 15,
    paddingTop: 0,
    gap: 6,
  },
  hero: {
    marginHorizontal: -15,
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    marginBottom: 9,
    overflow: 'hidden',
    position: 'relative',
  },
  heroRingA: {
    position: 'absolute',
    right: -44,
    top: -58,
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 1,
    borderColor: 'rgba(241,190,120,0.18)',
  },
  heroRingB: {
    position: 'absolute',
    right: 18,
    top: 12,
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  heroKicker: { flexDirection: 'row', alignItems: 'center', gap: 6, zIndex: 1 },
  heroKickerText: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontSize: 20,
    lineHeight: 28,
    fontWeight: '600',
    fontFamily: foldFonts.serif,
    letterSpacing: 0.2,
    marginTop: 9,
    maxWidth: 300,
    zIndex: 1,
  },
  heroBody: { fontSize: 11, lineHeight: 17, marginTop: 4, zIndex: 1 },
  heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 10, zIndex: 1 },
  heroTag: {
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  heroTagText: { fontSize: 9.5, fontWeight: '700' },
  skeletonBlock: { gap: 6 },
  skeletonCard: { paddingVertical: 10 },
  skeletonRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  skeletonCol: { flex: 1, gap: 7 },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 11,
  },
  insightIcon: {
    width: 25,
    height: 25,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  insightCopy: { flex: 1, minWidth: 0 },
  insightTitle: { fontSize: 12, fontWeight: '700', lineHeight: 17 },
  insightBody: { fontSize: 10.5, lineHeight: 16, marginTop: 3 },
  insightConf: { fontSize: 9, fontFamily: foldFonts.mono, marginTop: 2 },
  rawCard: { paddingVertical: 10, paddingHorizontal: 11 },
  rawText: { fontSize: 12, lineHeight: 19 },
  emptyCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', paddingVertical: 12 },
  emptyIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  emptyText: { flex: 1, fontSize: 12, lineHeight: 18 },
  chartCard: { paddingVertical: 10, paddingHorizontal: 12, gap: 4 },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chartTitle: { fontSize: 11.5, fontWeight: '800' },
  chartTrend: { fontSize: 9.5 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  chartLabel: { fontSize: 9, fontFamily: foldFonts.mono },
  suggestCard: { paddingVertical: 10, paddingHorizontal: 12, gap: 2 },
  suggestHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  suggestTitle: { fontSize: 12, fontWeight: '800' },
  suggestCount: { fontSize: 10 },
  suggestRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingVertical: 7 },
  suggestBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestIndex: { fontSize: 8.5, fontFamily: foldFonts.mono, fontWeight: '700' },
  suggestText: { flex: 1, fontSize: 11, lineHeight: 17 },
  divider: { height: StyleSheet.hairlineWidth },
  aiActions: { flexDirection: 'row', gap: 6, marginTop: 4 },
  primaryBtn: {
    flex: 1,
    height: 40,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryBtnText: { fontSize: 12, fontWeight: '800' },
  copyBtn: {
    width: 84,
    height: 40,
    borderRadius: 13,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  copyBtnText: { fontSize: 11, fontWeight: '700' },
  footnote: { fontSize: 9.5, textAlign: 'center', marginTop: 8, marginBottom: 4 },
});
