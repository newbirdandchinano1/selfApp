/**
 * 折页 · 深链 Loading：对齐设计稿 18 `/auto-ledger`、19 `/screenshot`
 * 轨道旋转 / 扫描角标 / 步骤点亮 / loadFade；无业务 UI。
 */
import { FOLD_MOTION_EASE, useFoldMotionGate } from '@/components/review/fold-motion';
import { financeFoldFonts } from '@/constants/finance-fold-theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type FinanceDeeplinkLoadingVariant = 'auto-ledger' | 'screenshot';

type StepState = 'pending' | 'on' | 'done';

type StepItem = {
  label: string;
  statusText: string;
  state: StepState;
};

const AUTO_LEDGER_STEPS: Omit<StepItem, 'state'>[] = [
  { label: '读取快捷指令', statusText: 'OK' },
  { label: '准备财务主 Tab', statusText: '…' },
  { label: '等待截图识别', statusText: 'NEXT' },
];

const SCREENSHOT_STEPS: Omit<StepItem, 'state'>[] = [
  { label: '剪贴板图片已标记', statusText: 'OK' },
  { label: '跳转财务主 Tab', statusText: '…' },
  { label: '主页识别并弹出结果', statusText: 'NEXT' },
];

const BG = '#172B24';
const TITLE = '#F6EBD9';
const MUTED = '#A7BBAD';
const KICK = '#A9BEB1';
const CODE = '#80998A';
const STEP_IDLE = '#71897A';
const STEP_ON = '#D8C7AB';
const DOT_IDLE = '#435D4F';
const DOT_ON = '#E1B475';
const DOT_DONE = '#78A087';
const AMBER = '#EDC184';

function LoadOrbit({ animate }: { animate: boolean }) {
  const spin = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!animate) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 3400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, spin]);

  const rotate = spin.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={styles.orbit}>
      <View style={[styles.ring, styles.ring1]} />
      <View style={[styles.ring, styles.ring2]} />
      <View style={[styles.ring, styles.ring3]} />
      {animate ? (
        <Animated.View style={[styles.orbWrap, { transform: [{ rotate }] }]}>
          <View style={styles.orb} />
        </Animated.View>
      ) : (
        <View style={[styles.orbWrap, { transform: [{ rotate: '40deg' }] }]}>
          <View style={styles.orb} />
        </View>
      )}
      <View style={styles.core}>
        <MaterialIcons name="document-scanner" size={28} color="#EAC48B" />
      </View>
    </View>
  );
}

function ClipVisual({ animate }: { animate: boolean }) {
  const scan = React.useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
    if (!animate) {
      scan.setValue(0.35);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(scan, {
          toValue: 1,
          duration: 1050,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(scan, {
          toValue: 0,
          duration: 1050,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, scan]);

  const translateY = scan.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 78],
  });

  return (
    <View style={styles.clipVisual}>
      <View style={[styles.clipCorner, styles.clipTl]} />
      <View style={[styles.clipCorner, styles.clipTr]} />
      <View style={[styles.clipCorner, styles.clipBl]} />
      <View style={[styles.clipCorner, styles.clipBr]} />
      <View style={styles.clipCard} />
      <View style={styles.clipThumb} />
      <Animated.View style={[styles.clipScan, { transform: [{ translateY }] }]} />
    </View>
  );
}

function LoadSteps({ steps, animate }: { steps: StepItem[]; animate: boolean }) {
  return (
    <View style={styles.steps}>
      {steps.map((step, index) => {
        const color =
          step.state === 'on' ? STEP_ON : step.state === 'done' ? MUTED : STEP_IDLE;
        const dot =
          step.state === 'on' ? DOT_ON : step.state === 'done' ? DOT_DONE : DOT_IDLE;
        return (
          <AnimatedStepRow
            key={step.label}
            index={index}
            animate={animate}
            label={step.label}
            statusText={step.statusText}
            color={color}
            dot={dot}
            isOn={step.state === 'on'}
          />
        );
      })}
    </View>
  );
}

