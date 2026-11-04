import { HStack, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

export type UrgencyWidgetProps = {
  title: string;
  countsLine: string;
  lockCountsLine: string;
  topTitle: string;
  statusLine: string;
  overdueCount: number;
  dueTodayCount: number;
  dueSoonCount: number;
  showOverdue: number;
  showDueToday: number;
  showDueSoon: number;
  showTopTitle: number;
  isCalm: number;
  deepLink: string;
};

const INITIAL: UrgencyWidgetProps = {
  title: '紧急度',
  countsLine: '—',
  lockCountsLine: '—',
  topTitle: '',
  statusLine: '打开 App 后同步紧急项',
  overdueCount: 0,
  dueTodayCount: 0,
  dueSoonCount: 0,
  showOverdue: 1,
  showDueToday: 1,
  showDueSoon: 1,
  showTopTitle: 1,
  isCalm: 1,
  deepLink: 'zheng://tasks',
};

const UrgencyWidgetView = (props: UrgencyWidgetProps, environment: WidgetEnvironment) => {
  'widget';

  const family = environment.widgetFamily ?? 'systemSmall';
  const isMedium = family === 'systemMedium' || family === 'systemLarge';
  const isLock =
    family === 'accessoryRectangular' ||
    family === 'accessoryInline' ||
    family === 'accessoryCircular';

  const ink = environment.colorScheme === 'dark' ? '#F3EFE6' : '#1C2A22';
  const muted = environment.colorScheme === 'dark' ? '#A8B5AC' : '#5A6B5E';
  const paper = environment.colorScheme === 'dark' ? '#1A221C' : '#F7F3EA';
  const accent = props.isCalm === 1 ? '#3D7A62' : props.overdueCount > 0 ? '#B54A3C' : '#C48A2A';

  if (isLock) {
    return (
      <VStack
        alignment="leading"
        spacing={2}
        modifiers={[
          containerBackground(paper, 'widget'),
          padding({ all: 8 }),
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' }),
        ]}>
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>
          紧急
        </Text>
        <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(ink)]}>
          {props.lockCountsLine || props.countsLine}
        </Text>
      </VStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={6}
      modifiers={[
        containerBackground(paper, 'widget'),
        padding({ all: 14 }),
        frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
      ]}>
      <HStack spacing={8}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(accent)]}>
          {props.title}
        </Text>
      </HStack>

      <Text modifiers={[font({ size: isMedium ? 20 : 17, weight: 'bold' }), foregroundStyle(ink)]}>
        {props.countsLine}
      </Text>

      {isMedium && props.showTopTitle === 1 && props.topTitle ? (
        <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.statusLine}</Text>
      ) : (
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.statusLine}</Text>
      )}
    </VStack>
  );
};

export default createWidget('UrgencyWidget', UrgencyWidgetView, INITIAL);
