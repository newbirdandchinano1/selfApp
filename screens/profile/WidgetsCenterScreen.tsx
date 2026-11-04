/**
 * 桌面与状态栏 · 控制中心总览（第 5 节）：总闸、五条业务、隐私与添加引导。
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import {
  getNotificationPermissionSnapshot,
  openSystemNotificationSettings,
  requestAppNotificationPermission,
  type NotificationPermissionSnapshot,
} from '@/lib/notification-center';
import { previewFinanceGlanceWidgetProps } from '@/lib/widgets/finance-glance-widget-sync';
import { previewFrogScheduleWidgetProps } from '@/lib/widgets/frog-schedule-widget-sync';
import { previewHabitsTodayWidgetProps } from '@/lib/widgets/habits-today-widget-sync';
import { previewHealthIntakeWidgetProps } from '@/lib/widgets/health-intake-widget-sync';
import { scheduleAllHomeWidgetsSync } from '@/lib/widgets/schedule-all-widget-sync';
import { previewUrgencyWidgetProps } from '@/lib/widgets/urgency-widget-sync';
import { WIDGET_DISPLAY_NAMES, widgetHowToAddSteps } from '@/lib/widgets/widget-catalog';
import {
  getWidgetsSettings,
  patchWidgetsSettings,
  type WidgetsSettings,
} from '@/lib/widgets/widgets-settings';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function summarizeHealthPreview(
  enabled: boolean,
  preview: Awaited<ReturnType<typeof previewHealthIntakeWidgetProps>>,
): string {
  if (!enabled) return '已关闭推送';
  if (preview.hasItems === 0) return preview.statusLine;
  const ring =
    preview.ringCount >= 2 && preview.ring2Label
      ? `${preview.ring1Label} ${Math.round(preview.ring1Percent)}% · ${preview.ring2Label} ${Math.round(preview.ring2Percent)}%`
      : `${preview.ring1Label} ${Math.round(preview.ring1Percent)}%`;
  return `${ring} · ${preview.statusLine}`;
}

function summarizeFinancePreview(
  enabled: boolean,
  preview: Awaited<ReturnType<typeof previewFinanceGlanceWidgetProps>>,
): string {
  if (!enabled) return '已关闭推送';
  return `${preview.primaryLine} · ${preview.secondaryLine}`;
}

function summarizeUrgencyPreview(
  enabled: boolean,
  preview: Awaited<ReturnType<typeof previewUrgencyWidgetProps>>,
): string {
  if (!enabled) return '已关闭推送';
  return preview.isCalm === 1
    ? preview.statusLine
    : `${preview.countsLine}${preview.topTitle ? ` · ${preview.topTitle}` : ''}`;
}

export default function WidgetsCenterScreen() {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<WidgetsSettings | null>(null);
  const [frogSummary, setFrogSummary] = useState('加载中…');
  const [habitsSummary, setHabitsSummary] = useState('加载中…');
  const [healthSummary, setHealthSummary] = useState('加载中…');
  const [financeSummary, setFinanceSummary] = useState('加载中…');
  const [urgencySummary, setUrgencySummary] = useState('加载中…');
  const [permission, setPermission] = useState<NotificationPermissionSnapshot | null>(null);
  const [howToOpen, setHowToOpen] = useState(false);

  const applySummaries = useCallback(async (next: WidgetsSettings) => {
    const [frogPreview, habitsPreview, healthPreview, financePreview, urgencyPreview] =
      await Promise.all([
        previewFrogScheduleWidgetProps(),
        previewHabitsTodayWidgetProps(),
        previewHealthIntakeWidgetProps(),
        previewFinanceGlanceWidgetProps(),
        previewUrgencyWidgetProps(),
      ]);
    setFrogSummary(
      next.masterEnabled && next.frogSchedule.enabled
        ? frogPreview.statusLine
          ? `${frogPreview.headline} · ${frogPreview.statusLine}`
          : frogPreview.headline
        : '已关闭推送',
    );
    setHabitsSummary(
      next.masterEnabled && next.habitsToday.enabled
        ? `${habitsPreview.progressLine} · ${habitsPreview.statusLine}`
        : '已关闭推送',
    );
    setHealthSummary(
      summarizeHealthPreview(next.masterEnabled && next.healthIntake.enabled, healthPreview),
    );
    setFinanceSummary(
      summarizeFinancePreview(
        next.masterEnabled && next.financeGlance.enabled,
        financePreview,
      ),
    );
    setUrgencySummary(
      summarizeUrgencyPreview(next.masterEnabled && next.urgency.enabled, urgencyPreview),
    );
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [next, perm] = await Promise.all([
        getWidgetsSettings(),
        getNotificationPermissionSnapshot(),
      ]);
      setSettings(next);
      setPermission(perm);
      await applySummaries(next);
    } catch (e) {
      toast(toUserMessage(e, '加载组件设置失败'));
    } finally {
      setLoading(false);
    }
  }, [applySummaries]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const apply = useCallback(
    async (patch: Parameters<typeof patchWidgetsSettings>[0]) => {
      setBusy(true);
      try {
        const next = await patchWidgetsSettings(patch);
        setSettings(next);
        scheduleAllHomeWidgetsSync('settings');
        await applySummaries(next);
      } catch (e) {
        toast(toUserMessage(e, '保存失败'));
      } finally {
        setBusy(false);
      }
    },
    [applySummaries],
  );

  const switchTrack = { false: fold.line2, true: fold.pineButton };
  const notifGranted = permission?.status === 'granted';
  const namesLine = Object.values(WIDGET_DISPLAY_NAMES).join('」「');

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
          <Text style={[styles.title, { color: fold.ink }]}>桌面与状态栏</Text>
          <Text style={[styles.sub, { color: fold.muted }]}>主屏小组件 · 锁屏 · 灵动岛</Text>
        </View>
        <View
          style={[
            styles.statusTag,
            {
              backgroundColor: settings?.masterEnabled ? fold.sage2 : fold.paper2,
            },
          ]}>
          <Text
            style={{
              fontSize: 10,
              fontWeight: '700',
              color: settings?.masterEnabled ? '#36594D' : fold.muted,
            }}>
            {settings?.masterEnabled ? '推送开' : '已暂停'}
          </Text>
        </View>
      </View>

      {loading || !settings ? (
        <View style={styles.centered}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {Platform.OS !== 'ios' ? (
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>仅支持 iOS</Text>
              <Text style={[styles.rowHint, { color: fold.muted }]}>
                本方案只做 iPhone 主屏 / 锁屏小组件与灵动岛；可先在此预配置，装到 iOS 真机后生效。
              </Text>
            </View>
          ) : null}

          <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={12}>
            <Text style={[styles.sectionLabel, { color: fold.muted }]}>总闸与权限</Text>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>启用组件数据推送</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    关则各业务停止更新；已钉在主屏的组件保留上次缓存，并显示暂停态
                  </Text>
                </View>
                <Switch
                  value={settings.masterEnabled}
                  disabled={busy}
                  onValueChange={(v) => void apply({ masterEnabled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={[styles.divider, { backgroundColor: fold.line }]} />
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>灵动岛 / Live Activity</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    总闸；与「青蛙入格上岛」为与关系
                  </Text>
                </View>
                <Switch
                  value={settings.liveActivityEnabled}
                  disabled={busy || !settings.masterEnabled}
                  onValueChange={(v) => void apply({ liveActivityEnabled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              {!notifGranted ? (
                <>
                  <View style={[styles.divider, { backgroundColor: fold.line }]} />
                  <View style={styles.permRow}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={[styles.rowTitle, { color: fold.ink }]}>系统通知权限</Text>
                      <Text style={[styles.rowHint, { color: fold.muted }]}>
                        未开启时灵动岛可能受限
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => {
                        void (async () => {
                          const perm = await requestAppNotificationPermission();
                          setPermission(perm);
                          if (perm.status !== 'granted') await openSystemNotificationSettings();
                        })();
                      }}
                      style={({ pressed }) => [
                        styles.pillBtn,
                        {
                          borderColor: fold.line,
                          backgroundColor: fold.paper2,
                          opacity: pressed ? 0.86 : 1,
                        },
                      ]}>
                      <Text style={{ color: fold.ink2, fontWeight: '700', fontSize: 12 }}>
                        去系统设置
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : null}
            </View>

            <View
              style={[
                styles.card,
                { backgroundColor: fold.card, borderColor: fold.line, marginTop: 10 },
              ]}>
              <Pressable
                onPress={() => setHowToOpen((v) => !v)}
                style={styles.howToHead}
                accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>如何添加小组件</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    主屏长按 → 编辑 → 添加；锁屏编辑添加工具
                  </Text>
                </View>
                <Text style={{ color: fold.muted, fontSize: 16 }}>{howToOpen ? '▾' : '›'}</Text>
              </Pressable>
              {howToOpen ? (
                <Text style={[styles.rowHint, { color: fold.muted, marginTop: 8 }]}>
                  {widgetHowToAddSteps('今日青蛙')}
                  {'\n\n'}
                  可搜索：「{namesLine}」。
                  {'\n'}
                  配置好后，请到主屏或锁屏添加「小郑的自我修养」小组件（App 无法一键安装）。
                </Text>
              ) : null}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} staggerMs={45} fromY={12}>
            <Text style={[styles.sectionLabel, { color: fold.muted }]}>业务组件</Text>
            <Pressable
              onPress={() => router.push('/widgets-center/frog-schedule' as never)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: fold.card, borderColor: fold.line },
                pressed && { opacity: 0.92 },
              ]}>
              <View style={styles.bizRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>今日青蛙 / 下一格</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]} numberOfLines={2}>
                    {frogSummary}
                  </Text>
                  <View style={styles.tags}>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      主屏
                    </Text>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      锁屏
                    </Text>
                    {settings.frogSchedule.liveActivity ? (
                      <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                        岛
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Switch
                  value={settings.frogSchedule.enabled}
                  disabled={busy || !settings.masterEnabled}
                  onValueChange={(v) => void apply({ frogSchedule: { enabled: v } })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <Text style={[styles.chevronHint, { color: fold.muted }]}>点按进入详情 ›</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/widgets-center/habits-today' as never)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: fold.card, borderColor: fold.line, marginTop: 10 },
                pressed && { opacity: 0.92 },
              ]}>
              <View style={styles.bizRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>小习惯今日进度</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]} numberOfLines={2}>
                    {habitsSummary}
                  </Text>
                  <View style={styles.tags}>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      主屏
                    </Text>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      锁屏
                    </Text>
                  </View>
                </View>
                <Switch
                  value={settings.habitsToday.enabled}
                  disabled={busy || !settings.masterEnabled}
                  onValueChange={(v) => void apply({ habitsToday: { enabled: v } })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <Text style={[styles.chevronHint, { color: fold.muted }]}>点按进入详情 ›</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/widgets-center/health-intake' as never)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: fold.card, borderColor: fold.line, marginTop: 10 },
                pressed && { opacity: 0.92 },
              ]}>
              <View style={styles.bizRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>健康摄入缺口</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]} numberOfLines={2}>
                    {healthSummary}
                  </Text>
                  <View style={styles.tags}>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      主屏
                    </Text>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      锁屏
                    </Text>
                  </View>
                </View>
                <Switch
                  value={settings.healthIntake.enabled}
                  disabled={busy || !settings.masterEnabled}
                  onValueChange={(v) => void apply({ healthIntake: { enabled: v } })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <Text style={[styles.chevronHint, { color: fold.muted }]}>点按进入详情 ›</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/widgets-center/finance-glance' as never)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: fold.card, borderColor: fold.line, marginTop: 10 },
                pressed && { opacity: 0.92 },
              ]}>
              <View style={styles.bizRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>财务一眼账</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]} numberOfLines={2}>
                    {financeSummary}
                  </Text>
                  <View style={styles.tags}>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      主屏
                    </Text>
                    {settings.financeGlance.allowLockScreen &&
                    !settings.privacy.lockScreenStrict ? (
                      <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                        锁屏
                      </Text>
                    ) : null}
                  </View>
                </View>
                <Switch
                  value={settings.financeGlance.enabled}
                  disabled={busy || !settings.masterEnabled}
                  onValueChange={(v) => void apply({ financeGlance: { enabled: v } })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <Text style={[styles.chevronHint, { color: fold.muted }]}>点按进入详情 ›</Text>
            </Pressable>

            <Pressable
              onPress={() => router.push('/widgets-center/urgency' as never)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: fold.card, borderColor: fold.line, marginTop: 10 },
                pressed && { opacity: 0.92 },
              ]}>
              <View style={styles.bizRow}>
                <View style={{ flex: 1, paddingRight: 8 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>待办 / 截止紧急度</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]} numberOfLines={2}>
                    {urgencySummary}
                  </Text>
                  <View style={styles.tags}>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      主屏
                    </Text>
                    <Text style={[styles.tag, { color: fold.pine, backgroundColor: fold.sage2 }]}>
                      锁屏
                    </Text>
                  </View>
                </View>
                <Switch
                  value={settings.urgency.enabled}
                  disabled={busy || !settings.masterEnabled}
                  onValueChange={(v) => void apply({ urgency: { enabled: v } })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <Text style={[styles.chevronHint, { color: fold.muted }]}>点按进入详情 ›</Text>
            </Pressable>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={45} fromY={12}>
            <Text style={[styles.sectionLabel, { color: fold.muted }]}>隐私与全局偏好</Text>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>财务金额脱敏（全局默认）</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    开 → 财务组件默认 *** / 仅进度；单业务可再覆盖
                  </Text>
                </View>
                <Switch
                  value={settings.privacy.financeMaskDefault}
                  disabled={busy}
                  onValueChange={(v) => void apply({ privacy: { financeMaskDefault: v } })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={[styles.divider, { backgroundColor: fold.line }]} />
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>锁屏一律收紧</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    开 → 锁屏不外露金额与具体待办标题（财务锁屏强制隐藏）
                  </Text>
                </View>
                <Switch
                  value={settings.privacy.lockScreenStrict}
                  disabled={busy}
                  onValueChange={(v) => void apply({ privacy: { lockScreenStrict: v } })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
              <View style={[styles.divider, { backgroundColor: fold.line }]} />
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>预览使用真实数据</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    关则控制页预览用占位文案（演示 / 录屏）
                  </Text>
                </View>
                <Switch
                  value={settings.privacy.previewUseRealData}
                  disabled={busy}
                  onValueChange={(v) => void apply({ privacy: { previewUseRealData: v } })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={45} fromY={12}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>与提醒设置</Text>
              <Text style={[styles.rowHint, { color: fold.muted, marginTop: 6 }]}>
                提醒负责到点推送；组件负责全天可扫。两边设置键互不覆盖。
              </Text>
              <Pressable
                onPress={() => router.push('/messages?tab=settings' as never)}
                style={{ marginTop: 10 }}>
                <Text style={{ color: fold.pine, fontWeight: '700', fontSize: 13 }}>
                  去提醒设置 ›
                </Text>
              </Pressable>
            </View>
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
  statusTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: 14, paddingBottom: 40, gap: 12 },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  permRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
  },
  pillBtn: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  howToHead: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowHint: { fontSize: 12, marginTop: 3, lineHeight: 17 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.4,
    marginBottom: 6,
    marginLeft: 4,
  },
  bizRow: { flexDirection: 'row', alignItems: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  tag: {
    fontSize: 10,
    fontWeight: '700',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  chevronHint: { fontSize: 11, marginTop: 8 },
});
