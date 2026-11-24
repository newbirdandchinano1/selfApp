/**
 * 液态能量精灵渲染器（Native MVP）。
 * 预留 engine 接口，后续可用 Rive 替换主体而不改手势/业务层。
 */
import type { AgentPetAnimation } from '@/components/agent-pet/hooks/useAgentPetAnimation';
import {
  AGENT_PET_SIZE,
  type AgentPetRenderEngine,
  type AgentPetVisualState,
} from '@/components/agent-pet/types/agentPet.types';
import { useAppTheme } from '@/hooks/use-app-theme';
import React from 'react';
import { Image, type ImageSourcePropType, StyleSheet, View } from 'react-native';
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedStyle,
} from 'react-native-reanimated';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  LinearGradient,
  RadialGradient,
  Stop,
} from 'react-native-svg';

const AnimatedView = Animated.View;
const AnimatedImage = Animated.createAnimatedComponent(Image);

type Props = {
  size?: number;
  state: AgentPetVisualState;
  anim: AgentPetAnimation;
  /** 预留：'rive' 时走占位/未来实现 */
  engine?: AgentPetRenderEngine;
  /** 自定义图片：有值时用图片主体，仍保留浮动/呼吸动效 */
  imageSource?: ImageSourcePropType;
};

const PARTICLE_SEEDS = [
  { a: 0.2, r: 0.38, s: 3.2 },
  { a: 1.1, r: 0.44, s: 2.4 },
  { a: 2.3, r: 0.36, s: 2.8 },
  { a: 3.4, r: 0.48, s: 2.1 },
  { a: 4.6, r: 0.4, s: 2.6 },
  { a: 5.5, r: 0.42, s: 2.2 },
];

