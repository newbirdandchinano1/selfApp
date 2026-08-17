import type { WeeklyReviewMetrics } from '@/lib/repositories/insights/weekly-review';
import {
  getFilledFieldsFromTemplate,
  type ReviewFieldValues,
} from '@/lib/repositories/insights/review-journal-body';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import { useAppTheme } from '@/hooks/use-app-theme';
import { Radius, Shadows } from '@/constants/design-tokens';
import { MaterialIcons } from '@expo/vector-icons';
import React, { type ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatMetricInt, formatMetricMoney } from './review-utils';

export function SectionTitle({ n, title, color }: { n: string; title: string; color: string }) {
  return (
    <Text style={[styles.sectionTitle, { color }]}>
      {n}、{title}
    </Text>
  );
}

export function Field({
  value,
  onChangeText,
  editable = true,
  placeholder,
  inputSurface,
  inputBorder,
  textColor,
  hintColor,
  minHeight = 120,
}: {
  value: string;
  onChangeText: (t: string) => void;
  editable?: boolean;
  placeholder: string;
  inputSurface: string;
  inputBorder: string;
  textColor: string;
  hintColor: string;
  minHeight?: number;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      editable={editable}
      placeholder={placeholder}
      placeholderTextColor={hintColor}
      multiline
      textAlignVertical="top"
      style={[
        styles.input,
        {
          minHeight,
          backgroundColor: inputSurface,
          borderColor: inputBorder,
          color: textColor,
          opacity: editable ? 1 : 0.72,
        },
      ]}
    />
  );
}

export function CheckRow({
  checked,
  onToggle,
  label,
  textColor,
  outline,
  primary,
  disabled,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  textColor: string;
  outline: string;
  primary: string;
  disabled?: boolean;
}) {
  return (
    <Pressable onPress={onToggle} disabled={disabled} style={[styles.checkRow, disabled ? { opacity: 0.45 } : null]}>
      <MaterialIcons name={checked ? 'check-box' : 'check-box-outline-blank'} size={24} color={checked ? primary : outline} />
      <Text style={[styles.checkLabel, { color: textColor }]}>{label}</Text>
    </Pressable>
  );
}

