import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { deleteVision, getVisionRowById, parseVisionExtra, updateVision } from '@/lib/repositories/visions/vision';
import { visionRowToDetailRecord } from '@/lib/repositories/visions/vision-present';
import type { VisionRow } from '@/lib/repositories/visions/vision.types';
import { VisionSubGoalsDetailPanel } from '@/components/vision-sub-goals/VisionSubGoalsDetailPanel';
import { collectVisionSubGoalsFromExtra } from '@/lib/repositories/visions/vision.types';
import {
  getVisionById as getRegistryVisionById,
  type VisionKind,
  type VisionRecord,
  type VisionWallFields,
} from '@/lib/visions-registry';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { draftFromRow, validateAndBuildVisionUpdate, type VisionEditDraft } from './vision-detail-edit-helpers';
import { VisionDetailEditor } from './vision-detail-editor';

const visionPrimary = '#0058be';

function KindBadge({ kind, isDark }: { kind: VisionKind; isDark: boolean }) {
  const label: Record<VisionKind, string> = {
    progress: '进度',
    count: '计数',
    target: '目标',
    countdown: '倒数日',
  };
  return (
    <View
      style={[
        styles.kindBadge,
        {
          backgroundColor: isDark ? 'rgba(30,41,59,0.65)' : 'rgba(234,237,255,0.95)',
          borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(194,198,214,0.45)',
        },
      ]}
    >
      <MaterialIcons name="flag" size={14} color={visionPrimary} />
      <Text style={[styles.kindBadgeText, { color: isDark ? '#e2e8f0' : '#131b2e' }]}>{label[kind]}</Text>
    </View>
  );
}

function DetailStats({ record, isDark, textColor, outline }: {
  record: VisionRecord;
  isDark: boolean;
  textColor: string;
  outline: string;
}) {
  const w: VisionWallFields | undefined = record.wall;
  const profilePct = record.profile?.progressPercent;

  if (record.kind === 'progress') {
    const wp = w?.kind === 'progress' ? w : undefined;
    if (wp) {
      return (
        <View style={styles.countRow}>
          <View style={{ gap: 4 }}>
            <Text style={[styles.countKicker, { color: outline }]}>{wp.leftKicker}</Text>
            <Text style={[styles.countValue, { color: textColor }]}>{wp.leftValue}</Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 4 }}>
            <Text style={[styles.countKicker, { color: outline }]}>{wp.rightKicker}</Text>
            <Text style={[styles.countValue, { color: textColor }]}>{wp.rightValue}</Text>
          </View>
        </View>
      );
    }
    const pct = profilePct != null ? profilePct / 100 : 0;
    const pctLabel = profilePct != null ? `${profilePct}%` : '—';
    return (
      <View style={{ gap: 10 }}>
        <View style={styles.statRowBetween}>
          <Text style={[styles.statMeta, { color: outline }]}>本周进度</Text>
          <Text style={[styles.statEmphasis, { color: textColor }]}>{pctLabel}</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)' }]}>
          <View style={[styles.progressFill, { width: `${Math.round(pct * 100)}%` }]} />
        </View>
      </View>
    );
  }

  if (record.kind === 'count' && w?.kind === 'count') {
    const wc = w;
    return (
      <View style={styles.countRow}>
        <View style={{ gap: 4 }}>
          <Text style={[styles.countKicker, { color: outline }]}>{wc.leftKicker}</Text>
          <Text style={[styles.countValue, { color: textColor }]}>{wc.leftValue}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <Text style={[styles.countKicker, { color: outline }]}>{wc.rightKicker}</Text>
          <Text style={[styles.countValue, { color: textColor }]}>{wc.rightValue}</Text>
        </View>
      </View>
    );
  }

  if (record.kind === 'target' && w?.kind === 'target') {
    const wt = w;
    return (
      <View style={{ gap: 10 }}>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[styles.statEmphasis, { color: textColor }]}>{wt.percentText}</Text>
        </View>
        <View style={[styles.progressTrack, { backgroundColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.35)' }]}>
          <View style={[styles.progressFill, { width: `${Math.round(wt.percent * 100)}%` }]} />
        </View>
      </View>
    );
  }

  if (record.kind === 'countdown' && w?.kind === 'countdown') {
    const wd = w;
    const isCountup = wd.countdownKind === 'countup';
    return (
      <View style={styles.countRow}>
        <View style={{ gap: 4 }}>
          <Text style={[styles.countKicker, { color: outline }]}>
            {isCountup ? '记录日期' : '截止日期'}
          </Text>
          <Text style={[styles.countValue, { color: textColor }]}>{wd.dateText}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {isCountup ? null : <Text style={[styles.countKicker, { color: outline }]}>剩余时间</Text>}
          <Text style={[styles.remainValue, { color: textColor }]}>{wd.remainText}</Text>
        </View>
      </View>
    );
  }

  return null;
}

