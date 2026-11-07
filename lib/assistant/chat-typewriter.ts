/**
 * 阶段二流式占位：完整回复到达后按字填充（真 SSE 接入后可替换）。
 */

export function runTypewriter(opts: {
  fullText: string;
  onUpdate: (partial: string) => void;
  /** 每帧追加字符数 */
  chunkSize?: number;
  /** 帧间隔 ms */
  intervalMs?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const chunkSize = Math.max(1, opts.chunkSize ?? 3);
  const intervalMs = Math.max(8, opts.intervalMs ?? 16);
  const full = opts.fullText;

  return new Promise((resolve, reject) => {
    let i = 0;
    const tick = () => {
      if (opts.signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      i = Math.min(full.length, i + chunkSize);
      opts.onUpdate(full.slice(0, i));
      if (i >= full.length) {
        resolve();
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
