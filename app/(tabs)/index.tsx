import { RecordIntakeSheet } from '@/components/record-intake-sheet';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';


import { getDefaultUser } from '@/lib/repositories/users/user';
import type { UserRow } from '@/lib/repositories/users/user.types';

import { getHealthRecordsLast7Days } from '@/lib/repositories/health/health';
import type { HealthRecordRow } from '@/lib/repositories/health/health.types';

import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

const { width } = Dimensions.get('window');





const nutrientData = [
  {
    key: 'hydration',
    label: '水分',
    percentage: 75,
    current: 1850,
    target: 2500,
    icon: 'water-drop' as keyof typeof MaterialIcons.glyphMap,
    opacity: 1,
  },
  {
    key: 'protein',
    label: '蛋白质',
    percentage: 54,
    current: 82,
    target: 150,
    icon: 'restaurant' as keyof typeof MaterialIcons.glyphMap,
    opacity: 0.65,
  },
  {
    key: 'sodium',
    label: '钠',
    percentage: 20,
    current: 480,
    target: 2400,
    icon: 'science' as keyof typeof MaterialIcons.glyphMap,
    opacity: 0.35,
  },
];

const quickAddItems = [
  { key: 'water', label: '水', amount: '250ml', icon: 'local-drink' as keyof typeof MaterialIcons.glyphMap },
  { key: 'coffee', label: '咖啡', amount: '150ml', icon: 'local-cafe' as keyof typeof MaterialIcons.glyphMap },
  {
    key: 'milk',
    label: '牛奶',
    amount: '200ml',
    icon: 'emoji-food-beverage' as keyof typeof MaterialIcons.glyphMap,
  },
];

const weekLabels = ['日', '一', '二', '三', '四', '五', '六'] as const;

