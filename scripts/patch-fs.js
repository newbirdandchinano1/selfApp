/**
 * Preload before Expo/Metro: queue fs.open when the process hits the FD limit
 * instead of crashing with EMFILE.
 *
 * Usage: node -r ./scripts/patch-fs.js node_modules/expo/bin/cli start
 */
'use strict';

try {
  const fs = require('fs');
  require('graceful-fs').gracefulify(fs);
} catch (err) {
  console.warn('[patch-fs] graceful-fs unavailable:', err && err.message);
}
