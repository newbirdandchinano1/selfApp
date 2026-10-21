import { WishBoardDescriptionView } from '@/components/wish-board/wish-board-description-view';
import { WishBoardGapSheet } from '@/components/wish-board/wish-board-gap-sheet';
import { WishBoardRedeemConfirmSheet } from '@/components/wish-board/wish-board-redeem-confirm-sheet';
import {
  formatWishBoxPoints,
  wishBoxTintWash,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { useWishBoardData } from '@/hooks/use-wish-board-data';
import { toast } from '@/lib/app-feedback';
import { resolveWishBoardIconOption } from '@/lib/constants/wish-board-icons';
import { formatSignedMoneyTrunc2 } from '@/lib/finance-net-worth';
import {
  evaluateWishBoardRedeemEligibilitySync,
  type WishBoardRedeemConditionCheck,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import { redeemWishBoardItem } from '@/lib/repositories/wish-board/wish-board';
import type { WishRedeemRecord } from '@/lib/repositories/wish-board/wish-board.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export default function WishBoardDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';

  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const motionOn = motionReady && !reduceMotion;

  const {
    balance,
    items,
    redeemRecords,
    tasks,
    currentNetWorth,
    entityLookups,
    loading,
    loadError,
    reload,
    refreshControl,
    notifyAncestorsDataChanged,
  } = useWishBoardData();

  const item = React.useMemo(() => items.find(i => i.id === id) ?? null, [items, id]);

  const eligibility = React.useMemo(() => {
    if (!item) return null;
    return evaluateWishBoardRedeemEligibilitySync(item, balance, {
      ...entityLookups,
      currentNetWorth,
      allTasks: tasks,
    });
  }, [item, balance, entityLookups, currentNetWorth, tasks]);

  const records = React.useMemo(
    () => redeemRecords.filter(r => r.wish_id === id),
    [redeemRecords, id],
  );

  const icon = resolveWishBoardIconOption(item?.icon_key);
  const isRepeat = item?.wish_type === 'repeat';
  const isRedeemedOnce = item?.wish_type === 'once' && item.status === 'redeemed';
  const canRedeem = Boolean(item && item.status === 'active' && eligibility?.ok);
  const condChecks = eligibility?.checks ?? [];
  const pendingCount = eligibility?.pending.length ?? 0;
  const pointsShortfall = eligibility
    ? Math.max(0, eligibility.costPoints - eligibility.balance)
    : 0;

  const [gapVisible, setGapVisible] = React.useState(false);
  const [confirmVisible, setConfirmVisible] = React.useState(false);
  const [redeeming, setRedeeming] = React.useState(false);

  const onPressCta = () => {
    if (!item || isRedeemedOnce) return;
    if (!canRedeem) {
      setGapVisible(true);
      return;
    }
    setConfirmVisible(true);
  };

  const onConfirmRedeem = async () => {
    if (!item || redeeming) return;
    setRedeeming(true);
    try {
      const result = await redeemWishBoardItem(item.id);
      setConfirmVisible(false);
      notifyAncestorsDataChanged?.();
      router.replace({
        pathname: '/wish-board-redeemed',
        params: {
          title: item.title,
          icon: item.icon_key ?? '',
          cost: String(item.cost_points),
          balance: String(result.balance),
          times: String(records.length + 1),
          type: item.wish_type,
        },
      });
      void reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '兑换失败，请稍后重试');
    } finally {
      setRedeeming(false);
    }
  };

  const onGapAction = (kind: string) => {
    if (kind === 'net_worth') {
      router.push('/(tabs)/finance');
    } else {
      router.push('/(tabs)/tasks');
    }
  };

  const appbar = (
    <View style={styles.appbar}>
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [styles.navBtn, shadows.soft, { opacity: pressed ? 0.88 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel="返回">
        <MaterialIcons name="arrow-back-ios-new" size={16} color={c.ink} />
      </Pressable>
      <Text style={[styles.navTitle, { color: c.ink }]}>心愿详情</Text>
      <Pressable
        onPress={() => item && router.push(`/edit-wish-board-item/${item.id}`)}
        disabled={!item}
        style={({ pressed }) => [
          styles.navBtn,
          shadows.soft,
          { opacity: !item ? 0.4 : pressed ? 0.88 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel="编辑心愿">
        <MaterialIcons name="more-horiz" size={20} color={c.ink2} />
      </Pressable>
    </View>
  );

  if (!item && (loading || !id)) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}> 
        {appbar}
        <View style={styles.centerBox}>
          <Text style={styles.centerText}>加载中…</Text>
        </View>
      </View>
    );
  }

  if (!item) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}>
        {appbar}
        <View style={styles.centerBox}>
          <Text style={styles.centerEmoji}>💭</Text>
          <Text style={styles.centerText}>{loadError ?? '未找到这个心愿，可能已被删除'}</Text>
        </View>
      </View>
    );
  }

  const typeLabel = isRepeat ? '可重复兑换' : '一次性 · 兑换后结束';
  const noteText = buildNoteText({
    item,
    isRepeat,
    isRedeemedOnce,
    eligibility,
    pendingCount,
    pointsShortfall,
    records,
  });
  const ctaLabel = isRedeemedOnce
    ? '已兑换'
    : canRedeem
      ? `立即兑换 · ${formatWishBoxPoints(item.cost_points)} 积分`
      : '暂不可兑换';

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}>
      {appbar}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={refreshControl}>
        {loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}

        <RiseIn animate={motionOn} index={0}>
          <View style={styles.hero}>
            <PopIn animate={motionOn}>
              <View
                style={[
                  styles.heroTile,
                  { backgroundColor: wishBoxTintWash(icon.tint) },
                  shadows.card,
                ]}>
                <Text style={styles.heroEmoji}>{icon.emoji}</Text>
              </View>
            </PopIn>
            <Text style={styles.heroTitle} numberOfLines={2}>
              {item.title}
            </Text>
            <View style={styles.heroTags}>
              <View style={[styles.tag, isRepeat ? styles.tagRep : styles.tagOnce]}>
                <Text style={[styles.tagText, isRepeat ? styles.tagRepText : styles.tagOnceText]}>
                  {typeLabel}
                </Text>
              </View>
              <View style={styles.pts}>
                <Text style={styles.ptsStar}>⭐</Text>
                <Text style={styles.ptsText}>{formatWishBoxPoints(item.cost_points)}</Text>
                {isRepeat ? <Text style={styles.ptsPer}>/ 次</Text> : null}
              </View>
            </View>
          </View>

          {item.description ? (
            <View style={styles.descWrap}>
              <WishBoardDescriptionView
                description={item.description}
                color={c.ink2}
                alignCenter
              />
            </View>
          ) : null}
        </RiseIn>

        {condChecks.length > 0 && eligibility ? (
          <RiseIn animate={motionOn} index={1}>
            <View style={[styles.card, shadows.card, { backgroundColor: c.card, borderColor: c.lineStrong }]}>
              <View style={styles.cardHead}>
                <View style={styles.cardHeadLeft}>
                  <Text style={styles.cardTitle}>🔗 兑换条件</Text>
                  {eligibility.conditionsOk ? (
                    <View style={[styles.stateBadge, styles.badgeOk]}>
                      <Text style={styles.badgeOkText}>全部达成</Text>
                    </View>
                  ) : (
                    <View style={[styles.stateBadge, styles.badgeLock]}>
                      <Text style={styles.badgeLockText}>{pendingCount} 项未达成</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.cardHeadCount}>{condChecks.length} 项</Text>
              </View>
              {condChecks.map(check => (
                <ConditionRow
                  key={`${check.kind}:${check.id}`}
                  check={check}
                  minNetWorth={eligibility.conditions.min_net_worth}
                  currentNetWorth={currentNetWorth}
                  animate={motionOn}
                />
              ))}
            </View>
          </RiseIn>
        ) : null}

        {records.length > 0 ? (
          <RiseIn animate={motionOn} index={2}>
            <View style={[styles.card, shadows.card, { backgroundColor: c.card, borderColor: c.line }]}>
              <View style={styles.cardHead}>
                <Text style={styles.cardTitle}>🕰️ 兑换记录</Text>
                <Pressable
                  onPress={() => router.push('/wish-board-footprints')}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="查看全部兑换记录">
                  <Text style={styles.cardLink}>查看全部 ›</Text>
                </Pressable>
              </View>
              {records.slice(0, 3).map((record, index) => (
                <RecordRow
                  key={record.ledger_id}
                  record={record}
                  times={records.length - index}
                  last={index === Math.min(records.length, 3) - 1}
                />
              ))}
            </View>
          </RiseIn>
        ) : null}

        {noteText ? (
          <RiseIn animate={motionOn} index={3}>
            <Text style={styles.note}>{noteText}</Text>
          </RiseIn>
        ) : null}

        <View style={{ height: 28 }} />
      </ScrollView>

      <View style={[styles.cta, { paddingBottom: Math.max(insets.bottom, 12) + 10, backgroundColor: c.bg }]}>
        <View style={styles.balanceRow}>
          <Text style={styles.balanceText}>
            积分余额 <Text style={styles.balanceStrong}>{formatWishBoxPoints(balance)}</Text>
            {' · '}
            {isRedeemedOnce ? (
              '该心愿已完成兑换'
            ) : canRedeem ? (
              <>
                兑换后剩余{' '}
                <Text style={styles.balanceStrong}>
                  {formatWishBoxPoints(Math.max(0, balance - item.cost_points))}
                </Text>
              </>
            ) : pointsShortfall > 0 ? (
              <>
                还差 <Text style={styles.balanceShort}>{formatWishBoxPoints(pointsShortfall)}</Text>
              </>
            ) : pendingCount > 0 ? (
              <Text style={styles.balanceShort}>{pendingCount} 项条件未达成</Text>
            ) : null}
          </Text>
        </View>

        <CtaPulse animate={motionOn && canRedeem}>
          <Pressable
            onPress={onPressCta}
            disabled={isRedeemedOnce}
            style={({ pressed }) => [
              styles.ctaBtn,
              canRedeem ? shadows.button : null,
              !canRedeem && styles.ctaBtnDisabled,
              { opacity: pressed ? 0.92 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={ctaLabel}>
            {canRedeem ? <CtaGradient /> : null}
            <Text style={[styles.ctaBtnText, !canRedeem && styles.ctaBtnTextDisabled]}>
              {ctaLabel}
            </Text>
          </Pressable>
        </CtaPulse>
      </View>

      {eligibility ? (
        <WishBoardGapSheet
          visible={gapVisible}
          title={item.title}
          eligibility={eligibility}
          currentNetWorth={currentNetWorth}
          onClose={() => setGapVisible(false)}
          onAction={onGapAction}
          onGoTasks={() => router.push('/(tabs)/tasks')}
        />
      ) : null}

      <WishBoardRedeemConfirmSheet
        visible={confirmVisible}
        item={{
          title: item.title,
          wish_type: item.wish_type,
          cost_points: item.cost_points,
          icon_key: item.icon_key,
        }}
        balance={balance}
        redeemCount={records.length}
        confirming={redeeming}
        onClose={() => {
          if (redeeming) return;
          setConfirmVisible(false);
        }}
        onConfirm={() => void onConfirmRedeem()}
      />
    </View>
  );
}

function buildNoteText(input: {
  item: { wish_type: string; status: string; redeemed_at: string | null; cost_points: number };
  isRepeat: boolean;
  isRedeemedOnce: boolean;
  eligibility: { pointsOk: boolean; costPoints: number; balance: number } | null;
  pendingCount: number;
  pointsShortfall: number;
  records: WishRedeemRecord[];
}): string | null {
  const { item, isRepeat, isRedeemedOnce, eligibility, pendingCount, pointsShortfall, records } =
    input;
  if (isRedeemedOnce) {
    const at = records[0]?.redeemed_at ?? item.redeemed_at;
    const when = at ? `${formatChineseDate(at)} ` : '';
    return `✅ 已于 ${when}兑换完成，本次消耗 ${formatWishBoxPoints(item.cost_points)} 积分，足迹已记入「兑换足迹」。`;
  }
  if (eligibility && !eligibility.pointsOk) {
    return `⚠️ 同时积分不足：当前 ${formatWishBoxPoints(eligibility.balance)} 分，兑换需要 ${formatWishBoxPoints(eligibility.costPoints)} 分，还差 ${formatWishBoxPoints(pointsShortfall)} 分。`;
  }
  if (pendingCount > 0) {
    return `⚠️ 还有 ${pendingCount} 项兑换条件未达成，逐项完成后即可解锁「立即兑换」。`;
  }
  if (isRepeat) {
    return '💡 该心愿为「可重复」类型，兑换后保留在清单中，可继续攒积分再次兑换；历史兑换都会记入足迹。';
  }
  return '💡 一次性心愿：兑换后即结束，历史兑换会记入足迹。';
}

function ConditionRow({
  check,
  minNetWorth,
  currentNetWorth,
  animate,
}: {
  check: WishBoardRedeemConditionCheck;
  minNetWorth: number | null;
  currentNetWorth: number;
  animate: boolean;
}) {
  const isNet = check.kind === 'net_worth';
  const { c } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const emoji = isNet ? '💰' : check.kind === 'project' ? '📁' : check.kind === 'todo' ? '📝' : '✅';
  const iconBg = isNet ? c.coinSoft : check.done ? c.mintSoft : c.priSoft;
  const netExcess =
    isNet && minNetWorth != null ? Math.max(0, currentNetWorth - minNetWorth) : 0;
  const netGap = isNet && minNetWorth != null ? Math.max(0, minNetWorth - currentNetWorth) : 0;

  const title = isNet
    ? minNetWorth != null
      ? `净资产 ≥ ${formatMoneyShort(minNetWorth)}`
      : '净资产达到门槛'
    : `完成${kindLabel(check.kind)}「${check.title}」`;

  const stateText = check.done
    ? '✓ 已达成'
    : isNet
      ? minNetWorth != null && netGap > 0
        ? `! 还差 ${formatMoneyShort(netGap)}`
        : '! 未达成'
      : check.missing
        ? '! 关联项已删除'
        : '! 未完成';

  const meta = isNet
    ? currentNetWorth != null && minNetWorth != null
      ? check.done
        ? `当前净资产 ${formatMoneyShort(currentNetWorth)} · 超出 ${formatMoneyShort(netExcess)}`
        : `当前净资产 ${formatMoneyShort(currentNetWorth)}`
      : '净资产同步后判定'
    : check.progress
      ? `${check.progress.done} / ${check.progress.total} 项 · ${
          check.progress.done >= check.progress.total
            ? check.kind === 'project'
              ? '绑定待办全部完成'
              : '已完成'
            : `还差 ${Math.max(0, check.progress.total - check.progress.done)} 项子任务`
        }`
      : check.missing
        ? '关联项已删除，请在编辑中重新绑定'
        : '尚未完成';

  const ratio = check.progress
    ? Math.max(0, Math.min(1, check.progress.done / check.progress.total))
    : 0;

  return (
    <View style={styles.cond}>
      <View style={[styles.cicon, { backgroundColor: iconBg }]}>
        <Text style={styles.ciconEmoji}>{emoji}</Text>
      </View>
      <View style={styles.condBody}>
        <View style={styles.condHead}>
          <Text style={styles.condTitle} numberOfLines={2}>
            {title}
          </Text>
          <Text style={[styles.stateText, check.done ? styles.stateOk : styles.stateNo]}>
            {stateText}
          </Text>
        </View>
        {check.progress ? (
          <ConditionBar ratio={ratio} mint={check.done} animate={animate} />
        ) : null}
        <Text style={styles.condMeta}>{meta}</Text>
      </View>
    </View>
  );
}

function kindLabel(kind: WishBoardRedeemConditionCheck['kind']): string {
  if (kind === 'project') return '项目';
  if (kind === 'todo') return '待办';
  return '任务';
}

function ConditionBar({
  ratio,
  mint,
  animate,
}: {
  ratio: number;
  mint: boolean;
  animate: boolean;
}) {
  const styles = useWishStyles(makeStyles);
  const [grow] = React.useState(() => new Animated.Value(animate ? 0 : 1));

  React.useEffect(() => {
    if (!animate) {
      grow.setValue(1);
      return;
    }
    grow.setValue(0);
    const anim = Animated.timing(grow, {
      toValue: 1,
      duration: 850,
      delay: 320,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animate, grow]);

  const width = grow.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', `${Math.round(ratio * 100)}%`],
  });

  return (
    <View style={styles.bar}>
      <Animated.View style={[styles.barFill, { width }]}>
        <BarFill mint={mint} />
      </Animated.View>
    </View>
  );
}

function BarFill({ mint }: { mint: boolean }) {
  const rawId = React.useId();
  const { gradients } = useWishBoxTheme();
  const gradientId = `wishCond${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const stops = mint ? gradients.barMint : gradients.barWarm;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={stops[0]} />
          <Stop offset="1" stopColor={stops[1]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={99} fill={`url(#${gradientId})`} />
    </Svg>
  );
}

function RecordRow({
  record,
  times,
  last,
}: {
  record: WishRedeemRecord;
  times: number;
  last: boolean;
}) {
  const styles = useWishStyles(makeStyles);
  return (
    <View style={[styles.recordRow, !last && styles.recordRowDivided]}>
      <Text style={styles.recordEmoji}>🎉</Text>
      <Text style={styles.recordText} numberOfLines={1}>
        {formatChineseDate(record.redeemed_at)} · 消耗{' '}
        <Text style={styles.recordStrong}>{formatWishBoxPoints(record.cost_points)}</Text> 积分
      </Text>
      <View style={styles.recordTag}>
        <Text style={styles.recordTagText}>
          {record.wish_type === 'repeat' ? `第 ${Math.max(1, times)} 次` : '已结束'}
        </Text>
      </View>
    </View>
  );
}

/** 卡片/正文级联入场（设计稿 riseIn 460ms，55ms 间隔） */
function RiseIn({
  animate,
  index,
  children,
}: {
  animate: boolean;
  index: number;
  children: React.ReactNode;
}) {
  const [value] = React.useState(() => new Animated.Value(animate ? 0 : 1));

  React.useEffect(() => {
    if (!animate) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const anim = Animated.timing(value, {
      toValue: 1,
      duration: 460,
      delay: index * 55 + 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animate, index, value]);

  const translateY = value.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View style={{ opacity: value, transform: [{ translateY }] }}>
      {children}
    </Animated.View>
  );
}

/** 详情大图标 pop（设计稿 popIn 550ms：.86 → 1.04 → 1） */
function PopIn({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const [value] = React.useState(() => new Animated.Value(animate ? 0 : 1));

  React.useEffect(() => {
    if (!animate) {
      value.setValue(1);
      return;
    }
    value.setValue(0);
    const anim = Animated.timing(value, {
      toValue: 1,
      duration: 550,
      delay: 80,
      easing: Easing.out(Easing.back(1.6)),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animate, value]);

  const scale = value.interpolate({ inputRange: [0, 1], outputRange: [0.86, 1] });

  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

/** 主 CTA 呼吸（设计稿 pulse 2.8s：1 → 1.02） */
function CtaPulse({ animate, children }: { animate: boolean; children: React.ReactNode }) {
  const [value] = React.useState(() => new Animated.Value(0));

  React.useEffect(() => {
    if (!animate) {
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: 1400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      value.setValue(0);
    };
  }, [animate, value]);

  const scale = value.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] });

  return <Animated.View style={{ transform: [{ scale }] }}>{children}</Animated.View>;
}

/** 兑换按钮渐变底（设计稿 135° #FF8A5B → #EF5F38） */
function CtaGradient() {
  const rawId = React.useId();
  const { gradients } = useWishBoxTheme();
  const gradientId = `wishCta${rawId.replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={gradients.avatar[0]} />
          <Stop offset="1" stopColor={gradients.avatar[1]} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" rx={17} fill={`url(#${gradientId})`} />
    </Svg>
  );
}

/** 金额展示：整数去掉 .00（设计稿「¥8,600」） */
function formatMoneyShort(value: number): string {
  const text = formatSignedMoneyTrunc2(value);
  return text.endsWith('.00') ? text.slice(0, -3) : text;
}

/** 设计稿「10 月 6 日」；跨年补年份 */
function formatChineseDate(raw: string): string {
  const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return raw;
  const prefix = d.getFullYear() === new Date().getFullYear() ? '' : `${d.getFullYear()} 年 `;
  return `${prefix}${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

function makeStyles(c: WishBoxPalette, shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.bg,
  },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 2,
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: c.ink,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 32,
  },
  centerEmoji: {
    fontSize: 40,
  },
  centerText: {
    fontSize: 13.5,
    color: c.muted,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorText: {
    marginHorizontal: 20,
    marginTop: 4,
    fontSize: 12,
    color: c.danger,
    fontWeight: '600',
  },
  hero: {
    marginTop: 6,
    paddingTop: 14,
    paddingBottom: 2,
    alignItems: 'center',
  },
  heroTile: {
    width: 104,
    height: 104,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroEmoji: {
    fontSize: 56,
  },
  heroTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: c.ink,
    marginTop: 14,
    letterSpacing: 0.5,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
  heroTags: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
  },
  tag: {
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  tagRep: {
    backgroundColor: c.mintSoft,
  },
  tagOnce: {
    backgroundColor: c.amberSoft,
  },
  tagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  tagRepText: {
    color: c.mint,
  },
  tagOnceText: {
    color: c.once,
  },
  pts: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: c.coinSoft,
    borderRadius: 99,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  ptsStar: {
    fontSize: 12,
  },
  ptsText: {
    fontSize: 13,
    fontWeight: '800',
    color: c.coin,
    fontVariant: ['tabular-nums'],
  },
  ptsPer: {
    fontSize: 11,
    fontWeight: '700',
    color: c.coin,
  },
  descWrap: {
    paddingHorizontal: 22,
    marginTop: 12,
  },
  card: {
    marginHorizontal: 16,
    marginTop: 16,
    padding: 16,
    borderRadius: 22,
    backgroundColor: c.card,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardHeadLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    minWidth: 0,
  },
  cardTitle: {
    fontSize: 14.5,
    fontWeight: '800',
    color: c.ink,
  },
  cardHeadCount: {
    fontSize: 11.5,
    color: c.muted,
    fontWeight: '600',
  },
  cardLink: {
    fontSize: 11.5,
    fontWeight: '800',
    color: c.pri,
  },
  stateBadge: {
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  badgeOk: {
    backgroundColor: c.mintSoft,
  },
  badgeOkText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.mint,
  },
  badgeLock: {
    backgroundColor: c.graySoft,
  },
  badgeLockText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.muted,
  },
  cond: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: c.wash,
    borderWidth: 1,
    borderColor: c.washLine,
    marginTop: 10,
  },
  cicon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ciconEmoji: {
    fontSize: 19,
  },
  condBody: {
    flex: 1,
    minWidth: 0,
  },
  condHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  condTitle: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '800',
    color: c.ink,
    lineHeight: 19,
  },
  stateText: {
    fontSize: 12.5,
    fontWeight: '800',
    flexShrink: 0,
    marginTop: 1,
  },
  stateOk: {
    color: c.mint,
  },
  stateNo: {
    color: c.pri,
  },
  bar: {
    height: 6,
    borderRadius: 99,
    backgroundColor: c.progressTrack,
    overflow: 'hidden',
    marginTop: 8,
  },
  barFill: {
    height: '100%',
    borderRadius: 99,
    overflow: 'hidden',
  },
  condMeta: {
    fontSize: 11,
    color: c.muted,
    marginTop: 6,
    fontWeight: '600',
  },
  recordRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
  },
  recordRowDivided: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: c.divider,
    borderStyle: 'dashed',
  },
  recordEmoji: {
    fontSize: 13,
  },
  recordText: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    color: c.ink2,
    fontWeight: '600',
  },
  recordStrong: {
    fontWeight: '800',
    color: c.ink2,
    fontVariant: ['tabular-nums'],
  },
  recordTag: {
    borderRadius: 99,
    paddingHorizontal: 9,
    paddingVertical: 3,
    backgroundColor: c.mintSoft,
  },
  recordTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: c.mint,
  },
  note: {
    fontSize: 11.5,
    color: c.muted,
    lineHeight: 19,
    marginHorizontal: 22,
    marginTop: 12,
    fontWeight: '600',
  },
  cta: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: c.bg,
  },
  balanceRow: {
    paddingHorizontal: 2,
    paddingBottom: 10,
  },
  balanceText: {
    fontSize: 12.5,
    color: c.muted,
    fontWeight: '600',
  },
  balanceStrong: {
    color: c.ink,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  balanceShort: {
    color: c.pri,
    fontSize: 15,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  ctaBtn: {
    height: 52,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: c.pri,
    overflow: 'hidden',
  },
  ctaBtnDisabled: {
    backgroundColor: c.disabledBg,
  },
  ctaBtnText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  ctaBtnTextDisabled: {
    color: c.disabledText,
  },
  });
}
