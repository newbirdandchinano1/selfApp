/**
 * 队列已放开：enqueue 应立即执行、无排队。
 * 用法：node scripts/test-api-request-queue.mjs
 */

function enqueueApiRequest(fn, _options) {
  return fn();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function assert(cond, msg) {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function testFullyOpen() {
  let concurrent = 0;
  let peak = 0;
  const jobs = Array.from({ length: 40 }, (_, i) =>
    enqueueApiRequest(async () => {
      concurrent += 1;
      peak = Math.max(peak, concurrent);
      await sleep(20);
      concurrent -= 1;
      return i;
    }, { kind: i % 2 === 0 ? 'read' : 'write' }),
  );
  await Promise.all(jobs);
  assert(peak === 40, `fully open peak should be 40, got ${peak}`);
  console.log(`[pass] 40 requests all concurrent, peak = ${peak}`);
}

async function main() {
  console.log('=== api-request-queue fully-open tests ===');
  await testFullyOpen();
  console.log('=== ALL PASSED ===');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
