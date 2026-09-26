import { useAppTheme } from '@/hooks/use-app-theme';
import { makeTimestampEntityId } from '@/lib/entity-id';
import {
  parseDateLimitParam,
  parseDefaultScheduleParam,
  resolveInheritedDefaultSchedule,
} from '@/lib/schedule-inherit';
import { normalizeRouteParam } from '@/lib/schedule-picker-bridge';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TextInput } from 'react-native';

import { EntityForm } from './EntityForm';
import { EntityFormPanel } from './EntityFormPanel';
import { EntityFormScheduleField } from './EntityFormScheduleField';
import { useComposerSchedule } from './use-composer-schedule';
import { clampTitle, ENTITY_TITLE_MAX, validateRequiredTitle } from './validation';

export type TaskFormMode = 'create' | 'standalone' | 'standalone-edit' | 'subtask';

declare global {
  // eslint-disable-next-line no-var
  var __addSubtaskResult:
    | {
        source: string;
        task: {
          id: string;
          title: string;
          done: boolean;
          deadline?: string;
          deadlineText?: string;
          reminder?: string;
          reminderText?: string;
          repeat?: string;
          repeatText?: string;
          note?: string | null;
          schedule?: unknown;
        };
      }
    | undefined;
}

type TaskFormScreenProps = {
  mode: TaskFormMode;
};

/**
 * 任务族表单：按 mode 区分初始值与提交。
 * - subtask：独立页（add-subtask）
 * - create / standalone / standalone-edit：仍由 add-task 路由承载完整业务，后续可继续迁入
 */
export function TaskFormScreen({ mode }: TaskFormScreenProps) {
  if (mode === 'subtask') {
    return <SubtaskFormScreen />;
  }
  throw new Error(
    `TaskFormScreen: mode "${mode}" 尚未迁入；请使用 add-task 路由（standalone / create）。`,
  );
}

function SubtaskFormScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    source?: string;
    dateLimit?: string;
    defaultSchedule?: string;
    lockSchedule?: string;
  }>();
  const { colors } = useAppTheme();

  const [title, setTitle] = React.useState('');
  const scheduleSource = normalizeRouteParam(params.source as string | string[] | undefined) || 'add-subtask';
  const dateLimit = React.useMemo(
    () => parseDateLimitParam(typeof params.dateLimit === 'string' ? params.dateLimit : undefined),
    [params.dateLimit],
  );
  const lockSchedule =
    (typeof params.lockSchedule === 'string' && params.lockSchedule === '1') ||
    (typeof params.lockSchedule === 'string' && params.lockSchedule.toLowerCase() === 'true');

  const {
    deadlineText,
    reminderText,
    repeatText,
    scheduleMeta,
    applySchedule,
    openSchedulePicker,
  } = useComposerSchedule({
    source: scheduleSource,
    dateLimit,
    locked: lockSchedule,
  });

  const defaultScheduleApplied = React.useRef(false);
  React.useEffect(() => {
    if (defaultScheduleApplied.current || scheduleMeta) return;
    const inherited = resolveInheritedDefaultSchedule(
      parseDefaultScheduleParam(
        typeof params.defaultSchedule === 'string' ? params.defaultSchedule : undefined,
      ),
      dateLimit,
    );
    if (!inherited) return;
    defaultScheduleApplied.current = true;
    applySchedule(inherited);
  }, [applySchedule, dateLimit, params.defaultSchedule, scheduleMeta]);

  const createSubtask = () => {
    const result = validateRequiredTitle(title, { emptyMessage: '请输入子任务名称。' });
    if (!result.ok) return;
    globalThis.__addSubtaskResult = {
      source: scheduleSource,
      task: {
        id: makeTimestampEntityId('tsk_', 8),
        title: result.title,
        done: false,
        deadline: deadlineText,
        deadlineText,
        reminder: reminderText,
        reminderText,
        repeat: repeatText,
        repeatText,
        note: null,
        schedule: scheduleMeta,
      },
    };
    router.back();
  };

  const titleMax = ENTITY_TITLE_MAX.subtask;

  return (
    <EntityForm
      title="添加子任务"
      onBack={() => router.back()}
      onSubmit={createSubtask}
      submitLabel="创建">
      <EntityFormPanel title="概要">
        <TextInput
          value={title}
          onChangeText={(text) => setTitle(clampTitle(text, titleMax))}
          placeholder={`子任务名称（${titleMax}字以内）`}
          placeholderTextColor={colors.textMuted}
          multiline
          maxLength={titleMax}
          style={[styles.titleInput, { color: colors.text }]}
        />
        <Text style={[styles.charCounter, { color: colors.textSecondary }]}>
          {title.length}/{titleMax}
        </Text>
      </EntityFormPanel>

      <EntityFormPanel title="日程">
        <EntityFormScheduleField
          deadlineText={deadlineText}
          reminderText={reminderText}
          repeatText={repeatText}
          onPress={openSchedulePicker}
          locked={lockSchedule}
          label="时间限制"
        />
      </EntityFormPanel>
    </EntityForm>
  );
}

const styles = StyleSheet.create({
  titleInput: { padding: 0, fontSize: 22, fontWeight: '700', lineHeight: 28 },
  charCounter: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '500' },
});
