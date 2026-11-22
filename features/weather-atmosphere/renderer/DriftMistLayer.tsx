/**
 * 飘云 / 雾气吹拂。
 * 云：扁长椭圆云团左→右循环；多云透日、阴/雨分层。
 * 雾：底层薄纱 + 稀疏细丝慢飘，避免「灰椭圆堆」观感。
 * 软边用 RadialGradient（固定尺寸），避免 Blur 马赛克。
 */
import { Group, Oval, RadialGradient, vec } from '@shopify/react-native-skia';
import React, { memo, useMemo } from 'react';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

export type DriftMistKind = 'cloud' | 'fog';

/** partly=多云透日；overcast=阴天厚云；storm=雨/雷（略轻于阴） */
export type CloudDensity = 'partly' | 'overcast' | 'storm';

type MistBlob = {
  ny: number;
  /** 相对云团锚点的水平偏移（相对画布宽） */
  localNx: number;
  size: number;
  stretchX: number;
  stretchY: number;
  speed: number;
  /** 同团相同 → 整团一起飘 */
  clusterPhase: number;
  opacity: number;
  rgb: string;
  ampY: number;
  depth: number;
  gustSpeed: number;
  gustPower: number;
};

export type DriftMistLayerProps = {
  kind: DriftMistKind;
  width: number;
  height: number;
  clock: SharedValue<number>;
  windSpeed?: number;
  opacity?: SharedValue<number>;
  parallaxX?: SharedValue<number>;
  parallaxY?: SharedValue<number>;
  isNight?: boolean;
  cloudDensity?: CloudDensity;
};

function cloudPalette(isNight: boolean) {
  if (isNight) {
    return {
      // 略收一点亮度，避免过厚发白
      hi: '210,220,236',
      mid: '176,190,212',
      lo: '152,168,192',
    };
  }
  // 白天：高对比近白 + 淡青灰阴影，压在蓝天上才看得出团块
  return {
    hi: '255,255,255',
    mid: '236,244,250',
    lo: '210,224,236',
  };
}

function buildPartlyCloudBlobs(isNight: boolean): MistBlob[] {
  const { hi, mid, lo } = cloudPalette(isNight);
  // 夜：略薄；昼：更高对比，团块轮廓清楚
  const core = isNight ? 0.52 : 0.62;
  const soft = isNight ? 0.36 : 0.42;
  const shade = isNight ? 0.28 : 0.28;

  const speedA = 0.044;
  const phaseA = 0.06;
  const speedB = 0.032;
  const phaseB = 0.4;
  const speedC = 0.054;
  const phaseC = 0.76;

  return [
    // —— 云团 A：主体 + 两侧瓣 + 底影 ——
    { ny: 0.19, localNx: 0, size: 0.2, stretchX: 1.55, stretchY: 0.62, speed: speedA, clusterPhase: phaseA, opacity: core, rgb: hi, ampY: 0.006, depth: 0.62, gustSpeed: 0, gustPower: 0 },
    { ny: 0.17, localNx: -0.09, size: 0.15, stretchX: 1.35, stretchY: 0.68, speed: speedA, clusterPhase: phaseA, opacity: soft, rgb: mid, ampY: 0.006, depth: 0.58, gustSpeed: 0, gustPower: 0 },
    { ny: 0.2, localNx: 0.1, size: 0.14, stretchX: 1.3, stretchY: 0.7, speed: speedA, clusterPhase: phaseA, opacity: soft, rgb: mid, ampY: 0.006, depth: 0.64, gustSpeed: 0, gustPower: 0 },
    { ny: 0.22, localNx: 0.02, size: 0.16, stretchX: 1.45, stretchY: 0.5, speed: speedA, clusterPhase: phaseA, opacity: shade, rgb: lo, ampY: 0.004, depth: 0.55, gustSpeed: 0, gustPower: 0 },

    // —— 云团 B ——
    { ny: 0.3, localNx: 0, size: 0.18, stretchX: 1.6, stretchY: 0.58, speed: speedB, clusterPhase: phaseB, opacity: core, rgb: hi, ampY: 0.008, depth: 0.44, gustSpeed: 0, gustPower: 0 },
    { ny: 0.28, localNx: -0.08, size: 0.13, stretchX: 1.28, stretchY: 0.66, speed: speedB, clusterPhase: phaseB, opacity: soft, rgb: mid, ampY: 0.008, depth: 0.4, gustSpeed: 0, gustPower: 0 },
    { ny: 0.31, localNx: 0.09, size: 0.12, stretchX: 1.25, stretchY: 0.68, speed: speedB, clusterPhase: phaseB, opacity: soft, rgb: mid, ampY: 0.008, depth: 0.46, gustSpeed: 0, gustPower: 0 },
    { ny: 0.33, localNx: 0.01, size: 0.14, stretchX: 1.4, stretchY: 0.48, speed: speedB, clusterPhase: phaseB, opacity: shade, rgb: lo, ampY: 0.005, depth: 0.38, gustSpeed: 0, gustPower: 0 },

    // —— 云团 C（近、稍快）——
    { ny: 0.13, localNx: 0, size: 0.15, stretchX: 1.45, stretchY: 0.64, speed: speedC, clusterPhase: phaseC, opacity: core, rgb: hi, ampY: 0.005, depth: 0.82, gustSpeed: 0, gustPower: 0 },
    { ny: 0.12, localNx: -0.07, size: 0.11, stretchX: 1.22, stretchY: 0.7, speed: speedC, clusterPhase: phaseC, opacity: soft, rgb: mid, ampY: 0.005, depth: 0.78, gustSpeed: 0, gustPower: 0 },
    { ny: 0.14, localNx: 0.08, size: 0.1, stretchX: 1.2, stretchY: 0.72, speed: speedC, clusterPhase: phaseC, opacity: soft, rgb: mid, ampY: 0.005, depth: 0.84, gustSpeed: 0, gustPower: 0 },
  ];
}

