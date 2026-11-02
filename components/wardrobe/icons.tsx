import { WARDROBE } from '@/constants/wardrobe-theme';
import React, { memo } from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type WardrobeIconProps = {
  size?: number;
  color?: string;
};

type IconDraw = (p: { s: number; c: string }) => React.ReactNode;

function makeIcon(draw: IconDraw, displayName: string) {
  const Comp = memo(function WardrobeIcon({ size = 18, color = WARDROBE.ink2 }: WardrobeIconProps) {
    return (
      <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
        {draw({ s: size, c: color })}
      </Svg>
    );
  });
  Comp.displayName = displayName;
  return Comp;
}

const stroke = (color: string, width = 1.7) => ({
  stroke: color,
  strokeWidth: width,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  fill: 'none' as const,
});

export const IconBack = makeIcon(
  ({ c }) => <Path d="M15 5l-7 7 7 7M8 12h11" {...stroke(c)} />,
  'IconBack',
);

export const IconGrid = makeIcon(
  ({ c }) => (
    <>
      <Rect x={3} y={3} width={7} height={7} rx={1.6} {...stroke(c)} />
      <Rect x={14} y={3} width={7} height={7} rx={1.6} {...stroke(c)} />
      <Rect x={3} y={14} width={7} height={7} rx={1.6} {...stroke(c)} />
      <Rect x={14} y={14} width={7} height={7} rx={1.6} {...stroke(c)} />
    </>
  ),
  'IconGrid',
);

export const IconSearch = makeIcon(
  ({ c }) => (
    <>
      <Circle cx={11} cy={11} r={6.5} {...stroke(c)} />
      <Path d="M19.5 19.5l-3.2-3.2" {...stroke(c)} />
    </>
  ),
  'IconSearch',
);

export const IconMore = makeIcon(
  ({ c }) => (
    <>
      <Circle cx={5.5} cy={12} r={1.2} fill={c} stroke="none" />
      <Circle cx={12} cy={12} r={1.2} fill={c} stroke="none" />
      <Circle cx={18.5} cy={12} r={1.2} fill={c} stroke="none" />
    </>
  ),
  'IconMore',
);

export const IconPlus = makeIcon(
  ({ c }) => <Path d="M12 5v14M5 12h14" {...stroke(c)} />,
  'IconPlus',
);

export const IconArrow = makeIcon(
  ({ c }) => <Path d="M5 12h14M14 7l5 5-5 5" {...stroke(c)} />,
  'IconArrow',
);

export const IconHanger = makeIcon(
  ({ c }) => (
    <Path
      d="M12 5.5a2.3 2.3 0 1 1 2.3 2.3c-.7 0-1.2.5-1.2 1.2v1.1l6.3 4.6c1.1.8.5 2.5-.9 2.5H5.5c-1.4 0-2-1.7-.9-2.5l6.7-4.9v-.8c0-1 .5-1.5 1.5-1.5"
      {...stroke(c, 1.5)}
    />
  ),
  'IconHanger',
);

export const IconFilter = makeIcon(
  ({ c }) => (
    <>
      <Path d="M4 7h10M18 7h2M4 17h2M10 17h10" {...stroke(c)} />
      <Circle cx={16} cy={7} r={2} {...stroke(c)} />
      <Circle cx={8} cy={17} r={2} {...stroke(c)} />
    </>
  ),
  'IconFilter',
);

export const IconGear = makeIcon(
  ({ c }) => (
    <>
      <Circle cx={12} cy={12} r={3} {...stroke(c)} />
      <Path
        d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.5v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H6.4v-2.5h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2H15v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z"
        {...stroke(c, 1.5)}
      />
    </>
  ),
  'IconGear',
);

export const IconClose = makeIcon(
  ({ c }) => <Path d="M6 6l12 12M18 6L6 18" {...stroke(c)} />,
  'IconClose',
);

export const IconCheck = makeIcon(
  ({ c }) => <Path d="M5 12l5 5L20 7" {...stroke(c, 2)} />,
  'IconCheck',
);

export const IconCamera = makeIcon(
  ({ c }) => (
    <>
      <Path d="M4 8h4l1.5-2h5L16 8h4v11H4V8Z" {...stroke(c)} />
      <Circle cx={12} cy={13.5} r={3.2} {...stroke(c)} />
    </>
  ),
  'IconCamera',
);

export const IconImage = makeIcon(
  ({ c }) => (
    <>
      <Rect x={3.5} y={4.5} width={17} height={15} rx={2} {...stroke(c)} />
      <Circle cx={8.5} cy={9.5} r={1.5} {...stroke(c)} />
      <Path d="m5 17 4.5-4.5 3 3 2.5-2.5L20 18" {...stroke(c)} />
    </>
  ),
  'IconImage',
);

export const IconLink = makeIcon(
  ({ c }) => (
    <Path
      d="M10 14a4 4 0 0 1 0-5.6l2-2a4 4 0 0 1 5.6 5.6l-1.2 1.2M14 10a4 4 0 0 1 0 5.6l-2 2A4 4 0 0 1 6.4 12l1.2-1.2"
      {...stroke(c)}
    />
  ),
  'IconLink',
);

export const IconClip = makeIcon(
  ({ c }) => (
    <>
      <Rect x={6} y={5} width={12} height={16} rx={2} {...stroke(c)} />
      <Path d="M9 5V3.5h6V5M9 10h6M9 14h6" {...stroke(c)} />
    </>
  ),
  'IconClip',
);

