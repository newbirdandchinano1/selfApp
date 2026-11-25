/** 后端 authorColor 常为 Tailwind 类名（如 bg-cyan-500），映射成可渲染色值 */
const TAILWIND_BG: Record<string, string> = {
  'bg-cyan-500': '#06B6D4',
  'bg-sky-500': '#0EA5E9',
  'bg-blue-500': '#3B82F6',
  'bg-indigo-500': '#6366F1',
  'bg-violet-500': '#8B5CF6',
  'bg-purple-500': '#A855F7',
  'bg-fuchsia-500': '#D946EF',
  'bg-pink-500': '#EC4899',
  'bg-rose-500': '#F43F5E',
  'bg-red-500': '#EF4444',
  'bg-orange-500': '#F97316',
  'bg-amber-500': '#F59E0B',
  'bg-yellow-500': '#EAB308',
  'bg-lime-500': '#84CC16',
  'bg-green-500': '#22C55E',
  'bg-emerald-500': '#10B981',
  'bg-teal-500': '#14B8A6',
  'bg-slate-500': '#64748B',
  'bg-gray-500': '#6B7280',
  'bg-zinc-500': '#71717A',
  'bg-stone-500': '#78716C',
};

export function resolveAvatarColor(raw?: string | null, fallback = '#5F8A6E'): string {
  if (!raw) return fallback;
  const trimmed = raw.trim();
  if (trimmed.startsWith('#') || trimmed.startsWith('rgb')) return trimmed;
  return TAILWIND_BG[trimmed] || fallback;
}
