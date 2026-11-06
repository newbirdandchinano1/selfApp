/**
 * Expo Go / 无 Widget Extension 的沙盒没有原生 ExpoWidgets。
 * 禁止顶层 import 'expo-widgets'（其 .native 入口会 requireNativeModule 硬抛）。
 * 仅在探测到原生模块后再 require；否则返回 no-op stub。
 */
import { requireOptionalNativeModule } from 'expo-modules-core';
import type { ReactNode } from 'react';

/** 精简本地类型，避免对 expo-widgets 产生任何模块依赖（含 type-only）。 */
export type WidgetEnvironment<T extends object | undefined = undefined> = {
  date?: Date;
  widgetFamily?: string;
  colorScheme?: 'light' | 'dark';
  isLuminanceReduced?: boolean;
  widgetRenderingMode?: string;
  showsWidgetLabel?: boolean;
  widgetContentMargins?: {
    top: number;
    bottom: number;
    leading: number;
    trailing: number;
  };
  configuration?: T;
};

export type LiveActivityEnvironment = {
  isLuminanceReduced?: boolean;
  colorScheme?: 'light' | 'dark';
  activityFamily?: string;
};

type WidgetHandle<PropsType extends object = object> = {
  reload: () => void;
  updateTimeline: (entries: { date: Date; props: PropsType }[]) => void;
  updateSnapshot: (props: PropsType) => void;
  getTimeline: () => Promise<{ date: Date; props: PropsType }[]>;
  setConfigurationParameterEnum: (name: string, options?: unknown[]) => void;
};

type LiveActivityHandle<T extends object = object> = {
  getId: () => string;
  update: (props: T, staleDate?: Date) => Promise<void>;
  end: (dismissalPolicy?: unknown, props?: T, contentDate?: Date) => Promise<void>;
  getPushToken: () => Promise<string | null>;
  addPushTokenListener: (listener: (event: unknown) => void) => { remove: () => void };
};

type LiveActivityFactoryHandle<T extends object = object> = {
  start: (props: T, url?: string, staleDate?: Date) => LiveActivityHandle<T>;
  getInstances: () => LiveActivityHandle<T>[];
};

type LiveActivityComponent<T extends object> = (
  props: T,
  environment: LiveActivityEnvironment,
) => Record<string, ReactNode> | ReactNode;

export function isExpoWidgetsNativeAvailable(): boolean {
  try {
    return requireOptionalNativeModule('ExpoWidgets') != null;
  } catch {
    return false;
  }
}

type ExpoWidgetsRuntime = {
  createWidget: <P extends object, C extends object | undefined = undefined>(
    name: string,
    widget: (props: P, environment: WidgetEnvironment<C>) => React.JSX.Element,
    initialProps?: P,
  ) => WidgetHandle<P>;
  createLiveActivity: <T extends object>(
    name: string,
    liveActivity: LiveActivityComponent<T>,
  ) => LiveActivityFactoryHandle<T>;
};

let runtime: ExpoWidgetsRuntime | null | undefined;

function loadExpoWidgetsRuntime(): ExpoWidgetsRuntime | null {
  if (runtime !== undefined) return runtime;
  if (!isExpoWidgetsNativeAvailable()) {
    runtime = null;
    return null;
  }
  // 仅在原生模块存在时再加载；否则 ExpoWidgets.native.js 会硬抛
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  runtime = require('expo-widgets') as ExpoWidgetsRuntime;
  return runtime;
}

function stubWidget<PropsType extends object>(): WidgetHandle<PropsType> {
  return {
    reload() {},
    updateTimeline() {},
    updateSnapshot() {},
    async getTimeline() {
      return [];
    },
    setConfigurationParameterEnum() {},
  };
}

function stubLiveActivityFactory<T extends object>(): LiveActivityFactoryHandle<T> {
  return {
    start() {
      return {
        getId: () => '',
        update: async () => {},
        end: async () => {},
        getPushToken: async () => null,
        addPushTokenListener: () => ({ remove() {} }),
      };
    },
    getInstances() {
      return [];
    },
  };
}

export function createWidget<
  PropsType extends object = object,
  ConfigurationType extends object | undefined = undefined,
>(
  name: string,
  widget: (
    props: PropsType,
    environment: WidgetEnvironment<ConfigurationType>,
  ) => React.JSX.Element,
  initialProps?: PropsType,
): WidgetHandle<PropsType> {
  const mod = loadExpoWidgetsRuntime();
  if (!mod) return stubWidget<PropsType>();
  return mod.createWidget(name, widget, initialProps);
}

export function createLiveActivity<T extends object = object>(
  name: string,
  liveActivity: LiveActivityComponent<T>,
): LiveActivityFactoryHandle<T> {
  const mod = loadExpoWidgetsRuntime();
  if (!mod) return stubLiveActivityFactory<T>();
  return mod.createLiveActivity(name, liveActivity);
}
