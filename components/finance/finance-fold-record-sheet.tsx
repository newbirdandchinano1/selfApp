/**
 * 折页 · 记一笔 / 相册识图 — 对齐 `finance-screens/财务APP-设计稿.html` 03·04
 * 弹层上滑 380ms spring · 扫描线 2.1s · 置信度 chip 先亮后稳 · FAB 呼吸/扫光
 */
import {
  FOLD_MOTION_EASE,
  FOLD_MOTION_SPRING,
  FoldPopIn,
  FoldRiseIn,
  useFoldMotionGate,
} from '@/components/review/fold-motion';
import {
  financeFoldFonts,
  type FinanceFoldPalette,
} from '@/constants/finance-fold-theme';
import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

export type FinanceFoldSheetTab = 'sentence' | 'expense' | 'income' | 'transfer';

/** 设计稿 `.scan-preview` 高度；扫描行程对齐 `@keyframes scanMove` 的 17% → 79% */
const SCAN_PREVIEW_H = 214;
const SCAN_Y_TOP = Math.round(SCAN_PREVIEW_H * 0.17);
const SCAN_Y_BOTTOM = Math.round(SCAN_PREVIEW_H * 0.79);

const TAB_LABELS: { key: FinanceFoldSheetTab; label: string }[] = [
  { key: 'sentence', label: '一句话' },
  { key: 'expense', label: '支出' },
  { key: 'income', label: '收入' },
  { key: 'transfer', label: '转账' },
];

