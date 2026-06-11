import { scheduleRunScheduledFinanceExpenses } from '@/lib/finance-scheduled-expense-runner';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

type Props = {
  dbReady: boolean;
};

/** 根级挂载：应用启动/回到前台时执行定时支出自动记账。 */
export function ScheduledExpenseCoordinator({ dbReady }: Props) {
  useEffect(() => {
    if (!dbReady || Platform.OS === 'web') return;

    scheduleRunScheduledFinanceExpenses('bootstrap');

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        scheduleRunScheduledFinanceExpenses('active');
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, [dbReady]);

  return null;
}
