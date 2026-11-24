/**
 * 我的道路：默认「当前月工作台」；完整年季月树在「道路全景」。
 */
import {
  RoadProjectTaskTreeList,
  type RoadProjectTreeItem,
} from '@/components/life-road/RoadProjectTaskTreeList';
import { useWardrobeFonts } from '@/components/wardrobe/use-wardrobe-fonts';
import {
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import { AppIcon } from '@/components/ui/app-icon';
import { Spacing } from '@/constants/design-tokens';
import {
  lifeRoadType,
  useLifeRoadTheme,
  type LifeRoadPalette,
} from '@/constants/life-road-theme';
import { toast, toUserMessage, Alert } from '@/lib/app-feedback';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import {
  acceptanceMetaLabel,
  lifeRoadItemNoun,
  parseAcceptanceCriteria,
  type LifeRoadAcceptanceItem,
  type LifeRoadItemNoun,
  LIFE_ROAD_ACCEPTANCE_PRIORITIES,
  LIFE_ROAD_ACCEPTANCE_PRIORITY_LABELS,
  acceptanceLinkLabel,
  groupAcceptanceByPriority,
} from '@/lib/life-road/life-road-acceptance';
import { parseLifeWeekKey } from '@/lib/life-road/project-road-link';
import { listWeeksInMonth, parseWeekGoals } from '@/lib/life-road/life-road-weeks';
import {
  LIFE_ROAD_NODE_KIND_LABELS,
  LIFE_ROAD_NODE_STATUS_LABELS,
  currentCalendarMonth,
  currentCalendarYear,
  currentQuarter,
  monthLabel,
  monthToQuarter,
  quarterLabel,
  type LifeRoadNodeKind,
  type LifeRoadNodeStatus,
} from '@/lib/life-road/life-road-node-model';
import {
  buildRoadMindMap,
  type RoadMindMapModel,
  type RoadMonthSlot,
  type RoadProjectRef,
  type RoadQuarterSlot,
  type RoadYearBranch,
} from '@/lib/life-road/life-road-tree';
import {
  loadCurrentMonthWeekTasks,
  type RoadWeekTaskItem,
  type RoadWeekTasksEmptyReason,
} from '@/lib/life-road/road-week-tasks';
import { getDatabase } from '@/lib/database';
import { getLifeDirection } from '@/lib/repositories/life-road/life-direction';
import type { LifeDirectionRow } from '@/lib/repositories/life-road/life-direction.types';
import {
  deleteLifeRoadNode,
  getLifeRoadNodes,
} from '@/lib/repositories/life-road/life-road-node';
import type { LifeRoadNodeRow } from '@/lib/repositories/life-road/life-road-node.types';
import { isProjectInInboxCategory } from '@/lib/repositories/projects/constants';
import { getProjectCategories } from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow } from '@/lib/repositories/projects/project.types';
import {
  getProjectTaskTreeMap,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import { fetchProfileLifeRoad } from '@/lib/profile-page-api';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type ScrollHandle = { scrollTo: (opts: { y: number; animated?: boolean }) => void };
type MeasurableHost = {
  measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
};
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';

const PAGE_KEY = 'life-road';

type ViewMode = 'hub' | 'panorama';

type ProjectWithExtra = RoadProjectRef & { extraData?: string | null };

const MONTH_ABBR = [
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

function weekKeyShort(weekKey?: string | null): string {
  if (!weekKey?.trim()) return '本月';
  const t = weekKey.trim();
  const m = /W(\d+)$/i.exec(t) ?? /[-_](\d+)$/.exec(t);
  if (m) return `W${m[1]}`;
  return t.slice(-2);
}

function projectStatusLabel(status: string): string {
  switch (status) {
    case 'active':
    case 'doing':
    case 'todo':
      return '进行中';
    case 'paused':
    case 'shelved':
    case 'blocked':
      return '暂搁';
    case 'done':
    case 'completed':
      return '已完成';
    default:
      return status || '项目';
  }
}

function isTaskDone(status: string): boolean {
  return status === 'done' || status === 'completed';
}

function joinMeta(...parts: (string | null | undefined)[]): string | undefined {
  const s = parts.filter((p) => p && String(p).trim()).join(' · ');
  return s || undefined;
}

function parseKeywords(extra: string | null | undefined): string[] {
  if (!extra?.trim()) return [];
  try {
    const parsed = JSON.parse(extra) as { keywords?: unknown };
    if (!Array.isArray(parsed?.keywords)) return [];
    return parsed.keywords.filter((k): k is string => typeof k === 'string' && k.trim().length > 0);
  } catch {
    return [];
  }
}

function statusTone(
  status: LifeRoadNodeStatus | undefined,
  lr: LifeRoadPalette,
): { label: string; color: string; bg: string; border: string } | null {
  if (!status) return null;
  const label = LIFE_ROAD_NODE_STATUS_LABELS[status];
  switch (status) {
    case 'on_track':
      return {
        label,
        color: lr.toneOnTrack,
        bg: lr.toneOnTrackBg,
        border: lr.toneOnTrackBorder,
      };
    case 'paused':
      return {
        label,
        color: lr.tonePaused,
        bg: lr.tonePausedBg,
        border: lr.tonePausedBorder,
      };
    case 'arrived':
      return {
        label,
        color: lr.toneArrived,
        bg: lr.toneArrivedBg,
        border: lr.toneArrivedBorder,
      };
    case 'dropped':
      return {
        label,
        color: lr.toneDropped,
        bg: lr.toneDroppedBg,
        border: lr.toneDroppedBorder,
      };
    default:
      return { label, color: lr.muted, bg: lr.sage2, border: lr.line };
  }
}

function ChevronIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}>
      <Path
        d="M9 6l6 6-6 6"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ChevronDownIcon({ open, color }: { open: boolean; color: string }) {
  return (
    <Svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
      <Path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function EditorialStatus({
  status,
  onDark,
  lr,
}: {
  status?: LifeRoadNodeStatus;
  onDark?: boolean;
  lr: LifeRoadPalette;
}) {
  const tone = statusTone(status, lr);
  if (!tone) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
      <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: tone.color }} />
      <Text
        style={{
          fontSize: 10,
          fontWeight: '500',
          letterSpacing: 0.4,
          color: onDark ? '#A9C7B9' : lr.sage,
        }}>
        {tone.label}
      </Text>
    </View>
  );
}

/** RN-SVG 百分比宽高常失效；按布局实测像素再画，父级需有实底兜底。 */
function HeroGradientFill({ from, to }: { from: string; to: string }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }}>
      {size.w > 0 && size.h > 0 ? (
        <Svg width={size.w} height={size.h} preserveAspectRatio="none">
          <Defs>
            <LinearGradient id="lrHeroGrad" x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={from} />
              <Stop offset="1" stopColor={to} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={size.w} height={size.h} fill="url(#lrHeroGrad)" />
        </Svg>
      ) : null}
    </View>
  );
}

function HorizonBeacon({ pathD = 'M-10 175 Q 130 125, 230 140 T 410 38' }: { pathD?: string }) {
  const anim = useRef(new Animated.Value(0)).current;
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(anim, {
          toValue: 1,
          duration: 2100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(anim, {
          toValue: 0,
          duration: 2100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [anim]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] });
  // 对齐原型 viewBox 400×200 中 beacon (348, 48)
  const beaconLeft = size.w > 0 ? Math.max(0, size.w * (348 / 400) - 8) : 0;
  const beaconTop = size.h > 0 ? Math.max(0, size.h * (48 / 200) - 8) : 0;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }}>
      {size.w > 0 && size.h > 0 ? (
        <Svg
          width={size.w}
          height={size.h}
          viewBox="0 0 400 200"
          preserveAspectRatio="none"
          style={{ opacity: 0.35 }}>
          <Path d={pathD} fill="none" stroke="#A9C7B9" strokeWidth={1.2} />
        </Svg>
      ) : null}
      <Animated.View
        style={{
          position: 'absolute',
          left: beaconLeft,
          top: beaconTop,
          width: 16,
          height: 16,
          alignItems: 'center',
          justifyContent: 'center',
          opacity,
          transform: [{ scale }],
        }}>
        <View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: '#E0B072',
          }}
        />
      </Animated.View>
    </View>
  );
}

