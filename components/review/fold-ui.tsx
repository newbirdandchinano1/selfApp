import {
  FOLD_DARK,
  FOLD_LIGHT,
  foldFonts,
  useFoldTheme,
  type FoldPalette,
} from '@/constants/review-fold-theme';
import { reviewContentToPlainDisplay } from '@/lib/review-journal-format';
import {
  REVIEW_BUILTIN_MODULE_KEYS,
  builtinReviewDimensionId,
  type ReviewBuiltinModuleKey,
} from '@/lib/repositories/insights/review-template-defaults';
import type { ReviewDimensionTemplate } from '@/lib/repositories/insights/review-template.types';
import type { ReviewFieldValues } from '@/lib/repositories/insights/review-journal-body';
import { MaterialIcons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

/** 折页 · FOLD 设计令牌由 `@/constants/review-fold-theme` 统一提供 */
export { FOLD_LIGHT, FOLD_DARK, foldFonts, useFoldTheme, type FoldPalette };

export function FoldCard({
  children,
  style,
  padded = true,
  onPress,
  accessibilityLabel,
  tone = 'default',
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  padded?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  tone?: 'default' | 'muted' | 'quote' | 'pine';
}) {
  const { fold } = useFoldTheme();
  const toneStyle =
    tone === 'muted'
      ? { backgroundColor: fold.paper2, borderColor: fold.line }
      : tone === 'quote'
        ? { backgroundColor: fold.aiBg, borderColor: fold.aiBorder }
        : tone === 'pine'
          ? { backgroundColor: fold.summaryBg, borderColor: fold.summaryLine }
          : { backgroundColor: fold.card, borderColor: fold.line };
  const content = (
    <View style={[styles.card, padded && styles.cardPadded, toneStyle, style]}>
      {children}
    </View>
  );

  if (!onPress) return content;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
      {content}
    </Pressable>
  );
}

export function FoldIconButton({
  icon,
  onPress,
  accessibilityLabel,
  variant = 'plain',
  size = 34,
  style,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  onPress: () => void;
  accessibilityLabel: string;
  variant?: 'plain' | 'soft';
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { fold } = useFoldTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [
        styles.iconBtn,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: variant === 'soft' ? fold.paper2 : 'transparent',
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}>
      <MaterialIcons name={icon} size={17} color={fold.ink2} />
    </Pressable>
  );
}

export function FoldPillButton({
  label,
  icon,
  onPress,
  accessibilityLabel,
  variant = 'outline',
  tone = 'pine',
  disabled = false,
  style,
  textStyle,
}: {
  label: string;
  icon?: React.ComponentProps<typeof MaterialIcons>['name'];
  onPress: () => void;
  accessibilityLabel?: string;
  variant?: 'outline' | 'solid' | 'soft';
  tone?: 'pine' | 'ink';
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const { fold } = useFoldTheme();
  const solid = variant === 'solid';
  const color = solid ? fold.onPineButton : tone === 'ink' ? fold.ink2 : fold.pine;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.pillBtn,
        {
          backgroundColor:
            variant === 'solid' ? fold.pineButton : variant === 'soft' ? fold.paper2 : fold.card,
          borderColor: variant === 'outline' ? fold.line : 'transparent',
          opacity: disabled ? 0.4 : pressed ? 0.82 : 1,
        },
        style,
      ]}>
      {icon ? <MaterialIcons name={icon} size={13} color={color} /> : null}
      <Text
        style={[styles.pillText, { color }, textStyle]}
        numberOfLines={1}
        maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