function buildOvercastCloudBlobs(isNight: boolean): MistBlob[] {
  const { hi, mid, lo } = cloudPalette(isNight);
  const op = (d: number, n: number) => (isNight ? n : d);
  return [
    { ny: 0.12, localNx: 0, size: 0.28, stretchX: 1.7, stretchY: 0.55, speed: 0.022, clusterPhase: 0.08, opacity: op(0.48, 0.58), rgb: hi, ampY: 0.004, depth: 0.55, gustSpeed: 0, gustPower: 0 },
    { ny: 0.1, localNx: -0.11, size: 0.2, stretchX: 1.4, stretchY: 0.6, speed: 0.022, clusterPhase: 0.08, opacity: op(0.38, 0.46), rgb: mid, ampY: 0.004, depth: 0.5, gustSpeed: 0, gustPower: 0 },
    { ny: 0.14, localNx: 0.12, size: 0.18, stretchX: 1.35, stretchY: 0.62, speed: 0.022, clusterPhase: 0.08, opacity: op(0.36, 0.44), rgb: mid, ampY: 0.004, depth: 0.58, gustSpeed: 0, gustPower: 0 },
    { ny: 0.16, localNx: 0.02, size: 0.22, stretchX: 1.55, stretchY: 0.45, speed: 0.022, clusterPhase: 0.08, opacity: op(0.28, 0.34), rgb: lo, ampY: 0.003, depth: 0.48, gustSpeed: 0, gustPower: 0 },

    { ny: 0.22, localNx: 0, size: 0.3, stretchX: 1.75, stretchY: 0.52, speed: 0.016, clusterPhase: 0.4, opacity: op(0.42, 0.52), rgb: hi, ampY: 0.005, depth: 0.42, gustSpeed: 0, gustPower: 0 },
    { ny: 0.2, localNx: -0.13, size: 0.22, stretchX: 1.45, stretchY: 0.58, speed: 0.016, clusterPhase: 0.4, opacity: op(0.34, 0.42), rgb: mid, ampY: 0.005, depth: 0.38, gustSpeed: 0, gustPower: 0 },
    { ny: 0.24, localNx: 0.14, size: 0.2, stretchX: 1.4, stretchY: 0.58, speed: 0.016, clusterPhase: 0.4, opacity: op(0.32, 0.4), rgb: mid, ampY: 0.005, depth: 0.45, gustSpeed: 0, gustPower: 0 },

    { ny: 0.08, localNx: 0, size: 0.16, stretchX: 1.35, stretchY: 0.6, speed: 0.028, clusterPhase: 0.72, opacity: op(0.34, 0.44), rgb: hi, ampY: 0.004, depth: 0.8, gustSpeed: 0, gustPower: 0 },
    { ny: 0.26, localNx: 0.04, size: 0.24, stretchX: 1.55, stretchY: 0.5, speed: 0.028, clusterPhase: 0.72, opacity: op(0.3, 0.4), rgb: lo, ampY: 0.005, depth: 0.65, gustSpeed: 0, gustPower: 0 },
  ];
}

