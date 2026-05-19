import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pluginPath = path.join(__dirname, '..', 'plugins', 'with-zheng-app-intents.js');

/** 与插件内常量一致，用于生成最终写入 Xcode 的 Swift 文本 */
const PENDING_FILENAME = 'shortcut-auto-ledger-pending.png';
const CLIPBOARD_MARKER_FILENAME = 'shortcut-auto-ledger-clipboard.marker';

const require = createRequire(import.meta.url);
// 读取插件源码并执行模板字面量（与 prebuild 时生成的 Swift 一致）
const pluginSrc = fs.readFileSync(pluginPath, 'utf8');
const templateStart = pluginSrc.indexOf('const SWIFT_SOURCE = `') + 'const SWIFT_SOURCE = `'.length;
const templateEnd = pluginSrc.indexOf('`;', templateStart);
const templateBody = pluginSrc.slice(templateStart, templateEnd);
// eslint-disable-next-line no-new-func
const swift = new Function('PENDING_FILENAME', 'CLIPBOARD_MARKER_FILENAME', `return \`${templateBody}\`;`)(
  PENDING_FILENAME,
  CLIPBOARD_MARKER_FILENAME,
);

const checks = [];
const braceOpen = (swift.match(/\{/g) || []).length;
const braceClose = (swift.match(/\}/g) || []).length;
checks.push(['balanced braces', braceOpen === braceClose, `${braceOpen} vs ${braceClose}`]);

const parenOpen = (swift.match(/\(/g) || []).length;
const parenClose = (swift.match(/\)/g) || []).length;
checks.push(['balanced parens', parenOpen === parenClose, `${parenOpen} vs ${parenClose}`]);

const requiredSnippets = [
  'import AppIntents',
  'struct ZhengScreenshotAutoLedgerIntent: AppIntent',
  'static var openAppWhenRun: Bool = true',
  'func perform() async throws -> some IntentResult',
  'struct ZhengAppShortcuts: AppShortcutsProvider',
  'writeClipboardMarker()',
  'writeImageData(_ data: Data)',
];
for (const s of requiredSnippets) {
  checks.push([`contains ${s.slice(0, 40)}…`, swift.includes(s), '']);
}

const forbidden = ['UIApplication.shared.open', 'openAppURL', 'withCheckedContinuation'];
const requiredImports = ['import UIKit', 'import Foundation'];
for (const s of requiredImports) {
  checks.push([`imports ${s.replace('import ', '')}`, swift.includes(s), '']);
}
for (const s of forbidden) {
  checks.push([`removed ${s}`, !swift.includes(s), swift.includes(s) ? 'still present' : '']);
}

checks.push([
  'filename constants expanded',
  swift.includes(PENDING_FILENAME) && swift.includes(CLIPBOARD_MARKER_FILENAME),
  '',
]);
checks.push([
  'no raw JS placeholders',
  !swift.includes('${PENDING_FILENAME}') && !swift.includes('${CLIPBOARD_MARKER_FILENAME}'),
  '',
]);

checks.push(['returns lightweight .result()', swift.includes('return .result()'), '']);
checks.push(['pasteboard fallback', swift.includes('copyImageToPasteboard'), '']);

const phraseInterp = swift.includes('在\\(.applicationName)里截图记账');
checks.push(['AppShortcut phrase interpolation', phraseInterp, '']);

let failed = false;
for (const [name, ok, detail] of checks) {
  const status = ok ? 'OK' : 'FAIL';
  if (!ok) failed = true;
  console.log(`${status}  ${name}${detail ? ` (${detail})` : ''}`);
}

const out = path.join(__dirname, '..', '_swift_check.swift');
fs.writeFileSync(out, swift);
console.log(`\nWrote ${out} (${swift.split('\n').length} lines)`);
process.exit(failed ? 1 : 0);
