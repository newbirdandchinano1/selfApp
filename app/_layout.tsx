import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { initDatabase } from '@/lib/database';
import { loadPersistedIntakeTargets } from '@/lib/global-intake-targets';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [isDbReady, setIsDbReady] = useState(false);

  useEffect(() => {
    let mounted = true;

    Promise.all([initDatabase().catch(() => {}), loadPersistedIntakeTargets().catch(() => {})]).finally(() => {
      if (mounted) setIsDbReady(true);
    });

    return () => {
      mounted = false;
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        {!isDbReady ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator size="large" />
          </View>
        ) : (
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="add-frog" options={{ headerShown: false }} />
            <Stack.Screen name="add-task" options={{ headerShown: false }} />
            <Stack.Screen name="add-subtask" options={{ headerShown: false }} />
            <Stack.Screen name="add-account" options={{ headerShown: false }} />
            <Stack.Screen name="assets" options={{ headerShown: false }} />
            <Stack.Screen name="vision-wall" options={{ headerShown: false }} />
            <Stack.Screen name="vision-create" options={{ headerShown: false }} />
            <Stack.Screen name="task/[id]" options={{ headerShown: false }} />
            <Stack.Screen name="health-calendar" options={{ headerShown: false }} />
            <Stack.Screen name="intake-history" options={{ headerShown: false }} />
            <Stack.Screen name="finance-calendar" options={{ headerShown: false }} />
            <Stack.Screen name="ai-finance-analysis" options={{ headerShown: false }} />
            <Stack.Screen name="schedule-picker" options={{ headerShown: false }} />
            <Stack.Screen name="edit-profile" options={{ headerShown: false }} />
            <Stack.Screen name="quick-add-edit" options={{ headerShown: false }} />
            <Stack.Screen name="add-item" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
        )}
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
