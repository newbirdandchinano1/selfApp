// Windows: Metro/Expo SDK 57 can hit EMFILE (too many open files) under
// concurrent crawl/hash. Patch fs + tighten watch scope before Metro boots.
const fs = require('fs');
const path = require('path');

try {
  // Queues open() when the process hits the FD limit instead of crashing.
  require('graceful-fs').gracefulify(fs);
} catch {
  // optional — still ship without it
}

if (process.platform === 'win32') {
  process.env.CHOKIDAR_USEPOLLING = process.env.CHOKIDAR_USEPOLLING || '1';
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

// Keep the watcher rooted on this app only (avoid parent APP folder).
config.watchFolders = [__dirname];

// Fewer parallel hash/read workers → far less likely to hit EMFILE on Windows.
if (process.platform === 'win32') {
  config.maxWorkers = 2;
}

module.exports = config;
