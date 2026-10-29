import { AppInput } from '@/components/ui/app-input';
import { MotionPressable } from '@/components/ui/motion-pressable';
import { Motion } from '@/constants/design-tokens';
import { useFoldTheme, type FoldSemanticPalette } from '@/constants/review-fold-theme';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useThemePreference } from '@/contexts/theme-preference-context';
import { resetLocalDatabaseForDebug } from '@/lib/api-local-clear';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import {
  DEFAULT_CLOUD_AUTH_TOKEN,
  DEFAULT_CLOUD_SQL_API_URL,
  clearCloudUserToken,
  getCloudUserCustomToken,
  hasCloudUserTokenSync,
  loadCloudBackupTokenCache,
  setCloudUserToken,
} from '@/lib/cloud-backup-config';
import { getLastFullCloudBackupAtIso } from '@/lib/cloud-backup-meta';
import {
  triggerCloudFullBackup,
  triggerCloudFullRestore,
  type CloudSyncProgress,
} from '@/lib/cloud-sql-sync';
import {
  DAY_BOUNDARY_PAGE_OPTIONS,
  DEFAULT_TASKS_DAY_BOUNDARY,
  formatTasksDayBoundaryLabel,
  type DayBoundaryPageId,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import type { ThemePreference } from '@/lib/theme-preference';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import type { SettingsSection } from './settings-drawer-context';
import { useSettingsDrawer } from './settings-drawer-context';

type ScrollHandle = { scrollTo: (opts: { y: number; animated?: boolean }) => void };

function formatZhFullBackupTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

const CLOUD_BACKUP_PRESS_DEBOUNCE_MS = 1200;

function formatCloudBackupProgressLine(p: CloudSyncProgress | null): string | null {
  if (!p) return null;
  if (p.phase === 'preparing') return '正在准备…';
  if (p.phase === 'collecting') {
    const idx = p.tableIndex ?? 0;
    const total = p.tableCount ?? 0;
    const label = p.tableLabel ?? '表';
    if (label === '分析表依赖') return '正在分析本地表依赖…';
    return total > 0
      ? `正在读取本地数据 ${Math.min(idx, total)}/${total}：${label}`
      : '正在读取本地 SQLite…';
  }
  if (p.phase === 'cloud_schema') {
    const idx = p.tableIndex ?? 0;
    const total = p.tableCount ?? 0;
    const label = p.tableLabel ?? '云端表结构';
    return total > 0 ? `正在同步云端结构 ${Math.min(idx, total)}/${total}：${label}` : label;
  }
  if (p.phase === 'uploading' || p.phase === 'downloading') {
    const idx = p.tableIndex ?? 0;
    const total = p.tableCount ?? 0;
    const label = p.tableLabel ?? '表';
    const verb = p.phase === 'downloading' ? '拉取' : '上传';
    return total > 0 ? `正在${verb} ${Math.min(idx, total)}/${total}：${label}` : `正在${verb}…`;
  }
  if (p.phase === 'applying') {
    const idx = p.tableIndex ?? 0;
    const total = p.tableCount ?? 0;
    const label = p.tableLabel ?? '表';
    if (label === '准备事务') return '正在准备写入本地数据库…';
    return total > 0
      ? `正在写入本地 ${Math.min(idx, total)}/${total}：${label}`
      : '正在写入本地数据库…';
  }
  return null;
}

type IconTone = 'amber' | 'clay' | 'sage' | 'pine';

function toneColors(palette: FoldSemanticPalette, tone: IconTone): { bg: string; fg: string } {
  switch (tone) {
    case 'amber':
      return { bg: palette.amberSoft, fg: palette.amber };
    case 'clay':
      return { bg: palette.claySoft, fg: palette.clay };
    case 'sage':
      return { bg: palette.sageSoft, fg: palette.sageInk };
    case 'pine':
    default:
      return { bg: palette.sageSoft, fg: palette.pine };
  }
}

function IconWell({
  name,
  tone,
  palette,
}: {
  name: React.ComponentProps<typeof MaterialIcons>['name'];
  tone: IconTone;
  palette: FoldSemanticPalette;
}) {
  const c = toneColors(palette, tone);
  return (
    <View style={[styles.iconWell, { backgroundColor: c.bg }]}>
      <MaterialIcons name={name} size={20} color={c.fg} />
    </View>
  );
}

function SectionTitle({ title, color }: { title: string; color: string }) {
  return <Text style={[styles.sectionTitle, { color }]}>{title}</Text>;
}

function GroupCard({
  children,
  palette,
  style,
}: {
  children: React.ReactNode;
  palette: FoldSemanticPalette;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[
        styles.groupCard,
        {
          backgroundColor: palette.card,
          borderColor: palette.lineStrong,
          shadowColor: palette.shadow,
        },
        style,
      ]}>
      {children}
    </View>
  );
}

