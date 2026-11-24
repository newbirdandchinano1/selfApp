/**
 * 桌宠动画驱动：单一 clock + 状态参数，保证状态间连续过渡。
 */
import type { AgentPetVisualState } from '@/components/agent-pet/types/agentPet.types';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import React from 'react';
import {
  cancelAnimation,
  Easing,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

export type PetAnimParams = {
  /** 呼吸幅度 */
  breathAmp: number;
  /** 上下浮动幅度 */
  floatAmp: number;
  /** 浮动周期倍率（越大越慢） */
  floatPeriod: number;
  /** 主体缩放基线 */
  scaleBase: number;
  /** 形变强度 */
  morphAmp: number;
  /** 粒子活跃度 0–1 */
  particleEnergy: number;
  /** 能量环可见度 0–1 */
  ringOpacity: number;
  /** 环转速 */
  ringSpeed: number;
  /** 内部光流速度 */
  flowSpeed: number;
  /** 色相偏移：0 正常 / 1 琥珀告警 */
  alertMix: number;
  /** 波纹强度（倾听） */
  rippleAmp: number;
};

const STATE_PARAMS: Record<AgentPetVisualState, PetAnimParams> = {
  idle: {
    breathAmp: 0.035,
    floatAmp: 5,
    floatPeriod: 1,
    scaleBase: 1,
    morphAmp: 0.55,
    particleEnergy: 0.35,
    ringOpacity: 0,
    ringSpeed: 0.35,
    flowSpeed: 0.55,
    alertMix: 0,
    rippleAmp: 0,
  },
  thinking: {
    breathAmp: 0.02,
    floatAmp: 3,
    floatPeriod: 1.15,
    scaleBase: 0.9,
    morphAmp: 0.35,
    particleEnergy: 0.7,
    ringOpacity: 0.55,
    ringSpeed: 0.85,
    flowSpeed: 0.9,
    alertMix: 0,
    rippleAmp: 0,
  },
  working: {
    breathAmp: 0.045,
    floatAmp: 4,
    floatPeriod: 0.55,
    scaleBase: 1.02,
    morphAmp: 0.75,
    particleEnergy: 1,
    ringOpacity: 0.35,
    ringSpeed: 1.4,
    flowSpeed: 1.35,
    alertMix: 0.08,
    rippleAmp: 0.15,
  },
  listening: {
    breathAmp: 0.03,
    floatAmp: 3.5,
    floatPeriod: 0.85,
    scaleBase: 1.1,
    morphAmp: 0.45,
    particleEnergy: 0.45,
    ringOpacity: 0.2,
    ringSpeed: 0.5,
    flowSpeed: 0.7,
    alertMix: 0,
    rippleAmp: 0.85,
  },
  success: {
    breathAmp: 0.05,
    floatAmp: 6,
    floatPeriod: 0.7,
    scaleBase: 1.18,
    morphAmp: 0.9,
    particleEnergy: 1,
    ringOpacity: 0.4,
    ringSpeed: 1.1,
    flowSpeed: 1.2,
    alertMix: 0.15,
    rippleAmp: 0.4,
  },
  error: {
    breathAmp: 0.025,
    floatAmp: 2.5,
    floatPeriod: 1.2,
    scaleBase: 0.94,
    morphAmp: 0.85,
    particleEnergy: 0.5,
    ringOpacity: 0.25,
    ringSpeed: 0.4,
    flowSpeed: 0.45,
    alertMix: 0.72,
    rippleAmp: 0.1,
  },
};

function lerp(a: number, b: number, t: number) {
  'worklet';
  return a + (b - a) * t;
}

export function useAgentPetAnimation(state: AgentPetVisualState) {
  const { enabled: reduceMotion, ready } = useReducedMotionState();
  const motionOff = !ready || reduceMotion;

  const clock = useSharedValue(0);
  const burst = useSharedValue(0);

  const breathAmp = useSharedValue(STATE_PARAMS.idle.breathAmp);
  const floatAmp = useSharedValue(STATE_PARAMS.idle.floatAmp);
  const floatPeriod = useSharedValue(STATE_PARAMS.idle.floatPeriod);
  const scaleBase = useSharedValue(STATE_PARAMS.idle.scaleBase);
  const morphAmp = useSharedValue(STATE_PARAMS.idle.morphAmp);
  const particleEnergy = useSharedValue(STATE_PARAMS.idle.particleEnergy);
  const ringOpacity = useSharedValue(STATE_PARAMS.idle.ringOpacity);
  const ringSpeed = useSharedValue(STATE_PARAMS.idle.ringSpeed);
  const flowSpeed = useSharedValue(STATE_PARAMS.idle.flowSpeed);
  const alertMix = useSharedValue(STATE_PARAMS.idle.alertMix);
  const rippleAmp = useSharedValue(STATE_PARAMS.idle.rippleAmp);

  React.useEffect(() => {
    const p = STATE_PARAMS[state];
    const cfg = { duration: 480, easing: Easing.out(Easing.cubic) };
    breathAmp.value = withTiming(p.breathAmp, cfg);
    floatAmp.value = withTiming(p.floatAmp, cfg);
    floatPeriod.value = withTiming(p.floatPeriod, cfg);
    scaleBase.value = withSpring(p.scaleBase, { damping: 14, stiffness: 160 });
    morphAmp.value = withTiming(p.morphAmp, cfg);
    particleEnergy.value = withTiming(p.particleEnergy, cfg);
    ringOpacity.value = withTiming(p.ringOpacity, cfg);
    ringSpeed.value = withTiming(p.ringSpeed, cfg);
    flowSpeed.value = withTiming(p.flowSpeed, cfg);
    alertMix.value = withTiming(p.alertMix, { duration: 560, easing: Easing.out(Easing.cubic) });
    rippleAmp.value = withTiming(p.rippleAmp, cfg);

    if (state === 'success') {
      burst.value = 0;
      burst.value = withSequence(
        withTiming(1, { duration: 420, easing: Easing.out(Easing.cubic) }),
        withTiming(0, { duration: 680, easing: Easing.inOut(Easing.quad) }),
      );
    }
  }, [
    alertMix,
    breathAmp,
    burst,
    floatAmp,
    floatPeriod,
    flowSpeed,
    morphAmp,
    particleEnergy,
    ringOpacity,
    ringSpeed,
    rippleAmp,
    scaleBase,
    state,
  ]);

  React.useEffect(() => {
    if (motionOff) {
      cancelAnimation(clock);
      clock.value = 0;
      return;
    }
    clock.value = withRepeat(
      withTiming(1, { duration: 8000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(clock);
    };
  }, [clock, motionOff]);

  const phase = useDerivedValue(() => {
    if (motionOff) return 0;
    return clock.value * Math.PI * 2;
  });

  const floatY = useDerivedValue(() => {
    if (motionOff) return 0;
    const t = phase.value / Math.max(0.35, floatPeriod.value);
    return Math.sin(t) * floatAmp.value;
  });

  const breathScale = useDerivedValue(() => {
    if (motionOff) return scaleBase.value;
    const b = 1 + Math.sin(phase.value * 1.15) * breathAmp.value;
    return scaleBase.value * b;
  });

  /** 有机轮廓四角半径系数（约 0.38–0.62），驱动不规则形变 */
  const morph = useDerivedValue(() => {
    if (motionOff) {
      return { tl: 0.48, tr: 0.52, br: 0.46, bl: 0.54 };
    }
    const a = morphAmp.value;
    const p = phase.value;
    const wobble = (speed: number, offset: number, lo: number, hi: number) => {
      'worklet';
      const base = lerp(lo, hi, (Math.sin(p * speed + offset) + 1) / 2);
      return lerp(0.5, base, 0.55 + a * 0.45);
    };
    return {
      tl: wobble(0.9, 0, 0.42, 0.58),
      tr: wobble(1.1, 1.2, 0.4, 0.6),
      br: wobble(0.85, 2.4, 0.38, 0.58),
      bl: wobble(1.05, 3.1, 0.44, 0.62),
    };
  });

  const squashX = useDerivedValue(() => {
    if (motionOff) return 1;
    return 1 + Math.sin(phase.value * 0.7 + 0.5) * 0.04 * morphAmp.value;
  });

  const squashY = useDerivedValue(() => {
    if (motionOff) return 1;
    return 1 + Math.sin(phase.value * 0.7 + 2.1) * 0.045 * morphAmp.value;
  });

  const flowT = useDerivedValue(() => {
    if (motionOff) return 0.5;
    return (Math.sin(phase.value * flowSpeed.value) + 1) / 2;
  });

  const ringAngle = useDerivedValue(() => {
    if (motionOff) return 0;
    return ((clock.value * ringSpeed.value) % 1) * 360;
  });

  const rippleScale = useDerivedValue(() => {
    if (motionOff || rippleAmp.value < 0.05) return 1;
    return 1 + ((Math.sin(phase.value * 2.2) + 1) / 2) * 0.22 * rippleAmp.value;
  });

  const rippleOpacity = useDerivedValue(() => {
    if (motionOff) return 0;
    return rippleAmp.value * (0.25 + ((Math.sin(phase.value * 2.2 + 1) + 1) / 2) * 0.35);
  });

  return {
    motionOff,
    phase,
    floatY,
    breathScale,
    morph,
    squashX,
    squashY,
    flowT,
    ringAngle,
    ringOpacity,
    particleEnergy,
    alertMix,
    rippleScale,
    rippleOpacity,
    burst,
  };
}

export type AgentPetAnimation = ReturnType<typeof useAgentPetAnimation>;
