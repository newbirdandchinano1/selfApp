/**
 * 天气 summary store：拉取缓存、定位变更 / 前台刷新。
 * 供 ProfileWeatherCard 使用。
 */
import {
  apiExternalWeatherSummary,
  type ExternalWeatherSummary,
} from '@/lib/api/endpoints/external';
import { toUserMessage } from '@/lib/app-feedback';
import {
  resolveWeatherLocation,
  subscribeWeatherLocationSettings,
  type ResolvedWeatherLocation,
} from '@/lib/weather-location';
import { resolveWeatherSceneKey, type WeatherSceneKey } from '@/lib/weather-scene';
import { AppState, type AppStateStatus } from 'react-native';

export const WEATHER_SUMMARY_TTL_MS = 20 * 60 * 1000;

export type WeatherSummaryStatus = 'idle' | 'loading' | 'ready' | 'error';

export type WeatherSummaryState = {
  summary: ExternalWeatherSummary | null;
  scene: WeatherSceneKey | null;
  location: ResolvedWeatherLocation | null;
  status: WeatherSummaryStatus;
  error: string | null;
  /** 成功拿到数据的时间戳；失败不清空旧数据时仍保留 */
  fetchedAt: number | null;
  updatedAt: number;
};

type Listener = () => void;

const listeners = new Set<Listener>();

let state: WeatherSummaryState = {
  summary: null,
  scene: null,
  location: null,
  status: 'idle',
  error: null,
  fetchedAt: null,
  updatedAt: Date.now(),
};

let started = false;
let inFlight: AbortController | null = null;
let locationUnsub: (() => void) | null = null;
let appStateSub: { remove: () => void } | null = null;
let generation = 0;

function emit(): void {
  state = { ...state, updatedAt: Date.now() };
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function patch(partial: Partial<WeatherSummaryState>): void {
  state = { ...state, ...partial };
  emit();
}

function sceneFromSummary(summary: ExternalWeatherSummary | null): WeatherSceneKey | null {
  if (!summary?.now) return null;
  return resolveWeatherSceneKey({ text: summary.now.text, icon: summary.now.icon });
}

function isFresh(now = Date.now()): boolean {
  return state.fetchedAt != null && now - state.fetchedAt < WEATHER_SUMMARY_TTL_MS;
}

export function getWeatherSummaryState(): WeatherSummaryState {
  return state;
}

export function subscribeWeatherSummary(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export type RefreshWeatherSummaryOptions = {
  /** 忽略 TTL，强制重新拉取 */
  force?: boolean;
  signal?: AbortSignal;
};

/**
 * 拉取天气 summary（TTL 内且非 force 则跳过）。
 * 失败时：若已有旧数据则保留并标 error；无数据则 scene=null。
 */
export async function refreshWeatherSummary(
  opts: RefreshWeatherSummaryOptions = {},
): Promise<WeatherSummaryState> {
  const force = !!opts.force;
  if (!force && isFresh() && state.summary) {
    return state;
  }

  inFlight?.abort();
  const ctrl = new AbortController();
  inFlight = ctrl;

  const onExternalAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const gen = ++generation;
  patch({
    status: 'loading',
    error: null,
  });

  try {
    const loc = await resolveWeatherLocation();
    if (ctrl.signal.aborted || gen !== generation) return state;

    const summary = await apiExternalWeatherSummary({
      lat: loc.lat,
      lng: loc.lng,
      label: loc.label,
      days: 7,
      hours: 24,
      signal: ctrl.signal,
    });
    if (ctrl.signal.aborted || gen !== generation) return state;

    patch({
      summary,
      scene: sceneFromSummary(summary),
      location: loc,
      status: 'ready',
      error: null,
      fetchedAt: Date.now(),
    });
    return state;
  } catch (e) {
    if (ctrl.signal.aborted || gen !== generation) return state;
    const message = toUserMessage(e, '天气加载失败');
    if (state.summary) {
      patch({
        status: 'error',
        error: message,
      });
    } else {
      patch({
        summary: null,
        scene: null,
        status: 'error',
        error: message,
      });
    }
    return state;
  } finally {
    if (inFlight === ctrl) inFlight = null;
    if (opts.signal) {
      opts.signal.removeEventListener('abort', onExternalAbort);
    }
  }
}

/** 立即作废缓存（定位变更等）；不自动拉取，由调用方 refresh */
export function invalidateWeatherSummaryCache(): void {
  generation += 1;
  inFlight?.abort();
  inFlight = null;
  patch({
    fetchedAt: null,
    status: state.summary ? state.status : 'idle',
  });
}

function onLocationChanged(): void {
  invalidateWeatherSummaryCache();
  void refreshWeatherSummary({ force: true });
}

function onAppStateChange(next: AppStateStatus): void {
  if (next !== 'active') return;
  if (isFresh() && state.summary) return;
  void refreshWeatherSummary({ force: false });
}

/**
 * 启动订阅（定位变更 + AppState）并做首次拉取。
 * 幂等；可在首个订阅者处调用。
 */
export function ensureWeatherSummaryStarted(): void {
  if (started) return;
  started = true;

  locationUnsub = subscribeWeatherLocationSettings(onLocationChanged);
  appStateSub = AppState.addEventListener('change', onAppStateChange);

  void refreshWeatherSummary({ force: false });
}

/** 测试 / 热重载用：停止订阅并重置状态 */
export function resetWeatherSummaryStoreForTests(): void {
  started = false;
  generation += 1;
  inFlight?.abort();
  inFlight = null;
  locationUnsub?.();
  locationUnsub = null;
  appStateSub?.remove();
  appStateSub = null;
  state = {
    summary: null,
    scene: null,
    location: null,
    status: 'idle',
    error: null,
    fetchedAt: null,
    updatedAt: Date.now(),
  };
  emit();
}
