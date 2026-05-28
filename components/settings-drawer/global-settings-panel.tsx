import { AppInput } from '@/components/ui/app-input';
import { Colors } from '@/constants/theme';
import { useDayBoundary } from '@/contexts/day-boundary-context';
import { useThemePreference } from '@/contexts/theme-preference-context';
import { loadAiLlmProviderPreference } from '@/lib/ai-llm-provider-preference';
import {
  DEFAULT_GITHUB_FULL_BACKUP_ROOT,
  DEFAULT_KV_API_URL,
  DEFAULT_KV_AUTH_TOKEN,
  clearGithubUserToken,
  getGithubUserCustomToken,
  hasGithubUserTokenSync,
  loadGithubBackupTokenCache,
  setGithubUserToken,
} from '@/lib/github-backup-user-config';
import { repairLocalDatabase } from '@/lib/database';
import { triggerGithubCloudRestoreFromFullBackup } from '@/lib/github-cloud-restore';
import {
  triggerGithubCloudSync,
  type GithubCloudSyncProgress,
} from '@/lib/github-cloud-sync';
import { getLastFullGithubBackupAtIso } from '@/lib/github-full-backup-local-meta';
import {
  DEFAULT_TASKS_DAY_BOUNDARY,
  formatTasksDayBoundaryLabel,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import type { ThemePreference } from '@/lib/theme-preference';
import {
  getZhipuApiKey,
  getZhipuApiKeyFromEnv,
  probeZhipuTextConnectivity,
  type ZhipuConnectivityProbeResult,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector, ScrollView, type PanGesture } from 'react-native-gesture-handler';
import type { SettingsSection } from './settings-drawer-context';
import { useSettingsDrawer } from './settings-drawer-context';

function formatZhFullBackupTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

const CLOUD_BACKUP_PRESS_DEBOUNCE_MS = 1200;

function formatCloudBackupProgressLine(p: GithubCloudSyncProgress | null): string | null {
  if (!p) return null;
  if (p.phase === 'preparing') return '正在准备全量备份…';
  if (p.phase === 'collecting') return '正在读取本地 SQLite 与 KV 数据…';
  if (p.phase === 'uploading') {
    const idx = p.fileIndex ?? 0;
    const total = p.fileCount ?? 0;
    const label = p.fileLabel ?? '文件';
    const progress =
      total > 0 ? `正在上传 ${Math.min(idx, total)}/${total}` : '正在上传';
    const retry =
      p.attempt != null && p.maxAttempts != null && p.attempt > 1
        ? `（第 ${p.attempt}/${p.maxAttempts} 次重试）`
        : '';
    return `${progress}：${label}${retry}`;
  }
  return null;
}

type Props = {
  initialSection: SettingsSection | null;
  onSectionScrolled?: () => void;
  /** 与列表滚动并行识别，用于面板内左滑收起 */
  panCloseGesture?: PanGesture;
};

export function GlobalSettingsPanel({ initialSection, onSectionScrolled, panCloseGesture }: Props) {
  const router = useRouter();
  const { close: closeSettingsDrawer } = useSettingsDrawer();
  const { preference, colorScheme, setPreference } = useThemePreference();
  const isDark = colorScheme === 'dark';
  const theme = Colors[colorScheme];
  const text = theme.text;
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const secondary = isDark ? '#34d399' : '#006c49';
  const memoAccent = isDark ? '#fbbf24' : '#825100';
  const weaknessAccent = isDark ? '#fb923c' : '#c2410c';
  const cardBg = isDark ? 'rgba(30,41,59,0.55)' : '#ffffff';
  const cardBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,88,190,0.12)';

  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<SettingsSection, number>>>({});
  const pendingScroll = useRef(initialSection);

  const { boundary: dayBoundary, setBoundary: persistDayBoundary } = useDayBoundary();
  const [draftBoundary, setDraftBoundary] = useState<TasksDayBoundary>(() => ({ ...DEFAULT_TASKS_DAY_BOUNDARY }));
  const [dayBoundaryPickerVisible, setDayBoundaryPickerVisible] = useState(false);

  const [zhipuProbeLoading, setZhipuProbeLoading] = useState(false);
  const [zhipuProbeResult, setZhipuProbeResult] = useState<ZhipuConnectivityProbeResult | null>(null);
  const [zhipuProbeError, setZhipuProbeError] = useState<string | null>(null);

  const [githubTokenDraft, setGithubTokenDraft] = useState('');
  const [githubTokenConfigured, setGithubTokenConfigured] = useState(() => hasGithubUserTokenSync());
  const [githubTokenSaving, setGithubTokenSaving] = useState(false);

  const [cloudBackupBusy, setCloudBackupBusy] = useState(false);
  const [cloudBackupProgress, setCloudBackupProgress] = useState<GithubCloudSyncProgress | null>(null);
  const [cloudRestoreBusy, setCloudRestoreBusy] = useState(false);
  const [localDbRepairBusy, setLocalDbRepairBusy] = useState(false);
  const githubCloudOpAbortRef = useRef<AbortController | null>(null);
  /** 同步标记：备份/同步进行中（不依赖 setState，避免连点竞态） */
  const githubCloudOpInFlightRef = useRef(false);
  const lastCloudBackupPressAtRef = useRef(0);

  const githubCloudOpBusy = cloudBackupBusy || cloudRestoreBusy || localDbRepairBusy;
  const [lastFullGithubBackupAtIso, setLastFullGithubBackupAtIso] = useState<string | null>(null);
  const [githubDiagModal, setGithubDiagModal] = useState<{
    visible: boolean;
    title: string;
    subtitle: string;
    body: string;
  }>({ visible: false, title: '', subtitle: '', body: '' });

  const loadLastFullGithubBackupMeta = useCallback(async () => {
    try {
      const iso = await getLastFullGithubBackupAtIso();
      setLastFullGithubBackupAtIso(iso);
    } catch {
      setLastFullGithubBackupAtIso(null);
    }
  }, []);

  useEffect(() => {
    setDraftBoundary(dayBoundary);
  }, [dayBoundary]);

  const refreshGithubTokenFromStorage = useCallback(async () => {
    await loadGithubBackupTokenCache();
    const custom = await getGithubUserCustomToken();
    setGithubTokenConfigured(hasGithubUserTokenSync());
    setGithubTokenDraft(custom ?? '');
  }, []);

  useEffect(() => {
    void loadLastFullGithubBackupMeta();
    void loadAiLlmProviderPreference();
    void refreshGithubTokenFromStorage();
  }, [loadLastFullGithubBackupMeta, refreshGithubTokenFromStorage]);

  const saveGithubToken = useCallback(async () => {
    setGithubTokenSaving(true);
    try {
      if (githubTokenDraft.length === 0) {
        await clearGithubUserToken();
        setGithubTokenConfigured(true);
        Alert.alert('已恢复默认', '将使用应用内置 Cloudflare KV 访问密钥。');
        return;
      }
      await setGithubUserToken(githubTokenDraft);
      setGithubTokenConfigured(true);
      Alert.alert('已保存', '自定义密钥已写入本机，重启应用后仍有效。');
    } catch (e) {
      Alert.alert('保存失败', e instanceof Error ? e.message : String(e));
    } finally {
      setGithubTokenSaving(false);
    }
  }, [githubTokenDraft]);

  const clearGithubToken = useCallback(() => {
    Alert.alert('清除自定义密钥', '清除后将使用应用内置默认密钥；也可重新填写自定义密钥。', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await clearGithubUserToken();
            setGithubTokenConfigured(false);
            setGithubTokenDraft('');
          })();
        },
      },
    ]);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background') githubCloudOpAbortRef.current?.abort();
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

  const startGithubCloudOp = useCallback(() => {
    githubCloudOpAbortRef.current?.abort();
    const ac = new AbortController();
    githubCloudOpAbortRef.current = ac;
    return ac;
  }, []);

  const endGithubCloudOp = useCallback((ac: AbortController) => {
    if (githubCloudOpAbortRef.current === ac) githubCloudOpAbortRef.current = null;
  }, []);

  const runCloudBackup = useCallback(async () => {
    if (githubCloudOpInFlightRef.current) return;
    githubCloudOpInFlightRef.current = true;

    const ac = startGithubCloudOp();
    setCloudBackupBusy(true);
    setCloudBackupProgress({ phase: 'preparing' });
    try {
      const r = await triggerGithubCloudSync({
        signal: ac.signal,
        onProgress: setCloudBackupProgress,
      });
      if (r.ok) {
        const iso = r.lastFullBackupAt ?? null;
        if (iso) setLastFullGithubBackupAtIso(iso);
        else void loadLastFullGithubBackupMeta();
        const timeLine =
          iso != null
            ? `\n\n本次备份时间：${formatZhFullBackupTime(iso)}`
            : '';
        const sub = r.upload.commitUrl ? `\n\nmanifest 提交：${r.upload.commitUrl}` : '';
        const multi =
          r.multiFileBackup != null
            ? `\n\n已上传 ${r.multiFileBackup.fileCount} 个 JSON 文件到「${r.multiFileBackup.root}/」。`
            : '';
        Alert.alert('云备份', `各表与本地数据已写入 Cloudflare KV。${multi}${timeLine}${sub}`);
      } else if (r.reason === 'aborted') {
        Alert.alert('云备份已中止', r.message);
      } else if (r.reason === 'unsupported_platform') {
        Alert.alert('云备份不可用', r.message);
      } else {
        setGithubDiagModal({
          visible: true,
          title: '云备份失败',
          subtitle: r.message,
          body: r.diagnosticText,
        });
      }
    } finally {
      endGithubCloudOp(ac);
      setCloudBackupBusy(false);
      setCloudBackupProgress(null);
      githubCloudOpInFlightRef.current = false;
    }
  }, [endGithubCloudOp, loadLastFullGithubBackupMeta, startGithubCloudOp]);

  const requestCloudBackup = useCallback(() => {
    const now = Date.now();
    if (
      githubCloudOpInFlightRef.current ||
      githubCloudOpBusy ||
      now - lastCloudBackupPressAtRef.current < CLOUD_BACKUP_PRESS_DEBOUNCE_MS
    ) {
      return;
    }
    lastCloudBackupPressAtRef.current = now;
    void runCloudBackup();
  }, [githubCloudOpBusy, runCloudBackup]);

  const runCloudRestore = useCallback(async () => {
    if (githubCloudOpInFlightRef.current) return;
    githubCloudOpInFlightRef.current = true;

    const ac = startGithubCloudOp();
    setCloudRestoreBusy(true);
    try {
      const r = await triggerGithubCloudRestoreFromFullBackup({ signal: ac.signal });
      if (r.ok) {
        setLastFullGithubBackupAtIso(r.cloudLastUpdated);
        void loadAiLlmProviderPreference();
        const kvLine = r.kvKeys.length > 0 ? `\n已恢复 KV：${r.kvKeys.join('、')}` : '';
        const financeLine = r.financeSingleFile.applied
          ? `\n账单单文件：流水 ${r.financeSingleFile.bills ?? 0}、账户 ${r.financeSingleFile.accounts ?? 0}、分类 ${r.financeSingleFile.flowCategories ?? 0}${
              r.financeSingleFile.lastUpdated
                ? `（${formatZhFullBackupTime(r.financeSingleFile.lastUpdated)}）`
                : ''
            }`
          : '';
        const warnBlock =
          r.warnings.length > 0 ? `\n\n注意：\n${r.warnings.map(w => `· ${w}`).join('\n')}` : '';
        Alert.alert(
          '从云同步完成',
          `已用云端快照覆盖本地。\nSQLite：${r.sqliteTables} 张表，共 ${r.sqliteRows} 行。${kvLine}${financeLine}\n\nmanifest 时间：${formatZhFullBackupTime(r.cloudLastUpdated)}${warnBlock}`,
        );
      } else if (r.reason === 'aborted') {
        Alert.alert('从云同步已中止', r.message);
      } else {
        setGithubDiagModal({
          visible: true,
          title: '从云同步失败',
          subtitle: r.message,
          body: r.diagnosticText,
        });
      }
    } finally {
      endGithubCloudOp(ac);
      setCloudRestoreBusy(false);
      githubCloudOpInFlightRef.current = false;
    }
  }, [endGithubCloudOp]);

  const requestCloudRestore = useCallback(() => {
    if (githubCloudOpInFlightRef.current || githubCloudOpBusy) return;
    Alert.alert(
      '从云同步',
      '将按云端 manifest.json 所列 key，用全量备份覆盖本机数据。未备份的本地改动将丢失。确定继续？',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确定覆盖并同步',
          style: 'destructive',
          onPress: () => {
            if (githubCloudOpInFlightRef.current || githubCloudOpBusy) return;
            void runCloudRestore();
          },
        },
      ],
    );
  }, [githubCloudOpBusy, runCloudRestore]);

  const runLocalDatabaseRepair = useCallback(async () => {
    if (Platform.OS === 'web') {
      Alert.alert('不可用', 'Web 环境无本地 SQLite，请在手机或模拟器上使用。');
      return;
    }
    if (githubCloudOpInFlightRef.current || localDbRepairBusy) return;
    githubCloudOpInFlightRef.current = true;
    setLocalDbRepairBusy(true);
    try {
      const result = await repairLocalDatabase();
      if (result.remainingFkIssues === 0) {
        Alert.alert(
          '修复完成',
          '已清理孤儿外键并同步任务分类镜像。请完全退出应用后重新打开；若仍无法进入，可再试「从云同步到本机」。',
        );
      } else {
        Alert.alert(
          '部分修复',
          `仍有 ${result.remainingFkIssues} 处外键异常未能自动处理。建议先「一键全量备份」后执行「从云同步到本机」；若无效请反馈具体报错。`,
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      Alert.alert('修复失败', msg);
    } finally {
      setLocalDbRepairBusy(false);
      githubCloudOpInFlightRef.current = false;
    }
  }, [localDbRepairBusy]);

  const requestLocalDatabaseRepair = useCallback(() => {
    if (githubCloudOpInFlightRef.current || githubCloudOpBusy) return;
    Alert.alert(
      '修复本地数据库',
      '将清理云同步后可能产生的孤儿外键（如任务分类不一致），不会删除你的业务数据。完成后建议重启应用。确定继续？',
      [
        { text: '取消', style: 'cancel' },
        { text: '开始修复', onPress: () => void runLocalDatabaseRepair() },
      ],
    );
  }, [githubCloudOpBusy, runLocalDatabaseRepair]);

  const runZhipuConnectivityProbe = useCallback(async () => {
    setZhipuProbeLoading(true);
    setZhipuProbeError(null);
    setZhipuProbeResult(null);
    try {
      const row = await probeZhipuTextConnectivity(getZhipuApiKey());
      setZhipuProbeResult(row);
    } catch (e) {
      setZhipuProbeError(e instanceof Error ? e.message : String(e));
    } finally {
      setZhipuProbeLoading(false);
    }
  }, []);

  const saveDayBoundary = useCallback(async () => {
    try {
      await persistDayBoundary(draftBoundary);
      setDayBoundaryPickerVisible(false);
    } catch {
      Alert.alert('保存失败', '未能保存日界设置，请稍后重试。');
    }
  }, [draftBoundary, persistDayBoundary]);

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

  const renderSectionHead = (kicker: string, title: string) => (
    <View style={styles.sectionHead}>
      <Text style={[styles.kicker, { color: outline }]}>{kicker}</Text>
      <Text style={[styles.sectionTitle, { color: text }]}>{title}</Text>
    </View>
  );

  const scrollGesture = panCloseGesture
    ? Gesture.Simultaneous(Gesture.Native(), panCloseGesture)
    : Gesture.Native();

  return (
    <>
      <GestureDetector gesture={scrollGesture}>
        <ScrollView
          ref={scrollRef}
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled">
        <View style={styles.section}>
          {renderSectionHead('MANAGE', '个人管理')}
          <Pressable
            onPress={() => {
              closeSettingsDrawer();
              router.push('/my-recipes');
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}>
            <View style={[styles.card, styles.actionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <MaterialIcons name="restaurant-menu" size={26} color={isDark ? '#fb923c' : '#c2410c'} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>我的菜谱</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  按分类管理拿手菜，支持食材/步骤分项录入与成品图。
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              closeSettingsDrawer();
              router.push('/memo-list');
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}>
            <View style={[styles.card, styles.actionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <MaterialIcons name="description" size={26} color={memoAccent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>备忘录</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  本地备忘 · 离线保存；支持标题与正文，左滑可转待办或删除。
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              closeSettingsDrawer();
              router.push('/earned-rewards');
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}>
            <View style={[styles.card, styles.actionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <MaterialIcons name="emoji-events" size={26} color={memoAccent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>已获得奖励</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  完成任务或项目后自动入账；在此查看并点击兑现。
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              closeSettingsDrawer();
              router.push('/weakness-list');
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}>
            <View style={[styles.card, styles.actionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <MaterialIcons name="psychology-alt" size={26} color={weaknessAccent} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>我的缺点</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  自我觉察 · 本机保存；记录缺点与表现后自动生成 AI 分析与建议。
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </View>
          </Pressable>

          <Pressable
            onPress={() => {
              closeSettingsDrawer();
              router.push('/my-skills');
            }}
            style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}>
            <View style={[styles.card, styles.actionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              <MaterialIcons name="psychology" size={26} color={secondary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>我的技能</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  记录现有技能与自评，还可添加学习目标；填写描述后可一键请求 AI 评估。
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </View>
          </Pressable>
        </View>

        <View
          onLayout={ev => onSectionLayout('appearance', ev.nativeEvent.layout.y)}
          style={styles.section}>
          {renderSectionHead('APPEARANCE', '外观与夜间模式')}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }]}>
            <View style={styles.rowBetween}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={[styles.rowTitle, { color: text }]}>夜间模式</Text>
                <Text style={[styles.rowHint, { color: outline }]}>
                  开启后使用深色界面；也可选择跟随系统。
                </Text>
              </View>
              <Switch
                value={colorScheme === 'dark'}
                onValueChange={onNightModeSwitch}
                trackColor={{ false: outlineVariant, true: primary }}
                thumbColor="#ffffff"
              />
            </View>
            <View style={styles.themeModeRow}>
              {(['light', 'dark', 'system'] as const).map(mode => {
                const labels = { light: '浅色', dark: '深色', system: '跟随系统' };
                const selected = preference === mode;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => setThemeMode(mode)}
                    style={({ pressed }) => [
                      styles.themeModeChip,
                      {
                        borderColor: selected ? primary : outlineVariant,
                        backgroundColor: selected
                          ? isDark
                            ? 'rgba(96,165,250,0.15)'
                            : 'rgba(0,88,190,0.08)'
                          : 'transparent',
                        opacity: pressed ? 0.85 : 1,
                      },
                    ]}>
                    <Text style={[styles.themeModeChipText, { color: text }]}>{labels[mode]}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View
          onLayout={ev => onSectionLayout('dayBoundary', ev.nativeEvent.layout.y)}
          style={styles.section}>
          {renderSectionHead('DAY BOUNDARY', '应用日界')}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, gap: 10 }]}>
            <Text style={[styles.rowHint, { color: outline, lineHeight: 19 }]}>
              全应用以此时间为新一天的起点：任务与习惯、记账「今日」、首页摄入统计、热力图与 AI 日更等（默认
              00:00）。每月预算周期仍可在记账页单独设置「预算刷新日」。
            </Text>
            <Pressable
              onPress={() => {
                setDraftBoundary(dayBoundary);
                setDayBoundaryPickerVisible(true);
              }}
              style={({ pressed }) => [
                styles.dayBoundaryBtn,
                { borderColor: cardBorder, opacity: pressed ? 0.88 : 1 },
              ]}>
              <MaterialIcons name="schedule" size={22} color={primary} />
              <Text style={[styles.rowTitle, { color: text, flex: 1 }]}>
                当前日界 {formatTasksDayBoundaryLabel(dayBoundary)}
              </Text>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </Pressable>
          </View>
        </View>

        <View
          onLayout={ev => onSectionLayout('backup', ev.nativeEvent.layout.y)}
          style={styles.section}>
          {renderSectionHead('BACKUP', '云备份与同步')}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, gap: 12 }]}>
            <Text style={[styles.rowTitle, { color: text }]}>Cloudflare KV 访问密钥</Text>
            <Text style={[styles.rowHint, { color: outline, lineHeight: 18 }]}>
              接口：{DEFAULT_KV_API_URL}，备份前缀 {DEFAULT_GITHUB_FULL_BACKUP_ROOT}/。留空保存则使用内置默认密钥；自定义密钥仅存本机。
            </Text>
            <Text style={[styles.rowHint, { color: githubTokenConfigured ? primary : outline, fontWeight: '700' }]}>
              {githubTokenConfigured ? '已就绪，可使用下方备份与同步' : '将使用内置默认密钥'}
            </Text>
            <AppInput
              value={githubTokenDraft}
              onChangeText={setGithubTokenDraft}
              placeholder={`留空则用内置密钥；默认 ${DEFAULT_KV_AUTH_TOKEN.slice(0, 4)}…`}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
            />
            <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
              {githubTokenConfigured ? (
                <Pressable
                  onPress={clearGithubToken}
                  disabled={githubTokenSaving}
                  style={({ pressed }) => [{ opacity: pressed || githubTokenSaving ? 0.7 : 1, paddingVertical: 8, paddingHorizontal: 4 }]}>
                  <Text style={{ color: isDark ? '#f87171' : '#b91c1c', fontWeight: '700' }}>清除</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => void saveGithubToken()}
                disabled={githubTokenSaving}
                style={({ pressed }) => [
                  styles.probeBtn,
                  {
                    borderColor: cardBorder,
                    opacity: pressed || githubTokenSaving ? 0.75 : 1,
                    paddingHorizontal: 16,
                    flex: 0,
                  },
                ]}>
                {githubTokenSaving ? (
                  <ActivityIndicator size="small" color={primary} />
                ) : (
                  <Text style={[styles.rowTitle, { color: primary, fontSize: 14 }]}>保存密钥</Text>
                )}
              </Pressable>
            </View>
          </View>
          <Pressable
            onPress={requestCloudBackup}
            disabled={githubCloudOpBusy}
            pointerEvents={githubCloudOpBusy ? 'none' : 'auto'}
            style={({ pressed }) => [
              { opacity: githubCloudOpBusy ? 0.55 : pressed ? 0.88 : 1 },
            ]}>
            <View style={[styles.card, styles.actionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              {cloudBackupBusy ? (
                <ActivityIndicator size="small" color={primary} />
              ) : (
                <MaterialIcons name="cloud-upload" size={26} color={primary} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>一键全量备份到云端</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  SQLite 各表与备忘、技能等数据写入 Cloudflare KV，并更新 manifest。
                </Text>
                {cloudBackupBusy
                  ? (() => {
                      const line = formatCloudBackupProgressLine(cloudBackupProgress);
                      return line ? (
                        <Text style={[styles.rowHint, { color: primary, marginTop: 6, fontWeight: '700' }]}>
                          {line}
                        </Text>
                      ) : null;
                    })()
                  : null}
                <Text style={[styles.rowHint, { color: outline, marginTop: 6, fontSize: 11 }]}>
                  {lastFullGithubBackupAtIso
                    ? `上次全量备份：${formatZhFullBackupTime(lastFullGithubBackupAtIso)}`
                    : '尚未在本机记录全量备份时间。'}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </View>
          </Pressable>

          <Pressable
            onPress={requestCloudRestore}
            disabled={githubCloudOpBusy}
            pointerEvents={githubCloudOpBusy ? 'none' : 'auto'}
            style={({ pressed }) => [
              { opacity: githubCloudOpBusy ? 0.55 : pressed ? 0.88 : 1 },
            ]}>
            <View
              style={[
                styles.card,
                styles.actionCard,
                {
                  backgroundColor: cardBg,
                  borderColor: isDark ? 'rgba(248,113,113,0.35)' : 'rgba(185,28,28,0.25)',
                  marginTop: 10,
                },
              ]}>
              {cloudRestoreBusy ? (
                <ActivityIndicator size="small" color={isDark ? '#f87171' : '#b91c1c'} />
              ) : (
                <MaterialIcons name="cloud-download" size={26} color={isDark ? '#f87171' : '#b91c1c'} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>从云同步到本机</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  从云端 KV 读取 manifest.json，用快照覆盖本机 SQLite 与本地 KV 数据。
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </View>
          </Pressable>

          {Platform.OS !== 'web' ? (
            <Pressable
              onPress={requestLocalDatabaseRepair}
              disabled={githubCloudOpBusy}
              pointerEvents={githubCloudOpBusy ? 'none' : 'auto'}
              style={({ pressed }) => [
                { opacity: githubCloudOpBusy ? 0.55 : pressed ? 0.88 : 1, marginTop: 10 },
              ]}>
              <View
                style={[
                  styles.card,
                  styles.actionCard,
                  {
                    backgroundColor: cardBg,
                    borderColor: isDark ? 'rgba(251,191,36,0.35)' : 'rgba(180,83,9,0.22)',
                  },
                ]}>
                {localDbRepairBusy ? (
                  <ActivityIndicator size="small" color={isDark ? '#fbbf24' : '#b45309'} />
                ) : (
                  <MaterialIcons name="healing" size={26} color={isDark ? '#fbbf24' : '#b45309'} />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, { color: text }]}>修复本地数据库</Text>
                  <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                    启动失败或外键报错时使用：清理孤儿引用并同步分类表，不覆盖云端数据。
                  </Text>
                </View>
                <MaterialIcons name="chevron-right" size={22} color={outline} />
              </View>
            </Pressable>
          ) : null}
        </View>

        <View onLayout={ev => onSectionLayout('ai', ev.nativeEvent.layout.y)} style={styles.section}>
          {renderSectionHead('AI', '文本与识图引擎')}
          <View style={[styles.card, { backgroundColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(0,88,190,0.04)', borderColor: cardBorder, gap: 10 }]}>
            <Text style={[styles.rowHint, { color: outline, lineHeight: 19 }]}>
              记账、备忘、心愿、饮食识图等共用智谱 GLM。可用 EXPO_PUBLIC_ZHIPU_API_KEY 覆盖内置密钥。
            </Text>
            <Text style={[styles.rowHint, { color: outline, fontSize: 11 }]}>
              {getZhipuApiKeyFromEnv() ? '已设置 EXPO_PUBLIC_ZHIPU_API_KEY' : '未设置环境变量时使用应用内置密钥'}
            </Text>

            <Pressable
              onPress={() => void runZhipuConnectivityProbe()}
              disabled={zhipuProbeLoading}
              style={({ pressed }) => [
                styles.probeBtn,
                { borderColor: cardBorder, opacity: pressed || zhipuProbeLoading ? 0.75 : 1 },
              ]}>
              {zhipuProbeLoading ? (
                <ActivityIndicator size="small" color={primary} />
              ) : (
                <MaterialIcons name="cloud-done" size={20} color={primary} />
              )}
              <Text style={[styles.rowTitle, { color: text, fontSize: 14 }]}>
                {zhipuProbeLoading ? '正在测试智谱…' : '测试智谱连通性'}
              </Text>
            </Pressable>

            {zhipuProbeError ? (
              <Text selectable style={{ fontSize: 12, color: '#b91c1c', fontFamily: 'monospace' }}>
                {zhipuProbeError}
              </Text>
            ) : null}

            {zhipuProbeResult ? (
              <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                <Text selectable style={{ fontSize: 11, color: text, fontFamily: 'monospace' }}>
                  {JSON.stringify(zhipuProbeResult, null, 2)}
                </Text>
              </ScrollView>
            ) : null}

            {__DEV__ ? (
              <Pressable
                onPress={() => router.push('/zhipu-api-test')}
                style={({ pressed }) => [{ opacity: pressed ? 0.88 : 1 }]}>
                <View style={[styles.probeBtn, { borderColor: cardBorder }]}>
                  <MaterialIcons name="api" size={20} color={primary} />
                  <Text style={[styles.rowTitle, { color: text, fontSize: 14 }]}>智谱 API 测试</Text>
                  <MaterialIcons name="chevron-right" size={20} color={outline} />
                </View>
              </Pressable>
            ) : null}
          </View>
        </View>
        </ScrollView>
      </GestureDetector>

      <Modal visible={dayBoundaryPickerVisible} transparent animationType="fade" onRequestClose={() => setDayBoundaryPickerVisible(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setDayBoundaryPickerVisible(false)} />
          <View style={[styles.modalCard, { backgroundColor: cardBg }]}>
            <Text style={[styles.sectionTitle, { color: text }]}>应用日界</Text>
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
            <View style={styles.modalActions}>
              <Pressable onPress={() => setDraftBoundary({ ...DEFAULT_TASKS_DAY_BOUNDARY })}>
                <Text style={{ color: outline, fontWeight: '700' }}>恢复默认</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Pressable onPress={() => setDayBoundaryPickerVisible(false)}>
                  <Text style={{ color: outline, fontWeight: '700' }}>取消</Text>
                </Pressable>
                <Pressable onPress={() => void saveDayBoundary()}>
                  <Text style={{ color: primary, fontWeight: '800' }}>保存</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={githubDiagModal.visible} transparent animationType="fade" onRequestClose={() => setGithubDiagModal(m => ({ ...m, visible: false }))}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setGithubDiagModal(m => ({ ...m, visible: false }))} />
          <View style={[styles.modalCard, { backgroundColor: cardBg, maxHeight: '80%' }]}>
            <Text style={[styles.sectionTitle, { color: text }]}>{githubDiagModal.title}</Text>
            <Text style={{ color: outline, marginTop: 6 }}>{githubDiagModal.subtitle}</Text>
            <ScrollView style={{ marginTop: 12, maxHeight: 320 }}>
              <Text selectable style={{ fontSize: 11, fontFamily: 'monospace', color: text }}>
                {githubDiagModal.body}
              </Text>
            </ScrollView>
            <Pressable onPress={() => setGithubDiagModal(m => ({ ...m, visible: false }))} style={{ marginTop: 16, alignSelf: 'flex-end' }}>
              <Text style={{ color: primary, fontWeight: '800' }}>关闭</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingBottom: 32, gap: 8 },
  section: { marginTop: 8, gap: 8 },
  sectionHead: { gap: 2, marginBottom: 4 },
  kicker: { fontSize: 10, fontWeight: '800', letterSpacing: 1.2 },
  sectionTitle: { fontSize: 18, fontWeight: '800' },
  card: { borderRadius: 12, borderWidth: 1, padding: 14 },
  actionCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rowTitle: { fontSize: 15, fontWeight: '800' },
  rowHint: { fontSize: 12, lineHeight: 17 },
  themeModeRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  themeModeChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
  },
  themeModeChipText: { fontSize: 13, fontWeight: '700' },
  dayBoundaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  probeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
  },
  modalRoot: { flex: 1, justifyContent: 'center', padding: 24 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: { borderRadius: 16, padding: 20, marginHorizontal: 8, zIndex: 1 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 12,
  },
});
