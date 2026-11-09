module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // 不要用 overrides.exclude（Metro getCacheKey 无 filename 会直接崩）
    // node_modules 跳过逻辑在 babel-plugin-rn-app-fonts.js 内用 filename 判断
    plugins: ['./babel-plugin-rn-app-fonts.js'],
  };
};