function buildStormCloudBlobs(isNight: boolean): MistBlob[] {
  const hi = isNight ? '186,198,216' : '242,246,250';
  const mid = isNight ? '158,174,196' : '220,228,236';
  const lo = isNight ? '136,154,176' : '200,212,224';
  const op = (d: number, n: number) => (isNight ? n : d);
  return [
    { ny: 0.12, localNx: 0, size: 0.26, stretchX: 1.65, stretchY: 0.55, speed: 0.024, clusterPhase: 0.1, opacity: op(0.36, 0.5), rgb: hi, ampY: 0.004, depth: 0.55, gustSpeed: 0, gustPower: 0 },
    { ny: 0.1, localNx: -0.1, size: 0.18, stretchX: 1.35, stretchY: 0.6, speed: 0.024, clusterPhase: 0.1, opacity: op(0.28, 0.4), rgb: mid, ampY: 0.004, depth: 0.5, gustSpeed: 0, gustPower: 0 },
    { ny: 0.14, localNx: 0.11, size: 0.16, stretchX: 1.3, stretchY: 0.62, speed: 0.024, clusterPhase: 0.1, opacity: op(0.26, 0.38), rgb: mid, ampY: 0.004, depth: 0.58, gustSpeed: 0, gustPower: 0 },

    { ny: 0.22, localNx: 0, size: 0.28, stretchX: 1.7, stretchY: 0.5, speed: 0.018, clusterPhase: 0.48, opacity: op(0.3, 0.44), rgb: hi, ampY: 0.005, depth: 0.42, gustSpeed: 0, gustPower: 0 },
    { ny: 0.2, localNx: -0.11, size: 0.2, stretchX: 1.4, stretchY: 0.56, speed: 0.018, clusterPhase: 0.48, opacity: op(0.24, 0.36), rgb: lo, ampY: 0.005, depth: 0.38, gustSpeed: 0, gustPower: 0 },
    { ny: 0.24, localNx: 0.12, size: 0.17, stretchX: 1.32, stretchY: 0.58, speed: 0.018, clusterPhase: 0.48, opacity: op(0.22, 0.34), rgb: mid, ampY: 0.005, depth: 0.45, gustSpeed: 0, gustPower: 0 },

    { ny: 0.15, localNx: 0, size: 0.14, stretchX: 1.25, stretchY: 0.62, speed: 0.03, clusterPhase: 0.8, opacity: op(0.26, 0.4), rgb: mid, ampY: 0.004, depth: 0.72, gustSpeed: 0, gustPower: 0 },
  ];
}

function buildCloudBlobs(isNight: boolean, density: CloudDensity): MistBlob[] {
  if (density === 'partly') return buildPartlyCloudBlobs(isNight);
  if (density === 'storm') return buildStormCloudBlobs(isNight);
  return buildOvercastCloudBlobs(isNight);
}

/**
 * 雾：少而软。
 * - 底层宽纱贴地/中景，几乎不脉冲
 * - 上层细丝慢飘，轻呼吸
 * 颜色贴近天空，呈现霾感而非灰团。
 */
