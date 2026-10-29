import { FoldCard, FoldIconButton, FoldTag, foldFonts } from '@/components/review/fold-ui';
import { DAILY_REVIEW_MOOD_OPTIONS, DAILY_REVIEW_WEATHER_OPTIONS } from '@/components/review/daily-review-grid-parts';
import { Typography } from '@/constants/design-tokens';
import { useFoldTheme, type FoldSemanticPalette } from '@/constants/review-fold-theme';
import type { ReviewDayFacts } from '@/lib/review-day-facts';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import type { ReviewJournalMeta } from '@/lib/repositories/insights/review-journal-body';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const MOOD_LABEL: Record<string, string> = {
  '😀': '愉快',
  '🙂': '平静',
  '😎': '从容',
  '😐': '一般',
  '😔': '低落',
  '😤': '烦躁',
  '🥳': '兴奋',
  '😴': '疲惫',
};

const MOTTOS = [
  '宜慢慢收束',
  '宜留一点空白',
  '宜把难事放前面',
  '宜早些睡',
  '宜只做三件事',
  '宜出门走走',
  '宜把话说清楚',
];

export function foldDayMotto(ymd: string): string {
  const n = Number(ymd.slice(8, 10)) + Number(ymd.slice(5, 7)) * 31;
  return MOTTOS[Math.abs(n) % MOTTOS.length] ?? MOTTOS[0]!;
}

export function FoldDayAppBar({
  title,
  subtitle,
  onBack,
  onMore,
  topInset,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  onMore?: () => void;
  topInset: number;
}) {
  const { palette } = useFoldTheme();
  return (
    <View style={[styles.appbar, { paddingTop: topInset + 6 }]}>
      <FoldIconButton icon="arrow-back" onPress={onBack} accessibilityLabel="返回" />
      <View style={styles.appbarCenter}>
        <Text style={[styles.appbarTitle, { color: palette.ink }]} maxFontSizeMultiplier={1.35}>
          {title}
        </Text>
        <Text
          style={[styles.appbarSub, { color: palette.faint }]}
          numberOfLines={1}
          maxFontSizeMultiplier={1.35}>
          {subtitle}
        </Text>
      </View>
      {onMore ? (
        <FoldIconButton icon="more-horiz" onPress={onMore} accessibilityLabel="更多操作" variant="soft" />
      ) : (
        <View style={styles.appbarSpacer} />
      )}
    </View>
  );
}

export function FoldDateTitle({
  dateLabel,
  weekdayLabel,
  subLabel,
  saveLabel,
}: {
  dateLabel: string;
  weekdayLabel: string;
  subLabel: string;
  saveLabel: string;
}) {
  const { palette } = useFoldTheme();
  return (
    <View style={styles.dateTitle}>
      <View style={styles.dateTitleLeft}>
        <View style={styles.dateTitleRow}>
          <Text style={[styles.dateBig, { color: palette.ink }]} maxFontSizeMultiplier={1.35}>
            {dateLabel}
          </Text>
          <Text style={[styles.dateWeekday, { color: palette.muted }]} maxFontSizeMultiplier={1.35}>
            {weekdayLabel}
          </Text>
        </View>
        <Text style={[styles.dateSub, { color: palette.muted }]} maxFontSizeMultiplier={1.35}>
          {subLabel}
        </Text>
      </View>
      <View style={styles.saveState}>
        <View style={[styles.saveDot, { backgroundColor: palette.sage }]} />
        <Text style={[styles.saveText, { color: palette.muted }]} maxFontSizeMultiplier={1.35}>
          {saveLabel}
        </Text>
      </View>
    </View>
  );
}