function NativeLiquidSpirit({
  size,
  anim,
}: {
  size: number;
  anim: AgentPetAnimation;
}) {
  const { isDark } = useAppTheme();
  const half = size / 2;

  // 品牌：松绿核心 + 琥珀能量，避免通用蓝光球
  const pineDeep = isDark ? '#2F5A4C' : '#1E3932';
  const pineMid = isDark ? '#4A7A68' : '#2F5A4C';
  const sage = isDark ? '#A9C7B9' : '#7FA695';
  const amber = isDark ? '#E0B072' : '#E0B35A';
  const amberSoft = isDark ? 'rgba(224,176,114,0.55)' : 'rgba(224,179,90,0.5)';
  const glass = isDark ? 'rgba(220,233,221,0.22)' : 'rgba(255,255,255,0.38)';
  const warn = '#C47852';

  const bodyStyle = useAnimatedStyle(() => {
    const m = anim.morph.value;
    const r = size * 0.5;
    return {
      transform: [
        { translateY: anim.floatY.value },
        { scale: anim.breathScale.value },
        { scaleX: anim.squashX.value },
        { scaleY: anim.squashY.value },
      ],
      borderTopLeftRadius: r * m.tl,
      borderTopRightRadius: r * m.tr,
      borderBottomRightRadius: r * m.br,
      borderBottomLeftRadius: r * m.bl,
      backgroundColor: interpolateColor(
        anim.alertMix.value,
        [0, 1],
        [pineDeep, warn],
      ),
    };
  });

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(anim.breathScale.value, [0.88, 1.2], [0.35, 0.7]),
    transform: [
      { translateY: anim.floatY.value * 0.6 },
      { scale: anim.breathScale.value * 1.18 },
    ],
  }));

  const innerFlowStyle = useAnimatedStyle(() => {
    const t = anim.flowT.value;
    return {
      opacity: 0.55 + t * 0.35,
      transform: [
        { translateX: interpolate(t, [0, 1], [-size * 0.12, size * 0.1]) },
        { translateY: interpolate(t, [0, 1], [size * 0.08, -size * 0.1]) },
        { scale: 0.85 + t * 0.25 },
      ],
    };
  });

  const highlightStyle = useAnimatedStyle(() => ({
    opacity: 0.45 + anim.flowT.value * 0.3,
    transform: [
      {
        translateX: interpolate(anim.flowT.value, [0, 1], [-2, 3]),
      },
      {
        translateY: interpolate(anim.flowT.value, [0, 1], [-1, 2]),
      },
    ],
  }));

  const ringStyle = useAnimatedStyle(() => ({
    opacity: anim.ringOpacity.value,
    transform: [
      { translateY: anim.floatY.value },
      { rotate: `${anim.ringAngle.value}deg` },
      { scale: anim.breathScale.value },
    ],
  }));

  const ring2Style = useAnimatedStyle(() => ({
    opacity: anim.ringOpacity.value * 0.55,
    transform: [
      { translateY: anim.floatY.value },
      { rotate: `${-anim.ringAngle.value * 0.7}deg` },
      { scale: anim.breathScale.value * 1.08 },
    ],
  }));

  const rippleStyle = useAnimatedStyle(() => ({
    opacity: anim.rippleOpacity.value,
    transform: [
      { translateY: anim.floatY.value },
      { scale: anim.rippleScale.value },
    ],
  }));

  const burstStyle = useAnimatedStyle(() => ({
    opacity: anim.burst.value * 0.55,
    transform: [
      { translateY: anim.floatY.value },
      { scale: 1 + anim.burst.value * 0.85 },
    ],
  }));

  const coreTintStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      anim.alertMix.value,
      [0, 0.5, 1],
      [pineMid, amber, warn],
    ),
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      {/* 外晕 */}
      <AnimatedView
        style={[
          styles.glow,
          {
            width: size * 1.35,
            height: size * 1.35,
            borderRadius: size,
            backgroundColor: isDark ? 'rgba(127,166,149,0.28)' : 'rgba(127,166,149,0.32)',
          },
          glowStyle,
        ]}
      />

      {/* 成功扩散 */}
      <AnimatedView
        style={[
          styles.ripple,
          {
            width: size * 1.15,
            height: size * 1.15,
            borderRadius: size,
            borderColor: amberSoft,
          },
          burstStyle,
        ]}
      />

      {/* 倾听波纹 */}
      <AnimatedView
        style={[
          styles.ripple,
          {
            width: size * 1.05,
            height: size * 1.05,
            borderRadius: size,
            borderColor: sage,
          },
          rippleStyle,
        ]}
      />

      {/* 能量环 */}
      <AnimatedView
        style={[
          styles.ring,
          {
            width: size * 1.12,
            height: size * 1.12,
            borderRadius: size,
            borderColor: amberSoft,
          },
          ringStyle,
        ]}
      />
      <AnimatedView
        style={[
          styles.ringDashed,
          {
            width: size * 1.22,
            height: size * 1.22,
            borderRadius: size,
            borderColor: 'rgba(169,199,185,0.45)',
          },
          ring2Style,
        ]}
      />

      {/* 主体 */}
      <AnimatedView style={[styles.body, { width: size * 0.78, height: size * 0.78 }, bodyStyle]}>
        <AnimatedView style={[styles.coreFill, coreTintStyle]} />

        {/* 玻璃高光层 */}
        <AnimatedView style={[styles.glassCap, highlightStyle]}>
          <View style={[styles.glassBlob, { backgroundColor: glass }]} />
        </AnimatedView>

        {/* 内部光流 */}
        <AnimatedView style={[styles.flowWrap, innerFlowStyle]}>
          <View
            style={[
              styles.flowBlob,
              {
                backgroundColor: amber,
                shadowColor: amber,
              },
            ]}
          />
          <View
            style={[
              styles.flowBlobSecondary,
              { backgroundColor: sage },
            ]}
          />
        </AnimatedView>

        {/* SVG 径向层次：增强液态玻璃感 */}
        <Svg width={size * 0.78} height={size * 0.78} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="spiritCore" cx="38%" cy="32%" r="65%">
              <Stop offset="0%" stopColor="#F5F0E6" stopOpacity={0.42} />
              <Stop offset="35%" stopColor={amber} stopOpacity={0.22} />
              <Stop offset="70%" stopColor={pineMid} stopOpacity={0.15} />
              <Stop offset="100%" stopColor="#0B1A15" stopOpacity={0.35} />
            </RadialGradient>
            <LinearGradient id="spiritSheen" x1="0%" y1="0%" x2="100%" y2="100%">
              <Stop offset="0%" stopColor="#FFFFFF" stopOpacity={0.28} />
              <Stop offset="45%" stopColor="#FFFFFF" stopOpacity={0} />
              <Stop offset="100%" stopColor={amber} stopOpacity={0.12} />
            </LinearGradient>
          </Defs>
          <Ellipse
            cx={size * 0.39}
            cy={size * 0.39}
            rx={size * 0.36}
            ry={size * 0.34}
            fill="url(#spiritCore)"
          />
          <Ellipse
            cx={size * 0.39}
            cy={size * 0.39}
            rx={size * 0.36}
            ry={size * 0.34}
            fill="url(#spiritSheen)"
          />
          <Circle
            cx={size * 0.28}
            cy={size * 0.24}
            r={size * 0.08}
            fill="#FFFFFF"
            opacity={0.35}
          />
        </Svg>

        {/* 边缘玻璃描边 */}
        <View style={[styles.rim, { borderColor: isDark ? 'rgba(220,233,221,0.2)' : 'rgba(255,255,255,0.28)' }]} />
      </AnimatedView>

      {/* 粒子 */}
      {PARTICLE_SEEDS.map((p, i) => (
        <PetParticle
          key={i}
          size={size}
          half={half}
          seed={p}
          anim={anim}
          color={i % 2 === 0 ? amber : sage}
        />
      ))}
    </View>
  );
}

