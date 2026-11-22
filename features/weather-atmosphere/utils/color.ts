/**
 * 颜色解析与插值（可在 Reanimated worklet 中使用）。
 */

export type Rgba = { r: number; g: number; b: number; a: number };

function clamp01(n: number): number {
  'worklet';
  return Math.min(1, Math.max(0, n));
}

function hexToRgba(hex: string): Rgba | null {
  'worklet';
  const raw = hex.replace('#', '').trim();
  if (raw.length === 3) {
    const r = parseInt(raw[0]! + raw[0]!, 16);
    const g = parseInt(raw[1]! + raw[1]!, 16);
    const b = parseInt(raw[2]! + raw[2]!, 16);
    if ([r, g, b].some((v) => Number.isNaN(v))) return null;
    return { r, g, b, a: 1 };
  }
  if (raw.length === 6 || raw.length === 8) {
    const r = parseInt(raw.slice(0, 2), 16);
    const g = parseInt(raw.slice(2, 4), 16);
    const b = parseInt(raw.slice(4, 6), 16);
    const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
    if ([r, g, b, a].some((v) => Number.isNaN(v))) return null;
    return { r, g, b, a };
  }
  return null;
}

function rgbaStringToRgba(input: string): Rgba | null {
  'worklet';
  const m = input.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i,
  );
  if (!m) return null;
  return {
    r: Number(m[1]),
    g: Number(m[2]),
    b: Number(m[3]),
    a: m[4] != null ? Number(m[4]) : 1,
  };
}

export function parseColor(input: string): Rgba {
  'worklet';
  const s = (input ?? '').trim();
  if (!s) return { r: 0, g: 0, b: 0, a: 1 };
  if (s[0] === '#') {
    return hexToRgba(s) ?? { r: 0, g: 0, b: 0, a: 1 };
  }
  if (s.toLowerCase().startsWith('rgb')) {
    return rgbaStringToRgba(s) ?? { r: 0, g: 0, b: 0, a: 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

export function rgbaToString(c: Rgba): string {
  'worklet';
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  const a = Math.round(clamp01(c.a) * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function lerpColor(from: string, to: string, t: number): string {
  'worklet';
  const a = parseColor(from);
  const b = parseColor(to);
  const u = clamp01(t);
  return rgbaToString({
    r: a.r + (b.r - a.r) * u,
    g: a.g + (b.g - a.g) * u,
    b: a.b + (b.b - a.b) * u,
    a: a.a + (b.a - a.a) * u,
  });
}

export function lerpColorList(
  from: readonly string[],
  to: readonly string[],
  t: number,
): string[] {
  'worklet';
  const len = Math.max(from.length, to.length, 2);
  const out: string[] = [];
  for (let i = 0; i < len; i++) {
    const a = from[Math.min(i, from.length - 1)] ?? '#000000';
    const b = to[Math.min(i, to.length - 1)] ?? a;
    out.push(lerpColor(a, b, t));
  }
  return out;
}
