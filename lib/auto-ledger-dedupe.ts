/** 同一截图在短时间内的重复识别落账（多入口竞态） */
const RECENT_IMAGE_MS = 12_000;
const recentImageAt = new Map<string, number>();

export function fingerprintAutoLedgerImage(imageDataUri: string): string {
  if (imageDataUri.length <= 256) return imageDataUri;
  return `${imageDataUri.length}:${imageDataUri.slice(0, 96)}:${imageDataUri.slice(-96)}`;
}

export function shouldSkipDuplicateAutoLedgerImage(imageDataUri: string): boolean {
  const fp = fingerprintAutoLedgerImage(imageDataUri);
  const now = Date.now();
  const last = recentImageAt.get(fp);
  if (last != null && now - last < RECENT_IMAGE_MS) {
    return true;
  }
  recentImageAt.set(fp, now);
  for (const [key, ts] of recentImageAt) {
    if (now - ts >= RECENT_IMAGE_MS) {
      recentImageAt.delete(key);
    }
  }
  return false;
}