function buildFogBlobs(isNight: boolean): MistBlob[] {
  if (isNight) {
    return [
      // 底层薄纱（慢、宽、稳）
      { ny: 0.72, localNx: 0, size: 0.55, stretchX: 3.6, stretchY: 0.55, speed: 0.012, clusterPhase: 0.1, opacity: 0.38, rgb: '150,162,180', ampY: 0.006, depth: 0.35, gustSpeed: 0.12, gustPower: 0.6 },
      { ny: 0.58, localNx: 0, size: 0.48, stretchX: 3.4, stretchY: 0.5, speed: 0.016, clusterPhase: 0.45, opacity: 0.32, rgb: '168,178,196', ampY: 0.008, depth: 0.45, gustSpeed: 0.14, gustPower: 0.55 },
      { ny: 0.86, localNx: 0, size: 0.5, stretchX: 3.8, stretchY: 0.48, speed: 0.01, clusterPhase: 0.7, opacity: 0.34, rgb: '132,144,162', ampY: 0.005, depth: 0.3, gustSpeed: 0.1, gustPower: 0.5 },
      // 细丝
      { ny: 0.45, localNx: 0, size: 0.28, stretchX: 2.8, stretchY: 0.38, speed: 0.028, clusterPhase: 0.2, opacity: 0.26, rgb: '180,190,208', ampY: 0.012, depth: 0.7, gustSpeed: 0.22, gustPower: 0.7 },
      { ny: 0.5, localNx: 0, size: 0.24, stretchX: 2.4, stretchY: 0.36, speed: 0.034, clusterPhase: 0.55, opacity: 0.22, rgb: '160,172,190', ampY: 0.014, depth: 0.8, gustSpeed: 0.26, gustPower: 0.75 },
      { ny: 0.38, localNx: 0, size: 0.22, stretchX: 2.6, stretchY: 0.34, speed: 0.03, clusterPhase: 0.85, opacity: 0.2, rgb: '190,200,216', ampY: 0.01, depth: 0.75, gustSpeed: 0.2, gustPower: 0.65 },
    ];
  }

  return [
    { ny: 0.7, localNx: 0, size: 0.52, stretchX: 3.5, stretchY: 0.52, speed: 0.014, clusterPhase: 0.12, opacity: 0.36, rgb: '232,236,240', ampY: 0.006, depth: 0.35, gustSpeed: 0.12, gustPower: 0.55 },
    { ny: 0.55, localNx: 0, size: 0.46, stretchX: 3.3, stretchY: 0.48, speed: 0.018, clusterPhase: 0.4, opacity: 0.3, rgb: '220,226,232', ampY: 0.008, depth: 0.45, gustSpeed: 0.14, gustPower: 0.5 },
    { ny: 0.84, localNx: 0, size: 0.48, stretchX: 3.7, stretchY: 0.46, speed: 0.011, clusterPhase: 0.68, opacity: 0.32, rgb: '210,216,222', ampY: 0.005, depth: 0.3, gustSpeed: 0.1, gustPower: 0.45 },
    { ny: 0.42, localNx: 0, size: 0.26, stretchX: 2.7, stretchY: 0.36, speed: 0.03, clusterPhase: 0.22, opacity: 0.22, rgb: '240,244,248', ampY: 0.012, depth: 0.72, gustSpeed: 0.24, gustPower: 0.65 },
    { ny: 0.48, localNx: 0, size: 0.22, stretchX: 2.3, stretchY: 0.34, speed: 0.036, clusterPhase: 0.58, opacity: 0.18, rgb: '226,232,238', ampY: 0.014, depth: 0.82, gustSpeed: 0.28, gustPower: 0.7 },
    { ny: 0.36, localNx: 0, size: 0.2, stretchX: 2.5, stretchY: 0.32, speed: 0.032, clusterPhase: 0.88, opacity: 0.16, rgb: '248,250,252', ampY: 0.01, depth: 0.78, gustSpeed: 0.22, gustPower: 0.6 },
  ];
}

