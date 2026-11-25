/**
 * zlog 后端配置
 * 文档：zlog-APP对接API说明.md
 * 注意：直连 4002 端口，避免 80/443 的 301 导致鉴权头丢失。
 */
export const BASE_URL = 'http://124.223.161.79:4002';

/**
 * 个人长期 Token（PAT）。明文只出现一次，建议移到安全存储；
 * 这里为示意直接内置（与文档一致）。
 */
export const PAT =
  'zpat_b0d3e35842c70aa4db26897433b3accc01dd55ca3a3bfb93a8ab4900e22eb6af';
