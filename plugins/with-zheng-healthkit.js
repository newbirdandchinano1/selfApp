/**
 * 启用 HealthKit 能力与读取权限说明（prebuild 时写入 entitlements / Info.plist）。
 */
const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const SHARE_DESC =
  '用于在编辑个人资料时读取 Apple 健康中的身高、体重、步数、心率等数据并展示，便于核对与填写。';
const UPDATE_DESC = '本应用暂不向健康 App 写入数据。';
/** 与 app.json expo.name 一致，确保「健康」列表与主屏幕图标下名称相同 */
const IOS_DISPLAY_NAME = '小郑的自我修养';

/** @type {import('expo/config-plugins').ConfigPlugin} */
function withZhengHealthKit(config) {
  config = withEntitlementsPlist(config, entitlements => {
    entitlements.modResults['com.apple.developer.healthkit'] = true;
    return entitlements;
  });

  config = withInfoPlist(config, info => {
    info.modResults.CFBundleDisplayName = IOS_DISPLAY_NAME;
    info.modResults.CFBundleName = IOS_DISPLAY_NAME;
    info.modResults.NSHealthShareUsageDescription = SHARE_DESC;
    info.modResults.NSHealthUpdateUsageDescription = UPDATE_DESC;
    return info;
  });

  return config;
}

module.exports = withZhengHealthKit;
