export function clampWishDesireLevel(level: number): number {
  return Math.min(5, Math.max(1, Math.round(level)));
}

export function formatWishDesireLevelLabel(level: number): string {
  const lv = clampWishDesireLevel(level);
  if (lv >= 5) return '心动等级 5 · 心之所向';
  if (lv >= 4) return '心动等级 4';
  if (lv >= 3) return '心动等级 3';
  if (lv >= 2) return '心动等级 2';
  return '心动等级 1 · 理智购买';
}

export function formatWishDesireLevelShort(level: number): string {
  return `${clampWishDesireLevel(level)}/5`;
}

export function formatWishCategoryLabel(categoryLabel: string | null | undefined): string {
  const trimmed = categoryLabel?.trim();
  return trimmed || '未分类';
}

export function formatWishReasonPreview(reason: string | null | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed) return '未填写心动理由';
  const one = trimmed.split(/\n/)[0] ?? trimmed;
  return one.length > 80 ? `${one.slice(0, 77)}…` : one;
}

/** 有内容时返回单行预览，否则 null（卡片可省略该行） */
export function wishReasonPreviewOrNull(reason: string | null | undefined): string | null {
  const trimmed = reason?.trim();
  if (!trimmed) return null;
  const one = trimmed.split(/\n/)[0] ?? trimmed;
  return one.length > 56 ? `${one.slice(0, 53)}…` : one;
}