/** 遮罩淡入 280ms + 弹层弹簧上滑 380ms */
export function FinanceFoldSheetChrome({
  ff,
  isDark,
  paddingBottom,
  maxHeight,
  marginBottom,
  onClose,
  children,
  style,
}: {
  ff: FinanceFoldPalette;
  isDark: boolean;
  paddingBottom: number;
  maxHeight: number;
  marginBottom: number;
  onClose: () => void;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { animate } = useFoldMotionGate();
  const scrim = React.useRef(new Animated.Value(animate ? 0 : 1)).current;
  const sheetY = React.useRef(new Animated.Value(animate ? 1 : 0)).current;

  React.useEffect(() => {
    if (!animate) {
      scrim.setValue(1);
      sheetY.setValue(0);
      return;
    }
    scrim.setValue(0);
    sheetY.setValue(1);
    const anim = Animated.parallel([
      Animated.timing(scrim, {
        toValue: 1,
        duration: 280,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
      Animated.timing(sheetY, {
        toValue: 0,
        duration: 380,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [animate, scrim, sheetY]);

  const translateY = sheetY.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 420],
  });

  return (
    <View style={styles.overlay}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: isDark ? 'rgba(12,22,18,0.55)' : 'rgba(23,34,28,0.38)',
            opacity: scrim,
          },
        ]}
      />
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="关闭" />
      <Animated.View
        style={[
          styles.sheet,
          {
            // 夜间 ff.card 为半透明；弹层需实色底，避免透出底层页面
            backgroundColor: isDark ? ff.paper2 : ff.card,
            borderTopColor: ff.line,
            paddingBottom,
            maxHeight,
            marginBottom,
            transform: [{ translateY }],
            shadowColor: ff.shadow,
          },
          style,
        ]}>
        <View
          pointerEvents="none"
          style={[
            styles.sheetWash,
            {
              backgroundColor: isDark
                ? 'rgba(244,228,200,0.04)'
                : 'rgba(244,228,200,0.17)',
            },
          ]}
        />
        <View style={[styles.handle, { backgroundColor: ff.line2 }]} />
        {children}
      </Animated.View>
    </View>
  );
}

export function FinanceFoldSheetHead({
  ff,
  fonts = financeFoldFonts,
  title,
  subtitle,
  onClose,
  trailing,
}: {
  ff: FinanceFoldPalette;
  fonts?: typeof financeFoldFonts;
  title: string;
  subtitle: string;
  onClose: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <View style={styles.head}>
      <View style={styles.headCopy}>
        <Text style={[styles.headTitle, { color: ff.pine, fontFamily: fonts.serif }]}>{title}</Text>
        <Text style={[styles.headSub, { color: ff.muted }]}>{subtitle}</Text>
      </View>
      {trailing ?? (
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="关闭"
          style={({ pressed }) => [
            styles.closeBtn,
            { backgroundColor: isSoftPaper(ff), opacity: pressed ? 0.8 : 1 },
          ]}>
          <MaterialIcons name="close" size={18} color={ff.muted} />
        </Pressable>
      )}
    </View>
  );
}

export function FinanceFoldSegment({
  ff,
  active,
  onChange,
  transferLabel = '转账',
}: {
  ff: FinanceFoldPalette;
  active: FinanceFoldSheetTab;
  onChange: (tab: FinanceFoldSheetTab) => void;
  transferLabel?: string;
}) {
  return (
    <View style={[styles.segment, { backgroundColor: softTrack(ff), borderColor: ff.line }]}>
      {TAB_LABELS.map((tab) => {
        const on = active === tab.key;
        const label = tab.key === 'transfer' ? transferLabel : tab.label;
        return (
          <Pressable
            key={tab.key}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [
              styles.segmentBtn,
              on && {
                backgroundColor: ff.card,
                shadowColor: ff.shadow,
                shadowOpacity: 0.08,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 2 },
                elevation: 2,
              },
              pressed && { opacity: 0.88 },
            ]}>
            <Text
              style={[styles.segmentText, { color: on ? ff.pine : ff.muted, fontWeight: on ? '800' : '600' }]}
              numberOfLines={1}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export type FinanceFoldParsePill = {
  key: string;
  label: string;
  emphasize?: boolean;
  amber?: boolean;
};

export function FinanceFoldPhrasePanel({
  ff,
  fonts = financeFoldFonts,
  sentence,
  onChangeSentence,
  pills,
  aiLine,
  includeInBudget,
  onToggleBudget,
  budgetDetail,
  canSave,
  isSaving,
  onPreview,
  isPreviewBusy,
  onConfirm,
  onOpenAlbum,
  quickTags,
  onQuickTag,
}: {
  ff: FinanceFoldPalette;
  fonts?: typeof financeFoldFonts;
  sentence: string;
  onChangeSentence: (v: string) => void;
  pills: FinanceFoldParsePill[];
  aiLine: string;
  includeInBudget: boolean;
  onToggleBudget: () => void;
  budgetDetail: string;
  canSave: boolean;
  isSaving: boolean;
  onPreview: () => void;
  isPreviewBusy: boolean;
  onConfirm: () => void;
  onOpenAlbum: () => void;
  quickTags?: string[];
  onQuickTag?: (tag: string) => void;
}) {
  const { animate } = useFoldMotionGate();
  return (
    <View style={styles.phrasePanel}>
      <View style={[styles.phraseBox, { backgroundColor: softField(ff), borderColor: ff.line2 }]}>
        <View style={[styles.mic, { backgroundColor: ff.pine, shadowColor: ff.shadow }]}>
          <MaterialIcons name="mic" size={16} color={ff.onPine} />
        </View>
        <TextInput
          value={sentence}
          onChangeText={onChangeSentence}
          multiline
          style={[styles.phraseInput, { color: ff.ink }]}
          placeholder="午饭 42，招商银行，餐饮"
          placeholderTextColor={ff.faint}
          textAlignVertical="top"
        />
        <Pressable
          onPress={onOpenAlbum}
          accessibilityRole="button"
          accessibilityLabel="相册识图"
          style={({ pressed }) => [{ padding: 4, opacity: pressed ? 0.7 : 1 }]}>
          <MaterialIcons name="document-scanner" size={20} color={ff.faint} />
        </Pressable>
      </View>

      {pills.length ? (
        <View style={styles.parseRow}>
          {pills.map((p, i) => (
            <FoldPopIn key={p.key} animate={animate} index={i} staggerMs={45} delayMs={40} duration={360}>
              <View
                style={[
                  styles.parsePill,
                  p.amber
                    ? { backgroundColor: ff.amber2, borderColor: '#ECD8B8' }
                    : { backgroundColor: softSage(ff), borderColor: '#D7E4D9' },
                ]}>
                <Text
                  style={[
                    styles.parsePillText,
                    { color: p.amber ? ff.amberInk : '#4B6758' },
                    p.emphasize && { fontFamily: fonts.mono, fontWeight: '700' },
                  ]}>
                  {p.label}
                </Text>
              </View>
            </FoldPopIn>
          ))}
        </View>
      ) : null}

      <View style={styles.aiLine}>
        <MaterialIcons name="auto-awesome" size={14} color={ff.amber} />
        <Text style={[styles.aiLineText, { color: ff.muted }]} numberOfLines={2}>
          {aiLine}
        </Text>
      </View>

      {quickTags?.length && onQuickTag ? (
        <View style={styles.quickTags}>
          {quickTags.map((tag) => (
            <Pressable
              key={tag}
              onPress={() => onQuickTag(tag)}
              style={({ pressed }) => [
                styles.quickTag,
                { backgroundColor: softTrack(ff), borderColor: ff.line, opacity: pressed ? 0.8 : 1 },
              ]}>
              <Text style={[styles.quickTagText, { color: ff.muted }]}>＋ {tag}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <FinanceFoldScanEntry ff={ff} onPress={onOpenAlbum} />

      <View style={styles.fieldGrid}>
        <Pressable
          onPress={onToggleBudget}
          style={[styles.field, { backgroundColor: softField(ff), borderColor: ff.line }]}>
          <Text style={[styles.fieldLabel, { color: ff.faint }]}>计入预算</Text>
          <Text style={[styles.fieldValue, { color: ff.ink2 }]}>
            {includeInBudget ? `是 · ${budgetDetail}` : '否 · 不占预算'}
          </Text>
        </Pressable>
        <View style={[styles.field, { backgroundColor: softField(ff), borderColor: ff.line }]}>
          <Text style={[styles.fieldLabel, { color: ff.faint }]}>重复</Text>
          <Text style={[styles.fieldValue, { color: ff.ink2 }]}>不重复</Text>
        </View>
      </View>

      <View style={styles.actions}>
        <Pressable
          onPress={onPreview}
          disabled={!canSave || isPreviewBusy}
          style={({ pressed }) => [
            styles.ghostBtn,
            {
              backgroundColor: softTrack(ff),
              borderColor: ff.line,
              opacity: !canSave ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}>
          {isPreviewBusy ? (
            <ActivityIndicator size="small" color={ff.pine} />
          ) : (
            <MaterialIcons name="auto-awesome" size={20} color={ff.pine} />
          )}
        </Pressable>
        <Pressable
          onPress={onConfirm}
          disabled={!canSave || isSaving}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: canSave ? ff.pine : ff.faint,
              opacity: pressed && canSave ? 0.9 : 1,
            },
          ]}>
          {isSaving ? (
            <ActivityIndicator color={ff.onPine} />
          ) : (
            <>
              <MaterialIcons name="check" size={18} color={ff.onPine} />
              <Text style={[styles.primaryBtnText, { color: ff.onPine }]}>确认记账</Text>
            </>
          )}
        </Pressable>
      </View>
      <Text style={[styles.tip, { color: ff.faint }]}>确认后可在首页流水点击修改 · 支持撤销</Text>
    </View>
  );
}

export function FinanceFoldScanEntry({
  ff,
  onPress,
}: {
  ff: FinanceFoldPalette;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="相册识图自动记账"
      style={({ pressed }) => [
        styles.scanEntry,
        {
          backgroundColor: softTrack(ff),
          borderColor: ff.line,
          opacity: pressed ? 0.88 : 1,
        },
      ]}>
      <View style={[styles.scanEntryIcon, { backgroundColor: softSage(ff) }]}>
        <MaterialIcons name="image" size={18} color={ff.pine3} />
      </View>
      <View style={styles.scanEntryCopy}>
        <Text style={[styles.scanEntryTitle, { color: ff.ink }]}>相册识图自动记账</Text>
        <Text style={[styles.scanEntrySub, { color: ff.faint }]}>
          识别微信 / 支付宝截图、小票或支付凭证
        </Text>
      </View>
      <MaterialIcons name="chevron-right" size={20} color={ff.faint} />
    </Pressable>
  );
}

export type FinanceAlbumScanResult = {
  transaction_type: 'expense' | 'income';
  amount: number;
  name: string;
  categoryLabel: string;
  accountName: string;
  happenedLabel: string;
  confidenceLabel?: string;
  dedupeLabel?: string;
};

export function FinanceFoldAlbumScanPanel({
  ff,
  fonts = financeFoldFonts,
  imageUri,
  scanning,
  result,
  error,
  includeInBudget,
  onToggleBudget,
  onConfirm,
  onCorrect,
  onClose,
  confirming,
}: {
  ff: FinanceFoldPalette;
  fonts?: typeof financeFoldFonts;
  imageUri: string | null;
  scanning: boolean;
  result: FinanceAlbumScanResult | null;
  error: string | null;
  includeInBudget: boolean;
  onToggleBudget: () => void;
  onConfirm: () => void;
  onCorrect: () => void;
  onClose: () => void;
  confirming: boolean;
}) {
  const { animate, motionReduced } = useFoldMotionGate();
  const scanAnim = React.useRef(new Animated.Value(0)).current;
  const confidencePulse = React.useRef(new Animated.Value(0.55)).current;
  const scanGradId = React.useId().replace(/[^a-zA-Z0-9]/g, '');

  React.useEffect(() => {
    if (!scanning || motionReduced) {
      scanAnim.stopAnimation();
      scanAnim.setValue(0);
      return;
    }
    scanAnim.setValue(0);
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: 1050,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: 1050,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [motionReduced, scanAnim, scanning]);

  React.useEffect(() => {
    if (!result || motionReduced) {
      confidencePulse.setValue(1);
      return;
    }
    confidencePulse.setValue(0.45);
    const anim = Animated.sequence([
      Animated.timing(confidencePulse, {
        toValue: 1.08,
        duration: 320,
        easing: FOLD_MOTION_SPRING,
        useNativeDriver: true,
      }),
      Animated.timing(confidencePulse, {
        toValue: 1,
        duration: 220,
        easing: FOLD_MOTION_EASE,
        useNativeDriver: true,
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [confidencePulse, motionReduced, result]);

  const scanY = scanAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCAN_Y_TOP, SCAN_Y_BOTTOM],
  });
  const scanLineOpacity = scanAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [0.45, 1, 0.45],
  });

  return (
    <View style={styles.albumPanel}>
      <FinanceFoldSheetHead
        ff={ff}
        fonts={fonts}
        title={scanning ? '正在读这张支付截图' : result ? '识图结果' : '相册识图'}
        subtitle={
          scanning
            ? '识别与匹配在本机完成，图片不会上传。'
            : result
              ? '核对后确认入账，也可修正字段。'
              : '从截图里找回一笔生活'
        }
        onClose={onClose}
        trailing={
          scanning ? (
            <View style={[styles.localTag, { backgroundColor: softSage(ff) }]}>
              <Text style={[styles.localTagText, { color: ff.pine }]}>本地 AI</Text>
            </View>
          ) : undefined
        }
      />

      <View
        style={[
          styles.scanPreview,
          {
            backgroundColor: isDarkPreview(ff),
            borderColor: ff.line2,
          },
        ]}>
        {imageUri ? (
          <Image source={{ uri: imageUri }} style={styles.scanImage} resizeMode="cover" />
        ) : (
          <View style={styles.scanPlaceholderWrap}>
            <View style={[styles.scanSheetCard, { backgroundColor: ff.card, borderColor: ff.line2 }]}>
              <Text style={[styles.payFrom, { color: ff.faint }]}>微信支付 · 付款成功</Text>
              <Text style={[styles.payAmt, { color: ff.ink, fontFamily: fonts.mono }]}>¥—.——</Text>
              <Text style={[styles.payTo, { color: ff.ink2 }]}>等待选择截图</Text>
            </View>
          </View>
        )}
        {result ? (
          <Animated.View
            style={[
              styles.confidence,
              {
                backgroundColor: 'rgba(29,64,52,0.85)',
                opacity: confidencePulse,
                transform: [{ scale: confidencePulse }],
              },
            ]}>
            <MaterialIcons name="auto-awesome" size={10} color={ff.amber} />
            <Text style={[styles.confidenceText, { fontFamily: fonts.mono }]}>
              {result.confidenceLabel ?? '置信度 高'}
            </Text>
          </Animated.View>
        ) : null}
        {scanning ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.scanLine,
              {
                opacity: scanLineOpacity,
                transform: [{ translateY: scanY }],
              },
            ]}>
            {/* 仅细线：左右透明渐变，无色块辉光底 */}
            <Svg width="100%" height={2} style={styles.scanLineSvg}>
              <Defs>
                <LinearGradient id={`scanLine${scanGradId}`} x1="0" y1="0" x2="1" y2="0">
                  <Stop offset="0" stopColor={ff.amber} stopOpacity="0" />
                  <Stop offset="0.22" stopColor={ff.amber} stopOpacity="0.55" />
                  <Stop offset="0.5" stopColor={ff.amber} stopOpacity="1" />
                  <Stop offset="0.78" stopColor={ff.amber} stopOpacity="0.55" />
                  <Stop offset="1" stopColor={ff.amber} stopOpacity="0" />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="2" fill={`url(#scanLine${scanGradId})`} />
            </Svg>
            <View style={[styles.scanBadge, { backgroundColor: ff.amber2 }]}>
              <Text style={[styles.scanBadgeText, { color: ff.amberInk, fontFamily: fonts.mono }]}>
                SCANNING
              </Text>
            </View>
          </Animated.View>
        ) : null}
      </View>

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: ff.clay2, borderColor: ff.clay }]}>
          <Text style={[styles.errorText, { color: ff.clayInk }]}>{error}</Text>
        </View>
      ) : null}

      {result ? (
        <FoldRiseIn animate={animate} index={0} fromY={10}>
          <View style={[styles.recognized, { backgroundColor: softSage(ff), borderColor: '#DCE7DE' }]}>
            <View style={styles.recognizedHead}>
              <MaterialIcons name="check-circle" size={16} color={ff.pine} />
              <Text style={[styles.recognizedTitle, { color: ff.pine }]}>
                已识别 1 笔{result.transaction_type === 'income' ? '收入' : '支出'}
              </Text>
              <View style={[styles.localTag, { backgroundColor: softSage(ff), marginLeft: 'auto' }]}>
                <Text style={[styles.localTagText, { color: ff.pine }]}>高置信</Text>
              </View>
            </View>
            <View style={styles.rgrid}>
              {[
                { k: '商户 / 标题', v: result.name },
                { k: '分类', v: result.categoryLabel },
                { k: '账户', v: result.accountName },
              ].map((cell, i) => (
                <FoldPopIn key={cell.k} animate={animate} index={i} staggerMs={50} delayMs={80}>
                  <View style={[styles.rg, { backgroundColor: 'rgba(255,252,245,0.55)' }]}>
                    <Text style={[styles.rgLabel, { color: ff.faint }]}>{cell.k}</Text>
                    <Text style={[styles.rgValue, { color: ff.ink2 }]} numberOfLines={1}>
                      {cell.v}
                    </Text>
                  </View>
                </FoldPopIn>
              ))}
            </View>
          </View>
        </FoldRiseIn>
      ) : null}

      {result ? (
        <>
          <View style={[styles.formRow, { borderBottomColor: ff.line }]}>
            <Text style={[styles.formLabel, { color: ff.muted }]}>计入本月预算</Text>
            <Switch
              value={includeInBudget}
              onValueChange={onToggleBudget}
              trackColor={{ false: ff.line2, true: ff.pine }}
              thumbColor={ff.card}
            />
          </View>
          <View style={styles.fieldGrid}>
            <View style={[styles.field, { backgroundColor: softField(ff), borderColor: ff.line }]}>
              <Text style={[styles.fieldLabel, { color: ff.faint }]}>发生时间</Text>
              <Text style={[styles.fieldValue, { color: ff.ink2 }]}>{result.happenedLabel}</Text>
            </View>
            <View style={[styles.field, { backgroundColor: softField(ff), borderColor: ff.line }]}>
              <Text style={[styles.fieldLabel, { color: ff.faint }]}>自动去重</Text>
              <Text style={[styles.fieldValue, { color: ff.ink2 }]}>
                {result.dedupeLabel ?? '未发现重复'}
              </Text>
            </View>
          </View>
          <View style={styles.ctaRow}>
            <Pressable
              onPress={onCorrect}
              style={({ pressed }) => [
                styles.correctBtn,
                {
                  backgroundColor: softTrack(ff),
                  borderColor: ff.line,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}>
              <Text style={[styles.correctBtnText, { color: ff.pine }]}>修正字段</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={confirming}
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: ff.pine, flex: 1, opacity: pressed ? 0.9 : 1 },
              ]}>
              {confirming ? (
                <ActivityIndicator color={ff.onPine} />
              ) : (
                <Text style={[styles.primaryBtnText, { color: ff.onPine }]}>确认入账</Text>
              )}
            </Pressable>
          </View>
          <Text style={[styles.tip, { color: ff.faint }]}>支持连续识别多张截图 · 可一次入账多笔</Text>
        </>
      ) : null}

      {scanning ? (
        <Text style={[styles.tip, { color: ff.muted, marginTop: 12 }]}>正在识别金额、商户与账户…</Text>
      ) : null}
    </View>
  );
}

export type FinanceFoldCategoryChip = {
  key: string;
  label: string;
  isCustom?: boolean;
};

/** 设计稿 amount-input：居中大额 + 闪烁光标 */
export function FinanceFoldAmountInput({
  ff,
  fonts = financeFoldFonts,
  amountDisplay,
  tone = 'expense',
  focused = true,
  onPress,
}: {
  ff: FinanceFoldPalette;
  fonts?: typeof financeFoldFonts;
  amountDisplay: string;
  tone?: 'expense' | 'income' | 'transfer';
  focused?: boolean;
  onPress?: () => void;
}) {
  const { animate, motionReduced } = useFoldMotionGate();
  const blink = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    if (!focused || !animate || motionReduced) {
      blink.setValue(focused ? 1 : 0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 500, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, blink, focused, motionReduced]);

  const numColor = tone === 'income' ? ff.income : ff.pine;
  return (
    <Pressable onPress={onPress} style={styles.amountInput}>
      <Text style={[styles.amountCur, { color: ff.amberInk, fontFamily: fonts.mono }]}>¥</Text>
      <Text style={[styles.amountNum, { color: numColor, fontFamily: fonts.mono }]}>{amountDisplay}</Text>
      {focused ? (
        <Animated.View style={[styles.amountCursor, { backgroundColor: ff.pine, opacity: blink }]} />
      ) : null}
    </Pressable>
  );
}

/** 设计稿 quick-tags：分类 chip；超出默认 4 个可展开，并保留自定义增删 */
export function FinanceFoldCategoryTags({
  ff,
  categories,
  selectedKey,
  onSelectKey,
  onAddPress,
  onLongPressCustom,
  collapsedCount = 4,
}: {
  ff: FinanceFoldPalette;
  categories: FinanceFoldCategoryChip[];
  selectedKey: string;
  onSelectKey: (key: string) => void;
  onAddPress?: () => void;
  onLongPressCustom?: (item: FinanceFoldCategoryChip) => void;
  collapsedCount?: number;
}) {
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    setExpanded(false);
  }, [categories.length]);

  const needsCollapse = categories.length > collapsedCount;
  const visible = React.useMemo(() => {
    if (!needsCollapse || expanded) return categories;
    const first = categories.slice(0, collapsedCount);
    if (first.some((c) => c.key === selectedKey)) return first;
    const selected = categories.find((c) => c.key === selectedKey);
    if (!selected) return first;
    return [...first.slice(0, collapsedCount - 1), selected];
  }, [categories, collapsedCount, expanded, needsCollapse, selectedKey]);

  return (
    <View style={styles.categoryTags}>
      {visible.map((item) => {
        const on = item.key === selectedKey;
        return (
          <Pressable
            key={item.key}
            onPress={() => onSelectKey(item.key)}
            onLongPress={
              item.isCustom && onLongPressCustom ? () => onLongPressCustom(item) : undefined
            }
            delayLongPress={400}
            style={({ pressed }) => [
              styles.categoryTag,
              on
                ? { backgroundColor: softSage(ff), borderColor: '#A9C2B3' }
                : { backgroundColor: softTrack(ff), borderColor: ff.line },
              pressed && { opacity: 0.85 },
            ]}>
            <Text style={[styles.categoryTagText, { color: on ? ff.pine : ff.muted, fontWeight: on ? '700' : '600' }]}>
              {item.label}
            </Text>
          </Pressable>
        );
      })}
      {needsCollapse ? (
        <Pressable
          onPress={() => setExpanded((v) => !v)}
          style={({ pressed }) => [
            styles.categoryTag,
            { backgroundColor: softTrack(ff), borderColor: ff.line, opacity: pressed ? 0.85 : 1 },
          ]}>
          <Text style={[styles.categoryTagText, { color: ff.pine }]}>{expanded ? '收起' : '更多'}</Text>
        </Pressable>
      ) : null}
      {onAddPress && (!needsCollapse || expanded) ? (
        <Pressable
          onPress={onAddPress}
          style={({ pressed }) => [
            styles.categoryTag,
            {
              backgroundColor: softTrack(ff),
              borderColor: ff.line,
              borderStyle: 'dashed',
              opacity: pressed ? 0.85 : 1,
            },
          ]}>
          <Text style={[styles.categoryTagText, { color: ff.pine }]}>＋ 自定义</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function FinanceFoldFieldCell({
  ff,
  label,
  value,
  wide,
  onPress,
  editable,
  placeholder,
  onChangeText,
}: {
  ff: FinanceFoldPalette;
  label: string;
  value: string;
  wide?: boolean;
  onPress?: () => void;
  editable?: boolean;
  placeholder?: string;
  onChangeText?: (v: string) => void;
}) {
  const body = (
    <>
      <Text style={[styles.fieldLabel, { color: ff.faint }]}>{label}</Text>
      {editable ? (
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={ff.faint}
          style={[styles.fieldValueInput, { color: ff.ink2 }]}
        />
      ) : (
        <Text style={[styles.fieldValue, { color: ff.ink2 }]} numberOfLines={1}>
          {value || placeholder || '—'}
        </Text>
      )}
    </>
  );
  if (onPress && !editable) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.field,
          wide && styles.fieldWide,
          { backgroundColor: softField(ff), borderColor: ff.line, opacity: pressed ? 0.88 : 1 },
        ]}>
        {body}
      </Pressable>
    );
  }
  return (
    <View
      style={[
        styles.field,
        wide && styles.fieldWide,
        { backgroundColor: softField(ff), borderColor: ff.line },
      ]}>
      {body}
    </View>
  );
}

