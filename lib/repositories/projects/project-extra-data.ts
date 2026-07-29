/** 项目 `extra_data` JSON 通用结构（日程、前置依赖等） */
export type ProjectExtraDataBag = {
  schedule?: unknown;
  [key: string]: unknown;
};

export function parseProjectExtraData(raw: string | null): ProjectExtraDataBag {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as ProjectExtraDataBag;
    }
    return {};
  } catch {
    return {};
  }
}
