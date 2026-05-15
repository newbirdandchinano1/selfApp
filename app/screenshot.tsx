import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { setFinanceSheetLaunchIntent } from '@/lib/finance-sheet-launch-intent';
import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ScreenshotFromClipboardScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS === 'web') {
        setLoading(false);
        setError('网页版不支持从剪贴板读取图片');
        return undefined;
      }

      let cancelled = false;

      void (async () => {
        setLoading(true);
        setError(null);
        try {
          const has = await Clipboard.hasImageAsync();
          if (cancelled) return;
          if (!has) {
            setError('剪贴板里没有图片，请先在快捷指令里复制截图再打开链接。');
            return;
          }
          const img = await Clipboard.getImageAsync({ format: 'png' });
          if (cancelled) return;
          if (!img?.data) {
            setError('无法读取剪贴板中的图片。');
            return;
          }

          setFinanceSheetLaunchIntent({ kind: 'auto_ledger_clipboard_image', imageDataUri: img.data });
          router.replace('/(tabs)/finance');
        } catch {
          if (!cancelled) {
            setError('读取剪贴板失败，请检查系统是否允许本应用访问剪贴板。');
          }
        } finally {
          if (!cancelled) {
            setLoading(false);
          }
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [router]),
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: '剪贴板记账',
          headerStyle: { backgroundColor: theme.surface },
          headerTintColor: theme.text,
          headerTitleStyle: { fontWeight: '700' },
          headerLeft: () => (
            <Pressable
              onPress={() => router.back()}
              hitSlop={12}
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, paddingHorizontal: 8, paddingVertical: 4 })}
            >
              <Text style={{ fontSize: 17, color: theme.primary, fontWeight: '600' }}>返回</Text>
            </Pressable>
          ),
        }}
      />
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }} edges={['bottom']}>
        <View style={{ padding: 16, flex: 1 }}>
          <Text style={{ fontSize: 14, color: theme.textSecondary, marginBottom: 16, lineHeight: 21 }}>
            快捷指令使用「打开 URL：zheng://screenshot」后，将读取剪贴板图片并跳转到财务页，由 AI 识别截图后自动记一笔账（默认记入列表中的第一个账户）。
          </Text>

          {loading ? (
            <View style={{ paddingVertical: 48, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={theme.primary} />
              <Text style={{ marginTop: 12, color: theme.textSecondary }}>正在读取剪贴板并打开记账…</Text>
            </View>
          ) : error ? (
            <View
              style={{
                padding: 16,
                borderRadius: 12,
                backgroundColor: theme.surface,
                borderWidth: 1,
                borderColor: 'rgba(148,163,184,0.35)',
              }}
            >
              <Text style={{ color: theme.text, fontSize: 15, lineHeight: 22 }}>{error}</Text>
              <Pressable
                onPress={() => {
                  setError(null);
                  setLoading(true);
                  void (async () => {
                    try {
                      const has = await Clipboard.hasImageAsync();
                      if (!has) {
                        setError('剪贴板里没有图片，请先在快捷指令里复制截图再打开链接。');
                        return;
                      }
                      const img = await Clipboard.getImageAsync({ format: 'png' });
                      if (!img?.data) {
                        setError('无法读取剪贴板中的图片。');
                        return;
                      }
                      setFinanceSheetLaunchIntent({ kind: 'auto_ledger_clipboard_image', imageDataUri: img.data });
                      router.replace('/(tabs)/finance');
                    } catch {
                      setError('读取剪贴板失败，请检查系统是否允许本应用访问剪贴板。');
                    } finally {
                      setLoading(false);
                    }
                  })();
                }}
                style={({ pressed }) => ({
                  marginTop: 14,
                  alignSelf: 'flex-start',
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: theme.primary,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <Text style={{ color: '#fff', fontWeight: '700' }}>重试</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </SafeAreaView>
    </>
  );
}
