import { HStack, Text, VStack } from '@expo/ui/swift-ui';
import {
  containerBackground,
  font,
  foregroundStyle,
  frame,
  padding,
  widgetURL,
} from '@expo/ui/swift-ui/modifiers';
// 必须直连 'expo-widgets'：iOS LayoutRegistry Metro 只 stub 该模块名来捕获 layout。
import { createWidget, type WidgetEnvironment } from 'expo-widgets';

function linkOf(props: { deepLink: string }): ReturnType<typeof widgetURL> {
  return widgetURL(props.deepLink || 'zheng://finance');
}

export type FinanceGlanceWidgetProps = {
  title: string;
  primaryLine: string;
  secondaryLine: string;
  nextLine: string;
  lockPrimaryLine: string;
  lockSecondaryLine: string;
  statusLine: string;
  budgetRemainingPct: number;
  budgetAccentCode: number;
  hasBudget: number;
  hasNext: number;
  masked: number;
  allowLockScreen: number;
  deepLink: string;
};

const INITIAL: FinanceGlanceWidgetProps = {
  title: '财务一眼',
  primaryLine: '—',
  secondaryLine: '打开 App 后同步账本',
  nextLine: '',
  lockPrimaryLine: '今日 ¥***',
  lockSecondaryLine: '未设预算',
  statusLine: '打开 App 后同步账本',
  budgetRemainingPct: -1,
  budgetAccentCode: 0,
  hasBudget: 0,
  hasNext: 0,
  masked: 0,
  allowLockScreen: 0,
  deepLink: 'zheng://finance',
};

const FinanceGlanceWidgetView = (
  props: FinanceGlanceWidgetProps,
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
  const accent =
    props.budgetAccentCode >= 2
      ? '#B54A3C'
      : props.budgetAccentCode === 1
        ? '#C48A2A'
        : '#3D7A62';

  if (isLock) {
    if (props.allowLockScreen !== 1) {
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
            财务
          </Text>
          <Text modifiers={[font({ size: 14, weight: 'bold' }), foregroundStyle(ink)]}>
            锁屏已隐藏
          </Text>
          <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>可在组件设置中开启</Text>
        </VStack>
      );
    }

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
          财务
        </Text>
        <Text modifiers={[font({ size: 15, weight: 'bold' }), foregroundStyle(ink)]}>
          {props.lockPrimaryLine || props.primaryLine}
        </Text>
        <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>
          {props.lockSecondaryLine || props.secondaryLine}
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
        linkOf(props),
      ]}>
      <HStack spacing={8}>
        <Text modifiers={[font({ size: 11, weight: 'bold' }), foregroundStyle(accent)]}>
          {props.title}
        </Text>
      </HStack>

      <Text modifiers={[font({ size: isMedium ? 20 : 18, weight: 'bold' }), foregroundStyle(ink)]}>
        {props.primaryLine}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(muted)]}>{props.secondaryLine}</Text>

      {isMedium && props.hasNext === 1 && props.nextLine ? (
        <Text modifiers={[font({ size: 12 }), foregroundStyle(ink)]}>{props.nextLine}</Text>
      ) : null}

      <Text modifiers={[font({ size: 11 }), foregroundStyle(muted)]}>{props.statusLine}</Text>
    </VStack>
  );
};

export default createWidget('FinanceGlanceWidget', FinanceGlanceWidgetView, INITIAL);