function MistBlobNode({
  blob,
  kind,
  width,
  height,
  clock,
  windSpeed,
  opacityMul,
  parallaxX,
  parallaxY,
  isNight,
}: {
  blob: MistBlob;
  kind: DriftMistKind;
  width: number;
  height: number;
  clock: SharedValue<number>;
  windSpeed: number;
  opacityMul: SharedValue<number>;
  parallaxX?: SharedValue<number>;
  parallaxY?: SharedValue<number>;
  isNight: boolean;
}) {
  const minSide = Math.min(width, height);
  const baseR = blob.size * minSide;
  const rw = baseR * blob.stretchX;
  const rh = baseR * blob.stretchY;

  const cx = useDerivedValue(() => {
    const windBoost = kind === 'fog' ? 0.014 : 0.012;
    const windAdd = Math.max(0, windSpeed) * windBoost * blob.depth;
    const pxPerSec = blob.speed * width * 0.55 + windAdd;
    const span = width + rw * 2.8;
    const drift = clock.value * pxPerSec + blob.clusterPhase * span;
    const anchorX = ((drift % span) + span) % span - rw * 1.35;
    return (
      anchorX +
      blob.localNx * width +
      (parallaxX?.value ?? 0) * 16 * blob.depth
    );
  });

  const cy = useDerivedValue(() => {
    const breathe =
      height * blob.ny + Math.sin(clock.value * 0.16 + blob.clusterPhase * 6) * height * blob.ampY;
    return breathe + (parallaxY?.value ?? 0) * 8 * blob.depth;
  });

  const center = useDerivedValue(() => vec(cx.value, cy.value));

  const rect = useDerivedValue(() => ({
    x: cx.value - rw,
    y: cy.value - rh,
    width: rw * 2,
    height: rh * 2,
  }));

  const opacity = useDerivedValue(() => {
    let gust = 1;
    if (blob.gustSpeed > 0) {
      const s = Math.sin(clock.value * blob.gustSpeed + blob.clusterPhase * 6);
      const wave = Math.pow(Math.max(0, s), blob.gustPower);
      // 雾：轻呼吸，不要大起大落
      gust = kind === 'fog' ? 0.78 + 0.22 * wave : 0.55 + 0.45 * wave;
    }
    return blob.opacity * gust * opacityMul.value;
  });

  const fogLike = kind === 'fog';
  // 云：核更实、边更收，白天团块轮廓清楚；雾：更散更淡
  const coreA = fogLike ? (isNight ? 0.7 : 0.65) : isNight ? 0.95 : 1;
  const midA = fogLike ? (isNight ? 0.35 : 0.32) : isNight ? 0.5 : 0.55;
  const midPos = fogLike ? 0.4 : isNight ? 0.38 : 0.36;
  const gradR = Math.max(rw, rh) * (fogLike ? 1.05 : 0.95);

  const core = `rgba(${blob.rgb}, ${coreA})`;
  const mid = `rgba(${blob.rgb}, ${midA})`;
  const edge = `rgba(${blob.rgb}, 0)`;

  return (
    <Oval rect={rect} opacity={opacity}>
      <RadialGradient
        c={center}
        r={gradR}
        colors={[core, mid, edge]}
        positions={[0, midPos, 1]}
      />
    </Oval>
  );
}

function DriftMistLayerInner({
  kind,
  width,
  height,
  clock,
  windSpeed = 0,
  opacity,
  parallaxX,
  parallaxY,
  isNight = false,
  cloudDensity = 'overcast',
}: DriftMistLayerProps) {
  const blobs = useMemo(
    () => (kind === 'fog' ? buildFogBlobs(isNight) : buildCloudBlobs(isNight, cloudDensity)),
    [kind, isNight, cloudDensity],
  );

  const opacityMul = useDerivedValue(() => opacity?.value ?? 1);

  return (
    <Group>
      {blobs.map((blob, i) => (
        <MistBlobNode
          key={`${kind}-${cloudDensity}-${i}-${blob.clusterPhase}-${blob.localNx}`}
          blob={blob}
          kind={kind}
          width={width}
          height={height}
          clock={clock}
          windSpeed={windSpeed}
          opacityMul={opacityMul}
          parallaxX={parallaxX}
          parallaxY={parallaxY}
          isNight={isNight}
        />
      ))}
    </Group>
  );
}

export const DriftMistLayer = memo(DriftMistLayerInner);
