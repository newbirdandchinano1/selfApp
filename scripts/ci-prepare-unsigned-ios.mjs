/**
 * GitHub 未签名 IPA 分发前准备：去掉 Widget Extension / App Group / Live Activity。
 *
 * 企业签 / 超级签通常无法正确重签 PlugIns/*.appex 与 application-groups，
 * 真机一点图标就会被系统直接杀掉（闪退）。主 App JS 已对 ExpoWidgets 做 optional 探测，
 * 去掉扩展后业务功能仍可跑，仅桌面组件暂不可用。
 *
 * 用法：node scripts/ci-prepare-unsigned-ios.mjs
 * 环境变量 CI_KEEP_WIDGETS=1 可跳过（自带正确签名链路时再用）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJsonPath = path.join(root, 'app.json');

if (process.env.CI_KEEP_WIDGETS === '1') {
  console.log('[ci-prepare-unsigned-ios] CI_KEEP_WIDGETS=1 → keep expo-widgets');
  process.exit(0);
}

const raw = fs.readFileSync(appJsonPath, 'utf8');
const doc = JSON.parse(raw);
const expo = doc.expo;
if (!expo || typeof expo !== 'object') {
  console.error('[ci-prepare-unsigned-ios] invalid app.json: missing expo');
  process.exit(1);
}

const beforePlugins = Array.isArray(expo.plugins) ? expo.plugins.length : 0;

expo.plugins = (expo.plugins ?? []).filter((entry) => {
  const name = Array.isArray(entry) ? entry[0] : entry;
  return name !== 'expo-widgets';
});

if (!expo.ios) expo.ios = {};
if (expo.ios.entitlements) {
  delete expo.ios.entitlements['com.apple.security.application-groups'];
  if (Object.keys(expo.ios.entitlements).length === 0) {
    delete expo.ios.entitlements;
  }
}

if (!expo.ios.infoPlist) expo.ios.infoPlist = {};
delete expo.ios.infoPlist.NSSupportsLiveActivities;
delete expo.ios.infoPlist.NSSupportsLiveActivitiesFrequentUpdates;
delete expo.ios.infoPlist.ExpoWidgetsAppGroupIdentifier;

fs.writeFileSync(appJsonPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

console.log('[ci-prepare-unsigned-ios] stripped expo-widgets / App Group / Live Activity');
console.log(
  `[ci-prepare-unsigned-ios] plugins: ${beforePlugins} → ${expo.plugins.length}`,
);
