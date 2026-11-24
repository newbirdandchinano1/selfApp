/**
 * 收集箱归档 UI — 对齐 prototype/收集箱APP局部演示.html
 */
import { taskFoldFonts, type TaskFoldPalette } from '@/constants/task-fold-theme';
import { addDaysToYmd, parseYmd, ymdPrefix } from '@/lib/date';
import { INBOX_PROJECT_FULL_RETENTION_DAYS } from '@/lib/repositories/projects/constants';
import type { ProjectCompletionLogRow } from '@/lib/repositories/projects/project-completion-logs';
import {
  formatProjectStatusLabel,
  normalizeProjectStatus,
  type ProjectRow,
} from '@/lib/repositories/projects/project.types';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type InboxInnerFilter = 'all' | 'done' | 'no' | 'log';

const INNER_TABS: Array<{ key: InboxInnerFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'done', label: '已完成' },
  { key: 'no', label: '已放弃' },
  { key: 'log', label: '已压缩' },
];

const MONTH_SHORT = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

export function isInboxAbandonedProject(project: ProjectRow): boolean {
  return normalizeProjectStatus(project.status) === 'cancelled';
}

export function inboxEnteredYmd(project: ProjectRow): string | null {
  return (
    ymdPrefix(project.inbox_entered_at) ||
    ymdPrefix(project.updated_at) ||
    ymdPrefix(project.created_at)
  );
}

/** 距自动压缩还剩几天；未知入箱日按满保留期估算 */
export function getInboxRetentionDaysLeft(
  project: ProjectRow,
  todayYmd: string,
  retentionDays = INBOX_PROJECT_FULL_RETENTION_DAYS,
): number {
  const entered = inboxEnteredYmd(project);
  if (!entered) return retentionDays;
  const expire = addDaysToYmd(entered, retentionDays);
  const a = parseYmd(todayYmd);
  const b = parseYmd(expire);
  if (!a || !b) return retentionDays;
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 86_400_000));
}

export function formatRelativeDaysAgo(ymdOrDatetime: string | null | undefined, todayYmd: string): string {
  const ymd = ymdPrefix(ymdOrDatetime);
  if (!ymd) return '不久前';
  const a = parseYmd(ymd);
  const b = parseYmd(todayYmd);
  if (!a || !b) return ymd;
  const days = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  if (days <= 0) return '今天';
  if (days === 1) return '1 天前';
  return `${days} 天前`;
}

export function formatLogDateParts(completedYmd: string): { day: string; mon: string } {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(completedYmd.trim());
  if (!m) return { day: '—', mon: '' };
  const monthIdx = Number(m[2]) - 1;
  return {
    day: String(Number(m[3])),
    mon: MONTH_SHORT[monthIdx] ?? m[2],
  };
}

export function projectMatchesInboxInnerFilter(
  project: ProjectRow,
  filter: InboxInnerFilter,
): boolean {
  if (filter === 'all') return true;
  if (filter === 'log') return false;
  if (filter === 'no') return isInboxAbandonedProject(project);
  return !isInboxAbandonedProject(project);
}

type ArchiveColors = {
  headBg: string;
  headBorder: string;
  eyebrow: string;
  ink: string;
  muted: string;
  faint: string;
  accent: string;
  accentSoft: string;
  card: string;
  cardBorder: string;
  track: string;
  noticeBg: string;
  noticeInk: string;
  abandonedSoft: string;
  abandonedInk: string;
  abandonedBar: string;
  tabTrack: string;
  diamond: string;
  searchBg: string;
  searchBorder: string;
  logBg: string;
  logBorder: string;
  sheetBg: string;
  sheetHandle: string;
  dim: string;
};

