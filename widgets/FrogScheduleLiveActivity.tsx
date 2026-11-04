import { HStack, Image, Text, VStack } from '@expo/ui/swift-ui';
import { font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, type LiveActivityEnvironment } from 'expo-widgets';

export type FrogScheduleLiveActivityProps = {
  title: string;
  kindLabel: string;
  timeRange: string;
  statusLine: string;
  placementId: string;
};

const FrogScheduleLiveActivityView = (
  props: FrogScheduleLiveActivityProps,
  environment: LiveActivityEnvironment,
) => {
  'widget';

  const accent = environment.isLuminanceReduced ? '#FFFFFF' : '#2F6B4F';
  const ink = environment.isLuminanceReduced ? '#FFFFFF' : '#1C2A22';
  const muted = environment.isLuminanceReduced ? '#DDDDDD' : '#5A6B5E';

  return {
    banner: (
      <VStack alignment="leading" spacing={4} modifiers={[padding({ all: 12 })]}>
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>
          {props.kindLabel || '入格中'}
        </Text>
        <Text modifiers={[font({ size: 16, weight: 'bold' }), foregroundStyle(ink)]}>
          {props.title}
        </Text>
        <HStack spacing={8}>
          <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{props.timeRange}</Text>
          <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>
            {props.statusLine}
          </Text>
        </HStack>
      </VStack>
    ),
    compactLeading: <Image systemName="leaf.fill" color={accent} />,
    compactTrailing: (
      <Text modifiers={[font({ size: 14, weight: 'semibold' }), foregroundStyle(accent)]}>
        {props.statusLine}
      </Text>
    ),
    minimal: <Image systemName="leaf.fill" color={accent} />,
    expandedLeading: (
      <VStack alignment="center" spacing={2} modifiers={[padding({ all: 8 })]}>
        <Image systemName="leaf.fill" color={accent} />
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>
          {props.kindLabel || '入格'}
        </Text>
      </VStack>
    ),
    expandedTrailing: (
      <VStack alignment="trailing" spacing={2} modifiers={[padding({ all: 8 })]}>
        <Text modifiers={[font({ size: 16, weight: 'bold' }), foregroundStyle(ink)]}>
          {props.statusLine}
        </Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.timeRange}</Text>
      </VStack>
    ),
    expandedBottom: (
      <VStack alignment="leading" spacing={2} modifiers={[padding({ all: 10 })]}>
        <Text modifiers={[font({ size: 15, weight: 'semibold' }), foregroundStyle(ink)]}>
          {props.title}
        </Text>
      </VStack>
    ),
  };
};

export default createLiveActivity('FrogScheduleLiveActivity', FrogScheduleLiveActivityView);
