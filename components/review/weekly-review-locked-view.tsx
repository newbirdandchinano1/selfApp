import { FoldCard, foldDimensionGlyph, useFoldTheme } from '@/components/review/fold-ui';
import type { DailyEntry } from '@/components/review/review-utils';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import type { ReviewFieldValues } from '@/lib/repositories/insights/review-journal-body';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'] as const;

function ymdParts(ymd: string): { month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  return { month: Number(m[2]), day: Number(m[3]) };
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const from = ymdParts(fromYmd);
  const to = ymdParts(toYmd);
  if (!from || !to) return 0;
  const fromDate = new Date(Number(fromYmd.slice(0, 4)), from.month - 1, from.day);
  const toDate = new Date(Number(toYmd.slice(0, 4)), to.month - 1, to.day);
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

export type WeeklyReviewLockedViewProps = {
  weekNo: number;
  weekRangeLabel: string;
  configuredDow: number | null;
  configuredDowLabel?: string;
  reviewCycleEndYmd: string;
  todayYmd: string;
  dailyEntries: DailyEntry[];
  skippedYmds: Set<string>;
  dimensions: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
  onOpenDimension: (dimensionId: string) => void;
  onOpenDay: (ymd: string) => void;
  onOpenSettings: () => void;
};

/**
 * 周复盘只读态（设计稿 12）：未到复盘日时的整页结构。
 * 只保留「为什么只读 → 什么时候能写 → 现在还能做什么」三步，其余内容全部收拢。
 */
export function WeeklyReviewLockedView({
  weekNo,
  weekRangeLabel,
  configuredDow,
  configuredDowLabel,
  reviewCycleEndYmd,
  todayYmd,
  dailyEntries,
  skippedYmds,
  dimensions,
  fields,
  onOpenDimension,
  onOpenDay,
  onOpenSettings,
}: WeeklyReviewLockedViewProps) {
  const { fold, palette } = useFoldTheme();

  const dowLabel = configuredDowLabel ?? '周日';
  const daysLeft = useMemo(() => {
    if (!reviewCycleEndYmd) return null;
    return daysBetween(todayYmd, reviewCycleEndYmd);
  }, [reviewCycleEndYmd, todayYmd]);

  const writableDate = useMemo(() => {
    const parts = ymdParts(reviewCycleEndYmd);
    return parts ? `${parts.month}/${parts.day}` : '';
  }, [reviewCycleEndYmd]);

  const bannerTitle = configuredDow === null ? '请先设置每周复盘日' : `请在每${dowLabel}填写本周复盘`;

  const bannerBody =
    configuredDow === null
      ? '设定一个固定的复盘日；当天可填写并保存周维度，其余时间保持只读。'
      : daysLeft != null && daysLeft > 0
        ? `本周期为 ${weekRangeLabel} · 距离可编辑还有 ${daysLeft} 天`
        : `本周期为 ${weekRangeLabel} · 复盘日已到，写入后即可保存`;

  const dayChips = useMemo(
    () =>
      dailyEntries.map(entry => {
        const parts = ymdParts(entry.ymd);
        const weekday = WEEKDAY_SHORT[
          new Date(
            Number(entry.ymd.slice(0, 4)),
            Number(entry.ymd.slice(5, 7)) - 1,
            Number(entry.ymd.slice(8, 10)),
          ).getDay()
        ];
        const skipped = skippedYmds.has(entry.ymd);
        const filled = !skipped && Object.values(entry.fields ?? {}).some(v => (v ?? '').trim().length > 0);
        return {
          ymd: entry.ymd,
          day: parts?.day ?? entry.ymd,
          weekday,
          isToday: entry.ymd === todayYmd,
          isReviewDay: entry.ymd === reviewCycleEndYmd,
          filled,
        };
      }),
    [dailyEntries, reviewCycleEndYmd, skippedYmds, todayYmd],
  );

  const dimensionRows = useMemo(
    () =>
      dimensions.map(dim => {
        const preview = dim.columns
          .map(col => reviewContentToPlainDisplay(fields[col.id] ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
          .join(' · ');
        return {
          id: dim.id,
          title: dim.title,
          glyph: foldDimensionGlyph(dim.id),
          preview: preview || (dim.columns[0]?.placeholder ?? '还没有填写'),
        };
      }),
    [dimensions, fields],
  );

  return (
    <View style={styles.root}>
      <FoldCard style={styles.bannerCard}>
        <View style={[styles.bannerIcon, { backgroundColor: '#FFFFFF88' }]}>
          <MaterialIcons name="lock-outline" size={18} color={palette.amberInk} />
        </View>
        <View style={styles.bannerCopy}>
          <Text style={[styles.bannerTitle, { color: palette.amberInk }]} maxFontSizeMultiplier={1.3}>
            {bannerTitle}
          </Text>
          <Text style={[styles.bannerBody, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
            {bannerBody}
          </Text>
        </View>
        {configuredDow === null ? (
          <Pressable
            onPress={onOpenSettings}
            accessibilityRole="button"
            accessibilityLabel="去设置复盘日"
            style={({ pressed }) => [styles.bannerChip, { opacity: pressed ? 0.7 : 1 }]}>
            <Text style={[styles.bannerChipText, { color: palette.amberInk }]} maxFontSizeMultiplier={1.2}>
              去设置 ›
            </Text>
          </Pressable>
        ) : (
          <View style={[styles.bannerChip, { backgroundColor: fold.amber2 }]}>
            <Text style={[styles.bannerChipText, { color: palette.amberInk }]} maxFontSizeMultiplier={1.2}>
              {writableDate} 可写
            </Text>
          </View>
        )}
      </FoldCard>

      <View style={styles.stripHead}>
        <Text style={[styles.stripLabel, { color: fold.ink2 }]} maxFontSizeMultiplier={1.25}>
          本周期滚动 7 天
        </Text>
        <Text style={[styles.stripHint, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
          日复盘仍可正常填写
        </Text>
      </View>
      <View style={styles.dayStrip}>
        {dayChips.map(chip => {
          const isLocked = chip.isReviewDay;
          const bg = chip.isToday ? fold.pineButton : isLocked ? fold.amber2 : fold.card;
          const border = chip.isToday ? fold.pineButton : isLocked ? fold.amber : fold.line;
          const color = chip.isToday ? fold.onPineButton : isLocked ? palette.amberInk : fold.ink2;
          return (
            <Pressable
              key={chip.ymd}
              onPress={() => onOpenDay(chip.ymd)}
              accessibilityRole="button"
              accessibilityLabel={`${chip.day}日 ${chip.weekday}${
                chip.isToday ? ' 今天' : isLocked ? ' 复盘日' : chip.filled ? ' 已复盘' : ' 未复盘'
              }`}
              style={({ pressed }) => [
                styles.dayChip,
                { backgroundColor: bg, borderColor: border, opacity: pressed ? 0.8 : 1 },
              ]}>
              <Text style={[styles.dayChipNumber, { color }]} maxFontSizeMultiplier={1.2}>
                {chip.day}
              </Text>
              <Text
                style={[styles.dayChipWeekday, { color: chip.isToday ? fold.onPineButton : fold.muted }]}
                maxFontSizeMultiplier={1.2}>
                {chip.weekday}
              </Text>
              <Text
                style={[styles.dayChipNote, { color: chip.isToday ? fold.onPineButton : fold.faint }]}
                maxFontSizeMultiplier={1.15}>
                {chip.isToday ? '今天' : isLocked ? '复盘日' : chip.filled ? '已写' : '—'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sectionHead}>
        <Text style={[styles.sectionTitle, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
          维度预览 · 只读
        </Text>
        <Pressable
          onPress={() => onOpenDay(todayYmd)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="可先填写每日复盘"
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1 }]}>
          <Text style={[styles.sectionAction, { color: fold.muted }]} maxFontSizeMultiplier={1.25}>
            可先填写每日复盘 ›
          </Text>
        </Pressable>
      </View>

      <View style={styles.dimGrid}>
        {dimensionRows.map(dim => (
          <Pressable
            key={dim.id}
            onPress={() => onOpenDimension(dim.id)}
            accessibilityRole="button"
            accessibilityLabel={`${dim.title}，只读，点击查看`}
            style={({ pressed }) => [styles.dimPress, { opacity: pressed ? 0.9 : 1 }]}>
            <FoldCard style={styles.dimCard}>
              <View style={styles.dimHead}>
                <View style={styles.dimNameRow}>
                  <Text style={[styles.dimGlyph, { color: fold.muted }]} maxFontSizeMultiplier={1.2}>
                    {dim.glyph}
                  </Text>
                  <Text style={[styles.dimTitle, { color: fold.ink }]} numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {dim.title}
                  </Text>
                </View>
                <MaterialIcons name="lock-outline" size={13} color={fold.faint} />
              </View>
              <Text style={[styles.dimPreview, { color: fold.muted }]} numberOfLines={2} maxFontSizeMultiplier={1.3}>
                {dim.preview}
              </Text>
            </FoldCard>
          </Pressable>
        ))}
        {dimensionRows.length === 0 ? (
          <FoldCard tone="muted" style={styles.dimEmpty}>
            <Text style={[styles.dimPreview, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
              尚未配置周复盘维度，可先到「复盘模板设置」添加。
            </Text>
          </FoldCard>
        ) : null}
      </View>

      <View style={[styles.lockBar, { borderColor: fold.line2, backgroundColor: fold.paper2 }]}>
        <MaterialIcons name="lock-outline" size={14} color={fold.muted} />
        <Text style={[styles.lockBarText, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
          请在{dowLabel}填写本周复盘
        </Text>
      </View>

      <FoldCard tone="muted" style={styles.notesCard}>
        {[
          { icon: 'schedule' as const, text: '未来日期：整体只读，避免提前填写不真实的复盘。' },
          { icon: 'event-busy' as const, text: '非复盘日：周维度只读，但日复盘仍可填写。' },
          { icon: 'lock-open' as const, text: '复盘日解锁：解锁本周维度，可保存并写入 AI 建议。' },
        ].map((note, index) => (
          <View key={note.text} style={styles.noteRow}>
            {index > 0 ? <View style={[styles.divider, { backgroundColor: fold.line }]} /> : null}
            <View style={styles.noteItem}>
              <MaterialIcons name={note.icon} size={13} color={fold.faint} />
              <Text style={[styles.noteText, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
                {note.text}
              </Text>
            </View>
          </View>
        ))}
      </FoldCard>

      <FoldCard style={styles.todayCard}>
        <View style={[styles.todayIcon, { backgroundColor: fold.sage2 }]}>
          <MaterialIcons name="edit-note" size={17} color={fold.pine} />
        </View>
        <View style={styles.todayCopy}>
          <Text style={[styles.todayTitle, { color: fold.ink }]} maxFontSizeMultiplier={1.3}>
            今天仍然可以写日复盘
          </Text>
          <Text style={[styles.todayBody, { color: fold.muted }]} maxFontSizeMultiplier={1.3}>
            未来日期整体只读，但今天的内容可以正常保存。
          </Text>
        </View>
        <Pressable
          onPress={() => onOpenDay(todayYmd)}
          accessibilityRole="button"
          accessibilityLabel="去写今天的日复盘"
          style={({ pressed }) => [
            styles.todayBtn,
            { borderColor: fold.line2, opacity: pressed ? 0.7 : 1 },
          ]}>
          <Text style={[styles.todayBtnText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.25}>
            去写 ›
          </Text>
        </Pressable>
      </FoldCard>

      <Text style={[styles.footNote, { color: fold.faint }]} maxFontSizeMultiplier={1.25}>
        第 {weekNo} 周 · {weekRangeLabel} · 维度在复盘日解锁
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 10 },
  bannerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    backgroundColor: '#F7EEDC',
    borderColor: '#E9D3AE',
  },
  bannerIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  bannerCopy: { flex: 1, minWidth: 0, gap: 2 },
  bannerTitle: { fontSize: 13, fontWeight: '800' },
  bannerBody: { fontSize: 10.5, lineHeight: 15 },
  bannerChip: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  bannerChipText: { fontSize: 10, fontWeight: '800' },
  stripHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  stripLabel: { fontSize: 11.5, fontWeight: '700' },
  stripHint: { fontSize: 10.5 },
  dayStrip: { flexDirection: 'row', gap: 5 },
  dayChip: {
    flex: 1,
    minHeight: 52,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  dayChipNumber: { fontSize: 15, fontWeight: '800' },
  dayChipWeekday: { fontSize: 9.5 },
  dayChipNote: { fontSize: 8.5 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '800', letterSpacing: 0.4 },
  sectionAction: { fontSize: 10.5, fontWeight: '600' },
  dimGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  dimPress: { width: '48%', flexGrow: 1 },
  dimCard: { minHeight: 92, gap: 7, paddingHorizontal: 11, paddingVertical: 10 },
  dimHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  dimNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  dimGlyph: { fontSize: 13 },
  dimTitle: { fontSize: 12.5, fontWeight: '800', flexShrink: 1 },
  dimPreview: { fontSize: 11, lineHeight: 16 },
  dimEmpty: { width: '100%' },
  lockBar: {
    minHeight: 42,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  lockBarText: { fontSize: 12, fontWeight: '700' },
  notesCard: { gap: 8, paddingVertical: 12 },
  noteRow: { gap: 8 },
  noteItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  noteText: { flex: 1, fontSize: 10.5, lineHeight: 15 },
  divider: { height: StyleSheet.hairlineWidth },
  todayCard: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  todayIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  todayCopy: { flex: 1, minWidth: 0, gap: 2 },
  todayTitle: { fontSize: 13, fontWeight: '800' },
  todayBody: { fontSize: 10.5, lineHeight: 15 },
  todayBtn: { borderRadius: 999, borderWidth: 1, paddingHorizontal: 11, paddingVertical: 6 },
  todayBtnText: { fontSize: 11, fontWeight: '700' },
  footNote: { fontSize: 9.5, textAlign: 'center' },
});
