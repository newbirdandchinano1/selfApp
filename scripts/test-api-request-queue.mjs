/**
 * 并发闸门：峰值不超过 MAX_IN_FLIGHT，写优先于读。
 * 用法：node --experimental-strip-types 不可用时用下方内联副本；
 * 或：node scripts/test-api-request-queue.mjs
 *
 * 与 lib/api-request-queue.ts 保持同逻辑（脚本内联，避免 TS 加载）。
 */

const MAX_IN_FLIGHT = 6;
const MAX_WAITING = 48;

let inFlight = 0;
const waiting = [];

function pump() {
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    const next = waiting.shift();
    if (!next) break;
    inFlight += 1;
    next.start();
  }
}

function enqueueEntry(entry) {
  if (entry.kind === 'write') {
    const firstRead = waiting.findIndex(e => e.kind === 'read');
    if (firstRead >= 0) waiting.splice(firstRead, 0, entry);
    else waiting.push(entry);
  } else {
    waiting.push(entry);
  }
  pump();
}

function enqueueApiRequest(fn, options) {
  const kind = options?.kind === 'write' ? 'write' : 'read';
  return new Promise((resolve, reject) => {
    const start = () => {
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          pump();
        });
    };

    if (inFlight < MAX_IN_FLIGHT && waiting.length === 0) {
      inFlight += 1;
      start();
      return;
    }

    if (waiting.length >= MAX_WAITING) {
      if (kind === 'read') {
        reject(new Error('API 请求排队已满，请稍后重试'));
        return;
      }
      const dropIdx = waiting.findIndex(e => e.kind === 'read');
      if (dropIdx >= 0) {
        const dropped = waiting.splice(dropIdx, 1)[0];
        dropped.reject(new Error('API 请求排队已满，请稍后重试'));
      } else {
        reject(new Error('API 请求排队已满，请稍后重试'));
        return;
      }
    }

    enqueueEntry({ kind, start, reject });
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function testConcurrencyCap() {
  inFlight = 0;
  waiting.length = 0;
  let concurrent = 0;
  let peak = 0;
  const jobs = Array.from({ length: 40 }, (_, i) =>
    enqueueApiRequest(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await sleep(30);
      concurrent -= 1;
      return i;
    }, { kind: i % 5 === 0 ? 'write' : 'read' }),
  );
  await Promise.all(jobs);
  assert(peak <= MAX_IN_FLIGHT, `peak ${peak} should be <= ${MAX_IN_FLIGHT}`);
  assert(peak === MAX_IN_FLIGHT, `peak should reach cap ${MAX_IN_FLIGHT}, got ${peak}`);
  console.log(`[pass] 40 requests capped, peak = ${peak}`);
}

async function testWritePriority() {
  inFlight = 0;
  waiting.length = 0;
  const order = [];
  // 占满并发槽
  const blockers = Array.from({ length: MAX_IN_FLIGHT }, () => {
    let release;
    const p = new Promise(r => {
      release = r;
    });
    return {
      release,
      job: enqueueApiRequest(() => p.then(() => 'block'), { kind: 'read' }),
    };
  });
  await sleep(10);

  const readJob = enqueueApiRequest(async () => {
    order.push('read');
    return 'read';
  }, { kind: 'read' });
  const writeJob = enqueueApiRequest(async () => {
    order.push('write');
    return 'write';
  }, { kind: 'write' });

  for (const b of blockers) b.release();
  await Promise.all([...blockers.map(b => b.job), readJob, writeJob]);
  assert(order[0] === 'write', `write should run before queued read, got ${order.join(',')}`);
  console.log(`[pass] write priority, order = ${order.join(',')}`);
}

async function main() {
  console.log('=== api-request-queue concurrency tests ===');
  await testConcurrencyCap();
  await testWritePriority();
  console.log('=== ALL PASSED ===');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
