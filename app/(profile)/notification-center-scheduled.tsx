import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getNotificationCategoryMeta,
  resolveNotificationCategoryFromIdentifier,
} from '@/lib/notification-catalog';
import {
  deleteScheduledAppNotification,
  getNotificationPermissionSnapshot,
  listScheduledAppNotifications,
  openSystemNotificationSettings,
  requestAppNotificationPermission,
  restoreMutedAppNotification,
  type NotificationPermissionSnapshot,
  type ScheduledAppNotificationItem,
} from '@/lib/notification-center';
import {
  getNotificationCenterSettings,
  type NotificationCenterSettings,
} from '@/lib/notification-center-settings';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function formatMutedLabel(identifier: string): string {
  const category = resolveNotificationCategoryFromIdentifier(identifier);
  if (!category) return identifier;
  const meta = getNotificationCategoryMeta(category);
  const prefix = meta.identifierPrefix;
  if (prefix?.endsWith(':')) {
    const entity = identifier.slice(prefix.length);
    return entity ? `${meta.title} · ${entity.slice(0, 8)}…` : meta.title;
  }
  return meta.title;
}

export default function NotificationCenterScheduledScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const theme = Colors[colorScheme ?? 'light'];
  const text = theme.text;
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const cardBg = isDark ? 'rgba(30,41,59,0.55)' : '#ffffff';
  const cardBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,88,190,0.12)';
  const destructive = isDark ? '#f87171' : '#b91c1c';

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<NotificationCenterSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionSnapshot | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledAppNotificationItem[]>([]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextSettings, nextPerm, nextScheduled] = await Promise.all([
        getNotificationCenterSettings(),
        getNotificationPermissionSnapshot(),
        listScheduledAppNotifications(),
      ]);
      setSettings(nextSettings);
      setPermission(nextPerm);
      setScheduled(nextScheduled);
    } catch (e) {
      console.warn('加载已预约通知失败', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const onDeleteScheduled = useCallback((item: ScheduledAppNotificationItem) => {
    Alert.alert(
      '关闭这条通知',
      `将停止「${item.title}」的推送登记，直到你在本页重新开启。\n\n来源：${item.sourceLabel}`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '关闭',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                await deleteScheduledAppNotification(item.identifier);
                const [nextSettings, nextScheduled] = await Promise.all([
                  getNotificationCenterSettings(),
                  listScheduledAppNotifications(),
                ]);
                setSettings(nextSettings);
                setScheduled(nextScheduled);
              } catch (e) {
                console.warn('关闭预约通知失败', e);
                Alert.alert('操作失败', '请稍后再试');
              } finally {
                setBusy(false);
              }
            })();
          },
        },
      ],
    );
  }, []);

  const onRestoreMuted = useCallback((identifier: string) => {
    void (async () => {
      setBusy(true);
      try {
        await restoreMutedAppNotification(identifier);
        const [nextSettings, nextScheduled] = await Promise.all([
          getNotificationCenterSettings(),
          listScheduledAppNotifications(),
        ]);
        setSettings(nextSettings);
        setScheduled(nextScheduled);
      } catch (e) {
        console.warn('恢复通知失败', e);
        Alert.alert('恢复失败', '请稍后再试');
      } finally {
        setBusy(false);
      }
    })();
  }, []);

  const muted = settings?.mutedIdentifiers ?? [];
  const masterOn = settings?.masterEnabled !== false;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: cardBorder }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerIcon}>
          <MaterialIcons name="arrow-back" size={22} color={text} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: text }]}>已预约与权限</Text>
        <View style={styles.headerIcon} />
      </View>

      {loading || !settings ? (
        <View style={styles.centered}>
          <ActivityIndicator color={primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, gap: 12 }]}>
            <Text style={[styles.rowTitle, { color: text }]}>系统通知权限</Text>
            <Text style={[styles.rowHint, { color: outline }]}>
              {permission?.sandboxDisabled
                ? '当前为 Expo Go：系统不会展示本地通知。'
                : permission?.status === 'granted'
                  ? '已授权。可在本页管理预约列表。'
                  : permission?.status === 'denied'
                    ? '已拒绝。请到系统设置开启通知。'
                    : Platform.OS === 'web'
                      ? 'Web 端不支持本地推送。'
                      : '尚未决定，可请求授权。'}
            </Text>
            {permission &&
            !permission.sandboxDisabled &&
            permission.status !== 'granted' &&
            Platform.OS !== 'web' ? (
              <Pressable
                onPress={() => {
                  void (async () => {
                    const perm = await requestAppNotificationPermission();
                    setPermission(perm);
                    if (perm.status !== 'granted') {
                      await openSystemNotificationSettings();
                    }
                  })();
                }}
                style={({ pressed }) => [
                  styles.secondaryBtn,
                  { borderColor: cardBorder, opacity: pressed ? 0.85 : 1 },
                ]}>
                <MaterialIcons name="notifications-active" size={18} color={primary} />
                <Text style={[styles.secondaryBtnText, { color: primary }]}>
                  请求 / 打开系统通知设置
                </Text>
              </Pressable>
            ) : null}
          </View>

          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, gap: 10 }]}>
            <Text style={[styles.rowTitle, { color: text }]}>已开启的提醒</Text>
            <Text style={[styles.rowHint, { color: outline }]}>
              {Platform.OS === 'web'
                ? 'Web 端无本地推送'
                : `共 ${scheduled.length} 条（健康 / 课程表 / 习惯 / 复盘）`}
            </Text>

            {scheduled.length === 0 ? (
              <Text style={[styles.rowHint, { color: outline }]}>
                {masterOn
                  ? '暂无已开启的提醒。请在通知管理中打开频道与模块提醒后，将出现在此列表。'
                  : '总开关已关闭；开启后可在此管理各来源提醒。'}
              </Text>
            ) : (
              scheduled.map(item => (
                <View
                  key={item.identifier}
                  style={[styles.scheduledItem, { borderColor: cardBorder }]}>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.categoryTitle, { color: text }]} numberOfLines={1}>
                      {item.title}
                    </Text>
                    {item.body ? (
                      <Text style={[styles.rowHint, { color: outline }]} numberOfLines={2}>
                        {item.body}
                      </Text>
                    ) : null}
                    <Text style={[styles.metaLine, { color: outline }]}>
                      来源 · {item.sourceLabel} · {item.fireAtLabel}
                    </Text>
                    <Text
                      style={[
                        styles.metaLine,
                        {
                          color:
                            item.status === 'active'
                              ? primary
                              : item.status === 'muted' || item.status === 'blocked'
                                ? destructive
                                : outline,
                        },
                      ]}>
                      {item.statusLabel}
                    </Text>
                    {item.customizeHref ? (
                      <Pressable
                        onPress={() => router.push(item.customizeHref as never)}
                        style={({ pressed }) => [
                          styles.linkRow,
                          { opacity: pressed ? 0.8 : 1, marginTop: 2 },
                        ]}>
                        <MaterialIcons name="place" size={15} color={primary} />
                        <Text style={[styles.linkText, { color: primary }]}>查看来源功能</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {item.status === 'muted' ? (
                    <Pressable
                      onPress={() => onRestoreMuted(item.identifier)}
                      disabled={busy}
                      style={({ pressed }) => [
                        styles.secondaryBtn,
                        {
                          borderColor: cardBorder,
                          paddingHorizontal: 8,
                          paddingVertical: 6,
                          opacity: pressed || busy ? 0.75 : 1,
                        },
                      ]}>
                      <Text style={[styles.secondaryBtnText, { color: primary, fontSize: 12 }]}>
                        开启
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => onDeleteScheduled(item)}
                      disabled={busy}
                      hitSlop={8}
                      style={({ pressed }) => [
                        styles.deleteBtn,
                        {
                          borderColor: isDark ? 'rgba(248,113,113,0.4)' : 'rgba(185,28,28,0.3)',
                          opacity: pressed || busy ? 0.7 : 1,
                        },
                      ]}
                      accessibilityLabel="关闭这条通知">
                      <MaterialIcons name="delete-outline" size={18} color={destructive} />
                    </Pressable>
                  )}
                </View>
              ))
            )}

            {muted.filter(id => !scheduled.some(s => s.identifier === id)).length > 0 ? (
              <View style={{ gap: 8, marginTop: 4 }}>
                <Text style={[styles.rowTitle, { color: text, fontSize: 14 }]}>其它已关闭项</Text>
                {muted
                  .filter(id => !scheduled.some(s => s.identifier === id))
                  .map(id => (
                    <View
                      key={id}
                      style={[styles.scheduledItem, { borderColor: cardBorder, opacity: 0.9 }]}>
                      <Text style={[styles.rowHint, { color: outline, flex: 1 }]} numberOfLines={2}>
                        {formatMutedLabel(id)}
                      </Text>
                      <Pressable
                        onPress={() => onRestoreMuted(id)}
                        disabled={busy}
                        style={({ pressed }) => [
                          styles.secondaryBtn,
                          {
                            borderColor: cardBorder,
                            paddingHorizontal: 10,
                            paddingVertical: 6,
                            opacity: pressed || busy ? 0.75 : 1,
                          },
                        ]}>
                        <Text style={[styles.secondaryBtnText, { color: primary, fontSize: 12 }]}>
                          重新开启
                        </Text>
                      </Pressable>
                    </View>
                  ))}
              </View>
            ) : null}

            <Pressable
              onPress={() => void reload()}
              disabled={busy || loading}
              style={({ pressed }) => [
                styles.secondaryBtn,
                { borderColor: cardBorder, opacity: pressed || busy ? 0.75 : 1 },
              ]}>
              {busy ? (
                <ActivityIndicator size="small" color={primary} />
              ) : (
                <MaterialIcons name="refresh" size={18} color={text} />
              )}
              <Text style={[styles.secondaryBtnText, { color: text }]}>刷新列表</Text>
            </Pressable>
          </View>
          <View style={{ height: 28 }} />
        </ScrollView>
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
  headerIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700' },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 12 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowHint: { fontSize: 12, lineHeight: 17 },
  categoryTitle: { fontSize: 14, fontWeight: '700' },
  metaLine: { fontSize: 11 },
  scheduledItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 10,
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700' },
  deleteBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  linkText: { fontSize: 12, fontWeight: '700' },
});
