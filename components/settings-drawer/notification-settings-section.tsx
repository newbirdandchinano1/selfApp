import { useSettingsDrawer } from '@/components/settings-drawer/settings-drawer-context';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  NOTIFICATION_CATEGORIES,
  getNotificationCategoryMeta,
  resolveNotificationCategoryFromIdentifier,
  type NotificationCategoryId,
} from '@/lib/notification-catalog';
import {
  deleteScheduledAppNotification,
  getNotificationPermissionSnapshot,
  listScheduledAppNotifications,
  openSystemNotificationSettings,
  requestAppNotificationPermission,
  resyncAppNotificationsAfterPreferenceChange,
  restoreMutedAppNotification,
  type NotificationPermissionSnapshot,
  type ScheduledAppNotificationItem,
} from '@/lib/notification-center';
import {
  getNotificationCenterSettings,
  patchNotificationCenterSettings,
  type NotificationCategoryPrefs,
  type NotificationCenterSettings,
} from '@/lib/notification-center-settings';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

type Props = {
  cardBg: string;
  cardBorder: string;
  text: string;
  outline: string;
  outlineVariant: string;
  primary: string;
  isDark: boolean;
};

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

export function NotificationSettingsSection({
  cardBg,
  cardBorder,
  text,
  outline,
  outlineVariant,
  primary,
  isDark,
}: Props) {
  const router = useRouter();
  const { close: closeSettingsDrawer, isOpen } = useSettingsDrawer();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<NotificationCenterSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionSnapshot | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledAppNotificationItem[]>([]);
  const [listExpanded, setListExpanded] = useState(true);

  const reload = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
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
      console.warn('加载通知中心失败', e);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (isOpen) void reload({ silent: true });
  }, [isOpen, reload]);

  const applySettings = useCallback(async (next: NotificationCenterSettings) => {
    setSettings(next);
    setBusy(true);
    try {
      await resyncAppNotificationsAfterPreferenceChange(next);
      const nextScheduled = await listScheduledAppNotifications();
      setScheduled(nextScheduled);
    } catch (e) {
      console.warn('应用通知偏好失败', e);
      Alert.alert('同步失败', '通知偏好已保存，但重新登记提醒时出错，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }, []);

  const onMasterToggle = useCallback(
    async (enabled: boolean) => {
      if (!settings) return;
      setBusy(true);
      try {
        if (enabled && Platform.OS !== 'web' && permission?.status !== 'granted') {
          const perm = await requestAppNotificationPermission();
          setPermission(perm);
          if (perm.status !== 'granted') {
            Alert.alert(
              '需要通知权限',
              perm.sandboxDisabled
                ? 'Expo Go 沙盒环境不会展示本地通知。请使用开发构建或正式包。'
                : '请在系统设置中为本应用开启通知后，再打开总开关。',
              perm.sandboxDisabled
                ? [{ text: '知道了' }]
                : [
                    { text: '取消', style: 'cancel' },
                    { text: '打开系统设置', onPress: () => void openSystemNotificationSettings() },
                  ],
            );
            setBusy(false);
            return;
          }
        }
        const next = await patchNotificationCenterSettings({ masterEnabled: enabled });
        await applySettings(next);
      } catch (e) {
        console.warn('切换通知总开关失败', e);
        Alert.alert('保存失败', '请稍后再试');
        setBusy(false);
      }
    },
    [applySettings, permission?.status, settings],
  );

  const onCategoryToggle = useCallback(
    async (id: NotificationCategoryId, enabled: boolean) => {
      if (!settings) return;
      setBusy(true);
      try {
        const categoryPatch = { [id]: enabled } as Partial<NotificationCategoryPrefs>;
        const next = await patchNotificationCenterSettings({
          categories: categoryPatch,
        });
        await applySettings(next);
      } catch (e) {
        console.warn('切换通知频道失败', e);
        Alert.alert('保存失败', '请稍后再试');
        setBusy(false);
      }
    },
    [applySettings, settings],
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

  const goCustomize = useCallback(
    (href: string) => {
      closeSettingsDrawer();
      router.push(href as never);
    },
    [closeSettingsDrawer, router],
  );

  const masterOn = settings?.masterEnabled !== false;
  const muted = settings?.mutedIdentifiers ?? [];
  const destructive = isDark ? '#f87171' : '#b91c1c';

  return (
    <View style={styles.wrap}>
      {loading || !settings ? (
        <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
          <ActivityIndicator size="small" color={primary} />
        </View>
      ) : (
        <>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, gap: 12 }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowTitle, { color: text }]}>启用通知</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  关闭后将取消全部本地预约提醒，并停止新的推送登记。
                </Text>
                {permission ? (
                  <Text style={[styles.rowHint, { color: outline, marginTop: 6, fontSize: 11 }]}>
                    {permission.sandboxDisabled
                      ? '当前为 Expo Go：系统不会展示本地通知。'
                      : permission.status === 'granted'
                        ? '系统通知权限：已授权'
                        : permission.status === 'denied'
                          ? '系统通知权限：已拒绝'
                          : Platform.OS === 'web'
                            ? 'Web 端不支持本地推送'
                            : '系统通知权限：未决定'}
                  </Text>
                ) : null}
              </View>
              <Switch
                value={masterOn}
                disabled={busy || Platform.OS === 'web'}
                onValueChange={v => {
                  void onMasterToggle(v);
                }}
                trackColor={{ false: outlineVariant, true: primary }}
                thumbColor="#ffffff"
              />
            </View>

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
                <Text style={[styles.secondaryBtnText, { color: primary }]}>请求 / 打开系统通知设置</Text>
              </Pressable>
            ) : null}
          </View>

          <View
            style={[
              styles.card,
              {
                backgroundColor: cardBg,
                borderColor: cardBorder,
                gap: 10,
                opacity: masterOn ? 1 : 0.55,
              },
            ]}
            pointerEvents={masterOn ? 'auto' : 'none'}>
            <Text style={[styles.rowTitle, { color: text }]}>自定义推送频道</Text>
            <Text style={[styles.rowHint, { color: outline }]}>
              按来源功能开关某一类消息；关闭后对应预约会被取消。
            </Text>
            {NOTIFICATION_CATEGORIES.map(cat => {
              const enabled = settings.categories[cat.id] !== false;
              return (
                <View key={cat.id} style={styles.categoryBlock}>
                  <View style={styles.rowBetween}>
                    <View style={{ flex: 1, paddingRight: 10 }}>
                      <Text style={[styles.categoryTitle, { color: text }]}>{cat.title}</Text>
                      <Text style={[styles.rowHint, { color: outline, marginTop: 2 }]}>
                        来源：{cat.sourceLabel} · {cat.description}
                      </Text>
                    </View>
                    <Switch
                      value={enabled}
                      disabled={busy}
                      onValueChange={v => {
                        void onCategoryToggle(cat.id, v);
                      }}
                      trackColor={{ false: outlineVariant, true: primary }}
                      thumbColor="#ffffff"
                    />
                  </View>
                  <Pressable
                    onPress={() => goCustomize(cat.customizeHref)}
                    style={({ pressed }) => [styles.linkRow, { opacity: pressed ? 0.8 : 1 }]}>
                    <MaterialIcons name="open-in-new" size={16} color={primary} />
                    <Text style={[styles.linkText, { color: primary }]}>{cat.customizeLabel}</Text>
                  </Pressable>
                </View>
              );
            })}
          </View>

          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, gap: 10 }]}>
            <Pressable
              onPress={() => setListExpanded(v => !v)}
              style={styles.rowBetween}
              accessibilityRole="button">
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={[styles.rowTitle, { color: text }]}>已开启的提醒</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  {Platform.OS === 'web'
                    ? 'Web 端无本地推送'
                    : `共 ${scheduled.length} 条（来自待办 / 习惯 / 复盘配置）`}
                </Text>
              </View>
              <MaterialIcons
                name={listExpanded ? 'expand-less' : 'expand-more'}
                size={22}
                color={outline}
              />
            </Pressable>

            {listExpanded ? (
              scheduled.length === 0 ? (
                <Text style={[styles.rowHint, { color: outline }]}>
                  {masterOn
                    ? '暂无已开启的提醒。请在任务、习惯或复盘设置中打开提醒后，将出现在此列表。'
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
                          onPress={() => goCustomize(item.customizeHref!)}
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
              )
            ) : null}

            {muted.filter(id => !scheduled.some(s => s.identifier === id)).length > 0 ? (
              <View style={{ gap: 8, marginTop: 4 }}>
                <Text style={[styles.rowTitle, { color: text, fontSize: 14 }]}>其它已关闭项</Text>
                <Text style={[styles.rowHint, { color: outline }]}>
                  来源提醒可能已关闭，但仍保留关闭记录，可清除或重新开启。
                </Text>
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
                <MaterialIcons name="refresh" size={18} color={theme.text} />
              )}
              <Text style={[styles.secondaryBtnText, { color: text }]}>刷新列表</Text>
            </Pressable>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  card: { borderRadius: 12, borderWidth: 1, padding: 14 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontSize: 15, fontWeight: '800' },
  rowHint: { fontSize: 12, lineHeight: 17 },
  categoryBlock: {
    gap: 6,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(148,163,184,0.25)',
  },
  categoryTitle: { fontSize: 14, fontWeight: '800' },
  linkRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  linkText: { fontSize: 12, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: 13, fontWeight: '700' },
  scheduledItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  metaLine: { fontSize: 11, lineHeight: 15 },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