export function FoldBoundaryBanner({
  variant,
  onPress,
  title,
  body,
  actionLabel,
}: {
  variant: 'weekly' | 'locked';
  onPress?: () => void;
  title: string;
  body: string;
  actionLabel?: string;
}) {
  const { palette } = useFoldTheme();
  const locked = variant === 'locked';
  return (
    <View
      style={[
        styles.banner,
        {
          backgroundColor: locked ? palette.paperAlt : palette.amberSoft,
          borderColor: locked ? palette.line : palette.amber + '88',
        },
      ]}>
      <View style={[styles.bannerIcon, { backgroundColor: locked ? palette.paper : '#FFFFFF88' }]}>
        <MaterialIcons
          name={locked ? 'lock-outline' : 'event-available'}
          size={18}
          color={locked ? palette.muted : palette.amberInk}
        />
      </View>
      <View style={styles.bannerCopy}>
        <Text style={[styles.bannerTitle, { color: locked ? palette.inkSoft : palette.amberInk }]} maxFontSizeMultiplier={1.35}>
          {title}
        </Text>
        <Text style={[styles.bannerBody, { color: palette.muted }]} maxFontSizeMultiplier={1.35}>
          {body}
        </Text>
      </View>
      {actionLabel && onPress ? (
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
          style={({ pressed }) => [styles.bannerAction, pressed && { opacity: 0.7 }]}>
          <Text style={[styles.bannerActionText, { color: palette.amberInk }]} maxFontSizeMultiplier={1.35}>
            {actionLabel}
          </Text>
          <MaterialIcons name="chevron-right" size={16} color={palette.amberInk} />
        </Pressable>
      ) : null}
    </View>
  );
}

function StatBlock({
  label,
  value,
  unit,
  hint,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  hint: React.ReactNode;
  accent?: boolean;
}) {
  const { palette } = useFoldTheme();
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: palette.muted }]} maxFontSizeMultiplier={1.35}>
        {label}
      </Text>
      <View style={styles.statValueRow}>
        <Text
          style={[styles.statValue, { color: accent ? palette.pine : palette.ink }]}
          maxFontSizeMultiplier={1.2}>
          {value}
        </Text>
        <Text style={[styles.statUnit, { color: palette.muted }]} maxFontSizeMultiplier={1.35}>
          {unit}
        </Text>
      </View>
      {hint}
    </View>
  );
}

