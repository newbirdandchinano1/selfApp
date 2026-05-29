import { AppSettingKey, getAppSetting, setAppSetting } from '@/lib/app-settings-store';

export type IntakeAssistantUiTab = '水分' | '蛋白质' | '碳水' | '钠';
export type IntakeAssistantTabKey = 'hydration' | 'protein' | 'carbohydrate' | 'sodium';
export type IntakeAssistantSuggestKind = 'best' | 'community' | 'manual';

export type IntakeAssistantTabSelection = {
  kind: IntakeAssistantSuggestKind;
  /** 仅 kind === 'manual' 时使用 */
  manualValue?: number;
};

export type IntakeAssistantSelectionState = Partial<Record<IntakeAssistantTabKey, IntakeAssistantTabSelection>>;

const TAB_TO_KEY: Record<IntakeAssistantUiTab, IntakeAssistantTabKey> = {
  水分: 'hydration',
  蛋白质: 'protein',
  碳水: 'carbohydrate',
  钠: 'sodium',
};

const DEFAULT_SELECTION: IntakeAssistantTabSelection = { kind: 'best' };

let cached: IntakeAssistantSelectionState = {};

function isSuggestKind(v: unknown): v is IntakeAssistantSuggestKind {
  return v === 'best' || v === 'community' || v === 'manual';
}

function sanitizeTabSelection(raw: unknown): IntakeAssistantTabSelection | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (!isSuggestKind(o.kind)) return null;
  const next: IntakeAssistantTabSelection = { kind: o.kind };
  if (typeof o.manualValue === 'number' && Number.isFinite(o.manualValue) && o.manualValue >= 0) {
    next.manualValue = Math.round(o.manualValue);
  }
  return next;
}

function sanitizeState(raw: unknown): IntakeAssistantSelectionState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const o = raw as Record<string, unknown>;
  const next: IntakeAssistantSelectionState = {};
  for (const key of Object.values(TAB_TO_KEY)) {
    const sel = sanitizeTabSelection(o[key]);
    if (sel) next[key] = sel;
  }
  return next;
}

async function persistToDisk(): Promise<void> {
  await setAppSetting(AppSettingKey.intakeAssistantSelection, cached);
}

/** 启动时从 app_settings 恢复各 Tab 的智能建议选中项。 */
export async function loadPersistedIntakeAssistantSelections(): Promise<void> {
  const parsed = await getAppSetting<unknown>(AppSettingKey.intakeAssistantSelection);
  cached = sanitizeState(parsed);
}

export function intakeAssistantTabKey(tab: IntakeAssistantUiTab): IntakeAssistantTabKey {
  return TAB_TO_KEY[tab];
}

export function getIntakeAssistantSelection(tab: IntakeAssistantUiTab): IntakeAssistantTabSelection {
  return cached[TAB_TO_KEY[tab]] ?? DEFAULT_SELECTION;
}

export function setIntakeAssistantSelection(
  tab: IntakeAssistantUiTab,
  selection: IntakeAssistantTabSelection,
): void {
  const key = TAB_TO_KEY[tab];
  const next: IntakeAssistantTabSelection = { kind: selection.kind };
  if (
    selection.kind === 'manual' &&
    typeof selection.manualValue === 'number' &&
    Number.isFinite(selection.manualValue) &&
    selection.manualValue >= 0
  ) {
    next.manualValue = Math.round(selection.manualValue);
  }
  cached = { ...cached, [key]: next };
  void persistToDisk().catch(() => {});
}
