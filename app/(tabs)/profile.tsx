import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { shouldSkipPageFocusApiRefresh } from '@/lib/page-api-session';
import { getRollingSevenDayRange } from '@/lib/repositories/insights/weekly-review';
import { getWeeklyReviewJournalByWeek } from '@/lib/repositories/insights/weekly-review-journal';
import { getWeeklyReviewConfiguredWeekday, WEEKLY_REVIEW_WEEKDAY_LABELS } from '@/lib/weekly-review-settings';
import type { WeeklyReviewJournalRow } from '@/lib/repositories/insights/weekly-review-journal.types';
import { listWishItems } from '@/lib/repositories/wish-list/wish-list';
import type { WishItemRow } from '@/lib/repositories/wish-list/wish-list.types';
import { listVisions } from '@/lib/repositories/visions/vision';
import { visionRowToProfileCarouselItem } from '@/lib/repositories/visions/vision-present';
import { getHealthRecordsLast7Days } from '@/lib/repositories/health/health';
import { computeHealthCardPreview, getIntakeTargetsSnapshot } from '@/lib/persona-health-context';
import { localLogicalTodayYmd } from '@/lib/persona-portrait-sync';
import { getDefaultUser, subscribeDefaultUserUpdates } from '@/lib/repositories/users/user';
import type { ProfileVisionCarouselItem } from '@/lib/visions-registry';
import type { UserRow } from '@/lib/repositories/users/user.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import {
  Animated,
  Dimensions,
  FlatList,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const VISION_CARD_WIDTH = SCREEN_WIDTH - 36;

const WISH_PROFILE_PREVIEW_MAX = 12;

function formatWishCny(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '¥ 0';
  return `¥ ${Math.round(value).toLocaleString('zh-CN')}`;
}

function weeklyJournalStatusText(row: WeeklyReviewJournalRow | null): string {
  if (!row) return '尚未记录本周复盘';
  const anyText = [
    row.section_summary,
    row.section_plans,
    row.section_reflect,
    row.section_learnings,
    row.section_next_week,
  ].some(s => (s ?? '').trim().length > 0);
  if ((row.ai_coaching ?? '').trim()) return '已生成 AI 建议，可随时回去修改';
  if (anyText) return '草稿已保存，可继续填写并生成建议';
  return '点开写下你的本周故事';
}

function wishListIconForRow(row: WishItemRow): ComponentProps<typeof MaterialIcons>['name'] {
  const id = row.category_id ?? '';
  const lab = (row.category_label ?? '').toLowerCase();
  if (id.includes('数码') || lab.includes('数码')) return 'devices';
  if (id.includes('家居') || lab.includes('家居')) return 'chair';
  if (id.includes('健康') || lab.includes('健康')) return 'favorite';
  if (id.includes('学习') || lab.includes('学习')) return 'menu-book';
  if (id.includes('体验') || lab.includes('体验')) return 'flight';
  return 'card-giftcard';
}