export default function VisionDetailScreen() {
  const router = useRouter();
  const rawId = useLocalSearchParams<{ id?: string | string[] }>().id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as 'light' | 'dark';
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const textColor = theme.text;
  const outline = isDark ? 'rgba(148,163,184,0.85)' : 'rgba(114,119,133,0.95)';
  const panelBg = isDark ? 'rgba(30,41,59,0.45)' : 'rgba(255,255,255,0.95)';
  const panelBorder = 'rgba(194,198,214,0.35)';

  const [record, setRecord] = useState<VisionRecord | null | undefined>(undefined);
  const [dbRow, setDbRow] = useState<VisionRow | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editDraft, setEditDraft] = useState<VisionEditDraft | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const exitEditMode = useCallback(() => {
    setIsEditing(false);
    setEditTitle('');
    setEditDescription('');
    setEditDraft(null);
  }, []);

  useEffect(() => {
    exitEditMode();
  }, [id, exitEditMode]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      if (!id) {
        setRecord(null);
        setDbRow(null);
        return () => {
          alive = false;
        };
      }
      const reg = getRegistryVisionById(id);
      if (reg) {
        setRecord(reg);
        setDbRow(null);
        return () => {
          alive = false;
        };
      }
      setRecord(undefined);
      setDbRow(null);
      void (async () => {
        try {
          const row = await getVisionRowById(id);
          if (!alive) return;
          if (row) {
            setDbRow(row);
            setRecord(await visionRowToDetailRecord(row));
          } else {
            setRecord(null);
            setDbRow(null);
          }
        } catch {
          if (alive) {
            setRecord(null);
            setDbRow(null);
          }
        }
      })();
      return () => {
        alive = false;
      };
    }, [id]),
  );

  const beginEdit = () => {
    if (!dbRow || !record) return;
    setEditTitle(record.title);
    setEditDescription((dbRow.description ?? '').trim());
    setEditDraft(draftFromRow(dbRow));
    setIsEditing(true);
  };

  const onSaveEdit = async () => {
    if (!id || !dbRow || !editDraft) return;
    const title = editTitle.trim();
    if (!title) {
      Alert.alert('提示', '请填写愿景名称');
      return;
    }
    const built = validateAndBuildVisionUpdate(dbRow, editDraft, title, editDescription.trim() || null);
    if (!built.ok) {
      Alert.alert('提示', built.message);
      return;
    }
    setSaveBusy(true);
    try {
      await updateVision(id, built.input);
      const next = await getVisionRowById(id);
      if (next) {
        setDbRow(next);
        setRecord(await visionRowToDetailRecord(next));
      }
      exitEditMode();
    } catch {
      Alert.alert('保存失败', '无法更新本地数据，请稍后重试。');
    } finally {
      setSaveBusy(false);
    }
  };

  const performDeleteVision = async () => {
    if (!id) return;
    setDeleteBusy(true);
    try {
      await deleteVision(id);
      exitEditMode();
      router.back();
    } catch {
      Alert.alert('删除失败', '无法删除本地数据，请稍后重试。');
    } finally {
      setDeleteBusy(false);
    }
  };

  const requestDeleteVision = () => {
    if (!id || saveBusy || deleteBusy) return;
    Alert.alert('删除愿景', '确定删除这条愿景吗？删除后将从愿景墙与我的页移除；在同步或恢复功能前可能无法找回。', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => void performDeleteVision(),
      },
    ]);
  };

  const canEditDb = Boolean(dbRow && record);

  if (record === undefined) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.85)' }]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialIcons
              name="arrow-back"
              size={22}
              color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'}
            />
          </Pressable>
          <Text style={[styles.headerTitle, { color: textColor }]}>愿景详情</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={visionPrimary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!record) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
        <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.85)' }]}>
          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
          >
            <MaterialIcons
              name="arrow-back"
              size={22}
              color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'}
            />
          </Pressable>
          <Text style={[styles.headerTitle, { color: textColor }]}>愿景详情</Text>
          <View style={{ width: 36 }} />
        </View>
        <View style={styles.emptyWrap}>
          <MaterialIcons name="travel-explore" size={40} color={outline} />
          <Text style={[styles.emptyTitle, { color: textColor }]}>找不到这条愿景</Text>
          <Text style={[styles.emptyDesc, { color: outline }]}>请从愿景墙或我的页重新进入。</Text>
          <Pressable
            onPress={() => router.replace('/vision-wall')}
            style={({ pressed }) => [styles.primaryBtn, pressed && { opacity: 0.92 }]}
          >
            <Text style={styles.primaryBtnText}>前往愿景墙</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const placeholderColor = isDark ? 'rgba(148,163,184,0.55)' : 'rgba(114,119,133,0.55)';
  const targetSubGoals =
    record.kind === 'target' && dbRow
      ? collectVisionSubGoalsFromExtra(parseVisionExtra(dbRow.extra_data) ?? {})
      : [];

  return (
    <>
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.82)' : 'rgba(255,255,255,0.85)' }]}>
        {isEditing ? (
          <>
            <Pressable
              onPress={exitEditMode}
              disabled={deleteBusy}
              style={({ pressed }) => [
                styles.headerTextBtn,
                pressed && !deleteBusy && { opacity: 0.75 },
                deleteBusy && { opacity: 0.45 },
              ]}
            >
              <Text style={[styles.headerTextBtnLabel, { color: outline }]}>取消</Text>
            </Pressable>
            <Text style={[styles.headerTitle, { color: textColor }]} numberOfLines={1}>
              编辑愿景
            </Text>
            <Pressable
              onPress={() => void onSaveEdit()}
              disabled={saveBusy || deleteBusy}
              style={({ pressed }) => [
                styles.headerTextBtn,
                pressed && !saveBusy && !deleteBusy && { opacity: 0.85 },
                (saveBusy || deleteBusy) && { opacity: 0.5 },
              ]}
            >
              <Text style={[styles.headerTextBtnLabel, { color: visionPrimary, fontWeight: '900' }]}>
                {saveBusy ? '…' : '保存'}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Pressable
              onPress={() => router.back()}
              style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
            >
              <MaterialIcons
                name="arrow-back"
                size={22}
                color={isDark ? 'rgba(248,250,252,0.92)' : 'rgba(15,23,42,0.92)'}
              />
            </Pressable>
            <Text style={[styles.headerTitle, { color: textColor }]} numberOfLines={1}>
              愿景详情
            </Text>
            {canEditDb ? (
              <Pressable
                onPress={beginEdit}
                style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}
                accessibilityLabel="编辑愿景"
              >
                <MaterialIcons name="edit" size={22} color={visionPrimary} />
              </Pressable>
            ) : (
              <View style={{ width: 36 }} />
            )}
          </>
        )}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={0}
      >
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 28 + Math.max(insets.bottom, 12) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.hero}>
            <Image source={record.imageSource} style={styles.heroImg} contentFit="cover" transition={160} />
            <View style={styles.heroOverlay} />
            <View style={styles.heroBody}>
              <Text style={styles.heroKicker}>{record.detailKicker}</Text>
              {isEditing ? (
                <TextInput
                  value={editTitle}
                  onChangeText={setEditTitle}
                  placeholder="愿景名称"
                  placeholderTextColor="rgba(255,255,255,0.45)"
                  style={styles.heroTitleInput}
                />
              ) : (
                <Text style={styles.heroTitle}>{record.title}</Text>
              )}
              {record.profile?.year ? (
                <Text style={styles.heroYear}>{record.profile.year}</Text>
              ) : null}
              {!isEditing ? (
                <View style={{ marginTop: 8 }}>
                  <DetailStats record={record} isDark={isDark} textColor="#fff" outline="rgba(255,255,255,0.72)" />
                </View>
              ) : null}
            </View>
          </View>

          {!isEditing ? (
            <>
              <View style={{ marginTop: 18, gap: 10 }}>
                <Text style={[styles.sectionKicker, { color: outline }]}>Overview</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <Text style={[styles.sectionTitle, { color: textColor }]}>愿景概览</Text>
                  <KindBadge kind={record.kind} isDark={isDark} />
                </View>
              </View>

              <View
                style={[
                  styles.panel,
                  {
                    backgroundColor: panelBg,
                    borderColor: panelBorder,
                  },
                ]}
              >
                <View style={styles.panelHeaderRow}>
                  <MaterialIcons name="article" size={18} color={visionPrimary} />
                  <Text style={[styles.panelTitle, { color: textColor }]}>描述</Text>
                </View>
                <Text style={[styles.panelBody, { color: textColor }]}>{record.description}</Text>
              </View>

              {targetSubGoals.length > 0 ? (
                <VisionSubGoalsDetailPanel
                  subGoals={targetSubGoals}
                  textColor={textColor}
                  outline={outline}
                  isDark={isDark}
                  panelBg={panelBg}
                  panelBorder={panelBorder}
                />
              ) : null}

              {record.milestones?.length ? (
                <View
                  style={[
                    styles.panel,
                    {
                      backgroundColor: panelBg,
                      borderColor: panelBorder,
                    },
                  ]}
                >
                  <View style={styles.panelHeaderRow}>
                    <MaterialIcons name="timeline" size={18} color={visionPrimary} />
                    <Text style={[styles.panelTitle, { color: textColor }]}>里程碑</Text>
                  </View>
                  <View style={{ gap: 12 }}>
                    {record.milestones.map((m, idx) => (
                      <View key={`${m.label}-${idx}`} style={styles.milestoneRow}>
                        <MaterialIcons
                          name={m.done ? 'check-circle' : 'radio-button-unchecked'}
                          size={22}
                          color={m.done ? (isDark ? '#34d399' : '#006c49') : outline}
                        />
                        <Text
                          style={[
                            styles.milestoneText,
                            {
                              color: textColor,
                              opacity: m.done ? 0.85 : 1,
                              textDecorationLine: m.done ? 'line-through' : 'none',
                            },
                          ]}
                        >
                          {m.label}
                        </Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : null}
            </>
          ) : (
            <View style={{ marginTop: 18, gap: 10 }}>
              <Text style={[styles.sectionKicker, { color: outline }]}>Edit</Text>
              {dbRow && editDraft ? (
                <VisionDetailEditor
                  row={dbRow}
                  draft={editDraft}
                  setDraft={setEditDraft}
                  isDark={isDark}
                  textColor={textColor}
                  outline={outline}
                  panelBg={panelBg}
                  panelBorder={panelBorder}
                  placeholderColor={placeholderColor}
                  insetsBottom={Math.max(insets.bottom, 12)}
                />
              ) : null}

              <Text style={[styles.sectionTitle, { color: textColor, marginTop: 4 }]}>详细描述</Text>
              <TextInput
                value={editDescription}
                onChangeText={setEditDescription}
                placeholder="添加备注或详细描述…"
                placeholderTextColor={placeholderColor}
                multiline
                textAlignVertical="top"
                style={[
                  styles.editTextarea,
                  {
                    color: textColor,
                    backgroundColor: isDark ? 'rgba(30,41,59,0.55)' : 'rgba(234,237,255,0.95)',
                    borderColor: panelBorder,
                  },
                ]}
              />

              <Pressable
                onPress={requestDeleteVision}
                disabled={deleteBusy || saveBusy}
                style={({ pressed }) => [
                  styles.deleteVisionBtn,
                  {
                    borderColor: isDark ? 'rgba(248,113,113,0.55)' : 'rgba(186,26,26,0.45)',
                    backgroundColor: isDark ? 'rgba(248,113,113,0.12)' : 'rgba(186,26,26,0.08)',
                    opacity: deleteBusy || saveBusy ? 0.55 : pressed ? 0.88 : 1,
                  },
                ]}
              >
                {deleteBusy ? (
                  <ActivityIndicator size="small" color={isDark ? '#f87171' : '#ba1a1a'} />
                ) : (
                  <MaterialIcons name="delete-outline" size={22} color={isDark ? '#f87171' : '#ba1a1a'} />
                )}
                <Text style={[styles.deleteVisionBtnText, { color: isDark ? '#f87171' : '#ba1a1a' }]}>
                  {deleteBusy ? '正在删除…' : '删除愿景'}
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  loadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 48,
  },
  header: {
    height: 56,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(148,163,184,0.15)',
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBtn: {
    minWidth: 48,
    paddingHorizontal: 4,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextBtnLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginHorizontal: 8,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    gap: 16,
  },
  hero: {
    borderRadius: 22,
    overflow: 'hidden',
    aspectRatio: 16 / 11,
    position: 'relative',
    backgroundColor: '#0f172a',
  },
  heroImg: {
    ...StyleSheet.absoluteFillObject,
    width: '100%',
    height: '100%',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(19,27,46,0.62)',
  },
  heroBody: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    gap: 6,
  },
  heroKicker: {
    color: 'rgba(255,255,255,0.78)',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  heroTitle: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 30,
  },
  heroTitleInput: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: -0.5,
    lineHeight: 28,
    paddingVertical: 4,
    paddingHorizontal: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.35)',
  },
  editTextarea: {
    minHeight: 140,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
  },
  editHint: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  deleteVisionBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
  },
  deleteVisionBtnText: {
    fontSize: 16,
    fontWeight: '800',
  },
  heroYear: {
    marginTop: 2,
    color: 'rgba(255,255,255,0.88)',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  sectionKicker: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.35,
  },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  kindBadgeText: {
    fontSize: 12,
    fontWeight: '900',
  },
  panel: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  panelHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  panelTitle: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  panelBody: {
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    opacity: 0.92,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  milestoneText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
  },
  statRowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  statMeta: {
    fontSize: 12,
    fontWeight: '700',
  },
  statEmphasis: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.3,
  },
  progressTrack: {
    height: 6,
    width: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: visionPrimary,
  },
  countRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  countKicker: {
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  countValue: {
    fontSize: 16,
    fontWeight: '900',
  },
  remainValue: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  emptyWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 10,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.3,
    marginTop: 8,
  },
  emptyDesc: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 20,
  },
  primaryBtn: {
    marginTop: 10,
    backgroundColor: visionPrimary,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 16,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '900',
  },
});
