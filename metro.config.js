// Windows + Expo SDK 57: EMFILE (too many open files) is usually caused by
// (1) double-watching the project root via watchFolders, (2) unbounded cache I/O,
// (3) too many transform workers. Fix those before Metro boots.
const fs = require('fs');
const path = require('path');

try {
  require('graceful-fs').gracefulify(fs);
} catch {
  // optional — start script also preloads patch-fs.js
}

const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Only block this app's own dist/ — a bare /dist/ pattern also matches
// node_modules packages (e.g. whatwg-fetch/dist/fetch.umd.js) and breaks bundling.
const appDistDir = path.resolve(__dirname, 'dist').replace(/[/\\]/g, '[/\\\\]');

const extraBlockList = [
  /[\\/]\.git[\\/].*/,
  /[\\/]\.cursor[\\/].*/,
  /[\\/]\.codegraph[\\/].*/,
  /[\\/]\.impeccable[\\/].*/,
  /[\\/]\.expo-test-export2[\\/].*/,
  /[\\/]\.vscode[\\/].*/,
  /[\\/]\.github[\\/].*/,
  new RegExp(`^${appDistDir}[/\\\\].*`),
];

const existing = config.resolver.blockList;
if (Array.isArray(existing)) {
  config.resolver.blockList = [...existing, ...extraBlockList];
} else if (existing) {
  config.resolver.blockList = [existing, ...extraBlockList];
} else {
  config.resolver.blockList = extraBlockList;
}

// IMPORTANT: do NOT set watchFolders = [__dirname].
// Metro already watches projectRoot; repeating it doubles the file-map crawl
// and is a common EMFILE trigger (see facebook/metro#1405).

const CACHE_IO_CONCURRENCY = Number(process.env.METRO_CACHE_CONCURRENCY) || 32;

function createLimiter(max) {
  let active = 0;
  const queue = [];

  const drain = () => {
    while (active < max && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .then(() => {
          active--;
          drain();
        });
    }
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      drain();
    });
}

async function withRetry(fn, attempts = 8) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const code = err && err.code;
      if ((code !== 'EMFILE' && code !== 'ENFILE') || attempt >= attempts) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 25 * 2 ** attempt));
    }
  }
}

const limitCacheIO = createLimiter(CACHE_IO_CONCURRENCY);

if (Array.isArray(config.cacheStores)) {
  for (const store of config.cacheStores) {
    for (const method of ['get', 'set']) {
      const original = store[method];
      if (typeof original !== 'function') continue;
      store[method] = (...args) =>
        limitCacheIO(() => withRetry(() => original.apply(store, args)));
    }
  }
}

// Fewer parallel hash/transform workers → far less concurrent open() on Windows.
if (process.platform === 'win32') {
  config.maxWorkers = 1;
}

module.exports = config;