function normalizeDate(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatHeaderDate(d: Date) {
  return `${d.getMonth() + 1}月${d.getDate()}日 周${weekLabels[d.getDay()]}`;
}

function addDays(d: Date, days: number) {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

function isFutureDate(d: Date, today: Date) {
  return normalizeDate(d).getTime() > normalizeDate(today).getTime();
}

function getWeekDaysFromAnchor(anchorDate: Date) {
  const start = addDays(anchorDate, -6);
  return Array.from({ length: 7 }).map((_, i) => {
    const date = addDays(start, i);
    return {
      key: `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
      date,
      day: date.getDate(),
      label: weekLabels[date.getDay()],
    };
  });
}

const weeklyTrend = [
  { day: '一', hydration: 60, protein: 45, sodium: 30 },
  { day: '二', hydration: 75, protein: 55, sodium: 40 },
  { day: '三', hydration: 50, protein: 40, sodium: 60 },
  { day: '四', hydration: 90, protein: 70, sodium: 50, active: true },
  { day: '五', hydration: 70, protein: 60, sodium: 45 },
  { day: '六', hydration: 35, protein: 45, sodium: 30 },
  { day: '日', hydration: 65, protein: 55, sodium: 40 },
];

const activeTrend = weeklyTrend.find((item) => item.active) ?? weeklyTrend[0];
const BAR_MAX_HEIGHT = 130;

const CircularProgress = ({
  percentage,
  icon,
  color,
  size = 64,
  strokeWidth = 6,
  opacity = 1,
}: {
  percentage: number;
  icon: keyof typeof MaterialIcons.glyphMap;
  color: string;
  size?: number;
  strokeWidth?: number;
  opacity?: number;
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <View style={[styles.progressContainer, { width: size, height: size }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke="rgba(148, 163, 184, 0.26)" strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          opacity={opacity}
        />
      </Svg>
      <View style={styles.iconContainer}>
        <MaterialIcons name={icon} size={24} color={color} style={{ opacity }} />
      </View>
    </View>
  );
};

export default function HealthScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const [sheetOpen, setSheetOpen] = React.useState(false);
  const [assistantOpen, setAssistantOpen] = React.useState(false);
  const [assistantTab, setAssistantTab] = React.useState<'水分' | '蛋白质' | '钠'>('水分');
  const [manualGoal, setManualGoal] = React.useState('2500');
  const today = React.useMemo(() => normalizeDate(new Date()), []);
  const [selectedDate, setSelectedDate] = React.useState(() => normalizeDate(new Date()));
  const [weekAnchorDate, setWeekAnchorDate] = React.useState(() => normalizeDate(new Date()));

  const weekPagerRef = React.useRef<ScrollView>(null);

  const fadeAnim = React.useRef(new Animated.Value(0)).current;
  const translateYAnim = React.useRef(new Animated.Value(18)).current;
  const ctaScaleAnim = React.useRef(new Animated.Value(1)).current;
  const ctaPressAnim = React.useRef(new Animated.Value(1)).current;
  const barGrowAnim = React.useRef(new Animated.Value(0)).current;
  const statusFloatAnim = React.useRef(new Animated.Value(0)).current;
  const selectedDayPopAnim = React.useRef(new Animated.Value(1)).current;
  const bgFloatAnim = React.useRef(new Animated.Value(0)).current;
  const statusShimmerAnim = React.useRef(new Animated.Value(-1)).current;
  const metricCardAnims = React.useRef(nutrientData.map(() => new Animated.Value(0))).current;
  const quickAddCardAnims = React.useRef(quickAddItems.map(() => new Animated.Value(0))).current;

  const weekDaysCurrent = React.useMemo(() => getWeekDaysFromAnchor(weekAnchorDate), [weekAnchorDate]);
  const weekDaysPrev = React.useMemo(() => getWeekDaysFromAnchor(addDays(weekAnchorDate, -7)), [weekAnchorDate]);
  const weekDaysNext = React.useMemo(() => getWeekDaysFromAnchor(addDays(weekAnchorDate, 7)), [weekAnchorDate]);



  // 获取用户信息
  const [user, setUser] = React.useState<UserRow | null>(null);
  React.useEffect(() => {
    const loadUser = async () => {
      const data = await getDefaultUser();
      setUser(data);
    };
  
    loadUser();
  }, []);

  //获取近七天用户数据
  const [healthRecords, setHealthRecords] = React.useState<HealthRecordRow[]>([]);
  React.useEffect(() => {
    const loadHealthRecords = async () => {
      const data = await getHealthRecordsLast7Days(user?.id ?? '');
      setHealthRecords(data);
    };
    loadHealthRecords();
  }, [user]);



  React.useEffect(() => {
    const t = setTimeout(() => {
      weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
    }, 0);
    return () => clearTimeout(t);
  }, [width]);

  React.useEffect(() => {
    const metricStagger = Animated.stagger(
      90,
      metricCardAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      )
    );

    const quickAddStagger = Animated.stagger(
      80,
      quickAddCardAnims.map((anim) =>
        Animated.timing(anim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        })
      )
    );

    Animated.sequence([
      Animated.parallel([
        Animated.timing(fadeAnim, {
          toValue: 1,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(translateYAnim, {
          toValue: 0,
          duration: 520,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      metricStagger,
      quickAddStagger,
    ]).start();
  }, [fadeAnim, translateYAnim, metricCardAnims, quickAddCardAnims]);

  React.useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(ctaScaleAnim, {
          toValue: 1.035,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(ctaScaleAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, [ctaScaleAnim]);

  React.useEffect(() => {
    barGrowAnim.setValue(0);
    Animated.timing(barGrowAnim, {
      toValue: 1,
      duration: 900,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [barGrowAnim]);

  React.useEffect(() => {
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(statusFloatAnim, {
          toValue: 1,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(statusFloatAnim, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    float.start();
    return () => float.stop();
  }, [statusFloatAnim]);

  React.useEffect(() => {
    const bgFloat = Animated.loop(
      Animated.sequence([
        Animated.timing(bgFloatAnim, {
          toValue: 1,
          duration: 3600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bgFloatAnim, {
          toValue: 0,
          duration: 3600,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    bgFloat.start();
    return () => bgFloat.stop();
  }, [bgFloatAnim]);

  React.useEffect(() => {
    const shimmer = Animated.loop(
      Animated.timing(statusShimmerAnim, {
        toValue: 1,
        duration: 2300,
        easing: Easing.inOut(Easing.quad),
        useNativeDriver: true,
      })
    );

    shimmer.start();
    return () => {
      shimmer.stop();
      statusShimmerAnim.setValue(-1);
    };
  }, [statusShimmerAnim]);

  const weekPagerWidth = width - 48;
  const cardWidth = (width - 48 - 16) / 3;

  const assistantTheme = {
    水分: {
      accent: '#10b981',
      unit: 'ml',
      placeholder: '2500',
      best: '2,850',
      avg: '2,400',
      community: '2,200',
    },
    蛋白质: {
      accent: '#f59e0b',
      unit: 'g',
      placeholder: '75',
      best: '75',
      avg: '68',
      community: '70',
    },
    钠: {
      accent: '#a855f7',
      unit: 'mg',
      placeholder: '2000',
      best: '2,000',
      avg: '2,150',
      community: '2,000',
    },
  } as const;

  const currentAssistant = assistantTheme[assistantTab];

  const communityValue = React.useMemo(() => {
    if (!user) return 0;
  
    if (assistantTab === '水分') {
      return user.weight * 35;
    }
    if (assistantTab === '蛋白质') {
      return user.weight * 1.2;
    }
    if (assistantTab === '钠') {
      return 2000;
    }
  }, [assistantTab, user]);


  const avgValue = React.useMemo(() => {
    if (!healthRecords.length) return 0;

    if (assistantTab === '水分') {
      return healthRecords.reduce((acc, curr) => acc + curr.hydration, 0) / healthRecords.length;
    }
    if (assistantTab === '蛋白质') {

      return healthRecords.reduce((acc, curr) => acc + curr.protein, 0) / healthRecords.length;
    }
    if (assistantTab === '钠') {
      return healthRecords.reduce((acc, curr) => acc + curr.sodium, 0) / healthRecords.length;
    }
  }, [assistantTab, healthRecords]);


  const onWeekPagerEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;

    if (x < weekPagerWidth * 0.5) {
      const nextAnchor = addDays(weekAnchorDate, -7);
      setWeekAnchorDate(nextAnchor);
      if (selectedDate > weekAnchorDate) {
        setSelectedDate(nextAnchor);
      }
      weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
      return;
    }

    if (x > weekPagerWidth * 1.5) {
      const nextAnchor = addDays(weekAnchorDate, 7);
      if (isFutureDate(nextAnchor, today)) {
        weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
        return;
      }

      setWeekAnchorDate(nextAnchor);
      if (selectedDate < weekAnchorDate) {
        setSelectedDate(nextAnchor);
      }
      weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(248, 250, 252, 0.92)' }]}>
        <View style={styles.headerTopRow}>
          <View style={{ width: 32 }} />
          <Text style={[styles.headerTitle, { color: theme.text }]}>{formatHeaderDate(selectedDate)}</Text>
          <TouchableOpacity
            style={styles.calendarBtn}
            activeOpacity={0.75}
            onPress={() => router.push('/health-calendar')}
          >
            <MaterialIcons name="calendar-today" size={22} color={theme.text} />
          </TouchableOpacity>
        </View>

        <ScrollView
          ref={weekPagerRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onWeekPagerEnd}
        >
          {[weekDaysPrev, weekDaysCurrent, weekDaysNext].map((week, pageIndex) => (
            <View key={pageIndex} style={[styles.weekPage, { width: weekPagerWidth }]}>
              <View style={styles.weekStripContent}>
                {week.map((item) => {
                  const normalizedItemDate = normalizeDate(item.date);
                  const isActive = normalizedItemDate.getTime() === selectedDate.getTime();
                  const disabled = isFutureDate(normalizedItemDate, today);

                  return (
                    <TouchableOpacity
                      key={item.key}
                      activeOpacity={0.85}
                      disabled={disabled}
                      onPress={() => {
                        if (disabled) return;
                        Animated.sequence([
                          Animated.spring(selectedDayPopAnim, {
                            toValue: 0.92,
                            speed: 24,
                            bounciness: 0,
                            useNativeDriver: true,
                          }),
                          Animated.spring(selectedDayPopAnim, {
                            toValue: 1,
                            speed: 20,
                            bounciness: 9,
                            useNativeDriver: true,
                          }),
                        ]).start();

                        setSelectedDate(normalizedItemDate);
                        if (pageIndex === 0) {
                          setWeekAnchorDate(addDays(weekAnchorDate, -7));
                          weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
                        }
                        if (pageIndex === 2) {
                          const nextAnchor = addDays(weekAnchorDate, 7);
                          if (!isFutureDate(nextAnchor, today)) {
                            setWeekAnchorDate(nextAnchor);
                            weekPagerRef.current?.scrollTo({ x: weekPagerWidth, animated: false });
                          }
                        }
                      }}
                      style={[
                        styles.weekDayItem,
                        {
                          backgroundColor: isActive ? theme.primary : 'transparent',
                          borderColor: isActive ? `${theme.primary}00` : isDark ? 'rgba(148,163,184,0.15)' : 'rgba(148,163,184,0.18)',
                          opacity: disabled ? 0.45 : 1,
                        },
                      ]}
                    >
                      <Animated.View
                        style={[
                          styles.weekDayContent,
                          isActive ? { transform: [{ scale: selectedDayPopAnim }] } : undefined,
                        ]}
                      >
                        <Text style={[styles.weekDayDate, { color: isActive ? '#fff' : theme.textSecondary }]}>{item.day}</Text>
                        <Text style={[styles.weekDayLabel, { color: isActive ? '#fff' : `${theme.textSecondary}CC` }]}>{item.label}</Text>
                      </Animated.View>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bgOrb,
            styles.bgOrbTop,
            {
              backgroundColor: `${theme.primary}18`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -10],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 8],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bgOrb,
            styles.bgOrbMiddle,
            {
              backgroundColor: `${theme.primary}10`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 12],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -6],
                  }),
                },
              ],
            },
          ]}
        />

        <Animated.View
          style={{
            opacity: fadeAnim,
            transform: [{ translateY: translateYAnim }],
          }}
        >
        <View style={styles.metricsRow}>
          {nutrientData.map((item, index) => {
            const openAssistantByCard = () => {
              if (item.key === 'hydration') {
                setAssistantTab('水分');
                setManualGoal('2500');
                setAssistantOpen(true);
              }
              if (item.key === 'protein') {
                setAssistantTab('蛋白质');
                setManualGoal('75');
                setAssistantOpen(true);
              }
              if (item.key === 'sodium') {
                setAssistantTab('钠');
                setManualGoal('2000');
                setAssistantOpen(true);
              }
            };

            const cardOpacity = metricCardAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0, 1],
            });
            const cardTranslateY = metricCardAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [20, 0],
            });
            const cardScale = metricCardAnims[index].interpolate({
              inputRange: [0, 1],
              outputRange: [0.96, 1],
            });

            const card = (
              <Animated.View
                style={{
                  opacity: cardOpacity,
                  transform: [{ translateY: cardTranslateY }, { scale: cardScale }],
                }}
              >
                <View style={[styles.metricCard, { backgroundColor: theme.surface, width: cardWidth }]}>
                  <View style={[styles.metricCardGlow, { backgroundColor: `${theme.primary}14` }]} />
                  <CircularProgress
                    percentage={item.percentage}
                    icon={item.icon}
                    color={theme.primary}
                    opacity={item.opacity}
                  />
                  <Text style={[styles.metricLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                  <Text style={[styles.metricValue, { color: theme.text }]}>{item.percentage}%</Text>
                  <Text style={[styles.metricSubValue, { color: theme.textSecondary }]}> 
                    {item.current.toLocaleString()} / {item.target.toLocaleString()}
                  </Text>
                </View>
              </Animated.View>
            );

            return (
              <Pressable key={item.key} delayLongPress={280} onLongPress={openAssistantByCard}>
                {card}
              </Pressable>
            );
          })}
        </View>

        <Animated.View
          style={{
            transform: [
              {
                translateY: statusFloatAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, -4],
                }),
              },
            ],
          }}
        >
          <View style={[styles.statusCard, { backgroundColor: theme.surface }]}> 
            <View style={styles.statusItem}>
              <View style={[styles.statusItemAccent, { backgroundColor: '#10b981' }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: theme.text }]}>水分摄入</Text>
                  <Text style={[styles.statusBadge, { color: '#10b981', backgroundColor: '#10b9811A' }]}>75%</Text>
                </View>
                <Text style={[styles.statusDesc, { color: theme.textSecondary }]}>目前水分充足，大脑高效运作</Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: '#10b981' }]}>1,850</Text>
                  <Text style={[styles.statusValueSub, { color: theme.textSecondary }]}>ML / 2,500</Text>
                </View>
                <View style={styles.statusTrack}>
                  <View style={[styles.statusTrackFill, { width: '75%', backgroundColor: '#10b981' }]} />
                </View>
              </View>
            </View>

            <View style={[styles.statusItem, styles.statusItemSpacing]}>
              <View style={[styles.statusItemAccent, { backgroundColor: '#f59e0b' }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: theme.text }]}>蛋白质摄入</Text>
                  <Text style={[styles.statusBadge, { color: '#f59e0b', backgroundColor: '#f59e0b1A' }]}>54%</Text>
                </View>
                <Text style={[styles.statusDesc, { color: theme.textSecondary }]}>稍有欠缺，建议晚餐增加摄入</Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: '#f59e0b' }]}>82</Text>
                  <Text style={[styles.statusValueSub, { color: theme.textSecondary }]}>G / 150</Text>
                </View>
                <View style={styles.statusTrack}>
                  <View style={[styles.statusTrackFill, { width: '54%', backgroundColor: '#f59e0b' }]} />
                </View>
              </View>
            </View>

            <View style={[styles.statusItem, styles.statusItemSpacing]}>
              <View style={[styles.statusItemAccent, { backgroundColor: '#a855f7' }]} />
              <View style={styles.statusItemBody}>
                <View style={styles.statusLineRow}>
                  <Text style={[styles.statusItemTitle, { color: theme.text }]}>钠含量监控</Text>
                  <Text style={[styles.statusBadge, { color: '#a855f7', backgroundColor: '#a855f71A' }]}>20%</Text>
                </View>
                <Text style={[styles.statusDesc, { color: theme.textSecondary }]}>保持在理想范围，心血管压力低</Text>
                <View style={styles.statusValueRow}>
                  <Text style={[styles.statusValueMain, { color: '#a855f7' }]}>480</Text>
                  <Text style={[styles.statusValueSub, { color: theme.textSecondary }]}>MG / 2,400</Text>
                </View>
                <View style={styles.statusTrack}>
                  <View style={[styles.statusTrackFill, { width: '20%', backgroundColor: '#a855f7' }]} />
                </View>
              </View>
            </View>
          </View>
        </Animated.View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: theme.text }]}>快速添加</Text>
            <TouchableOpacity activeOpacity={0.75} onPress={() => router.push('/quick-add-edit')}>
              <Text style={[styles.editBtn, { color: theme.primary }]}>编辑</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.quickAddRow}>
            {quickAddItems.map((item, index) => {
              const itemOpacity = quickAddCardAnims[index].interpolate({
                inputRange: [0, 1],
                outputRange: [0, 1],
              });
              const itemTranslateY = quickAddCardAnims[index].interpolate({
                inputRange: [0, 1],
                outputRange: [18, 0],
              });

              return (
                <Animated.View
                  key={item.key}
                  style={{
                    opacity: itemOpacity,
                    transform: [{ translateY: itemTranslateY }],
                  }}
                >
                  <TouchableOpacity
                    style={[styles.quickAddCard, { backgroundColor: theme.surface, width: cardWidth }]}
                    activeOpacity={0.82}
                  >
                    <MaterialIcons name={item.icon} size={30} color={theme.textSecondary} style={styles.quickAddIcon} />
                    <Text style={[styles.quickAddLabel, { color: theme.textSecondary }]}>{item.label}</Text>
                    <Text style={[styles.quickAddValue, { color: theme.text }]}>{item.amount}</Text>
                  </TouchableOpacity>
                </Animated.View>
              );
            })}
          </View>

          <Animated.View style={{ transform: [{ scale: Animated.multiply(ctaScaleAnim, ctaPressAnim) }] }}>
            <TouchableOpacity
              style={[styles.mainBtn, { backgroundColor: theme.primary }]}
              onPress={() => setSheetOpen(true)}
              onPressIn={() => {
                Animated.spring(ctaPressAnim, {
                  toValue: 0.965,
                  speed: 30,
                  bounciness: 0,
                  useNativeDriver: true,
                }).start();
              }}
              onPressOut={() => {
                Animated.spring(ctaPressAnim, {
                  toValue: 1,
                  speed: 24,
                  bounciness: 6,
                  useNativeDriver: true,
                }).start();
              }}
              activeOpacity={0.9}
            >
              <MaterialIcons name="add" size={24} color="#fff" />
              <Text style={styles.mainBtnText}>记录新摄入</Text>
            </TouchableOpacity>
          </Animated.View>
        </View>

        <View style={[styles.trendCard, { backgroundColor: isDark ? 'rgba(30, 41, 59, 0.54)' : '#f1f5f9' }]}>
          <View style={styles.trendHeader}>
            <Text style={[styles.trendTitle, { color: theme.text }]}>每周趋势</Text>
            <Text style={[styles.trendSub, { color: theme.primary }]}>+12% VS 上周</Text>
          </View>

          <View style={styles.legendRow}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#10b981' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>水分</Text>
              <Text style={[styles.legendValue, { color: theme.text }]}>{activeTrend.hydration}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#f59e0b' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>蛋白质</Text>
              <Text style={[styles.legendValue, { color: theme.text }]}>{activeTrend.protein}</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: '#a855f7' }]} />
              <Text style={[styles.legendText, { color: theme.textSecondary }]}>钠</Text>
              <Text style={[styles.legendValue, { color: theme.text }]}>{activeTrend.sodium}</Text>
            </View>
          </View>

          <View style={styles.chartContainer}>
            <View style={styles.chartInner}>
              <View style={styles.yAxis}>
                {[100, 75, 50, 25, 0].map((tick) => (
                  <Text key={tick} style={[styles.yTickText, { color: theme.textSecondary }]}>{tick}</Text>
                ))}
              </View>

              <View style={styles.plotArea}>
                {[100, 75, 50, 25, 0].map((tick, index) => (
                  <View
                    key={tick}
                    style={[
                      styles.gridLine,
                      {
                        top: `${index * 25}%`,
                        borderColor: isDark ? 'rgba(148,163,184,0.24)' : 'rgba(148,163,184,0.32)',
                      },
                    ]}
                  />
                ))}

                <View style={styles.barsRow}>
                  {weeklyTrend.map((item, index) => {
                    const faded = item.active ? 1 : 0.4;
                    const itemDelay = index * 90;
                    const hydrationHeight = barGrowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, (item.hydration / 100) * BAR_MAX_HEIGHT],
                    });
                    const proteinHeight = barGrowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, (item.protein / 100) * BAR_MAX_HEIGHT],
                    });
                    const sodiumHeight = barGrowAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0, (item.sodium / 100) * BAR_MAX_HEIGHT],
                    });
                    const barOpacity = barGrowAnim.interpolate({
                      inputRange: [0, 0.2, 1],
                      outputRange: [0, 0.6, 1],
                    });

                    return (
                      <View key={item.day} style={styles.barGroup}>
                        <View style={styles.barsInner}>
                          <Animated.View
                            style={[
                              styles.miniBar,
                              {
                                height: hydrationHeight,
                                backgroundColor: `rgba(16,185,129,${faded})`,
                                opacity: barOpacity,
                                transform: [{ translateY: itemDelay * 0.02 }],
                              },
                            ]}
                          />
                          <Animated.View
                            style={[
                              styles.miniBar,
                              {
                                height: proteinHeight,
                                backgroundColor: `rgba(245,158,11,${faded})`,
                                opacity: barOpacity,
                                transform: [{ translateY: itemDelay * 0.015 }],
                              },
                            ]}
                          />
                          <Animated.View
                            style={[
                              styles.miniBar,
                              {
                                height: sodiumHeight,
                                backgroundColor: `rgba(168,85,247,${faded})`,
                                opacity: barOpacity,
                                transform: [{ translateY: itemDelay * 0.01 }],
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.barLabel, { color: item.active ? theme.text : theme.textSecondary, fontWeight: item.active ? '700' : '500' }]}>
                          {item.day}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>
          </View>
        </View>

        <View style={{ height: 40 }} />
        </Animated.View>
      </ScrollView>

      <Modal
        visible={assistantOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAssistantOpen(false)}
      >
        <Pressable style={styles.assistantOverlay} onPress={() => setAssistantOpen(false)}>
          <Pressable
            style={[styles.assistantCard, { backgroundColor: theme.surface, borderColor: isDark ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.85)' }]}
            onPress={() => {}}
          >
            <View style={[styles.assistantGlow, { backgroundColor: `${currentAssistant.accent}1A` }]} />
            <View style={styles.assistantHeader}>
              <View>
                <Text style={[styles.assistantTitle, { color: theme.text }]}>智能建议</Text>
                <Text style={[styles.assistantSubTitle, { color: theme.textSecondary }]}>SMART GOAL SETTING</Text>
              </View>
              <TouchableOpacity
                style={[styles.assistantCloseBtn, { backgroundColor: isDark ? 'rgba(51,65,85,0.8)' : '#f1f5f9' }]}
                onPress={() => setAssistantOpen(false)}
              >
                <MaterialIcons name="close" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.assistantTabs, { backgroundColor: isDark ? 'rgba(51,65,85,0.48)' : '#f8fafc' }]}>
              {(['水分', '蛋白质', '钠'] as const).map((tab) => {
                const active = assistantTab === tab;
                return (
                  <TouchableOpacity
                    key={tab}
                    onPress={() => {
                      setAssistantTab(tab);
                      setManualGoal(assistantTheme[tab].placeholder);
                    }}
                    style={[
                      styles.assistantTabBtn,
                      active && {
                        backgroundColor: isDark ? 'rgba(51,65,85,0.9)' : '#fff',
                        shadowColor: '#000',
                        shadowOpacity: isDark ? 0 : 0.05,
                        shadowOffset: { width: 0, height: 1 },
                        shadowRadius: 2,
                        elevation: active ? 1 : 0,
                      },
                    ]}
                  >
                    <Text style={[styles.assistantTabText, { color: active ? currentAssistant.accent : theme.textSecondary }]}>{tab}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.suggestIntroRow}>
              <MaterialIcons name="auto-awesome" size={18} color={currentAssistant.accent} />
              <Text style={[styles.suggestIntroText, { color: theme.textSecondary }]}>基于您的历史记录和今日活动：</Text>
            </View>

            <View style={styles.suggestList}>
              <TouchableOpacity
                style={[
                  styles.suggestItem,
                  {
                    backgroundColor: isDark ? `${currentAssistant.accent}1F` : '#f8fafc',
                    borderColor: isDark ? `${currentAssistant.accent}40` : `${currentAssistant.accent}33`,
                  },
                ]}
              >
                <View>
                  <Text style={[styles.suggestTag, { color: currentAssistant.accent }]}>今日最佳(基于你的活动和身体指标计算)</Text>
                  <Text style={[styles.suggestValue, { color: currentAssistant.accent }]}>
                    {currentAssistant.best} <Text style={styles.suggestValueUnit}>{currentAssistant.unit}</Text>
                  </Text>
                </View>
                <View style={[styles.suggestDone, { backgroundColor: currentAssistant.accent }]}> 
                  <MaterialIcons name="done" size={14} color="#fff" />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.suggestItem,
                  {
                    backgroundColor: isDark ? 'rgba(51,65,85,0.45)' : '#f8fafc',
                    borderColor: isDark ? 'rgba(148,163,184,0.18)' : '#e2e8f0',
                  },
                ]}
              >
                <View>
                  <Text style={[styles.suggestTag, { color: theme.textSecondary }]}>上周平均(基于您的日常活动指标计算)</Text>
                  <Text style={[styles.suggestValueAlt, { color: theme.text }]}> 
                    {avgValue} <Text style={styles.suggestValueUnit}>{currentAssistant.unit}</Text>
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={18} color={theme.textSecondary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.suggestItem,
                  {
                    backgroundColor: isDark ? 'rgba(51,65,85,0.45)' : '#f8fafc',
                    borderColor: isDark ? 'rgba(148,163,184,0.18)' : '#e2e8f0',
                  },
                ]}
              >
                <View>
                  <Text style={[styles.suggestTag, { color: theme.textSecondary }]}>社群达标(基于您的身体指标计算)</Text>
                  <Text style={[styles.suggestValueAlt, { color: theme.text }]}> 
                  {(communityValue)} <Text style={styles.suggestValueUnit}>{currentAssistant.unit}</Text>
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={[styles.manualWrap, { borderTopColor: isDark ? 'rgba(148,163,184,0.18)' : '#e2e8f0' }]}> 
              <Text style={[styles.manualLabel, { color: theme.textSecondary }]}>手动调整精确值</Text>
              <View style={styles.manualRow}>
                <View style={[styles.manualInputWrap, { backgroundColor: isDark ? 'rgba(51,65,85,0.7)' : '#f1f5f9' }]}> 
                  <TextInput
                    value={manualGoal}
                    onChangeText={setManualGoal}
                    keyboardType="number-pad"
                    placeholder={currentAssistant.placeholder}
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.manualInput, { color: theme.text }]}
                  />
                  <Text style={[styles.manualUnit, { color: theme.textSecondary }]}>{currentAssistant.unit.toUpperCase()}</Text>
                </View>
                <TouchableOpacity style={[styles.sendBtn, { backgroundColor: isDark ? '#fff' : '#0f172a' }]}> 
                  <MaterialIcons name="send" size={18} color={isDark ? '#0f172a' : '#fff'} />
                </TouchableOpacity>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <RecordIntakeSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  header: { paddingHorizontal: 24, paddingTop: 10, paddingBottom: 12, zIndex: 10 },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  calendarBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  weekPage: {
    paddingRight: 0,
    overflow: 'visible',
  },
  weekStripContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    gap: 6,
  },
  weekDayItem: {
    minWidth: 42,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 7,
    alignItems: 'center',
    borderWidth: 1,
    zIndex: 3,
  },
  weekDayContent: {
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 26,
  },
  weekDayDate: {
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: 'center',
  },
  weekDayLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    lineHeight: 12,
    textAlign: 'center',
    marginTop: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 40,
  },
  bgOrb: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 999,
    zIndex: 0,
  },
  bgOrbTop: {
    top: 18,
    right: -72,
  },
  bgOrbMiddle: {
    top: 280,
    left: -88,
  },
  metricsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 24,
  },
  metricCard: {
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.07,
    shadowRadius: 5,
    overflow: 'hidden',
  },
  metricCardGlow: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    top: -24,
    right: -18,
  },
  progressContainer: {
    position: 'relative',
    marginBottom: 8,
  },
  iconContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metricLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  metricValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  metricSubValue: {
    fontSize: 10,
    marginTop: 4,
  },
  statusCard: {
    borderRadius: 24,
    padding: 18,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.10)',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    overflow: 'hidden',
  },
  statusItem: {
    flexDirection: 'row',
    gap: 12,
  },
  statusItemSpacing: {
    marginTop: 14,
  },
  statusItemAccent: {
    width: 4,
    borderRadius: 999,
  },
  statusItemBody: {
    flex: 1,
  },
  statusLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  statusItemTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  statusBadge: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  statusDesc: {
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  statusValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  statusValueMain: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginRight: 8,
  },
  statusValueSub: {
    fontSize: 12,
    fontWeight: '600',
  },
  statusTrack: {
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(148,163,184,0.16)',
    overflow: 'hidden',
    marginTop: 10,
  },
  statusTrackFill: {
    height: '100%',
    borderRadius: 999,
  },
  section: {
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  editBtn: {
    fontSize: 14,
    fontWeight: '600',
  },
  quickAddRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  quickAddCard: {
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.10)',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  quickAddIcon: {
    marginBottom: 8,
  },
  quickAddLabel: {
    fontSize: 13,
    marginBottom: 4,
  },
  quickAddValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  mainBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 999,
    elevation: 4,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.28,
    shadowRadius: 10,
  },
  mainBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  trendCard: {
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
  },
  trendHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  trendTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  trendSub: {
    fontSize: 14,
    fontWeight: '600',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 16,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  legendText: {
    fontSize: 12,
    fontWeight: '500',
  },
  legendValue: {
    fontSize: 11,
    fontWeight: '800',
    marginLeft: 2,
  },
  chartContainer: {
    height: 196,
  },
  chartInner: {
    flex: 1,
    flexDirection: 'row',
    gap: 8,
  },
  yAxis: {
    width: 24,
    height: 152,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 22,
  },
  yTickText: {
    fontSize: 10,
    fontWeight: '600',
  },
  plotArea: {
    flex: 1,
    height: 152,
    position: 'relative',
  },
  gridLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  barsRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  barGroup: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    zIndex: 1,
  },
  barsInner: {
    width: '100%',
    height: 130,
    alignItems: 'flex-end',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2,
  },
  miniBar: {
    width: 4,
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
  },
  barLabel: {
    fontSize: 11,
  },
  assistantOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  assistantCard: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 34,
    borderWidth: 1,
    padding: 20,
    overflow: 'hidden',
  },
  assistantGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 110,
  },
  assistantHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  assistantTitle: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  assistantSubTitle: {
    marginTop: 4,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.8,
  },
  assistantCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantTabs: {
    borderRadius: 16,
    padding: 6,
    flexDirection: 'row',
    gap: 6,
    marginBottom: 18,
  },
  assistantTabBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  assistantTabText: {
    fontSize: 12,
    fontWeight: '700',
  },
  suggestIntroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
  },
  suggestIntroText: {
    fontSize: 13,
    fontWeight: '500',
  },
  suggestList: {
    gap: 10,
    marginBottom: 16,
  },
  suggestItem: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  suggestTag: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 4,
  },
  suggestValue: {
    fontSize: 24,
    fontWeight: '700',
  },
  suggestValueAlt: {
    fontSize: 22,
    fontWeight: '700',
  },
  suggestValueUnit: {
    fontSize: 12,
    fontWeight: '500',
  },
  suggestDone: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualWrap: {
    borderTopWidth: 1,
    paddingTop: 14,
  },
  manualLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 10,
  },
  manualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  manualInputWrap: {
    flex: 1,
    borderRadius: 16,
    paddingHorizontal: 14,
    height: 54,
    flexDirection: 'row',
    alignItems: 'center',
  },
  manualInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
  },
  manualUnit: {
    fontSize: 12,
    fontWeight: '700',
    marginLeft: 8,
  },
  sendBtn: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
