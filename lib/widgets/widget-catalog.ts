/**
 * 桌面组件控制中心 · 显示名与深链（与 app.json expo-widgets displayName 保持一致）。
 */

export type WidgetBusinessId =
  | 'frog-schedule'
  | 'habits-today'
  | 'health-intake'
  | 'finance-glance'
  | 'urgency';

export const WIDGET_DISPLAY_NAMES: Record<WidgetBusinessId, string> = {
  'frog-schedule': '今日青蛙',
  'habits-today': '今日习惯',
  'health-intake': '健康摄入',
  'finance-glance': '财务一眼',
  urgency: '紧急度',
};

/** App 内「打开对应页试试」路由 */
export const WIDGET_TRY_OPEN_HREF: Record<WidgetBusinessId, string> = {
  'frog-schedule': '/(tabs)/tasks',
  'habits-today': '/(tabs)/tasks',
  'health-intake': '/(tabs)/',
  'finance-glance': '/(tabs)/finance',
  urgency: '/(tabs)/tasks',
};

export function widgetHowToAddSteps(displayName: string): string {
  return [
    '1. 长按主屏空白处 → 编辑 → 添加小组件',
    `2. 搜索「${displayName}」`,
    '3. 选小 / 中号或锁屏尺寸后添加',
    '锁屏：进入锁屏编辑 → 添加工具 → 同样搜索上述名称',
    '需使用 development / 正式包；Expo Go 不支持。',
  ].join('\n');
}
