import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
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
  const [dbError, setDbError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        await initDatabase();
        await loadPersistedIntakeTargets();
        if (mounted) {
          setDbError(null);
          setIsDbReady(true);
        }
      } catch (e) {
        console.warn('数据库初始化失败', e);
        if (mounted) {
          setDbError('数据库初始化失败，请重试。');
          setIsDbReady(false);
        }
      }
    };
    void run();

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
            {dbError ? (
              <View style={{ marginTop: 14, alignItems: 'center', paddingHorizontal: 24 }}>
                <Text style={{ fontSize: 14, fontWeight: '700', opacity: 0.8 }}>{dbError}</Text>
                <Pressable
                  onPress={async () => {
                    setDbError(null);
                    try {
                      await initDatabase();
                      await loadPersistedIntakeTargets();
                      setIsDbReady(true);
                    } catch (e) {
                      console.warn('数据库初始化失败', e);
                      setDbError('数据库初始化失败，请重试。');
                    }
                  }}
                  style={({ pressed }) => ({
                    marginTop: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <Text style={{ fontSize: 14, fontWeight: '800' }}>重试</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="add-frog" />
            <Stack.Screen name="add-task" />
            <Stack.Screen name="edit-task" />
            <Stack.Screen name="add-project" />
            <Stack.Screen name="add-subtask" />
            <Stack.Screen name="add-account" />
            <Stack.Screen name="assets" />
            <Stack.Screen name="vision-wall" />
            <Stack.Screen name="vision-create" />
            <Stack.Screen name="task/[id]" />
            <Stack.Screen name="health-calendar" />
            <Stack.Screen name="intake-history" />
            <Stack.Screen name="finance-calendar" />
            <Stack.Screen name="ai-finance-analysis" />
            <Stack.Screen name="schedule-picker" />
            <Stack.Screen name="edit-profile" />
            <Stack.Screen name="quick-add-edit" />
            <Stack.Screen name="add-item" />
            <Stack.Screen name="category-sort" />
            <Stack.Screen name="modal" options={{ presentation: 'modal', headerShown: true, title: 'Modal' }} />
          </Stack>
        )}
        <StatusBar style="auto" />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