function resolveArchiveColors(tf: TaskFoldPalette, isDark: boolean): ArchiveColors {
  return {
    headBg: isDark ? tf.paper3 : '#E6EEE6',
    headBorder: isDark ? tf.line : '#D8E4D8',
    eyebrow: isDark ? tf.amber : '#AD6D3C',
    ink: tf.ink,
    muted: isDark ? tf.ink2 : '#718077',
    faint: tf.faint,
    accent: isDark ? tf.frog : '#557461',
    accentSoft: isDark ? tf.sage2 : '#E5EEE6',
    card: isDark ? tf.cream : '#FFFEFA',
    cardBorder: isDark ? tf.line : '#DCE5DC',
    track: isDark ? tf.track : '#E9EEE9',
    noticeBg: isDark ? tf.amber2 : '#FAECDD',
    noticeInk: isDark ? tf.amberInk : '#98613D',
    abandonedSoft: isDark ? tf.clay2 : '#EEE8E3',
    abandonedInk: isDark ? tf.clay : '#947167',
    abandonedBar: isDark ? tf.clay : '#B18A78',
    tabTrack: isDark ? tf.paper2 : '#E9EFEA',
    diamond: isDark ? 'rgba(127,166,149,0.28)' : '#CADCCA',
    searchBg: isDark ? tf.cream : '#FFFEFA',
    searchBorder: isDark ? tf.line : '#DBE4DB',
    logBg: isDark ? tf.paper3 : '#EEF2EE',
    logBorder: isDark ? tf.line : '#E0E7DF',
    sheetBg: isDark ? tf.paper2 : '#FFFEFA',
    sheetHandle: isDark ? tf.line2 : '#D7DFD7',
    dim: tf.dim,
  };
}

