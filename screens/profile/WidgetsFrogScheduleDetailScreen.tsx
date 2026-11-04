/**
 * 桌面组件 · 今日青蛙 / 下一格 详情
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  previewFrogScheduleWidgetProps,
  scheduleFrogScheduleWidgetSync,
} from '@/lib/widgets/frog-schedule-widget-sync';
import {
  getWidgetsSettings,
  patchWidgetsSettings,
  type WidgetsSettings,
} from '@/lib/widgets/widgets-settings';
import type { FrogScheduleWidgetProps } from '@/lib/widgets/frog-schedule-glance';
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

function PreviewCard({
  preview,
  fold,
  medium,
}: {
  preview: FrogScheduleWidgetProps;
  fold: ReturnType<typeof useFoldTheme>['fold'];
  medium: boolean;
}) {
  return (
    <View
      style={[
        styles.preview,
        {
          backgroundColor: fold.ink,
          borderColor: fold.line,
          minHeight: medium ? 148 : 118,
        },
      ]}>
      <View style={styles.previewTop}>
        {preview.kindLabel ? (
          <Text style={[styles.previewKind, { color: preview.kindColor || fold.sage }]}>
            {preview.kindLabel}
          </Text>
        ) : null}
        {preview.timeRange ? (
          <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.55)' }]}>
            {preview.timeRange}
          </Text>
        ) : null}
      </View>
      <Text style={styles.previewTitle} numberOfLines={2}>
        {preview.headline}
      </Text>
      <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.7)' }]}>
        {preview.statusLine}
      </Text>
      {medium && preview.summaryLine ? (
        <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.55)', marginTop: 6 }]}>
          {preview.summaryLine}
        </Text>
      ) : null}
      {medium && preview.upcomingVisible > 0 ? (
        <View style={{ marginTop: 8, gap: 3 }}>
          {preview.upcoming1 ? (
            <Text style={styles.previewLine}>{preview.upcoming1}</Text>
          ) : null}
          {preview.upcoming2 ? (
            <Text style={styles.previewLine}>{preview.upcoming2}</Text>
          ) : null}
          {preview.upcoming3 ? (
            <Text style={styles.previewLine}>{preview.upcoming3}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function WidgetsFrogScheduleDetailScreen() {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<WidgetsSettings | null>(null);
  const [preview, setPreview] = useState<FrogScheduleWidgetProps | null>(null);
  const [medium, setMedium] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [next, snap] = await Promise.all([
        getWidgetsSettings(),
        previewFrogScheduleWidgetProps(),
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

  const applyFrog = useCallback(
    async (patch: Partial<WidgetsSettings['frogSchedule']>) => {
      setBusy(true);
      try {
        const next = await patchWidgetsSettings({ frogSchedule: patch });
        setSettings(next);
        scheduleFrogScheduleWidgetSync('frog-detail');
        setPreview(await previewFrogScheduleWidgetProps());
      } catch (e) {
        toast(toUserMessage(e, '保存失败'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const switchTrack = { false: fold.line2, true: fold.pineButton };
  const deliveryOn = !!(settings?.masterEnabled && settings.frogSchedule.enabled);

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
          <Text style={[styles.title, { color: fold.ink }]}>今日青蛙 / 下一格</Text>
          <Text style={[styles.sub, { color: fold.muted }]}>主屏 · 锁屏 · 灵动岛倒计时</Text>
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
                  小号预览
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
                  中号预览
                </Text>
              </Pressable>
            </View>
            <PreviewCard preview={preview} fold={fold} medium={medium} />
            <Text style={[styles.previewCaption, { color: fold.muted }]}>
              仅预览；需在主屏 / 锁屏添加「今日青蛙」后才会出现
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
                  value={settings.frogSchedule.enabled}
                  disabled={busy}
                  onValueChange={(v) => void applyFrog({ enabled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={40} fromY={10}>
            <WidgetsFormsCard
              fold={fold}
              busId="frog-schedule"
              busy={busy}
              switchTrack={switchTrack}
              homeEnabled={settings.frogSchedule.enabled}
              onHomeChange={(v) => void applyFrog({ enabled: v })}
              lockEnabled={settings.frogSchedule.enabled && !settings.privacy.lockScreenStrict}
              lockHint={
                settings.privacy.lockScreenStrict
                  ? '总览「锁屏一律收紧」已开 · 锁屏仅显示类型摘要'
                  : '与主屏同数据源的轻量变体'
              }
              onLockChange={(v) => {
                if (!v) toast('关闭锁屏请到系统长按移除；此处随业务推送开关');
              }}
              showLiveActivity
              liveActivityEnabled={settings.frogSchedule.liveActivity}
              liveActivityDisabled={!settings.liveActivityEnabled || !settings.masterEnabled}
              liveActivityHint={
                settings.liveActivityEnabled
                  ? '入格开始自动上岛；结束后消失'
                  : '灵动岛总闸已关 · 仍可预配置'
              }
              onLiveActivityChange={(v) => void applyFrog({ liveActivity: v })}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>展示焦点</Text>
              <View style={[styles.segRow, { marginTop: 10 }]}>
                {(
                  [
                    ['active_first', '进行中优先'],
                    ['next_first', '下一场优先'],
                  ] as const
                ).map(([id, label]) => {
                  const on = settings.frogSchedule.focusMode === id;
                  return (
                    <Pressable
                      key={id}
                      onPress={() => void applyFrog({ focusMode: id })}
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
              <Text style={[styles.rowHint, { color: fold.muted, marginTop: 10 }]}>
                中号「接下来」条数
              </Text>
              <View style={[styles.segRow, { marginTop: 8 }]}>
                {([2, 3] as const).map((n) => {
                  const on = settings.frogSchedule.upcomingCount === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => void applyFrog({ upcomingCount: n })}
                      style={[
                        styles.seg,
                        {
                          backgroundColor: on ? fold.pineButton : fold.paper2,
                          borderColor: fold.line,
                        },
                      ]}>
                      <Text style={{ color: on ? '#fff' : fold.ink2, fontWeight: '700', fontSize: 12 }}>
                        {n} 条
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={4} staggerMs={40} fromY={10}>
            <WidgetsClickBehaviorCard
              fold={fold}
              busId="frog-schedule"
              description="打开任务 Tab 日程；进行中的灵动岛会带入格 id。提醒是推，组件是看。"
              reminderHref="/notification-channel/tasks"
              reminderLabel="去配置任务提醒 ›"
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={5} staggerMs={40} fromY={10}>
            <WidgetsHowToAddCard fold={fold} busId="frog-schedule" />
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
  previewTop: { flexDirection: 'row', gap: 8, marginBottom: 6 },
  previewKind: { fontSize: 11, fontWeight: '800' },
  previewTitle: { color: '#F3EFE6', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  previewMuted: { fontSize: 12 },
  previewLine: { color: '#F3EFE6', fontSize: 12 },
  previewCaption: { fontSize: 11, marginTop: 8, marginLeft: 2 },
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
