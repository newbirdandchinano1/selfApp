/**
 * 桌面组件 · 小习惯今日进度 详情
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import type { HabitsTodayWidgetProps } from '@/lib/widgets/habits-today-glance';
import {
  previewHabitsTodayWidgetProps,
  scheduleHabitsTodayWidgetSync,
} from '@/lib/widgets/habits-today-widget-sync';
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

function PreviewCard({
  preview,
  fold,
  medium,
}: {
  preview: HabitsTodayWidgetProps;
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
          minHeight: medium ? 140 : 110,
        },
      ]}>
      <View style={styles.previewTop}>
        <Text style={[styles.previewKind, { color: preview.allDone ? '#8FBF9F' : '#E0B35A' }]}>
          今日习惯
        </Text>
        <Text style={styles.previewProgress}>{preview.progressLine}</Text>
      </View>
      <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.7)' }]}>
        {preview.statusLine}
      </Text>
      {medium && preview.allDone === 0 && preview.pendingVisible > 0 ? (
        <View style={{ marginTop: 8, gap: 3 }}>
          {preview.item1 ? <Text style={styles.previewLine}>{preview.item1}</Text> : null}
          {preview.item2 ? <Text style={styles.previewLine}>{preview.item2}</Text> : null}
          {preview.item3 ? <Text style={styles.previewLine}>{preview.item3}</Text> : null}
          {preview.moreLine ? (
            <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.5)' }]}>
              {preview.moreLine}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export default function WidgetsHabitsTodayDetailScreen() {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<WidgetsSettings | null>(null);
  const [preview, setPreview] = useState<HabitsTodayWidgetProps | null>(null);
  const [medium, setMedium] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [next, snap] = await Promise.all([
        getWidgetsSettings(),
        previewHabitsTodayWidgetProps(),
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

  const applyHabits = useCallback(
    async (patch: Parameters<typeof patchWidgetsSettings>[0]['habitsToday']) => {
      setBusy(true);
      try {
        const next = await patchWidgetsSettings({ habitsToday: patch });
        setSettings(next);
        scheduleHabitsTodayWidgetSync('habits-detail');
        setPreview(await previewHabitsTodayWidgetProps());
      } catch (e) {
        toast(toUserMessage(e, '保存失败'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const switchTrack = { false: fold.line2, true: fold.pineButton };
  const deliveryOn = !!(settings?.masterEnabled && settings.habitsToday.enabled);

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
          <Text style={[styles.title, { color: fold.ink }]}>小习惯今日进度</Text>
          <Text style={[styles.sub, { color: fold.muted }]}>主屏 · 锁屏进度卡</Text>
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
              仅预览；主屏添加「今日习惯」后生效。组件内不提供打卡，点按打开任务页。
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
                  value={settings.habitsToday.enabled}
                  disabled={busy}
                  onValueChange={(v) => void applyHabits({ enabled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={40} fromY={10}>
            <WidgetsFormsCard
              fold={fold}
              busId="habits-today"
              busy={busy}
              switchTrack={switchTrack}
              homeEnabled={settings.habitsToday.enabled}
              onHomeChange={(v) => void applyHabits({ enabled: v })}
              lockEnabled={settings.habitsToday.enabled}
              lockHint="锁屏仅展示完成数 / 总数"
              onLockChange={(v) => {
                if (!v) toast('关闭锁屏请到系统长按移除；此处随业务推送开关');
              }}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>纳入类型</Text>
              {(
                [
                  ['build', '养成', settings.habitsToday.includeKinds.build],
                  ['break', '戒除', settings.habitsToday.includeKinds.break],
                  ['task', '周期配额', settings.habitsToday.includeKinds.task],
                ] as const
              ).map(([key, label, value], idx) => (
                <View key={key}>
                  {idx > 0 ? (
                    <View style={[styles.divider, { backgroundColor: fold.line }]} />
                  ) : (
                    <View style={{ height: 8 }} />
                  )}
                  <View style={styles.toggleRow}>
                    <Text style={[styles.rowTitle, { color: fold.ink, flex: 1 }]}>{label}</Text>
                    <Switch
                      value={value}
                      disabled={busy}
                      onValueChange={(v) =>
                        void applyHabits({ includeKinds: { [key]: v } })
                      }
                      trackColor={switchTrack}
                      thumbColor="#ffffff"
                    />
                  </View>
                </View>
              ))}
              <Text style={[styles.rowHint, { color: fold.muted, marginTop: 8 }]}>
                默认养成 + 戒除；周期配额可按需打开
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={4} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>未完成列表条数</Text>
              <View style={[styles.segRow, { marginTop: 10 }]}>
                {([2, 3] as const).map((n) => {
                  const on = settings.habitsToday.listLimit === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => void applyHabits({ listLimit: n })}
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

          <FoldRiseIn animate={motionOn} index={5} staggerMs={40} fromY={10}>
            <WidgetsClickBehaviorCard
              fold={fold}
              busId="habits-today"
              description="点按打开任务页打卡；提醒仍走「提醒设置 · 任务」习惯频道（推与看分工）。"
              reminderHref="/notification-channel/tasks"
              reminderLabel="去配置习惯提醒 ›"
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={6} staggerMs={40} fromY={10}>
            <WidgetsHowToAddCard fold={fold} busId="habits-today" />
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
  previewTop: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 6 },
  previewKind: { fontSize: 11, fontWeight: '800' },
  previewProgress: { color: '#F3EFE6', fontSize: 22, fontWeight: '700' },
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
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, marginTop: 3, lineHeight: 17 },
});