function NavRow({
  icon,
  tone,
  title,
  hint,
  onPress,
  palette,
  showDivider,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  tone: IconTone;
  title: string;
  hint: string;
  onPress: () => void;
  palette: FoldSemanticPalette;
  showDivider?: boolean;
}) {
  return (
    <MotionPressable
      onPress={onPress}
      pressScale={Motion.pressScaleCard}
      pressOpacity={1}
      style={[styles.navRow, showDivider ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line } : null]}>
      <IconWell name={icon} tone={tone} palette={palette} />
      <View style={styles.navText}>
        <Text style={[styles.rowTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.rowHint, { color: palette.muted }]}>{hint}</Text>
      </View>
      <MaterialIcons name="chevron-right" size={22} color={palette.muted} />
    </MotionPressable>
  );
}

function ActionRow({
  icon,
  tone,
  title,
  hint,
  status,
  busy,
  danger,
  onPress,
  disabled,
  palette,
  progressColor,
}: {
  icon: React.ComponentProps<typeof MaterialIcons>['name'];
  tone: IconTone;
  title: string;
  hint: string;
  status?: string | null;
  busy?: boolean;
  danger?: boolean;
  onPress: () => void;
  disabled?: boolean;
  palette: FoldSemanticPalette;
  progressColor?: string;
}) {
  return (
    <MotionPressable
      onPress={onPress}
      disabled={disabled}
      pressScale={Motion.pressScaleCard}
      pressOpacity={1}
      style={[
        styles.actionRow,
        {
          backgroundColor: palette.card,
          borderColor: danger ? `${palette.clay}59` : palette.lineStrong,
          opacity: disabled ? 0.55 : 1,
          shadowColor: palette.shadow,
        },
      ]}>
      {busy ? (
        <ActivityIndicator size="small" color={progressColor ?? palette.pine} />
      ) : (
        <IconWell name={icon} tone={danger ? 'clay' : tone} palette={palette} />
      )}
      <View style={styles.navText}>
        <Text style={[styles.rowTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.rowHint, { color: palette.muted }]}>{hint}</Text>
        {status ? (
          <Text style={[styles.rowStatus, { color: busy ? progressColor ?? palette.pine : palette.muted }]}>
            {status}
          </Text>
        ) : null}
      </View>
    </MotionPressable>
  );
}

type Props = {
  initialSection: SettingsSection | null;
  onSectionScrolled?: () => void;
  /** 与列表滚动并行识别，用于面板内左滑收起 */
  panCloseGesture?: ReturnType<typeof Gesture.Pan>;
};

