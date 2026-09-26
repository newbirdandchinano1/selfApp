import { ApiDebugLogViewer } from '@/components/api-debug-log-viewer';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  isApiDebugEnabled,
  loadApiDebugEnabled,
  probeApiDebugConnection,
  setApiDebugEnabled,
  subscribeApiDebug,
} from '@/lib/api-debug';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** 实时监控 APP 发出的 HTTP 请求与响应，支持复制详情。 */
export default function ApiRequestMonitorScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[colorScheme ?? 'light'];
  const text = theme.text;
  const muted = isDark ? 'rgba(148,163,184,0.85)' : '#64748b';
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const cardBg = isDark ? 'rgba(30,41,59,0.55)' : '#ffffff';
  const cardBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,88,190,0.12)';
  const pageBg = theme.background;

  const [ready, setReady] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [probing, setProbing] = useState(false);

  useEffect(() => {
    let mounted = true;
    void loadApiDebugEnabled().then(v => {
      if (!mounted) return;
      setEnabled(v);
      setReady(true);
    });
    return subscribeApiDebug(() => {
      setEnabled(isApiDebugEnabled());
    });
  }, []);

  const onToggle = useCallback((next: boolean) => {
    void setApiDebugEnabled(next);
  }, []);

  const onProbe = useCallback(async () => {
    if (probing) return;
    if (!isApiDebugEnabled()) {
      await setApiDebugEnabled(true);
    }
    setProbing(true);
    try {
      await probeApiDebugConnection();
    } finally {
      setProbing(false);
    }
  }, [probing]);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: pageBg }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: cardBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerIcon}>
          <MaterialIcons name="arrow-back" size={22} color={text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: text }]}>API 请求监控</Text>
        <View style={styles.headerIcon} />
      </View>

      {!ready ? (
        <View style={styles.centered}>
          <ActivityIndicator color={primary} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowTitle, { color: text }]}>实时记录请求</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  开启后捕获全部 HTTP 请求与返回；切页、下拉刷新也会写入下方列表。可展开单条并复制详情。
                </Text>
              </View>
              <Switch
                value={enabled}
                onValueChange={onToggle}
                trackColor={{ false: outlineVariant, true: primary }}
                thumbColor="#ffffff"
              />
            </View>

            <Pressable
              onPress={() => void onProbe()}
              disabled={probing}
              style={({ pressed }) => [
                styles.probeBtn,
                {
                  borderColor: cardBorder,
                  opacity: probing ? 0.6 : pressed ? 0.85 : 1,
                  marginTop: 12,
                },
              ]}>
              {probing ? (
                <ActivityIndicator size="small" color={primary} />
              ) : (
                <MaterialIcons name="network-check" size={18} color={primary} />
              )}
              <Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>
                {probing ? '探测中…' : '探测连通性（/health）'}
              </Text>
            </Pressable>

            {!enabled ? (
              <Text style={[styles.rowHint, { color: muted, marginTop: 10 }]}>
                当前未开启记录。打开开关后即可实时看到接口调用。
              </Text>
            ) : (
              <Text style={[styles.rowHint, { color: primary, marginTop: 10, fontWeight: '700' }]}>
                监控中 · 角标「API」悬浮球也可打开同一份日志
              </Text>
            )}
          </View>

          <View style={{ flex: 1 }}>
            <ApiDebugLogViewer
              textColor={text}
              mutedColor={muted}
              borderColor={cardBorder}
              cardBg={cardBg}
              primary={primary}
              fill
              emptyHint={
                enabled
                  ? '暂无记录。切换页面或下拉刷新后会自动出现请求。'
                  : '请先打开上方开关，开始记录接口请求。'
              }
            />
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerIcon: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, padding: 12, gap: 12 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontSize: 15, fontWeight: '800' },
  rowHint: { fontSize: 12, lineHeight: 17 },
  probeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
});