export function FoldSegment<T extends string>({
  options,
  value,
  onChange,
  style,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { fold } = useFoldTheme();
  const activeIndex = Math.max(
    0,
    options.findIndex(option => option.value === value),
  );
  return (
    <View style={[styles.segmentTrack, { backgroundColor: fold.paper2, borderColor: fold.line }, style]}>
      {options.map((option, index) => {
        const active = index === activeIndex;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            style={({ pressed }) => [styles.segmentItem, { opacity: pressed ? 0.8 : 1 }]}>
            {active ? (
              <View style={[styles.segmentIndicator, { backgroundColor: fold.card, borderColor: fold.line }]} />
            ) : null}
            <Text
              style={[styles.segmentText, { color: active ? fold.ink : fold.muted }]}
              maxFontSizeMultiplier={1.3}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function FoldTag({
  children,
  tone = 'gray',
}: {
  children: React.ReactNode;
  tone?: 'green' | 'gray' | 'pine' | 'amber' | 'clay';
}) {
  const { fold } = useFoldTheme();
  const toneStyle =
    tone === 'green'
      ? { backgroundColor: fold.sage2, color: '#36594D' }
      : tone === 'pine'
        ? { backgroundColor: fold.sage2, color: fold.pine }
        : tone === 'amber'
          ? { backgroundColor: fold.amber2, color: '#8B5A1E' }
          : tone === 'clay'
            ? { backgroundColor: fold.clay2, color: '#8F422B' }
            : { backgroundColor: fold.paper2, color: fold.muted };

  return (
    <View style={[styles.tag, { backgroundColor: toneStyle.backgroundColor }]}>
      <Text style={[styles.tagText, { color: toneStyle.color }]} maxFontSizeMultiplier={1.25}>
        {children}
      </Text>
    </View>
  );
}

export function FoldSectionHeader({ title, hint }: { title: string; hint?: string }) {
  const { fold } = useFoldTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
        {title}
      </Text>
      {hint ? (
        <Text style={[styles.sectionHint, { color: fold.muted }]} numberOfLines={1} maxFontSizeMultiplier={1.25}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function FoldSwitch({
  value,
  onValueChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const { fold } = useFoldTheme();
  const [progress] = useState(() => new Animated.Value(value ? 1 : 0));

  useEffect(() => {
    Animated.spring(progress, {
      toValue: value ? 1 : 0,
      speed: 20,
      bounciness: 4,
      useNativeDriver: false,
    }).start();
  }, [progress, value]);

  const backgroundColor = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [fold.trackOff, fold.pineButton],
  });
  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [2, 22] });

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.86 : 1 }]}>
      <Animated.View style={[styles.switchTrack, { backgroundColor }]}>
        <Animated.View style={[styles.switchThumb, { transform: [{ translateX }] }]} />
      </Animated.View>
    </Pressable>
  );
}

type DimensionMeta = {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  iconColor: string;
  iconBg: string;
};

function dimensionMeta(
  key: ReviewBuiltinModuleKey,
  fold: FoldPalette,
): DimensionMeta {
  switch (key) {
    case 'health':
      return { icon: 'spa', iconColor: '#3D5E50', iconBg: fold.sage2 };
    case 'tasks':
      return { icon: 'checklist', iconColor: fold.ink2, iconBg: fold.paper2 };
    case 'finance':
      return { icon: 'account-balance-wallet', iconColor: '#9B6520', iconBg: fold.amber2 };
    case 'routine':
      return { icon: 'wb-sunny', iconColor: fold.ink2, iconBg: fold.paper2 };
    case 'defects':
      return { icon: 'visibility', iconColor: fold.clay, iconBg: fold.clay2 };
    case 'ideas':
      return { icon: 'auto-awesome', iconColor: fold.pine, iconBg: fold.sage2 };
    default:
      return { icon: 'dashboard-customize', iconColor: fold.muted, iconBg: fold.paper2 };
  }
}

function resolveBuiltinKey(scope: 'weekly' | 'monthly' | 'daily', dimensionId: string): ReviewBuiltinModuleKey | null {
  for (const key of REVIEW_BUILTIN_MODULE_KEYS) {
    if (dimensionId === builtinReviewDimensionId(scope, key)) return key;
  }
  return null;
}

/** 内置维度图标（设计稿使用 🌿 ◎ ¥ ☼ ◐ ✦ 字符） */
export function foldDimensionGlyph(dimensionId: string): string {
  const key = dimensionId.split('_').pop() ?? '';
  switch (key) {
    case 'health':
      return '🌿';
    case 'tasks':
      return '◎';
    case 'finance':
      return '¥';
    case 'routine':
      return '☼';
    case 'defects':
      return '◐';
    case 'ideas':
      return '✦';
    default:
      return '✦';
  }
}

function dimensionPreview(dim: ReviewDimensionTemplate, fields: ReviewFieldValues): string {
  const parts: string[] = [];
  for (const col of dim.columns) {
    const plain = reviewContentToPlainDisplay(fields[col.id] ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (plain) parts.push(plain);
  }
  const text = parts.join(' · ');
  if (text) return text.length > 54 ? `${text.slice(0, 54)}…` : text;
  const placeholder = dim.columns[0]?.placeholder ?? '还没有填写';
  return placeholder;
}

export function FoldDimensionGrid({
  scope,
  dimensions,
  fields,
  canEdit,
  onOpenDimension,
}: {
  scope: 'weekly' | 'monthly';
  dimensions: ReviewDimensionTemplate[];
  fields: ReviewFieldValues;
  canEdit: boolean;
  onOpenDimension: (dimensionId: string) => void;
}) {
  const { fold } = useFoldTheme();

  const cards = useMemo(
    () =>
      dimensions.map(dim => {
        const key = resolveBuiltinKey(scope, dim.id);
        const meta = key
          ? dimensionMeta(key, fold)
          : { icon: 'dashboard-customize' as const, iconColor: fold.muted, iconBg: fold.paper2 };
        const filled = dim.columns.some(
          col => reviewContentToPlainDisplay(fields[col.id] ?? '').replace(/\s/g, '').length > 0,
        );
        return { dim, meta, filled, preview: dimensionPreview(dim, fields) };
      }),
    [dimensions, fields, fold, scope],
  );

  return (
    <View style={styles.dimGrid}>
      {cards.map(({ dim, meta, filled, preview }) => (
        <Pressable
          key={dim.id}
          onPress={() => onOpenDimension(dim.id)}
          accessibilityRole="button"
          accessibilityLabel={`${dim.title}，${filled ? '已填' : '待填'}，${canEdit ? '点击编辑' : '点击查看'}`}
          style={({ pressed }) => [styles.dimCardWrap, { opacity: pressed ? 0.9 : 1 }]}>
          <View style={[styles.dimCard, { backgroundColor: fold.card, borderColor: fold.line }]}>
            <View style={styles.dimHead}>
              <View style={styles.dimName}>
                <View style={[styles.dimIcon, { backgroundColor: meta.iconBg }]}>
                  <MaterialIcons name={meta.icon} size={14} color={meta.iconColor} />
                </View>
                <Text style={[styles.dimTitle, { color: fold.ink2 }]} numberOfLines={1} maxFontSizeMultiplier={1.25}>
                  {dim.title}
                </Text>
              </View>
              <FoldTag tone={filled ? 'green' : 'gray'}>{filled ? '已填' : '待填'}</FoldTag>
            </View>
            <Text
              style={[styles.dimPreview, { color: fold.muted }]}
              numberOfLines={2}
              maxFontSizeMultiplier={1.3}>
              {preview}
            </Text>
          </View>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  cardPadded: {
    padding: 16,
  },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillBtn: {
    minHeight: 30,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  pillText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
  segmentTrack: {
    flexDirection: 'row',
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 3,
    gap: 3,
  },
  segmentItem: {
    flex: 1,
    minHeight: 32,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  segmentIndicator: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#32362B',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 1,
  },
  segmentText: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1,
  },
  tag: {
    height: 20,
    paddingHorizontal: 7,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  sectionHint: {
    fontSize: 11,
    flexShrink: 1,
    textAlign: 'right',
  },
  switchTrack: {
    width: 46,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
  },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.18,
    shadowRadius: 2,
    elevation: 2,
  },
  dimGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  dimCardWrap: {
    width: '48%',
    flexGrow: 1,
  },
  dimCard: {
    minHeight: 96,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
  },
  dimHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  dimName: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  dimIcon: {
    width: 24,
    height: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dimTitle: {
    fontSize: 12.5,
    fontWeight: '800',
    flexShrink: 1,
  },
  dimPreview: {
    marginTop: 8,
    fontSize: 11.5,
    lineHeight: 17,
    fontWeight: '500',
  },
});
