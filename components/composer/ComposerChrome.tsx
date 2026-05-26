import { Layout, Spacing, Typography } from '@/constants/design-tokens';
import { useAppTheme } from '@/hooks/use-app-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { composerStyles as s } from './composer-styles';
import { parseScheduleDisplay } from './parse-schedule-display';

type IconName = React.ComponentProps<typeof MaterialIcons>['name'];

export function ComposerTopBar({
  title,
  subtitle,
  onBack,
  onSubmit,
  submitting,
  submitLabel = '创建',
}: {
  title: string;
  subtitle?: string;
  onBack: () => void;
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel?: string;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useAppTheme();

  return (
    <View
      style={[
        s.topBar,
        {
          paddingTop: Math.max(insets.top, Spacing.md),
          borderBottomColor: colors.outline,
          backgroundColor: colors.headerScrim,
        },
      ]}>
      <Pressable
        onPress={onBack}
        hitSlop={Layout.hitSlop}
        accessibilityLabel="返回"
        style={({ pressed }) => [s.topBarBack, { backgroundColor: colors.surfaceMuted }, pressed && { opacity: 0.85 }]}>
        <MaterialIcons name="arrow-back" size={22} color={colors.text} />
      </Pressable>
      <View style={s.topBarCenter}>
        <Text style={[Typography.h3, { color: colors.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[Typography.caption, s.topBarSub, { color: colors.textSecondary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={onSubmit}
        disabled={submitting}
        accessibilityLabel={submitLabel}
        style={({ pressed }) => [
          s.topBarCreate,
          { backgroundColor: colors.primary, opacity: submitting ? 0.65 : pressed ? 0.9 : 1 },
        ]}>
        {submitting ? (
          <ActivityIndicator size="small" color={colors.onPrimary} />
        ) : (
          <>
            <MaterialIcons name="check" size={18} color={colors.onPrimary} />
            <Text style={[Typography.bodyStrong, { color: colors.onPrimary }]}>{submitLabel}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

export function ComposerHero({
  kicker,
  badgeIcon = 'task-alt',
  placeholder,
  value,
  onChangeText,
  maxLength,
}: {
  kicker: string;
  badgeIcon?: IconName;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  maxLength: number;
}) {
  const { colors, isDark, shadows } = useAppTheme();
  const progress = value.length / maxLength;

  return (
    <View
      style={[
        s.composeHero,
        shadows.card,
        {
          backgroundColor: isDark ? colors.accentCard : colors.primaryMuted,
          borderColor: isDark ? colors.outline : colors.primaryRing,
        },
      ]}>
      <View style={[s.heroOrb, s.heroOrbA, { backgroundColor: `${colors.primary}22` }]} />
      <View style={[s.heroOrb, s.heroOrbB, { backgroundColor: `${colors.primarySoft}18` }]} />
      <View style={s.heroTopRow}>
        <View style={[s.heroBadge, { backgroundColor: colors.primary }]}>
          <MaterialIcons name={badgeIcon} size={16} color={colors.onPrimary} />
        </View>
        <Text style={[Typography.label, { color: colors.primary }]}>{kicker}</Text>
      </View>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={isDark ? colors.textMuted : colors.textSecondary}
        maxLength={maxLength}
        multiline
        style={[s.composeInput, { color: colors.text }]}
      />
      <View style={s.composeFooter}>
        <View style={[s.progressTrack, { backgroundColor: isDark ? colors.capsule : colors.surface }]}>
          <View
            style={[
              s.progressFill,
              {
                width: `${Math.max(progress * 100, value.length > 0 ? 6 : 0)}%`,
                backgroundColor: colors.primary,
              },
            ]}
          />
        </View>
        <Text style={[Typography.caption, { color: colors.textSecondary }]}>
          {value.length}/{maxLength}
        </Text>
      </View>
    </View>
  );
}

export function ComposerSectionHead({
  title,
  description,
  accentColor,
  rightIcon,
}: {
  title: string;
  description?: string;
  accentColor: string;
  rightIcon?: IconName;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={s.sectionHead}>
      <View style={[s.sectionAccent, { backgroundColor: accentColor }]} />
      <View style={{ flex: 1 }}>
        <Text style={[Typography.title, { color: colors.text }]}>{title}</Text>
        {description ? (
          <Text style={[Typography.caption, s.sectionDesc, { color: colors.textSecondary }]}>{description}</Text>
        ) : null}
      </View>
      {rightIcon ? <MaterialIcons name={rightIcon} size={22} color={accentColor} /> : null}
    </View>
  );
}

export function ComposerOptionRow({
  onPress,
  icon,
  iconBg,
  title,
  value,
  accessibilityLabel,
}: {
  onPress: () => void;
  icon: IconName;
  iconBg?: string;
  title: string;
  value: string;
  accessibilityLabel?: string;
}) {
  const { colors, shadows } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
      <View
        style={[
          s.optionCard,
          shadows.card,
          { backgroundColor: colors.surface, borderColor: colors.outline },
        ]}>
        <View style={[s.heroBadge, { backgroundColor: iconBg ?? colors.primaryMuted, width: 40, height: 40 }]}>
          <MaterialIcons name={icon} size={20} color={colors.primary} />
        </View>
        <View style={s.optionCardBody}>
          <Text style={[Typography.caption, { color: colors.textSecondary }]}>{title}</Text>
          <Text style={[Typography.bodyStrong, { color: colors.text }]} numberOfLines={2}>
            {value}
          </Text>
        </View>
        <MaterialIcons name="chevron-right" size={22} color={colors.textMuted} />
      </View>
    </Pressable>
  );
}

export function ComposerScheduleSection({
  deadlineText,
  reminderText,
  repeatText,
  onPress,
}: {
  deadlineText: string;
  reminderText: string;
  repeatText: string;
  onPress: () => void;
}) {
  const { colors, shadows } = useAppTheme();
  const scheduleDisplay = React.useMemo(() => parseScheduleDisplay(deadlineText), [deadlineText]);
  const hasSchedule = Boolean(deadlineText.trim() || reminderText || repeatText);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="设置时间"
      style={({ pressed }) => [pressed && { opacity: 0.92 }]}>
      <ComposerSectionHead
        accentColor={colors.primary}
        title="时间安排"
        description="截止日期 · 提醒 · 重复"
        rightIcon="edit-calendar"
      />
      <View
        style={[
          s.schedulePanel,
          shadows.card,
          {
            backgroundColor: colors.surface,
            borderColor: hasSchedule ? colors.primaryRing : colors.outline,
          },
        ]}>
        <View style={[s.calendarTile, { backgroundColor: colors.primaryMuted }]}>
          {scheduleDisplay ? (
            <>
              <Text style={[s.calendarMonth, { color: colors.primary }]}>{scheduleDisplay.month}月</Text>
              <Text style={[s.calendarDay, { color: colors.text }]}>{scheduleDisplay.day}</Text>
              <Text style={[Typography.caption, { color: colors.textSecondary }]}>{scheduleDisplay.weekday}</Text>
            </>
          ) : (
            <>
              <MaterialIcons name="event-available" size={28} color={colors.primary} />
              <Text style={[Typography.caption, s.calendarEmpty, { color: colors.textSecondary }]}>未设置</Text>
            </>
          )}
        </View>
        <View style={s.scheduleCopy}>
          <Text
            style={[Typography.bodyStrong, { color: deadlineText.trim() ? colors.text : colors.textMuted }]}
            numberOfLines={3}>
            {deadlineText.trim() || '点击配置截止日期、时段与提醒'}
          </Text>
          {scheduleDisplay?.timeTail ? (
            <Text style={[Typography.caption, { color: colors.textSecondary }]}>{scheduleDisplay.timeTail}</Text>
          ) : null}
          <View style={s.scheduleChips}>
            {reminderText ? (
              <View style={[s.scheduleChip, { backgroundColor: colors.capsule }]}>
                <MaterialIcons name="notifications-active" size={14} color={colors.primary} />
                <Text style={[Typography.caption, { color: colors.text }]} numberOfLines={1}>
                  {reminderText}
                </Text>
              </View>
            ) : (
              <View style={[s.scheduleChipGhost, { borderColor: colors.outline }]}>
                <Text style={[Typography.caption, { color: colors.textMuted }]}>+ 提醒</Text>
              </View>
            )}
            {repeatText ? (
              <View style={[s.scheduleChip, { backgroundColor: colors.capsule }]}>
                <MaterialIcons name="repeat" size={14} color={colors.primary} />
                <Text style={[Typography.caption, { color: colors.text }]} numberOfLines={1}>
                  {repeatText}
                </Text>
              </View>
            ) : (
              <View style={[s.scheduleChipGhost, { borderColor: colors.outline }]}>
                <Text style={[Typography.caption, { color: colors.textMuted }]}>+ 重复</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

export function ComposerEditorialCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors, shadows } = useAppTheme();

  return (
    <View
      style={[
        s.editorialCard,
        shadows.card,
        { backgroundColor: colors.surface, borderColor: colors.outline },
        style,
      ]}>
      {children}
    </View>
  );
}

export function ComposerNoteSection({
  value,
  onChangeText,
  placeholder,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}) {
  const { colors } = useAppTheme();

  return (
    <View style={s.section}>
      <ComposerSectionHead accentColor={colors.textMuted} title="备注" />
      <View
        style={[
          s.notePanel,
          {
            backgroundColor: colors.surface,
            borderLeftColor: colors.primary,
            borderColor: colors.outline,
          },
        ]}>
        <MaterialIcons name="format-quote" size={18} color={colors.primary} style={s.noteQuoteIcon} />
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? '背景信息、协作人、链接…（可选）'}
          placeholderTextColor={colors.textMuted}
          multiline
          textAlignVertical="top"
          style={[Typography.body, s.noteInput, { color: colors.text }]}
        />
      </View>
    </View>
  );
}

export function ComposerSection({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[s.section, style]}>{children}</View>;
}

export function ComposerMain({ children }: { children: React.ReactNode }) {
  return <View style={s.main}>{children}</View>;
}

export { composerStyles } from './composer-styles';
export { parseScheduleDisplay } from './parse-schedule-display';
