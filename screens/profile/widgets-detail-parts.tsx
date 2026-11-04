/**
 * 组件详情页共用块：适用形态说明、如何添加、打开对应页。
 */
import { useFoldTheme } from '@/constants/review-fold-theme';
import {
  WIDGET_DISPLAY_NAMES,
  WIDGET_TRY_OPEN_HREF,
  widgetHowToAddSteps,
  type WidgetBusinessId,
} from '@/lib/widgets/widget-catalog';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

type Fold = ReturnType<typeof useFoldTheme>['fold'];

type FormsCardProps = {
  fold: Fold;
  busId: WidgetBusinessId;
  busy: boolean;
  switchTrack: { false: string; true: string };
  /** 主屏：随业务启用；此处只读展示或与 enabled 联动 */
  homeEnabled: boolean;
  onHomeChange?: (v: boolean) => void;
  lockEnabled: boolean;
  onLockChange?: (v: boolean) => void;
  lockHint?: string;
  lockDisabled?: boolean;
  liveActivityEnabled?: boolean;
  onLiveActivityChange?: (v: boolean) => void;
  liveActivityHint?: string;
  liveActivityDisabled?: boolean;
  showLiveActivity?: boolean;
};

export function WidgetsFormsCard({
  fold,
  busy,
  switchTrack,
  homeEnabled,
  onHomeChange,
  lockEnabled,
  onLockChange,
  lockHint,
  lockDisabled,
  liveActivityEnabled,
  onLiveActivityChange,
  liveActivityHint,
  liveActivityDisabled,
  showLiveActivity,
}: FormsCardProps) {
  return (
    <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
      <Text style={[styles.rowTitle, { color: fold.ink }]}>适用形态</Text>
      <Text style={[styles.rowHint, { color: fold.muted, marginTop: 4 }]}>
        仅 iOS 主屏 / 锁屏 / 灵动岛；内容由桌面尺寸决定，App 侧统一供数。
      </Text>

      <View style={[styles.toggleRow, { marginTop: 10 }]}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={[styles.rowTitle, { color: fold.ink, fontSize: 14 }]}>主屏小组件</Text>
          <Text style={[styles.rowHint, { color: fold.muted }]}>小 / 中号由系统选择</Text>
        </View>
        <Switch
          value={homeEnabled}
          disabled={busy || !onHomeChange}
          onValueChange={onHomeChange}
          trackColor={switchTrack}
          thumbColor="#ffffff"
        />
      </View>

      <View style={[styles.divider, { backgroundColor: fold.line }]} />
      <View style={styles.toggleRow}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          <Text style={[styles.rowTitle, { color: fold.ink, fontSize: 14 }]}>锁屏小组件</Text>
          <Text style={[styles.rowHint, { color: fold.muted }]}>
            {lockHint ?? '通知中心 / 锁屏工具'}
          </Text>
        </View>
        <Switch
          value={lockEnabled}
          disabled={busy || lockDisabled || !onLockChange}
          onValueChange={onLockChange}
          trackColor={switchTrack}
          thumbColor="#ffffff"
        />
      </View>

      {showLiveActivity ? (
        <>
          <View style={[styles.divider, { backgroundColor: fold.line }]} />
          <View style={styles.toggleRow}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={[styles.rowTitle, { color: fold.ink, fontSize: 14 }]}>灵动岛</Text>
              <Text style={[styles.rowHint, { color: fold.muted }]}>
                {liveActivityHint ?? '仅进行中时段上岛'}
              </Text>
            </View>
            <Switch
              value={!!liveActivityEnabled}
              disabled={busy || liveActivityDisabled || !onLiveActivityChange}
              onValueChange={onLiveActivityChange}
              trackColor={switchTrack}
              thumbColor="#ffffff"
            />
          </View>
        </>
      ) : null}
    </View>
  );
}

type HowToAddProps = {
  fold: Fold;
  busId: WidgetBusinessId;
};

export function WidgetsHowToAddCard({ fold, busId }: HowToAddProps) {
  const displayName = WIDGET_DISPLAY_NAMES[busId];
  return (
    <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
      <Text style={[styles.rowTitle, { color: fold.ink }]}>如何添加本组件</Text>
      <Text style={[styles.rowHint, { color: fold.muted, marginTop: 6 }]}>
        {widgetHowToAddSteps(displayName)}
      </Text>
      <Text style={[styles.rowHint, { color: fold.muted, marginTop: 8 }]}>
        配置好后，请到主屏或锁屏添加「小郑的自我修养」小组件（系统无法由 App 一键安装）。
      </Text>
    </View>
  );
}

type ClickBehaviorProps = {
  fold: Fold;
  busId: WidgetBusinessId;
  description: string;
  reminderHref?: string;
  reminderLabel?: string;
};

export function WidgetsClickBehaviorCard({
  fold,
  busId,
  description,
  reminderHref,
  reminderLabel,
}: ClickBehaviorProps) {
  const router = useRouter();
  return (
    <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
      <Text style={[styles.rowTitle, { color: fold.ink }]}>点击行为</Text>
      <Text style={[styles.rowHint, { color: fold.muted, marginTop: 6 }]}>{description}</Text>
      <Pressable
        onPress={() => router.push(WIDGET_TRY_OPEN_HREF[busId] as never)}
        style={{ marginTop: 10 }}>
        <Text style={{ color: fold.pine, fontWeight: '700', fontSize: 13 }}>打开对应页试试 ›</Text>
      </Pressable>
      {reminderHref && reminderLabel ? (
        <Pressable
          onPress={() => router.push(reminderHref as never)}
          style={{ marginTop: 8 }}>
          <Text style={{ color: fold.pine, fontWeight: '700', fontSize: 13 }}>{reminderLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, marginTop: 3, lineHeight: 17 },
});
