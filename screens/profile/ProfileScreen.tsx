import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { usePageFocusReload } from '@/hooks/use-page-focus-reload';
import { Spacing } from '@/constants/design-tokens';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { subscribePointsBalanceChanged } from '@/lib/points-balance-events';
import { getPointsBalance } from '@/lib/repositories/points/points';
import { getDefaultUser, subscribeDefaultUserUpdates } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { formatPoints } from '@/lib/reward-points';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAGE_API_KEY = 'tabs/profile';

type ProfileMenuItem = {
  key: string;
  title: string;
  subtitle: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  href: '/wish-board' | '/points-ledger' | '/memo-list' | '/my-recipes';
};

const PROFILE_MENU: ProfileMenuItem[] = [
  {
    key: 'wish-board',
    title: '心愿板',
    subtitle: '用积分兑换心愿',
    icon: 'card-giftcard',
    href: '/wish-board',
  },
  {
    key: 'points-ledger',
    title: '积分记录',
    subtitle: '查看全部积分流水',
    icon: 'receipt-long',
    href: '/points-ledger',
  },
  {
    key: 'memo-list',
    title: '备忘录',
    subtitle: '笔记与维度整理',
    icon: 'sticky-note-2',
    href: '/memo-list',
  },
  {
    key: 'my-recipes',
    title: '我的菜谱',
    subtitle: '收藏与自建菜谱',
    icon: 'restaurant-menu',
    href: '/my-recipes',
  },
];

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { wrapLoad, resetSync } = usePageApiSync(PAGE_API_KEY);
  const markPageDirty = resetSync;
  const reloadPageRef = useRef<((forceApi?: boolean) => Promise<void>) | null>(null);
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';
  const [user, setUser] = useState<UserRow | null>(null);
  const [pointsBalance, setPointsBalance] = useState(0);

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? theme.surface : '#ffffff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';

  const displayName = user?.name?.trim() || '默认用户';
  const heightText = user?.height ? String(user.height) : '0';
  const weightText = user?.weight ? String(user.weight) : '0';
  const ageText = user?.age ? String(user.age) : '0';
  const bmiText =
    user && user.height > 0 && user.weight > 0
      ? (user.weight / ((user.height / 100) * (user.height / 100))).toFixed(1)
      : '0.0';

  const loadUser = useCallback(async () => {
    try {
      const currentUser = await getDefaultUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    }
  }, []);

  const loadPoints = useCallback(async () => {
    try {
      const balance = await getPointsBalance();
      setPointsBalance(balance);
    } catch {
      // keep last known balance
    }
  }, []);

  const reloadPage = useCallback(
    async (forceApi = false) => {
      try {
        await wrapLoad(async () => {
          await Promise.all([loadUser(), loadPoints()]);
        }, forceApi);
      } catch {
        // ignore
      }
    },
    [wrapLoad, loadUser, loadPoints],
  );
  reloadPageRef.current = reloadPage;

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reloadPage);

  const onProfileAction = useCallback(
    (action: () => void) => {
      markPageDirty();
      action();
    },
    [markPageDirty],
  );

  usePageFocusReload(PAGE_API_KEY, (forceApi) => {
    void reloadPageRef.current?.(forceApi).catch((e) => {
      if (__DEV__) console.warn('[profile] reload failed', e);
    });
  });

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      const unsubscribeUser = subscribeDefaultUserUpdates(() => {
        if (cancelled) return;
        void loadUser();
      });
      const unsubscribePoints = subscribePointsBalanceChanged((balance) => {
        if (cancelled) return;
        setPointsBalance(balance);
      });
      return () => {
        cancelled = true;
        unsubscribeUser();
        unsubscribePoints();
      };
    }, [loadUser]),
  );

  useEffect(() => {
    void loadUser();
    void loadPoints();
  }, [loadUser, loadPoints]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScrollView
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          { paddingBottom: 36 + Math.max(insets.bottom, 12) },
        ]}>
        <View
          style={[styles.header, { backgroundColor: isDark ? surface : '#ffffff' }]}>
          <View style={[styles.headerBlob, { backgroundColor: `${primary}12` }]} />

          <View style={styles.headerActions}>
            <Text style={[styles.name, { color: text }]} numberOfLines={1}>
              {displayName}
            </Text>
            <Pressable
              onPress={() => onProfileAction(() => router.push('/edit-profile'))}
              style={[
                styles.editProfileBtn,
                { borderColor: `${primary}30`, backgroundColor: `${primary}10` },
              ]}>
              <MaterialIcons name="edit" size={18} color={primary} />
              <Text style={[styles.editProfileBtnText, { color: primary }]}>编辑个人信息</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => onProfileAction(() => router.push('/wish-board'))}
            accessibilityRole="button"
            accessibilityLabel={`当前积分 ${formatPoints(pointsBalance)}，打开心愿板`}
            style={({ pressed }) => [
              styles.pointsChip,
              {
                backgroundColor: isDark ? 'rgba(251,191,36,0.14)' : 'rgba(251,191,36,0.12)',
                borderColor: isDark ? 'rgba(251,191,36,0.28)' : 'rgba(217,119,6,0.22)',
                opacity: pressed ? 0.85 : 1,
              },
            ]}>
            <MaterialIcons name="stars" size={18} color="#f59e0b" />
            <Text style={[styles.pointsChipValue, { color: text }]}>
              {formatPoints(pointsBalance)}
            </Text>
            <Text style={[styles.pointsChipHint, { color: outline }]}>心愿板</Text>
            <MaterialIcons name="chevron-right" size={20} color={outline} />
          </Pressable>

          <View style={[styles.statsRow, { borderTopColor: outlineVariant }]}>
            {[
              { label: '身高', value: heightText, unit: 'cm' },
              { label: '体重', value: weightText, unit: 'kg' },
              { label: 'BMI', value: bmiText, unit: '' },
              { label: '年龄', value: ageText, unit: '' },
            ].map((item, idx) => (
              <View
                key={item.label}
                style={[
                  styles.statCell,
                  idx > 0 && { borderLeftWidth: 1, borderLeftColor: outlineVariant },
                ]}>
                <Text style={[styles.statLabel, { color: outline }]}>{item.label}</Text>
                <Text style={[styles.statValue, { color: text }]}>
                  {item.value}
                  {!!item.unit && (
                    <Text style={[styles.statUnit, { color: outline }]}> {item.unit}</Text>
                  )}
                </Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.menuSection}>
          {PROFILE_MENU.map((item) => (
            <Pressable
              key={item.key}
              onPress={() => onProfileAction(() => router.push(item.href))}
              style={({ pressed }) => [
                styles.menuRow,
                {
                  backgroundColor: surface,
                  borderColor: outlineVariant,
                  opacity: pressed ? 0.88 : 1,
                },
              ]}>
              <View style={[styles.menuIconWrap, { backgroundColor: `${primary}12` }]}>
                <MaterialIcons name={item.icon} size={22} color={primary} />
              </View>
              <View style={styles.menuTextWrap}>
                <Text style={[styles.menuTitle, { color: text }]}>{item.title}</Text>
                <Text style={[styles.menuSubtitle, { color: outline }]}>{item.subtitle}</Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingTop: 0,
  },
  header: {
    paddingHorizontal: Spacing.md,
    paddingTop: 58,
    paddingBottom: 20,
    overflow: 'hidden',
  },
  headerBlob: {
    position: 'absolute',
    top: -40,
    right: -40,
    width: 160,
    height: 160,
    borderRadius: 999,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  name: {
    flex: 1,
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  editProfileBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
  },
  editProfileBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  pointsChip: {
    marginTop: 16,
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pointsChipValue: {
    fontSize: 18,
    fontWeight: '900',
  },
  pointsChipHint: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
  },
  statsRow: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: 1,
    flexDirection: 'row',
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  statValue: {
    fontSize: 20,
    fontWeight: '900',
  },
  statUnit: {
    fontSize: 10,
    fontWeight: '700',
  },
  menuSection: {
    marginTop: 16,
    paddingHorizontal: Spacing.md,
    gap: 10,
  },
  menuRow: {
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuTextWrap: {
    flex: 1,
    gap: 2,
  },
  menuTitle: {
    fontSize: 16,
    fontWeight: '800',
  },
  menuSubtitle: {
    fontSize: 12,
    fontWeight: '600',
  },
});
