/** 一并刷新已落地的桌面组件（青蛙 + 习惯 + 健康 + 财务 + 紧急度） */
import { Platform } from 'react-native';

import { isExpoWidgetsNativeAvailable } from '@/lib/widgets/expo-widgets-compat';
import { scheduleFinanceGlanceWidgetSync } from '@/lib/widgets/finance-glance-widget-sync';
import { scheduleFrogScheduleWidgetSync } from '@/lib/widgets/frog-schedule-widget-sync';
import { scheduleHabitsTodayWidgetSync } from '@/lib/widgets/habits-today-widget-sync';
import { scheduleHealthIntakeWidgetSync } from '@/lib/widgets/health-intake-widget-sync';
import { scheduleUrgencyWidgetSync } from '@/lib/widgets/urgency-widget-sync';
import { ensureHomeWidgetsRegistered } from '@/lib/widgets/widget-bridge';

export function scheduleAllHomeWidgetsSync(reason: string): void {
  if (Platform.OS !== 'ios') return;
  // Expo Go 等沙盒无原生 ExpoWidgets，跳过推送避免无意义查询与控制台噪音
  if (!isExpoWidgetsNativeAvailable()) return;
  void ensureHomeWidgetsRegistered()
    .then(() => {
      scheduleFrogScheduleWidgetSync(reason);
      scheduleHabitsTodayWidgetSync(reason);
      scheduleHealthIntakeWidgetSync(reason);
      scheduleFinanceGlanceWidgetSync(reason);
      scheduleUrgencyWidgetSync(reason);
    })
    .catch((e) => {
      console.warn('[widgets] register before sync failed', reason, e);
    });
}

/** 控制页「立即刷新」：先诊断 App Group，再推送，再确认 timeline 已落盘 */
export async function flushAllHomeWidgetsSync(reason: string): Promise<{
  ok: boolean;
  error?: string;
  hint?: string;
}> {
  if (Platform.OS !== 'ios') {
    return { ok: false, error: '仅 iOS 支持桌面组件' };
  }
  if (!isExpoWidgetsNativeAvailable()) {
    return {
      ok: false,
      error: '当前安装包没有 ExpoWidgets 原生模块（常见于 Expo Go）',
      hint: '请使用含 expo-widgets 插件的 iOS development / 正式包。',
    };
  }

  const { diagnoseHomeWidgetBridge, ensureHomeWidgetsRegistered: ensureReg } = await import(
    '@/lib/widgets/widget-bridge'
  );
  const diag = await diagnoseHomeWidgetBridge();
  if (!diag.ok) {
    return { ok: false, error: diag.error, hint: diag.hint };
  }

  await ensureReg();
  scheduleAllHomeWidgetsSync(reason);
  // 等各 syncChain 写完 App Group
  await new Promise((r) => setTimeout(r, 1200));

  try {
    const Frog = (await import('@/widgets/FrogScheduleWidget')).default;
    const tl = await Frog.getTimeline();
    if (!tl.length) {
      return {
        ok: false,
        error:
          '推送后 timeline 仍为空，桌面会停在「打开 App 后同步…」。多半是 App Group 未生效或需重装含补丁的 iOS 包。',
        hint: '确认 group.com.myselfManage.appdemo 已勾选，然后 clean prebuild + 重装后再试。',
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `刷新后回读失败：${msg}` };
  }

  return { ok: true };
}
