/**
 * 并发闸门：峰值不超过 MAX_IN_FLIGHT；写优先但为读保留槽位。
 * 用法：node scripts/test-api-request-queue.mjs
 *
 * 与 lib/api-request-queue.ts 保持同逻辑（脚本内联，避免 TS 加载）。
 */

const MAX_IN_FLIGHT = 6;
const RESERVED_READ_SLOTS = 2;
const MAX_WAITING = 48;

let inFlight = 0;
let inFlightReads = 0;
let inFlightWrites = 0;
const waitingReads = [];
const waitingWrites = [];

function waitingCount() {
  return waitingReads.length + waitingWrites.length;
}

function beginInFlight(kind) {
  inFlight += 1;
  if (kind === 'write') inFlightWrites += 1;
  else inFlightReads += 1;
}

function endInFlight(kind) {
  inFlight = Math.max(0, inFlight - 1);
  if (kind === 'write') inFlightWrites = Math.max(0, inFlightWrites - 1);
  else inFlightReads = Math.max(0, inFlightReads - 1);
}

function maxWritesAllowed() {
  if (waitingReads.length > 0 || inFlightReads > 0) {
    return Math.max(0, MAX_IN_FLIGHT - RESERVED_READ_SLOTS);
  }
  return MAX_IN_FLIGHT;
}

function takeNext() {
  if (inFlight >= MAX_IN_FLIGHT) return null;

  const writeCap = maxWritesAllowed();
  if (waitingWrites.length > 0 && inFlightWrites < writeCap) {
    return waitingWrites.shift() ?? null;
  }
  if (waitingReads.length > 0) {
    return waitingReads.shift() ?? null;
  }
  return null;
}

function pump() {
  for (;;) {
    const next = takeNext();
    if (!next) break;
    beginInFlight(next.kind);
    next.start();
  }
}

function reset() {
  inFlight = 0;
  inFlightReads = 0;
  inFlightWrites = 0;
  waitingReads.length = 0;
  waitingWrites.length = 0;
}

function enqueueApiRequest(fn, options) {
  const kind = options?.kind === 'write' ? 'write' : 'read';
  return new Promise((resolve, reject) => {
    const start = () => {
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          endInFlight(kind);
          pump();
        });
    };

    if (waitingCount() >= MAX_WAITING) {
      if (kind === 'read') {
        reject(new Error('API 请求排队已满，请稍后重试'));
        return;
      }
      const dropped = waitingReads.shift();
      if (dropped) {
        dropped.reject(new Error('API 请求排队已满，请稍后重试'));
      } else {
        reject(new Error('API 请求排队已满，请稍后重试'));
        return;
      }
    }

    if (kind === 'write') waitingWrites.push({ kind, start, reject });
    else waitingReads.push({ kind, start, reject });
    pump();
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function testConcurrencyCap() {
  reset();
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

async function testWritePriorityWhenUnderCap() {
  reset();
  const order = [];
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
  // 释放后仍有读在飞/在排：写优先但仍须留读槽；首个出队应是写（写未触顶）
  assert(order[0] === 'write', `write should run before queued read when under write cap, got ${order.join(',')}`);
  console.log(`[pass] write priority under cap, order = ${order.join(',')}`);
}

async function testReadNotStarvedByWrites() {
  reset();
  const order = [];
  // 占满并发槽
  const blockers = Array.from({ length: MAX_IN_FLIGHT }, () => {
    let release;
    const p = new Promise(r => {
      release = r;
    });
    return {
      release,
      job: enqueueApiRequest(() => p.then(() => 'block'), { kind: 'write' }),
    };
  });
  await sleep(10);

  // 先排一个读，再连续塞大量写（旧逻辑会把读永远顶在后面）
  const readJob = enqueueApiRequest(async () => {
    order.push('read');
    return 'read';
  }, { kind: 'read' });
  const writeJobs = Array.from({ length: 12 }, (_, i) =>
    enqueueApiRequest(async () => {
      order.push(`w${i}`);
      return `w${i}`;
    }, { kind: 'write' }),
  );

  for (const b of blockers) b.release();
  await Promise.all([...blockers.map(b => b.job), readJob, ...writeJobs]);

  const readIdx = order.indexOf('read');
  assert(readIdx >= 0, 'read should eventually run');
  // 有读保留槽时，读不会排在全部 12 个写之后（至多先放 writeCap 个写）
  assert(
    readIdx <= MAX_IN_FLIGHT - RESERVED_READ_SLOTS,
    `read should not be starved, index=${readIdx}, order=${order.join(',')}`,
  );
  console.log(`[pass] read not starved, index=${readIdx}, order head=${order.slice(0, 6).join(',')}`);
}

async function testReservedWriteCapWhileReadsWait() {
  reset();
  let releaseBlockers;
  const blockerGate = new Promise(r => {
    releaseBlockers = r;
  });
  const blockers = Array.from({ length: MAX_IN_FLIGHT }, () =>
    enqueueApiRequest(() => blockerGate.then(() => 'block'), { kind: 'write' }),
  );
  await sleep(10);

  let readStarted = false;
  const readJob = enqueueApiRequest(async () => {
    readStarted = true;
    return 'read';
  }, { kind: 'read' });
  const extraWrites = Array.from({ length: 8 }, () =>
    enqueueApiRequest(async () => 'w', { kind: 'write' }),
  );

  // 释放 blocker 后立刻观察：在有读等待时，飞行中的写不应超过 MAX - RESERVED
  releaseBlockers();
  await sleep(5);
  assert(
    inFlightWrites <= MAX_IN_FLIGHT - RESERVED_READ_SLOTS || readStarted,
    `writes in flight ${inFlightWrites} should leave room for reads (cap ${MAX_IN_FLIGHT - RESERVED_READ_SLOTS})`,
  );
  await Promise.all([readJob, ...blockers, ...extraWrites]);
  assert(readStarted, 'read should have started');
  console.log(`[pass] write cap while reads wait (reserved=${RESERVED_READ_SLOTS})`);
}

async function main() {
  console.log('=== api-request-queue concurrency tests ===');
  await testConcurrencyCap();
  await testWritePriorityWhenUnderCap();
  await testReadNotStarvedByWrites();
  await testReservedWriteCapWhileReadsWait();
  console.log('=== ALL PASSED ===');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
