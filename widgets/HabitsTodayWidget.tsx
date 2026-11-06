import { HStack, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from '@/lib/widgets/expo-widgets-compat';

export type HabitsTodayWidgetProps = {
  progressLine: string;
  statusLine: string;
  doneLabel: string;
  item1: string;
  item2: string;
  item3: string;
  moreLine: string;
  pendingVisible: number;
  hasItems: number;
  allDone: number;
  deepLink: string;
};

const INITIAL: HabitsTodayWidgetProps = {
  progressLine: '—',
  statusLine: '打开 App 后同步习惯',
  doneLabel: '',
  item1: '',
  item2: '',
  item3: '',
  moreLine: '',
  pendingVisible: 0,
  hasItems: 0,
  allDone: 0,
  deepLink: 'zheng://tasks',
};

const HabitsTodayWidgetView = (props: HabitsTodayWidgetProps, environment: WidgetEnvironment) => {
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
  const accent = props.allDone ? '#2F6B4F' : '#C48A2A';

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
          习惯
        </Text>
        <Text modifiers={[font({ size: 16, weight: 'bold' }), foregroundStyle(ink)]}>
          {props.progressLine}
        </Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.statusLine}</Text>
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
          今日习惯
        </Text>
        <Text modifiers={[font({ size: isMedium ? 20 : 18, weight: 'bold' }), foregroundStyle(ink)]}>
          {props.progressLine}
        </Text>
      </HStack>

      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{props.statusLine}</Text>

      {isMedium && props.allDone === 0 && props.pendingVisible > 0 ? (
        <VStack alignment="leading" spacing={2}>
          {props.item1 ? (
            <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.item1}</Text>
          ) : null}
          {props.item2 ? (
            <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.item2}</Text>
          ) : null}
          {props.item3 ? (
            <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.item3}</Text>
          ) : null}
          {props.moreLine ? (
            <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.moreLine}</Text>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  );
};

export default createWidget('HabitsTodayWidget', HabitsTodayWidgetView, INITIAL);
