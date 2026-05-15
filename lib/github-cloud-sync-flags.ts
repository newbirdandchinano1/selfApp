/** 避免与 `github-cloud-sync` / `github-cloud-restore` 交叉 import 的运行期标志 */

let silentGithubCloudRestoreInFlight = false;

export function setSilentGithubCloudRestoreInFlight(value: boolean): void {
  silentGithubCloudRestoreInFlight = value;
}

export function isSilentGithubCloudRestoreInFlight(): boolean {
  return silentGithubCloudRestoreInFlight;
}
