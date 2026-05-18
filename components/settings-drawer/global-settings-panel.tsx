import { Colors } from '@/constants/theme';
import { useThemePreference } from '@/contexts/theme-preference-context';
import type { AiLlmProviderId } from '@/lib/ai-llm-provider-preference';
import {
  getPreferredAiLlmProviderSync,
  loadAiLlmProviderPreference,
  setPreferredAiLlmProvider,
} from '@/lib/ai-llm-provider-preference';
import {
  probeGeminiTextAndVisionConnectivity,
  type GeminiConnectivityProbeRow,
} from '@/lib/gemini-generative';
import { getLastFullGithubBackupAtIso } from '@/lib/github-full-backup-local-meta';
import { triggerGithubCloudRestoreFromFullBackup } from '@/lib/github-cloud-restore';
import { triggerGithubCloudSync } from '@/lib/github-cloud-sync';
import {
  DEFAULT_TASKS_DAY_BOUNDARY,
  formatTasksDayBoundaryLabel,
  loadTasksDayBoundary,
  saveTasksDayBoundary,
  type TasksDayBoundary,
} from '@/lib/tasks-logical-day';
import type { ThemePreference } from '@/lib/theme-preference';
import { getGeminiApiKey, getGeminiApiKeyFromEnv, getZhipuApiKeyFromEnv } from '@/lib/zhipu-image-parse';
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

function formatZhFullBackupTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
}

type Props = {
  initialSection: SettingsSection | null;
  onSectionScrolled?: () => void;
  /** 与列表滚动并行识别，用于面板内左滑收起 */
  panCloseGesture?: PanGesture;
};