function AnimatedStepRow({
  index,
  animate,
  label,
  statusText,
  color,
  dot,
  isOn,
}: {
  index: number;
  animate: boolean;
  label: string;
  statusText: string;
  color: string;
  dot: string;
  isOn: boolean;
}) {
  const progress = React.useRef(new Animated.Value(animate ? 0 : 1)).current;

  React.useEffect(() => {
    if (!animate) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const anim = Animated.timing(progress, {
      toValue: 1,
      duration: 360,
      delay: 80 + index * 55,
      easing: FOLD_MOTION_EASE,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [animate, index, progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });

  return (
    <Animated.View
      style={[styles.stepRow, { opacity: progress, transform: [{ translateY }] }]}>
      <View
        style={[
          styles.stepDot,
          { backgroundColor: dot },
          isOn && styles.stepDotOn,
        ]}
      />
      <Text style={[styles.stepLabel, { color }]}>{label}</Text>
      <Text style={styles.stepStatus}>{statusText}</Text>
    </Animated.View>
  );
}

export function FinanceDeeplinkLoading({
  variant,
}: {
  variant: FinanceDeeplinkLoadingVariant;
}) {
  const insets = useSafeAreaInsets();
  const { animate } = useFoldMotionGate();
  const fade = React.useRef(new Animated.Value(animate ? 0.72 : 1)).current;
  const [stepIndex, setStepIndex] = React.useState(0);

  const isAuto = variant === 'auto-ledger';
  const baseSteps = isAuto ? AUTO_LEDGER_STEPS : SCREENSHOT_STEPS;

  React.useEffect(() => {
    if (!animate) {
      fade.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fade, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(fade, {
          toValue: 0.72,
          duration: 1600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, fade]);

  React.useEffect(() => {
    if (!animate) {
      setStepIndex(1);
      return;
    }
    setStepIndex(0);
    const t1 = setTimeout(() => setStepIndex(1), 420);
    const t2 = setTimeout(() => setStepIndex(2), 980);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [animate]);

  const steps: StepItem[] = baseSteps.map((item, i) => {
    if (i < stepIndex) {
      return { ...item, state: 'done', statusText: 'OK' };
    }
    if (i === stepIndex) {
      return {
        ...item,
        state: 'on',
        statusText: i === baseSteps.length - 1 ? 'NEXT' : '…',
      };
    }
    return { ...item, state: 'pending', statusText: 'NEXT' };
  });

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.glow} pointerEvents="none" />
      <Animated.View style={[styles.inner, { opacity: fade }]}>
        {isAuto ? <LoadOrbit animate={animate} /> : <ClipVisual animate={animate} />}
        <Text style={styles.kick}>{isAuto ? 'Shortcut handoff' : 'Clipboard intent'}</Text>
        <Text style={[styles.title, { fontFamily: financeFoldFonts.serif }]}>
          {isAuto ? '正在接收快捷指令' : '正在读取剪贴板'}
        </Text>
        <Text style={styles.desc}>
          {isAuto
            ? '马上回到财务首页，并在本机完成截图识别。\n无需停留，不需要手动确认。'
            : '识别到一张支付截图，正在把「自动记账」意图\n带回财务首页。'}
        </Text>
        <View style={styles.codeChip}>
          <Text style={[styles.codeText, { fontFamily: financeFoldFonts.mono }]}>
            {isAuto ? '/auto-ledger' : '/screenshot'}
          </Text>
        </View>
        <LoadSteps steps={steps} animate={animate} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  glow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 220,
    backgroundColor: 'rgba(216,154,77,0.1)',
    opacity: 0.85,
  },
  inner: {
    alignItems: 'center',
    maxWidth: 320,
    width: '100%',
  },
  orbit: {
    width: 128,
    height: 128,
    marginBottom: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderRadius: 999,
    borderWidth: 1,
  },
  ring1: {
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderColor: 'rgba(242,216,169,0.14)',
  },
  ring2: {
    top: 15,
    left: 15,
    right: 15,
    bottom: 15,
    borderColor: 'rgba(242,216,169,0.18)',
  },
  ring3: {
    top: 30,
    left: 30,
    right: 30,
    bottom: 30,
    borderColor: 'rgba(242,216,169,0.22)',
  },
  orbWrap: {
    position: 'absolute',
    width: 128,
    height: 128,
    alignItems: 'center',
  },
  orb: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginTop: -3.5,
    backgroundColor: AMBER,
    shadowColor: AMBER,
    shadowOpacity: 0.65,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3,
  },
  core: {
    position: 'absolute',
    top: 44,
    left: 44,
    right: 44,
    bottom: 44,
    borderRadius: 18,
    backgroundColor: 'rgba(238,200,136,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(238,200,136,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clipVisual: {
    width: 150,
    height: 112,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(239,213,171,0.18)',
    backgroundColor: 'rgba(255,255,255,0.035)',
    marginBottom: 26,
    overflow: 'hidden',
  },
  clipCorner: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderColor: '#C9A36A',
  },
  clipTl: { left: 12, top: 12, borderTopWidth: 1, borderLeftWidth: 1 },
  clipTr: { right: 12, top: 12, borderTopWidth: 1, borderRightWidth: 1 },
  clipBl: { left: 12, bottom: 12, borderBottomWidth: 1, borderLeftWidth: 1 },
  clipBr: { right: 12, bottom: 12, borderBottomWidth: 1, borderRightWidth: 1 },
  clipCard: {
    position: 'absolute',
    left: 22,
    top: 26,
    width: 74,
    height: 40,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(239,213,171,0.24)',
  },
  clipThumb: {
    position: 'absolute',
    right: 22,
    top: 42,
    width: 20,
    height: 28,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: 'rgba(239,213,171,0.18)',
  },
  clipScan: {
    position: 'absolute',
    left: 10,
    right: 10,
    height: 1,
    backgroundColor: '#D7A65C',
    shadowColor: '#D7A65C',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  kick: {
    fontSize: 11,
    letterSpacing: 2.4,
    color: KICK,
    textTransform: 'uppercase',
    fontWeight: '600',
  },
  title: {
    fontSize: 22,
    color: TITLE,
    fontWeight: '600',
    marginTop: 10,
    marginBottom: 6,
    textAlign: 'center',
  },
  desc: {
    fontSize: 13,
    lineHeight: 20,
    color: MUTED,
    textAlign: 'center',
  },
  codeChip: {
    marginTop: 16,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  codeText: {
    fontSize: 11,
    color: CODE,
  },
  steps: {
    marginTop: 22,
    width: 220,
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
  },
  stepDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  stepDotOn: {
    shadowColor: DOT_ON,
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    elevation: 2,
  },
  stepLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  stepStatus: {
    fontSize: 10,
    color: '#6C8474',
    fontFamily: financeFoldFonts.mono,
  },
});