export const IconLayers = makeIcon(
  ({ c }) => (
    <>
      <Path d="m12 3 9 5-9 5-9-5 9-5Z" {...stroke(c)} />
      <Path d="m4 12 8 4.5 8-4.5M4 16l8 4.5 8-4.5" {...stroke(c)} />
    </>
  ),
  'IconLayers',
);

export const IconSparkle = makeIcon(
  ({ c }) => (
    <>
      <Path d="M12 3.5l1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7L5.5 10l4.7-1.8L12 3.5Z" {...stroke(c)} />
      <Path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8Z" {...stroke(c)} />
    </>
  ),
  'IconSparkle',
);

export const IconBox = makeIcon(
  ({ c }) => (
    <>
      <Path d="m4 7.5 8-4 8 4v9l-8 4-8-4v-9Z" {...stroke(c)} />
      <Path d="M4 7.5 12 12l8-4.5M12 12v8.5" {...stroke(c)} />
    </>
  ),
  'IconBox',
);

export const IconCloset = makeIcon(
  ({ c }) => (
    <>
      <Path d="M4 8.5 12 3l8 5.5M5.5 8v12h13V8M9.5 20v-5h5v5" {...stroke(c, 1.5)} />
    </>
  ),
  'IconCloset',
);

export const IconTag = makeIcon(
  ({ c }) => (
    <>
      <Path d="M20.5 13 13 20.5 3.5 11V3.5H11L20.5 13Z" {...stroke(c)} />
      <Circle cx={7.5} cy={7.5} r={1} fill={c} stroke="none" />
    </>
  ),
  'IconTag',
);

export const IconPalette = makeIcon(
  ({ c }) => (
    <>
      <Path
        d="M12 3a9 9 0 1 0 0 18h1.2c1.4 0 2.2-1.4 1.4-2.5-.7-1-.1-2.5 1.2-2.5H18a3 3 0 0 0 3-3C21 7.5 17 3 12 3Z"
        {...stroke(c)}
      />
      <Circle cx={7.5} cy={11} r={1} fill={c} stroke="none" />
      <Circle cx={11} cy={7.5} r={1} fill={c} stroke="none" />
      <Circle cx={16} cy={9} r={1} fill={c} stroke="none" />
    </>
  ),
  'IconPalette',
);

export const IconSeason = makeIcon(
  ({ c }) => (
    <Path d="M12 3v18M4.5 7.5l15 9M4.5 16.5l15-9M8 4.5l4 2 4-2M8 19.5l4-2 4 2" {...stroke(c)} />
  ),
  'IconSeason',
);

export const IconChart = makeIcon(
  ({ c }) => (
    <>
      <Path d="M4 19V5M4 19h17" {...stroke(c)} />
      <Path d="m7 15 4-4 3 2 6-7" {...stroke(c)} />
      <Path d="M16 6h4v4" {...stroke(c)} />
    </>
  ),
  'IconChart',
);

export const IconHeart = makeIcon(
  ({ c }) => (
    <Path
      d="M20.5 8.8c0 4.2-8.5 10-8.5 10s-8.5-5.8-8.5-10A4.3 4.3 0 0 1 12 6.5a4.3 4.3 0 0 1 8.5 2.3Z"
      {...stroke(c)}
    />
  ),
  'IconHeart',
);

export const IconSettings = IconGear;

export const IconDoubleCols = makeIcon(
  ({ c }) => (
    <>
      <Rect x={3} y={4} width={8} height={16} rx={1.5} {...stroke(c)} />
      <Rect x={13} y={4} width={8} height={16} rx={1.5} {...stroke(c)} />
    </>
  ),
  'IconDoubleCols',
);

export const IconSingleCol = makeIcon(
  ({ c }) => <Rect x={5} y={4} width={14} height={16} rx={2} {...stroke(c)} />,
  'IconSingleCol',
);

export const IconSort = makeIcon(
  ({ c }) => (
    <Path d="M8 5v14M8 5l-3 3M8 5l3 3M16 19V5M16 19l-3-3M16 19l3-3" {...stroke(c)} />
  ),
  'IconSort',
);

export const IconFolderPlus = makeIcon(
  ({ c }) => (
    <>
      <Path d="M4 7h6l2 2h8v10H4V7z" {...stroke(c)} />
      <Path d="M17 13v5M14.5 15.5h5" {...stroke(c)} />
    </>
  ),
  'IconFolderPlus',
);

export const IconLooks = makeIcon(
  ({ c }) => (
    <>
      <Rect x={4} y={4} width={12} height={15} rx={2} {...stroke(c, 1.6)} />
      <Path d="M8 2.5h12v15" {...stroke(c, 1.6)} />
      <Path d="M8.5 9h3M8.5 12.5h3" {...stroke(c, 1.6)} />
    </>
  ),
  'IconLooks',
);

export const IconPerson = makeIcon(
  ({ c }) => (
    <>
      <Circle cx={12} cy={8} r={3.5} {...stroke(c, 1.6)} />
      <Path d="M4.5 20c.8-4 3.8-6 7.5-6s6.7 2 7.5 6" {...stroke(c, 1.6)} />
    </>
  ),
  'IconPerson',
);

export const IconFlame = makeIcon(
  ({ c }) => (
    <Path
      d="M12 3c1.5 3.5 1 6-1 8 2.5-.5 4-2 5-4 2 3 3 5.5 3 8a7 7 0 1 1-14 0c0-3 1.5-6 4-9 .5 2 1.5 3 3 4-1-2.5-1-4.5 0-7Z"
      {...stroke(c, 1.6)}
    />
  ),
  'IconFlame',
);
