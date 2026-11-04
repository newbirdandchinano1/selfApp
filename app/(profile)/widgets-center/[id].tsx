import WidgetsFinanceGlanceDetailScreen from '@/screens/profile/WidgetsFinanceGlanceDetailScreen';
import WidgetsFrogScheduleDetailScreen from '@/screens/profile/WidgetsFrogScheduleDetailScreen';
import WidgetsHabitsTodayDetailScreen from '@/screens/profile/WidgetsHabitsTodayDetailScreen';
import WidgetsHealthIntakeDetailScreen from '@/screens/profile/WidgetsHealthIntakeDetailScreen';
import WidgetsUrgencyDetailScreen from '@/screens/profile/WidgetsUrgencyDetailScreen';
import { Redirect, useLocalSearchParams } from 'expo-router';

export default function WidgetsCenterDetailRoute() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  if (id === 'frog-schedule') {
    return <WidgetsFrogScheduleDetailScreen />;
  }
  if (id === 'habits-today') {
    return <WidgetsHabitsTodayDetailScreen />;
  }
  if (id === 'health-intake') {
    return <WidgetsHealthIntakeDetailScreen />;
  }
  if (id === 'finance-glance') {
    return <WidgetsFinanceGlanceDetailScreen />;
  }
  if (id === 'urgency') {
    return <WidgetsUrgencyDetailScreen />;
  }
  return <Redirect href="/widgets-center" />;
}
