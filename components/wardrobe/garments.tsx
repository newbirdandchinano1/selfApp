import type { WardrobeArt, WardrobeItem } from '@/components/wardrobe/data';
import { StoredImage } from '@/components/stored-image';
import React, { memo } from 'react';
import Svg, { Circle, G, Path } from 'react-native-svg';

type GarmentProps = {
  item: Pick<WardrobeItem, 'art' | 'tint' | 'tint2' | 'line'> & {
    cutout_uri?: string;
    image_uri?: string;
  };
  width?: number;
  height?: number;
};

function Hoodie({ tint, tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M41 33c-11 4-18 13-22 25L11 73l14 6 7-16v48c0 4 3 7 7 7h42c4 0 7-3 7-7V63l7 16 14-6-8-15c-4-12-11-21-22-25-6 3-12 4-19 4s-13-1-19-4Z" />
        <Path d="M41 32c-1-12 9-20 19-20s20 8 19 20c-6 6-12 9-19 9s-13-3-19-9Z" fill={tint} />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M47 84h26v16c0 4-4 7-13 7s-13-3-13-7V84Z" />
        <Path d="M55 38v14M65 38v14" />
        <Path d="M33 61c4 4 8 6 14 7M87 61c-4 4-8 6-14 7" opacity={0.5} />
      </G>
    </>
  );
}

function Knit({ tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M41 34 25 42 13 72l14 6 8-17v51h50V61l8 17 14-6-12-30-16-8-14 18-14-18Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M46 34l14 18 14-18" />
        <Path d="M60 54v55" />
        <Circle cx={60} cy={64} r={1.5} fill={line} stroke="none" />
        <Circle cx={60} cy={78} r={1.5} fill={line} stroke="none" />
        <Circle cx={60} cy={92} r={1.5} fill={line} stroke="none" />
        <Path d="M37 109V93h13v16M70 93h13v16" opacity={0.65} />
      </G>
    </>
  );
}

function Shirt({ tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M44 32 27 40 14 70l13 6 9-18v55h48V58l9 18 13-6-13-30-17-8-12 15-12-15Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M44 32l16 17 16-17" />
        <Path d="M50 34l10 14 10-14" />
        <Path d="M60 49v57" />
        <Circle cx={60} cy={61} r={1.4} fill={line} stroke="none" />
        <Circle cx={60} cy={76} r={1.4} fill={line} stroke="none" />
        <Circle cx={60} cy={91} r={1.4} fill={line} stroke="none" />
        <Path d="M70 62h9v11h-9z" opacity={0.55} />
      </G>
    </>
  );
}

function Pants({ tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M39 31h42l6 94H67l-7-56-7 56H33l6-94Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M39 43h42" />
        <Path d="M60 43v17" opacity={0.55} />
        <Path d="M43 34v-5M77 34v-5" />
      </G>
    </>
  );
}

function Jeans({ tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M39 31h42l6 94H67l-7-56-7 56H33l6-94Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.9}>
        <Path d="M39 43h42" />
        <Path d="M41 34v94M79 34v94" strokeDasharray="2 3" opacity={0.7} />
        <Path d="M60 43v17" opacity={0.55} />
        <Circle cx={60} cy={38} r={1.8} fill={line} stroke="none" />
      </G>
    </>
  );
}

function Skirt({ tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M42 34h36l13 79H29l13-79Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M42 43h36" />
        <Path d="M48 43l-5 70M60 43v70M72 43l5 70" opacity={0.6} />
      </G>
    </>
  );
}

function Coat({ tint, tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M42 33 26 41 12 81l13 5 9-21v54h52V65l9 21 13-5-14-40-16-8-13 18-13-18Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M47 33l13 19 13-19" />
        <Path d="M60 52v66" />
        <Path d="M37 84h46" />
        <Path d="M52 84h16v9H52z" fill={tint} />
        <Circle cx={60} cy={88.5} r={1.4} fill={line} stroke="none" />
      </G>
    </>
  );
}

function Jacket({ tint, tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M42 34 26 42 14 70l13 6 9-18v45h48V58l9 18 13-6-12-28-16-8-13 10-13-10Z" />
        <Path d="M32 104h56v7H32z" fill={tint} />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M47 34l13 10 13-10" />
        <Path d="M60 44v60" />
        <Path d="M70 62h10v12H70z" opacity={0.55} />
      </G>
    </>
  );
}

function Dress({ tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M44 33 31 40l-6 20 9 3 4-12-4 24 12 44h28l12-44-4-24 4 12 9-3-6-20-13-7-12 15-12-15Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M48 33l12 15 12-15" />
        <Path d="M60 48v29M45 77h30" opacity={0.7} />
      </G>
    </>
  );
}

function Suit({ tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M42 33 26 41 14 72l13 6 8-17v49h50V61l8 17 13-6-12-31-16-8-13 18-13-18Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M47 33l13 18 13-18" />
        <Path d="M47 33l7 25 6-7-7-18M73 33l-7 25-6-7 7-18" />
        <Path d="M60 52v58" />
        <Circle cx={60} cy={70} r={1.4} fill={line} stroke="none" />
        <Circle cx={60} cy={85} r={1.4} fill={line} stroke="none" />
      </G>
    </>
  );
}

function Sneaker({ tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M17 92c1-7 5-11 13-12l14-2 8-20 13 4-3 18 16 5 14 2c7 1 11 5 11 11v4H17v-10Z" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M44 79c8 4 18 6 30 7M27 87h66" />
        <Path d="M52 58l5-12 8 2-3 12" opacity={0.7} />
      </G>
    </>
  );
}

function Bag({ tint, tint2, line }: { tint: string; tint2: string; line: string }) {
  return (
    <>
      <G fill={tint2} stroke={line} strokeWidth={1.7} strokeLinejoin="round" strokeLinecap="round">
        <Path d="M28 53h64l7 60H21l7-60Z" />
        <Path d="M43 53V37c0-11 34-11 34 0v16" fill="none" />
      </G>
      <G fill="none" stroke={line} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85}>
        <Path d="M28 64h64" opacity={0.5} />
        <Path d="M51 79h18v12H51z" fill={tint} />
      </G>
    </>
  );
}

const ART_MAP: Record<
  WardrobeArt,
  React.FC<{ tint: string; tint2: string; line: string }>
> = {
  hoodie: Hoodie,
  knit: Knit,
  shirt: Shirt,
  pants: Pants,
  jeans: Jeans,
  skirt: Skirt,
  coat: Coat,
  jacket: Jacket,
  dress: Dress,
  suit: Suit,
  sneaker: Sneaker,
  bag: Bag,
};

/** 优先抠图 / 主图；无图时回退线稿 SVG（对齐设计稿 symbol） */
export const WardrobeGarment = memo(function WardrobeGarment({
  item,
  width = 72,
  height = 84,
}: GarmentProps) {
  const photo = item.cutout_uri?.trim() || item.image_uri?.trim();
  if (photo) {
    return (
      <StoredImage
        uri={photo}
        style={{ width, height }}
        contentFit="contain"
      />
    );
  }
  const Art = ART_MAP[item.art] ?? Hoodie;
  return (
    <Svg width={width} height={height} viewBox="0 0 120 140">
      <Art tint={item.tint} tint2={item.tint2} line={item.line} />
    </Svg>
  );
});
