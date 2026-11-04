/**
 * 桌面组件 · 待办 / 截止紧急度 详情
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import type {
  UrgencyDueSoonWindowDays,
  UrgencyWidgetProps,
} from '@/lib/widgets/urgency-glance';
import {
  previewUrgencyWidgetProps,
  scheduleUrgencyWidgetSync,
} from '@/lib/widgets/urgency-widget-sync';
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
  preview: UrgencyWidgetProps;
  fold: ReturnType<typeof useFoldTheme>['fold'];
  medium: boolean;
}) {
  const accent = preview.isCalm === 1 ? '#8FBF9F' : preview.overdueCount > 0 ? '#E08A7A' : '#E0B35A';
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
      <Text style={[styles.previewKind, { color: accent }]}>紧急度</Text>
      <Text style={styles.previewPrimary}>{preview.countsLine}</Text>
      <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.7)', marginTop: 6 }]}>
        {preview.statusLine}
      </Text>
      {medium && preview.showTopTitle === 1 && preview.topTitle ? (
        <Text style={[styles.previewTop, { marginTop: 8 }]}>{preview.topTitle}</Text>
      ) : null}
    </View>
  );
}

export default function WidgetsUrgencyDetailScreen() {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<WidgetsSettings | null>(null);
  const [preview, setPreview] = useState<UrgencyWidgetProps | null>(null);
  const [medium, setMedium] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [next, snap] = await Promise.all([
        getWidgetsSettings(),
        previewUrgencyWidgetProps(),
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

  const applyUrgency = useCallback(
    async (patch: Parameters<typeof patchWidgetsSettings>[0]['urgency']) => {
      setBusy(true);
      try {
        const next = await patchWidgetsSettings({ urgency: patch });
        setSettings(next);
        scheduleUrgencyWidgetSync('urgency-detail');
        setPreview(await previewUrgencyWidgetProps());
      } catch (e) {
        toast(toUserMessage(e, '保存失败'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const switchTrack = { false: fold.line2, true: fold.pineButton };
  const deliveryOn = !!(settings?.masterEnabled && settings.urgency.enabled);

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
          <Text style={[styles.title, { color: fold.ink }]}>待办 / 截止紧急度</Text>
          <Text style={[styles.sub, { color: fold.muted }]}>逾期 · 今日截止 · 临期项目</Text>
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
              仅预览；主屏添加「紧急度」后生效。点按打开任务 Tab。
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
                  value={settings.urgency.enabled}
                  disabled={busy}
                  onValueChange={(v) => void applyUrgency({ enabled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={40} fromY={10}>
            <WidgetsFormsCard
              fold={fold}
              busId="urgency"
              busy={busy}
              switchTrack={switchTrack}
              homeEnabled={settings.urgency.enabled}
              onHomeChange={(v) => void applyUrgency({ enabled: v })}
              lockEnabled={settings.urgency.enabled}
              lockHint="锁屏仅逾期 / 今日两数"
              onLockChange={(v) => {
                if (!v) toast('关闭锁屏请到系统长按移除；此处随业务推送开关');
              }}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>计数开关</Text>
              <View style={[styles.toggleRow, { marginTop: 8 }]}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink, fontSize: 14 }]}>逾期</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    截止日早于今日的未完成待办
                  </Text>
                </View>
                <Switch
                  value={settings.urgency.showOverdue}
                  disabled={busy}
                  onValueChange={(v) => void applyUrgency({ showOverdue: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={[styles.divider, { backgroundColor: fold.line }]} />
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink, fontSize: 14 }]}>今日截止</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    截止日为逻辑今日的未完成待办
                  </Text>
                </View>
                <Switch
                  value={settings.urgency.showDueToday}
                  disabled={busy}
                  onValueChange={(v) => void applyUrgency({ showDueToday: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={[styles.divider, { backgroundColor: fold.line }]} />
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink, fontSize: 14 }]}>临期项目</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    活跃项目截止日落入临期窗口
                  </Text>
                </View>
                <Switch
                  value={settings.urgency.showDueSoonProjects}
                  disabled={busy}
                  onValueChange={(v) => void applyUrgency({ showDueSoonProjects: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={4} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>临期窗口</Text>
              <Text style={[styles.rowHint, { color: fold.muted, marginTop: 4 }]}>
                只影响组件计数；可与提醒设置「自动临期」对齐
              </Text>
              <View style={[styles.segRow, { marginTop: 10 }]}>
                {([1, 2, 3] as UrgencyDueSoonWindowDays[]).map((days) => {
                  const on = settings.urgency.dueSoonWindowDays === days;
                  return (
                    <Pressable
                      key={days}
                      onPress={() => void applyUrgency({ dueSoonWindowDays: days })}
                      style={[
                        styles.seg,
                        {
                          backgroundColor: on ? fold.pineButton : fold.paper2,
                          borderColor: fold.line,
                        },
                      ]}>
                      <Text style={{ color: on ? '#fff' : fold.ink2, fontWeight: '700', fontSize: 12 }}>
                        {days} 天
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={5} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>附带最高优先级标题</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    中号更易扫到；全 0 时显示「{settings.urgency.emptyLabel}」
                  </Text>
                </View>
                <Switch
                  value={settings.urgency.showTopTitle}
                  disabled={busy}
                  onValueChange={(v) => void applyUrgency({ showTopTitle: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={6} staggerMs={40} fromY={10}>
            <WidgetsClickBehaviorCard
              fold={fold}
              busId="urgency"
              description="点按打开任务 Tab；截止 / 推进提醒仍走「提醒设置 · 任务」（推与看分工）。"
              reminderHref="/notification-channel/tasks"
              reminderLabel="去配置任务提醒 ›"
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={7} staggerMs={40} fromY={10}>
            <WidgetsHowToAddCard fold={fold} busId="urgency" />
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
  previewPrimary: { color: '#F3EFE6', fontSize: 20, fontWeight: '700', marginTop: 6 },
  previewTop: { color: '#F3EFE6', fontSize: 13, fontWeight: '600' },
  previewMuted: { fontSize: 12 },
  previewCaption: { fontSize: 11, marginTop: 8, marginLeft: 2 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 10 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, marginTop: 3, lineHeight: 17 },
});