export function LinkChip({ label, onPress, color }: { label: string; onPress: () => void; color: string }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}>
      <Text style={{ color, fontWeight: '800', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

function MetricTile({
  label,
  value,
  unit,
  icon,
  iconColor,
  iconBg,
  tileBg,
  borderColor,
  textColor,
  mutedColor,
}: {
  label: string;
  value: string;
  unit: string;
  icon: 'task-alt' | 'post-add' | 'local-fire-department' | 'savings' | 'trending-up' | 'trending-down';
  iconColor: string;
  iconBg: string;
  tileBg: string;
  borderColor: string;
  textColor: string;
  mutedColor: string;
}) {
  return (
    <View style={[styles.metricTile, { backgroundColor: tileBg, borderColor }]}>
      <View style={[styles.metricTileIcon, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon} size={20} color={iconColor} />
      </View>
      <Text style={[styles.metricTileLabel, { color: mutedColor }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.metricTileValue, { color: textColor }]} numberOfLines={1}>
        {value}
        {unit ? <Text style={[styles.metricTileUnit, { color: mutedColor }]}> {unit}</Text> : null}
      </Text>
    </View>
  );
}

export function WeeklyMetricsReferenceCard({
  open,
  onToggle,
  metrics,
  isDark,
  surface,
  text,
  outline,
  outlineVariant,
  primary,
  secondary,
  tertiary,
}: {
  open: boolean;
  onToggle: () => void;
  metrics: WeeklyReviewMetrics | null;
  isDark: boolean;
  surface: string;
  text: string;
  outline: string;
  outlineVariant: string;
  primary: string;
  secondary: string;
  tertiary: string;
}) {
  const { colors } = useAppTheme();
  const cardBg = isDark ? colors.surface : surface;
  const tileBg = isDark ? colors.input : colors.primaryMuted;
  const iconWrap = (bg: string) => ({
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: bg,
  });

  const preview =
    metrics == null
      ? '点开展开 · 加载失败时可稍后再试'
      : `${formatMetricInt(metrics.tasksCompleted)} 项完成 · ${formatMetricInt(metrics.habitCheckInTotal)} 次打卡 · 存钱 ${formatMetricMoney(metrics.savingsWeekTotal)}`;

  return (
    <View
      style={[
        styles.metricsCard,
        Shadows.card,
        {
          backgroundColor: cardBg,
          borderColor: outlineVariant,
          shadowColor: isDark ? '#000' : primary,
        },
      ]}>
      <View style={[styles.metricsCardAccent, { backgroundColor: primary }]} />
      <View style={styles.metricsCardInner}>
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [styles.metricsCardHead, { opacity: pressed ? 0.88 : 1 }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? '收起本周数据参考' : '展开本周数据参考'}>
          <View style={iconWrap(isDark ? `${primary}22` : `${primary}14`)}>
            <MaterialIcons name="insights" size={22} color={primary} />
          </View>
          <View style={styles.metricsCardHeadText}>
            <Text style={[styles.metricsCardTitle, { color: text }]}>本周数据参考</Text>
            <Text style={[styles.metricsCardSubtitle, { color: outline }]} numberOfLines={open ? 2 : 1}>
              {open ? '以下为应用内自动汇总，可与上方文字复盘对照，不必逐条一致。' : preview}
            </Text>
          </View>
          <View style={[styles.metricsChevronWrap, { backgroundColor: colors.primaryMuted }]}>
            <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={26} color={primary} />
          </View>
        </Pressable>

        {open ? (
          <View style={[styles.metricsExpanded, { borderTopColor: outlineVariant }]}>
            {!metrics ? (
              <View style={[styles.metricsEmpty, { borderColor: outlineVariant }]}>
                <MaterialIcons name="cloud-off" size={32} color={outline} />
                <Text style={[styles.metricsEmptyText, { color: outline }]}>本周统计数据暂不可用</Text>
              </View>
            ) : (
              <>
                <View style={styles.metricsGrid}>
                  <View style={styles.metricsGridRow}>
                    <MetricTile
                      label="任务完成"
                      value={formatMetricInt(metrics.tasksCompleted)}
                      unit="项"
                      icon="task-alt"
                      iconColor={primary}
                      iconBg={isDark ? `${primary}28` : `${primary}18`}
                      tileBg={tileBg}
                      borderColor={outlineVariant}
                      textColor={text}
                      mutedColor={outline}
                    />
                    <MetricTile
                      label="新建任务"
                      value={formatMetricInt(metrics.tasksCreated)}
                      unit="项"
                      icon="post-add"
                      iconColor={secondary}
                      iconBg={isDark ? `${secondary}28` : `${secondary}18`}
                      tileBg={tileBg}
                      borderColor={outlineVariant}
                      textColor={text}
                      mutedColor={outline}
                    />
                  </View>
                  <View style={styles.metricsGridRow}>
                    <MetricTile
                      label="习惯打卡"
                      value={formatMetricInt(metrics.habitCheckInTotal)}
                      unit="次"
                      icon="local-fire-department"
                      iconColor={colors.dangerSoft}
                      iconBg={isDark ? `${colors.danger}22` : `${colors.danger}10`}
                      tileBg={tileBg}
                      borderColor={outlineVariant}
                      textColor={text}
                      mutedColor={outline}
                    />
                    <MetricTile
                      label="存钱入账"
                      value={formatMetricMoney(metrics.savingsWeekTotal)}
                      unit=""
                      icon="savings"
                      iconColor={tertiary}
                      iconBg={isDark ? `${tertiary}30` : `${tertiary}20`}
                      tileBg={tileBg}
                      borderColor={outlineVariant}
                      textColor={text}
                      mutedColor={outline}
                    />
                  </View>
                  <View style={styles.metricsGridRow}>
                    <MetricTile
                      label="记账收入"
                      value={formatMetricMoney(metrics.financeIncome)}
                      unit=""
                      icon="trending-up"
                      iconColor={secondary}
                      iconBg={isDark ? `${secondary}28` : `${secondary}18`}
                      tileBg={tileBg}
                      borderColor={outlineVariant}
                      textColor={text}
                      mutedColor={outline}
                    />
                    <MetricTile
                      label="记账支出"
                      value={formatMetricMoney(metrics.financeExpense)}
                      unit=""
                      icon="trending-down"
                      iconColor={colors.danger}
                      iconBg={isDark ? `${colors.danger}22` : `${colors.danger}10`}
                      tileBg={tileBg}
                      borderColor={outlineVariant}
                      textColor={text}
                      mutedColor={outline}
                    />
                  </View>
                </View>
                <View style={[styles.metricsFullTile, { backgroundColor: tileBg, borderColor: outlineVariant }]}>
                  <View style={[styles.metricsFullIcon, { backgroundColor: isDark ? `${primary}28` : `${primary}16` }]}>
                    <MaterialIcons name="favorite-border" size={20} color={primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.metricsFullLabel, { color: outline }]}>心愿单更新</Text>
                    <Text style={[styles.metricsFullValue, { color: text }]}>
                      {formatMetricInt(metrics.wishUpdates)}
                      <Text style={[styles.metricsFullUnit, { color: outline }]}> 条</Text>
                    </Text>
                  </View>
                </View>
                <Text style={[styles.metricsFootnote, { color: outline }]}>
                  {metrics.rangeKind === 'rolling-7'
                    ? '周期：复盘日当天起向前连续 7 个自然日（含当天），按本地日期汇总。收入/支出仅含对应类型的记账流水。'
                    : '周期：本周一至周日（本地日期）。收入/支出仅含对应类型的记账流水。'}
                </Text>
              </>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function WeeklyReviewQuickRefBar({
  filledCount,
  editableCount,
  hasDigest,
  dailyOpen,
  metricsOpen,
  isDark,
  outline,
  outlineVariant,
  primary,
  secondary,
  onToggleDaily,
  onToggleMetrics,
  onCopyDigest,
  onInsertDigest,
  onTemplateSettings,
}: {
  filledCount: number;
  editableCount: number;
  hasDigest: boolean;
  dailyOpen: boolean;
  metricsOpen: boolean;
  isDark: boolean;
  outline: string;
  outlineVariant: string;
  primary: string;
  secondary: string;
  onToggleDaily: () => void;
  onToggleMetrics: () => void;
  onCopyDigest: () => void;
  onInsertDigest: () => void;
  onTemplateSettings: () => void;
}) {
  const { colors } = useAppTheme();
  const chip = (active: boolean, color: string) => ({
    borderColor: active ? color : outlineVariant,
    backgroundColor: active ? (isDark ? `${color}22` : `${color}10`) : isDark ? colors.input : colors.surface,
  });

  return (
    <View style={[styles.quickRefBar, { borderColor: outlineVariant }]}>
      <Pressable
        onPress={onToggleDaily}
        style={({ pressed }) => [
          styles.quickRefChip,
          chip(dailyOpen, secondary),
          { opacity: pressed ? 0.88 : 1 },
        ]}>
        <MaterialIcons name="menu-book" size={15} color={secondary} />
        <Text style={[styles.quickRefChipText, { color: secondary }]}>
          日复盘 {filledCount}/{editableCount || 7}
        </Text>
      </Pressable>
      <Pressable
        onPress={onToggleMetrics}
        style={({ pressed }) => [
          styles.quickRefChip,
          chip(metricsOpen, primary),
          { opacity: pressed ? 0.88 : 1 },
        ]}>
        <MaterialIcons name="insights" size={15} color={primary} />
        <Text style={[styles.quickRefChipText, { color: primary }]}>数据</Text>
      </Pressable>
      {hasDigest ? (
        <>
          <Pressable
            onPress={onCopyDigest}
            style={({ pressed }) => [
              styles.quickRefChip,
              chip(false, primary),
              { opacity: pressed ? 0.88 : 1 },
            ]}>
            <MaterialIcons name="content-copy" size={15} color={outline} />
            <Text style={[styles.quickRefChipText, { color: outline }]}>复制</Text>
          </Pressable>
          <Pressable
            onPress={onInsertDigest}
            style={({ pressed }) => [
              styles.quickRefChip,
              chip(false, secondary),
              { opacity: pressed ? 0.88 : 1 },
            ]}>
            <MaterialIcons name="playlist-add" size={15} color={outline} />
            <Text style={[styles.quickRefChipText, { color: outline }]}>插入</Text>
          </Pressable>
        </>
      ) : null}
      <Pressable
        onPress={onTemplateSettings}
        hitSlop={6}
        style={({ pressed }) => [
          styles.quickRefIconBtn,
          { borderColor: outlineVariant, opacity: pressed ? 0.88 : 1 },
        ]}
        accessibilityLabel="管理周复盘模板">
        <MaterialIcons name="tune" size={18} color={outline} />
      </Pressable>
    </View>
  );
}

export function WeeklyDailyReviewsReferenceCard({
  open,
  onToggle,
  entries,
  dailyTemplate,
  todayYmd,
  yesterdayYmd,
  filledCount,
  editableCount,
  isSkipped,
  digestPreview,
  hasDigest,
  isDark,
  surface,
  text,
  outline,
  outlineVariant,
  primary,
  secondary,
  onDayPress,
  onListPress,
  onCopyDigest,
  onInsertDigest,
  showEntryCards = true,
}: {
  open: boolean;
  onToggle: () => void;
  entries: { ymd: string; label: string; fields: ReviewFieldValues }[];
  dailyTemplate: ReviewDimensionTemplate[];
  todayYmd: string;
  yesterdayYmd: string;
  filledCount: number;
  editableCount: number;
  isSkipped: (ymd: string) => boolean;
  digestPreview: string;
  hasDigest: boolean;
  isDark: boolean;
  surface: string;
  text: string;
  outline: string;
  outlineVariant: string;
  primary: string;
  secondary: string;
  onDayPress: (ymd: string) => void;
  onListPress: () => void;
  onCopyDigest: () => void;
  onInsertDigest: () => void;
  /** false 时仅展示周期条与摘要，不渲染逐日大卡（周复盘页用） */
  showEntryCards?: boolean;
}) {
  const { colors } = useAppTheme();
  const cardBg = isDark ? colors.surface : surface;
  const preview =
    filledCount === 0
      ? '点开展开 · 本周期尚无已填写的日复盘'
      : `${filledCount}/${editableCount || entries.length} 天已填写 · 点开展开逐日查看`;

  return (
    <View
      style={[
        styles.metricsCard,
        Shadows.card,
        {
          backgroundColor: cardBg,
          borderColor: outlineVariant,
          shadowColor: isDark ? '#000' : secondary,
        },
      ]}>
      <View style={[styles.metricsCardAccent, { backgroundColor: secondary }]} />
      <View style={styles.metricsCardInner}>
        <Pressable
          onPress={onToggle}
          style={({ pressed }) => [styles.metricsCardHead, { opacity: pressed ? 0.88 : 1 }]}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={open ? '收起本周期日复盘' : '展开本周期日复盘'}>
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: Radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: isDark ? `${secondary}28` : `${secondary}14`,
            }}>
            <MaterialIcons name="menu-book" size={22} color={secondary} />
          </View>
          <View style={styles.metricsCardHeadText}>
            <Text style={[styles.metricsCardTitle, { color: text }]}>本周期日复盘</Text>
            <Text style={[styles.metricsCardSubtitle, { color: outline }]} numberOfLines={open ? 2 : 1}>
              {open ? '对照下方每日记录撰写周复盘；可一键复制或插入摘要。' : preview}
            </Text>
          </View>
          <View style={[styles.metricsChevronWrap, { backgroundColor: colors.primaryMuted }]}>
            <MaterialIcons name={open ? 'expand-less' : 'expand-more'} size={26} color={secondary} />
          </View>
        </Pressable>

        {open ? (
          <View style={[styles.metricsExpanded, { borderTopColor: outlineVariant }]}>
            <ReviewWeekStrip
              entries={entries}
              todayYmd={todayYmd}
              yesterdayYmd={yesterdayYmd}
              filledCount={filledCount}
              editableCount={editableCount}
              isDark={isDark}
              isSkipped={isSkipped}
              colors={{
                primary,
                success: secondary,
                text,
                textMuted: outline,
                outline: outlineVariant,
                surface,
              }}
              onDayPress={onDayPress}
              onListPress={onListPress}
            />

            {showEntryCards
              ? entries.map(entry => {
                  const skipped = isSkipped(entry.ymd);
                  if (skipped) return null;
                  const hasContent = Object.values(entry.fields).some(v => (v ?? '').trim().length > 0);
                  const isToday = entry.ymd === todayYmd;
                  const isYesterday = entry.ymd === yesterdayYmd;
                  return (
                    <DailyReviewContentCard
                      key={entry.ymd}
                      dateLabel={entry.label}
                      tagLabel={isToday ? '今天' : isYesterday ? '昨天' : undefined}
                      fields={entry.fields}
                      template={dailyTemplate}
                      hasContent={hasContent}
                      emptyHint="这一天还没有写下复盘，点这里补记"
                      accentColor={isToday ? secondary : isYesterday ? primary : outline}
                      isDark={isDark}
                      surface={surface}
                      textColor={text}
                      mutedColor={outline}
                      borderColor={outlineVariant}
                      onPress={() => onDayPress(entry.ymd)}
                    />
                  );
                })
              : (
                <Pressable onPress={onListPress} style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}>
                  <Text style={[styles.dailyStripHint, { color: primary }]}>
                    点周期条上的日期可补记/查看；查看全部日复盘 →
                  </Text>
                </Pressable>
              )}

            {hasDigest ? (
              <View style={[styles.dailyDigestBox, { backgroundColor: isDark ? colors.input : colors.primaryMuted, borderColor: outlineVariant }]}>
                <Text style={[styles.dailyDigestTitle, { color: text }]}>本周期摘要预览</Text>
                <Text style={[styles.dailyDigestBody, { color: outline }]} numberOfLines={6}>
                  {digestPreview}
                </Text>
                <View style={styles.dailyDigestActions}>
                  <Pressable
                    onPress={onCopyDigest}
                    style={({ pressed }) => [
                      styles.dailyDigestBtn,
                      { borderColor: outlineVariant, opacity: pressed ? 0.88 : 1 },
                    ]}>
                    <MaterialIcons name="content-copy" size={16} color={primary} />
                    <Text style={[styles.dailyDigestBtnText, { color: primary }]}>复制摘要</Text>
                  </Pressable>
                  <Pressable
                    onPress={onInsertDigest}
                    style={({ pressed }) => [
                      styles.dailyDigestBtn,
                      { borderColor: outlineVariant, backgroundColor: isDark ? `${secondary}22` : `${secondary}12`, opacity: pressed ? 0.88 : 1 },
                    ]}>
                    <MaterialIcons name="playlist-add" size={16} color={secondary} />
                    <Text style={[styles.dailyDigestBtnText, { color: secondary }]}>插入首个空白栏</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              <View style={[styles.metricsEmpty, { borderColor: outlineVariant }]}>
                <MaterialIcons name="edit-note" size={32} color={outline} />
                <Text style={[styles.metricsEmptyText, { color: outline }]}>
                  本周期还没有已填写的日复盘，可点上方日期补记后再回来写周复盘
                </Text>
              </View>
            )}
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function DailyReviewContentCard({
  dateLabel,
  tagLabel,
  fields,
  template,
  hasContent,
  emptyHint,
  accentColor,
  isDark,
  surface,
  textColor,
  mutedColor,
  borderColor,
  onPress,
  readOnly = false,
}: {
  dateLabel: string;
  tagLabel?: string;
  fields: ReviewFieldValues;
  template: ReviewDimensionTemplate[];
  hasContent: boolean;
  emptyHint: string;
  accentColor: string;
  isDark: boolean;
  surface: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  onPress?: () => void;
  readOnly?: boolean;
}) {
  const filled = getFilledFieldsFromTemplate(fields, template);
  let lastDim = '';
  const interactive = !readOnly && onPress != null;
  const headerIcon = readOnly ? 'lock-outline' : hasContent ? 'open-in-full' : 'edit-note';
  const emptyIcon = readOnly ? 'lock-outline' : 'notes';

  const card = (
    <View
      style={[
        styles.reviewContentCard,
        {
          backgroundColor: surface,
          borderColor,
          shadowColor: isDark ? '#000' : accentColor,
          opacity: readOnly && !hasContent ? 0.88 : 1,
        },
      ]}>
      <View style={[styles.reviewContentAccent, { backgroundColor: accentColor }]} />
      <View style={styles.reviewContentInner}>
        <View style={styles.reviewContentHead}>
          <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
            {tagLabel ? (
              <Text style={[styles.reviewContentTag, { color: accentColor }]}>{tagLabel}</Text>
            ) : null}
            <Text style={[styles.reviewContentDate, { color: textColor }]}>{dateLabel}</Text>
          </View>
          <View style={[styles.reviewContentEdit, { backgroundColor: isDark ? `${accentColor}22` : `${accentColor}12` }]}>
            <MaterialIcons name={headerIcon} size={18} color={accentColor} />
          </View>
        </View>

        {hasContent ? (
          <View style={styles.reviewContentBody}>
            {filled.map(item => {
              const showDim = item.dimensionTitle !== lastDim;
              lastDim = item.dimensionTitle;
              return (
                <View key={item.columnId} style={styles.reviewFieldBlock}>
                  {showDim ? (
                    <Text style={[styles.reviewDimTitle, { color: mutedColor }]}>{item.dimensionTitle}</Text>
                  ) : null}
                  <Text style={[styles.reviewFieldLabel, { color: accentColor }]}>{item.columnTitle}</Text>
                  <Text style={[styles.reviewFieldValue, { color: textColor }]}>{item.value}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={[styles.reviewEmpty, { borderColor }]}>
            <MaterialIcons name={emptyIcon} size={28} color={mutedColor} />
            <Text style={[styles.reviewEmptyText, { color: mutedColor }]}>{emptyHint}</Text>
          </View>
        )}
      </View>
    </View>
  );

  if (!interactive) {
    return card;
  }

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.94 : 1 }]}
      accessibilityRole="button"
      accessibilityLabel={`${dateLabel}复盘，${hasContent ? '查看详情' : emptyHint}`}>
      {card}
    </Pressable>
  );
}

export function ReviewHistoryFoldBar({
  dayCount,
  filledCount,
  expanded,
  mutedColor,
  textColor,
  primaryColor,
  borderColor,
  surface,
  onPress,
}: {
  dayCount: number;
  filledCount: number;
  expanded: boolean;
  mutedColor: string;
  textColor: string;
  primaryColor: string;
  borderColor: string;
  surface: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [{ opacity: pressed ? 0.9 : 1 }]}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={expanded ? '收起更早的复盘' : `展开更早的复盘，共 ${dayCount} 天`}>
      <View style={[styles.historyFoldBar, { backgroundColor: surface, borderColor }]}>
        <View style={[styles.historyFoldIcon, { backgroundColor: `${primaryColor}14` }]}>
          <MaterialIcons name="history" size={18} color={primaryColor} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={[styles.historyFoldTitle, { color: textColor }]}>
            {expanded ? '更早的复盘' : `更早的复盘 · ${dayCount} 天`}
          </Text>
          <Text style={[styles.historyFoldSub, { color: mutedColor }]}>
            {expanded ? '点击收起' : `已填 ${filledCount} 天 · 点击或使用右上角按钮展开`}
          </Text>
        </View>
        <MaterialIcons name={expanded ? 'expand-less' : 'expand-more'} size={24} color={mutedColor} />
      </View>
    </Pressable>
  );
}

export function ReviewWeekStrip({
  entries,
  todayYmd,
  yesterdayYmd,
  filledCount,
  editableCount,
  isDark,
  isSkipped,
  colors,
  onDayPress,
  onListPress,
}: {
  entries: { ymd: string; label: string; fields: ReviewFieldValues }[];
  todayYmd: string;
  yesterdayYmd: string;
  filledCount: number;
  editableCount: number;
  isDark: boolean;
  isSkipped: (ymd: string) => boolean;
  colors: {
    primary: string;
    success: string;
    text: string;
    textMuted: string;
    outline: string;
    surface: string;
  };
  onDayPress: (ymd: string) => void;
  onListPress: () => void;
}) {
  const { colors: themeColors } = useAppTheme();
  return (
    <View style={styles.weekStripWrap}>
      <View style={styles.weekStripHead}>
        <Text style={[styles.weekStripTitle, { color: colors.text }]}>本周期</Text>
        <Pressable onPress={onListPress} hitSlop={8} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
          <Text style={[styles.weekStripStat, { color: colors.primary }]}>
            {filledCount}/{editableCount || 7} 天 · 全部
          </Text>
        </Pressable>
      </View>
      <View style={styles.weekStripRow}>
        {entries.map(entry => {
          const skipped = isSkipped(entry.ymd);
          const filled = !skipped && Object.values(entry.fields).some(v => (v ?? '').trim().length > 0);
          const isToday = entry.ymd === todayYmd;
          const isYesterday = entry.ymd === yesterdayYmd;
          const shortDow = (entry.label.split(' ')[1] ?? '').replace('星期', '周');
          const dayNum = String(Number(entry.ymd.slice(8, 10)));
          const active = isToday || isYesterday;

          return (
            <Pressable
              key={entry.ymd}
              onPress={() => onDayPress(entry.ymd)}
              style={({ pressed }) => [
                styles.weekDay,
                {
                  borderColor: isToday ? colors.success : isYesterday ? colors.primary : colors.outline,
                  backgroundColor: isToday
                    ? themeColors.primaryMuted
                    : isYesterday
                      ? themeColors.primaryMuted
                      : isDark
                        ? themeColors.input
                        : colors.surface,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <Text style={[styles.weekDayDow, { color: active ? colors.text : colors.textMuted }]}>{shortDow}</Text>
              <Text style={[styles.weekDayNum, { color: colors.text }]}>{dayNum}</Text>
              {skipped ? (
                <MaterialIcons name="event-available" size={12} color={colors.primary} />
              ) : (
                <View
                  style={[
                    styles.weekDayDot,
                    {
                      backgroundColor: filled ? colors.success : themeColors.outlineStrong,
                    },
                  ]}
                />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function ReviewQuickActions({
  items,
  isDark,
  surface,
  borderColor,
}: {
  items: {
    icon: ComponentProps<typeof MaterialIcons>['name'];
    label: string;
    color: string;
    onPress: () => void;
  }[];
  isDark: boolean;
  surface: string;
  borderColor: string;
}) {
  return (
    <View style={styles.quickActions}>
      {items.map(item => (
        <Pressable
          key={item.label}
          onPress={item.onPress}
          style={({ pressed }) => [
            styles.quickAction,
            {
              backgroundColor: surface,
              borderColor,
              opacity: pressed ? 0.88 : 1,
            },
          ]}>
          <View style={[styles.quickActionIcon, { backgroundColor: isDark ? `${item.color}28` : `${item.color}14` }]}>
            <MaterialIcons name={item.icon} size={20} color={item.color} />
          </View>
          <Text style={[styles.quickActionLabel, { color: item.color }]} numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function ReviewNavRow({
  icon,
  title,
  subtitle,
  onPress,
  iconColor,
  iconBg,
  textColor,
  mutedColor,
  borderColor,
  surface,
}: {
  icon: ComponentProps<typeof MaterialIcons>['name'];
  title: string;
  subtitle?: string;
  onPress: () => void;
  iconColor: string;
  iconBg: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  surface: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.navRow,
        { backgroundColor: surface, borderColor, opacity: pressed ? 0.9 : 1 },
      ]}>
      <View style={[styles.navRowIcon, { backgroundColor: iconBg }]}>
        <MaterialIcons name={icon} size={22} color={iconColor} />
      </View>
      <View style={styles.navRowText}>
        <Text style={[styles.navRowTitle, { color: textColor }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.navRowSubtitle, { color: mutedColor }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <MaterialIcons name="chevron-right" size={22} color={mutedColor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 16, fontWeight: '900', marginTop: 8 },
  input: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 4 },
  checkLabel: { flex: 1, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  metricsCard: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 20,
    elevation: 3,
  },
  metricsCardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    zIndex: 1,
  },
  metricsCardInner: {
    paddingLeft: 18,
    paddingRight: 14,
    paddingVertical: 14,
  },
  metricsCardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  metricsCardHeadText: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  metricsCardTitle: {
    fontSize: 17,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  metricsCardSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '600',
    marginTop: 2,
  },
  metricsChevronWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsExpanded: {
    marginTop: 14,
    paddingTop: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  metricsGrid: { gap: 10 },
  metricsGridRow: { flexDirection: 'row', gap: 10 },
  metricTile: {
    flex: 1,
    minWidth: 0,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 8,
  },
  metricTileIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  metricTileLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  metricTileValue: {
    fontSize: 21,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  metricTileUnit: {
    fontSize: 14,
    fontWeight: '700',
  },
  metricsFullTile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  metricsFullIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricsFullLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.7,
  },
  metricsFullValue: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.4,
    marginTop: 2,
  },
  metricsFullUnit: {
    fontSize: 15,
    fontWeight: '700',
  },
  metricsFootnote: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
    paddingHorizontal: 4,
  },
  metricsEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 8,
  },
  metricsEmptyText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  dailyDigestBox: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  dailyDigestTitle: {
    fontSize: 14,
    fontWeight: '900',
  },
  dailyDigestBody: {
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '600',
  },
  dailyDigestActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 2,
  },
  dailyDigestBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    minWidth: 0,
  },
  dailyDigestBtnText: {
    fontSize: 12,
    fontWeight: '800',
  },
  dailyStripHint: {
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 18,
    textAlign: 'center',
    paddingVertical: 2,
  },
  quickRefBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  quickRefChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  quickRefChipText: {
    fontSize: 12,
    fontWeight: '800',
  },
  quickRefIconBtn: {
    marginLeft: 'auto',
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  navRowIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navRowText: { flex: 1, gap: 4, minWidth: 0 },
  navRowTitle: { fontSize: 16, fontWeight: '900' },
  navRowSubtitle: { fontSize: 13, lineHeight: 19, fontWeight: '600' },
  reviewContentCard: {
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 16,
    elevation: 2,
  },
  reviewContentAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    zIndex: 1,
  },
  reviewContentInner: {
    paddingLeft: 18,
    paddingRight: 16,
    paddingVertical: 16,
    gap: 14,
  },
  reviewContentHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  reviewContentTag: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  reviewContentDate: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  reviewContentEdit: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewContentBody: { gap: 14 },
  reviewFieldBlock: { gap: 4 },
  reviewDimTitle: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginTop: 2,
    marginBottom: -2,
  },
  reviewFieldLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  reviewFieldValue: {
    fontSize: 15,
    lineHeight: 23,
    fontWeight: '600',
  },
  reviewEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    gap: 8,
  },
  reviewEmptyText: {
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
  },
  weekStripWrap: { gap: 10 },
  weekStripHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  weekStripTitle: { fontSize: 13, fontWeight: '900', letterSpacing: -0.1 },
  weekStripStat: { fontSize: 13, fontWeight: '800' },
  weekStripRow: {
    flexDirection: 'row',
    gap: 6,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 2,
    gap: 3,
    minWidth: 0,
  },
  weekDayDow: { fontSize: 9, fontWeight: '800' },
  weekDayNum: { fontSize: 16, fontWeight: '900' },
  weekDayDot: { width: 6, height: 6, borderRadius: 3 },
  historyFoldBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  historyFoldIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyFoldTitle: { fontSize: 15, fontWeight: '900', letterSpacing: -0.2 },
  historyFoldSub: { fontSize: 12, fontWeight: '600', lineHeight: 17 },
  quickActions: {
    flexDirection: 'row',
    gap: 10,
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
    gap: 8,
    minWidth: 0,
  },
  quickActionIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: {
    fontSize: 12,
    fontWeight: '900',
    textAlign: 'center',
  },
});
