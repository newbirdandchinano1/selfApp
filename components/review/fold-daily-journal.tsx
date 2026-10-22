import { FoldRiseIn, useFoldMotionGate } from '@/components/review/fold-motion';
import { FoldCard, FoldSectionHeader, FoldTag, foldFonts } from '@/components/review/fold-ui';
import {
  dailyEntryHasContent,
  formatClockFromDatetime,
  isDailyReviewEditableYmd,
  isDailySkipped,
  splitEntryLabel,
  type DailyEntry,
} from '@/components/review/review-utils';
import { Typography } from '@/constants/design-tokens';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from 'react-native';

const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const;

function cleanLine(raw: string): string {
  return raw
    .replace(/^[\s#>*-]+/, '')
    .replace(/^\[[^\]]{1,8}\]\s*/, '')
    .replace(/^【[^】]{1,12}】\s*/, '')
    .trim();
}

function summarize(
  fields: Record<string, string>,
  template: ReviewDimensionTemplate[],
): { title: string; preview: string; filledDims: number } {
  const lines: string[] = [];
  let filledDims = 0;
  for (const dim of template) {
    let dimFilled = false;
    for (const col of dim.columns) {
      const plain = reviewContentToPlainDisplay(fields[col.id] ?? '');
      for (const line of plain.split('\n')) {
        const clean = cleanLine(line);
        if (!clean) continue;
        dimFilled = true;
        lines.push(clean);
      }
    }
    if (dimFilled) filledDims += 1;
  }
  const title = (lines[0] ?? '').slice(0, 16);
  const preview = lines.slice(1).join(' · ');
  return { title, preview, filledDims };
}

type DayChipState = 'filled' | 'missing' | 'week';

function DayStrip({
  entries,
  todayYmd,
  reviewCycleEndYmd,
  configuredDow,
  onOpenDay,
  animate,
}: {
  entries: DailyEntry[];
  todayYmd: string;
  reviewCycleEndYmd: string;
  configuredDow: number | null;
  onOpenDay: (ymd: string) => void;
  animate: boolean;
}) {
  const { palette } = useFoldTheme();
  return (
    <View style={styles.strip}>
      {entries.map((entry, index) => {
        const isToday = entry.ymd === todayYmd;
        const skipped = isDailySkipped(entry.ymd, reviewCycleEndYmd, configuredDow);
        const filled = !skipped && dailyEntryHasContent(entry.fields);
        const state: DayChipState = skipped ? 'week' : filled ? 'filled' : 'missing';
        const date = Number(entry.ymd.slice(8, 10));
        const dow = new Date(Number(entry.ymd.slice(0, 4)), Number(entry.ymd.slice(5, 7)) - 1, date).getDay();
        const weekend = dow === 0 || dow === 6;
        const dotColor =
          state === 'week' ? palette.amber : state === 'filled' ? palette.sage : palette.lineStrong;

        return (
          <FoldRiseIn key={entry.ymd} animate={animate} index={index} staggerMs={55} duration={420} style={styles.dayCapWrap}>
            <Pressable
              onPress={() => onOpenDay(entry.ymd)}
              accessibilityRole="button"
              accessibilityLabel={`${entry.label}，${state === 'week' ? '周复盘日' : filled ? '已填' : '待填'}`}
              style={({ pressed }) => [
                styles.dayCap,
                isToday && { backgroundColor: palette.pineSolid, borderColor: palette.pineSolid },
                pressed && { opacity: 0.85 },
              ]}>
              <Text
                style={[
                  styles.dayCapDow,
                  { color: isToday ? palette.onPine : weekend ? palette.clay : palette.muted },
                ]}
                maxFontSizeMultiplier={1.35}>
                {WEEKDAY_SHORT[dow]}
              </Text>
              <Text
                style={[styles.dayCapNum, { color: isToday ? palette.onPine : palette.inkSoft }]}
                maxFontSizeMultiplier={1.35}>
                {String(date).padStart(2, '0')}
              </Text>
              <View style={[styles.dayCapDot, { backgroundColor: dotColor }]} />
            </Pressable>
          </FoldRiseIn>
        );
      })}
    </View>
  );
}

export function FoldDailyJournal({
  entries,
  template,
  todayYmd,
  yesterdayYmd,
  filledCount,
  totalCount,
  streak,
  configuredDow,
  reviewCycleEndYmd,
  lastSyncLabel,
  weekNumber,
  onOpenDay,
  refreshControl,
}: {
  entries: DailyEntry[];
  template: ReviewDimensionTemplate[];
  todayYmd: string;
  yesterdayYmd: string;
  filledCount: number;
  totalCount: number;
  streak: number;
  configuredDow: number | null;
  reviewCycleEndYmd: string;
  lastSyncLabel: string | null;
  weekNumber: number;
  onOpenDay: (ymd: string) => void;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  const { palette } = useFoldTheme();
  const { animate } = useFoldMotionGate();

  const summaries = useMemo(
    () => new Map(entries.map(entry => [entry.ymd, summarize(entry.fields, template)])),
    [entries, template],
  );

  return (
    <ScrollView
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scroll}>
      <DayStrip
        entries={entries}
        todayYmd={todayYmd}
        reviewCycleEndYmd={reviewCycleEndYmd}
        configuredDow={configuredDow}
        onOpenDay={onOpenDay}
        animate={animate}
      />

      <FoldRiseIn animate={animate} index={0} delayMs={120} staggerMs={0} duration={360}>
        <View style={styles.syncLine}>
          <View style={styles.syncLeft}>
            <MaterialIcons name="sync" size={11} color={palette.faint} />
            <Text style={[styles.syncText, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
              {lastSyncLabel ? `最近同步 ${lastSyncLabel}` : '本地优先'}
            </Text>
          </View>
          <Text style={[styles.syncText, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
            聚焦刷新
          </Text>
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={animate} index={1} delayMs={140} staggerMs={0} duration={360}>
        <View style={styles.sectionHead}>
          <FoldSectionHeader
            title="本周日刊"
            hint={`已填 ${filledCount} / ${totalCount}${streak > 0 ? ` · 连续 ${streak} 天` : ''}`}
          />
        </View>
      </FoldRiseIn>

      <View style={styles.list}>
        {entries.map((entry, index) => {
          const skipped = isDailySkipped(entry.ymd, reviewCycleEndYmd, configuredDow);
          const filled = !skipped && dailyEntryHasContent(entry.fields);
          const canEdit = !skipped && isDailyReviewEditableYmd(entry.ymd, todayYmd);
          const isToday = entry.ymd === todayYmd;
          const isYesterday = entry.ymd === yesterdayYmd;
          const { date, weekday } = splitEntryLabel(entry.label, entry.ymd);
          const summary = summaries.get(entry.ymd);
          const clock = formatClockFromDatetime(entry.updatedAt);

          const title = skipped
            ? '请填写每周复盘'
            : filled
              ? summary?.title || '今日已落笔'
              : canEdit
                ? '今天还没有落笔'
                : '留白的一天';
          const preview = skipped
            ? `本周已写 ${filledCount} 天。用 10 分钟回看这一周，再把下周的自己送到更好的位置。`
            : filled
              ? summary?.preview || '已写下的内容会出现在这里。'
              : canEdit
                ? '留三分钟给今天：记录一件完成的事，和一个想改的地方。'
                : '这一天还没有留下文字。';

          return (
            <FoldRiseIn key={entry.ymd} animate={animate} index={index} delayMs={180} staggerMs={55} duration={420}>
              <Pressable
                onPress={() => onOpenDay(entry.ymd)}
                accessibilityRole="button"
                accessibilityLabel={`${entry.label}，${
                  skipped ? '周复盘日' : filled ? '已填' : canEdit ? '待填' : '未填写'
                }`}
                style={({ pressed }) => [
                  styles.row,
                  {
                    backgroundColor: isToday ? palette.amberSoft : palette.card,
                    borderColor: isToday ? palette.amber + '99' : palette.line,
                    opacity: pressed ? 0.9 : 1,
                  },
                ]}>
                <View style={styles.rowDate}>
                  <Text style={[styles.rowDateText, { color: isToday ? palette.amberInk : palette.inkSoft }]} maxFontSizeMultiplier={1.35}>
                    {date}
                  </Text>
                  <Text style={[styles.rowWeekday, { color: isToday ? palette.amberInk : palette.muted }]} maxFontSizeMultiplier={1.35}>
                    {isToday ? '今天' : isYesterday ? '昨天' : weekday}
                  </Text>
                </View>

                <View style={styles.rowMain}>
                  <View style={styles.rowTop}>
                    <Text
                      style={[styles.rowTitle, { color: palette.ink }]}
                      numberOfLines={1}
                      maxFontSizeMultiplier={1.35}>
                      {title}
                    </Text>
                    {skipped ? (
                      <FoldTag tone="amber">周复盘日</FoldTag>
                    ) : filled ? (
                      <FoldTag tone="green">已填</FoldTag>
                    ) : canEdit ? (
                      <FoldTag tone="amber">待填</FoldTag>
                    ) : (
                      <FoldTag tone="gray">未写</FoldTag>
                    )}
                    {isToday ? <FoldTag tone="clay">今天</FoldTag> : null}
                  </View>
                  <Text
                    style={[styles.rowPreview, { color: palette.muted }]}
                    numberOfLines={2}
                    maxFontSizeMultiplier={1.35}>
                    {preview}
                  </Text>
                </View>

                <View style={styles.rowState}>
                  <FoldTag tone={skipped ? 'pine' : 'gray'}>
                    {skipped ? (canEdit ? '可编辑' : '未到') : '日复盘'}
                  </FoldTag>
                  <Text style={[styles.rowMini, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
                    {skipped
                      ? `第 ${weekNumber} 周`
                      : filled
                        ? `${summary?.filledDims ?? 0} 维${clock ? ` · ${clock}` : ''}`
                        : summary?.filledDims
                          ? `${summary.filledDims} 维`
                          : '未保存'}
                  </Text>
                </View>
              </Pressable>
            </FoldRiseIn>
          );
        })}
      </View>

      <FoldRiseIn animate={animate} index={0} delayMs={180 + entries.length * 55} staggerMs={0} duration={400}>
        <FoldCard tone="quote" style={styles.quote}>
          <View style={styles.quoteBody}>
            <Text style={[styles.quoteKicker, { color: palette.amberInk }]} maxFontSizeMultiplier={1.35}>
              TODAY'S FOLD · 今日折角
            </Text>
            <Text style={[styles.quoteText, { color: palette.inkSoft }]} maxFontSizeMultiplier={1.35}>
              把今天折起来，留给明天一页空白。
            </Text>
          </View>
          <Text style={[styles.quoteWeek, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
            W{weekNumber}
          </Text>
        </FoldCard>
      </FoldRiseIn>

      <View style={styles.pullHint}>
        <MaterialIcons name="keyboard-arrow-down" size={12} color={palette.faint} />
        <Text style={[styles.pullHintText, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
          下拉 / 聚焦 / 本地变更 / 脏数据同步
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 120,
  },
  strip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  dayCapWrap: {
    flex: 1,
  },
  dayCap: {
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    gap: 3,
  },
  dayCapDow: {
    fontSize: 11,
    fontWeight: '600',
  },
  dayCapNum: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: foldFonts.mono,
    letterSpacing: -0.3,
  },
  dayCapDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  syncLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
    marginBottom: 12,
  },
  syncLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  syncText: {
    fontSize: 10,
    letterSpacing: 0.2,
  },
  sectionHead: {
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  list: {
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  rowDate: {
    width: 44,
    alignItems: 'center',
  },
  rowDateText: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: foldFonts.mono,
    letterSpacing: -0.3,
  },
  rowWeekday: {
    fontSize: 10,
    marginTop: 2,
  },
  rowMain: {
    flex: 1,
    minWidth: 0,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  rowTitle: {
    ...Typography.bodyStrong,
    fontSize: 14,
    flexShrink: 1,
  },
  rowPreview: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  rowState: {
    width: 76,
    alignItems: 'flex-end',
    gap: 4,
  },
  rowMini: {
    fontSize: 10,
    textAlign: 'right',
  },
  quote: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  quoteBody: {
    flex: 1,
    gap: 3,
  },
  quoteKicker: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  quoteText: {
    fontSize: 14,
    lineHeight: 20,
  },
  quoteWeek: {
    fontSize: 10,
    letterSpacing: 1,
  },
  pullHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: 14,
  },
  pullHintText: {
    fontSize: 10,
    letterSpacing: 0.4,
  },
});
