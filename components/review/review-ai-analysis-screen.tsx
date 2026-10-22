import { FoldCard, foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import type { DailyEntry } from '@/components/review/review-utils';
import { Skeleton } from '@/components/ui/skeleton';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { generateReviewAiAnalysis, reviewHasEnoughTextForAi, type ReviewAiScope } from '@/lib/review-ai-analysis';
import { parseReviewAiDigest, type ReviewAiSection } from '@/lib/review-ai-sections';
import { listDailyReviewsBetween } from '@/lib/repositories/insights/daily-review-journal';
import {
  parseDailyReviewJournal,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import Svg, { Circle, Path } from 'react-native-svg';

const CHART_W = 300;
const CHART_H = 92;
const CHART_INSET_X = 10;
const CHART_INSET_Y = 10;

/** 心情 emoji → 0~1 的心情刻度（仅用于趋势曲线） */
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

const SECTION_ICONS: Record<
  ReviewAiSection['key'],
  { icon: React.ComponentProps<typeof MaterialIcons>['name']; tint: 'clay' | 'amber' | 'sage' }
> = {
  problems: { icon: 'error-outline', tint: 'clay' },
  risks: { icon: 'trending-up', tint: 'amber' },
  suggestions: { icon: 'auto-awesome', tint: 'sage' },
};

const SECTION_HINTS: Record<ReviewAiSection['key'], string> = {
  problems: '基于原文已暴露的问题',
  risks: '按当前节奏延续可能出现的盲点',
  suggestions: '下一步可以先做的一件小事',
};

function plainLength(fields: ReviewFieldValues): number {
  let total = 0;
  for (const value of Object.values(fields ?? {})) {
    total += (value ?? '').replace(/\s+/g, '').length;
  }
  return total;
}

function buildSeriesPath(values: (number | null)[]): string {
  const innerW = CHART_W - CHART_INSET_X * 2;
  const innerH = CHART_H - CHART_INSET_Y * 2;
  const segments: string[] = [];
  let current: string[] = [];

  values.forEach((value, index) => {
    if (value == null) {
      if (current.length > 0) {
        segments.push(current.join(' '));
        current = [];
      }
      return;
    }
    const x = CHART_INSET_X + (index / Math.max(1, values.length - 1)) * innerW;
    const y = CHART_INSET_Y + (1 - value) * innerH;
    current.push(`${current.length > 0 ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`);
  });

  if (current.length > 0) segments.push(current.join(' '));
  return segments.join(' ');
}

function seriesDots(values: (number | null)[]): { x: number; y: number }[] {
  const innerW = CHART_W - CHART_INSET_X * 2;
  const innerH = CHART_H - CHART_INSET_Y * 2;
  const dots: { x: number; y: number }[] = [];
  values.forEach((value, index) => {
    if (value == null) return;
    dots.push({
      x: CHART_INSET_X + (index / Math.max(1, values.length - 1)) * innerW,
      y: CHART_INSET_Y + (1 - value) * innerH,
    });
  });
  return dots;
}

export type ReviewAiAnalysisScreenProps = {
  visible: boolean;
  onClose: () => void;
  scope: ReviewAiScope;
  /** 副标题里的周期名，如「周复盘」 */
  scopeLabel: string;
  weekNo: number;
  periodLabel: string;
  weekStartYmd: string;
  template: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
  dailyEntries: DailyEntry[];
  initialText: string | null;
  canEdit: boolean;
  /** 把分析正文写回复盘（父组件负责落库） */
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
  const { fold, palette } = useFoldTheme();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [moodByYmd, setMoodByYmd] = useState<Record<string, string>>({});

  /** 本地草稿优先；未生成时回落到库里已保存的正文 */
  const text = draft ?? initialText ?? '';

  // 近 7 天心情：只在打开时读一次，供趋势曲线使用
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
    () => (filledDimensions.length > 0 ? filledDimensions.slice(0, 4).map(item => item.title) : ['本周暂无记录']),
    [filledDimensions],
  );

  const headline = useMemo(() => {
    if (digest.headline) return digest.headline;
    const count = filledDimensions.length;
    if (count === 0) return '这一周，还没有留下可以被观察的文字。';
    return `这一周，你在${filledDimensions
      .slice(0, 2)
      .map(item => item.title)
      .join('、')}之间留下了痕迹。`;
  }, [digest.headline, filledDimensions]);

  const heroBody = useMemo(() => {
    const intro = digest.intro.replace(digest.headline, '').trim();
    if (intro) return intro;
    return `分析只基于你在${periodLabel}写下的内容，以及近 7 天日复盘的记录。`;
  }, [digest.headline, digest.intro, periodLabel]);

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

  const recordValues = useMemo(() => {
    const lengths = dailyEntries.map(entry => plainLength(entry.fields));
    const max = Math.max(1, ...lengths);
    return lengths.map(length => length / max);
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
    setBusy(true);
    try {
      const result = await generateReviewAiAnalysis({
        scope,
        periodLabel,
        template,
        fields,
      });
      setDraft(result);
      await onPersist(result);
      toast.success('已生成新的 AI 分析');
    } catch (e) {
      console.warn('review ai analysis', e);
      toast.error(toUserMessage(e, '生成失败，请检查网络后重试'));
    } finally {
      setBusy(false);
    }
  }, [canEdit, fields, onPersist, periodLabel, scope, template]);

  const writeIn = useCallback(async () => {
    if (!text.trim()) {
      await generate();
      return;
    }
    try {
      await onPersist(text);
      toast.success('已写入复盘');
    } catch (e) {
      console.warn('review ai persist', e);
      toast.error(toUserMessage(e, '写入失败，请稍后重试'));
    }
  }, [generate, onPersist, text]);

  const handleClose = useCallback(() => {
    setDraft(null);
    setExpanded({});
    onClose();
  }, [onClose]);

  const copyText = useCallback(async () => {
    if (!text.trim()) {
      toast.error('还没有可复制的内容');
      return;
    }
    await Clipboard.setStringAsync(text);
    toast.success('已复制 AI 分析');
  }, [text]);

  const chartMoodPath = useMemo(() => buildSeriesPath(moodValues), [moodValues]);
  const chartRecordPath = useMemo(() => buildSeriesPath(recordValues), [recordValues]);
  const moodDots = useMemo(() => seriesDots(moodValues), [moodValues]);
  const recordDots = useMemo(() => seriesDots(recordValues), [recordValues]);

  const hasBody = text.trim().length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="fullScreen"
      statusBarTranslucent>
      <SafeAreaView style={[styles.root, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
        <View style={[styles.header, { borderBottomColor: fold.line }]}>
          <Pressable
            onPress={handleClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="返回"
            style={({ pressed }) => [styles.headerBack, { opacity: pressed ? 0.6 : 1 }]}>
            <MaterialIcons name="arrow-back-ios-new" size={19} color={fold.ink2} />
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
          contentContainerStyle={[styles.scroll, { paddingBottom: 20 + Math.max(insets.bottom, 12) }]}>
          <View style={[styles.hero, { backgroundColor: fold.summaryBg }]}>
            <View style={styles.heroKicker}>
              <MaterialIcons name="auto-awesome" size={13} color={fold.badgeText} />
              <Text style={[styles.heroKickerText, { color: fold.badgeText }]} maxFontSizeMultiplier={1.2}>
                AI OBSERVATION · 第 {weekNo} 周
              </Text>
            </View>
            <Text style={[styles.heroTitle, { color: fold.summaryText }]} maxFontSizeMultiplier={1.25}>
              {headline}
            </Text>
            <Text style={[styles.heroBody, { color: fold.summaryMuted }]} maxFontSizeMultiplier={1.3}>
              {heroBody}
            </Text>
            <View style={styles.heroTags}>
              {heroTags.map(tag => (
                <View key={tag} style={[styles.heroTag, { borderColor: fold.summaryLine }]}>
                  <Text style={[styles.heroTagText, { color: fold.summaryMuted }]} maxFontSizeMultiplier={1.2}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {busy && !hasBody ? (
            <FoldCard style={styles.skeletonCard}>
              <Skeleton width="72%" height={16} borderRadius={6} />
              <Skeleton width="100%" height={12} borderRadius={5} />
              <Skeleton width="88%" height={12} borderRadius={5} />
            </FoldCard>
          ) : null}

          {digest.sections.length > 0 ? (
            digest.sections.map(section => {
              const meta = SECTION_ICONS[section.key];
              const tint =
                meta.tint === 'clay'
                  ? { bg: fold.clay2, fg: fold.clay }
                  : meta.tint === 'amber'
                    ? { bg: fold.amber2, fg: fold.amber }
                    : { bg: fold.sage2, fg: fold.pine };
              const isExpanded = !!expanded[section.key];
              return (
                <Pressable
                  key={section.key}
                  onPress={() => setExpanded(prev => ({ ...prev, [section.key]: !isExpanded }))}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: isExpanded }}
                  accessibilityLabel={`${section.title}，${section.items.length} 条`}
                  style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
                  <FoldCard style={styles.insightCard}>
                    <View style={styles.insightHead}>
                      <View style={[styles.insightIcon, { backgroundColor: tint.bg }]}>
                        <MaterialIcons name={meta.icon} size={15} color={tint.fg} />
                      </View>
                      <Text style={[styles.insightTitle, { color: fold.ink }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                        {section.title}
                      </Text>
                      <Text style={[styles.insightCount, { color: fold.faint }]} maxFontSizeMultiplier={1.2}>
                        {section.items.length} 条
                      </Text>
                    </View>
                    {isExpanded ? (
                      <View style={styles.insightList}>
                        {section.items.map((item, index) => (
                          <View key={`${section.key}-${index}`} style={styles.insightItem}>
                            <View style={[styles.insightDot, { backgroundColor: tint.fg }]} />
                            <Text style={[styles.insightItemText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.35}>
                              {item}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : (
                      <Text
                        style={[styles.insightPreview, { color: fold.muted }]}
                        numberOfLines={2}
                        maxFontSizeMultiplier={1.3}>
                        {section.items[0]}
                      </Text>
                    )}
                    <Text style={[styles.insightHint, { color: fold.faint }]} maxFontSizeMultiplier={1.25}>
                      {SECTION_HINTS[section.key]} · 点击展开
                    </Text>
                  </FoldCard>
                </Pressable>
              );
            })
          ) : hasBody ? (
            <FoldCard style={styles.rawCard}>
              <Text style={[styles.rawText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.35}>
                {text}
              </Text>
            </FoldCard>
          ) : (
            <FoldCard tone="muted" style={styles.emptyCard}>
              <View style={[styles.emptyIcon, { backgroundColor: fold.sage2 }]}>
                <MaterialIcons name="auto-awesome" size={17} color={fold.pine} />
              </View>
              <Text style={[styles.emptyText, { color: fold.muted }]} maxFontSizeMultiplier={1.35}>
                {canEdit
                  ? `写下${scopeLabel}内容后，这里会整理出观察、风险与三条可执行的小动作。`
                  : '请在每周复盘日生成 AI 分析；在此之前可以先写日复盘。'}
              </Text>
            </FoldCard>
          )}

          <FoldCard style={styles.chartCard}>
            <View style={styles.chartHead}>
              <Text style={[styles.chartTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                7 天心情 / 记录
              </Text>
              <View style={styles.legend}>
                <View style={styles.legendItem}>
                  <View style={[styles.legendLine, { backgroundColor: fold.sage }]} />
                  <Text style={[styles.legendText, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                    心情
                  </Text>
                </View>
                <View style={styles.legendItem}>
                  <View style={[styles.legendDash, { borderColor: fold.amber }]} />
                  <Text style={[styles.legendText, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                    记录
                  </Text>
                </View>
              </View>
            </View>
            <Svg width="100%" height={CHART_H} viewBox={`0 0 ${CHART_W} ${CHART_H}`}>
              <Path
                d={chartMoodPath}
                fill="none"
                stroke={fold.sage}
                strokeWidth={2.2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <Path
                d={chartRecordPath}
                fill="none"
                stroke={fold.amber}
                strokeWidth={1.8}
                strokeDasharray="4 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {moodDots.map((dot, index) => (
                <Circle key={`mood-${index}`} cx={dot.x} cy={dot.y} r={2.6} fill={fold.sage} />
              ))}
              {recordDots.map((dot, index) => (
                <Circle key={`record-${index}`} cx={dot.x} cy={dot.y} r={2.2} fill={fold.amber} />
              ))}
            </Svg>
            <View style={styles.chartLabels}>
              {dailyEntries.map(entry => (
                <Text key={entry.ymd} style={[styles.chartLabel, { color: fold.faint }]} maxFontSizeMultiplier={1.2}>
                  {entry.label.replace(/^\d+月\d+日\s*/, '').replace(/^周/, '')}
                </Text>
              ))}
            </View>
          </FoldCard>

          {suggestionItems.length > 0 ? (
            <FoldCard style={styles.suggestCard}>
              <View style={styles.suggestHead}>
                <Text style={[styles.suggestTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
                  下周可以试试
                </Text>
                <Text style={[styles.suggestCount, { color: fold.faint }]} maxFontSizeMultiplier={1.2}>
                  {suggestionItems.length} 个很小的动作
                </Text>
              </View>
              {suggestionItems.slice(0, 4).map((item, index) => (
                <View key={`suggest-${index}`} style={styles.suggestRow}>
                  {index > 0 ? <View style={[styles.divider, { backgroundColor: fold.line }]} /> : null}
                  <View style={styles.suggestIndexRow}>
                    <Text style={[styles.suggestIndex, { color: palette.amberInk }]} maxFontSizeMultiplier={1.2}>
                      {String(index + 1).padStart(2, '0')}
                    </Text>
                    <Text style={[styles.suggestText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.35}>
                      {item}
                    </Text>
                  </View>
                </View>
              ))}
            </FoldCard>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { borderTopColor: fold.line, paddingBottom: Math.max(insets.bottom, 10) }]}>
          <View style={styles.footerActions}>
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
                  <MaterialIcons name="check" size={17} color={fold.onPineButton} />
                  <Text style={[styles.primaryBtnText, { color: fold.onPineButton }]} maxFontSizeMultiplier={1.3}>
                    {hasBody ? '写入 AI 分析' : '生成 AI 分析'}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={() => void copyText()}
              disabled={!hasBody}
              accessibilityRole="button"
              accessibilityLabel="复制 AI 分析"
              style={({ pressed }) => [
                styles.copyBtn,
                {
                  borderColor: fold.line2,
                  backgroundColor: fold.card,
                  opacity: !hasBody ? 0.45 : pressed ? 0.82 : 1,
                },
              ]}>
              <MaterialIcons name="content-copy" size={15} color={fold.ink2} />
              <Text style={[styles.copyBtnText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
                复制
              </Text>
            </Pressable>
          </View>
          <Text style={[styles.footnote, { color: fold.faint }]} maxFontSizeMultiplier={1.25}>
            内容仅基于本机的复盘数据生成 · 不用于诊断
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 15, fontWeight: '800', fontFamily: foldFonts.serif },
  headerSub: { fontSize: 10.5, marginTop: 1 },
  headerPill: {
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerPillText: { fontSize: 11.5, fontWeight: '700' },
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 0,
    gap: 10,
  },
  hero: {
    marginHorizontal: -16,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 26,
    borderBottomLeftRadius: 26,
    borderBottomRightRadius: 26,
    gap: 8,
  },
  heroKicker: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  heroKickerText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  heroTitle: {
    fontSize: 23,
    lineHeight: 32,
    fontWeight: '600',
    fontFamily: foldFonts.serif,
    letterSpacing: 0.2,
  },
  heroBody: { fontSize: 11.5, lineHeight: 18 },
  heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 2 },
  heroTag: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  heroTagText: { fontSize: 10, fontWeight: '700' },
  skeletonCard: { gap: 10 },
  insightCard: { gap: 7 },
  insightHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  insightIcon: { width: 26, height: 26, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  insightTitle: { flex: 1, fontSize: 13.5, fontWeight: '800' },
  insightCount: { fontSize: 10.5, fontFamily: foldFonts.mono },
  insightPreview: { fontSize: 11.5, lineHeight: 17 },
  insightList: { gap: 6 },
  insightItem: { flexDirection: 'row', gap: 7, alignItems: 'flex-start' },
  insightDot: { width: 4, height: 4, borderRadius: 2, marginTop: 6 },
  insightItemText: { flex: 1, fontSize: 11.5, lineHeight: 18 },
  insightHint: { fontSize: 9.5 },
  rawCard: { gap: 8 },
  rawText: { fontSize: 12.5, lineHeight: 20 },
  emptyCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  emptyIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  emptyText: { flex: 1, fontSize: 12, lineHeight: 18 },
  chartCard: { gap: 6 },
  chartHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chartTitle: { fontSize: 13, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLine: { width: 12, height: 2, borderRadius: 1 },
  legendDash: { width: 12, height: 0, borderTopWidth: 2, borderStyle: 'dashed' },
  legendText: { fontSize: 10 },
  chartLabels: { flexDirection: 'row', justifyContent: 'space-between' },
  chartLabel: { fontSize: 9.5 },
  suggestCard: { gap: 8 },
  suggestHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  suggestTitle: { fontSize: 13, fontWeight: '800' },
  suggestCount: { fontSize: 10 },
  suggestRow: { gap: 8 },
  suggestIndexRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  suggestIndex: { fontSize: 11, fontFamily: foldFonts.mono, width: 20 },
  suggestText: { flex: 1, fontSize: 11.5, lineHeight: 18 },
  divider: { height: StyleSheet.hairlineWidth },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    backgroundColor: '#FFFFFF00',
  },
  footerActions: { flexDirection: 'row', gap: 8 },
  primaryBtn: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryBtnText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.2 },
  copyBtn: {
    minWidth: 92,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  copyBtnText: { fontSize: 12.5, fontWeight: '700' },
  footnote: { fontSize: 9.5, textAlign: 'center', marginTop: 8 },
});