export function FinanceFoldFormSwitchRow({
  ff,
  label,
  value,
  onToggle,
}: {
  ff: FinanceFoldPalette;
  label: string;
  value: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      onPress={onToggle}
      style={[styles.formRow, { borderBottomColor: ff.line }]}>
      <Text style={[styles.formLabel, { color: ff.muted }]}>{label}</Text>
      <Switch
        value={value}
        pointerEvents="none"
        trackColor={{ false: ff.line2, true: ff.pine }}
        thumbColor={ff.card}
      />
    </Pressable>
  );
}

export function FinanceFoldFormValueRow({
  ff,
  fonts = financeFoldFonts,
  label,
  value,
  muted,
  onPress,
}: {
  ff: FinanceFoldPalette;
  fonts?: typeof financeFoldFonts;
  label: string;
  value: string;
  muted?: boolean;
  onPress?: () => void;
}) {
  const content = (
    <>
      <Text style={[styles.formLabel, { color: ff.muted }]}>{label}</Text>
      <Text
        style={[
          styles.formValue,
          { color: muted ? ff.faint : ff.ink2, fontFamily: fonts.mono, fontWeight: muted ? '500' : '600' },
        ]}
        numberOfLines={1}>
        {value}
      </Text>
    </>
  );
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.formRow,
          { borderBottomColor: ff.line, opacity: pressed ? 0.85 : 1 },
        ]}>
        {content}
      </Pressable>
    );
  }
  return <View style={[styles.formRow, { borderBottomColor: ff.line }]}>{content}</View>;
}

