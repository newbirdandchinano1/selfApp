import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { fetchFrogCandidates, type FrogCandidate } from '@/lib/frog-candidates-api';
import type { ScheduleSubjectKind } from '@/lib/schedule/types';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type SchedulePlaceResult = {
  kind: ScheduleSubjectKind;
  id: string;
  title: string;
  spanSlots: number;
  assignYmd: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  assignYmd: string;
  maxSpan: number;
  lockedProjectIds?: Set<string>;
  onConfirm: (result: SchedulePlaceResult) => Promise<void> | void;
};

export function SchedulePlaceFrogSheet({
  visible,
  onClose,
  assignYmd,
  maxSpan,
  lockedProjectIds,
  onConfirm,
}: Props) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const primary = theme.primary;
  const outline = theme.textSecondary;
  const surface = isDark ? '#1e293b' : '#fff';
  const surfaceLow = isDark ? 'rgba(148,163,184,0.12)' : 'rgba(241,245,249,0.95)';

  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [candidates, setCandidates] = React.useState<FrogCandidate[]>([]);
  const [picked, setPicked] = React.useState<FrogCandidate | null>(null);
  const [span, setSpan] = React.useState(1);

  React.useEffect(() => {
    if (!visible) return;
    setPicked(null);
    setSpan(1);
    let cancelled = false;
    setLoading(true);
    void fetchFrogCandidates({ assignYmd })
      .then((res) => {
        if (cancelled) return;
        const locked = lockedProjectIds ?? new Set<string>();
        setCandidates(
          res.items.filter((it) => {
            if (it.blockedReason) return false;
            if (it.kind === 'task' && it.projectId && locked.has(it.projectId)) return false;
            if (it.kind === 'project' && locked.has(it.id)) return false;
            return true;
          }),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, assignYmd, lockedProjectIds]);

  const canConfirm = !!picked && span >= 1 && span <= maxSpan && !saving;

  const submit = React.useCallback(async () => {
    if (!picked || !canConfirm) return;
    setSaving(true);
    try {
      await onConfirm({
        kind: picked.kind,
        id: picked.id,
        title: picked.title,
        spanSlots: span,
        assignYmd,
      });
      onClose();
    } catch (err) {
      Alert.alert('入格失败', err instanceof Error ? err.message : '请稍后重试');
    } finally {
      setSaving(false);
    }
  }, [picked, canConfirm, onConfirm, span, assignYmd, onClose]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: surface,
              paddingBottom: Math.max(insets.bottom, 16),
              borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(203,213,225,0.9)',
            },
          ]}>
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: outline }]} />
          </View>
          <View style={styles.header}>
            <Text style={[styles.title, { color: theme.text }]}>
              {picked ? '选择占用格数' : '添加青蛙入格'}
            </Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <MaterialIcons name="close" size={22} color={outline} />
            </Pressable>
          </View>

          <View style={[styles.dateChip, { backgroundColor: surfaceLow }]}>
            <MaterialIcons name="event" size={18} color={primary} />
            <Text style={{ color: theme.text, fontWeight: '600' }}>{assignYmd}</Text>
          </View>

          {!picked ? (
            <View style={{ flexGrow: 1, minHeight: 160 }}>
              {loading ? (
                <ActivityIndicator color={primary} style={{ marginVertical: 28 }} />
              ) : candidates.length === 0 ? (
                <Text style={{ color: outline, paddingVertical: 20, lineHeight: 20 }}>
                  当日暂无可指派项（截止/锁定/子任务未完成等规则仍生效）。
                </Text>
              ) : (
                <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
                  {candidates.map((c) => (
                    <Pressable
                      key={`${c.kind}-${c.id}`}
                      onPress={() => setPicked(c)}
                      style={({ pressed }) => [
                        styles.candidateRow,
                        { backgroundColor: surfaceLow, opacity: pressed ? 0.85 : 1 },
                      ]}>
                      <Text style={{ color: theme.text, fontWeight: '600', flex: 1 }} numberOfLines={2}>
                        {c.title}
                      </Text>
                      <MaterialIcons name="chevron-right" size={20} color={outline} />
                    </Pressable>
                  ))}
                </ScrollView>
              )}
            </View>
          ) : (
            <View style={{ gap: 12 }}>
              <Text style={{ color: theme.text, fontWeight: '700' }}>{picked.title}</Text>
              <Text style={{ color: outline, fontSize: 13 }}>
                连续占用 N 格（最多 {maxSpan}）
              </Text>
              <View style={styles.spanRow}>
                {Array.from({ length: maxSpan }, (_, i) => i + 1).map((n) => {
                  const active = span === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => setSpan(n)}
                      style={[
                        styles.spanChip,
                        {
                          borderColor: active ? primary : `${outline}55`,
                          backgroundColor: active ? `${primary}18` : 'transparent',
                        },
                      ]}>
                      <Text style={{ color: active ? primary : theme.text, fontWeight: '700' }}>
                        {n}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.footerRow}>
                <Pressable onPress={() => setPicked(null)} style={styles.ghostBtn}>
                  <Text style={{ color: outline, fontWeight: '600' }}>重选青蛙</Text>
                </Pressable>
                <Pressable
                  onPress={() => void submit()}
                  disabled={!canConfirm}
                  style={[
                    styles.primaryBtn,
                    { backgroundColor: primary, opacity: canConfirm ? 1 : 0.45 },
                  ]}>
                  {saving ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={{ color: '#fff', fontWeight: '700' }}>确认入格</Text>
                  )}
                </Pressable>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  handleRow: { alignItems: 'center', paddingVertical: 4 },
  handle: { width: 40, height: 4, borderRadius: 2, opacity: 0.35 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 17, fontWeight: '700' },
  dateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  candidateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    marginBottom: 8,
  },
  spanRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  spanChip: {
    minWidth: 44,
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    gap: 12,
  },
  ghostBtn: { paddingVertical: 12, paddingHorizontal: 8 },
  primaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
