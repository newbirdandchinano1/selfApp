let silentRestoreInFlight = false;

export function isSilentCloudRestoreInFlight(): boolean {
  return silentRestoreInFlight;
}

export function setSilentCloudRestoreInFlight(value: boolean): void {
  silentRestoreInFlight = value;
}
