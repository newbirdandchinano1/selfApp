/**
 * 队列语义自测（读宽写严）。
 * 用法：node scripts/test-api-request-queue.mjs
 * 直接复刻 lib/api-request-queue.ts 逻辑，避免依赖 tsx / path alias。
 */

const MAX_READ_IN_FLIGHT = 6;
const MAX_WRITE_IN_FLIGHT = 2;

let readInFlight = 0;
let writeInFlight = 0;
const readWaiters = [];
const writeWaiters = [];

function pumpRead() {
  while (readInFlight < MAX_READ_IN_FLIGHT && readWaiters.length > 0) {
    const next = readWaiters.shift();
    if (next) next();
  }
}

function pumpWrite() {
  while (writeInFlight < MAX_WRITE_IN_FLIGHT && writeWaiters.length > 0) {
    const next = writeWaiters.shift();
    if (next) next();
  }
}

function enqueueApiRequest(fn, options) {
  const kind = options?.kind === 'read' ? 'read' : 'write';
  const isRead = kind === 'read';
  return new Promise((resolve, reject) => {
    const start = () => {
      if (isRead) {
        readInFlight += 1;
        fn().then(resolve, reject).finally(() => {
          readInFlight = Math.max(0, readInFlight - 1);
          pumpRead();
        });
        return;
      }
      writeInFlight += 1;
      fn().then(resolve, reject).finally(() => {
        writeInFlight = Math.max(0, writeInFlight - 1);
        pumpWrite();
      });
    };
    if (isRead) {
      readWaiters.push(start);
      pumpRead();
    } else {
      writeWaiters.push(start);
      pumpWrite();
    }
  });
}

function reset() {
  readInFlight = 0;
  writeInFlight = 0;
  readWaiters.length = 0;
  writeWaiters.length = 0;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function testReadsParallel() {
  reset();
  let peakRead = 0;
  const jobs = Array.from({ length: 6 }, (_, i) =>
    enqueueApiRequest(async () => {
      peakRead = Math.max(peakRead, readInFlight);
      await sleep(40);
      return i;
    }, { kind: 'read' }),
  );
  await Promise.all(jobs);
  assert(peakRead === 6, `read peak should be 6, got ${peakRead}`);
  console.log(`[pass] 6 reads parallel, peak read in-flight = ${peakRead}`);
}

async function testWritesCapped() {
  reset();
  let peakWrite = 0;
  const jobs = Array.from({ length: 4 }, (_, i) =>
    enqueueApiRequest(async () => {
      peakWrite = Math.max(peakWrite, writeInFlight);
      await sleep(40);
      return i;
    }, { kind: 'write' }),
  );
  await Promise.all(jobs);
  assert(peakWrite === 2, `write peak should be 2, got ${peakWrite}`);
  console.log(`[pass] 4 writes capped, peak write in-flight = ${peakWrite}`);
}

async function testMixed() {
  reset();
  let peakRead = 0;
  let peakWrite = 0;
  const writes = Array.from({ length: 4 }, (_, i) =>
    enqueueApiRequest(async () => {
      peakWrite = Math.max(peakWrite, writeInFlight);
      await sleep(50);
      return `w${i}`;
    }, { kind: 'write' }),
  );
  const reads = Array.from({ length: 6 }, (_, i) =>
    enqueueApiRequest(async () => {
      peakRead = Math.max(peakRead, readInFlight);
      await sleep(40);
      return `r${i}`;
    }, { kind: 'read' }),
  );
  await Promise.all([...writes, ...reads]);
  assert(peakWrite === 2, `writes capped at 2, peak=${peakWrite}`);
  assert(peakRead >= 4, `reads should concurrency, got ${peakRead}`);
  console.log(`[pass] mixed: write peak=${peakWrite}, read peak=${peakRead}`);
}

async function testDefaultKindIsWrite() {
  reset();
  let peakWrite = 0;
  const jobs = Array.from({ length: 3 }, () =>
    enqueueApiRequest(async () => {
      peakWrite = Math.max(peakWrite, writeInFlight);
      await sleep(20);
    }),
  );
  await Promise.all(jobs);
  assert(peakWrite === 2, `default kind write capped 2, peak=${peakWrite}`);
  console.log(`[pass] omitted kind defaults to write, peak=${peakWrite}`);
}

async function main() {
  console.log('=== api-request-queue semantic tests ===');
  await testReadsParallel();
  await testWritesCapped();
  await testMixed();
  await testDefaultKindIsWrite();
  console.log('=== ALL PASSED ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
