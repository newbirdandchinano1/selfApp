import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  Modal,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useReducedMotion } from '@/hooks/use-reduced-motion';
import {
  subscribeCompletionCelebration,
  type CompletionCelebrationPayload,
} from '@/lib/completion-celebration-events';
import { formatPointsToastAmount } from '@/lib/points-earned-toast-events';

/** 0.8 倍速 → 时长 × 1.25 */
const SPEED = 1 / 0.8;
const ms = (n: number) => Math.round(n * SPEED);

const PARTICLE_COUNT = 28;
const COLORS = ['#34d399', '#38bdf8', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#4ade80'];

type ParticleSpec = {
  id: number;
  color: string;
  startX: number;
  driftX: number;
  size: number;
  rotate: number;
  rise: number;
};

function buildParticles(seed: number, screenW: number): ParticleSpec[] {
  const mid = screenW / 2;
  const out: ParticleSpec[] = [];
  for (let i = 0; i < PARTICLE_COUNT; i++) {
    const t = (seed * 17 + i * 31) % 97;
    const angle = ((i / PARTICLE_COUNT) * Math.PI * 2 + (t / 97) * 0.5) % (Math.PI * 2);
    out.push({
      id: i,
      color: COLORS[i % COLORS.length]!,
      startX: mid + Math.cos(angle) * (12 + (t % 36)),
      driftX: Math.cos(angle) * (100 + (t % 80)),
      size: 7 + (t % 8),
      rotate: (t % 2 === 0 ? 1 : -1) * (160 + (t % 220)),
      rise: -(140 + (t % 90)),
    });
  }
  return out;
}

type ParticleViewProps = {
  spec: ParticleSpec;
  progress: Animated.Value;
  originY: number;
};

function ParticleView({ spec, progress, originY }: ParticleViewProps) {
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.particle,
        {
          left: spec.startX,
          top: originY,
          width: spec.size,
          height: spec.size * (spec.id % 3 === 0 ? 1.7 : 1),
          borderRadius: spec.id % 3 === 0 ? 2 : spec.size / 2,
          backgroundColor: spec.color,
          opacity: progress.interpolate({
            inputRange: [0, 0.08, 0.75, 1],
            outputRange: [0, 1, 1, 0],
          }),
          transform: [
            {
              translateX: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, spec.driftX],
              }),
            },
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0, spec.rise],
              }),
            },
            {
              rotate: progress.interpolate({
                inputRange: [0, 1],
                outputRange: ['0deg', `${spec.rotate}deg`],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 0.15, 1],
                outputRange: [0.3, 1.2, 0.75],
              }),
            },
          ],
        },
      ]}
    />
  );
}

function buildMessage(payload: CompletionCelebrationPayload): { titleLine: string; pointsLine: string | null } {
  const name = payload.title.trim() || '该项';
  const titleLine = `恭喜完成：${name}`;
  const delta = payload.pointsDelta ?? 0;
  if (!(delta > 0)) return { titleLine, pointsLine: null };
  return { titleLine, pointsLine: `+${formatPointsToastAmount(delta)} 积分` };
}

/** 根级挂载：完成庆祝彩屑 + 底部文案 toast（Modal 盖过原生 Stack）。 */
export function CompletionCelebrationHost() {
  const reduceMotion = useReducedMotion();
  const insets = useSafeAreaInsets();
  const [payload, setPayload] = React.useState<CompletionCelebrationPayload | null>(null);
  const [animKey, setAnimKey] = React.useState(0);
  const [particles, setParticles] = React.useState<ParticleSpec[]>([]);
  const burst = React.useRef(new Animated.Value(0)).current;
  const toastOpacity = React.useRef(new Animated.Value(0)).current;
  const toastTranslate = React.useRef(new Animated.Value(18)).current;
  const animRef = React.useRef<Animated.CompositeAnimation | null>(null);
  const { width: screenW, height: screenH } = Dimensions.get('window');
  const toastBottom = Math.max(insets.bottom, 12) + 88;
  const particleOriginY = screenH - toastBottom - 36;

  React.useEffect(() => {
    return subscribeCompletionCelebration((next) => {
      if (next == null) {
        setPayload(null);
        return;
      }
      setPayload(next);
      setAnimKey((k) => k + 1);
      setParticles(buildParticles(Date.now() % 10007, screenW));
    });
  }, [screenW]);

  React.useEffect(() => {
    if (payload == null) return;

    animRef.current?.stop();
    burst.setValue(0);
    toastOpacity.setValue(0);
    toastTranslate.setValue(18);

    if (Platform.OS !== 'web') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }

    const toastIn = Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 1,
        duration: ms(reduceMotion ? 120 : 180),
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslate, {
        toValue: 0,
        duration: ms(reduceMotion ? 160 : 220),
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]);

    const toastOut = Animated.parallel([
      Animated.timing(toastOpacity, {
        toValue: 0,
        duration: ms(reduceMotion ? 200 : 320),
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(toastTranslate, {
        toValue: -12,
        duration: ms(reduceMotion ? 200 : 320),
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    const anim = reduceMotion
      ? Animated.sequence([toastIn, Animated.delay(ms(900)), toastOut])
      : Animated.parallel([
          Animated.timing(burst, {
            toValue: 1,
            duration: ms(1400),
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.sequence([toastIn, Animated.delay(ms(900)), toastOut]),
        ]);

    animRef.current = anim;
    const raf = requestAnimationFrame(() => {
      anim.start(({ finished }) => {
        if (!finished) return;
        animRef.current = null;
      });
    });

    return () => {
      cancelAnimationFrame(raf);
      animRef.current?.stop();
      animRef.current = null;
    };
  }, [animKey, burst, payload, reduceMotion, toastOpacity, toastTranslate]);

  const lines = payload ? buildMessage(payload) : null;

  return (
    <Modal
      visible={payload != null}
      transparent
      animationType="none"
      statusBarTranslucent
      hardwareAccelerated
      onRequestClose={() => {}}
      presentationStyle="overFullScreen">
      <View pointerEvents="none" style={styles.root}>
        {!reduceMotion
          ? particles.map((p) => (
              <ParticleView
                key={`${animKey}-${p.id}`}
                spec={p}
                progress={burst}
                originY={particleOriginY}
              />
            ))
          : null}
        <Animated.View
          style={[
            styles.toastWrap,
            {
              bottom: toastBottom,
              opacity: toastOpacity,
              transform: [{ translateY: toastTranslate }],
            },
          ]}>
          <View style={styles.toast}>
            <MaterialIcons name="auto-awesome" size={18} color="#fbbf24" />
            <View style={styles.toastTextCol}>
              <Text style={styles.toastTitle} numberOfLines={2}>
                {lines?.titleLine}
              </Text>
              {lines?.pointsLine ? (
                <Text style={styles.toastPoints}>{lines.pointsLine}</Text>
              ) : null}
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  particle: {
    position: 'absolute',
  },
  toastWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: '92%',
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(15,23,42,0.92)',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOpacity: 0.28,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  toastTextCol: {
    flexShrink: 1,
    gap: 2,
  },
  toastTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  toastPoints: {
    color: '#fbbf24',
    fontSize: 13,
    fontWeight: '800',
  },
});
