import { HStack, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  padding,
} from '@expo/ui/swift-ui/modifiers';
import { createWidget, type WidgetEnvironment } from '@/lib/widgets/expo-widgets-compat';

export type FrogScheduleWidgetProps = {
  headline: string;
  /** 锁屏标题；隐私收紧时可隐藏具体待办名 */
  lockHeadline: string;
  kindLabel: string;
  kindColor: string;
  timeRange: string;
  statusLine: string;
  summaryLine: string;
  upcoming1: string;
  upcoming2: string;
  upcoming3: string;
  upcomingVisible: number;
  hasFocus: number;
  deepLink: string;
};

const INITIAL: FrogScheduleWidgetProps = {
  headline: '今日青蛙',
  lockHeadline: '今日青蛙',
  kindLabel: '',
  kindColor: '#2F6B4F',
  timeRange: '',
  statusLine: '打开 App 后同步日程',
  summaryLine: '',
  upcoming1: '',
  upcoming2: '',
  upcoming3: '',
  upcomingVisible: 0,
  hasFocus: 0,
  deepLink: 'zheng://tasks',
};

const FrogScheduleWidgetView = (
  props: FrogScheduleWidgetProps,
  environment: WidgetEnvironment,
) => {
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
  const accent = props.kindColor || '#2F6B4F';

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
          {props.kindLabel || '日程'}
        </Text>
        <Text modifiers={[font({ size: 14, weight: 'bold' }), foregroundStyle(ink)]}>
          {props.lockHeadline || props.headline}
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
      <HStack spacing={6}>
        {props.kindLabel ? (
          <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(accent)]}>
            {props.kindLabel}
          </Text>
        ) : null}
        {props.timeRange ? (
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.timeRange}</Text>
        ) : null}
      </HStack>

      <Text modifiers={[font({ size: isMedium ? 18 : 16, weight: 'bold' }), foregroundStyle(ink)]}>
        {props.headline}
      </Text>

      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{props.statusLine}</Text>

      {isMedium && props.summaryLine ? (
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.summaryLine}</Text>
      ) : null}

      {isMedium && props.upcomingVisible > 0 ? (
        <VStack alignment="leading" spacing={2}>
          {props.upcoming1 ? (
            <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.upcoming1}</Text>
          ) : null}
          {props.upcoming2 ? (
            <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.upcoming2}</Text>
          ) : null}
          {props.upcoming3 ? (
            <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.upcoming3}</Text>
          ) : null}
        </VStack>
      ) : null}
    </VStack>
  );
};

export default createWidget('FrogScheduleWidget', FrogScheduleWidgetView, INITIAL);
