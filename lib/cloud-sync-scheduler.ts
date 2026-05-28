import { getLastCloudAlignAtIso, setLastCloudAlignAtIso } from '@/lib/cloud-backup-meta';
import { alignAllLocalTablesToCloud } from '@/lib/cloud-sql-sync';

/** 每 4 小时将本地 SQLite 全表与云端 D1 对齐（以本机为准全量覆盖云端各表） */
export const CLOUD_ALIGN_INTERVAL_MS = 4 * 60 * 60 * 1000;

let alignTimer: ReturnType<typeof setInterval> | null = null;
let alignInFlight = false;

async function runAlignIfDue(): Promise<void> {
  if (alignInFlight) return;
  alignInFlight = true;
  try {
    const lastIso = await getLastCloudAlignAtIso();
    const lastMs = lastIso ? Date.parse(lastIso) : 0;
    const now = Date.now();
    if (Number.isFinite(lastMs) && now - lastMs < CLOUD_ALIGN_INTERVAL_MS) return;

    await alignAllLocalTablesToCloud();
  } catch (e) {
    if (__DEV__) console.warn('[cloud scheduler] 定时对齐失败', e);
  } finally {
    alignInFlight = false;
  }
}

/** 应用启动后调用：立即检查是否到期，并注册 4 小时周期任务 */
export function startCloudPeriodicAlignScheduler(): void {
  void runAlignIfDue();

  if (alignTimer) clearInterval(alignTimer);
  alignTimer = setInterval(() => {
    void runAlignIfDue();
  }, CLOUD_ALIGN_INTERVAL_MS);
}

export function stopCloudPeriodicAlignScheduler(): void {
  if (alignTimer) {
    clearInterval(alignTimer);
    alignTimer = null;
  }
}