function PetParticle({
  size,
  half,
  seed,
  anim,
  color,
}: {
  size: number;
  half: number;
  seed: { a: number; r: number; s: number };
  anim: AgentPetAnimation;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const energy = anim.particleEnergy.value;
    const gather = energy > 0.55 ? 0.72 : 1;
    const orbit = anim.phase.value * (0.55 + energy * 0.9) + seed.a;
    const radius = size * seed.r * gather * (0.85 + energy * 0.25);
    const burstExtra = anim.burst.value * size * 0.35;
    const px = Math.cos(orbit) * (radius + burstExtra);
    const py = Math.sin(orbit) * (radius + burstExtra) + anim.floatY.value * 0.4;
    const opacity = 0.15 + energy * 0.55 + anim.burst.value * 0.35;
    const scale = seed.s / 3.2 * (0.65 + energy * 0.55 + anim.burst.value * 0.4);
    return {
      opacity,
      transform: [
        { translateX: px },
        { translateY: py },
        { scale },
      ],
    };
  });

  return (
    <AnimatedView
      style={[
        styles.particle,
        {
          left: half - seed.s / 2,
          top: half - seed.s / 2,
          width: seed.s,
          height: seed.s,
          borderRadius: seed.s,
          backgroundColor: color,
          shadowColor: color,
        },
        style,
      ]}
    />
  );
}

/**
 * 自定义图片主体：保留浮动 / 呼吸 / 轻形变，方便直接换图。
 */
function ImageSpirit({
  size,
  anim,
  source,
}: {
  size: number;
  anim: AgentPetAnimation;
  source: ImageSourcePropType;
}) {
  const wrapStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: anim.floatY.value },
      { scale: anim.breathScale.value },
      { scaleX: anim.squashX.value },
      { scaleY: anim.squashY.value },
    ],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: interpolate(anim.breathScale.value, [0.88, 1.2], [0.25, 0.55]),
    transform: [
      { translateY: anim.floatY.value * 0.6 },
      { scale: anim.breathScale.value * 1.12 },
    ],
  }));

  return (
    <View style={[styles.wrap, { width: size, height: size }]} pointerEvents="none">
      <AnimatedView
        style={[
          styles.glow,
          {
            width: size * 1.2,
            height: size * 1.2,
            borderRadius: size,
            backgroundColor: 'rgba(127,166,149,0.28)',
          },
          glowStyle,
        ]}
      />
      <AnimatedImage
        source={source}
        resizeMode="contain"
        style={[{ width: size, height: size }, wrapStyle]}
      />
    </View>
  );
}

/**
 * Rive 占位：素材就绪后在此接入；当前回退 native。
 */
function RiveSpiritPlaceholder({ size, anim }: { size: number; anim: AgentPetAnimation }) {
  return <NativeLiquidSpirit size={size} anim={anim} />;
}

export function PetRenderer({
  size = AGENT_PET_SIZE,
  state: _state,
  anim,
  engine = 'native',
  imageSource,
}: Props) {
  // _state：Rive 状态机映射预留；native 路径由 anim 参数连续驱动
  if (imageSource) {
    return <ImageSpirit size={size} anim={anim} source={imageSource} />;
  }
  if (engine === 'rive') {
    return <RiveSpiritPlaceholder size={size} anim={anim} />;
  }
  return <NativeLiquidSpirit size={size} anim={anim} />;
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
  },
  ripple: {
    position: 'absolute',
    borderWidth: 1.5,
    backgroundColor: 'transparent',
  },
  ring: {
    position: 'absolute',
    borderWidth: 1.2,
    borderTopColor: 'transparent',
    borderLeftColor: 'transparent',
    backgroundColor: 'transparent',
  },
  ringDashed: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth + 0.6,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  body: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  coreFill: {
    ...StyleSheet.absoluteFill,
    opacity: 0.55,
  },
  glassCap: {
    ...StyleSheet.absoluteFill,
  },
  glassBlob: {
    position: 'absolute',
    top: '8%',
    left: '14%',
    width: '52%',
    height: '34%',
    borderRadius: 999,
  },
  flowWrap: {
    position: 'absolute',
    width: '70%',
    height: '70%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flowBlob: {
    width: '58%',
    height: '42%',
    borderRadius: 999,
    opacity: 0.55,
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  flowBlobSecondary: {
    position: 'absolute',
    width: '36%',
    height: '28%',
    borderRadius: 999,
    opacity: 0.4,
    top: '48%',
    right: '8%',
  },
  rim: {
    ...StyleSheet.absoluteFill,
    borderWidth: 1.5,
    borderRadius: 999,
  },
  particle: {
    position: 'absolute',
    shadowOpacity: 0.45,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
});
