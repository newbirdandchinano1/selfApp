/**
 * 队列语义自测（共享软限流）。
 * 用法：node scripts/test-api-request-queue.mjs
 */

const MAX_IN_FLIGHT = 24;

let inFlight = 0;
const waiters = [];

function pump() {
  while (inFlight < MAX_IN_FLIGHT && waiters.length > 0) {
    const next = waiters.shift();
    if (next) next();
  }
}

function enqueueApiRequest(fn, _options) {
  return new Promise((resolve, reject) => {
    const start = () => {
      inFlight += 1;
      fn().then(resolve, reject).finally(() => {
        inFlight = Math.max(0, inFlight - 1);
        pump();
      });
    };
    waiters.push(start);
    pump();
  });
}

function reset() {
  inFlight = 0;
  waiters.length = 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function testSharedCap() {
  reset();
  let peak = 0;
  const jobs = Array.from({ length: 30 }, (_, i) =>
    enqueueApiRequest(async () => {
      peak = Math.max(peak, inFlight);
      await sleep(30);
      return i;
    }, { kind: i % 2 === 0 ? 'read' : 'write' }),
  );
  await Promise.all(jobs);
  assert(peak === 24, `shared peak should be 24, got ${peak}`);
  console.log(`[pass] 30 mixed requests, peak in-flight = ${peak}`);
}

async function testKindIgnoredSamePool() {
  reset();
  let peak = 0;
  const reads = Array.from({ length: 16 }, (_, i) =>
    enqueueApiRequest(async () => {
      peak = Math.max(peak, inFlight);
      await sleep(40);
      return `r${i}`;
    }, { kind: 'read' }),
  );
  const writes = Array.from({ length: 16 }, (_, i) =>
    enqueueApiRequest(async () => {
      peak = Math.max(peak, inFlight);
      await sleep(40);
      return `w${i}`;
    }, { kind: 'write' }),
  );
  await Promise.all([...reads, ...writes]);
  assert(peak === 24, `read+write share pool, peak should be 24, got ${peak}`);
  console.log(`[pass] read+write share one pool, peak = ${peak}`);
}

async function main() {
  console.log('=== api-request-queue shared-pool tests ===');
  await testSharedCap();
  await testKindIgnoredSamePool();
  console.log('=== ALL PASSED ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
