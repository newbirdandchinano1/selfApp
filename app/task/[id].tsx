import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

type Tone = 'error' | 'primary' | 'tertiary' | 'outline';
type Subtask = { id: string; title: string; done: boolean };
type TaskDetail = {
  id: string;
  tone: Tone;
  toneLabel: string;
  title: string;
  deadlineText: string;
  remainingText: string;
  notes: string;
  parentTask?: string;
  subtasks: Subtask[];
};

const MOCK: Record<string, TaskDetail> = {
  paybug: {
    id: 'paybug',
    tone: 'error',
    toneLabel: '重要且紧急',
    title: '修复生产环境支付漏洞',
    deadlineText: '10月24日 18:00',
    remainingText: '剩余 4 小时',
    notes: '该问题影响线上支付链路，需要优先修复并回归验证，避免进一步扩大影响范围。',
    parentTask: '2024 新版 UI 设计系统',
    subtasks: [
      { id: 's1', title: '定位异常日志与复现路径', done: true },
      { id: 's2', title: '修复核心校验逻辑并补充用例', done: false },
      { id: 's3', title: '灰度发布并验证监控指标', done: false },
    ],
  },
  investor: {
    id: 'investor',
    tone: 'error',
    toneLabel: '重要且紧急',
    title: '回复主要投资人邮件',
    deadlineText: '10月24日 12:00',
    remainingText: '剩余 2 小时',
    notes: '回复内容需覆盖本周进展、下周计划与风险点，保持语气简洁明确。',
    parentTask: '2024 新版 UI 设计系统',
    subtasks: [
      { id: 's1', title: '汇总关键数据与里程碑', done: true },
      { id: 's2', title: '撰写邮件并内部确认措辞', done: false },
      { id: 's3', title: '发送邮件并同步相关同事', done: false },
    ],
  },
  fitness: {
    id: 'fitness',
    tone: 'primary',
    toneLabel: '不紧急但重要',
    title: '制定下半年度健身计划',
    deadlineText: '10月24日 20:00',
    remainingText: '剩余 1 天',
    notes: '目标是形成可执行的训练计划与饮食策略，并设置每周复盘节点。',
    parentTask: '年度个人成长计划',
    subtasks: [
      { id: 's1', title: '确认训练目标与周期', done: true },
      { id: 's2', title: '设计训练拆分与强度递进', done: false },
      { id: 's3', title: '设置复盘与调整规则', done: false },
    ],
  },
  rust: {
    id: 'rust',
    tone: 'primary',
    toneLabel: '不紧急但重要',
    title: '深入学习 Rust 编程',
    deadlineText: '10月24日 23:00',
    remainingText: '剩余 3 天',
    notes: '按章节推进并配合小项目练习，重点掌握所有权、生命周期与并发模型。',
    parentTask: '技术深耕路线图',
    subtasks: [
      { id: 's1', title: '阅读所有权与借用章节', done: true },
      { id: 's2', title: '完成一个 CLI 小工具', done: false },
      { id: 's3', title: '总结笔记并做题巩固', done: false },
    ],
  },
  dinner: {
    id: 'dinner',
    tone: 'tertiary',
    toneLabel: '紧急但不重要',
    title: '预订团队聚餐场地',
    deadlineText: '10月24日 18:00',
    remainingText: '剩余 6 小时',
    notes: '优先考虑交通便利与可容纳人数，确认预算与可用时间段。',
    parentTask: '团队运营支持',
    subtasks: [
      { id: 's1', title: '收集人数与时间偏好', done: true },
      { id: 's2', title: '筛选候选餐厅并电话确认', done: false },
      { id: 's3', title: '预订并在群内同步', done: false },
    ],
  },
  social: {
    id: 'social',
    tone: 'outline',
    toneLabel: '不紧急不重要',
    title: '浏览社交媒体非必要资讯',
    deadlineText: '10月24日',
    remainingText: '可推迟',
    notes: '尽量消除无价值消耗，必要时设置时间盒。',
    parentTask: '个人专注力管理',
    subtasks: [
      { id: 's1', title: '设定 10 分钟时间盒', done: false },
      { id: 's2', title: '关闭无关通知', done: false },
      { id: 's3', title: '将时间转投到重要任务', done: false },
    ],
  },
};

