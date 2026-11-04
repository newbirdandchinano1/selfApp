/** 一并刷新已落地的桌面组件（青蛙 + 习惯 + 健康 + 财务 + 紧急度） */
import { Platform } from 'react-native';

import { scheduleFinanceGlanceWidgetSync } from '@/lib/widgets/finance-glance-widget-sync';
import { scheduleFrogScheduleWidgetSync } from '@/lib/widgets/frog-schedule-widget-sync';
import { scheduleHabitsTodayWidgetSync } from '@/lib/widgets/habits-today-widget-sync';
import { scheduleHealthIntakeWidgetSync } from '@/lib/widgets/health-intake-widget-sync';
import { scheduleUrgencyWidgetSync } from '@/lib/widgets/urgency-widget-sync';

export function scheduleAllHomeWidgetsSync(reason: string): void {
  if (Platform.OS !== 'ios') return;
  scheduleFrogScheduleWidgetSync(reason);
  scheduleHabitsTodayWidgetSync(reason);
  scheduleHealthIntakeWidgetSync(reason);
  scheduleFinanceGlanceWidgetSync(reason);
  scheduleUrgencyWidgetSync(reason);
}
