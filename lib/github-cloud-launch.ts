import { DB_VERSION } from '@/lib/database';
import { GitHubBackupManager, getGitHubFullBackupRootFromEnv } from '@/lib/github-backup-manager';
import { getGitHubBackupConfig } from '@/lib/github-backup-user-config';
import { getLastFullGithubBackupAtIso } from '@/lib/github-full-backup-local-meta';
import { parseGithubAppBackupManifestV1 } from '@/lib/github-app-backup-manifest';
import { triggerGithubCloudRestoreFromFullBackup } from '@/lib/github-cloud-restore';

function parseIsoMs(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * 启动后静默检查：若云端 `manifest.lastFullBackupAt`（或 `lastUpdated`）晚于本机记录的「上次与云端对齐时间」，
 * 则执行一次全量恢复（与手动「从云同步」相同逻辑）。
 *
 * 本机从未完成过备份/恢复（无 `getLastFullGithubBackupAtIso`）时不自动拉取，以免新安装被空配置覆盖。
 */
export async function runSilentGithubCloudSyncIfRemoteNewer(): Promise<void> {
  const cfg = await getGitHubBackupConfig();
  if (!cfg) return;

  const root = getGitHubFullBackupRootFromEnv();
  const manifestPath = `${root.replace(/^\/+/, '')}/manifest.json`;

  const localAt = await getLastFullGithubBackupAtIso();
  if (!localAt) return;

  const mgr = new GitHubBackupManager({ ...cfg, path: manifestPath });
  const dl = await mgr.downloadUtf8Text();
  if (!dl.ok) return;

  let manifest;
  try {
    manifest = parseGithubAppBackupManifestV1(dl.text);
  } catch {
    return;
  }

  if (manifest.bundledDbVersion != null && manifest.bundledDbVersion > DB_VERSION) {
    if (__DEV__) {
      console.warn(
        '[kv launch] 云端备份的 bundledDbVersion 高于本应用 DB_VERSION，跳过静默同步（请先升级应用）',
      );
    }
    return;
  }

  const cloudAt = manifest.lastFullBackupAt ?? manifest.lastUpdated;
  if (!cloudAt) return;

  const cloudMs = parseIsoMs(cloudAt);
  const localMs = parseIsoMs(localAt);
  if (!Number.isFinite(cloudMs) || !Number.isFinite(localMs) || cloudMs <= localMs) {
    return;
  }

  const result = await triggerGithubCloudRestoreFromFullBackup();
  if (__DEV__ && !result.ok && result.reason !== 'no_config' && result.reason !== 'aborted') {
    console.warn('[kv launch] 静默从云同步失败', result.message);
  }
}
