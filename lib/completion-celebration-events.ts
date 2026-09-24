import { suppressPointsEarnedToastForMs } from '@/lib/points-earned-toast-events';

export type CompletionCelebrationPayload = {
  /** 完成的项目 / 待办 / 任务名称 */
  title: string;
  /** 本次实际获得的积分（正数）；无加成则不传或 0 */
  pointsDelta?: number;
};

type Listener = (payload: CompletionCelebrationPayload | null) => void;

const listeners = new Set<Listener>();

let visiblePayload: CompletionCelebrationPayload | null = null;
let seq = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let startTimer: ReturnType<typeof setTimeout> | null = null;

/** 动画总时长（已按 0.8x 放慢）+ 启动延迟，供晚订阅者清状态 */
const CELEBRATION_VISIBLE_MS = 2900;
/** 避开完成确认 Alert 关闭与原生 Stack 抢焦点 */
const START_DELAY_MS = 120;

function emit(payload: CompletionCelebrationPayload | null): void {
  visiblePayload = payload;
  for (const listener of listeners) {
    listener(payload);
  }
}

/**
 * 触发全页完成庆祝（课程表 / 待办 / 项目完成时调用）。
 * 短时间内重复调用会重启动画。
 */
export function notifyCompletionCelebration(input: CompletionCelebrationPayload | string): void {
  const payload: CompletionCelebrationPayload =
    typeof input === 'string'
      ? { title: input.trim() || '该项' }
      : {
          title: (input.title ?? '').trim() || '该项',
          pointsDelta:
            typeof input.pointsDelta === 'number' && Number.isFinite(input.pointsDelta)
              ? input.pointsDelta
              : undefined,
        };

  if (startTimer) {
    clearTimeout(startTimer);
    startTimer = null;
  }
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }

  // 庆祝期间屏蔽独立积分 toast，避免与「恭喜完成」叠两条
  suppressPointsEarnedToastForMs(CELEBRATION_VISIBLE_MS + START_DELAY_MS + 400);

  startTimer = setTimeout(() => {
    startTimer = null;
    seq += 1;
    emit({ ...payload });
    hideTimer = setTimeout(() => {
      hideTimer = null;
      emit(null);
    }, CELEBRATION_VISIBLE_MS);
  }, START_DELAY_MS);
}

export function subscribeCompletionCelebration(listener: Listener): () => void {
  listeners.add(listener);
  listener(visiblePayload);
  return () => {
    listeners.delete(listener);
  };
}
