import { foldFonts, useFoldTheme } from '@/components/review/fold-ui';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * 复盘子页（设置 / 日历）共用的折页头尾。
 * 交互约定：页脚只放「相近的一步」——设置页直达日历，日历页直达设置，
 * 复盘 Hub 永远是回到日刊的正门，避免在子页里再套一层目录。
 */
export function FoldReviewHeader({
  title,
  subtitle,
  onBack,
  right,
}: {
  title: string;
  subtitle: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  const { fold } = useFoldTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="返回"
          style={({ pressed }) => [
            styles.backBtn,
            { backgroundColor: fold.paper2, opacity: pressed ? 0.72 : 1 },
          ]}>
          <MaterialIcons name="chevron-left" size={20} color={fold.ink2} />
        </Pressable>

        <View style={styles.headerText}>
          <Text
            style={[styles.headerTitle, { color: fold.ink }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}>
            {title}
          </Text>
          <Text
            style={[styles.headerSub, { color: fold.muted }]}
            numberOfLines={1}
            maxFontSizeMultiplier={1.3}>
            {subtitle}
          </Text>
        </View>

        {right ? <View style={styles.headerRight}>{right}</View> : null}
      </View>
    </View>
  );
}

type SiblingTab = 'calendar' | 'settings';

const SIBLING_META: Record<SiblingTab, { label: string; icon: React.ComponentProps<typeof MaterialIcons>['name'] }> = {
  calendar: { label: '日历', icon: 'calendar-month' },
  settings: { label: '设置', icon: 'tune' },
};

/** 页脚：复盘 Hub + 相邻子页，一步互达 */
export function FoldReviewFooter({
  sibling,
  onOpenHub,
  onOpenSibling,
}: {
  sibling: SiblingTab;
  onOpenHub: () => void;
  onOpenSibling: () => void;
}) {
  const { fold } = useFoldTheme();
  const meta = SIBLING_META[sibling];
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.footer,
        {
          paddingBottom: Math.max(insets.bottom, 10),
          backgroundColor: fold.paper,
          borderTopColor: fold.line,
        },
      ]}>
      <Pressable
        onPress={onOpenHub}
        accessibilityRole="button"
        accessibilityLabel="返回复盘 Hub"
        style={({ pressed }) => [
          styles.footerBtn,
          { backgroundColor: fold.card, borderColor: fold.line, opacity: pressed ? 0.82 : 1 },
        ]}>
        <MaterialIcons name="auto-stories" size={15} color={fold.ink2} />
        <Text style={[styles.footerText, { color: fold.ink2 }]} maxFontSizeMultiplier={1.3}>
          复盘 Hub
        </Text>
      </Pressable>

      <Pressable
        onPress={onOpenSibling}
        accessibilityRole="button"
        accessibilityLabel={`打开${meta.label}`}
        style={({ pressed }) => [
          styles.footerBtn,
          { backgroundColor: fold.sage2, borderColor: fold.line, opacity: pressed ? 0.82 : 1 },
        ]}>
        <MaterialIcons name={meta.icon} size={15} color={fold.pine} />
        <Text style={[styles.footerText, { color: fold.pine }]} maxFontSizeMultiplier={1.3}>
          {meta.label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  headerTitle: {
    fontFamily: foldFonts.serif,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  headerSub: {
    marginTop: 2,
    fontSize: 9.5,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerBtn: {
    flex: 1,
    minHeight: 42,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  footerText: {
    fontSize: 12.5,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