/** 折页数字键盘（设计稿未画，APP 保留） */
export function FinanceFoldKeypad({
  ff,
  keys,
  canSave,
  onKey,
  onDone,
}: {
  ff: FinanceFoldPalette;
  keys: string[];
  canSave: boolean;
  onKey: (key: string) => void;
  onDone: () => void;
}) {
  return (
    <View style={[styles.foldKeypad, { backgroundColor: softTrack(ff) }]}>
      {keys.map((key, idx) => {
        const isDone = key === 'done';
        const isBackspace = key === 'backspace';
        return (
          <Pressable
            key={`${key}-${idx}`}
            onPress={() => (isDone ? onDone() : onKey(key))}
            style={({ pressed }) => [
              styles.foldKey,
              isDone
                ? { backgroundColor: canSave ? ff.pine : ff.faint }
                : { backgroundColor: ff.card, borderColor: ff.line, borderWidth: StyleSheet.hairlineWidth },
              key === '0' && styles.foldKeyWide,
              pressed && { opacity: 0.86 },
            ]}>
            {isBackspace ? (
              <MaterialIcons name="backspace" size={18} color={ff.muted} />
            ) : (
              <Text
                style={[
                  styles.foldKeyText,
                  isDone ? { color: ff.onPine, fontWeight: '800' } : { color: ff.ink },
                ]}>
                {isDone ? '完成' : key}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * 设计稿 03 · 支出 / 收入面板
 * 布局与稿一致；键盘、自定义分类、附件为 APP 保留能力。
 */
export function FinanceFoldExpenseIncomePanel({
  ff,
  fonts = financeFoldFonts,
  mode,
  amountDisplay,
  amountFocused,
  onFocusAmount,
  categories,
  selectedCategoryKey,
  onSelectCategory,
  onAddCategory,
  onLongPressCustomCategory,
  accountLabel,
  onPressAccount,
  timeLabel,
  onPressTime,
  title,
  onChangeTitle,
  includeInBudget,
  onToggleBudget,
  imageUris,
  onRemoveImage,
  onPressImage,
  canSave,
  isSaving,
  onSave,
  keypadKeys,
  onKeypadKey,
}: {
  ff: FinanceFoldPalette;
  fonts?: typeof financeFoldFonts;
  mode: 'expense' | 'income';
  amountDisplay: string;
  amountFocused: boolean;
  onFocusAmount: () => void;
  categories: FinanceFoldCategoryChip[];
  selectedCategoryKey: string;
  onSelectCategory: (key: string) => void;
  onAddCategory: () => void;
  onLongPressCustomCategory?: (item: FinanceFoldCategoryChip) => void;
  accountLabel: string;
  onPressAccount: () => void;
  timeLabel: string;
  onPressTime: () => void;
  title: string;
  onChangeTitle: (v: string) => void;
  includeInBudget: boolean;
  onToggleBudget: () => void;
  imageUris: string[];
  onRemoveImage: (index: number) => void;
  onPressImage: () => void;
  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
  keypadKeys: string[];
  onKeypadKey: (key: string) => void;
}) {
  return (
    <View style={styles.manualPanel}>
      <FinanceFoldAmountInput
        ff={ff}
        fonts={fonts}
        amountDisplay={amountDisplay}
        tone={mode}
        focused={amountFocused}
        onPress={onFocusAmount}
      />
      <FinanceFoldCategoryTags
        ff={ff}
        categories={categories}
        selectedKey={selectedCategoryKey}
        onSelectKey={onSelectCategory}
        onAddPress={onAddCategory}
        onLongPressCustom={onLongPressCustomCategory}
      />
      <View style={styles.fieldGrid}>
        <FinanceFoldFieldCell ff={ff} label="账户" value={accountLabel} onPress={onPressAccount} />
        <FinanceFoldFieldCell ff={ff} label="时间" value={timeLabel} onPress={onPressTime} />
        <FinanceFoldFieldCell
          ff={ff}
          label="标题"
          value={title}
          wide
          editable
          placeholder={mode === 'income' ? '例如：10 月工资' : '例如：午饭 · 山野面馆'}
          onChangeText={onChangeTitle}
        />
      </View>
      <FinanceFoldFormSwitchRow
        ff={ff}
        label={mode === 'income' ? '计入本月收入' : '计入本月预算'}
        value={includeInBudget}
        onToggle={onToggleBudget}
      />
      {imageUris.length ? (
        <View style={styles.attachRow}>
          {imageUris.map((uri, idx) => (
            <View key={`${uri}-${idx}`} style={styles.attachThumbWrap}>
              <Image source={{ uri }} style={styles.attachThumb} />
              <Pressable
                onPress={() => onRemoveImage(idx)}
                style={({ pressed }) => [styles.attachRemove, pressed && { opacity: 0.85 }]}>
                <MaterialIcons name="close" size={12} color="#fff" />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={onPressImage}
          style={({ pressed }) => [
            styles.ghostBtn,
            { backgroundColor: softTrack(ff), borderColor: ff.line, opacity: pressed ? 0.85 : 1 },
          ]}>
          <MaterialIcons name="image" size={20} color={ff.pine} />
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={!canSave || isSaving}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: canSave ? ff.pine : ff.faint,
              opacity: pressed && canSave ? 0.9 : 1,
            },
          ]}>
          {isSaving ? (
            <ActivityIndicator color={ff.onPine} />
          ) : (
            <Text style={[styles.primaryBtnText, { color: ff.onPine }]}>
              {mode === 'income' ? '保存收入' : '保存支出'}
            </Text>
          )}
        </Pressable>
      </View>
      {amountFocused ? (
        <FinanceFoldKeypad
          ff={ff}
          keys={keypadKeys}
          canSave={canSave}
          onKey={onKeypadKey}
          onDone={onSave}
        />
      ) : null}
    </View>
  );
}

/**
 * 设计稿 03 · 转账面板
 * 保留手续费编辑、账户对调、还款/取款提示与数字键盘。
 */
export function FinanceFoldTransferPanel({
  ff,
  fonts = financeFoldFonts,
  amountDisplay,
  feeDisplay,
  amountTarget,
  onFocusAmount,
  onFocusFee,
  fromLabel,
  toLabel,
  fromName,
  toName,
  onPressFrom,
  onPressTo,
  onSwap,
  hint,
  note,
  onChangeNote,
  timeLabel,
  onPressTime,
  canSave,
  isSaving,
  onSave,
  keypadKeys,
  onKeypadKey,
}: {
  ff: FinanceFoldPalette;
  fonts?: typeof financeFoldFonts;
  amountDisplay: string;
  feeDisplay: string;
  amountTarget: 'amount' | 'fee';
  onFocusAmount: () => void;
  onFocusFee: () => void;
  fromLabel: string;
  toLabel: string;
  fromName: string;
  toName: string;
  onPressFrom: () => void;
  onPressTo: () => void;
  onSwap: () => void;
  hint: string | null;
  note: string;
  onChangeNote: (v: string) => void;
  /** APP 保留：设计稿无转账时间，但业务需要 */
  timeLabel?: string;
  onPressTime?: () => void;
  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
  keypadKeys: string[];
  onKeypadKey: (key: string) => void;
}) {
  return (
    <View style={styles.manualPanel}>
      <FinanceFoldAmountInput
        ff={ff}
        fonts={fonts}
        amountDisplay={amountTarget === 'fee' ? feeDisplay : amountDisplay}
        tone="transfer"
        focused={amountTarget === 'amount' || amountTarget === 'fee'}
        onPress={onFocusAmount}
      />
      {amountTarget === 'fee' ? (
        <Text style={[styles.feeHint, { color: ff.muted }]}>正在编辑手续费 · 对方实收 = 转账额 − 手续费</Text>
      ) : null}
      <View style={styles.fieldGrid}>
        <FinanceFoldFieldCell ff={ff} label={fromLabel} value={fromName} onPress={onPressFrom} />
        <FinanceFoldFieldCell ff={ff} label={toLabel} value={toName} onPress={onPressTo} />
      </View>
      {hint ? <Text style={[styles.transferHint, { color: ff.muted }]}>{hint}</Text> : null}
      <FinanceFoldFormValueRow
        ff={ff}
        fonts={fonts}
        label="手续费"
        value={`¥${feeDisplay}`}
        muted={feeDisplay === '0.00'}
        onPress={onFocusFee}
      />
      <View style={[styles.formRow, { borderBottomColor: ff.line, alignItems: 'flex-start' }]}>
        <Text style={[styles.formLabel, { color: ff.muted, marginTop: 4 }]}>备注</Text>
        <TextInput
          value={note}
          onChangeText={onChangeNote}
          placeholder="可选"
          placeholderTextColor={ff.faint}
          style={[styles.formNoteInput, { color: ff.ink2 }]}
        />
      </View>
      {timeLabel && onPressTime ? (
        <FinanceFoldFormValueRow
          ff={ff}
          fonts={fonts}
          label="时间"
          value={timeLabel}
          onPress={onPressTime}
        />
      ) : null}
      <View style={styles.actions}>
        <Pressable
          onPress={onSwap}
          accessibilityLabel="交换扣款与入账账户"
          style={({ pressed }) => [
            styles.ghostBtn,
            { backgroundColor: softTrack(ff), borderColor: ff.line, opacity: pressed ? 0.85 : 1 },
          ]}>
          <MaterialIcons name="swap-horiz" size={22} color={ff.pine} />
        </Pressable>
        <Pressable
          onPress={onSave}
          disabled={!canSave || isSaving}
          style={({ pressed }) => [
            styles.primaryBtn,
            {
              backgroundColor: canSave ? ff.pine : ff.faint,
              opacity: pressed && canSave ? 0.9 : 1,
            },
          ]}>
          {isSaving ? (
            <ActivityIndicator color={ff.onPine} />
          ) : (
            <Text style={[styles.primaryBtnText, { color: ff.onPine }]}>确认转账</Text>
          )}
        </Pressable>
      </View>
      <FinanceFoldKeypad
        ff={ff}
        keys={keypadKeys}
        canSave={canSave}
        onKey={onKeypadKey}
        onDone={onSave}
      />
    </View>
  );
}

/** 记一笔 FAB：3.4s 呼吸 + 3.6s 扫光 */
export function FinanceFoldRecordFab({
  ff,
  bottom,
  disabled,
  busy,
  isDark = false,
  onPress,
  onLongPress,
  style,
}: {
  ff: FinanceFoldPalette;
  bottom: number | Animated.Value | Animated.AnimatedInterpolation<number>;
  disabled?: boolean;
  busy?: boolean;
  isDark?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { animate, motionReduced } = useFoldMotionGate();
  const breath = React.useRef(new Animated.Value(1)).current;
  const shimmer = React.useRef(new Animated.Value(0)).current;
  const fabBg = isDark ? '#2F5646' : ff.pine;
  const fabFg = isDark ? '#F7F2E7' : ff.onPine;
  const fabBorder = isDark ? 'rgba(169,199,185,0.32)' : 'rgba(255,255,255,0.09)';
  const fabPlusBg = isDark ? 'rgba(247,242,231,0.14)' : 'rgba(255,255,255,0.12)';
  const fabShimmerBg = isDark ? 'rgba(247,242,231,0.12)' : 'rgba(255,255,255,0.14)';
  const fabShadow = isDark ? '#000000' : ff.shadow;

  React.useEffect(() => {
    if (!animate || motionReduced) {
      breath.setValue(1);
      shimmer.setValue(0);
      return;
    }
    const breathLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 1.035,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(1200),
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
      ]),
    );
    breathLoop.start();
    shimmerLoop.start();
    return () => {
      breathLoop.stop();
      shimmerLoop.stop();
    };
  }, [animate, breath, motionReduced, shimmer]);

  const shimmerX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 140],
  });

  // bottom 走 JS driver；scale/shimmer 走 native driver —— 必须拆成两层，否则同节点混用会崩
  return (
    <Animated.View style={[styles.fabWrap, { bottom }, style]}>
      <Animated.View style={{ opacity: disabled ? 0.78 : 1, transform: [{ scale: breath }] }}>
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          delayLongPress={380}
          disabled={busy}
          style={({ pressed }) => [
            styles.fab,
            {
              backgroundColor: fabBg,
              borderColor: fabBorder,
              shadowColor: fabShadow,
              shadowOpacity: isDark ? 0.45 : 0.28,
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="记一笔"
          accessibilityHint="长按可从相册识图记账">
          <Animated.View
            pointerEvents="none"
            style={[
              styles.fabShimmer,
              {
                backgroundColor: fabShimmerBg,
                transform: [{ translateX: shimmerX }, { skewX: '-18deg' }],
              },
            ]}
          />
          <View style={[styles.fabPlus, { backgroundColor: fabPlusBg }]}>
            {busy ? (
              <ActivityIndicator size="small" color={fabFg} />
            ) : (
              <MaterialIcons name="add" size={18} color={fabFg} />
            )}
          </View>
          <Text style={[styles.fabText, { color: fabFg }]}>记一笔</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function softTrack(ff: FinanceFoldPalette) {
  return ff.paper2;
}
function softField(ff: FinanceFoldPalette) {
  return ff.paper2;
}
function softSage(ff: FinanceFoldPalette) {
  return ff.sage2;
}
function isSoftPaper(ff: FinanceFoldPalette) {
  return ff.paper2;
}
function isDarkPreview(ff: FinanceFoldPalette) {
  return ff.paper2;
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 23,
    borderTopRightRadius: 23,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    overflow: 'hidden',
    zIndex: 1,
    elevation: 24,
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -12 },
  },
  sheetWash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 80,
  },
  handle: {
    width: 35,
    height: 4,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 9,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    zIndex: 1,
  },
  headCopy: { flex: 1, minWidth: 0 },
  headTitle: {
    fontSize: 20,
    fontWeight: '600',
    letterSpacing: -0.2,
  },
  headSub: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 3,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segment: {
    flexDirection: 'row',
    gap: 3,
    borderWidth: 1,
    borderRadius: 11,
    padding: 3,
    marginTop: 10,
    marginBottom: 10,
  },
  segmentBtn: {
    flex: 1,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentText: {
    fontSize: 12,
  },
  phrasePanel: {
    gap: 0,
    paddingBottom: 4,
  },
  phraseBox: {
    borderWidth: 1,
    borderRadius: 13,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  mic: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    shadowOpacity: 0.17,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  phraseInput: {
    flex: 1,
    minHeight: 56,
    maxHeight: 96,
    fontSize: 15,
    lineHeight: 22,
    paddingTop: 4,
    paddingBottom: 4,
  },
  parseRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  parsePill: {
    height: 28,
    paddingHorizontal: 9,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  parsePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  aiLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
  },
  aiLineText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 17,
  },
  quickTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  quickTag: {
    height: 26,
    borderRadius: 7,
    paddingHorizontal: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTagText: {
    fontSize: 11,
    fontWeight: '600',
  },
  scanEntry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
  },
  scanEntryIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanEntryCopy: { flex: 1, minWidth: 0 },
  scanEntryTitle: { fontSize: 13, fontWeight: '700' },
  scanEntrySub: { fontSize: 11, marginTop: 2 },
  fieldGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  field: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: '46%',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  fieldLabel: {
    fontSize: 11,
    letterSpacing: 0.3,
  },
  fieldValue: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  ghostBtn: {
    width: 48,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
  },
  tip: {
    textAlign: 'center',
    fontSize: 11,
    marginTop: 8,
  },
  albumPanel: {
    paddingBottom: 6,
  },
  localTag: {
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 7,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  localTagText: {
    fontSize: 11,
    fontWeight: '700',
  },
  scanPreview: {
    height: SCAN_PREVIEW_H,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 10,
    overflow: 'hidden',
    position: 'relative',
    // 勿在此设 alignItems:'center'：会导致 left/right 绝对定位扫描线宽度塌成 0
  },
  scanPlaceholderWrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scanImage: {
    ...StyleSheet.absoluteFill,
    width: '100%',
    height: '100%',
  },
  scanSheetCard: {
    width: 174,
    borderRadius: 13,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  payFrom: { fontSize: 10, letterSpacing: 0.8 },
  payAmt: { fontSize: 26, fontWeight: '700', marginTop: 6 },
  payTo: { fontSize: 13, marginTop: 8 },
  confidence: {
    position: 'absolute',
    right: 10,
    top: 8,
    height: 22,
    paddingHorizontal: 8,
    borderRadius: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    zIndex: 4,
    elevation: 4,
  },
  confidenceText: {
    fontSize: 10,
    color: '#F2E4CD',
    fontWeight: '700',
  },
  scanLine: {
    position: 'absolute',
    left: 12,
    right: 12,
    height: 2,
    top: 0,
    zIndex: 3,
    elevation: 3,
    backgroundColor: 'transparent',
  },
  scanLineSvg: {
    width: '100%',
    height: 2,
  },
  scanBadge: {
    position: 'absolute',
    right: 0,
    top: -14,
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  scanBadgeText: {
    fontSize: 8,
    letterSpacing: 1.2,
    fontWeight: '700',
  },
  recognized: {
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 10,
  },
  recognizedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recognizedTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  rgrid: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 8,
  },
  rg: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
  },
  rgLabel: { fontSize: 10 },
  rgValue: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  formLabel: { fontSize: 14 },
  ctaRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
  },
  correctBtn: {
    width: 88,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  correctBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  errorBox: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    fontSize: 13,
    lineHeight: 18,
  },
  fabWrap: {
    position: 'absolute',
    right: 17,
    zIndex: 100,
    elevation: 20,
  },
  fab: {
    height: 43,
    paddingLeft: 12,
    paddingRight: 15,
    borderRadius: 22,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.09)',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  fabShimmer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 48,
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  fabPlus: {
    width: 23,
    height: 23,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  fabText: {
    fontSize: 13,
    fontWeight: '800',
  },
  manualPanel: {
    paddingBottom: 4,
  },
  amountInput: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingTop: 14,
    paddingBottom: 10,
  },
  amountCur: {
    fontSize: 16,
    marginRight: 3,
    marginTop: 6,
  },
  amountNum: {
    fontSize: 36,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  amountCursor: {
    width: 2,
    height: 30,
    marginLeft: 2,
    marginTop: 4,
    borderRadius: 1,
  },
  categoryTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    justifyContent: 'center',
    marginTop: 2,
    marginBottom: 4,
  },
  categoryTag: {
    height: 28,
    borderRadius: 8,
    paddingHorizontal: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryTagText: {
    fontSize: 12,
  },
  fieldWide: {
    flexBasis: '100%',
    minWidth: '100%',
    flexGrow: 1,
  },
  fieldValueInput: {
    fontSize: 14,
    fontWeight: '700',
    marginTop: 2,
    padding: 0,
    minHeight: 20,
  },
  formValue: {
    fontSize: 14,
    maxWidth: '58%',
    textAlign: 'right',
  },
  formNoteInput: {
    flex: 1,
    textAlign: 'right',
    fontSize: 14,
    fontWeight: '500',
    padding: 0,
    minHeight: 22,
  },
  feeHint: {
    textAlign: 'center',
    fontSize: 12,
    marginBottom: 4,
  },
  transferHint: {
    fontSize: 12,
    marginTop: 6,
    lineHeight: 17,
  },
  attachRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
  },
  attachThumbWrap: {
    width: 56,
    height: 56,
    borderRadius: 10,
    overflow: 'hidden',
  },
  attachThumb: {
    width: '100%',
    height: '100%',
  },
  attachRemove: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  foldKeypad: {
    marginTop: 12,
    borderRadius: 14,
    padding: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  foldKey: {
    width: '23%',
    flexGrow: 1,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  foldKeyWide: {
    width: '48%',
  },
  foldKeyText: {
    fontSize: 18,
    fontWeight: '600',
  },
});
