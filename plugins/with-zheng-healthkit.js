/**
 * 启用 HealthKit 能力与读取权限说明（prebuild 时写入 entitlements / Info.plist）。
 */
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const SHARE_DESC =
  '用于在编辑个人资料时读取 Apple 健康中的身高、体重、步数、心率等数据并展示，便于核对与填写。';
const UPDATE_DESC = '本应用暂不向健康 App 写入数据。';

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withZhengHealthKit(config) {
  config = withEntitlementsPlist(config, entitlements => {
    entitlements.modResults['com.apple.developer.healthkit'] = true;
    return entitlements;
  });

  config = withInfoPlist(config, info => {
    info.modResults.NSHealthShareUsageDescription = SHARE_DESC;
    info.modResults.NSHealthUpdateUsageDescription = UPDATE_DESC;
    return info;
  });

  return config;
}

module.exports = withZhengHealthKit;
