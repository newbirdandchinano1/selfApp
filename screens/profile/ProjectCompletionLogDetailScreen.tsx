import { AppIcon } from '@/components/ui/app-icon';
import {
  FoldRiseIn,
  FOLD_MOTION_SPRING,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { foldFonts, useFoldTheme } from '@/constants/review-fold-theme';
import {
  buildSourceFlow,
  formatDetailDateLine,
  formatDetailSubtitleYmd,
} from '@/lib/project-completion-archive-ui';
import { toast } from '@/lib/app-feedback';
import { formatPoints } from '@/lib/reward-points';
import {
  formatCompletionArchiveCode,
  getProjectCompletionLogById,
  parseCompletionLogTagNames,
  type ProjectCompletionLogRow,
} from '@/lib/repositories/projects/project-completion-logs';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

function ArchStamp({ animate }: { animate: boolean }) {
  const pop = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) {
      pop.setValue(1);
      return;
    }
    pop.setValue(0);
    Animated.timing(pop, {
      toValue: 1,
      duration: 550,
      delay: 180,
      easing: FOLD_MOTION_SPRING,
      useNativeDriver: true,
    }).start();
  }, [animate, pop]);

  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 22000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [animate, spin]);

  const scale = pop.interpolate({
    inputRange: [0, 0.65, 1],
    outputRange: [0.72, 1.06, 1],
  });
  const rotate = pop.interpolate({
    inputRange: [0, 0.65, 1],
    outputRange: ['-8deg', '2deg', '0deg'],
  });
  const ringRotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.stampWrap}>
      {animate ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.stampRing, { borderColor: 'rgba(53,98,79,0.22)', transform: [{ rotate: ringRotate }] }]}
        />
      ) : (
        <View
          pointerEvents="none"
          style={[styles.stampRing, { borderColor: 'rgba(53,98,79,0.22)' }]}
        />
      )}
      <Animated.View
        style={[
          styles.stamp,
          {
            backgroundColor: '#D5E6DA',
            opacity: pop,
            transform: [{ scale }, { rotate }],
          },
        ]}>
        <AppIcon name="check" size={24} color="#35624F" />
      </Animated.View>
    </View>
  );
}

