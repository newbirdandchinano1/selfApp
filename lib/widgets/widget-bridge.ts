/**
 * 桌面组件 / Live Activity 与原生 ExpoWidgets 的桥接：
 * - 启动时预注册 layout（createWidget / createLiveActivity 写 App Group）
 * - 推送后用 getTimeline 校验是否真的落盘
 * - 诊断 App Group（widgetsDirectory == null 即扩展读不到数据）
 */
import { Platform } from 'react-native';

import { isExpoWidgetsNativeAvailable } from '@/lib/widgets/expo-widgets-compat';

export type WidgetBridgeDiagnosis = {
  ok: boolean;
  platform: string;
  appGroupReady: boolean;
  widgetsDirectory: string | null;
  registered: string[];
  sampleTimelineCount: number | null;
  error?: string;
  hint?: string;
};

type WidgetHandle = {
  updateSnapshot: (props: Record<string, unknown>) => void;
  updateTimeline: (entries: { date: Date; props: Record<string, unknown> }[]) => void;
  reload: () => void;
  getTimeline: () => Promise<{ date: Date; props: Record<string, unknown> }[]>;
};

let registered = false;
let registerChain: Promise<void> = Promise.resolve();

function asErrorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** 预 import 全部小组件 + Live Activity，确保 layout 写入 App Group */
export function ensureHomeWidgetsRegistered(): Promise<void> {
  if (Platform.OS !== 'ios') return Promise.resolve();
  if (!isExpoWidgetsNativeAvailable()) return Promise.resolve();
  if (registered) return registerChain;
  registerChain = (async () => {
    await Promise.all([
      import('@/widgets/FrogScheduleWidget'),
      import('@/widgets/HabitsTodayWidget'),
      import('@/widgets/HealthIntakeWidget'),
      import('@/widgets/FinanceGlanceWidget'),
      import('@/widgets/UrgencyWidget'),
      import('@/widgets/FrogScheduleLiveActivity'),
    ]);
    registered = true;
  })().catch((e) => {
    registered = false;
    throw e;
  });
  return registerChain;
}

export async function reloadAllHomeWidgets(): Promise<void> {
  if (Platform.OS !== 'ios' || !isExpoWidgetsNativeAvailable()) return;
  try {
    const { requireOptionalNativeModule } = await import('expo-modules-core');
    const native = requireOptionalNativeModule('ExpoWidgets') as {
      reloadAllWidgets?: () => void;
    } | null;
    native?.reloadAllWidgets?.();
  } catch {
    /* 旧包可能没有该 API */
  }
}

function sanitizeProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined) continue;
    if (typeof v === 'number' && !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * 立刻推一帧 props，并用 getTimeline 确认 App Group 落盘。
 * 失败时抛错（供控制页展示），不再只 __DEV__ console.warn。
 */
export async function pushWidgetSnapshotVerified(
  widget: WidgetHandle,
  props: Record<string, unknown>,
  opts?: { timeline?: { date: Date; props: Record<string, unknown> }[] },
): Promise<void> {
  if (!isExpoWidgetsNativeAvailable()) {
    throw new Error('当前安装包没有 ExpoWidgets 原生模块（常见于 Expo Go）');
  }
  await ensureHomeWidgetsRegistered();
  const clean = sanitizeProps(props);

  if (opts?.timeline && opts.timeline.length > 0) {
    widget.updateTimeline(
      opts.timeline.map((e) => ({
        date: e.date,
        props: sanitizeProps(e.props),
      })),
    );
  } else {
    widget.updateSnapshot(clean);
  }

  try {
    widget.reload();
  } catch {
    /* reload 在部分构建上可能不可用 */
  }

  try {
    await reloadAllHomeWidgets();
  } catch {
    /* ignore */
  }

  let timeline: { date: Date; props: Record<string, unknown> }[] = [];
  try {
    timeline = await widget.getTimeline();
  } catch (e) {
    throw new Error(`组件 timeline 回读失败：${asErrorMessage(e)}`);
  }
  if (!timeline.length) {
    throw new Error(
      '组件 timeline 未写入 App Group（仍会显示「打开 App 后同步…」）。请确认已用含 expo-widgets 的 iOS development/生产包，且 Apple 开发者后台已启用 group.com.myselfManage.appdemo。',
    );
  }
}

/** 只读诊断：不写入探测文案，避免每次进控制页覆盖真实快照 */
export async function diagnoseHomeWidgetBridge(): Promise<WidgetBridgeDiagnosis> {
  const platform = Platform.OS;
  if (platform !== 'ios') {
    return {
      ok: false,
      platform,
      appGroupReady: false,
      widgetsDirectory: null,
      registered: [],
      sampleTimelineCount: null,
      error: '仅 iOS 支持桌面组件 / 灵动岛',
      hint: '请在 iPhone 真机的 development 包上验证。',
    };
  }

  if (!isExpoWidgetsNativeAvailable()) {
    return {
      ok: false,
      platform,
      appGroupReady: false,
      widgetsDirectory: null,
      registered: [],
      sampleTimelineCount: null,
      error: '当前安装包没有 ExpoWidgets 原生模块（常见于 Expo Go）',
      hint: '请使用含 expo-widgets 插件的 iOS development / 正式包，并重新安装。',
    };
  }

  try {
    await ensureHomeWidgetsRegistered();
  } catch (e) {
    return {
      ok: false,
      platform,
      appGroupReady: false,
      widgetsDirectory: null,
      registered: [],
      sampleTimelineCount: null,
      error: `注册组件失败：${asErrorMessage(e)}`,
      hint: '检查 Metro / 原生模块是否包含 expo-widgets。',
    };
  }

  let widgetsDirectory: string | null = null;
  try {
    // 只用 optional native，避免再走 expo-widgets JS 入口（沙盒误入会硬抛）
    const { requireOptionalNativeModule } = await import('expo-modules-core');
    const native = requireOptionalNativeModule('ExpoWidgets') as {
      widgetsDirectory?: string | null;
    } | null;
    widgetsDirectory = native?.widgetsDirectory ?? null;
  } catch (e) {
    return {
      ok: false,
      platform,
      appGroupReady: false,
      widgetsDirectory: null,
      registered: [],
      sampleTimelineCount: null,
      error: `读取 ExpoWidgets 失败：${asErrorMessage(e)}`,
      hint: 'Expo Go 不支持；请重打含 widgets 插件的 iOS 包。',
    };
  }

  const appGroupReady = typeof widgetsDirectory === 'string' && widgetsDirectory.length > 0;
  const registered = [
    'FrogScheduleWidget',
    'HabitsTodayWidget',
    'HealthIntakeWidget',
    'FinanceGlanceWidget',
    'UrgencyWidget',
    'FrogScheduleLiveActivity',
  ];

  let sampleTimelineCount: number | null = null;
  let error: string | undefined;
  if (!appGroupReady) {
    error =
      'App Group 未就绪（widgetsDirectory 为空）。主 App 与小组件扩展无法共享数据，桌面会一直停在「打开 App 后同步…」。';
  } else {
    try {
      const Frog = (await import('@/widgets/FrogScheduleWidget')).default as unknown as WidgetHandle;
      const tl = await Frog.getTimeline();
      sampleTimelineCount = tl.length;
      // timeline 为空只表示尚未成功推送，不算桥接损坏；由「立即刷新」再验证写入
    } catch (e) {
      error = `读取 timeline 失败：${asErrorMessage(e)}`;
    }
  }

  return {
    ok: appGroupReady && !error,
    platform,
    appGroupReady,
    widgetsDirectory,
    registered,
    sampleTimelineCount,
    error,
    hint: error
      ? '开发者后台为 App ID 与 ExpoWidgetsTarget 勾选 App Group：group.com.myselfManage.appdemo，然后 npx expo prebuild --clean 并重装。'
      : undefined,
  };
}