function ProjectTileGlyph({ index, color }: { index: number; color: string }) {
  const i = index % 4;
  if (i === 0) {
    return (
      <Svg width={16} height={16} viewBox="0 0 20 20" fill="none">
        <Circle cx={10} cy={10} r={7} stroke={color} strokeWidth={1.25} />
        <Circle cx={10} cy={10} r={2} fill="#E0B35A" />
      </Svg>
    );
  }
  if (i === 1) {
    return (
      <Svg width={16} height={16} viewBox="0 0 20 20" fill="none">
        <Path d="M10 3L17 10L10 17L3 10L10 3Z" stroke={color} strokeWidth={1.25} />
        <Circle cx={10} cy={10} r={1.5} fill={color} />
      </Svg>
    );
  }
  if (i === 2) {
    return (
      <Svg width={16} height={16} viewBox="0 0 20 20" fill="none">
        <Path
          d="M3 13C6 7 14 7 17 13"
          stroke={color}
          strokeWidth={1.25}
          strokeLinecap="round"
        />
        <Circle cx={10} cy={7} r={2} fill="#E0B35A" />
      </Svg>
    );
  }
  return (
    <Svg width={16} height={16} viewBox="0 0 20 20" fill="none">
      <Path
        d="M4 6H16M4 10H12M4 14H9"
        stroke={color}
        strokeWidth={1.25}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function AcceptanceInlineRows({
  items,
  lr,
  depth,
}: {
  items: LifeRoadAcceptanceItem[];
  lr: LifeRoadPalette;
  depth: number;
}) {
  return (
    <>
      {items.map((item) => {
        const link = depth === 1 ? acceptanceLinkLabel(item) : null;
        return (
          <View key={item.id}>
            <View
              style={[
                styles.accItem,
                depth > 1 ? { paddingLeft: 8 + (depth - 1) * 12 } : null,
              ]}>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  flex: 1,
                  minWidth: 0,
                }}>
                <Text
                  style={[
                    styles.accTxt,
                    {
                      color: item.done ? lr.muted : lr.ink3,
                      textDecorationLine: item.done ? 'line-through' : 'none',
                    },
                  ]}
                  numberOfLines={2}>
                  {item.text}
                </Text>
              </View>
              {link ? (
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '700',
                    color: lr.pine3,
                    flexShrink: 0,
                  }}>
                  {link}
                </Text>
              ) : null}
            </View>
            {(item.children ?? []).length > 0 ? (
              <AcceptanceInlineRows
                items={item.children ?? []}
                lr={lr}
                depth={depth + 1}
              />
            ) : null}
          </View>
        );
      })}
    </>
  );
}

function AcceptanceInline({
  items,
  lr,
  noun = '目标',
}: {
  items: LifeRoadAcceptanceItem[];
  lr: LifeRoadPalette;
  noun?: LifeRoadItemNoun;
}) {
  if (items.length === 0) return null;
  const groups = groupAcceptanceByPriority(items);
  return (
    <View style={styles.accInner}>
      {LIFE_ROAD_ACCEPTANCE_PRIORITIES.map((p) => {
        const layer = groups[p];
        if (layer.length === 0) return null;
        return (
          <View key={p} style={{ marginBottom: 4 }}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: '700',
                letterSpacing: 0.7,
                color: lr.muted2,
                paddingHorizontal: 10,
                paddingTop: 4,
                paddingBottom: 2,
              }}>
              {LIFE_ROAD_ACCEPTANCE_PRIORITY_LABELS[p]} · {noun}
            </Text>
            <AcceptanceInlineRows items={layer} lr={lr} depth={1} />
          </View>
        );
      })}
    </View>
  );
}