export function InboxArchiveHeader({
  tf,
  isDark,
  fullCount,
  doneCount,
  abandonedCount,
  nearestRetentionDays,
  innerFilter,
  onInnerFilterChange,
  search,
  onSearchChange,
  style,
}: {
  tf: TaskFoldPalette;
  isDark: boolean;
  fullCount: number;
  doneCount: number;
  abandonedCount: number;
  nearestRetentionDays: number | null;
  innerFilter: InboxInnerFilter;
  onInnerFilterChange: (next: InboxInnerFilter) => void;
  search: string;
  onSearchChange: (next: string) => void;
  style?: StyleProp<ViewStyle>;
}) {
  const c = resolveArchiveColors(tf, isDark);
  return (
    <View style={[styles.headerWrap, style]}>
      <View style={[styles.archiveHead, { backgroundColor: c.headBg, borderColor: c.headBorder }]}>
        <Text style={[styles.diamond, { color: c.diamond }]} accessibilityElementsHidden>
          ◇
        </Text>
        <Text style={[styles.eyebrow, { color: c.eyebrow, fontFamily: taskFoldFonts.sans }]}>
          PROJECT ARCHIVE
        </Text>
        <Text style={[styles.headTitle, { color: c.ink, fontFamily: taskFoldFonts.serifBold }]}>
          收集箱
        </Text>
        <Text style={[styles.headDesc, { color: c.muted, fontFamily: taskFoldFonts.sans }]}>
          已经完成，或暂时放下的项目，会先在这里停留。
        </Text>
        <View style={styles.statsRow}>
          <View style={[styles.stat, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <Text style={[styles.statNum, { color: c.accent, fontFamily: taskFoldFonts.serifBold }]}>
              {fullCount}
            </Text>
            <Text style={[styles.statLabel, { color: c.faint }]}>完整项目</Text>
          </View>
          <View style={[styles.stat, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <Text style={[styles.statNum, { color: c.accent, fontFamily: taskFoldFonts.serifBold }]}>
              {doneCount}
            </Text>
            <Text style={[styles.statLabel, { color: c.faint }]}>已完成</Text>
          </View>
          <View style={[styles.stat, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
            <Text style={[styles.statNum, { color: c.accent, fontFamily: taskFoldFonts.serifBold }]}>
              {abandonedCount}
            </Text>
            <Text style={[styles.statLabel, { color: c.faint }]}>已放弃</Text>
          </View>
        </View>
        {nearestRetentionDays != null ? (
          <View style={[styles.notice, { backgroundColor: c.noticeBg }]}>
            <Text style={[styles.noticeText, { color: c.noticeInk, fontFamily: taskFoldFonts.sans }]}>
              ⌛ 最近项目将在 {nearestRetentionDays} 天后压缩为履历
            </Text>
          </View>
        ) : (
          <View style={[styles.notice, { backgroundColor: c.noticeBg }]}>
            <Text style={[styles.noticeText, { color: c.noticeInk, fontFamily: taskFoldFonts.sans }]}>
              ⌛ 完整细节保留 {INBOX_PROJECT_FULL_RETENTION_DAYS} 天，之后自动压缩为履历
            </Text>
          </View>
        )}
      </View>

      <View style={[styles.innerTabs, { backgroundColor: c.tabTrack }]}>
        {INNER_TABS.map((tab) => {
          const on = innerFilter === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => onInnerFilterChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={tab.label}
              style={({ pressed }) => [
                styles.innerTab,
                on
                  ? {
                      backgroundColor: c.card,
                      shadowColor: '#405646',
                      shadowOpacity: isDark ? 0 : 0.07,
                      shadowRadius: 7,
                      shadowOffset: { width: 0, height: 2 },
                      elevation: on && !isDark ? 1 : 0,
                    }
                  : null,
                { opacity: pressed ? 0.85 : 1 },
              ]}>
              <Text
                style={[
                  styles.innerTabText,
                  {
                    color: on ? c.accent : c.faint,
                    fontWeight: on ? '700' : '500',
                    fontFamily: taskFoldFonts.sans,
                  },
                ]}>
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={search}
        onChangeText={onSearchChange}
        placeholder="搜索收集箱里的项目…"
        placeholderTextColor={c.faint}
        style={[
          styles.search,
          {
            backgroundColor: c.searchBg,
            borderColor: c.searchBorder,
            color: c.ink,
            fontFamily: taskFoldFonts.sans,
          },
        ]}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />
    </View>
  );
}

export function InboxArchiveSectionHeader({
  title,
  meta,
  tf,
  isDark,
}: {
  title: string;
  meta: string;
  tf: TaskFoldPalette;
  isDark: boolean;
}) {
  const c = resolveArchiveColors(tf, isDark);
  return (
    <View style={styles.sectionRow}>
      <Text style={[styles.sectionTitle, { color: c.ink, fontFamily: taskFoldFonts.serifBold }]}>
        {title}
      </Text>
      <Text style={[styles.sectionMeta, { color: c.faint, fontFamily: taskFoldFonts.sans }]}>
        {meta}
      </Text>
    </View>
  );
}

export function InboxArchiveProjectCard({
  project,
  progress,
  todayYmd,
  tf,
  isDark,
  onPress,
  onActionPress,
}: {
  project: ProjectRow;
  progress: { total: number; done: number; ratio: number };
  todayYmd: string;
  tf: TaskFoldPalette;
  isDark: boolean;
  onPress: () => void;
  onActionPress: () => void;
}) {
  const c = resolveArchiveColors(tf, isDark);
  const abandoned = isInboxAbandonedProject(project);
  const daysLeft = getInboxRetentionDaysLeft(project, todayYmd);
  const entered = inboxEnteredYmd(project);
  const ago = formatRelativeDaysAgo(entered, todayYmd);
  const ratioPct = Math.round(Math.max(0, Math.min(1, progress.ratio)) * 100);
  const statusLabel = abandoned ? '已放弃' : '已完成';
  const footLeft = abandoned
    ? daysLeft <= 0
      ? '即将自动压缩'
      : `还有 ${daysLeft} 天自动压缩`
    : daysLeft <= 0
      ? '即将压缩为履历'
      : `完整细节还保留 ${daysLeft} 天`;
  const actionLabel = abandoned ? '恢复项目' : '查看详情 →';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${project.name}，${statusLabel}`}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: c.cardBorder,
          opacity: pressed ? 0.92 : 1,
        },
      ]}>
      <View style={styles.cardHead}>
        <View
          style={[
            styles.state,
            {
              backgroundColor: abandoned ? c.abandonedSoft : c.accentSoft,
            },
          ]}>
          <Text
            style={{
              color: abandoned ? c.abandonedInk : c.accent,
              fontWeight: '800',
              fontSize: 13,
            }}>
            {abandoned ? '⊘' : '✓'}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={[styles.cardTitle, { color: c.ink, fontFamily: taskFoldFonts.serifBold }]}
            numberOfLines={2}>
            {project.name}
          </Text>
          <View
            style={[
              styles.badge,
              { backgroundColor: abandoned ? c.abandonedSoft : c.accentSoft, alignSelf: 'flex-start' },
            ]}>
            <Text
              style={{
                fontSize: 9,
                color: abandoned ? c.abandonedInk : c.accent,
                fontFamily: taskFoldFonts.sans,
                fontWeight: '700',
              }}>
              {statusLabel}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={onPress}
          hitSlop={10}
          accessibilityLabel="更多"
          style={({ pressed }) => [{ opacity: pressed ? 0.6 : 1, paddingHorizontal: 4 }]}>
          <Text style={{ color: c.accent, fontSize: 17, fontWeight: '700' }}>···</Text>
        </Pressable>
      </View>

      <Text style={[styles.meta, { color: c.faint, fontFamily: taskFoldFonts.sans }]} numberOfLines={2}>
        {abandoned ? '放弃于' : '完成于'} {ago}
        {progress.total > 0 ? `　·　任务 ${progress.done}/${progress.total}` : ''}
      </Text>

      {progress.total > 0 ? (
        <View style={[styles.bar, { backgroundColor: c.track }]}>
          <View
            style={[
              styles.barFill,
              {
                width: `${ratioPct}%`,
                backgroundColor: abandoned ? c.abandonedBar : '#81A488',
              },
            ]}
          />
        </View>
      ) : null}

      <View style={[styles.cardFoot, { borderTopColor: isDark ? tf.line : '#EDF1ED' }]}>
        <Text
          style={{
            fontSize: 9,
            color: abandoned ? (isDark ? tf.amber : '#B27543') : c.faint,
            fontFamily: taskFoldFonts.sans,
            flex: 1,
          }}
          numberOfLines={1}>
          {footLeft}
        </Text>
        <Pressable onPress={onActionPress} hitSlop={8} accessibilityRole="button" accessibilityLabel={actionLabel}>
          <Text style={{ fontSize: 9, color: c.accent, fontWeight: '700', fontFamily: taskFoldFonts.sans }}>
            {actionLabel}
          </Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

export function InboxArchiveLogRow({
  log,
  tf,
  isDark,
  onPress,
}: {
  log: ProjectCompletionLogRow;
  tf: TaskFoldPalette;
  isDark: boolean;
  onPress: () => void;
}) {
  const c = resolveArchiveColors(tf, isDark);
  const { day, mon } = formatLogDateParts(log.completed_ymd);
  const statusBit =
    log.source === 'compress' || log.done_task_count >= log.task_count ? '已完成' : '已归档';
  const taskBit = log.task_count > 0 ? `${log.task_count} 个任务` : '无任务明细';

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${log.name}，已压缩履历`}
      style={({ pressed }) => [
        styles.logRow,
        {
          backgroundColor: c.logBg,
          borderColor: c.logBorder,
          opacity: pressed ? 0.9 : 1,
        },
      ]}>
      <View style={styles.logDate}>
        <Text style={[styles.logDay, { color: c.muted, fontFamily: taskFoldFonts.serifBold }]}>
          {day}
        </Text>
        <Text style={{ fontSize: 8, color: c.faint, fontFamily: taskFoldFonts.sans }}>{mon}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={[styles.logTitle, { color: c.ink, fontFamily: taskFoldFonts.serif }]}
          numberOfLines={1}>
          {log.name}
        </Text>
        <Text style={{ fontSize: 9, color: c.faint, marginTop: 3, fontFamily: taskFoldFonts.sans }} numberOfLines={1}>
          {statusBit} · {taskBit}
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={18} color={c.accent} />
    </Pressable>
  );
}

export function InboxArchiveDetailSheet({
  visible,
  project,
  progress,
  todayYmd,
  tf,
  isDark,
  onClose,
  onRestore,
  onOpenFull,
  onDeleteDetails,
}: {
  visible: boolean;
  project: ProjectRow | null;
  progress: { total: number; done: number; ratio: number };
  todayYmd: string;
  tf: TaskFoldPalette;
  isDark: boolean;
  onClose: () => void;
  onRestore: () => void;
  onOpenFull: () => void;
  onDeleteDetails: () => void;
}) {
  const insets = useSafeAreaInsets();
  const c = resolveArchiveColors(tf, isDark);
  if (!project) return null;
  const abandoned = isInboxAbandonedProject(project);
  const daysLeft = getInboxRetentionDaysLeft(project, todayYmd);
  const entered = inboxEnteredYmd(project);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.sheetScrim, { backgroundColor: c.dim }]} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          {
            backgroundColor: c.sheetBg,
            paddingBottom: Math.max(insets.bottom, 16) + 12,
          },
        ]}>
        <View style={[styles.sheetHandle, { backgroundColor: c.sheetHandle }]} />
        <Pressable
          onPress={onClose}
          hitSlop={12}
          style={styles.sheetClose}
          accessibilityRole="button"
          accessibilityLabel="关闭">
          <Text style={{ fontSize: 22, color: c.faint }}>×</Text>
        </Pressable>
        <Text style={[styles.sheetTitle, { color: c.ink, fontFamily: taskFoldFonts.serifBold }]}>
          {project.name}
        </Text>
        <Text style={[styles.sheetDesc, { color: c.muted, fontFamily: taskFoldFonts.sans }]}>
          完整任务、备注和原始分类仍然保留。你可以将它恢复到原来的工作流。
        </Text>
        <View style={[styles.detailBlock, { borderTopColor: isDark ? tf.line : '#E2E8E1' }]}>
          <DetailRow label="当前状态" value={formatProjectStatusLabel(project.status)} colors={c} />
          <DetailRow label="归档时间" value={formatRelativeDaysAgo(entered, todayYmd)} colors={c} />
          <DetailRow
            label="任务完成"
            value={progress.total > 0 ? `${progress.done} / ${progress.total}` : '无任务'}
            colors={c}
          />
          <DetailRow
            label="自动压缩"
            value={daysLeft <= 0 ? '即将压缩' : `${daysLeft} 天后`}
            colors={c}
          />
        </View>
        <Pressable
          onPress={onRestore}
          style={({ pressed }) => [
            styles.restoreBtn,
            { backgroundColor: c.accent, opacity: pressed ? 0.88 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel="移出收集箱，恢复项目">
          <Text style={{ color: '#fff', fontWeight: '700', fontFamily: taskFoldFonts.sans }}>
            移出收集箱，恢复项目
          </Text>
        </Pressable>
        <View style={styles.sheetSecondaryRow}>
          <Pressable onPress={onOpenFull} hitSlop={8} accessibilityRole="button">
            <Text style={{ color: c.accent, fontWeight: '700', fontSize: 12, fontFamily: taskFoldFonts.sans }}>
              打开完整详情
            </Text>
          </Pressable>
          <Pressable onPress={onDeleteDetails} hitSlop={8} accessibilityRole="button">
            <Text
              style={{
                color: abandoned ? c.abandonedInk : c.faint,
                fontWeight: '600',
                fontSize: 12,
                fontFamily: taskFoldFonts.sans,
              }}>
              删除完整记录
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function DetailRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ArchiveColors;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={{ fontSize: 10, color: colors.faint, fontFamily: taskFoldFonts.sans }}>{label}</Text>
      <Text style={{ fontSize: 10, color: colors.accent, fontWeight: '700', fontFamily: taskFoldFonts.sans }}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    gap: 0,
    marginBottom: 4,
  },
  archiveHead: {
    marginTop: 8,
    borderRadius: 18,
    padding: 19,
    borderWidth: 1,
    overflow: 'hidden',
    position: 'relative',
  },
  diamond: {
    position: 'absolute',
    right: 17,
    top: 9,
    fontSize: 70,
    transform: [{ rotate: '15deg' }],
  },
  eyebrow: {
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '700',
  },
  headTitle: {
    fontSize: 27,
    marginTop: 5,
    marginBottom: 6,
  },
  headDesc: {
    width: '85%',
    fontSize: 11,
    lineHeight: 18,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  stat: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    minWidth: 73,
  },
  statNum: {
    fontSize: 19,
  },
  statLabel: {
    fontSize: 9,
    marginTop: 2,
  },
  notice: {
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  noticeText: {
    fontSize: 10,
  },
  innerTabs: {
    flexDirection: 'row',
    gap: 5,
    marginTop: 19,
    marginBottom: 12,
    padding: 4,
    borderRadius: 11,
  },
  innerTab: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
  },
  innerTabText: {
    fontSize: 10,
  },
  search: {
    width: '100%',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 13,
    fontSize: 11,
  },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    marginBottom: 9,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 15,
  },
  sectionMeta: {
    fontSize: 9,
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    marginBottom: 9,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  state: {
    width: 27,
    height: 27,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: {
    fontSize: 14,
    marginBottom: 5,
  },
  badge: {
    paddingVertical: 4,
    paddingHorizontal: 7,
    borderRadius: 12,
  },
  meta: {
    marginTop: 12,
    marginLeft: 37,
    fontSize: 9,
  },
  bar: {
    height: 4,
    marginTop: 11,
    marginLeft: 37,
    borderRadius: 5,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 5,
  },
  cardFoot: {
    borderTopWidth: 1,
    marginTop: 12,
    marginLeft: 37,
    paddingTop: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  logRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  logDate: {
    alignItems: 'center',
    minWidth: 30,
  },
  logDay: {
    fontSize: 17,
  },
  logTitle: {
    fontSize: 12,
    fontWeight: '600',
  },
  sheetScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 4,
    alignSelf: 'center',
  },
  sheetClose: {
    position: 'absolute',
    right: 18,
    top: 19,
  },
  sheetTitle: {
    fontSize: 22,
    marginTop: 22,
    marginBottom: 7,
    paddingRight: 28,
  },
  sheetDesc: {
    fontSize: 11,
    lineHeight: 18,
  },
  detailBlock: {
    borderTopWidth: 1,
    marginTop: 15,
    paddingTop: 6,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  restoreBtn: {
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 10,
  },
  sheetSecondaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingHorizontal: 2,
  },
});