const PAGE_API_KEY = 'tabs/profile';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { wrapLoad, resetSync } = usePageApiSync(PAGE_API_KEY);
  /** 用户在本页做过操作后调用，下次聚焦时再从后端全量拉取 */
  const markPageDirty = resetSync;
  const reloadPageRef = useRef<((forceApi?: boolean) => Promise<void>) | null>(null);
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';
  const [user, setUser] = useState<UserRow | null>(null);

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? theme.surface : '#ffffff';
  const text = isDark ? theme.text : '#131b2e';
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const wishAccent = isDark ? '#f472b6' : '#b42375';
  const avatarUrl = user?.avatar_uri ? { uri: user.avatar_uri } : require('../../assets/profile/avatar.png');
  const progressBgUrl = require('../../assets/profile/progress.png');
  const visionSectionYear = new Date().getFullYear();
  const displayName = user?.name?.trim() || '默认用户';
  const heightText = user?.height ? String(user.height) : '0';
  const weightText = user?.weight ? String(user.weight) : '0';
  const ageText = user?.age ? String(user.age) : '0';
  const bmiText =
    user && user.height > 0 && user.weight > 0
      ? (user.weight / ((user.height / 100) * (user.height / 100))).toFixed(1)
      : '0.0';

  const [visionCards, setVisionCards] = useState<ProfileVisionCarouselItem[]>([]);
  const visionCardsRef = useRef(visionCards);
  visionCardsRef.current = visionCards;

  const loadProfileVisions = useCallback(async () => {
    try {
      const rows = await listVisions();
      const fromDb = await Promise.all(rows.map(r => visionRowToProfileCarouselItem(r)));
      setVisionCards(fromDb);
    } catch {
      setVisionCards([]);
    }
  }, []);

  const [wishPreviewRows, setWishPreviewRows] = useState<WishItemRow[]>([]);

  const [weeklyJournal, setWeeklyJournal] = useState<WeeklyReviewJournalRow | null | undefined>(undefined);
  const [weeklyJournalLoading, setWeeklyJournalLoading] = useState(true);
  const [weeklyProfileRangeLabel, setWeeklyProfileRangeLabel] = useState('');
  const [weeklyProfileGate, setWeeklyProfileGate] = useState<'loading' | 'ok' | 'no_setting' | 'wrong_day'>('loading');

  const loadWeeklyJournal = useCallback(async () => {
    setWeeklyJournalLoading(true);
    setWeeklyProfileGate('loading');
    setWeeklyProfileRangeLabel('');
    try {
      const dow = await getWeeklyReviewConfiguredWeekday();
      const today = new Date();
      if (dow === null) {
        setWeeklyJournal(null);
        setWeeklyProfileRangeLabel('待设置复盘日');
        setWeeklyProfileGate('no_setting');
        return;
      }
      if (today.getDay() !== dow) {
        setWeeklyJournal(null);
        setWeeklyProfileRangeLabel(`每周「${WEEKLY_REVIEW_WEEKDAY_LABELS[dow]}」`);
        setWeeklyProfileGate('wrong_day');
        return;
      }
      const r = getRollingSevenDayRange(today);
      setWeeklyProfileRangeLabel(
        `${r.start.getMonth() + 1}月${r.start.getDate()}日 – ${r.end.getMonth() + 1}月${r.end.getDate()}日`,
      );
      const row = await getWeeklyReviewJournalByWeek(r.startYmd);
      setWeeklyJournal(row ?? null);
      setWeeklyProfileGate('ok');
    } catch {
      setWeeklyJournal(null);
      setWeeklyProfileRangeLabel('');
      setWeeklyProfileGate('ok');
    } finally {
      setWeeklyJournalLoading(false);
    }
  }, []);

  const loadProfileWishItems = useCallback(async () => {
    try {
      const rows = await listWishItems();
      const sorted = [...rows].sort(
        (a, b) => b.desire_level - a.desire_level || b.price - a.price || b.updated_at.localeCompare(a.updated_at),
      );
      setWishPreviewRows(sorted.slice(0, WISH_PROFILE_PREVIEW_MAX));
    } catch {
      setWishPreviewRows([]);
    }
  }, []);

  const [activeVisionIndex, setActiveVisionIndex] = useState(0);
  const isUserInteractingVisionRef = useRef(false);
  const visionListRef = useRef<FlatList<ProfileVisionCarouselItem>>(null);
  const visionScrollX = useRef(new Animated.Value(0)).current;
  const autoPlayTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearAutoPlay = () => {
    if (autoPlayTimerRef.current) {
      clearInterval(autoPlayTimerRef.current);
      autoPlayTimerRef.current = null;
    }
  };

  const scheduleAutoPlayResume = () => {
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      isUserInteractingVisionRef.current = false;
      startAutoPlay();
    }, 2200);
  };

  const startAutoPlay = () => {
    clearAutoPlay();
    autoPlayTimerRef.current = setInterval(() => {
      setActiveVisionIndex(prev => {
        const len = visionCardsRef.current.length;
        if (len === 0) return prev;
        const next = (prev + 1) % len;
        visionListRef.current?.scrollToOffset({
          offset: next * VISION_CARD_WIDTH,
          animated: true,
        });
        return next;
      });
    }, 3500);
  };

  useEffect(() => {
    if (visionCards.length === 0) return;
    setActiveVisionIndex(i => Math.min(i, Math.max(0, visionCards.length - 1)));
  }, [visionCards.length]);

  useEffect(() => {
    clearAutoPlay();
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    if (visionCards.length === 0) return;
    startAutoPlay();
    return () => {
      clearAutoPlay();
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    };
  }, [visionCards]);

  const [healthCardPreview, setHealthCardPreview] = useState({
    heroMain: '健康',
    heroSub: '身体 · 饮水 · 营养',
    tag: '记录解锁侧写',
  });

  const loadHealthCardPreview = useCallback(async () => {
    try {
      const u = await getDefaultUser();
      if (!u?.id) {
        setHealthCardPreview(computeHealthCardPreview(null, []));
        return;
      }
      const today = localLogicalTodayYmd();
      const rows = await getHealthRecordsLast7Days(u.id, today);
      setHealthCardPreview(computeHealthCardPreview(u, rows, getIntakeTargetsSnapshot()));
    } catch {
      setHealthCardPreview(computeHealthCardPreview(null, []));
    }
  }, []);

  const loadUser = useCallback(async () => {
    try {
      const currentUser = await getDefaultUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    }
  }, []);

  const reload = useCallback(async (forceApi = false) => {
    await wrapLoad(async () => {
      await loadUser();
      await loadHealthCardPreview();
      await loadProfileVisions();
      await loadProfileWishItems();
      await loadWeeklyJournal();
    }, forceApi);
  }, [
    wrapLoad,
    loadUser,
    loadHealthCardPreview,
    loadProfileVisions,
    loadProfileWishItems,
    loadWeeklyJournal,
  ]);
  reloadPageRef.current = reload;

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  const onProfileAction = useCallback(
    (action: () => void) => {
      markPageDirty();
      action();
    },
    [markPageDirty],
  );

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!shouldSkipPageFocusApiRefresh(PAGE_API_KEY)) {
        void reloadPageRef.current?.().catch((e) => {
          if (__DEV__) console.warn('[profile] reload failed', e);
        });
      }
      const unsubscribe = subscribeDefaultUserUpdates(() => {
        if (cancelled) return;
        void loadUser();
      });
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }, [loadUser]),
  );

  const healthBgUrl = require('../../assets/profile/health.png');
  const savingsBgUrl = require('../../assets/profile/savings.png');

  const headerFadeAnim = useRef(new Animated.Value(0)).current;
  const headerLiftAnim = useRef(new Animated.Value(12)).current;
  const profilePulseAnim = useRef(new Animated.Value(1)).current;
  const contentFadeAnim = useRef(new Animated.Value(0)).current;
  const contentLiftAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(headerFadeAnim, {
        toValue: 1,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(headerLiftAnim, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }),
      Animated.timing(contentFadeAnim, {
        toValue: 1,
        duration: 600,
        delay: 140,
        useNativeDriver: true,
      }),
      Animated.timing(contentLiftAnim, {
        toValue: 0,
        duration: 600,
        delay: 140,
        useNativeDriver: true,
      }),
    ]).start();

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(profilePulseAnim, {
          toValue: 1.05,
          duration: 1800,
          useNativeDriver: true,
        }),
        Animated.timing(profilePulseAnim, {
          toValue: 1,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );

    pulse.start();

    return () => {
      pulse.stop();
    };
  }, [contentFadeAnim, contentLiftAnim, headerFadeAnim, headerLiftAnim, profilePulseAnim]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['left', 'right']}>
      <ScrollView
        refreshControl={refreshControl}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingBottom: 36 + Math.max(insets.bottom, 12),
          },
        ]}>
        <Animated.View
          style={[
            styles.header,
            { backgroundColor: isDark ? surface : '#ffffff' },
            {
              opacity: headerFadeAnim,
              transform: [{ translateY: headerLiftAnim }],
            },
          ]}>
          <View style={[styles.headerBlob, { backgroundColor: `${primary}12` }]} />

          <View style={styles.headerTopRow}>
            <Animated.View style={[styles.avatarWrap, { transform: [{ scale: profilePulseAnim }] }]}>
              <View style={[styles.avatarRing, { borderColor: isDark ? 'rgba(148,163,184,0.3)' : 'rgba(242,243,255,0.95)' }]}>
                <Image source={avatarUrl} style={styles.avatarImg} contentFit="cover" />
              </View>
              <View style={[styles.verifyBadge, { backgroundColor: primary, borderColor: isDark ? surface : '#fff' }]}>
                <MaterialIcons name="verified" size={16} color="#fff" />
              </View>
            </Animated.View>

            <View style={styles.headerInfo}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, { color: text }]}>{displayName}</Text>
                <Pressable
                  onPress={() => onProfileAction(() => router.push('/edit-profile'))}
                  style={[styles.iconBtn, { borderColor: `${primary}30` }]}
                >
                  <MaterialIcons name="edit" size={18} color={primary} />
                </Pressable>
              </View>
            </View>
          </View>

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
                  {!!item.unit && <Text style={[styles.statUnit, { color: outline }]}> {item.unit}</Text>}
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View
          style={[
            styles.main,
            {
              opacity: contentFadeAnim,
              transform: [{ translateY: contentLiftAnim }],
            },
          ]}>
          <View style={styles.sectionHead}>
            <View>
              <Text style={[styles.kicker, { color: outline }]}>YEAR GOALS</Text>
              <Text style={[styles.sectionTitle, { color: text }]}>{visionSectionYear}年总目标</Text>
            </View>
            <Pressable onPress={() => onProfileAction(() => router.push('/vision-wall'))}>
              <Text style={[styles.moreText, { color: primary }]}>查看全部</Text>
            </Pressable>
          </View>

          <View style={styles.visionStackWrap}>
            {[2, 1].map(level => (
              <View
                key={`desk-${level}`}
                pointerEvents="none"
                style={[
                  styles.visionDeskCard,
                  {
                    backgroundColor: isDark ? 'rgba(30,41,59,0.58)' : 'rgba(255,255,255,0.75)',
                    borderColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.3)',
                    transform: [{ translateY: level * 10 }, { scale: 1 - level * 0.03 }, { rotate: `${level % 2 === 0 ? 1.8 : -1.5}deg` }],
                    opacity: 0.9 - level * 0.2,
                  },
                ]}
              />
            ))}

            {visionCards.length === 0 ? (
              <View
                style={{
                  width: VISION_CARD_WIDTH,
                  minHeight: 300,
                  alignSelf: 'center',
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 20,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: outlineVariant,
                  backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(255,255,255,0.92)',
                }}
              >
                <Text style={{ color: outline, fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 22 }}>
                  暂无总目标，可在此创建第一条。
                </Text>
                <Pressable
                  onPress={() => onProfileAction(() => router.push('/vision-create'))}
                  style={({ pressed }) => [{ marginTop: 16, opacity: pressed ? 0.85 : 1 }]}
                >
                  <Text style={{ color: primary, fontSize: 15, fontWeight: '800' }}>创建总目标</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Animated.FlatList
                  ref={visionListRef}
                  horizontal
                  pagingEnabled
                  data={visionCards}
                  keyExtractor={item => item.id}
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  bounces={false}
                  onScrollBeginDrag={() => {
                    isUserInteractingVisionRef.current = true;
                    clearAutoPlay();
                  }}
                  onScrollEndDrag={scheduleAutoPlayResume}
                  onMomentumScrollEnd={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                    const index = Math.round(e.nativeEvent.contentOffset.x / VISION_CARD_WIDTH);
                    setActiveVisionIndex(Math.max(0, Math.min(index, visionCards.length - 1)));
                    scheduleAutoPlayResume();
                  }}
                  onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: visionScrollX } } }], {
                    useNativeDriver: true,
                  })}
                  scrollEventThrottle={16}
                  renderItem={({ item, index }) => {
                    const inputRange = [
                      (index - 1) * VISION_CARD_WIDTH,
                      index * VISION_CARD_WIDTH,
                      (index + 1) * VISION_CARD_WIDTH,
                    ];

                    const scale = visionScrollX.interpolate({
                      inputRange,
                      outputRange: [0.9, 1, 0.9],
                      extrapolate: 'clamp',
                    });
                    const translateY = visionScrollX.interpolate({
                      inputRange,
                      outputRange: [20, 0, 20],
                      extrapolate: 'clamp',
                    });
                    const rotate = visionScrollX.interpolate({
                      inputRange,
                      outputRange: ['5deg', '0deg', '-5deg'],
                      extrapolate: 'clamp',
                    });
                    const opacity = visionScrollX.interpolate({
                      inputRange,
                      outputRange: [0.72, 1, 0.72],
                      extrapolate: 'clamp',
                    });

                    return (
                      <Pressable
                        style={{ width: VISION_CARD_WIDTH }}
                        onPress={() =>
                          onProfileAction(() =>
                            router.push({ pathname: '/vision-detail/[id]', params: { id: item.id } }),
                          )
                        }
                      >
                        <Animated.View
                          style={[
                            styles.visionCard,
                            {
                              opacity,
                              transform: [{ perspective: 1000 }, { translateY }, { rotateZ: rotate }, { scale }],
                            },
                          ]}
                        >
                          <Image source={item.imageSource} style={styles.bgImage} contentFit="cover" transition={120} />
                          <View style={styles.visionOverlay} />
                          <View style={styles.visionContent}>
                            <Text style={styles.cardKicker}>{item.kicker}</Text>
                            <Text style={styles.visionTitle}>{item.title}</Text>
                            <View style={styles.progressTrack}>
                              <View
                                style={[
                                  styles.progressFill,
                                  {
                                    backgroundColor: 'rgba(173,198,255,0.95)',
                                    width: `${item.progress}%` as `${number}%`,
                                  },
                                ]}
                              />
                            </View>
                            <View style={styles.progressMetaRow}>
                              <Text style={styles.progressMeta}>{item.progressText}</Text>
                              <Text style={styles.progressYear}>{item.year}</Text>
                            </View>
                          </View>
                        </Animated.View>
                      </Pressable>
                    );
                  }}
                />

                <View style={styles.visionDots}>
                  {visionCards.map((card, idx) => (
                    <View
                      key={card.id}
                      style={[
                        styles.visionDot,
                        {
                          width: idx === activeVisionIndex ? 18 : 8,
                          backgroundColor:
                            idx === activeVisionIndex
                              ? primary
                              : isDark
                                ? 'rgba(148,163,184,0.35)'
                                : 'rgba(114,119,133,0.25)',
                        },
                      ]}
                    />
                  ))}
                </View>
              </>
            )}
          </View>

          <View style={styles.sectionHead}>
            <View>
              <Text style={[styles.kicker, { color: outline }]}>WISHES</Text>
              <Text style={[styles.sectionTitle, { color: text }]}>心愿单</Text>
            </View>
            <Pressable onPress={() => onProfileAction(() => router.push('/wish-list'))}>
              <Text style={[styles.moreText, { color: primary }]}>查看全部</Text>
            </Pressable>
          </View>

          {wishPreviewRows.length === 0 ? (
            <View
              style={{
                marginHorizontal: 4,
                paddingVertical: 28,
                paddingHorizontal: 20,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: outlineVariant,
                backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(255,255,255,0.92)',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: outline, fontSize: 15, fontWeight: '600', textAlign: 'center', lineHeight: 22 }}>
                暂无心愿条目，可在心愿单中添加。
              </Text>
              <Pressable
                onPress={() => onProfileAction(() => router.push('/add-wish-item'))}
                style={({ pressed }) => [{ marginTop: 14, opacity: pressed ? 0.85 : 1 }]}
              >
                <Text style={{ color: primary, fontSize: 15, fontWeight: '800' }}>添加好物</Text>
              </Pressable>
            </View>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.wishlistList}
            >
              {wishPreviewRows.map((row, idx) => {
                const accentColors = [primary, secondary, tertiary, wishAccent];
                const iconColor = accentColors[idx % accentColors.length]!;
                const iconName = wishListIconForRow(row);
                return (
                  <Pressable
                    key={row.id}
                    onPress={() => onProfileAction(() => router.push('/wish-list'))}
                    style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}
                  >
                    <View
                      style={[
                        styles.wishlistCard,
                        {
                          backgroundColor: isDark ? 'rgba(30,41,59,0.58)' : '#f2f3ff',
                          borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.2)',
                        },
                      ]}
                    >
                      <View style={[styles.wishlistIconWrap, { overflow: 'hidden' }]}>
                        {row.reference_image_uri ? (
                          <Image
                            source={{ uri: row.reference_image_uri }}
                            style={{ width: 48, height: 48 }}
                            contentFit="cover"
                            transition={150}
                          />
                        ) : (
                          <MaterialIcons name={iconName} size={24} color={iconColor} />
                        )}
                      </View>
                      <Text style={[styles.wishlistTitle, { color: text }]} numberOfLines={2}>
                        {row.name}
                      </Text>
                      <Text style={[styles.wishlistPrice, { color: primary }]}>{formatWishCny(row.price)}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.sectionHead}>
            <View>
              <Text style={[styles.kicker, { color: outline }]}>WEEKLY REVIEW</Text>
              <Text style={[styles.sectionTitle, { color: text }]}>每周复盘</Text>
            </View>
            <Pressable onPress={() => onProfileAction(() => router.push('/weekly-review'))} hitSlop={8}>
              <Text style={[styles.moreText, { color: primary }]}>去填写</Text>
            </Pressable>
          </View>

          <Pressable
            onPress={() => onProfileAction(() => router.push('/weekly-review'))}
            style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
            <View
              style={[
                styles.weeklyEntryCard,
                {
                  backgroundColor: isDark ? 'rgba(30,41,59,0.55)' : '#ffffff',
                  borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,88,190,0.12)',
                },
              ]}>
              <View style={[styles.weeklyEntryAccent, { backgroundColor: primary }]} />
              <View style={styles.weeklyEntryBody}>
                <MaterialIcons name="edit-note" size={28} color={primary} />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[styles.weeklyEntryRange, { color: outline }]}>
                    {weeklyJournalLoading ? '加载中…' : weeklyProfileRangeLabel || '近七天复盘'}
                  </Text>
                  {weeklyJournalLoading ? (
                    <Text style={[styles.weeklyEntryMeta, { color: outline }]}>加载中…</Text>
                  ) : weeklyProfileGate === 'no_setting' ? (
                    <Text style={[styles.weeklyEntryMeta, { color: text }]}>请先在复盘页设置「每周复盘日」</Text>
                  ) : weeklyProfileGate === 'wrong_day' ? (
                    <Text style={[styles.weeklyEntryMeta, { color: text }]}>今天不可填写，请在设定的星期打开</Text>
                  ) : (
                    <Text style={[styles.weeklyEntryMeta, { color: text }]}>
                      {weeklyJournalStatusText(weeklyJournal ?? null)}
                    </Text>
                  )}
                  <Text style={[styles.weeklyEntryHint, { color: outline }]}>
                    按五大板块书写复盘，自评执行分后可生成 AI 建议，并记录是否调整任务、存钱与时间分配。
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={26} color={outline} />
              </View>
            </View>
          </Pressable>

          <View style={styles.sectionHead}>
            <View>
              <Text style={[styles.kicker, { color: outline }]}>DIGITAL IDENTITY</Text>
              <Text style={[styles.sectionTitle, { color: text }]}>AI 人格画像</Text>
            </View>
          </View>

          <View style={styles.gridWrap}>
            <Pressable
              onPress={() =>
                onProfileAction(() =>
                  router.push({ pathname: '/persona-detail/[slug]', params: { slug: 'plan-completion' } }),
                )
              }
              style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
            >
              <View style={[styles.bigCard, { shadowColor: isDark ? '#000' : '#6c63ff' }]}>
                <Image source={progressBgUrl} style={styles.bgImage} contentFit="cover" />
                <View style={[styles.tintLayer, { backgroundColor: `${primary}66` }]} />
                <View style={styles.bigCardTop}>
                  <Text style={styles.cardKicker}>计划完成情况</Text>
                  <Text style={styles.percentText}>85%</Text>
                </View>
                <View style={styles.bigCardBottom}>
                  <Text style={styles.whiteHint}>本周目标达成率 · 卓越</Text>
                  <MaterialIcons name="trending-up" size={30} color="rgba(255,255,255,0.9)" />
                </View>
              </View>
            </Pressable>

            <Pressable
              onPress={() =>
                onProfileAction(() =>
                  router.push({ pathname: '/persona-detail/[slug]', params: { slug: 'health' } }),
                )
              }
              style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
            >
              <View style={styles.healthPersonaCard}>
                <Image source={healthBgUrl} style={styles.bgImage} contentFit="cover" />
                <View style={[styles.tintLayer, { backgroundColor: `${secondary}66` }]} />
                <View style={styles.healthPersonaTop}>
                  <View>
                    <Text style={styles.cardKicker}>健康与营养</Text>
                    <Text style={styles.healthPersonaValue}>{healthCardPreview.heroMain}</Text>
                    <Text style={styles.healthPersonaSub}>{healthCardPreview.heroSub}</Text>
                  </View>
                  <View style={styles.tagPill}>
                    <Text style={styles.tagPillText}>{healthCardPreview.tag}</Text>
                  </View>
                </View>
                <Text style={styles.healthPersonaHint}>身体档案 · 四营养维度 · AI 侧写</Text>
              </View>
            </Pressable>

            <Pressable
              onPress={() =>
                onProfileAction(() =>
                  router.push({ pathname: '/persona-detail/[slug]', params: { slug: 'savings' } }),
                )
              }
              style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
            >
              <View style={styles.savingCard}>
                <Image source={savingsBgUrl} style={styles.bgImage} contentFit="cover" />
                <View style={[styles.tintLayer, { backgroundColor: `${tertiary}66` }]} />
                <View style={styles.savingLeft}>
                  <Text style={styles.cardKicker}>储蓄状态</Text>
                  <Text style={styles.savingTitle}>资产稳步增长</Text>
                  <Text style={styles.savingSub}>目标进度: 30,000 CNY</Text>
                </View>
                <View style={styles.glassIcon}>
                  <MaterialIcons name="account-balance" size={30} color="rgba(255,221,184,0.95)" />
                </View>
              </View>
            </Pressable>

            <Pressable
              onPress={() =>
                onProfileAction(() =>
                  router.push({ pathname: '/persona-detail/[slug]', params: { slug: 'ai-insight' } }),
                )
              }
              style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}
            >
              <View style={[styles.aiCard, { backgroundColor: surface, borderColor: `${primary}1A` }]}>
                <View style={[styles.aiTopLine, { backgroundColor: `${primary}66` }]} />
                <View style={styles.aiBody}>
                  <View style={[styles.aiIcon, { backgroundColor: primary }]}>
                    <MaterialIcons name="auto-awesome" size={24} color="#fff" />
                  </View>
                  <View style={styles.aiTextWrap}>
                    <View style={styles.aiTitleRow}>
                      <Text style={[styles.aiTitleKicker, { color: primary }]}>AI 智能人格洞察</Text>
                      <View style={[styles.aiDivider, { backgroundColor: `${primary}1A` }]} />
                    </View>
                    <Text style={[styles.aiQuote, { color: text }]}>
                      “你这周的饮水量提升了 15%，非常棒。考虑增加 10g 蛋白质摄入以支持健身训练。在执行储蓄计划方面你做得也很出色，请继续保持你的节奏！”
                    </Text>
                  </View>
                </View>
              </View>
            </Pressable>
          </View>
        </Animated.View>
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
    paddingHorizontal: 24,
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
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarWrap: {
    width: 96,
    height: 96,
    position: 'relative',
  },
  avatarRing: {
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: 'hidden',
    borderWidth: 4,
  },
  avatarImg: {
    width: '100%',
    height: '100%',
  },
  verifyBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
  },
  headerInfo: {
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  name: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
  },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statsRow: {
    marginTop: 24,
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
  main: {
    paddingHorizontal: 18,
    paddingTop: 20,
    gap: 26,
    maxWidth: 960,
    width: '100%',
    alignSelf: 'center',
  },
  sectionHead: {
    paddingHorizontal: 6,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  kicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2.4,
    marginBottom: 3,
  },
  sectionTitle: {
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  moreText: {
    fontSize: 14,
    fontWeight: '800',
  },
  visionStackWrap: {
    minHeight: 344,
    justifyContent: 'flex-end',
  },
  visionDeskCard: {
    position: 'absolute',
    height: 300,
    borderRadius: 22,
    borderWidth: 1,
  },
  visionCard: {
    width: SCREEN_WIDTH - 36,
    minHeight: 300,
    borderRadius: 22,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  visionDots: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  visionDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  wishlistList: {
    gap: 12,
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  wishlistCard: {
    width: 160,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    gap: 8,
  },
  wishlistIconWrap: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    marginBottom: 6,
  },
  wishlistTitle: {
    fontSize: 14,
    fontWeight: '800',
    lineHeight: 18,
    minHeight: 36,
  },
  wishlistPrice: {
    fontSize: 12,
    fontWeight: '900',
  },
  bgImage: {
    ...StyleSheet.absoluteFillObject,
    width: undefined,
    height: undefined,
  },
  visionOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(19,27,46,0.55)',
  },
  visionContent: {
    padding: 24,
    gap: 10,
  },
  cardKicker: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  visionTitle: {
    color: '#fff',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: -0.9,
    lineHeight: 40,
  },
  progressTrack: {
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressMeta: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  progressYear: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '900',
  },
  gridWrap: {
    gap: 14,
  },
  wishEntryCard: {
    borderWidth: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  wishEntryTopLine: {
    height: 3,
    width: '100%',
  },
  wishEntryBody: {
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  wishEntryIcon: {
    width: 50,
    height: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wishEntryTextWrap: {
    flex: 1,
    gap: 3,
  },
  wishEntryKicker: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 2,
  },
  wishEntryTitle: {
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
  },
  wishEntryDesc: {
    fontSize: 13,
    fontWeight: '600',
  },
  bigCard: {
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 190,
    padding: 18,
    justifyContent: 'space-between',
  },
  tintLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  bigCardTop: {
    gap: 5,
  },
  percentText: {
    color: '#fff',
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: -1.2,
  },
  bigCardBottom: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  whiteHint: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 14,
    fontWeight: '600',
  },
  twoColRow: {
    flexDirection: SCREEN_WIDTH >= 768 ? 'row' : 'column',
    gap: 14,
  },
  smallCard: {
    flex: 1,
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 178,
    padding: 18,
    justifyContent: 'space-between',
  },
  healthPersonaCard: {
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 168,
    padding: 18,
    justifyContent: 'space-between',
    gap: 10,
  },
  healthPersonaTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  healthPersonaValue: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '900',
    letterSpacing: -0.8,
    marginTop: 4,
  },
  healthPersonaSub: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 4,
  },
  healthPersonaHint: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '600',
  },
  smallValue: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '900',
    letterSpacing: -0.6,
  },
  tagPill: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  tagPillText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '800',
  },
  smallHint: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: 11,
    fontWeight: '600',
  },
  savingCard: {
    borderRadius: 22,
    overflow: 'hidden',
    minHeight: 162,
    padding: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  savingLeft: {
    flex: 1,
    gap: 5,
    paddingRight: 16,
  },
  savingTitle: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  savingSub: {
    color: 'rgba(255,255,255,0.76)',
    fontSize: 12,
    fontWeight: '600',
  },
  glassIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.75)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  aiCard: {
    borderWidth: 1,
    borderRadius: 24,
    overflow: 'hidden',
  },
  aiTopLine: {
    height: 3,
    width: '100%',
  },
  aiBody: {
    padding: 20,
    flexDirection: 'row',
    gap: 12,
  },
  aiIcon: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '-3deg' }],
  },
  aiTextWrap: {
    flex: 1,
    gap: 10,
  },
  aiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  aiTitleKicker: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2.2,
  },
  aiDivider: {
    flex: 1,
    height: 1,
  },
  aiQuote: {
    fontSize: 17,
    lineHeight: 25,
    fontWeight: '600',
    fontStyle: 'italic',
    opacity: 0.92,
  },
  weeklyEntryCard: {
    marginHorizontal: 4,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  weeklyEntryAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  weeklyEntryBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 18,
    paddingHorizontal: 18,
    paddingLeft: 20,
  },
  weeklyEntryRange: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  weeklyEntryMeta: {
    fontSize: 16,
    fontWeight: '800',
    lineHeight: 22,
  },
  weeklyEntryHint: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 19,
  },
});
