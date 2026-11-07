import { Gauge, HStack, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  gaugeStyle,
  padding,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
// 必须直连 'expo-widgets'：iOS LayoutRegistry Metro 只 stub 该模块名来捕获 layout。
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

function linkOf(props: { deepLink: string }) {
  return widgetURL(props.deepLink || 'zheng://health');
}

export type HealthIntakeWidgetProps = {
  title: string;
  statusLine: string;
  ringCount: number;
  ring1Label: string;
  ring1Percent: number;
  ring1ValueLine: string;
  ring2Label: string;
  ring2Percent: number;
  ring2ValueLine: string;
  hasItems: number;
  allDone: number;
  deepLink: string;
};

const INITIAL: HealthIntakeWidgetProps = {
  title: '健康摄入',
  statusLine: '打开 App 后同步摄入',
  ringCount: 0,
  ring1Label: '',
  ring1Percent: 0,
  ring1ValueLine: '',
  ring2Label: '',
  ring2Percent: 0,
  ring2ValueLine: '',
  hasItems: 0,
  allDone: 0,
  deepLink: 'zheng://health',
};

const HealthIntakeWidgetView = (props: HealthIntakeWidgetProps, environment: WidgetEnvironment) => {
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
  const accent = props.allDone ? '#2F6B4F' : '#3D7A62';

  const ring1Value = Math.min(1, Math.max(0, props.ring1Percent / 100));
  const ring2Value = Math.min(1, Math.max(0, props.ring2Percent / 100));
  const showDual = isMedium && props.ringCount >= 2 && !!props.ring2Label;
  const gaugeSize = isMedium ? 56 : 44;

  if (isLock) {
    return (
      <VStack
        alignment="leading"
        spacing={2}
        modifiers={[
          containerBackground(paper, 'widget'),
          padding({ all: 8 }),
          frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'leading' }),
          linkOf(props),
        ]}>
        <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>
          健康
        </Text>
        <Text modifiers={[font({ size: 16, weight: 'bold' }), foregroundStyle(ink)]}>
          {props.ring1Label
            ? `${props.ring1Label} ${Math.round(props.ring1Percent)}%`
            : props.title}
        </Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.statusLine}</Text>
      </VStack>
    );
  }

  return (
    <VStack
      alignment="leading"
      spacing={8}
      modifiers={[
        containerBackground(paper, 'widget'),
        padding({ all: 14 }),
        frame({ maxWidth: Infinity, maxHeight: Infinity, alignment: 'topLeading' }),
        linkOf(props),
      ]}>
      <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(accent)]}>
        {props.title}
      </Text>

      {props.hasItems === 0 ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(muted)]}>{props.statusLine}</Text>
      ) : showDual ? (
        <HStack spacing={16}>
          <VStack alignment="center" spacing={4}>
            <Gauge
              value={ring1Value}
              min={0}
              max={1}
              modifiers={[
                gaugeStyle('circularCapacity'),
                frame({ width: gaugeSize, height: gaugeSize }),
              ]}
              currentValueLabel={
                <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(ink)]}>
                  {`${Math.round(props.ring1Percent)}%`}
                </Text>
              }
            />
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(accent)]}>
              {props.ring1Label}
            </Text>
            <Text modifiers={[font({ size: 10 }), foregroundStyle(muted)]}>
              {props.ring1ValueLine}
            </Text>
          </VStack>
          <VStack alignment="center" spacing={4}>
            <Gauge
              value={ring2Value}
              min={0}
              max={1}
              modifiers={[
                gaugeStyle('circularCapacity'),
                frame({ width: gaugeSize, height: gaugeSize }),
              ]}
              currentValueLabel={
                <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(ink)]}>
                  {`${Math.round(props.ring2Percent)}%`}
                </Text>
              }
            />
            <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle(accent)]}>
              {props.ring2Label}
            </Text>
            <Text modifiers={[font({ size: 10 }), foregroundStyle(muted)]}>
              {props.ring2ValueLine}
            </Text>
          </VStack>
        </HStack>
      ) : props.ring1Label ? (
        <HStack spacing={12}>
          <Gauge
            value={ring1Value}
            min={0}
            max={1}
            modifiers={[
              gaugeStyle('circularCapacity'),
              frame({ width: gaugeSize, height: gaugeSize }),
            ]}
            currentValueLabel={
              <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(ink)]}>
                {`${Math.round(props.ring1Percent)}%`}
              </Text>
            }
          />
          <VStack alignment="leading" spacing={4}>
            <Text modifiers={[font({ size: 12, weight: 'semibold' }), foregroundStyle(accent)]}>
              {props.ring1Label}
            </Text>
            <Text
              modifiers={[
                font({ size: isMedium ? 18 : 16, weight: 'bold' }),
                foregroundStyle(ink),
              ]}>
              {`${Math.round(props.ring1Percent)}%`}
            </Text>
            <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>
              {props.ring1ValueLine}
            </Text>
          </VStack>
        </HStack>
      ) : null}

      <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.statusLine}</Text>
    </VStack>
  );
};

export default createWidget('HealthIntakeWidget', HealthIntakeWidgetView, INITIAL);
