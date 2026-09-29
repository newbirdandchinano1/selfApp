/**
 * 强提醒全屏处置页：完成（确认并清升级链）/ 贪睡 / 打开详情 / 稍后。
 */

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import type { NotificationCategoryId } from '@/lib/notification-catalog';
import {
  navigateByNotificationType,
  resyncReminderAfterAcknowledge,
} from '@/lib/notification-navigate';
import {
  acknowledgeStrongReminder,
  parseStrongReminderPayload,
  snoozeStrongReminder,
  STRONG_SNOOZE_MINUTES,
} from '@/lib/notification-strong-reminder';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ReminderDisposeScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const params = useLocalSearchParams<{ payload?: string }>();
  const [busy, setBusy] = useState(false);

  const payload = useMemo(
    () => parseStrongReminderPayload(params.payload),
    [params.payload],
  );

  const primary = isDark ? '#93c5fd' : '#0b3d91';
  const danger = isDark ? '#fca5a5' : '#b42318';
  const surface = isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.92)';
  const muted = isDark ? 'rgba(226,232,240,0.72)' : 'rgba(30,41,59,0.65)';

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      console.warn('强提醒处置失败', e);
    } finally {
      setBusy(false);
    }
  };

  if (!payload) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <View style={styles.centered}>
          <Text style={[styles.title, { color: theme.text }]}>提醒已失效</Text>
          <Pressable onPress={close} style={[styles.secondaryBtn, { borderColor: muted }]}>
            <Text style={[styles.secondaryBtnText, { color: theme.text }]}>返回</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const category = (
    typeof payload.data.category === 'string' ? payload.data.category : null
  ) as NotificationCategoryId | null;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <View
        style={[
          styles.glow,
          {
            backgroundColor: isDark ? 'rgba(59,130,246,0.18)' : 'rgba(11,61,145,0.10)',
          },
        ]}
      />
      <View style={styles.header}>
        <Pressable onPress={close} hitSlop={12} disabled={busy}>
          <MaterialIcons name="close" size={26} color={theme.text} />
        </Pressable>
        <Text style={[styles.headerLabel, { color: muted }]}>强提醒</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={[styles.card, { backgroundColor: surface }]}>
        <View style={[styles.iconWrap, { backgroundColor: isDark ? 'rgba(59,130,246,0.25)' : 'rgba(11,61,145,0.12)' }]}>
          <MaterialIcons name="notifications-active" size={36} color={primary} />
        </View>
        <Text style={[styles.title, { color: theme.text }]}>{payload.title}</Text>
        {payload.body ? (
          <Text style={[styles.body, { color: muted }]}>{payload.body}</Text>
        ) : null}
      </View>

      <View style={styles.actions}>
        <Pressable
          disabled={busy}
          onPress={() =>
            void run(async () => {
              await acknowledgeStrongReminder(payload.baseIdentifier);
              resyncReminderAfterAcknowledge(payload.data);
              close();
              navigateByNotificationType(router, payload.data);
            })
          }
          style={({ pressed }) => [
            styles.primaryBtn,
            { backgroundColor: primary, opacity: busy ? 0.6 : pressed ? 0.9 : 1 },
          ]}>
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.primaryBtnText}>完成</Text>
          )}
        </Pressable>

        <Pressable
          disabled={busy || !category}
          onPress={() =>
            void run(async () => {
              if (!category) return;
              const channelId =
                typeof payload.data.channelId === 'string'
                  ? payload.data.channelId
                  : 'strong-reminders';
              const channelName =
                typeof payload.data.channelName === 'string'
                  ? payload.data.channelName
                  : '强提醒';
              const importance =
                payload.data.channelImportance === 'high'
                  ? ('high' as const)
                  : ('default' as const);
              await snoozeStrongReminder({
                category,
                baseIdentifier: payload.baseIdentifier,
                channel: { id: channelId, name: channelName, importance },
                data: payload.data,
                fallback: {
                  title: payload.title,
                  body: payload.body.replace(/^再次提醒：/, ''),
                },
                fingerprint:
                  typeof payload.data.fingerprint === 'string'
                    ? payload.data.fingerprint
                    : payload.baseIdentifier,
                contextBlock:
                  typeof payload.data.contextBlock === 'string'
                    ? payload.data.contextBlock
                    : '【频道】强提醒贪睡',
              });
              close();
            })
          }
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: primary, opacity: busy || !category ? 0.5 : pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.secondaryBtnText, { color: primary }]}>
            贪睡 {STRONG_SNOOZE_MINUTES} 分钟
          </Text>
        </Pressable>

        <Pressable
          disabled={busy}
          onPress={() => {
            close();
            navigateByNotificationType(router, payload.data);
          }}
          style={({ pressed }) => [
            styles.secondaryBtn,
            { borderColor: muted, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.secondaryBtnText, { color: theme.text }]}>打开详情</Text>
        </Pressable>

        <Pressable disabled={busy} onPress={close} hitSlop={8}>
          <Text style={[styles.later, { color: danger }]}>稍后处理（保留再次提醒）</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  glow: {
    position: 'absolute',
    top: -80,
    left: -40,
    right: -40,
    height: 280,
    borderRadius: 280,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 20,
    padding: 24,
  },
  card: {
    marginHorizontal: 24,
    marginTop: 28,
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 14,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  actions: {
    marginTop: 'auto',
    paddingHorizontal: 24,
    paddingBottom: 24,
    gap: 12,
  },
  primaryBtn: {
    minHeight: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryBtn: {
    minHeight: 50,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  later: {
    marginTop: 8,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '500',
  },
});
