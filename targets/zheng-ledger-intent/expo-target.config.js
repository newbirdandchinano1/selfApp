/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'app-intent',
  name: 'ZhengLedgerIntent',
  displayName: '小郑记账意图',
  deploymentTarget: '18.0',
  frameworks: ['AppIntents', 'SwiftUI'],
  entitlements: {
    'com.apple.security.application-groups': config.ios?.entitlements?.[
      'com.apple.security.application-groups'
    ] ?? ['group.com.myselfManage.appdemo.ledger'],
  },
});