export function GlobalSettingsPanel({ initialSection, onSectionScrolled, panCloseGesture }: Props) {
  const router = useRouter();
  const { preference, colorScheme, setPreference } = useThemePreference();
  const isDark = colorScheme === 'dark';
  const theme = Colors[colorScheme];
  const text = theme.text;
  const outline = isDark ? 'rgba(148,163,184,0.8)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.2)' : 'rgba(194,198,214,0.35)';
  const primary = isDark ? '#60a5fa' : '#0058be';
  const cardBg = isDark ? 'rgba(30,41,59,0.55)' : '#ffffff';
  const cardBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,88,190,0.12)';

  const scrollRef = useRef<ScrollView>(null);
  const sectionOffsets = useRef<Partial<Record<SettingsSection, number>>>({});
  const pendingScroll = useRef(initialSection);

  const [dayBoundary, setDayBoundary] = useState<TasksDayBoundary>(() => ({ ...DEFAULT_TASKS_DAY_BOUNDARY }));
  const [draftBoundary, setDraftBoundary] = useState<TasksDayBoundary>(() => ({ ...DEFAULT_TASKS_DAY_BOUNDARY }));
  const [dayBoundaryPickerVisible, setDayBoundaryPickerVisible] = useState(false);

  const [aiLlmProvider, setAiLlmProvider] = useState<AiLlmProviderId>(() => getPreferredAiLlmProviderSync());
  const [geminiProbeLoading, setGeminiProbeLoading] = useState(false);
  const [geminiProbeRows, setGeminiProbeRows] = useState<GeminiConnectivityProbeRow[] | null>(null);
  const [geminiProbeError, setGeminiProbeError] = useState<string | null>(null);

  const [cloudBackupBusy, setCloudBackupBusy] = useState(false);
  const [cloudRestoreBusy, setCloudRestoreBusy] = useState(false);
  const githubCloudOpAbortRef = useRef<AbortController | null>(null);
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
    void loadTasksDayBoundary().then(b => {
      setDayBoundary(b);
      setDraftBoundary(b);
    });
    void loadLastFullGithubBackupMeta();
    void loadAiLlmProviderPreference().then(() => setAiLlmProvider(getPreferredAiLlmProviderSync()));
  }, [loadLastFullGithubBackupMeta]);

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
    const ac = startGithubCloudOp();
    setCloudBackupBusy(true);
    try {
      const r = await triggerGithubCloudSync({ signal: ac.signal });
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
        Alert.alert('云备份', `各表与本地 KV 已写入仓库。${multi}${timeLine}${sub}`);
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
    }
  }, [endGithubCloudOp, loadLastFullGithubBackupMeta, startGithubCloudOp]);

  const runCloudRestore = useCallback(async () => {
    const ac = startGithubCloudOp();
    setCloudRestoreBusy(true);
    try {
      const r = await triggerGithubCloudRestoreFromFullBackup({ signal: ac.signal });
      if (r.ok) {
        setLastFullGithubBackupAtIso(r.cloudLastUpdated);
        void loadAiLlmProviderPreference().then(() => setAiLlmProvider(getPreferredAiLlmProviderSync()));
        const kvLine = r.kvKeys.length > 0 ? `\n已恢复 KV：${r.kvKeys.join('、')}` : '';
        const warnBlock =
          r.warnings.length > 0 ? `\n\n注意：\n${r.warnings.map(w => `· ${w}`).join('\n')}` : '';
        Alert.alert(
          '从云同步完成',
          `已用云端快照覆盖本地。\nSQLite：${r.sqliteTables} 张表，共 ${r.sqliteRows} 行。${kvLine}\n\n云端时间：${formatZhFullBackupTime(r.cloudLastUpdated)}${warnBlock}`,
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
    }
  }, [endGithubCloudOp]);

  const requestCloudRestore = useCallback(() => {
    Alert.alert(
      '从云同步',
      '将按 GitHub 上 manifest.json 所列文件，用云端全量备份覆盖本机数据。未备份的本地改动将丢失。确定继续？',
      [
        { text: '取消', style: 'cancel' },
        { text: '确定覆盖并同步', style: 'destructive', onPress: () => void runCloudRestore() },
      ],
    );
  }, [runCloudRestore]);

  const runGeminiConnectivityProbe = useCallback(async () => {
    setGeminiProbeLoading(true);
    setGeminiProbeError(null);
    setGeminiProbeRows(null);
    try {
      const rows = await probeGeminiTextAndVisionConnectivity(getGeminiApiKey());
      setGeminiProbeRows(rows);
    } catch (e) {
      setGeminiProbeError(e instanceof Error ? e.message : String(e));
    } finally {
      setGeminiProbeLoading(false);
    }
  }, []);

  const saveDayBoundary = useCallback(async () => {
    try {
      await saveTasksDayBoundary(draftBoundary);
      setDayBoundary(draftBoundary);
      setDayBoundaryPickerVisible(false);
    } catch {
      Alert.alert('保存失败', '未能保存日界设置，请稍后重试。');
    }
  }, [draftBoundary]);

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
          {renderSectionHead('DAY BOUNDARY', '每日完成日界')}
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder, gap: 10 }]}>
            <Text style={[styles.rowHint, { color: outline, lineHeight: 19 }]}>
              习惯打卡、今日青蛙与热力图等统计以此时间为新一天的起点（默认 00:00）。
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
          <Pressable
            onPress={() => void runCloudBackup()}
            disabled={cloudBackupBusy || cloudRestoreBusy}
            style={({ pressed }) => [{ opacity: pressed || cloudBackupBusy || cloudRestoreBusy ? 0.88 : 1 }]}>
            <View style={[styles.card, styles.actionCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
              {cloudBackupBusy ? (
                <ActivityIndicator size="small" color={primary} />
              ) : (
                <MaterialIcons name="cloud-upload" size={26} color={primary} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, { color: text }]}>一键全量备份到 GitHub</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4 }]}>
                  SQLite 各表与备忘、技能等 KV 写入仓库备份目录，并更新 manifest。
                </Text>
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
            disabled={cloudBackupBusy || cloudRestoreBusy}
            style={({ pressed }) => [{ opacity: pressed || cloudBackupBusy || cloudRestoreBusy ? 0.88 : 1 }]}>
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
                  读取 manifest.json，用云端快照覆盖本机 SQLite 与 KV 数据。
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={22} color={outline} />
            </View>
          </Pressable>
        </View>

        <View onLayout={ev => onSectionLayout('ai', ev.nativeEvent.layout.y)} style={styles.section}>
          {renderSectionHead('AI', '文本与识图引擎')}
          <View style={[styles.card, { backgroundColor: isDark ? 'rgba(30,41,59,0.35)' : 'rgba(0,88,190,0.04)', borderColor: cardBorder, gap: 10 }]}>
            <Text style={[styles.rowHint, { color: outline, lineHeight: 19 }]}>
              记账、备忘、心愿、饮食识图等共用同一引擎。智谱可用 EXPO_PUBLIC_ZHIPU_API_KEY；豆包可用
              EXPO_PUBLIC_ARK_API_KEY。
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                onPress={() => void setPreferredAiLlmProvider('zhipu').then(() => setAiLlmProvider('zhipu'))}
                style={({ pressed }) => [
                  styles.aiProviderBtn,
                  {
                    borderColor: aiLlmProvider === 'zhipu' ? primary : outlineVariant,
                    backgroundColor:
                      aiLlmProvider === 'zhipu'
                        ? isDark
                          ? 'rgba(96,165,250,0.15)'
                          : 'rgba(0,88,190,0.08)'
                        : 'transparent',
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={[styles.rowTitle, { color: text, fontSize: 14 }]}>智谱 GLM</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4, textAlign: 'center', fontSize: 11 }]}>
                  {getZhipuApiKeyFromEnv() ? '已设置环境变量' : '未设置时走内置'}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => void setPreferredAiLlmProvider('gemini').then(() => setAiLlmProvider('gemini'))}
                style={({ pressed }) => [
                  styles.aiProviderBtn,
                  {
                    borderColor: aiLlmProvider === 'gemini' ? primary : outlineVariant,
                    backgroundColor:
                      aiLlmProvider === 'gemini'
                        ? isDark
                          ? 'rgba(96,165,250,0.15)'
                          : 'rgba(0,88,190,0.08)'
                        : 'transparent',
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}>
                <Text style={[styles.rowTitle, { color: text, fontSize: 14 }]}>豆包</Text>
                <Text style={[styles.rowHint, { color: outline, marginTop: 4, textAlign: 'center', fontSize: 11 }]}>
                  {getGeminiApiKeyFromEnv() ? '已设置 ARK 变量' : '内置密钥可覆盖'}
                </Text>
              </Pressable>
            </View>

            <Pressable
              onPress={() => void runGeminiConnectivityProbe()}
              disabled={geminiProbeLoading}
              style={({ pressed }) => [
                styles.probeBtn,
                { borderColor: cardBorder, opacity: pressed || geminiProbeLoading ? 0.75 : 1 },
              ]}>
              {geminiProbeLoading ? (
                <ActivityIndicator size="small" color={primary} />
              ) : (
                <MaterialIcons name="cloud-done" size={20} color={primary} />
              )}
              <Text style={[styles.rowTitle, { color: text, fontSize: 14 }]}>
                {geminiProbeLoading ? '正在测试豆包…' : '测试豆包连通性'}
              </Text>
            </Pressable>

            {geminiProbeError ? (
              <Text selectable style={{ fontSize: 12, color: '#b91c1c', fontFamily: 'monospace' }}>
                {geminiProbeError}
              </Text>
            ) : null}

            {geminiProbeRows && geminiProbeRows.length > 0 ? (
              <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                <Text selectable style={{ fontSize: 11, color: text, fontFamily: 'monospace' }}>
                  {JSON.stringify(geminiProbeRows, null, 2)}
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
            <Text style={[styles.sectionTitle, { color: text }]}>每日完成日界</Text>
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
  aiProviderBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 2,
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