function MonthWeekProjectsInline({
  year,
  month,
  projects,
  weekGoalsExtra,
  lr,
  onOpenProject,
}: {
  year: number;
  month: number;
  projects: RoadProjectRef[];
  weekGoalsExtra: string | null | undefined;
  lr: LifeRoadPalette;
  onOpenProject: (projectId: string) => void;
}) {
  if (projects.length === 0) return null;
  const weeks = listWeeksInMonth(year, month);
  const goals = parseWeekGoals(weekGoalsExtra);
  const byWeek = new Map<string, RoadProjectRef[]>();
  const unassigned: RoadProjectRef[] = [];
  for (const p of projects) {
    const key = p.weekKey?.trim() || '';
    if (!key) {
      unassigned.push(p);
      continue;
    }
    const list = byWeek.get(key) ?? [];
    list.push(p);
    byWeek.set(key, list);
  }
  return (
    <View style={{ paddingHorizontal: 8, paddingBottom: 6, gap: 6 }}>
      {weeks.map((w) => {
        const list = byWeek.get(w.weekKey) ?? [];
        const goalText = goals[w.weekKey]?.text?.trim();
        if (list.length === 0 && !goalText) return null;
        return (
          <View key={w.weekKey}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: '700',
                color: lr.muted2,
                paddingHorizontal: 4,
                marginBottom: 2,
              }}>
              {w.label}
              {goalText ? ` · ${goalText}` : ''}
            </Text>
            {list.map((p) => (
              <ProjectCard
                key={p.id}
                project={p}
                lr={lr}
                onPress={() => onOpenProject(p.id)}
              />
            ))}
          </View>
        );
      })}
      {unassigned.length > 0 ? (
        <View>
          <Text
            style={{
              fontSize: 10,
              fontWeight: '700',
              color: lr.muted2,
              paddingHorizontal: 4,
              marginBottom: 2,
            }}>
            未分周
          </Text>
          {unassigned.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              lr={lr}
              onPress={() => onOpenProject(p.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

type DraftTarget =
  | { mode: 'edit'; node: LifeRoadNodeRow }
  | {
      mode: 'create';
      kind: LifeRoadNodeKind;
      calendar_year?: number;
      quarter?: number;
      month?: number;
      parent_id?: string | null;
    };

function NodeRow({
  kindLabel,
  title,
  meta,
  empty,
  current,
  open,
  onToggle,
  onPress,
  status,
  showNow,
  lr,
}: {
  kindLabel: string;
  title: string;
  meta?: string;
  empty?: boolean;
  current?: boolean;
  open?: boolean;
  onToggle?: () => void;
  onPress: () => void;
  status?: LifeRoadNodeStatus;
  showNow?: boolean;
  lr: LifeRoadPalette;
}) {
  const tone = statusTone(status, lr);
  return (
    <View
      style={[
        styles.trow,
        current && {
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: lr.currentBorder,
          backgroundColor: lr.currentWash,
        },
        empty && { opacity: 0.85 },
      ]}>
      {onToggle ? (
        <Pressable
          onPress={onToggle}
          hitSlop={8}
          accessibilityLabel={open ? '折叠' : '展开'}
          style={[
            styles.tchev,
            {
              backgroundColor: lr.pineGhost,
              borderColor: lr.pineGhostBorder,
            },
          ]}>
          <ChevronIcon open={!!open} color={lr.muted} />
        </Pressable>
      ) : empty ? (
        <View
          style={[
            styles.emptyPlus,
            { borderColor: lr.line2, backgroundColor: lr.emptyPlusBg },
          ]}>
          <Text style={{ color: lr.muted2, fontSize: 14 }}>+</Text>
        </View>
      ) : (
        <View style={styles.tchevBlank} />
      )}
      <Pressable onPress={onPress} style={styles.tmain} accessibilityRole="button">
        <View style={styles.ttitle}>
          <Text style={[lifeRoadType.nodeKind, { color: lr.muted2 }]}>{kindLabel}</Text>
          <Text
            style={[
              lifeRoadType.nodeName,
              {
                color: empty ? lr.muted : current ? lr.pine : lr.ink2,
                fontStyle: empty ? 'italic' : 'normal',
                flexShrink: 1,
              },
            ]}
            numberOfLines={2}>
            {title}
          </Text>
          {tone ? (
            <View
              style={[
                styles.statusPill,
                { backgroundColor: tone.bg, borderColor: tone.border },
              ]}>
              <View style={[styles.statusDot, { backgroundColor: tone.color }]} />
              <Text style={{ fontSize: 10, fontWeight: '600', color: tone.color }}>
                {tone.label}
              </Text>
            </View>
          ) : null}
          {showNow ? (
            <View
              style={[
                styles.nowTag,
                {
                  backgroundColor: lr.nowBg,
                  borderColor: lr.nowBorder,
                },
              ]}>
              <Text style={[lifeRoadType.monoTiny, { color: lr.nowInk }]}>NOW</Text>
            </View>
          ) : null}
        </View>
        {meta ? (
          <Text style={[styles.tmeta, { color: lr.muted }]} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

function ProjectCard({
  project,
  lr,
  onPress,
  compact,
}: {
  project: RoadProjectRef;
  lr: LifeRoadPalette;
  onPress: () => void;
  compact?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.projCard,
        compact && styles.projCardHub,
        {
          borderColor: lr.line,
          backgroundColor: lr.card2,
          opacity: pressed ? 0.92 : 1,
        },
      ]}>
      <View
        style={[
          styles.projIco,
          { backgroundColor: lr.sage2, borderColor: 'rgba(140,173,156,0.18)' },
        ]}>
        <AppIcon name="flag" size={14} color={lr.pine} />
      </View>
      <View style={styles.projCopy}>
        <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={{ fontSize: 11, color: lr.muted, marginTop: 2 }} numberOfLines={1}>
          项目 · {project.status}
        </Text>
      </View>
      <View style={[styles.projGo, { backgroundColor: lr.pineWash }]}>
        <AppIcon name="chevron-right" size={12} color={lr.muted} />
      </View>
    </Pressable>
  );
}

function SectionHead({
  title,
  actionLabel,
  onAction,
  lr,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  lr: LifeRoadPalette;
}) {
  return (
    <View style={styles.sectionHead}>
      <Text style={[styles.sectionTitle, { color: lr.ink2 }]}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={8} style={styles.sectionAction}>
          <Text style={{ fontSize: 12, fontWeight: '600', color: lr.pine }}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function FoldBlock({
  title,
  open,
  onToggle,
  lr,
  children,
  preview,
}: {
  title: string;
  open: boolean;
  onToggle: () => void;
  lr: LifeRoadPalette;
  children: React.ReactNode;
  preview?: string;
}) {
  return (
    <View style={[styles.foldBlock, { borderColor: lr.line2, backgroundColor: lr.softPanel }]}>
      <Pressable
        onPress={onToggle}
        style={styles.foldHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}>
        <Text style={{ flex: 1, fontSize: 13, fontWeight: '600', color: lr.ink3 }}>{title}</Text>
        {!open && preview ? (
          <Text style={{ flex: 1, fontSize: 12, color: lr.muted, marginRight: 8 }} numberOfLines={1}>
            {preview}
          </Text>
        ) : null}
        <Text style={{ fontSize: 12, color: lr.muted }}>{open ? '收起' : '展开'}</Text>
      </Pressable>
      {open ? <View style={styles.foldBody}>{children}</View> : null}
    </View>
  );
}

function emptyWeekCopy(reason: RoadWeekTasksEmptyReason): string {
  if (reason === 'no_month_goal') return '先创建本月目标，再关联项目任务';
  if (reason === 'no_projects') return '本月还没有项目，新建后可在此看到本周任务';
  return '本周暂无相关项目任务';
}

export default function LifeRoadScreen() {
  useWardrobeFonts();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { lr } = useLifeRoadTheme();
  const { animate: motionOn } = useFoldMotionGate();
  const { wrapLoad } = usePageApiSync(PAGE_KEY);
  const params = useLocalSearchParams<{
    focus_month_id?: string | string[];
    mode?: string | string[];
  }>();
  const focusMonthId = useMemo(() => {
    const raw = params.focus_month_id;
    const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    return (s ?? '').trim() || null;
  }, [params.focus_month_id]);
  const modeParam = useMemo(() => {
    const raw = params.mode;
    const s = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : '';
    return (s ?? '').trim() || null;
  }, [params.mode]);

  const [direction, setDirection] = useState<LifeDirectionRow | null>(null);
  const [model, setModel] = useState<RoadMindMapModel | null>(null);
  const [unplannedCount, setUnplannedCount] = useState(0);
  const [unplannedProjects, setUnplannedProjects] = useState<RoadProjectTreeItem[]>([]);
  const [unplannedCategories, setUnplannedCategories] = useState<ProjectCategoryRow[]>([]);
  const [unplannedTreeMap, setUnplannedTreeMap] = useState<Record<string, TaskTreeNode[]>>({});
  const [weekTasks, setWeekTasks] = useState<RoadWeekTaskItem[]>([]);
  const [weekRangeLabel, setWeekRangeLabel] = useState('');
  const [weekEmptyReason, setWeekEmptyReason] = useState<RoadWeekTasksEmptyReason>('no_month_goal');
  const [weekLoading, setWeekLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStamp, setSyncStamp] = useState(() => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [revealEmptySeason, setRevealEmptySeason] = useState(false);
  /** null = 跟随路由；有值表示用户手动切换工作台/全景 */
  const [manualMode, setManualMode] = useState<ViewMode | null>(null);
  const [hubContextDrawerOpen, setHubContextDrawerOpen] = useState(false);
  const [selectedQuarterTab, setSelectedQuarterTab] = useState(() => currentQuarter());
  const [focusPulseId, setFocusPulseId] = useState<string | null>(null);
  const seededExpand = useRef(false);
  const scrollRef = useRef<ScrollHandle | null>(null);
  const scrollOffsetYRef = useRef(0);
  const stationRefs = useRef<Record<string, MeasurableHost | null>>({});
  const focusHandledRef = useRef<string | null>(null);
  const yearNow = currentCalendarYear();
  const monthNow = currentCalendarMonth();
  const quarterNow = currentQuarter();

  const viewMode: ViewMode =
    manualMode ??
    (focusMonthId || modeParam === 'panorama' ? 'panorama' : 'hub');

  let focusExpandKeys: string[] | null = null;
  let focusQuarter: number | null = null;
  if (model && focusMonthId) {
    outer: for (const yearBranch of model.years) {
      for (const q of yearBranch.quarters) {
        for (const m of q.months) {
          if (m.node?.id !== focusMonthId) continue;
          focusExpandKeys = [
            'above',
            `year:${yearBranch.year}`,
            `quarter:${yearBranch.year}:${q.quarter}`,
            `month:${yearBranch.year}:${m.month}`,
          ];
          focusQuarter = q.quarter;
          break outer;
        }
      }
    }
  }

  useEffect(() => {
    if (focusQuarter === 1 || focusQuarter === 2 || focusQuarter === 3 || focusQuarter === 4) {
      setSelectedQuarterTab(focusQuarter);
    }
  }, [focusQuarter]);

  const effectiveExpanded = (() => {
    if (!focusExpandKeys || focusExpandKeys.length === 0) return expanded;
    const next = new Set(expanded);
    for (const k of focusExpandKeys) next.add(k);
    return next;
  })();

  const currentYearBranch: RoadYearBranch | null = useMemo(() => {
    if (!model) return null;
    return model.years.find((y) => y.isCurrent) ?? model.years[0] ?? null;
  }, [model]);

  const currentMonthSlot: RoadMonthSlot | null = useMemo(() => {
    if (!currentYearBranch) return null;
    return (
      currentYearBranch.quarters
        .flatMap((q) => q.months)
        .find((m) => m.month === monthNow) ?? null
    );
  }, [currentYearBranch, monthNow]);

  const currentQuarterSlot: RoadQuarterSlot | null = useMemo(() => {
    if (!currentYearBranch) return null;
    return currentYearBranch.quarters.find((q) => q.quarter === quarterNow) ?? null;
  }, [currentYearBranch, quarterNow]);

  const rebuild = useCallback(async () => {
    const [dir, nodes] = await Promise.all([
      getLifeDirection({ serverFallback: true }),
      getLifeRoadNodes({ serverFallback: true }),
    ]);
    setDirection(dir);

    const db = await getDatabase();
    const projectsByMonthId = new Map<string, ProjectWithExtra[]>();
    const unplannedList: RoadProjectTreeItem[] = [];
    if (db) {
      const linked = await db.getAllAsync<{
        id: string;
        name: string;
        status: string;
        category_id: string | null;
        life_month_goal_id: string | null;
        extra_data: string | null;
      }>(
        `SELECT id, name, status, category_id, life_month_goal_id, extra_data FROM projects
         WHERE sync_status != 'pending_delete'
           AND status IN (
             'todo', 'doing', 'blocked', 'shelved', 'done',
             'active', 'paused', 'completed'
           )`,
      );
      for (const p of linked ?? []) {
        const mid = String(p.life_month_goal_id ?? '').trim();
        if (!mid) {
          if (isProjectInInboxCategory(p.category_id)) continue;
          unplannedList.push({
            id: String(p.id),
            name: String(p.name),
            status: String(p.status),
            category_id: p.category_id,
            life_month_goal_id: null,
          });
          continue;
        }
        const list = projectsByMonthId.get(mid) ?? [];
        list.push({
          id: String(p.id),
          name: String(p.name),
          status: String(p.status),
          weekKey: parseLifeWeekKey(p.extra_data),
          extraData: p.extra_data,
        });
        projectsByMonthId.set(mid, list);
      }
    }
    setUnplannedCount(unplannedList.length);
    setUnplannedProjects(unplannedList);
    try {
      const [cats, treeMap] = await Promise.all([
        getProjectCategories(),
        getProjectTaskTreeMap(unplannedList.map((p) => p.id)),
      ]);
      setUnplannedCategories(cats ?? []);
      setUnplannedTreeMap(treeMap);
    } catch {
      setUnplannedCategories([]);
      setUnplannedTreeMap({});
    }
    const next = buildRoadMindMap(nodes, projectsByMonthId);
    setModel(next);
    if (!seededExpand.current) {
      setExpanded(new Set(next.defaultExpandedKeys));
      seededExpand.current = true;
    }

    const cy = currentCalendarYear();
    const cm = currentCalendarMonth();
    const yearBranch = next.years.find((y) => y.year === cy) ?? next.years[0];
    const monthSlot = yearBranch?.quarters
      .flatMap((q) => q.months)
      .find((m) => m.month === cm);
    const monthId = monthSlot?.node?.id ?? null;
    const monthProjects = (monthSlot?.projects ?? []) as ProjectWithExtra[];
    setWeekLoading(true);
    try {
      const week = await loadCurrentMonthWeekTasks({
        monthGoalId: monthId,
        projects: monthProjects,
      });
      setWeekTasks(week.tasks);
      setWeekRangeLabel(week.weekRangeLabel);
      setWeekEmptyReason(week.emptyReason);
    } catch {
      setWeekTasks([]);
      setWeekEmptyReason(monthId ? (monthProjects.length ? 'no_week_tasks' : 'no_projects') : 'no_month_goal');
    } finally {
      setWeekLoading(false);
    }
  }, []);

  const reload = useCallback(
    async (force = false) => {
      setLoading(true);
      setSyncing(true);
      try {
        await wrapLoad(async () => {
          await fetchProfileLifeRoad({ serverFallback: true });
          await rebuild();
        }, force);
      } catch (e) {
        // 云端排队/繁忙时仍用本地缓存组装，避免整页空白
        try {
          await rebuild();
        } catch {
          /* ignore */
        }
        toast.error(toUserMessage(e, '道路加载失败'));
      } finally {
        setLoading(false);
        setSyncing(false);
        const d = new Date();
        setSyncStamp(
          `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
        );
      }
    },
    [rebuild, wrapLoad],
  );

  useEffect(() => {
    if (!focusMonthId || viewMode !== 'panorama' || !model) return;
    if (focusHandledRef.current === focusMonthId) return;
    focusHandledRef.current = focusMonthId;
    setFocusPulseId(focusMonthId);
    const timer = setTimeout(() => {
      const node = stationRefs.current[focusMonthId];
      if (!node?.measureInWindow) return;
      node.measureInWindow((_x, pageY) => {
        const nextY = Math.max(0, scrollOffsetYRef.current + (pageY - 160));
        scrollRef.current?.scrollTo({ y: nextY, animated: true });
      });
    }, 320);
    const clearPulse = setTimeout(() => setFocusPulseId(null), 2300);
    return () => {
      clearTimeout(timer);
      clearTimeout(clearPulse);
    };
  }, [focusMonthId, viewMode, model]);

  const { refreshControl } = usePagePullRefresh(PAGE_KEY, () => reload(true));

  useFocusEffect(
    useCallback(() => {
      void reload(false);
    }, [reload]),
  );

  const toggle = (key: string) => {
    setExpanded((prev) => {
      const base = focusExpandKeys ? new Set([...prev, ...focusExpandKeys]) : prev;
      const next = new Set(base);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const openDirection = () => router.push('/edit-life-direction');

  const openNode = (target: DraftTarget) => {
    if (target.mode === 'edit') {
      router.push({
        pathname: '/edit-life-road-node/[id]',
        params: { id: target.node.id },
      });
      return;
    }
    const createParams: {
      id: string;
      kind: string;
      year?: string;
      quarter?: string;
      month?: string;
      parent_id?: string;
    } = {
      id: 'new',
      kind: target.kind,
    };
    if (target.calendar_year != null) createParams.year = String(target.calendar_year);
    if (target.quarter != null) createParams.quarter = String(target.quarter);
    if (target.month != null) createParams.month = String(target.month);
    if (target.parent_id) createParams.parent_id = target.parent_id;
    router.push({ pathname: '/edit-life-road-node/[id]', params: createParams });
  };

  const openCreateCurrentMonth = () => {
    openNode({
      mode: 'create',
      kind: 'month',
      calendar_year: yearNow,
      quarter: monthToQuarter(monthNow),
      month: monthNow,
      parent_id: currentQuarterSlot?.node?.id ?? null,
    });
  };

  const openCreateProject = () => {
    const monthId = currentMonthSlot?.node?.id;
    if (!monthId) {
      toast.warn('请先创建本月目标');
      return;
    }
    router.push({
      pathname: '/add-project',
      params: { life_month_goal_id: monthId },
    });
  };

  const confirmDelete = (node: LifeRoadNodeRow) => {
    Alert.alert('删除节点', `确定删除「${node.title}」？挂在其下的项目会摘除归属。`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteLifeRoadNode(node.id);
              toast.success('已删除');
              await rebuild();
            } catch (e) {
              toast.error(toUserMessage(e, '删除失败'));
            }
          })();
        },
      },
    ]);
  };

  const keywords = useMemo(() => parseKeywords(direction?.extra_data), [direction?.extra_data]);

  const monthProjects = currentMonthSlot?.projects ?? [];
  const monthNode = currentMonthSlot?.node ?? null;
  const monthTitle = monthNode?.title?.trim() || '';
  const monthNote = monthNode?.note?.trim() || '';
  const weekDoneCount = weekTasks.filter((t) => isTaskDone(t.status)).length;
  const weekTotal = weekTasks.length;
  const weekProgressPct = weekTotal ? Math.round((weekDoneCount / weekTotal) * 100) : 0;
  const qPreviewTitle = currentQuarterSlot?.node?.title?.trim() || '';
  const qPreviewShort =
    qPreviewTitle.length > 11 ? `${qPreviewTitle.slice(0, 11)}…` : qPreviewTitle;

  const openTaskOrProject = (item: RoadWeekTaskItem) => {
    router.push({
      pathname: '/edit-task',
      params: { id: item.taskId },
    });
  };

  const renderHub = () => (
    <>
      <FoldRiseIn animate={motionOn} index={2} fromY={10}>
        {monthNode && monthTitle ? (
          <View style={[styles.monthHeroDark, { backgroundColor: lr.roadDeep }]}>
            <HeroGradientFill from={lr.roadDeep} to={lr.roadDeepMid} />
            <HorizonBeacon />
            <View style={[styles.monthHeroTop, styles.heroFg]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 }}>
                <Text style={[lifeRoadType.kickerTiny, { color: '#E0B072' }]}>
                  {MONTH_ABBR[monthNow - 1]} · {monthNow}月焦点
                </Text>
                <EditorialStatus status={monthNode.status} onDark lr={lr} />
              </View>
              <Pressable
                onPress={() => openNode({ mode: 'edit', node: monthNode })}
                style={styles.ghostEditBtn}>
                <Text style={{ fontSize: 11, fontWeight: '500', color: '#E9F2ED' }}>编辑</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => openNode({ mode: 'edit', node: monthNode })}
              style={styles.heroFg}>
              <Text style={[styles.monthHeroTitle, { color: '#FFFFFF' }]}>{monthTitle}</Text>
              {monthNote ? (
                <Text
                  style={{ marginTop: 8, fontSize: 12, lineHeight: 20, color: '#A9C7B9' }}
                  numberOfLines={3}>
                  {monthNote}
                </Text>
              ) : null}
            </Pressable>
            <View
              style={[
                styles.heroFoot,
                styles.heroFg,
                { borderTopColor: 'rgba(255,255,255,0.1)' },
              ]}>
              <Pressable
                onPress={() => setHubContextDrawerOpen((v) => !v)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 }}>
                <Text style={{ fontSize: 11, color: 'rgba(233,242,237,0.9)' }} numberOfLines={1}>
                  {qPreviewTitle
                    ? `Q${quarterNow} · ${qPreviewShort}`
                    : `Q${quarterNow} 尚未落子`}
                </Text>
                <ChevronDownIcon open={hubContextDrawerOpen} color="rgba(233,242,237,0.85)" />
              </Pressable>
              <Text style={{ fontSize: 11, color: 'rgba(255,255,255,0.2)' }}>|</Text>
              <Pressable onPress={openDirection}>
                <Text style={{ fontSize: 11, color: '#E0B072' }}>总方向</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View
            style={[
              styles.monthHeroEmpty,
              { borderColor: lr.line, backgroundColor: lr.card },
            ]}>
            <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
              {MONTH_ABBR[monthNow - 1]} · {monthNow}月
            </Text>
            <Text style={[lifeRoadType.serifEmpty, { color: lr.ink, marginTop: 10 }]}>
              写下这个月要推进的方向
            </Text>
            <Text style={{ marginTop: 6, fontSize: 12, color: lr.sage, textAlign: 'center' }}>
              确立本月目标后，即可挂载执行项目。
            </Text>
            <Pressable
              onPress={openCreateCurrentMonth}
              style={[styles.pineCta, { backgroundColor: lr.ink, marginTop: 14 }]}>
              <Text style={{ fontSize: 12, fontWeight: '600', color: lr.onRoad }}>创建本月目标</Text>
            </Pressable>
          </View>
        )}
      </FoldRiseIn>

      {hubContextDrawerOpen ? (
        <FoldRiseIn animate={motionOn} index={2} fromY={6}>
          <View
            style={[
              styles.contextDrawer,
              { borderColor: lr.line, backgroundColor: lr.card },
            ]}>
            <Pressable
              onPress={() => {
                if (currentQuarterSlot?.node) {
                  openNode({ mode: 'edit', node: currentQuarterSlot.node });
                } else {
                  openNode({
                    mode: 'create',
                    kind: 'quarter',
                    calendar_year: yearNow,
                    quarter: quarterNow,
                    parent_id: currentYearBranch?.node?.id ?? null,
                  });
                }
              }}
              style={[styles.drawerRow, { borderBottomColor: lr.line }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
                  当前季度 · Q{quarterNow}
                </Text>
                <Text
                  style={{ marginTop: 3, fontSize: 12, fontWeight: '500', color: lr.ink }}
                  numberOfLines={1}>
                  {currentQuarterSlot?.node?.title?.trim() || '尚未落子 · 点击创建'}
                </Text>
              </View>
              <AppIcon name="chevron-right" size={14} color={lr.muted} />
            </Pressable>
            <Pressable
              onPress={() => {
                if (currentYearBranch?.node) {
                  openNode({ mode: 'edit', node: currentYearBranch.node });
                } else {
                  openNode({ mode: 'create', kind: 'year', calendar_year: yearNow });
                }
              }}
              style={[styles.drawerRow, { borderBottomColor: lr.line }]}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
                  {yearNow} 年度目标
                </Text>
                <Text
                  style={{ marginTop: 3, fontSize: 12, fontWeight: '500', color: lr.ink }}
                  numberOfLines={1}>
                  {currentYearBranch?.node?.title?.trim() || '尚未写下年目标'}
                </Text>
              </View>
              <AppIcon name="chevron-right" size={14} color={lr.muted} />
            </Pressable>
            <Pressable onPress={openDirection} style={styles.drawerRowLast}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[lifeRoadType.kickerTiny, { color: lr.amber }]}>北极星总方向</Text>
                <Text
                  style={[
                    lifeRoadType.serifNorth,
                    { marginTop: 3, fontSize: 12, color: lr.ink },
                  ]}
                  numberOfLines={1}>
                  {direction?.body?.trim() || '点击写下总方向'}
                </Text>
              </View>
              <AppIcon name="chevron-right" size={14} color={lr.muted} />
            </Pressable>
          </View>
        </FoldRiseIn>
      ) : null}

      <FoldRiseIn animate={motionOn} index={3} fromY={10}>
        <View
          style={[
            styles.weekCard,
            { borderColor: lr.line, backgroundColor: lr.card },
          ]}>
          <View style={styles.weekHead}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', flexShrink: 1, gap: 8 }}>
              <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
                本周推进 · {weekRangeLabel || '本周'}
              </Text>
              {weekTotal > 0 ? (
                <Text style={{ fontSize: 11, color: lr.muted }}>
                  {weekDoneCount}/{weekTotal}
                </Text>
              ) : null}
            </View>
            {weekTasks.length > 0 ? (
              <Pressable
                onPress={() => {
                  const pid = weekTasks[0]?.projectId;
                  if (pid) router.push({ pathname: '/edit-project', params: { id: pid } });
                }}
                hitSlop={8}>
                <Text style={{ fontSize: 11, fontWeight: '500', color: lr.sage }}>查看全部</Text>
              </Pressable>
            ) : null}
          </View>
          {weekTotal > 0 ? (
            <View style={[styles.progressTrack, { backgroundColor: lr.paper2 }]}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${weekProgressPct}%`,
                    backgroundColor: weekProgressPct >= 100 ? '#E0B35A' : '#5F8A6E',
                  },
                ]}
              />
            </View>
          ) : null}
          {weekLoading ? (
            <ActivityIndicator color={lr.pine} style={{ marginVertical: 12 }} />
          ) : weekTasks.length > 0 ? (
            <View>
              {weekTasks.map((t, idx) => {
                const done = isTaskDone(t.status);
                return (
                  <Pressable
                    key={t.taskId}
                    onPress={() => openTaskOrProject(t)}
                    style={[
                      styles.taskRowEditorial,
                      idx < weekTasks.length - 1
                        ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: lr.line }
                        : null,
                    ]}>
                    <View
                      style={[
                        styles.taskCheck,
                        done
                          ? { backgroundColor: '#5F8A6E', borderColor: '#5F8A6E' }
                          : { borderColor: lr.sage, backgroundColor: 'transparent' },
                      ]}>
                      {done ? (
                        <AppIcon name="check" size={10} color="#FAF8F0" />
                      ) : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={{
                          fontSize: 13,
                          fontWeight: '500',
                          color: lr.ink,
                          textDecorationLine: done ? 'line-through' : 'none',
                          opacity: done ? 0.45 : 1,
                        }}
                        numberOfLines={2}>
                        {t.title}
                      </Text>
                      <Text style={{ marginTop: 2, fontSize: 11, color: lr.muted }} numberOfLines={1}>
                        {t.projectName}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={[styles.emptyHint, { color: lr.muted, textAlign: 'center', paddingVertical: 18 }]}>
              {emptyWeekCopy(weekEmptyReason)}
            </Text>
          )}
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={motionOn} index={4} fromY={10}>
        <View style={styles.hubSection}>
          <View style={styles.projSectionHead}>
            <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
              本月项目 · {monthProjects.length}
            </Text>
            {monthNode ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                <Pressable onPress={openCreateProject} hitSlop={8}>
                  <Text style={{ fontSize: 11, fontWeight: '500', color: lr.sage }}>+ 新建</Text>
                </Pressable>
                {monthProjects.length > 0 ? (
                  <Pressable
                    onPress={() => openNode({ mode: 'edit', node: monthNode })}
                    hitSlop={8}>
                    <Text style={{ fontSize: 11, fontWeight: '500', color: lr.amber }}>周次排期</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
          {!monthNode ? (
            <View
              style={[
                styles.emptySurface,
                { borderColor: lr.line, backgroundColor: lr.card },
              ]}>
              <Text style={{ fontSize: 12, color: lr.muted, textAlign: 'center' }}>
                创建本月目标后，即可挂载项目
              </Text>
            </View>
          ) : monthProjects.length === 0 ? (
            <View
              style={[
                styles.emptySurface,
                { borderColor: lr.line, backgroundColor: lr.card },
              ]}>
              <Text style={{ fontSize: 12, color: lr.sage, textAlign: 'center' }}>
                本月尚未挂载项目
              </Text>
              <Pressable
                onPress={openCreateProject}
                style={[styles.pineCta, { backgroundColor: lr.ink, marginTop: 12 }]}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: lr.onRoad }}>+ 新建项目</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.tileGrid}>
              {monthProjects.slice(0, 4).map((p, idx) => (
                <Pressable
                  key={p.id}
                  onPress={() =>
                    router.push({ pathname: '/edit-project', params: { id: p.id } })
                  }
                  style={[
                    styles.projTile,
                    { borderColor: lr.line, backgroundColor: lr.card },
                  ]}>
                  <View style={styles.projTileTop}>
                    <ProjectTileGlyph index={idx} color={lr.sage} />
                    <Text style={{ fontSize: 10, color: lr.muted }}>
                      {weekKeyShort(p.weekKey)}
                    </Text>
                  </View>
                  <Text
                    style={{
                      marginTop: 12,
                      fontSize: 13,
                      fontWeight: '600',
                      color: lr.ink,
                      lineHeight: 18,
                    }}
                    numberOfLines={2}>
                    {p.name}
                  </Text>
                  <Text style={{ marginTop: 8, fontSize: 10, color: lr.muted }} numberOfLines={1}>
                    {projectStatusLabel(p.status)}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </FoldRiseIn>

      {unplannedCount > 0 ? (
        <Pressable
          onPress={() => setManualMode('panorama')}
          style={[
            styles.unplannedBanner,
            { borderColor: lr.line, backgroundColor: lr.card },
          ]}>
          <Text style={{ flex: 1, fontSize: 12, color: lr.ink }}>
            有 <Text style={{ fontWeight: '600' }}>{unplannedCount}</Text> 个项目未归入道路
          </Text>
          <Text style={{ fontSize: 11, fontWeight: '500', color: lr.amber }}>在全景中管理 →</Text>
        </Pressable>
      ) : null}
    </>
  );

  const renderYearMetro = (yearBranch: RoadYearBranch) => {
    const year = yearBranch.year;
    const isNow = yearBranch.isCurrent;
    const activeQ = selectedQuarterTab;
    const qSlot =
      yearBranch.quarters.find((q) => q.quarter === activeQ) ??
      yearBranch.quarters[0] ??
      null;
    const emptyQuarters = yearBranch.quarters
      .filter((q) => !q.hasContent && !(isNow && q.quarter === quarterNow))
      .map((q) => q.quarter);

    return (
      <View
        key={`metro:${year}`}
        style={[styles.metroCard, { borderColor: lr.line, backgroundColor: lr.card }]}>
        <Pressable
          onPress={() => {
            if (yearBranch.node) openNode({ mode: 'edit', node: yearBranch.node });
            else openNode({ mode: 'create', kind: 'year', calendar_year: year });
          }}
          style={styles.metroYearHead}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={[lifeRoadType.appTitle, { color: lr.ink, fontSize: 16 }]}>{year}</Text>
              {isNow ? (
                <View style={[styles.nowBadge, { backgroundColor: lr.amber }]}>
                  <Text style={{ fontSize: 9, fontWeight: '700', color: '#121A16', letterSpacing: 0.8 }}>
                    NOW
                  </Text>
                </View>
              ) : null}
              <EditorialStatus status={yearBranch.node?.status} lr={lr} />
            </View>
            <Text
              style={{
                marginTop: 4,
                fontSize: 12,
                fontWeight: yearBranch.node?.title?.trim() ? '500' : '400',
                fontStyle: yearBranch.node?.title?.trim() ? 'normal' : 'italic',
                color: yearBranch.node?.title?.trim() ? lr.ink : lr.muted,
              }}
              numberOfLines={1}>
              {yearBranch.node?.title?.trim() || `点击写下 ${year} 年度目标`}
            </Text>
          </View>
          <AppIcon name="chevron-right" size={16} color={lr.muted} />
        </Pressable>

        <View style={[styles.qTabs, { backgroundColor: lr.paper2 }]}>
          {([1, 2, 3, 4] as const).map((q) => {
            const isEmpty = emptyQuarters.includes(q);
            if (isNow && isEmpty && !revealEmptySeason) {
              return (
                <View key={q} style={styles.qTabGhost}>
                  <Text style={{ fontSize: 10, color: lr.muted }}>Q{q}</Text>
                </View>
              );
            }
            const sel = activeQ === q;
            return (
              <Pressable
                key={q}
                onPress={() => setSelectedQuarterTab(q)}
                style={[
                  styles.qTab,
                  sel ? { backgroundColor: lr.card } : null,
                ]}>
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: sel ? lr.ink : lr.sage,
                  }}>
                  Q{q}
                  {isNow && q === quarterNow ? ' ·' : ''}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {isNow && emptyQuarters.length > 0 ? (
          <Pressable
            onPress={() => setRevealEmptySeason((v) => !v)}
            style={{ paddingVertical: 6 }}>
            <Text style={{ fontSize: 10, color: lr.muted, textAlign: 'center' }}>
              {revealEmptySeason ? '收起空白季' : '空白季已自动收起 · 显示'}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={() => {
            if (qSlot?.node) openNode({ mode: 'edit', node: qSlot.node });
            else
              openNode({
                mode: 'create',
                kind: 'quarter',
                calendar_year: year,
                quarter: activeQ,
                parent_id: yearBranch.node?.id ?? null,
              });
          }}
          style={[styles.metroQHead, { borderBottomColor: lr.line }]}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
              Q{activeQ} 季度目标
            </Text>
            <Text
              style={{
                marginTop: 3,
                fontSize: 12,
                fontWeight: qSlot?.node?.title?.trim() ? '500' : '400',
                fontStyle: qSlot?.node?.title?.trim() ? 'normal' : 'italic',
                color: qSlot?.node?.title?.trim() ? lr.ink : lr.muted,
              }}
              numberOfLines={1}>
              {qSlot?.node?.title?.trim() || '空白季 · 点此新建'}
            </Text>
          </View>
          <Text style={{ fontSize: 11, color: lr.muted }}>编辑</Text>
        </Pressable>

        <View style={styles.metroTrack}>
          <View style={[styles.metroRail, { backgroundColor: lr.line }]} />
          {(qSlot?.months ?? []).map((m) => {
            const isCurr = isNow && m.month === monthNow;
            const hasNode = !!m.node;
            const stationId = m.node?.id ?? null;
            const pulsing = stationId != null && focusPulseId === stationId;
            return (
              <View
                key={m.month}
                ref={(r) => {
                  if (stationId) {
                    stationRefs.current[stationId] = r as unknown as MeasurableHost | null;
                  }
                }}
                collapsable={false}
                style={[styles.metroStation, pulsing ? styles.sonarFocus : null]}>
                <View
                  style={[
                    styles.metroDot,
                    {
                      backgroundColor: isCurr ? lr.amber : hasNode ? '#5F8A6E' : lr.muted,
                      borderColor: lr.card,
                    },
                  ]}
                />
                <Pressable
                  onPress={() => {
                    if (m.node) openNode({ mode: 'edit', node: m.node });
                    else
                      openNode({
                        mode: 'create',
                        kind: 'month',
                        calendar_year: year,
                        quarter: activeQ,
                        month: m.month,
                        parent_id: qSlot?.node?.id ?? null,
                      });
                  }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: '700',
                        color: isCurr ? lr.amber : lr.ink,
                      }}>
                      {m.month} 月
                    </Text>
                    <EditorialStatus status={m.node?.status} lr={lr} />
                  </View>
                  <Text
                    style={{
                      marginTop: 2,
                      fontSize: 12,
                      fontWeight: m.node?.title?.trim() ? '500' : '400',
                      fontStyle: m.node?.title?.trim() ? 'normal' : 'italic',
                      color: m.node?.title?.trim() ? lr.ink : lr.muted,
                    }}
                    numberOfLines={1}>
                    {m.node?.title?.trim() || '尚未落子'}
                  </Text>
                </Pressable>
                {m.projects.length > 0 ? (
                  <View style={styles.metroChips}>
                    {m.projects.map((p) => (
                      <Pressable
                        key={p.id}
                        onPress={() =>
                          router.push({ pathname: '/edit-project', params: { id: p.id } })
                        }
                        style={[styles.metroChip, { backgroundColor: lr.paper2 }]}>
                        <Text style={{ fontSize: 10, fontWeight: '500', color: lr.ink }} numberOfLines={1}>
                          {p.name}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  const renderPanorama = () => (
    <>
      <FoldRiseIn animate={motionOn} index={2} fromY={10}>
        <Pressable
          onPress={openDirection}
          style={[styles.northHero, { backgroundColor: lr.roadDeep }]}>
          <HeroGradientFill from={lr.roadDeep} to={lr.roadDeepMid} />
          <View style={[styles.northHead, styles.heroFg]}>
            <Text style={[lifeRoadType.kickerTiny, { color: '#E0B072' }]}>
              TRUE NORTH · 总方向
            </Text>
            <Text style={{ fontSize: 11, color: '#A9C7B9' }}>编辑</Text>
          </View>
          <Text
            style={[
              lifeRoadType.serifNorth,
              styles.heroFg,
              { color: '#F5F3E8', marginTop: 8 },
            ]}>
            {direction?.body?.trim() || '点击写下你的总方向'}
          </Text>
          {keywords.length > 0 ? (
            <View style={[styles.keywordRow, styles.heroFg]}>
              {keywords.map((k) => (
                <Text key={k} style={{ fontSize: 11, color: '#A9C7B9' }}>
                  # {k}
                </Text>
              ))}
            </View>
          ) : null}
        </Pressable>
      </FoldRiseIn>

      <FoldRiseIn animate={motionOn} index={3} fromY={10}>
        <View style={styles.aboveSection}>
          <View style={styles.aboveHead}>
            <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>ABOVE · 今年之上</Text>
            <View style={{ flexDirection: 'row', gap: 14 }}>
              <Pressable onPress={() => openNode({ mode: 'create', kind: 'farther' })} hitSlop={8}>
                <Text style={{ fontSize: 11, color: lr.sage }}>+ 更远</Text>
              </Pressable>
              <Pressable onPress={() => openNode({ mode: 'create', kind: 'multi' })} hitSlop={8}>
                <Text style={{ fontSize: 11, color: lr.sage }}>+ 多年</Text>
              </Pressable>
            </View>
          </View>
          {(model?.aboveYear?.length ?? 0) > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 12, paddingVertical: 2 }}>
              {(model?.aboveYear ?? []).map((n) => (
                <Pressable
                  key={n.id}
                  onPress={() => openNode({ mode: 'edit', node: n })}
                  style={[
                    styles.aboveCard,
                    { borderColor: lr.line, backgroundColor: lr.card },
                  ]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={[lifeRoadType.kickerTiny, { color: lr.sage }]}>
                      {n.kind === 'farther' ? '更远' : '多年'}
                    </Text>
                    <EditorialStatus status={n.status} lr={lr} />
                  </View>
                  <Text
                    style={[
                      lifeRoadType.serifNorth,
                      { marginTop: 8, fontSize: 12, fontWeight: '700', color: lr.ink },
                    ]}
                    numberOfLines={2}>
                    {n.title}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <View
              style={[
                styles.emptySurface,
                { borderColor: lr.line, backgroundColor: lr.card },
              ]}>
              <Text style={{ fontSize: 12, color: lr.muted, textAlign: 'center' }}>
                可添加 3–10 年或更远坐标
              </Text>
            </View>
          )}
        </View>
      </FoldRiseIn>

      <FoldRiseIn animate={motionOn} index={4} fromY={10}>
        <View style={{ gap: 14, marginTop: 6 }}>
          {(model?.years ?? []).map((yb) => renderYearMetro(yb))}
        </View>
      </FoldRiseIn>

      {unplannedProjects.length > 0 ? (
        <View
          style={[
            styles.unplannedCard,
            { borderColor: lr.line, backgroundColor: lr.card, marginTop: 14 },
          ]}>
          <Text style={[lifeRoadType.kickerTiny, { color: lr.amber }]}>
            未归入道路的项目 · {unplannedProjects.length}
          </Text>
          <Text style={{ marginTop: 4, marginBottom: 8, fontSize: 11, color: lr.muted, lineHeight: 16 }}>
            按任务页分类展开；点项目进入编辑并挂到月目标。
          </Text>
          <RoadProjectTaskTreeList
            projects={unplannedProjects}
            categories={unplannedCategories}
            treeMap={unplannedTreeMap}
            lr={lr}
            actionLabel="去挂载 →"
            onAction={(p) =>
              router.push({ pathname: '/edit-project', params: { id: p.id } })
            }
            onPressProject={(p) =>
              router.push({ pathname: '/edit-project', params: { id: p.id } })
            }
          />
        </View>
      ) : null}
    </>
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: lr.paper }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View
        style={[
          styles.appBar,
          {
            paddingTop: insets.top + 6,
            borderBottomColor: viewMode === 'panorama' ? lr.line : 'transparent',
            backgroundColor: lr.paper,
          },
        ]}>
        <Pressable
          onPress={() => {
            if (viewMode === 'panorama') {
              setManualMode('hub');
              return;
            }
            router.back();
          }}
          accessibilityRole="button"
          accessibilityLabel={viewMode === 'panorama' ? '返回工作台' : '返回我的'}
          hitSlop={10}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1, minWidth: 56 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
            <AppIcon name="chevron-left" size={16} color={lr.sage} />
            <Text style={{ fontSize: 12, fontWeight: '500', color: lr.sage }}>
              {viewMode === 'panorama' ? '工作台' : '我的'}
            </Text>
          </View>
        </Pressable>

        <View style={styles.appBarTitleWrap}>
          <Text style={[lifeRoadType.appTitle, { color: lr.ink, fontSize: 14 }]}>
            {viewMode === 'panorama' ? '道路全景' : '我的道路'}
          </Text>
          {viewMode === 'hub' ? (
            <Pressable
              onPress={() => void reload(true)}
              hitSlop={6}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 }}>
              {syncing ? (
                <>
                  <View style={[styles.sdot, { backgroundColor: lr.amber }]} />
                  <Text style={{ fontSize: 10, color: lr.sage }}>正在同步…</Text>
                </>
              ) : (
                <>
                  <View style={[styles.sdot, { backgroundColor: '#5F8A6E' }]} />
                  <Text style={{ fontSize: 10, color: lr.muted }}>
                    工作台 · {monthNow}月 · {syncStamp}
                  </Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        {viewMode === 'hub' ? (
          <Pressable
            onPress={() => setManualMode('panorama')}
            accessibilityLabel="全景"
            style={({ pressed }) => [
              styles.pillBtn,
              { backgroundColor: lr.ink, opacity: pressed ? 0.9 : 1 },
            ]}>
            <Text style={{ color: lr.onRoad, fontSize: 11, fontWeight: '600' }}>全景</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() =>
              openNode({ mode: 'create', kind: 'year', calendar_year: yearNow + 1 })
            }
            accessibilityLabel={`新建 ${yearNow + 1} 年`}
            hitSlop={8}
            style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ fontSize: 11, fontWeight: '600', color: lr.amber }}>
              + {yearNow + 1}年
            </Text>
          </Pressable>
        )}
      </View>

      <ScrollView
        ref={(node) => {
          scrollRef.current = node as unknown as ScrollHandle | null;
        }}
        refreshControl={refreshControl}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          scrollOffsetYRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: insets.bottom + Spacing['6xl'],
        }}
        showsVerticalScrollIndicator={false}>
        {loading && !model ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={lr.pine} />
        ) : viewMode === 'hub' ? (
          renderHub()
        ) : (
          renderPanorama()
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  appBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingBottom: 8,
    gap: 9,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  appBarTitleWrap: { flex: 1, minWidth: 0, alignItems: 'center' },
  pillBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
  },
  pillBtnOutline: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  syncBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  sdot: { width: 5, height: 5, borderRadius: 3 },
  stext: { flex: 1, minWidth: 0, fontSize: 12 },
  refreshChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  roadHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  monthHero: {
    marginTop: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  monthHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  monthHeroTitle: {
    ...lifeRoadType.serifEmpty,
    fontSize: 20,
    lineHeight: 30,
    letterSpacing: 0.2,
  },
  linkChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  emptyCta: {
    marginTop: 4,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  hubSection: { marginTop: 18 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  sectionTitle: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  sectionAction: { paddingVertical: 4, paddingHorizontal: 2 },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
  },
  emptyHint: { fontSize: 13, lineHeight: 20, paddingVertical: 4 },
  foldBlock: {
    marginTop: 14,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  foldHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    gap: 8,
  },
  foldBody: { paddingHorizontal: 12, paddingBottom: 12 },
  unplannedRow: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  unplannedCard: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
  },
  northCard: {
    marginTop: 12,
    paddingHorizontal: 15,
    paddingTop: 14,
    paddingBottom: 13,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
  },
  northHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  sideCard: {
    marginTop: 11,
    paddingHorizontal: 5,
    paddingTop: 4,
    paddingBottom: 8,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  treeCard: {
    marginTop: 11,
    paddingHorizontal: 5,
    paddingTop: 6,
    paddingBottom: 9,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  treeHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 6,
  },
  trow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingVertical: 7,
    paddingRight: 7,
    paddingLeft: 5,
    borderRadius: 13,
  },
  tchev: {
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    borderWidth: StyleSheet.hairlineWidth,
  },
  tchevBlank: { width: 20, height: 20, marginTop: 1 },
  emptyPlus: {
    width: 20,
    height: 20,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  tmain: { flex: 1, minWidth: 0 },
  ttitle: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
  },
  tmeta: { marginTop: 2, fontSize: 11, letterSpacing: 0.2 },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  statusDot: { width: 3, height: 3, borderRadius: 2 },
  nowTag: {
    paddingHorizontal: 4,
    paddingVertical: 1.5,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
  },
  childrenPad: {
    paddingLeft: 17,
    marginLeft: 9,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(213,201,182,0.78)',
    gap: 1,
  },
  accInner: {
    marginLeft: 31,
    marginRight: 8,
    marginBottom: 2,
    paddingLeft: 9,
    paddingVertical: 1,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: 'rgba(140,173,156,0.3)',
    gap: 2,
  },
  accItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 7,
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  accTxt: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 18 },
  projCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 10,
    marginRight: 8,
    marginTop: 4,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
  },
  projCardHub: { marginLeft: 0, marginRight: 0, marginTop: 0 },
  projIco: {
    width: 27,
    height: 27,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
  projCopy: { flex: 1, minWidth: 0 },
  projGo: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFar: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
    marginTop: 3,
  },
  revealEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingLeft: 2,
    marginTop: 4,
  },
  nextYearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 11,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 17,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  nextYearPlus: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /* —— 奶油松墨编辑版 —— */
  heroFg: { zIndex: 2 },
  monthHeroDark: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 18,
    borderRadius: 26,
    overflow: 'hidden',
  },
  monthHeroEmpty: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 20,
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  ghostEditBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  heroFoot: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pineCta: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: 'center',
  },
  contextDrawer: {
    marginTop: 10,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  drawerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  drawerRowLast: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  weekCard: {
    marginTop: 18,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 8,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
  },
  weekHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 8,
    gap: 8,
  },
  progressTrack: {
    height: 2,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 8,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    overflow: 'hidden',
  },
  taskRowEditorial: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
  },
  taskCheck: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  projSectionHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 12,
    paddingHorizontal: 2,
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  projTile: {
    width: '47.5%',
    flexGrow: 1,
    minHeight: 112,
    padding: 14,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'space-between',
  },
  projTileTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  emptySurface: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  unplannedBanner: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  northHero: {
    marginTop: 4,
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 16,
    borderRadius: 24,
    overflow: 'hidden',
  },
  keywordRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 12,
  },
  aboveSection: { marginTop: 18, gap: 10 },
  aboveHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  aboveCard: {
    width: 230,
    padding: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
  },
  metroCard: {
    padding: 18,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  metroYearHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  nowBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  qTabs: {
    flexDirection: 'row',
    padding: 4,
    borderRadius: 12,
    gap: 2,
  },
  qTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  qTabGhost: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
  },
  metroQHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  metroTrack: {
    position: 'relative',
    paddingLeft: 20,
    gap: 16,
  },
  metroRail: {
    position: 'absolute',
    left: 6,
    top: 8,
    bottom: 8,
    width: StyleSheet.hairlineWidth,
  },
  metroStation: {
    position: 'relative',
    paddingVertical: 2,
    borderRadius: 12,
  },
  metroDot: {
    position: 'absolute',
    left: -18,
    top: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  metroChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  metroChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    maxWidth: '100%',
  },
  sonarFocus: {
    shadowColor: '#E0B35A',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
    elevation: 4,
  },
});
