import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function PulseDot({ color }: { color: string }) {
  const scale = React.useRef(new Animated.Value(1)).current;
  const opacity = React.useRef(new Animated.Value(0.45)).current;

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 2.4, duration: 1100, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0, duration: 1100, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.45, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );

    loop.start();
    return () => loop.stop();
  }, [opacity, scale]);

  return (
    <View style={styles.pulseWrap}>
      <Animated.View style={[styles.pulseRing, { backgroundColor: color, transform: [{ scale }], opacity }]} />
      <View style={[styles.pulseCenter, { backgroundColor: color }]} />
    </View>
  );
}

function SegmentTabs({
  tabs,
  active,
  onChange,
  color,
  muted,
}: {
  tabs: Array<{ key: string; label: string }>;
  active: string;
  onChange: (key: string) => void;
  color: string;
  muted: string;
}) {
  return (
    <View style={styles.segmentRow}>
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Pressable key={tab.key} onPress={() => onChange(tab.key)} style={styles.segmentBtn}>
            <Text
              style={[
                styles.segmentText,
                {
                  color: isActive ? color : muted,
                  borderBottomColor: isActive ? color : 'transparent',
                  fontWeight: isActive ? '800' : '600',
                },
              ]}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TasksScreen() {
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [taskTab, setTaskTab] = React.useState<'all' | 'inbox'>('all');
  const [projectTab, setProjectTab] = React.useState<'all' | 'inbox'>('all');

  const pageFadeAnim = React.useRef(new Animated.Value(0)).current;
  const pageTranslateAnim = React.useRef(new Animated.Value(18)).current;
  const frogCardAnim = React.useRef(new Animated.Value(0)).current;
  const matrixAnim = React.useRef(new Animated.Value(0)).current;
  const projectAnim = React.useRef(new Animated.Value(0)).current;
  const bgFloatAnim = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(pageFadeAnim, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(pageTranslateAnim, {
          toValue: 0,
          duration: 420,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
      Animated.stagger(90, [
        Animated.timing(frogCardAnim, {
          toValue: 1,
          duration: 440,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(matrixAnim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(projectAnim, {
          toValue: 1,
          duration: 460,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]),
    ]).start();
  }, [frogCardAnim, matrixAnim, pageFadeAnim, pageTranslateAnim, projectAnim]);

  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bgFloatAnim, {
          toValue: 1,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bgFloatAnim, {
          toValue: 0,
          duration: 3200,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    loop.start();
    return () => loop.stop();
  }, [bgFloatAnim]);

  const openTask = (id: string) => {
    router.push({ pathname: '/task/[id]', params: { id } });
  };

  const bg = isDark ? theme.background : '#faf8ff';
  const card = isDark ? 'rgba(30, 41, 59, 0.45)' : '#ffffff';
  const soft = isDark ? 'rgba(51,65,85,0.55)' : '#f2f3ff';
  const outline = isDark ? 'rgba(148,163,184,0.6)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.20)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const tertiary = isDark ? '#fbbf24' : '#825100';
  const error = isDark ? '#f87171' : '#ba1a1a';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bgOrb,
            styles.bgOrbTop,
            {
              backgroundColor: `${primary}18`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 10],
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
            styles.bgOrbBottom,
            {
              backgroundColor: `${secondary}16`,
              transform: [
                {
                  translateY: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, 10],
                  }),
                },
                {
                  translateX: bgFloatAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -8],
                  }),
                },
              ],
            },
          ]}
        />

        <Animated.View
          style={{
            opacity: pageFadeAnim,
            transform: [{ translateY: pageTranslateAnim }],
          }}
        >
        <View style={styles.section}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>今日青蛙</Text>
              <MaterialIcons name="eco" size={20} color={secondary} />
            </View>
            <Pressable
              onPress={() => router.push('/add-frog')}
              style={({ pressed }) => [styles.ghostBtn, { borderColor: `${secondary}44` }, pressed && { opacity: 0.8 }]}>
              <MaterialIcons name="add" size={14} color={secondary} />
              <Text style={[styles.ghostBtnText, { color: secondary }]}>添加青蛙</Text>
            </Pressable>
          </View>

          <Animated.View
            style={{
              opacity: frogCardAnim,
              transform: [
                {
                  translateY: frogCardAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [16, 0],
                  }),
                },
                {
                  scale: frogCardAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.97, 1],
                  }),
                },
              ],
            }}
          >
          <View style={[styles.frogCard, { backgroundColor: card, borderLeftColor: secondary }]}> 
            <View style={styles.frogIconBg}>
              <MaterialIcons name="eco" size={52} color={`${secondary}22`} />
            </View>
            <View style={styles.frogTopRow}>
              <View style={[styles.badge, { backgroundColor: `${secondary}16` }]}>
                <Text style={[styles.badgeText, { color: secondary }]}>核心挑战</Text>
              </View>
              <MaterialIcons name="radio-button-unchecked" size={20} color={secondary} />
            </View>
            <Text style={[styles.frogTitle, { color: theme.text }]}>完成季度战略分析报告</Text>
            <Text style={[styles.frogDesc, { color: theme.textSecondary }]}>这是今天最难、最重要的任务。完成后将释放大部分心理压力。</Text>
            <View style={styles.progressMeta}>
              <Text style={[styles.progressLabel, { color: outline }]}>进度</Text>
              <Text style={[styles.progressLabel, { color: outline }]}>65%</Text>
            </View>
            <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(148,163,184,0.16)' : '#e2e7ff' }]}>
              <View style={[styles.progressFill, { backgroundColor: secondary, width: '65%' }]} />
            </View>
          </View>

          <View style={[styles.frogDoneCard, { backgroundColor: soft, borderLeftColor: `${secondary}66` }]}>
            <View style={styles.frogDoneRow}>
              <Text style={[styles.frogDoneTitle, { color: theme.text }]}>核心客户年度复盘会议</Text>
              <MaterialIcons name="check-circle" size={20} color={`${secondary}99`} />
            </View>
            <View style={styles.metaRow}>
              <MaterialIcons name="schedule" size={14} color={outline} />
              <Text style={[styles.metaText, { color: outline }]}>14:30 - 16:00</Text>
            </View>
          </View>
          </Animated.View>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: theme.text, marginBottom: 8 }]}>任务列表</Text>
          <SegmentTabs
            tabs={[{ key: 'all', label: '全部' }, { key: 'inbox', label: '收集箱' }]}
            active={taskTab}
            onChange={(k) => setTaskTab(k as 'all' | 'inbox')}
            color={primary}
            muted={outline}
          />

          <Animated.View
            style={{
              opacity: matrixAnim,
              transform: [
                {
                  translateY: matrixAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [18, 0],
                  }),
                },
              ],
            }}
          >
          <View style={[styles.matrixWrap, { borderColor: outlineVariant, backgroundColor: `${outlineVariant}28` }]}>
            <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
              <View style={styles.quadHead}>
                <View style={styles.quadTitleRow}>
                  <PulseDot color={error} />
                  <Text style={[styles.quadTitle, { color: error }]}>紧急且重要 (立即执行)</Text>
                </View>
              </View>
              <Pressable style={styles.taskRow} onPress={() => openTask('paybug')}>
                <MaterialIcons name="radio-button-unchecked" size={20} color={error} />
                <View style={styles.taskBody}>
                  <Text style={[styles.taskText, { color: theme.text }]}>修复生产环境支付漏洞</Text>
                  <View style={[styles.deadlineBadge, { backgroundColor: `${error}14` }]}>
                    <Text style={[styles.deadlineText, { color: error }]}>12:00 截止</Text>
                  </View>
                </View>
              </Pressable>
              <Pressable style={styles.taskRow} onPress={() => openTask('investor')}>
                <MaterialIcons name="radio-button-unchecked" size={20} color={error} />
                <View style={styles.taskBody}>
                  <Text style={[styles.taskText, { color: theme.text }]}>回复主要投资人邮件</Text>
                  <View style={styles.metaRow}>
                    <MaterialIcons name="refresh" size={12} color={outline} />
                    <Text style={[styles.metaHint, { color: outline }]}>每周重复</Text>
                  </View>
                </View>
              </Pressable>
            </View>

            <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
              <View style={styles.quadHead}>
                <View style={styles.quadTitleRow}>
                  <View style={[styles.dot, { backgroundColor: primary }]} />
                  <Text style={[styles.quadTitle, { color: primary }]}>不紧急但重要 (计划执行)</Text>
                </View>
              </View>
              <Pressable style={styles.taskRow} onPress={() => openTask('fitness')}>
                <MaterialIcons name="radio-button-unchecked" size={20} color={primary} />
                <View style={styles.taskBody}>
                  <Text style={[styles.taskText, { color: theme.text }]}>制定下半年度健身计划</Text>
                  <View style={styles.metaRow}>
                    <MaterialIcons name="account-tree" size={12} color={outline} />
                    <Text style={[styles.metaHint, { color: outline }]}>4 个子任务</Text>
                  </View>
                </View>
              </Pressable>
              <Pressable style={styles.taskRow} onPress={() => openTask('rust')}>
                <MaterialIcons name="radio-button-unchecked" size={20} color={primary} />
                <View style={styles.taskBody}>
                  <Text style={[styles.taskText, { color: theme.text }]}>深入学习 Rust 编程</Text>
                  <View style={styles.metaRow}>
                    <MaterialIcons name="refresh" size={12} color={outline} />
                    <Text style={[styles.metaHint, { color: outline }]}>每日重复</Text>
                  </View>
                </View>
              </Pressable>
            </View>

            <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
              <View style={styles.quadHead}>
                <View style={styles.quadTitleRow}>
                  <View style={[styles.dot, { backgroundColor: tertiary }]} />
                  <Text style={[styles.quadTitle, { color: tertiary }]}>紧急但不重要 (委派他人)</Text>
                </View>
              </View>
              <Pressable style={styles.taskRow} onPress={() => openTask('dinner')}>
                <MaterialIcons name="radio-button-unchecked" size={20} color={tertiary} />
                <View style={styles.taskBody}>
                  <Text style={[styles.taskText, { color: theme.text }]}>预订团队聚餐场地</Text>
                  <View style={[styles.deadlineBadge, { backgroundColor: `${tertiary}14` }]}>
                    <Text style={[styles.deadlineText, { color: tertiary }]}>18:00 前确认</Text>
                  </View>
                </View>
              </Pressable>
              <View style={[styles.taskDoneRow, { opacity: 0.45 }]}>
                <MaterialIcons name="check-circle" size={20} color={tertiary} />
                <Text style={[styles.taskText, { color: theme.text, textDecorationLine: 'line-through' }]}>整理上周差旅票据</Text>
              </View>
            </View>

            <View style={[styles.quadrant, { backgroundColor: card, borderColor: outlineVariant }]}>
              <View style={styles.quadHead}>
                <View style={styles.quadTitleRow}>
                  <View style={[styles.dot, { backgroundColor: outline }]} />
                  <Text style={[styles.quadTitle, { color: outline }]}>不紧急不重要 (尽量消除)</Text>
                </View>
              </View>
              <Pressable style={styles.taskDoneRow} onPress={() => openTask('social')}>
                <MaterialIcons name="radio-button-unchecked" size={20} color={outline} />
                <Text style={[styles.taskText, { color: theme.text }]}>浏览社交媒体非必要资讯</Text>
              </Pressable>
            </View>
          </View>
          </Animated.View>
        </View>

        <Animated.View
          style={{
            opacity: projectAnim,
            transform: [
              {
                translateY: projectAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [20, 0],
                }),
              },
            ],
          }}
        >
        <View style={styles.section}>
          <View style={styles.headerRow}>
            <View style={styles.titleRow}>
              <Text style={[styles.sectionTitle, { color: theme.text }]}>项目列表</Text>
              <Text style={[styles.sectionMeta, { color: outline }]}>共 2 个活跃项目</Text>
            </View>
            <Pressable
              onPress={() => router.push('/add-task')}
              style={({ pressed }) => [styles.ghostBtn, { borderColor: `${primary}44` }, pressed && { opacity: 0.8 }]}>
              <MaterialIcons name="add-circle" size={14} color={primary} />
              <Text style={[styles.ghostBtnText, { color: primary }]}>新建项目</Text>
            </Pressable>
          </View>

          <SegmentTabs
            tabs={[{ key: 'all', label: '全部' }, { key: 'inbox', label: '收集箱' }]}
            active={projectTab}
            onChange={(k) => setProjectTab(k as 'all' | 'inbox')}
            color={primary}
            muted={outline}
          />

          <View style={[styles.projectCard, { backgroundColor: card }]}> 
            <View style={[styles.projectHead, { borderLeftColor: primary }]}> 
              <View style={styles.projectHeadLeft}>
                <MaterialIcons name="inventory-2" size={22} color={primary} />
                <View>
                  <Text style={[styles.projectTitle, { color: theme.text }]}>2024 新版 UI 设计系统</Text>
                  <View style={styles.projectSubRow}>
                    <Text style={[styles.projectSub, { color: outline }]}>由于 10月24日 交付</Text>
                    <Text style={[styles.projectSub, { color: outline }]}>•</Text>
                    <Text style={[styles.projectSubStrong, { color: primary }]}>核心项目</Text>
                  </View>
                </View>
              </View>
              <View style={styles.projectHeadRight}>
                <View style={styles.projectCount}>
                  <Text style={[styles.projectCountMain, { color: theme.text }]}>12 / 20</Text>
                  <Text style={[styles.projectCountSub, { color: outline }]}>已完成子项</Text>
                </View>
                <MaterialIcons name="expand-more" size={22} color={outline} />
              </View>
            </View>

            <View style={[styles.projectBody, { borderTopColor: `${outlineVariant}55` }]}>
              <View style={styles.subtaskRow}>
                <View style={styles.subtaskLeft}>
                  <MaterialIcons name="check-circle" size={20} color={primary} />
                  <Text style={[styles.subtaskText, { color: theme.textSecondary, textDecorationLine: 'line-through' }]}>定义核心调色盘</Text>
                </View>
                <Text style={[styles.subtaskStatus, { color: outline }]}>已完成</Text>
              </View>

              <View style={[styles.nested, { borderLeftColor: `${outlineVariant}90` }]}>
                <View style={styles.subtaskRow}>
                  <View style={styles.subtaskLeft}>
                    <MaterialIcons name="radio-button-unchecked" size={20} color={primary} />
                    <Text style={[styles.subtaskText, { color: theme.text }]}>子任务：研究竞争对手配色</Text>
                  </View>
                </View>
                <View style={[styles.nested, { borderLeftColor: `${outlineVariant}90` }]}>
                  <View style={styles.subtaskRow}>
                    <View style={styles.subtaskLeft}>
                      <MaterialIcons name="radio-button-unchecked" size={20} color={primary} />
                      <Text style={[styles.subtaskText, { color: theme.text }]}>孙任务：对比 A 应用调色</Text>
                    </View>
                  </View>
                  <View style={[styles.nested, { borderLeftColor: `${outlineVariant}90` }]}>
                    <View style={styles.subtaskRow}>
                      <View style={styles.subtaskLeft}>
                        <MaterialIcons name="radio-button-unchecked" size={20} color={primary} />
                        <Text style={[styles.subtaskText, { color: theme.text }]}>曾孙任务：导出 HEX 代码</Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>

              <View style={[styles.flatRow, { borderTopColor: `${outlineVariant}55`, borderTopWidth: 0 }]}>
                <View style={styles.flatLeft}>
                  <MaterialIcons name="radio-button-unchecked" size={20} color={primary} />
                  <View style={{ gap: 4 }}>
                    <Text style={[styles.taskText, { color: theme.text }]}>构建响应式导航网格</Text>
                    <View style={styles.metaRow}>
                      <MaterialIcons name="schedule" size={12} color={outline} />
                      <Text style={[styles.metaHint, { color: outline }]}>今日 16:00 截止</Text>
                    </View>
                  </View>
                </View>
                <View style={[styles.priorityBadge, { backgroundColor: `${error}14` }]}>
                  <Text style={[styles.priorityText, { color: error }]}>高优先级</Text>
                </View>
              </View>

              <View style={styles.flatRow}>
                <View style={styles.flatLeft}>
                  <MaterialIcons name="radio-button-unchecked" size={20} color={primary} />
                  <Text style={[styles.taskText, { color: theme.text }]}>导出所有 SVG 图标资源</Text>
                </View>
              </View>
            </View>
          </View>

          <View style={[styles.projectCard, { backgroundColor: soft, opacity: 0.86 }]}> 
            <View style={[styles.projectHead, { borderLeftColor: primary }]}> 
              <View style={styles.projectHeadLeft}>
                <MaterialIcons name="data-usage" size={22} color={primary} />
                <View>
                  <Text style={[styles.projectTitle, { color: theme.text }]}>市场调研问卷收集</Text>
                  <Text style={[styles.projectSub, { color: outline }]}>进行中</Text>
                </View>
              </View>
              <MaterialIcons name="expand-more" size={22} color={outline} />
            </View>
          </View>
        </View>
        </Animated.View>

        <View style={{ height: 28 }} />
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18, gap: 18 },
  bgOrb: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 999,
  },
  bgOrbTop: {
    top: 20,
    right: -52,
  },
  bgOrbBottom: {
    top: 440,
    left: -74,
  },
  section: { gap: 12 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  sectionTitle: { fontSize: 22, fontWeight: '800' },
  sectionMeta: { fontSize: 12, fontWeight: '600' },
  ghostBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  ghostBtnText: { fontSize: 12, fontWeight: '800' },

  frogCard: {
    borderRadius: 18,
    borderLeftWidth: 4,
    padding: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.14)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  frogIconBg: { position: 'absolute', right: 8, top: 8 },
  frogTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 10, fontWeight: '800', letterSpacing: 1.1, textTransform: 'uppercase' },
  frogTitle: { fontSize: 20, fontWeight: '800', marginBottom: 6, paddingRight: 40 },
  frogDesc: { fontSize: 13, lineHeight: 19, marginBottom: 14 },
  progressMeta: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  progressLabel: { fontSize: 10, fontWeight: '800' },
  progressTrack: { height: 6, borderRadius: 999, overflow: 'hidden' },
  progressFill: { height: '100%' },

  frogDoneCard: {
    borderRadius: 18,
    borderLeftWidth: 4,
    padding: 16,
  },
  frogDoneRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8, gap: 10 },
  frogDoneTitle: { fontSize: 17, fontWeight: '800', textDecorationLine: 'line-through', opacity: 0.45, flex: 1 },

  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.22)',
    marginBottom: 2,
  },
  segmentBtn: { paddingBottom: 8 },
  segmentText: {
    fontSize: 14,
    letterSpacing: 0.4,
    borderBottomWidth: 2,
    paddingBottom: 8,
  },

  matrixWrap: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  quadrant: {
    width: '50%',
    minHeight: 220,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 10,
  },
  quadHead: { marginBottom: 2 },
  quadTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quadTitle: { fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase', flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },

  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  taskDoneRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  taskBody: { flex: 1, gap: 4 },
  taskText: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  deadlineBadge: { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  deadlineText: { fontSize: 10, fontWeight: '800' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaText: { fontSize: 12, fontWeight: '700' },
  metaHint: { fontSize: 10, fontWeight: '800' },

  pulseWrap: { width: 10, height: 10, alignItems: 'center', justifyContent: 'center' },
  pulseRing: { position: 'absolute', width: 10, height: 10, borderRadius: 999 },
  pulseCenter: { width: 7, height: 7, borderRadius: 999 },

  projectCard: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.12)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  projectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderLeftWidth: 4,
  },
  projectHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingRight: 10 },
  projectHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  projectTitle: { fontSize: 16, fontWeight: '800', marginBottom: 2 },
  projectSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  projectSub: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  projectSubStrong: { fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  projectCount: { alignItems: 'flex-end' },
  projectCountMain: { fontSize: 12, fontWeight: '900' },
  projectCountSub: { fontSize: 10, fontWeight: '700' },

  projectBody: { borderTopWidth: 1, paddingHorizontal: 16, paddingVertical: 10, gap: 6 },
  subtaskRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  subtaskLeft: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, paddingRight: 8 },
  subtaskText: { fontSize: 13, fontWeight: '600' },
  subtaskStatus: { fontSize: 10, fontWeight: '800' },
  nested: { marginLeft: 12, paddingLeft: 12, borderLeftWidth: 1, gap: 4 },

  flatRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderTopWidth: 0 },
  flatLeft: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, flex: 1, paddingRight: 10 },
  priorityBadge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 },
  priorityText: { fontSize: 10, fontWeight: '900' },
});
