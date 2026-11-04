/**
 * 桌面组件 · 财务一眼账 详情
 */
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui';
import { useFoldTheme } from '@/constants/review-fold-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import type {
  FinanceGlanceMaskMode,
  FinanceGlancePrimaryMetric,
  FinanceGlanceWidgetProps,
} from '@/lib/widgets/finance-glance';
import {
  previewFinanceGlanceWidgetProps,
  scheduleFinanceGlanceWidgetSync,
} from '@/lib/widgets/finance-glance-widget-sync';
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
  preview: FinanceGlanceWidgetProps;
  fold: ReturnType<typeof useFoldTheme>['fold'];
  medium: boolean;
}) {
  const accent =
    preview.budgetAccentCode >= 2
      ? '#E08A7A'
      : preview.budgetAccentCode === 1
        ? '#E0B35A'
        : '#8FBF9F';
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
      <Text style={[styles.previewKind, { color: accent }]}>财务一眼</Text>
      <Text style={styles.previewPrimary}>{preview.primaryLine}</Text>
      <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.7)' }]}>
        {preview.secondaryLine}
      </Text>
      {medium && preview.hasNext === 1 && preview.nextLine ? (
        <Text style={[styles.previewNext, { marginTop: 8 }]}>{preview.nextLine}</Text>
      ) : null}
      <Text style={[styles.previewMuted, { color: 'rgba(243,239,230,0.55)', marginTop: 8 }]}>
        {preview.statusLine}
      </Text>
    </View>
  );
}

export default function WidgetsFinanceGlanceDetailScreen() {
  const router = useRouter();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<WidgetsSettings | null>(null);
  const [preview, setPreview] = useState<FinanceGlanceWidgetProps | null>(null);
  const [medium, setMedium] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [next, snap] = await Promise.all([
        getWidgetsSettings(),
        previewFinanceGlanceWidgetProps(),
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

  const applyFinance = useCallback(
    async (patch: Parameters<typeof patchWidgetsSettings>[0]['financeGlance']) => {
      setBusy(true);
      try {
        const next = await patchWidgetsSettings({ financeGlance: patch });
        setSettings(next);
        scheduleFinanceGlanceWidgetSync('finance-detail');
        setPreview(await previewFinanceGlanceWidgetProps());
      } catch (e) {
        toast(toUserMessage(e, '保存失败'));
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const applyPrivacy = useCallback(async (financeMaskDefault: boolean) => {
    setBusy(true);
    try {
      const next = await patchWidgetsSettings({ privacy: { financeMaskDefault } });
      setSettings(next);
      scheduleFinanceGlanceWidgetSync('finance-privacy');
      setPreview(await previewFinanceGlanceWidgetProps());
    } catch (e) {
      toast(toUserMessage(e, '保存失败'));
    } finally {
      setBusy(false);
    }
  }, []);

  const switchTrack = { false: fold.line2, true: fold.pineButton };
  const deliveryOn = !!(settings?.masterEnabled && settings.financeGlance.enabled);

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
          <Text style={[styles.title, { color: fold.ink }]}>财务一眼账</Text>
          <Text style={[styles.sub, { color: fold.muted }]}>今日已花 · 预算剩余 · 下一笔</Text>
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
              仅预览；主屏添加「财务一眼」后生效。点按打开财务首页。
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
                  value={settings.financeGlance.enabled}
                  disabled={busy}
                  onValueChange={(v) => void applyFinance({ enabled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={40} fromY={10}>
            <WidgetsFormsCard
              fold={fold}
              busId="finance-glance"
              busy={busy}
              switchTrack={switchTrack}
              homeEnabled={settings.financeGlance.enabled}
              onHomeChange={(v) => void applyFinance({ enabled: v })}
              lockEnabled={
                settings.financeGlance.allowLockScreen && !settings.privacy.lockScreenStrict
              }
              lockDisabled={settings.privacy.lockScreenStrict}
              lockHint={
                settings.privacy.lockScreenStrict
                  ? '总览「锁屏一律收紧」已开 · 财务锁屏强制隐藏'
                  : '默认关；开启后锁屏仍强制脱敏金额'
              }
              onLockChange={(v) => void applyFinance({ allowLockScreen: v })}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>主数字</Text>
              <View style={[styles.segRow, { marginTop: 10 }]}>
                {(
                  [
                    ['today_spent', '今日已花'],
                    ['budget_remaining', '预算剩余%'],
                  ] as const
                ).map(([key, label]) => {
                  const on = settings.financeGlance.primaryMetric === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() =>
                        void applyFinance({
                          primaryMetric: key as FinanceGlancePrimaryMetric,
                        })
                      }
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
                另一项作副行；中号可同时展示下一笔定时支出。
              </Text>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={4} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>显示下一笔定时支出</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    已入账槽位会自动跳过
                  </Text>
                </View>
                <Switch
                  value={settings.financeGlance.showNextScheduled}
                  disabled={busy}
                  onValueChange={(v) => void applyFinance({ showNextScheduled: v })}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={5} staggerMs={40} fromY={10}>
            <View style={[styles.card, { backgroundColor: fold.card, borderColor: fold.line }]}>
              <Text style={[styles.rowTitle, { color: fold.ink }]}>金额脱敏</Text>
              <View style={[styles.segCol, { marginTop: 10 }]}>
                {(
                  [
                    ['follow', '跟随全局'],
                    ['force_mask', '强制脱敏'],
                    ['plain', '明文'],
                  ] as const
                ).map(([key, label]) => {
                  const on = settings.financeGlance.maskMode === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => {
                        if (key === 'plain' && settings.financeGlance.maskMode !== 'plain') {
                          toast('明文将在主屏显示具体金额，请确认环境安全');
                        }
                        void applyFinance({ maskMode: key as FinanceGlanceMaskMode });
                      }}
                      style={[
                        styles.segFull,
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
              <View style={[styles.divider, { backgroundColor: fold.line }]} />
              <View style={styles.toggleRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: fold.ink }]}>全局默认脱敏</Text>
                  <Text style={[styles.rowHint, { color: fold.muted }]}>
                    「跟随全局」时生效；第一期默认关
                  </Text>
                </View>
                <Switch
                  value={settings.privacy.financeMaskDefault}
                  disabled={busy}
                  onValueChange={(v) => void applyPrivacy(v)}
                  trackColor={switchTrack}
                  thumbColor="#ffffff"
                />
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={6} staggerMs={40} fromY={10}>
            <WidgetsClickBehaviorCard
              fold={fold}
              busId="finance-glance"
              description="点按打开财务首页；预算阈值与定时支出提醒仍走「提醒设置 · 财务」（推与看分工）。"
              reminderHref="/notification-channel/finance"
              reminderLabel="去配置财务提醒 ›"
            />
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={7} staggerMs={40} fromY={10}>
            <WidgetsHowToAddCard fold={fold} busId="finance-glance" />
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
  segCol: { gap: 8 },
  seg: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segFull: {
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
  previewPrimary: { color: '#F3EFE6', fontSize: 22, fontWeight: '700', marginTop: 6 },
  previewNext: { color: '#F3EFE6', fontSize: 12 },
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