export default function ProjectCompletionLogDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { fold } = useFoldTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [row, setRow] = useState<ProjectCompletionLogRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    if (!id?.trim()) {
      setMissing(true);
      setLoading(false);
      return;
    }
    try {
      const found = await getProjectCompletionLogById(id);
      if (!found) {
        setMissing(true);
        setRow(null);
      } else {
        setRow(found);
        setMissing(false);
      }
    } catch (e) {
      console.warn('加载归档详情失败', e);
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const tags = useMemo(() => (row ? parseCompletionLogTagNames(row.tag_names) : []), [row]);
  const flow = useMemo(() => (row ? buildSourceFlow(row) : null), [row]);
  const archiveCode = row ? formatCompletionArchiveCode(row) : '';

  const copyCode = async () => {
    if (!archiveCode) return;
    try {
      await Clipboard.setStringAsync(archiveCode);
      toast.success(`已复制归档编号 ${archiveCode}`);
    } catch {
      toast.error('复制失败');
    }
  };

  const points =
    row == null
      ? ''
      : row.points_delta > 0
        ? `+${formatPoints(row.points_delta)}`
        : row.points_delta < 0
          ? formatPoints(row.points_delta)
          : '±0';

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: fold.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.appBar, { paddingTop: insets.top + 4, borderBottomColor: fold.line }]}>
        <Pressable
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="返回"
          hitSlop={10}
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="arrow-back" size={20} color={fold.ink} />
        </Pressable>
        <View style={styles.appBarTitleWrap}>
          <Text style={[styles.appTitle, { color: fold.ink }]}>归档详情</Text>
          <Text style={[styles.appSub, { color: fold.muted }]} numberOfLines={1}>
            只读快照
            {row ? ` · ${formatDetailSubtitleYmd(row.completed_ymd)}` : ''}
          </Text>
        </View>
        <Pressable
          onPress={() => void copyCode()}
          disabled={!archiveCode}
          accessibilityRole="button"
          accessibilityLabel="复制归档编号"
          style={({ pressed }) => [
            styles.iconBtn,
            { borderColor: fold.line, backgroundColor: fold.card, opacity: archiveCode ? 1 : 0.4 },
            pressed && { opacity: 0.88 },
          ]}>
          <AppIcon name="content-copy" size={18} color={fold.ink} />
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={fold.pine} />
        </View>
      ) : missing || !row || !flow ? (
        <View style={styles.empty}>
          <Text style={{ color: fold.ink2, fontWeight: '700', fontSize: 15 }}>找不到这条履历</Text>
          <Pressable
            onPress={() => router.back()}
            style={[styles.ghostBtn, { borderColor: fold.line2, marginTop: 14 }]}>
            <Text style={{ color: fold.ink2, fontWeight: '700' }}>返回</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: Math.max(insets.bottom, 16) + 28 },
          ]}
          showsVerticalScrollIndicator={false}>
          <FoldRiseIn animate={motionOn} index={0} staggerMs={45} fromY={10}>
            <View
              style={[
                styles.hero,
                { backgroundColor: fold.card, borderColor: 'rgba(216,205,187,0.75)' },
              ]}>
              <View style={styles.heroGlow} pointerEvents="none" />
              <ArchStamp animate={motionOn} />
              <Text
                style={[
                  styles.heroTitle,
                  { color: fold.pine, fontFamily: foldFonts.serif },
                ]}>
                {row.source === 'manual_delete' ? `删除「${row.name}」` : row.name}
              </Text>
              <Text style={styles.adate}>
                {formatDetailDateLine(row.completed_ymd, row.completed_at)}
              </Text>
              <Text style={[styles.apoints, { fontFamily: foldFonts.mono }]}>
                {points}
                <Text style={styles.apointsUnit}> 积分</Text>
              </Text>
              <View style={styles.archMeta}>
                <View style={styles.metaItem}>
                  <AppIcon name="check" size={12} color={fold.muted} />
                  <Text style={styles.metaText}>
                    {row.task_count > 0
                      ? `${row.done_task_count} / ${row.task_count} 任务`
                      : '无任务明细'}
                  </Text>
                </View>
                <View style={styles.metaItem}>
                  <AppIcon name="lock" size={12} color={fold.muted} />
                  <Text style={styles.metaText}>只读</Text>
                </View>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={1} staggerMs={55} fromY={12}>
            <View
              style={[
                styles.card,
                { backgroundColor: fold.card, borderColor: 'rgba(216,205,187,0.75)' },
              ]}>
              <View style={styles.rowline}>
                <Text style={styles.cardTitle}>来源链路</Text>
                <View
                  style={[
                    styles.tag,
                    {
                      backgroundColor:
                        flow.badgeTone === 'amber'
                          ? fold.amber2
                          : flow.badgeTone === 'clay'
                            ? fold.clay2
                            : fold.sage2,
                    },
                  ]}>
                  <Text
                    style={[
                      styles.tagText,
                      {
                        color:
                          flow.badgeTone === 'amber'
                            ? '#8B5A1E'
                            : flow.badgeTone === 'clay'
                              ? '#8F422B'
                              : '#36594D',
                      },
                    ]}>
                    {flow.badge}
                  </Text>
                </View>
              </View>

              {flow.nodes.map((node, i) => (
                <React.Fragment key={`${node.title}-${i}`}>
                  {i > 0 ? <View style={styles.flowLine} /> : null}
                  <FoldRiseIn animate={motionOn} index={i} staggerMs={70} delayMs={220} fromY={8}>
                    <View style={styles.flowNode}>
                      <View style={[styles.fi, { backgroundColor: '#EFEBDF' }]}>
                        <AppIcon name={node.icon} size={14} color={fold.pine2} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.ft} numberOfLines={2}>
                          {node.title}
                        </Text>
                        <Text style={styles.fs} numberOfLines={2}>
                          {node.subtitle}
                        </Text>
                      </View>
                      {node.tag ? (
                        <View
                          style={[
                            styles.tag,
                            {
                              backgroundColor:
                                node.tagTone === 'green'
                                  ? fold.sage2
                                  : node.tagTone === 'clay'
                                    ? fold.clay2
                                    : node.tagTone === 'amber'
                                      ? fold.amber2
                                      : '#EAE6DC',
                            },
                          ]}>
                          <Text
                            style={[
                              styles.tagText,
                              {
                                color:
                                  node.tagTone === 'green'
                                    ? '#36594D'
                                    : node.tagTone === 'clay'
                                      ? '#8F422B'
                                      : node.tagTone === 'amber'
                                        ? '#8B5A1E'
                                        : '#777B75',
                              },
                            ]}>
                            {node.tag}
                          </Text>
                        </View>
                      ) : node.trailing ? (
                        <Text style={styles.trailing}>{node.trailing}</Text>
                      ) : null}
                    </View>
                  </FoldRiseIn>
                </React.Fragment>
              ))}

              <View style={styles.flowEnd}>
                <Text style={styles.flowEndText}>{flow.endNote}</Text>
              </View>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={2} staggerMs={55} fromY={12}>
            <View
              style={[
                styles.card,
                { backgroundColor: fold.card, borderColor: 'rgba(216,205,187,0.75)' },
              ]}>
              <View style={styles.rowline}>
                <Text style={styles.cardTitle}>标签</Text>
                <Text style={styles.cardHint}>自动继承 · 不可改</Text>
              </View>
              <View style={styles.tpills}>
                {tags.length === 0 ? (
                  <Text style={styles.cardHint}>无标签</Text>
                ) : (
                  tags.map((t) => (
                    <View key={t} style={styles.tpillOn}>
                      <Text style={styles.tpillOnText}>✓ {t}</Text>
                    </View>
                  ))
                )}
              </View>

              <View style={[styles.rowline, { marginTop: 12, marginBottom: 4 }]}>
                <Text style={styles.cardTitle}>备注</Text>
                <View style={[styles.tag, { backgroundColor: '#EAE6DC' }]}>
                  <Text style={[styles.tagText, { color: '#777B75' }]}>只读</Text>
                </View>
              </View>
              {row.note?.trim() ? (
                <View style={styles.noteQuoteWrap}>
                  <Text style={styles.noteQuoteMark}>“</Text>
                  <Text style={[styles.noteQuote, { fontFamily: foldFonts.serif }]}>
                    {row.note.trim()}
                  </Text>
                </View>
              ) : (
                <Text style={styles.cardHint}>无备注</Text>
              )}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={motionOn} index={3} staggerMs={55} fromY={12}>
            <View
              style={[
                styles.card,
                { backgroundColor: fold.card, borderColor: 'rgba(216,205,187,0.75)' },
              ]}>
              <View style={styles.rowline}>
                <Text style={styles.cardTitle}>积分快照</Text>
                <Text style={styles.cardHint}>归档时写入</Text>
              </View>
              <View style={styles.pointRow}>
                <Text style={styles.pointLabel}>
                  {row.done_task_count > 0
                    ? `完成任务 × ${row.done_task_count}`
                    : '本次归档'}
                </Text>
                <Text
                  style={[
                    styles.pointVal,
                    {
                      color: row.points_delta < 0 ? '#B85B41' : '#3E7A5E',
                      fontFamily: foldFonts.mono,
                    },
                  ]}>
                  {points}
                </Text>
              </View>
              <View style={[styles.hairline, { backgroundColor: fold.line }]} />
              <View style={styles.rowline}>
                <Text style={[styles.netLabel, { color: '#4F5C53' }]}>本次净得</Text>
                <Text style={[styles.netVal, { color: '#3E7A5E', fontFamily: foldFonts.mono }]}>
                  {points === '±0' ? '±0 分' : `${points} 分`}
                </Text>
              </View>
              <View style={styles.readOnly}>
                <AppIcon name="lock" size={12} color="#9AA097" />
                <Text style={styles.readOnlyText}>
                  履历不可编辑；如需重做，请从原项目新建一次。
                </Text>
              </View>
            </View>
          </FoldRiseIn>

          <Pressable
            onPress={() => router.back()}
            style={({ pressed }) => [
              styles.ghostBtn,
              { borderColor: fold.line2, opacity: pressed ? 0.88 : 1 },
            ]}>
            <AppIcon name="arrow-back" size={16} color={fold.ink2} />
            <Text style={[styles.ghostBtnText, { color: fold.ink2 }]}>回到完成履历</Text>
          </Pressable>

          <View style={styles.formFoot}>
            <View style={[styles.dot, { backgroundColor: fold.sage }]} />
            <Text style={styles.formFootText}>归档编号 {archiveCode} · 仅本机可见</Text>
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0 },
  appTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  appSub: { marginTop: 2, fontSize: 11, fontWeight: '600' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  scroll: { paddingHorizontal: 15, paddingTop: 10, gap: 8 },
  hero: {
    borderRadius: 19,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 14,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  heroGlow: {
    position: 'absolute',
    top: -40,
    left: '15%',
    right: '15%',
    height: 120,
    borderRadius: 80,
    backgroundColor: 'rgba(226,240,230,0.9)',
  },
  stampWrap: {
    width: 60,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  stampRing: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  stamp: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    letterSpacing: 0.2,
    marginBottom: 4,
  },
  adate: { fontSize: 11, color: '#9AA097', letterSpacing: 0.3 },
  apoints: {
    marginTop: 8,
    fontSize: 22,
    fontWeight: '700',
    color: '#3E7A5E',
  },
  apointsUnit: { fontSize: 11, color: '#9AA097', fontWeight: '400' },
  archMeta: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 11, color: '#7A857D', fontWeight: '600' },
  card: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  rowline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#4F5C53' },
  cardHint: { fontSize: 11, color: '#A0A69D' },
  tag: {
    height: 18,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 10, fontWeight: '700' },
  flowNode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  fi: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ft: { fontSize: 12, fontWeight: '700', color: '#3F4C44', lineHeight: 17 },
  fs: { fontSize: 10, color: '#9A9F97', marginTop: 2 },
  trailing: { fontSize: 10, color: '#A0A69D' },
  flowLine: {
    width: 1,
    height: 10,
    backgroundColor: '#DDD4C4',
    marginLeft: 12,
  },
  flowEnd: {
    marginTop: 6,
    backgroundColor: '#FBEEDC',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  flowEndText: { fontSize: 11, color: '#8A6222', lineHeight: 16 },
  tpills: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: 8 },
  tpillOn: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: '#E7EFE9',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#BFD4C6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tpillOnText: { fontSize: 12, fontWeight: '700', color: '#3C5C4D' },
  noteQuoteWrap: { position: 'relative', paddingTop: 6, paddingLeft: 2 },
  noteQuoteMark: {
    position: 'absolute',
    left: 0,
    top: -2,
    fontSize: 28,
    color: '#CFC3AE',
    fontFamily: foldFonts.serif,
  },
  noteQuote: {
    fontSize: 14,
    lineHeight: 22,
    color: '#506057',
    paddingLeft: 10,
  },
  pointRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 5,
    marginTop: 4,
  },
  pointLabel: { fontSize: 12, color: '#7A857D' },
  pointVal: { fontSize: 13, fontWeight: '700' },
  hairline: { height: StyleSheet.hairlineWidth, marginVertical: 6 },
  netLabel: { fontSize: 12, fontWeight: '800' },
  netVal: { fontSize: 16, fontWeight: '700' },
  readOnly: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E4DAC9',
    borderStyle: 'dashed',
  },
  readOnlyText: { flex: 1, fontSize: 11, color: '#9AA097', lineHeight: 15 },
  ghostBtn: {
    height: 42,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,252,245,0.55)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 4,
  },
  ghostBtnText: { fontSize: 13, fontWeight: '700' },
  formFoot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
  },
  dot: { width: 5, height: 5, borderRadius: 3 },
  formFootText: { fontSize: 11, color: '#9BA099' },
});