export function GlobalSettingsPanel({
  initialSection,
  onSectionScrolled,
  panCloseGesture,
}: Props) {
  const router = useRouter();
  const { close: closeSettingsDrawer } = useSettingsDrawer();
  const { preference, colorScheme, setPreference } = useThemePreference();
  const { palette, fold, isDark } = useFoldTheme();
  const isNight = colorScheme === 'dark';

  const scrollRef = useRef<ScrollHandle | null>(null);
  const sectionOffsets = useRef<Partial<Record<SettingsSection, number>>>({});
  const pendingScroll = useRef(initialSection);

  const {
    boundary: dayBoundary,
    pages: dayBoundaryPages,
    setBoundary: persistDayBoundary,
    setPages: persistDayBoundaryPages,
  } = useDayBoundary();
  const [draftBoundary, setDraftBoundary] = useState<TasksDayBoundary>(() => ({ ...DEFAULT_TASKS_DAY_BOUNDARY }));
  const [dayBoundaryPickerVisible, setDayBoundaryPickerVisible] = useState(false);

  const [cloudTokenDraft, setCloudTokenDraft] = useState('');
  const [cloudTokenConfigured, setCloudTokenConfigured] = useState(() => hasCloudUserTokenSync());
  const [cloudTokenSaving, setCloudTokenSaving] = useState(false);

  const [cloudBackupBusy, setCloudBackupBusy] = useState(false);
  const [cloudBackupProgress, setCloudBackupProgress] = useState<CloudSyncProgress | null>(null);
  const [cloudRestoreBusy, setCloudRestoreBusy] = useState(false);
  const [localDbClearBusy, setLocalDbClearBusy] = useState(false);
  const cloudOpAbortRef = useRef<AbortController | null>(null);
  /** 同步标记：备份/同步进行中（不依赖 setState，避免连点竞态） */
  const cloudOpInFlightRef = useRef(false);
  const lastCloudBackupPressAtRef = useRef(0);

  const cloudOpBusy = cloudBackupBusy || cloudRestoreBusy || localDbClearBusy;
  const [lastFullCloudBackupAtIso, setLastFullCloudBackupAtIso] = useState<string | null>(null);
  const [cloudDiagModal, setCloudDiagModal] = useState<{
    visible: boolean;
    title: string;
    subtitle: string;
    body: string;
  }>({ visible: false, title: '', subtitle: '', body: '' });

  const loadLastFullCloudBackupMeta = useCallback(async () => {
    try {
      const iso = await getLastFullCloudBackupAtIso();
      setLastFullCloudBackupAtIso(iso);
    } catch {
      setLastFullCloudBackupAtIso(null);
    }
  }, []);

  useEffect(() => {
    setDraftBoundary(dayBoundary);
  }, [dayBoundary]);

  const refreshCloudTokenFromStorage = useCallback(async () => {
    await loadCloudBackupTokenCache();
    const custom = await getCloudUserCustomToken();
    setCloudTokenConfigured(hasCloudUserTokenSync());
    setCloudTokenDraft(custom ?? '');
  }, []);

  useEffect(() => {
    void loadLastFullCloudBackupMeta();
    void refreshCloudTokenFromStorage();
  }, [loadLastFullCloudBackupMeta, refreshCloudTokenFromStorage]);

  const saveCloudToken = useCallback(async () => {
    setCloudTokenSaving(true);
    try {
      if (cloudTokenDraft.length === 0) {
        await clearCloudUserToken();
        setCloudTokenConfigured(true);
        toast.success('已恢复默认密钥');
        return;
      }
      await setCloudUserToken(cloudTokenDraft);
      setCloudTokenConfigured(true);
      toast.success('自定义密钥已保存');
    } catch (e) {
      toast.error(toUserMessage(e, '保存失败，请稍后重试'));
    } finally {
      setCloudTokenSaving(false);
    }
  }, [cloudTokenDraft]);

  const clearCloudToken = useCallback(() => {
    Alert.alert('清除自定义密钥', '清除后将使用应用内置默认密钥；也可重新填写自定义密钥。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await clearCloudUserToken();
            setCloudTokenConfigured(false);
            setCloudTokenDraft('');
          })();
        },
      },
    ]);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background') cloudOpAbortRef.current?.abort();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    pendingScroll.current = initialSection;
    if (initialSection && sectionOffsets.current[initialSection] != null) {
      scrollRef.current?.scrollTo({ y: sectionOffsets.current[initialSection]!, animated: true });
      onSectionScrolled?.();
      pendingScroll.current = null;
    }
  }, [initialSection, onSectionScrolled]);

  const scrollToPendingSection = useCallback(() => {
    const target = pendingScroll.current;
    if (!target) return;
    const y = sectionOffsets.current[target];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y, animated: true });
    pendingScroll.current = null;
    onSectionScrolled?.();
  }, [onSectionScrolled]);

  const onSectionLayout = useCallback(
    (section: SettingsSection, y: number) => {
      sectionOffsets.current[section] = y;
      if (pendingScroll.current === section) scrollToPendingSection();
    },
    [scrollToPendingSection],
  );

  const startCloudOp = useCallback(() => {
    cloudOpAbortRef.current?.abort();
    const ac = new AbortController();
    cloudOpAbortRef.current = ac;
    return ac;
  }, []);

  const endCloudOp = useCallback((ac: AbortController) => {
    if (cloudOpAbortRef.current === ac) cloudOpAbortRef.current = null;
  }, []);

  const runCloudBackup = useCallback(async () => {
    if (cloudOpInFlightRef.current) return;
    cloudOpInFlightRef.current = true;

    const ac = startCloudOp();
    setCloudBackupBusy(true);
    setCloudBackupProgress({ phase: 'preparing' });
    try {
      const r = await triggerCloudFullBackup({
        signal: ac.signal,
        onProgress: setCloudBackupProgress,
      });
      if (r.ok) {
        setLastFullCloudBackupAtIso(r.lastUpdated);
        Alert.alert(
          '云备份',
          `已将本地 ${r.tableCount} 张表、共 ${r.rowCount} 行写入云端 D1。\n\n备份时间：${formatZhFullBackupTime(r.lastUpdated)}`,
        );
      } else if (r.reason === 'aborted') {
        Alert.alert('云备份已中止', r.message);
      } else if (r.reason === 'unsupported_platform') {
        Alert.alert('云备份不可用', r.message);
      } else {
        setCloudDiagModal({
          visible: true,
          title: '云备份失败',
          subtitle: r.message,
          body: r.diagnosticText,
        });
      }
    } finally {
      endCloudOp(ac);
      setCloudBackupBusy(false);
      setCloudBackupProgress(null);
      cloudOpInFlightRef.current = false;
    }
  }, [endCloudOp, startCloudOp]);

  const requestCloudBackup = useCallback(() => {
    const now = Date.now();
    if (
      cloudOpInFlightRef.current ||
      cloudOpBusy ||
      now - lastCloudBackupPressAtRef.current < CLOUD_BACKUP_PRESS_DEBOUNCE_MS
    ) {
      return;
    }
    lastCloudBackupPressAtRef.current = now;
    void runCloudBackup();
  }, [cloudOpBusy, runCloudBackup]);

  const runCloudRestore = useCallback(async () => {
    if (cloudOpInFlightRef.current) return;
    cloudOpInFlightRef.current = true;

    const ac = startCloudOp();
    setCloudRestoreBusy(true);
    setCloudBackupProgress({ phase: 'preparing' });
    try {
      const r = await triggerCloudFullRestore({
        signal: ac.signal,
        onProgress: setCloudBackupProgress,
      });
      if (r.ok) {
        setLastFullCloudBackupAtIso(r.cloudLastUpdated);
        const warnBlock =
          r.warnings.length > 0 ? `\n\n注意：\n${r.warnings.map(w => `· ${w}`).join('\n')}` : '';
        Alert.alert(
          '从云同步完成',
          `已用云端数据覆盖本地。\nSQLite：${r.sqliteTables} 张表，共 ${r.sqliteRows} 行。\n\n同步时间：${formatZhFullBackupTime(r.cloudLastUpdated)}${warnBlock}`,
        );
      } else if (r.reason === 'aborted') {
        Alert.alert('从云同步已中止', r.message);
      } else {
        setCloudDiagModal({
          visible: true,
          title: '从云同步失败',
          subtitle: r.message,
          body: r.diagnosticText,
        });
      }
    } finally {
      endCloudOp(ac);
      setCloudRestoreBusy(false);
      setCloudBackupProgress(null);
      cloudOpInFlightRef.current = false;
    }
  }, [endCloudOp, startCloudOp]);

  const requestCloudRestore = useCallback(() => {
    if (cloudOpInFlightRef.current || cloudOpBusy) return;
    Alert.alert(
      '从云同步',
      '将用云端 D1 数据库中的全部表数据覆盖本机 SQLite。未备份的本地改动将丢失。确定继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定覆盖并同步',
          style: 'destructive',
          onPress: () => {
            if (cloudOpInFlightRef.current || cloudOpBusy) return;
            void runCloudRestore();
          },
        },
      ],
    );
  }, [cloudOpBusy, runCloudRestore]);

  const runLocalDatabaseClear = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert('不可用', 'Web 环境无本地 SQLite，请在手机或模拟器上使用。');
      return;
    }
    if (cloudOpInFlightRef.current || localDbClearBusy) return;
    cloudOpInFlightRef.current = true;
    setLocalDbClearBusy(true);
    try {
      await resetLocalDatabaseForDebug();
      Alert.alert(
        '本地数据库已清空',
        '全部业务数据已删除，表结构已重建。请完全退出应用后重新打开，各 Tab 将重新从后端拉取数据。',
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('清空失败', msg);
    } finally {
      setLocalDbClearBusy(false);
      cloudOpInFlightRef.current = false;
    }
  }, [localDbClearBusy]);

  const requestLocalDatabaseClear = useCallback(() => {
    if (cloudOpInFlightRef.current || cloudOpBusy) return;
    Alert.alert(
      '清空本地数据库',
      '将删除本机全部 SQLite 业务数据（任务、项目、习惯、记账等），表结构会重建。此操作不可恢复，仅用于调试。\n\n完成后请完全退出并重新打开应用。',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认清空',
          style: 'destructive',
          onPress: () => void runLocalDatabaseClear(),
        },
      ],
    );
  }, [cloudOpBusy, runLocalDatabaseClear]);

  const saveDayBoundary = useCallback(async () => {
    try {
      await persistDayBoundary(draftBoundary);
      setDayBoundaryPickerVisible(false);
      toast.success('已保存');
    } catch (e) {
      toast.error(toUserMessage(e, '未能保存日界设置，请稍后重试。'));
    }
  }, [draftBoundary, persistDayBoundary]);

  const toggleDayBoundaryPage = useCallback(
    (page: DayBoundaryPageId, enabled: boolean) => {
      const next = enabled
        ? [...new Set([...dayBoundaryPages, page])]
        : dayBoundaryPages.filter(p => p !== page);
      void persistDayBoundaryPages(next).catch(e => {
        toast.error(toUserMessage(e, '未能更新日界作用页面，请稍后重试。'));
      });
    },
    [dayBoundaryPages, persistDayBoundaryPages],
  );

  const onNightModeSwitch = useCallback(
    (enabled: boolean) => {
      void setPreference(enabled ? 'dark' : 'light');
    },
    [setPreference],
  );

  const setThemeMode = useCallback(
    (pref: ThemePreference) => {
      void setPreference(pref);
    },
    [setPreference],
  );

  const go = useCallback(
    (href: string | { pathname: string; params?: Record<string, string> }) => {
      closeSettingsDrawer();
      // expo-router push 接受多种 href；此处收窄为常用形态
      router.push(href as never);
    },
    [closeSettingsDrawer, router],
  );

  const scrollGesture = panCloseGesture
    ? Gesture.Simultaneous(Gesture.Native(), panCloseGesture as never)
    : Gesture.Native();

  const backupProgress = cloudBackupBusy ? formatCloudBackupProgressLine(cloudBackupProgress) : null;
  const restoreProgress = cloudRestoreBusy ? formatCloudBackupProgressLine(cloudBackupProgress) : null;

  return (
    <>
      <GestureDetector gesture={scrollGesture}>
        <ScrollView
          ref={node => {
            scrollRef.current = node as ScrollHandle | null;
          }}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
          <View>
            <SectionTitle title="个人管理" color={palette.inkSoft} />
            <GroupCard palette={palette}>
              <NavRow
                icon="restaurant-menu"
                tone="amber"
                title="我的菜谱"
                hint="按分类管理拿手菜，支持食材/步骤分项录入与成品图"
                onPress={() => go('/my-recipes')}
                palette={palette}
                showDivider
              />
              <NavRow
                icon="description"
                tone="amber"
                title="备忘录"
                hint="本地备忘 · 离线保存；支持标题与正文，左滑可转待办或删除"
                onPress={() => go('/memo-list')}
                palette={palette}
                showDivider
              />
              <NavRow
                icon="favorite"
                tone="clay"
                title="心愿板"
                hint="查看积分余额，用积分兑换心愿；支持新增与列表管理"
                onPress={() => go('/wish-board')}
                palette={palette}
                showDivider
              />
              <NavRow
                icon="notifications-none"
                tone="sage"
                title="通知管理"
                hint="总开关、各模块提醒与已预约列表"
                onPress={() => go({ pathname: '/messages', params: { tab: 'settings' } })}
                palette={palette}
                showDivider
              />
              <NavRow
                icon="public"
                tone="pine"
                title="博客"
                hint="站内阅读 www.jaxz.xyz，打不开时可用浏览器打开"
                onPress={() => go('/blog')}
                palette={palette}
              />
            </GroupCard>
          </View>

          <View>
            <SectionTitle title="系统管理" color={palette.inkSoft} />
            <GroupCard palette={palette}>
              <NavRow
                icon="bug-report"
                tone="sage"
                title="API 请求监控"
                hint="实时查看本机发出的接口请求与返回，支持复制详情"
                onPress={() => go('/api-request-monitor')}
                palette={palette}
                showDivider
              />
              <NavRow
                icon="content-cut"
                tone="pine"
                title="Vision 抠图测试"
                hint="端上人像去背景（iOS 实机 / development build）"
                onPress={() => go('/vision-cutout-test')}
                palette={palette}
              />
            </GroupCard>
          </View>

          <View onLayout={ev => onSectionLayout('appearance', ev.nativeEvent.layout.y)}>
            <View
              style={[
                styles.blockCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.lineStrong,
                  shadowColor: palette.shadow,
                },
              ]}>
              <View style={styles.switchRow}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  <Text style={[styles.rowTitle, { color: palette.ink }]}>夜间模式</Text>
                  <Text style={[styles.rowHint, { color: palette.muted }]}>
                    开启后使用深色界面；也可选择跟随系统。
                  </Text>
                </View>
                <Switch
                  value={isNight}
                  onValueChange={onNightModeSwitch}
                  trackColor={{ false: fold.line2, true: fold.pineButton }}
                  thumbColor="#ffffff"
                  ios_backgroundColor={fold.line2}
                />
              </View>
              <View style={styles.chips}>
                {(['light', 'dark', 'system'] as const).map(mode => {
                  const labels = { light: '浅色', dark: '深色', system: '跟随系统' };
                  const selected = preference === mode;
                  return (
                    <MotionPressable
                      key={mode}
                      onPress={() => setThemeMode(mode)}
                      pressScale={0.97}
                      pressOpacity={1}
                      style={[
                        styles.chip,
                        {
                          borderColor: selected ? palette.pine : palette.lineStrong,
                          backgroundColor: selected ? palette.sageSoft : fold.cardSoft,
                        },
                      ]}>
                      <Text
                        style={[
                          styles.chipText,
                          { color: selected ? palette.pine : palette.inkSoft },
                        ]}>
                        {labels[mode]}
                      </Text>
                    </MotionPressable>
                  );
                })}
              </View>
            </View>
          </View>

          <View onLayout={ev => onSectionLayout('dayBoundary', ev.nativeEvent.layout.y)}>
            <View
              style={[
                styles.blockCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.lineStrong,
                  shadowColor: palette.shadow,
                },
              ]}>
              <Text style={[styles.rowTitle, { color: palette.ink, marginBottom: 4 }]}>日界线设置</Text>
              <Text style={[styles.rowHint, { color: palette.muted, lineHeight: 16, marginBottom: 10 }]}>
                自定义日界只作用于下方勾选页；未到时刻仍算「昨天」；未勾选页按 00:00；记账预算刷新日在记账页单独设。
              </Text>
              <MotionPressable
                onPress={() => {
                  setDraftBoundary(dayBoundary);
                  setDayBoundaryPickerVisible(true);
                }}
                pressScale={Motion.pressScaleCard}
                pressOpacity={1}
                style={[
                  styles.inlineAction,
                  { borderColor: palette.line, backgroundColor: fold.cardSoft },
                ]}>
                <IconWell name="schedule" tone="sage" palette={palette} />
                <View style={styles.navText}>
                  <Text style={[styles.rowTitle, { color: palette.ink }]}>
                    日界时刻 {formatTasksDayBoundaryLabel(dayBoundary)}
                  </Text>
                  <Text style={[styles.rowHint, { color: palette.muted }]}>点开选择时间</Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={palette.muted} />
              </MotionPressable>
              <Text style={[styles.rowHint, { color: palette.muted, marginTop: 10, marginBottom: 6 }]}>
                作用页面 · 关闭某页后，该页改回凌晨 00:00…
              </Text>
              <View style={styles.toggleList}>
                {DAY_BOUNDARY_PAGE_OPTIONS.map(opt => {
                  const enabled = dayBoundaryPages.includes(opt.id);
                  return (
                    <View
                      key={opt.id}
                      style={[
                        styles.toggleItem,
                        {
                          borderColor: palette.line,
                          backgroundColor: fold.cardSoft,
                        },
                      ]}>
                      <View style={{ flex: 1, paddingRight: 10 }}>
                        <Text style={[styles.toggleTitle, { color: palette.ink }]}>{opt.label}</Text>
                        <Text style={[styles.toggleHint, { color: palette.muted }]}>{opt.hint}</Text>
                      </View>
                      <Switch
                        value={enabled}
                        onValueChange={v => toggleDayBoundaryPage(opt.id, v)}
                        trackColor={{ false: fold.line2, true: fold.pineButton }}
                        thumbColor="#ffffff"
                        ios_backgroundColor={fold.line2}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          </View>

          <View onLayout={ev => onSectionLayout('backup', ev.nativeEvent.layout.y)}>
            <SectionTitle title="云备份与同步" color={palette.inkSoft} />
            <View
              style={[
                styles.blockCard,
                {
                  backgroundColor: palette.card,
                  borderColor: palette.lineStrong,
                  shadowColor: palette.shadow,
                  marginBottom: 8,
                },
              ]}>
              <Text style={[styles.rowTitle, { color: palette.ink, marginBottom: 2 }]}>云端 SQL 访问密钥</Text>
              <Text style={[styles.rowHint, { color: palette.muted, marginBottom: 8, lineHeight: 16 }]}>
                接口：{DEFAULT_CLOUD_SQL_API_URL}。含自动增量同步、每 4 小时全表对齐；留空用内置密钥。
              </Text>
              <Text
                style={[
                  styles.rowHint,
                  {
                    color: cloudTokenConfigured ? palette.pine : palette.muted,
                    fontWeight: '700',
                    marginBottom: 8,
                  },
                ]}>
                {cloudTokenConfigured ? '已就绪，可使用下方备份与同步' : '将使用内置默认密钥'}
              </Text>
              <AppInput
                value={cloudTokenDraft}
                onChangeText={setCloudTokenDraft}
                placeholder={`可留空，使用内置默认密钥；默认 ${DEFAULT_CLOUD_AUTH_TOKEN.slice(0, 4)}…`}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
              />
              <View style={styles.btnRow}>
                <MotionPressable
                  onPress={clearCloudToken}
                  disabled={cloudTokenSaving}
                  pressScale={0.97}
                  style={[
                    styles.btn,
                    styles.btnGhost,
                    { borderColor: palette.lineStrong, backgroundColor: fold.cardSoft },
                  ]}>
                  <Text style={[styles.btnText, { color: palette.inkSoft }]}>清除</Text>
                </MotionPressable>
                <MotionPressable
                  onPress={() => void saveCloudToken()}
                  disabled={cloudTokenSaving}
                  pressScale={0.97}
                  style={[
                    styles.btn,
                    styles.btnPrimary,
                    { backgroundColor: fold.pineButton, shadowColor: fold.shadow },
                  ]}>
                  {cloudTokenSaving ? (
                    <ActivityIndicator size="small" color={fold.onPineButton} />
                  ) : (
                    <Text style={[styles.btnText, { color: fold.onPineButton }]}>保存密钥</Text>
                  )}
                </MotionPressable>
              </View>
            </View>

            <ActionRow
              icon="cloud-upload"
              tone="sage"
              title="一键全量备份到云端"
              hint="本机全部 SQLite 表上传至 Cloudflare D1"
              status={
                backupProgress ??
                (lastFullCloudBackupAtIso
                  ? `上次全量备份：${formatZhFullBackupTime(lastFullCloudBackupAtIso)}`
                  : '尚未在本机记录全量备份时间')
              }
              busy={cloudBackupBusy}
              onPress={requestCloudBackup}
              disabled={cloudOpBusy}
              palette={palette}
              progressColor={palette.pine}
            />
            <ActionRow
              icon="cloud-download"
              tone="sage"
              title="从云同步到本机"
              hint="从云端 D1 拉取并覆盖本机 SQLite"
              status={restoreProgress}
              busy={cloudRestoreBusy}
              onPress={requestCloudRestore}
              disabled={cloudOpBusy}
              palette={palette}
              progressColor={palette.pine}
            />
            {Platform.OS !== 'web' ? (
              <ActionRow
                icon="delete-forever"
                tone="clay"
                title="清空本地数据库（调试）"
                hint="删除全部本地业务数据并重建空库，不可恢复"
                busy={localDbClearBusy}
                danger
                onPress={requestLocalDatabaseClear}
                disabled={cloudOpBusy}
                palette={palette}
                progressColor={palette.clay}
              />
            ) : null}
          </View>
        </ScrollView>
      </GestureDetector>

      <Modal
        visible={dayBoundaryPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDayBoundaryPickerVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={[styles.modalBackdrop, { backgroundColor: isDark ? 'rgba(18,26,22,0.55)' : 'rgba(32,42,37,0.45)' }]} onPress={() => setDayBoundaryPickerVisible(false)} />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: palette.card,
                borderColor: palette.line,
                shadowColor: fold.shadow,
              },
            ]}>
            <Text style={[styles.modalTitle, { color: palette.ink }]}>日界时刻</Text>
            <Text style={[styles.rowHint, { color: palette.muted, marginBottom: 8 }]}>选择自定义日界时间</Text>
            <DateTimePicker
              value={new Date(2000, 0, 1, draftBoundary.hour, draftBoundary.minute)}
              mode="time"
              is24Hour
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              themeVariant={isDark ? 'dark' : 'light'}
              onChange={(_, date) => {
                if (date) setDraftBoundary({ hour: date.getHours(), minute: date.getMinutes() });
              }}
            />
            <View style={styles.btnRow}>
              <MotionPressable
                onPress={() => setDraftBoundary({ ...DEFAULT_TASKS_DAY_BOUNDARY })}
                pressScale={0.97}
                style={[styles.btn, styles.btnGhost, { borderColor: palette.lineStrong, backgroundColor: fold.cardSoft }]}>
                <Text style={[styles.btnText, { color: palette.inkSoft }]}>恢复默认</Text>
              </MotionPressable>
              <MotionPressable
                onPress={() => setDayBoundaryPickerVisible(false)}
                pressScale={0.97}
                style={[styles.btn, styles.btnGhost, { borderColor: palette.lineStrong, backgroundColor: fold.cardSoft }]}>
                <Text style={[styles.btnText, { color: palette.inkSoft }]}>取消</Text>
              </MotionPressable>
              <MotionPressable
                onPress={() => void saveDayBoundary()}
                pressScale={0.97}
                style={[styles.btn, styles.btnPrimary, { backgroundColor: fold.pineButton }]}>
                <Text style={[styles.btnText, { color: fold.onPineButton }]}>保存</Text>
              </MotionPressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={cloudDiagModal.visible}
        transparent
        animationType="fade"
        onRequestClose={() => setCloudDiagModal(m => ({ ...m, visible: false }))}>
        <View style={styles.modalRoot}>
          <Pressable
            style={[styles.modalBackdrop, { backgroundColor: isDark ? 'rgba(18,26,22,0.55)' : 'rgba(32,42,37,0.45)' }]}
            onPress={() => setCloudDiagModal(m => ({ ...m, visible: false }))}
          />
          <View
            style={[
              styles.modalCard,
              {
                backgroundColor: palette.card,
                borderColor: palette.line,
                shadowColor: fold.shadow,
                maxHeight: '80%',
              },
            ]}>
            <Text style={[styles.modalTitle, { color: palette.ink }]}>{cloudDiagModal.title}</Text>
            <Text style={[styles.rowHint, { color: palette.muted, marginTop: 4 }]}>{cloudDiagModal.subtitle}</Text>
            <ScrollView style={[styles.diagBody, { backgroundColor: fold.ink, marginTop: 12 }]} nestedScrollEnabled>
              <Text selectable style={{ fontSize: 11, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), color: fold.paper }}>
                {cloudDiagModal.body}
              </Text>
            </ScrollView>
            <MotionPressable
              onPress={() => setCloudDiagModal(m => ({ ...m, visible: false }))}
              pressScale={0.97}
              style={[styles.btn, styles.btnPrimary, { backgroundColor: fold.pineButton, marginTop: 14, alignSelf: 'stretch' }]}>
              <Text style={[styles.btnText, { color: fold.onPineButton }]}>关闭</Text>
            </MotionPressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28, gap: 4 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 8,
    marginHorizontal: 4,
  },
  groupCard: {
    borderRadius: 19,
    borderWidth: 1,
    paddingVertical: 4,
    marginBottom: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.035,
    shadowRadius: 16,
    elevation: 1,
    overflow: 'hidden',
  },
  blockCard: {
    borderRadius: 19,
    borderWidth: 1,
    padding: 14,
    marginBottom: 10,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.035,
    shadowRadius: 16,
    elevation: 1,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  navText: { flex: 1, minWidth: 0 },
  iconWell: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  rowStatus: { fontSize: 10.5, marginTop: 4, fontWeight: '600' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  chips: { flexDirection: 'row', gap: 8, marginTop: 12 },
  chip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 6,
    alignItems: 'center',
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  inlineAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 19,
    borderWidth: 1,
  },
  toggleList: { gap: 10 },
  toggleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  toggleTitle: { fontSize: 13.5, fontWeight: '700' },
  toggleHint: { fontSize: 10.5, marginTop: 2, lineHeight: 14 },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 19,
    borderWidth: 1,
    marginBottom: 8,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  btn: {
    flex: 1,
    height: 36,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { borderWidth: 1 },
  btnPrimary: {
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 2,
  },
  btnText: { fontSize: 13, fontWeight: '700' },
  modalRoot: { flex: 1, justifyContent: 'center', padding: 20 },
  modalBackdrop: { ...StyleSheet.absoluteFill },
  modalCard: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 18,
    marginHorizontal: 8,
    zIndex: 1,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.25,
    shadowRadius: 40,
    elevation: 12,
  },
  modalTitle: { fontSize: 16, fontWeight: '700', marginBottom: 4 },
  diagBody: {
    borderRadius: 12,
    padding: 10,
    maxHeight: 160,
  },
});