function computeProgress(subtasks: Subtask[]) {
  const total = subtasks.length || 1;
  const done = subtasks.filter((s) => s.done).length;
  const pct = Math.round((done / total) * 100);
  return { done, total, pct };
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const task = MOCK[id ?? ''] ?? MOCK.paybug;
  const { done, total, pct } = computeProgress(task.subtasks);
  const [parentTaskOpen, setParentTaskOpen] = React.useState(false);
  const [parentTaskQuery, setParentTaskQuery] = React.useState('');
  const [selectedParentTask, setSelectedParentTask] = React.useState(task.parentTask ?? '2024 新版 UI 设计系统');
  const parentTaskOptions = [
    '2024 新版 UI 设计系统',
    'Q4 市场推广方案',
    '技术深耕路线图',
    '年度个人成长计划',
    '团队运营支持',
  ];
  const filteredParentTasks = parentTaskOptions.filter((name) =>
    name.toLowerCase().includes(parentTaskQuery.trim().toLowerCase()),
  );

  const primary = isDark ? '#60a5fa' : '#0058be';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(194,198,214,0.7)';
  const outline = isDark ? 'rgba(148,163,184,0.65)' : 'rgba(114,119,133,0.8)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.35)' : 'rgba(242,243,255,0.9)';
  const surfaceHigh = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(226,231,255,0.95)';
  const error = isDark ? '#f87171' : '#ba1a1a';
  const tertiary = isDark ? '#fbbf24' : '#825100';

  const toneColor =
    task.tone === 'error' ? error : task.tone === 'tertiary' ? tertiary : task.tone === 'outline' ? outline : primary;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            paddingTop: Math.max(insets.top, 12),
            backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.82)',
          },
        ]}>
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [styles.backBtn, pressed && { opacity: 0.75 }]}>
            <MaterialIcons name="arrow-back" size={22} color={isDark ? theme.text : '#0f172a'} />
          </Pressable>
        </View>
        <View style={[styles.headerDivider, { backgroundColor: isDark ? 'rgba(148,163,184,0.14)' : 'rgba(15,23,42,0.08)' }]} />
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: 92, paddingBottom: 36 + Math.max(insets.bottom, 12) },
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={styles.overview}>
          <View style={[styles.overviewBar, { backgroundColor: toneColor }]} />
          <View style={styles.overviewText}>
            <Text style={[styles.overviewLabel, { color: toneColor }]}>{task.toneLabel}</Text>
            <Text style={[styles.overviewTitle, { color: theme.text }]}>{task.title}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => setParentTaskOpen(true)}
          style={({ pressed }) => [
            styles.parentTaskCard,
            { backgroundColor: theme.surface, borderColor: pressed ? `${primary}33` : 'transparent' },
          ]}
        >
          <View style={styles.parentTaskTextWrap}>
            <Text style={[styles.parentTaskKicker, { color: outline }]}>所属主任务</Text>
            <Text style={[styles.parentTaskName, { color: theme.text }]}>{selectedParentTask}</Text>
          </View>
          <MaterialIcons name="chevron-right" size={20} color={outline} />
        </Pressable>

        <View style={styles.chipsRow}>
          <View style={[styles.chip, { backgroundColor: surfaceLow, borderColor: `${outlineVariant}33` }]}>
            <MaterialIcons name="event" size={18} color={outline} />
            <Text style={[styles.chipText, { color: theme.textSecondary }]}>{task.deadlineText}</Text>
          </View>
          <View style={[styles.chip, { backgroundColor: `${error}1A`, borderColor: `${error}33` }]}>
            <MaterialIcons name="alarm" size={18} color={error} />
            <Text style={[styles.chipTextStrong, { color: isDark ? error : '#93000a' }]}>{task.remainingText}</Text>
          </View>
        </View>

        <View style={styles.block}>
          <View style={styles.blockHeader}>
            <View style={styles.blockHeaderLeft}>
              <Text style={[styles.blockTitle, { color: theme.text }]}>任务拆解</Text>
              <Text style={[styles.blockMeta, { color: primary }]}>{`(${done}/${total} 已完成)`}</Text>
            </View>
            <Pressable
              onPress={() => router.push('/add-subtask')}
              style={({ pressed }) => [
                styles.addSubtaskBtn,
                { backgroundColor: `${primary}0D` },
                pressed && { opacity: 0.8 },
              ]}>
              <MaterialIcons name="add" size={18} color={primary} />
              <Text style={[styles.addSubtaskText, { color: primary }]}>添加子任务</Text>
            </Pressable>
          </View>

          <View style={styles.progressHeader}>
            <Text style={[styles.progressLabel, { color: primary }]}>进度</Text>
            <Text style={[styles.progressLabel, { color: primary }]}>{pct}%</Text>
          </View>
          <View style={[styles.progressTrack, { backgroundColor: surfaceHigh }]}>
            <View style={[styles.progressFill, { width: `${pct}%`, backgroundColor: primary }]} />
          </View>

          <View style={styles.subtaskList}>
            {task.subtasks.map((s) => {
              const doneBg = `${primary}`;
              return (
                <View key={s.id} style={[styles.subtaskRow, { backgroundColor: theme.surface }]}>
                  <View
                    style={[
                      styles.subtaskBox,
                      s.done
                        ? { backgroundColor: doneBg, borderColor: doneBg }
                        : { backgroundColor: 'transparent', borderColor: outlineVariant },
                    ]}>
                    {s.done ? <MaterialIcons name="check" size={14} color="#fff" /> : null}
                  </View>
                  <Text
                    style={[
                      styles.subtaskText,
                      {
                        color: theme.text,
                        textDecorationLine: s.done ? 'line-through' : 'none',
                        opacity: s.done ? 0.5 : 1,
                      },
                    ]}>
                    {s.title}
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        <View style={styles.block}>
          <Text style={[styles.blockTitle, { color: theme.text }]}>备注与背景</Text>
          <View style={[styles.notesCard, { backgroundColor: surfaceLow }]}>
            <Text style={[styles.notesText, { color: theme.textSecondary }]}>{task.notes}</Text>
          </View>
        </View>

        <Pressable
          onPress={() => router.replace('/(tabs)/tasks')}
          style={({ pressed }) => [
            styles.editBtn,
            { backgroundColor: primary, opacity: pressed ? 0.92 : 1 },
            pressed && { transform: [{ scale: 0.98 }] }
          ]}>
          <MaterialIcons name="edit" size={20} color="#fff" />
          <Text style={styles.editText}>编辑任务</Text>
        </Pressable>
      </ScrollView>

      <Modal transparent visible={parentTaskOpen} animationType="fade" onRequestClose={() => setParentTaskOpen(false)}>
        <Pressable style={styles.parentOverlay} onPress={() => setParentTaskOpen(false)}>
          <Pressable
            onPress={() => {}}
            style={[
              styles.parentSheet,
              {
                backgroundColor: theme.background,
                borderColor: isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.5)',
              },
            ]}
          >
            <View style={[styles.parentHandle, { backgroundColor: outlineVariant }]} />
            <View style={styles.parentHeadRow}>
              <Text style={[styles.parentSheetTitle, { color: theme.text }]}>关联主任务</Text>
              <Pressable onPress={() => setParentTaskOpen(false)} style={[styles.parentCloseBtn, { backgroundColor: surfaceLow }]}>
                <MaterialIcons name="close" size={16} color={outline} />
              </Pressable>
            </View>

            <View style={[styles.parentSearchWrap, { backgroundColor: surfaceLow }]}>
              <MaterialIcons name="search" size={20} color={outline} />
              <TextInput
                value={parentTaskQuery}
                onChangeText={setParentTaskQuery}
                placeholder="搜索已有主任务..."
                placeholderTextColor={outline}
                style={[styles.parentSearchInput, { color: theme.text }]}
              />
            </View>

            <ScrollView style={styles.parentList} contentContainerStyle={{ gap: 10 }} showsVerticalScrollIndicator={false}>
              {filteredParentTasks.map((name) => {
                const active = selectedParentTask === name;
                return (
                  <Pressable
                    key={name}
                    onPress={() => setSelectedParentTask(name)}
                    style={({ pressed }) => [
                      styles.parentItem,
                      {
                        backgroundColor: theme.surface,
                        borderColor: active ? `${primary}40` : 'transparent',
                      },
                      pressed && { opacity: 0.86 },
                    ]}
                  >
                    <View style={[styles.parentRadio, { borderColor: active ? primary : outlineVariant }]}>
                      {active ? <View style={[styles.parentRadioInner, { backgroundColor: primary }]} /> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.parentItemTitle, { color: theme.text }]}>{name}</Text>
                      <Text style={[styles.parentItemSub, { color: outline }]}>点击选择为所属主任务</Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <Pressable onPress={() => setParentTaskOpen(false)} style={[styles.parentConfirmBtn, { backgroundColor: primary }]}>
              <Text style={styles.parentConfirmText}>确认关联</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
  },
  headerRow: {
    height: 52,
    paddingHorizontal: 18,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerDivider: {
    height: 1,
    width: '100%',
  },
  content: {
    paddingHorizontal: 18,
    gap: 22,
  },
  overview: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },
  overviewBar: {
    width: 6,
    height: 64,
    borderRadius: 6,
  },
  overviewText: {
    flex: 1,
    gap: 6,
  },
  overviewLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  overviewTitle: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: -0.8,
    lineHeight: 36,
  },
  parentTaskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },
  parentTaskTextWrap: { gap: 4, flex: 1, paddingRight: 10 },
  parentTaskKicker: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontStyle: 'italic',
  },
  parentTaskName: { fontSize: 16, fontWeight: '800' },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
  },
  chipTextStrong: {
    fontSize: 14,
    fontWeight: '800',
  },
  block: {
    gap: 12,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  blockHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    flex: 1,
  },
  blockTitle: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  blockMeta: {
    fontSize: 14,
    fontWeight: '600',
  },
  addSubtaskBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },
  addSubtaskText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: -0.2,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
  },
  progressLabel: {
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
  },
  subtaskList: {
    gap: 10,
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 16,
    elevation: 2,
  },
  subtaskBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtaskText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  notesCard: {
    padding: 16,
    borderRadius: 16,
  },
  notesText: {
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 22,
    elevation: 8,
  },
  editText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '900',
  },
  parentOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  parentSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 18,
    paddingBottom: 18,
    maxHeight: '85%',
  },
  parentHandle: {
    width: 32,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 14,
  },
  parentHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  parentSheetTitle: {
    fontSize: 22,
    fontWeight: '800',
  },
  parentCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  parentSearchInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    paddingVertical: 2,
  },
  parentList: {
    maxHeight: 353,
  },
  parentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  parentRadio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentRadioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  parentItemTitle: {
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 3,
  },
  parentItemSub: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  parentConfirmBtn: {
    marginTop: 14,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parentConfirmText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '800',
  },
});