export function FoldProgressCard({
  filledDims,
  totalDims,
  weekFilled,
  weekTotal,
  streak,
}: {
  filledDims: number;
  totalDims: number;
  weekFilled: number;
  weekTotal: number;
  streak: number;
}) {
  const { palette } = useFoldTheme();
  const missing = Math.max(0, weekTotal - weekFilled);
  return (
    <FoldCard style={styles.progressCard}>
      <StatBlock
        label="今日已写"
        value={String(filledDims)}
        unit={` / ${totalDims} 维`}
        hint={
          <Text style={[styles.statHint, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
            写满任意一栏即完成
          </Text>
        }
      />
      <View style={[styles.statDivider, { backgroundColor: palette.line }]} />
      <StatBlock
        label="本周日刊"
        value={String(weekFilled)}
        unit={` / ${weekTotal}`}
        hint={
          <Text style={[styles.statHint, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
            {missing > 0 ? `还差 ${missing} 天` : '本周已写满'}
          </Text>
        }
      />
      <View style={[styles.statDivider, { backgroundColor: palette.line }]} />
      <StatBlock
        label="连续记录"
        value={String(streak)}
        unit=" 天"
        accent={streak > 0}
        hint={
          <View style={[styles.streakChip, { backgroundColor: palette.amberSoft }]}>
            <MaterialIcons name="local-fire-department" size={11} color={palette.amber} />
            <Text style={[styles.streakText, { color: palette.amberInk }]} maxFontSizeMultiplier={1.35}>
              {streak > 0 ? '保持中' : '从今天开始'}
            </Text>
          </View>
        }
      />
    </FoldCard>
  );
}

function PickerChip({
  active,
  label,
  onPress,
  children,
}: {
  active: boolean;
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const { palette } = useFoldTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.pickerChip,
        {
          borderColor: active ? palette.pine : palette.line,
          backgroundColor: active ? palette.sageSoft : palette.card,
        },
        pressed && { opacity: 0.8 },
      ]}>
      {children}
    </Pressable>
  );
}

export function FoldDayMetaStrip({
  meta,
  canEdit,
  onMetaChange,
  reminderEnabled,
  reminderTimeLabel,
  onOpenReminderSettings,
  onPrevDay,
  onNextDay,
  canGoNext,
}: {
  meta: ReviewJournalMeta;
  canEdit: boolean;
  onMetaChange: (patch: Partial<ReviewJournalMeta>) => void;
  reminderEnabled: boolean;
  reminderTimeLabel: string | null;
  onOpenReminderSettings: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  canGoNext: boolean;
}) {
  const { palette } = useFoldTheme();
  const [picker, setPicker] = useState<'weather' | 'mood' | null>(null);

  const weather = DAILY_REVIEW_WEATHER_OPTIONS.find(w => w.id === meta.weather);
  const mood = meta.mood || '🙂';

  const toggle = (kind: 'weather' | 'mood') => {
    if (!canEdit) return;
    setPicker(prev => (prev === kind ? null : kind));
  };

  return (
    <FoldCard style={styles.metaCard} padded={false}>
      <View style={styles.metaRow}>
        <Pressable
          onPress={() => toggle('weather')}
          disabled={!canEdit}
          accessibilityRole="button"
          accessibilityLabel={`天气：${weather?.label ?? '未设置'}`}
          style={({ pressed }) => [styles.metaItem, pressed && { opacity: 0.65 }]}>
          <MaterialIcons name={weather?.icon ?? 'wb-sunny'} size={16} color={palette.sage} />
          <Text style={[styles.metaText, { color: palette.inkSoft }]} maxFontSizeMultiplier={1.35}>
            {weather?.label ?? '天气'}
          </Text>
        </Pressable>
        <View style={[styles.metaDivider, { backgroundColor: palette.line }]} />
        <Pressable
          onPress={() => toggle('mood')}
          disabled={!canEdit}
          accessibilityRole="button"
          accessibilityLabel={`心情：${MOOD_LABEL[mood] ?? '平静'}`}
          style={({ pressed }) => [styles.metaItem, pressed && { opacity: 0.65 }]}>
          <Text style={styles.moodEmoji} maxFontSizeMultiplier={1.2}>
            {mood}
          </Text>
          <Text style={[styles.metaText, { color: palette.inkSoft }]} maxFontSizeMultiplier={1.35}>
            {MOOD_LABEL[mood] ?? '平静'}
          </Text>
        </Pressable>
        <View style={[styles.metaDivider, { backgroundColor: palette.line }]} />
        <Pressable
          onPress={onOpenReminderSettings}
          accessibilityRole="button"
          accessibilityLabel={reminderEnabled && reminderTimeLabel ? `每日 ${reminderTimeLabel} 提醒` : '设置复盘提醒'}
          style={({ pressed }) => [styles.metaItem, pressed && { opacity: 0.65 }]}>
          <MaterialIcons
            name={reminderEnabled ? 'notifications-active' : 'notifications-none'}
            size={16}
            color={palette.sage}
          />
          <Text style={[styles.metaText, { color: palette.inkSoft }]} maxFontSizeMultiplier={1.35}>
            {reminderEnabled && reminderTimeLabel ? reminderTimeLabel : '提醒'}
          </Text>
        </Pressable>

        <View style={styles.metaArrows}>
          <Pressable
            onPress={onPrevDay}
            accessibilityRole="button"
            accessibilityLabel="上一天"
            hitSlop={6}
            style={({ pressed }) => [
              styles.arrowBtn,
              { borderColor: palette.line },
              pressed && { opacity: 0.6 },
            ]}>
            <MaterialIcons name="chevron-left" size={16} color={palette.muted} />
          </Pressable>
          <Pressable
            onPress={onNextDay}
            disabled={!canGoNext}
            accessibilityRole="button"
            accessibilityLabel="下一天"
            accessibilityState={{ disabled: !canGoNext }}
            hitSlop={6}
            style={({ pressed }) => [
              styles.arrowBtn,
              { borderColor: palette.line, opacity: canGoNext ? 1 : 0.35 },
              pressed && { opacity: 0.6 },
            ]}>
            <MaterialIcons name="chevron-right" size={16} color={palette.muted} />
          </Pressable>
        </View>
      </View>

      {picker === 'weather' && canEdit ? (
        <View style={styles.pickerRow} accessibilityRole="radiogroup" accessibilityLabel="选择天气">
          {DAILY_REVIEW_WEATHER_OPTIONS.map(opt => (
            <PickerChip
              key={opt.id}
              active={meta.weather === opt.id}
              label={opt.label}
              onPress={() => {
                onMetaChange({ weather: opt.id });
                setPicker(null);
              }}>
              <MaterialIcons
                name={opt.icon}
                size={16}
                color={meta.weather === opt.id ? palette.pine : palette.muted}
              />
              <Text style={[styles.pickerText, { color: palette.muted }]} maxFontSizeMultiplier={1.35}>
                {opt.label}
              </Text>
            </PickerChip>
          ))}
        </View>
      ) : null}

      {picker === 'mood' && canEdit ? (
        <View style={styles.pickerRow} accessibilityRole="radiogroup" accessibilityLabel="选择心情">
          {DAILY_REVIEW_MOOD_OPTIONS.map(emoji => (
            <PickerChip
              key={emoji}
              active={meta.mood === emoji}
              label={MOOD_LABEL[emoji] ?? emoji}
              onPress={() => {
                onMetaChange({ mood: emoji });
                setPicker(null);
              }}>
              <Text style={styles.pickerEmoji} maxFontSizeMultiplier={1.2}>
                {emoji}
              </Text>
            </PickerChip>
          ))}
        </View>
      ) : null}
    </FoldCard>
  );
}

function FactTaskRow({ title }: { title: string }) {
  const { palette } = useFoldTheme();
  const match = /^\[([^\]]+)\]\s*(.*)$/.exec(title);
  const status = match?.[1] ?? '';
  const label = (match?.[2] ?? title).trim();
  const done = status === '已完成';
  return (
    <View style={styles.taskRow}>
      <View
        style={[
          styles.taskCheck,
          {
            borderColor: done ? palette.pine : palette.lineStrong,
            backgroundColor: done ? palette.pine : 'transparent',
          },
        ]}>
        {done ? <MaterialIcons name="check" size={10} color={palette.onPine} /> : null}
      </View>
      <Text
        style={[
          styles.taskText,
          { color: done ? palette.inkSoft : palette.muted },
          done && { textDecorationLine: 'line-through' },
        ]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.35}>
        {label}
      </Text>
      <Text style={[styles.taskKind, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
        {status || '任务'}
      </Text>
    </View>
  );
}

function moneyText(n: number): string {
  const rounded = Math.round(Math.abs(n) * 100) / 100;
  return `¥${Number.isInteger(rounded) ? Math.round(rounded) : rounded.toFixed(2)}`;
}

export function FoldTodayDataCard({
  facts,
  onViewAll,
  onInsertFacts,
}: {
  facts: ReviewDayFacts;
  onViewAll?: () => void;
  onInsertFacts?: () => void;
}) {
  const { palette } = useFoldTheme();
  const previewItems = useMemo(() => {
    const frogs = facts.frogs ?? [];
    const todos = facts.todos ?? [];
    const habitsDone = (facts.habits ?? []).filter(h => h.done);
    const rows: { id: string; title: string }[] = [];
    for (const f of frogs.slice(0, 3)) {
      rows.push({ id: `frog-${f.id}`, title: f.done ? f.title : `未完成 · ${f.title}` });
    }
    for (const t of todos.slice(0, 2)) {
      if (rows.length >= 4) break;
      rows.push({ id: `todo-${t.id}`, title: t.done ? `待办 · ${t.title}` : `待办未完 · ${t.title}` });
    }
    return { rows, habitsDone, frogs, todos };
  }, [facts]);

  const restCount = Math.max(
    0,
    previewItems.frogs.length + previewItems.todos.length - previewItems.rows.length,
  );
  const restHabits = Math.max(0, previewItems.habitsDone.length - 4);
  const habits = previewItems.habitsDone.slice(0, 4);

  const summaryLines = useMemo(() => {
    const lines: string[] = [];
    const h = facts.health;
    if (h.calories > 0 || h.hydration > 0 || h.protein > 0) {
      lines.push(`健康 · 热量 ${Math.round(h.calories)}kcal`);
    } else if (h.weightKg != null) {
      lines.push(`健康 · 体重 ${h.weightKg}kg`);
    }
    if (facts.finance.txns.length > 0 || facts.finance.income > 0 || facts.finance.expense > 0) {
      lines.push(`财务 · 收入 ${moneyText(facts.finance.income)} · 支出 ${moneyText(facts.finance.expense)}`);
    }
    return lines;
  }, [facts]);

  const frogPending = previewItems.frogs.filter(f => !f.done).length;
  const habitPending = (facts.habits ?? []).filter(h => !h.done).length;

  return (
    <FoldCard style={styles.todayCard}>
      <View style={styles.todayHead}>
        <View style={styles.todayHeadCopy}>
          <Text style={[styles.todayTitle, { color: palette.ink }]} maxFontSizeMultiplier={1.35}>
            今日数据 · 自动汇总
          </Text>
          <Text style={[styles.todayMeta, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
            任务 {previewItems.frogs.length}
            {frogPending > 0 ? `（未完 ${frogPending}）` : ''} · 待办 {previewItems.todos.length} · 习惯{' '}
            {(facts.habits ?? []).length}
            {habitPending > 0 ? `（未打 ${habitPending}）` : ''}
          </Text>
        </View>
        {onInsertFacts ? (
          <Pressable
            onPress={onInsertFacts}
            accessibilityRole="button"
            accessibilityLabel="一键写入今日健康、任务与财务"
            hitSlop={6}
            style={({ pressed }) => [
              styles.insertBtn,
              { borderColor: palette.pine, backgroundColor: palette.sageSoft, opacity: pressed ? 0.8 : 1 },
            ]}>
            <MaterialIcons name="bolt" size={12} color={palette.pine} />
            <Text style={[styles.insertText, { color: palette.pine }]} maxFontSizeMultiplier={1.3}>
              一键写入
            </Text>
          </Pressable>
        ) : null}
      </View>

      <View style={styles.todayColumns}>
        <View style={styles.todayTasks}>
          {previewItems.rows.length === 0 ? (
            <Text style={[styles.todayEmpty, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
              今天还没有任务或待办
            </Text>
          ) : (
            previewItems.rows.map(task => <FactTaskRow key={task.id} title={task.title} />)
          )}
        </View>
        <View style={styles.todayHabits}>
          {habits.length === 0 ? (
            <Text style={[styles.todayEmpty, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
              还没有打卡习惯
            </Text>
          ) : (
            <View style={styles.habitWrap}>
              {habits.map(habit => (
                <View
                  key={habit.id}
                  style={[styles.habitChip, { borderColor: palette.line, backgroundColor: palette.card }]}>
                  <View style={[styles.habitDot, { backgroundColor: palette.sage }]} />
                  <Text
                    style={[styles.habitText, { color: palette.inkSoft }]}
                    numberOfLines={1}
                    maxFontSizeMultiplier={1.35}>
                    {habit.title}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      {summaryLines.length > 0 ? (
        <View style={[styles.todayFacts, { borderTopColor: palette.line }]}>
          {summaryLines.map(line => (
            <Text key={line} style={[styles.todayFactLine, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      {restCount + restHabits > 0 ? (
        <Pressable
          onPress={onViewAll}
          accessibilityRole="button"
          accessibilityLabel="查看全部今日数据"
          style={({ pressed }) => [styles.todayMore, pressed && { opacity: 0.7 }]}>
          <Text style={[styles.todayMoreText, { color: palette.faint }]} maxFontSizeMultiplier={1.35}>
            另有 {restCount} 项 · {restHabits} 习惯未展示
          </Text>
          <Text style={[styles.todayMoreText, { color: palette.sage }]} maxFontSizeMultiplier={1.35}>
            查看全部 ›
          </Text>
        </Pressable>
      ) : null}
    </FoldCard>
  );
}

const DIM_GLYPH: Array<{ match: string; glyph: string; tint: keyof FoldSemanticPalette }> = [
  { match: '健康', glyph: '🌿', tint: 'sageSoft' },
  { match: '任务', glyph: '◎', tint: 'paperAlt' },
  { match: '财务', glyph: '¥', tint: 'amberSoft' },
  { match: '日常', glyph: '☼', tint: 'paperAlt' },
  { match: '缺陷', glyph: '◐', tint: 'claySoft' },
  { match: '新想法', glyph: '✦', tint: 'paperAlt' },
];

function dimensionGlyph(title: string): { glyph: string; tint: keyof FoldSemanticPalette } {
  const hit = DIM_GLYPH.find(item => title.includes(item.match));
  return hit ? { glyph: hit.glyph, tint: hit.tint } : { glyph: '✎', tint: 'paperAlt' };
}

export function FoldDimensionGrid({
  dimensions,
  fields,
  canEdit,
  onOpenDimension,
}: {
  dimensions: ReviewDimensionTemplate[];
  fields: Record<string, string>;
  canEdit: boolean;
  onOpenDimension: (dimensionId: string) => void;
}) {
  const { palette } = useFoldTheme();

  const rows = useMemo(
    () =>
      dimensions.map(dim => {
        const previews: string[] = [];
        let hasAny = false;
        for (const col of dim.columns) {
          const plain = reviewContentToPlainDisplay(fields[col.id] ?? '').trim();
          if (!plain) continue;
          hasAny = true;
          previews.push(plain.replace(/\s*\n\s*/g, ' '));
        }
        const placeholder = dim.columns[0]?.placeholder || '写两句今天的观察…';
        return { dim, hasAny, preview: previews.join(' · ') || placeholder };
      }),
    [dimensions, fields],
  );

  const paired: Array<Array<(typeof rows)[number]>> = [];
  for (let i = 0; i < rows.length; i += 2) paired.push(rows.slice(i, i + 2));

  return (
    <View style={styles.dimGrid}>
      {paired.map((pair, index) => (
        <View key={`row-${index}`} style={styles.dimRow}>
          {pair.map(item => {
            const { glyph, tint } = dimensionGlyph(item.dim.title);
            return (
              <Pressable
                key={item.dim.id}
                onPress={() => onOpenDimension(item.dim.id)}
                accessibilityRole="button"
                accessibilityLabel={`${item.dim.title}，${item.hasAny ? '已填' : '待填'}，点击${canEdit ? '进入编辑' : '查看'}`}
                style={({ pressed }) => [styles.dimPress, pressed && { opacity: 0.9 }]}>
                <FoldCard style={styles.dimCard}>
                  <View style={styles.dimHead}>
                    <View style={styles.dimNameRow}>
                      <View style={[styles.dimGlyph, { backgroundColor: palette[tint] as string }]}>
                        <Text style={[styles.dimGlyphText, { color: palette.inkSoft }]} maxFontSizeMultiplier={1.2}>
                          {glyph}
                        </Text>
                      </View>
                      <Text
                        style={[styles.dimTitle, { color: palette.ink }]}
                        numberOfLines={1}
                        maxFontSizeMultiplier={1.35}>
                        {item.dim.title}
                      </Text>
                    </View>
                    <FoldTag tone={item.hasAny ? 'green' : 'gray'}>
                      {item.hasAny ? '已填' : '待填'}
                    </FoldTag>
                  </View>
                  <Text
                    style={[
                      styles.dimPreview,
                      { color: item.hasAny ? palette.muted : palette.faint },
                    ]}
                    numberOfLines={2}
                    maxFontSizeMultiplier={1.35}>
                    {item.preview}
                  </Text>
                  <View style={styles.dimCorner}>
                    <MaterialIcons name="chevron-right" size={14} color={palette.faint} />
                  </View>
                </FoldCard>
              </Pressable>
            );
          })}
          {pair.length === 1 ? <View style={styles.dimPress} /> : null}
        </View>
      ))}
    </View>
  );
}

/** 日复盘 AI 入口：靠前展示，主按钮直达分析全屏（screen 11） */
export function FoldAiMini({
  text,
  busy,
  insightCount,
  onOpen,
  ready = true,
  readyHint,
}: {
  text: string | null | undefined;
  busy?: boolean;
  /** 摘要旁展示的洞察条数，缺省按正文粗估 */
  insightCount?: number;
  onOpen: () => void;
  /** false 时仍可点，但文案提示需先写完格子 */
  ready?: boolean;
  readyHint?: string;
}) {
  const { palette } = useFoldTheme();
  const body = (text ?? '').trim();
  const hasBody = body.length > 0;
  const summary = busy
    ? '正在阅读今天的记录…'
    : hasBody
      ? body.split(/\n|。|\. /).map(s => s.trim()).filter(Boolean)[0] ?? ''
      : ready
        ? '写完各维度后，点下方按钮生成「问题 / 建议」分析。'
        : readyHint || '先写完今日全部复盘格子，再生成 AI 分析。';
  const count =
    insightCount ??
    (body
      ? Math.max(1, body.split(/\n+/).map(s => s.trim()).filter(s => s.startsWith('·') || s.length > 8).length)
      : 0);
  const sub =
    hasBody && !busy
      ? `${summary.slice(0, 36)}${summary.length > 36 ? '…' : ''} · ${count} 条洞察`
      : summary;
  const ctaLabel = busy ? '分析中…' : hasBody ? '查看 / 重新分析' : '生成 AI 分析';

  return (
    <Pressable
      onPress={onOpen}
      disabled={busy}
      accessibilityRole="button"
      accessibilityLabel={ctaLabel}
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
      style={({ pressed }) => [{ opacity: busy ? 0.85 : pressed ? 0.94 : 1 }]}>
      <FoldCard tone="pine" style={styles.aiCard}>
        <View style={styles.aiHead}>
          <View style={[styles.aiOrb, { backgroundColor: palette.aiOrb }]}>
            <MaterialIcons name="auto-awesome" size={18} color={palette.pineSolid} />
          </View>
          <View style={styles.aiCopy}>
            <Text style={[styles.aiTitle, { color: palette.aiInk }]} maxFontSizeMultiplier={1.35}>
              AI 复盘分析
            </Text>
            <Text
              style={[styles.aiSummary, { color: palette.aiSoft }]}
              numberOfLines={2}
              maxFontSizeMultiplier={1.35}>
              {sub}
            </Text>
          </View>
        </View>
        <View
          style={[
            styles.aiCta,
            {
              backgroundColor: ready || hasBody ? palette.onPine : 'rgba(255,255,255,0.22)',
              opacity: busy ? 0.7 : 1,
            },
          ]}>
          <MaterialIcons
            name="auto-awesome"
            size={15}
            color={ready || hasBody ? palette.pineSolid : palette.aiSoft}
          />
          <Text
            style={[
              styles.aiCtaText,
              { color: ready || hasBody ? palette.pineSolid : palette.aiSoft },
            ]}
            maxFontSizeMultiplier={1.3}>
            {ctaLabel}
          </Text>
        </View>
      </FoldCard>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 6,
    gap: 8,
  },
  appbarCenter: {
    flex: 1,
    alignItems: 'center',
  },
  appbarTitle: {
    ...Typography.title,
    fontSize: 16,
  },
  appbarSub: {
    fontSize: 10,
    marginTop: 2,
    letterSpacing: 0.3,
  },
  appbarSpacer: { width: 36, height: 36 },
  dateTitle: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 2,
    marginTop: 6,
    marginBottom: 10,
  },
  dateTitleLeft: { flex: 1, minWidth: 0 },
  dateTitleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  dateBig: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.6,
    fontFamily: foldFonts.serif,
  },
  dateWeekday: {
    fontSize: 14,
    fontWeight: '600',
  },
  dateSub: {
    fontSize: 11,
    marginTop: 3,
  },
  saveState: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingBottom: 2,
  },
  saveDot: { width: 5, height: 5, borderRadius: 3 },
  saveText: { fontSize: 10 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  bannerIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bannerCopy: { flex: 1, minWidth: 0 },
  bannerTitle: { fontSize: 13, fontWeight: '700' },
  bannerBody: { fontSize: 11, marginTop: 2 },
  bannerAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
    paddingVertical: 4,
  },
  bannerActionText: { fontSize: 11, fontWeight: '700' },
  progressCard: {
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingVertical: 12,
  },
  stat: { flex: 1, gap: 3, paddingHorizontal: 2 },
  statLabel: { fontSize: 10, letterSpacing: 0.4 },
  statValueRow: { flexDirection: 'row', alignItems: 'baseline' },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.8,
    fontFamily: foldFonts.mono,
  },
  statUnit: { fontSize: 11, marginLeft: 1 },
  statHint: { fontSize: 10, marginTop: 1 },
  statDivider: { width: StyleSheet.hairlineWidth, marginVertical: 4 },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginTop: 2,
  },
  streakText: { fontSize: 10, fontWeight: '700' },
  metaCard: { marginTop: 10, paddingVertical: 0 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: { fontSize: 12, fontWeight: '600' },
  metaDivider: { width: StyleSheet.hairlineWidth, height: 14 },
  moodEmoji: { fontSize: 14 },
  metaArrows: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 'auto',
  },
  arrowBtn: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  pickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  pickerText: { fontSize: 11 },
  pickerEmoji: { fontSize: 14 },
  todayCard: { marginTop: 10, gap: 8 },
  todayHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  todayHeadCopy: { flex: 1, minWidth: 0, gap: 2 },
  insertBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  insertText: { fontSize: 10.5, fontWeight: '700' },
  todayTitle: { fontSize: 13, fontWeight: '700' },
  todayMeta: { fontSize: 10 },
  todayFacts: {
    gap: 2,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  todayFactLine: { fontSize: 10.5, lineHeight: 15 },
  todayColumns: { flexDirection: 'row', gap: 10 },
  todayTasks: { flex: 1.06, gap: 6 },
  todayHabits: { flex: 0.94, gap: 6 },
  todayEmpty: { fontSize: 11, lineHeight: 16 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskCheck: {
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskText: { flex: 1, fontSize: 12, lineHeight: 16 },
  taskKind: { fontSize: 9 },
  habitWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 5 },
  habitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: '100%',
  },
  habitDot: { width: 4, height: 4, borderRadius: 2 },
  habitText: { fontSize: 10 },
  todayMore: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingTop: 2,
  },
  todayMoreText: { fontSize: 10 },
  dimGrid: { gap: 8, marginTop: 8 },
  dimRow: { flexDirection: 'row', gap: 8 },
  dimPress: { flex: 1 },
  dimCard: {
    flex: 1,
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 10,
    minHeight: 96,
  },
  dimHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 4,
  },
  dimNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  dimGlyph: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimGlyphText: { fontSize: 12, fontWeight: '700' },
  dimTitle: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  dimPreview: { fontSize: 11, lineHeight: 16, paddingRight: 8 },
  dimCorner: { position: 'absolute', right: 8, bottom: 8 },
  aiCard: { marginTop: 16, marginBottom: 4, gap: 12, paddingVertical: 14 },
  aiHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  aiOrb: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiCopy: { flex: 1, minWidth: 0 },
  aiTitle: { fontSize: 15, fontWeight: '800', letterSpacing: 0.2 },
  aiSummary: { fontSize: 12, marginTop: 4, lineHeight: 18 },
  aiCta: {
    minHeight: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
  },
  aiCtaText: { fontSize: 14, fontWeight: '800' },
});
