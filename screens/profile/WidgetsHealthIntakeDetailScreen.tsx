/**
 * 桌面组件 · 健康摄入缺口 详情
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import type {
  HealthIntakeFocusKey,
  HealthIntakeWidgetProps,
} from '@/lib/widgets/health-intake-glance';
import { healthIntakeFocusLabel } from '@/lib/widgets/health-intake-glance';
import {
  previewHealthIntakeWidgetProps,
  scheduleHealthIntakeWidgetSync,
} from '@/lib/widgets/health-intake-widget-sync';
import {
  getWidgetsSettings,
  patchWidgetsSettings,
  type WidgetsSettings,
} from '@/lib/widgets/widgets-settings';
import {
  WidgetsClickBehaviorCard,
  WidgetsFormsCard,
  WidgetsHowToAddCard,
} from '@/screens/profile/widgets-detail-parts';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const MANUAL_OPTIONS: HealthIntakeFocusKey[] = [
  'hydration',
  'protein',
  'carbohydrate',
  'calories',
];

function PreviewCard({
  preview,
  fold,
  medium,
}: {
  preview: HealthIntakeWidgetProps;
  fold: ReturnType<typeof useFoldTheme>['fold'];
  medium: boolean;
}) {
  const showDual = medium && preview.ringCount >= 2 && !!preview.ring2Label;
  return (
    <View
      style={[
        styles.preview,
        {
          backgroundColor: fold.ink,
          borderColor: fold.line,
          minHeight: medium ? 150 : 118,
        },
      ]}>
      <Text style={[styles.previewKind, { color: preview.allDone ? '#8FBF9F' : '#7BB39A' }]}>
        健康摄入
      </Text>
      {preview.hasItems === 0 ? (
        <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.7)', marginTop: 8 }]}>
          {preview.statusLine}
        </Text>
      ) : showDual ? (
        <View style={styles.previewRings}>
          <View style={styles.previewRing}>
            <Text style={styles.previewPct}>{`${Math.round(preview.ring1Percent)}%`}</Text>
            <Text style={styles.previewRingLabel}>{preview.ring1Label}</Text>
            <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.55)' }]}>
              {preview.ring1ValueLine}
            </Text>
          </View>
          <View style={styles.previewRing}>
            <Text style={styles.previewPct}>{`${Math.round(preview.ring2Percent)}%`}</Text>
            <Text style={styles.previewRingLabel}>{preview.ring2Label}</Text>
            <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.55)' }]}>
              {preview.ring2ValueLine}
            </Text>
          </View>
        </View>
      ) : (
        <View style={{ marginTop: 8 }}>
          <Text style={styles.previewRingLabel}>{preview.ring1Label}</Text>
          <Text style={styles.previewPct}>{`${Math.round(preview.ring1Percent)}%`}</Text>
          <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.55)' }]}>
            {preview.ring1ValueLine}
          </Text>
        </View>
      )}
      <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.7)', marginTop: 10 }]}>
        {preview.statusLine}
      </Text>
    </View>
  );
}

export default function WidgetsHealthIntakeDetailScreen() {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<WidgetsSettings | null>(null);
  const [preview, setPreview] = useState<HealthIntakeWidgetProps | null>(null);
  const [medium, setMedium] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [next, snap] = await Promise.all([
        getWidgetsSettings(),
        previewHealthIntakeWidgetProps(),
      ]);
      setSettings(next);
      setPreview(snap);
    } catch (e) {
      toast(toUserMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const applyHealth = useCallback(
    async (patch: Parameters<typeof patchWidgetsSettings>[0]['healthIntake']) => {
      setBusy(true);
      try {
        const next = await patchWidgetsSettings({ healthIntake: patch });
        setSettings(next);
        scheduleHealthIntakeWidgetSync('health-detail');
        setPreview(await previewHealthIntakeWidgetProps());
      } catch (e) {
        toast(toUserMessage(e, '保存失败'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const toggleManualKey = useCallback(
    (key: HealthIntakeFocusKey) => {
      if (!settings) return;
      const cur = settings.healthIntake.manualKeys;
      const has = cur.includes(key);
      let next: HealthIntakeFocusKey[];
      if (has) {
        next = cur.filter((k) => k !== key);
        if (next.length === 0) {
          toast('至少保留 1 项');
          return;
        }
      } else {
        if (cur.length >= 2) {
          toast('最多指定 2 项');
          return;
        }
        next = [...cur, key];
      }
      void applyHealth({ manualKeys: next });
    },
    [applyHealth, settings],
  );

  const switchTrack = { false: fold.line2, true: fold.pineButton };
  const deliveryOn = !!(settings?.masterEnabled && settings.healthIntake.enabled);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['top', 'bottom']}>
      <View style={styles.appBar}>
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={18} color={fold.ink2} />
        </Pressable>
        <View style={styles.appBarTitle}>
          <Text style={[styles.title, { color: fold.ink }]}>健康摄入缺口</Text>
          <Text style={[styles.sub, { color: fold.muted }]}>主屏进度环 · 下次提醒</Text>
        </View>
        <View
          style={[
            styles.statusTag,
            { backgroundColor: deliveryOn ? fold.sage2 : fold.paper2 },
          ]}>
          <Text
            style={{
              fontSize: 10,
              fontWeight: '700',
              color: deliveryOn ? '#36594D' : fold.muted,
            }}>
            {deliveryOn ? '已开启' : '已关闭'}
          </Text>
        </View>
      </View>

      {loading || !settings || !preview ? (
        <View style={styles.centered}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={motionOn} index={0} staggerMs={40} fromY={10}>
            <View style={styles.segRow}>
              <Pressable
                onPress={() => setMedium(false)}
                style={[
                  styles.seg,
                  {
                    backgroundColor: !medium ? fold.pineButton : fold.card,
                    borderColor: fold.line,
                  },
                ]}>
                <Text style={{ color: !medium ? '#fff' : fold.ink2, fontWeight: '700', fontSize: 12 }}>
                  小号
                </Text>
              </Pressable>
              <Pressable
                onPress={() => setMedium(true)}
                style={[
                  styles.seg,
                  {
                    backgroundColor: medium ? fold.pineButton : fold.card,
                    borderColor: fold.line,
                  },
                ]}>
                <Text style={{ color: medium ? '#fff' : fold.ink2, fontWeight: '700', fontSize: 12 }}>
                  中号
                </Text>
              </Pressable>
            </View>
            <PreviewCard preview={preview} fold={fold} medium={medium} />
            <Text style={[styles.previewCaption, { color: fold.muted }]}>
              仅预览；主屏添加「健康摄入」后生效。点按打开健康首页。
            </Text>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>启用本业务组件</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    {settings.masterEnabled
                      ? '关闭后停止推送本卡快照'
                      : '总开关已关 · 仍可预配置'}
                  </Text>
                </View>
                <Switch
                  value={settings.healthIntake.enabled}
                  disabled={busy}
                  onValueChange={(v) => void applyHealth({ enabled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={40} fromY={10}>
            <WidgetsFormsCard
              fold={fold}
              busId="health-intake"
              busy={busy}
              switchTrack={switchTrack}
              homeEnabled={settings.healthIntake.enabled}
              onHomeChange={(v) => void applyHealth({ enabled: v })}
              lockEnabled={settings.healthIntake.enabled}
              lockHint="锁屏仅展示主环百分比"
              onLockChange={(v) => {
                if (!v) toast('关闭锁屏请到系统长按移除；此处随业务推送开关');
              }}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>环样式</Text>
              <View style={[styles.segRow, { marginTop: 10 }]}>
                {(
                  [
                    ['single', '单环（最大缺口）'],
                    ['dual', '双环'],
                  ] as const
                ).map(([key, label]) => {
                  const on = settings.healthIntake.ringStyle === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => void applyHealth({ ringStyle: key })}
                      style={[
                        styles.seg,
                        {
                          backgroundColor: on ? fold.pineButton : fold.paper2,
                          borderColor: fold.line,
                        },
                      ]}>
                      <Text style={{ color: on ? '#fff' : fold.ink2, fontWeight: '700', fontSize: 12 }}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <Text style={[styles.rowHint, { color: fold.muted, marginTop: 8 }]}>
                中号可展示双环；小号始终突出主环。
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={4} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>展示关注项</Text>
              <View style={[styles.segRow, { marginTop: 10 }]}>
                {(
                  [
                    ['follow_care', '跟随「我关心」'],
                    ['manual', '手动指定'],
                  ] as const
                ).map(([key, label]) => {
                  const on = settings.healthIntake.focusSource === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => void applyHealth({ focusSource: key })}
                      style={[
                        styles.seg,
                        {
                          backgroundColor: on ? fold.pineButton : fold.paper2,
                          borderColor: fold.line,
                        },
                      ]}>
                      <Text style={{ color: on ? '#fff' : fold.ink2, fontWeight: '700', fontSize: 12 }}>
                        {label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {settings.healthIntake.focusSource === 'manual' ? (
                <View style={{ marginTop: 10, gap: 4 }}>
                  {MANUAL_OPTIONS.map((key, idx) => {
                    const on = settings.healthIntake.manualKeys.includes(key);
                    return (
                      <View key={key}>
                        {idx > 0 ? (
                          <View style={[styles.divider, { backgroundColor: fold.line }]} />
                        ) : null}
                        <View style={styles.toggleRow}>
                          <Text style={[styles.rowTitle, { color: fold.ink, flex: 1 }]}>
                            {healthIntakeFocusLabel(key)}
                          </Text>
                          <Switch
                            value={on}
                            disabled={busy}
                            onValueChange={() => toggleManualKey(key)}
                            trackColor={switchTrack}
                            thumbColor="#ffffff"
                          />
                        </View>
                      </View>
                    );
                  })}
                  <Text style={[styles.rowHint, { color: fold.muted, marginTop: 6 }]}>
                    最多 2 项；组件再按缺口挑主环 / 双环。
                  </Text>
                </View>
              ) : (
                <Text style={[styles.rowHint, { color: fold.muted, marginTop: 8 }]}>
                  与提醒设置里的「我关心」一致，组件取缺口最大的一项或两项。
                </Text>
              )}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={5} staggerMs={40} fromY={10}>
            <WidgetsClickBehaviorCard
              fold={fold}
              busId="health-intake"
              description="点按打开健康首页；提醒仍走「提醒设置 · 健康」（推与看分工）。"
              reminderHref="/notification-channel/health"
              reminderLabel="去配置健康提醒 ›"
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={6} staggerMs={40} fromY={10}>
            <WidgetsHowToAddCard fold={fold} busId="health-intake" />
          </FoldRiseIn>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 10,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitle: { flex: 1 },
  title: { fontSize: 17, fontWeight: '700' },
  sub: { fontSize: 11, marginTop: 2 },
  statusTag: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 14, paddingBottom: 40, gap: 12 },
  segRow: { flexDirection: 'row', gap: 8 },
  seg: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  preview: {
    marginTop: 10,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  previewKind: { fontSize: 11, fontWeight: '800' },
  previewRings: { flexDirection: 'row', gap: 18, marginTop: 10 },
  previewRing: { flex: 1 },
  previewPct: { color: '#F3EFE6', fontSize: 22, fontWeight: '700', marginTop: 2 },
  previewRingLabel: { color: '#A8D4C0', fontSize: 12, fontWeight: '700', marginTop: 2 },
  previewMuted: { fontSize: 12 },
  previewCaption: { fontSize: 11, marginTop: 8, marginLeft: 2 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, marginTop: 3, lineHeight: 17 },
});
