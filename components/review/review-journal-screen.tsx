/**
 * 日 / 周 / 月复盘主屏入口：按 scope 分发给各自 Grid（周含 metrics/story，日含 streak/reminder，月含翻月）。
 * 维度详情请用 ReviewDimensionDetailScreen(scope)。
 */
import { DailyReviewGridView } from '@/components/review/daily-review-grid-view';
import { MonthlyReviewGridView } from '@/components/review/monthly-review-grid-view';
import { WeeklyReviewGridView } from '@/components/review/weekly-review-grid-view';
import type { ReviewJournalScope } from '@/lib/repositories/insights/review-journal-store';
import React from 'react';
import type { RefreshControlProps } from 'react-native';

type CommonProps = {
  pageApiKey: string;
  refreshControl?: React.ReactElement<RefreshControlProps>;
};

type DailyProps = CommonProps & {
  scope: 'daily';
  ymd: string;
  onYmdChange: (ymd: string) => void;
  onSwitchToWeekly?: () => void;
};

type WeeklyProps = CommonProps & {
  scope: 'weekly';
  onRegisterReload?: (reload: () => Promise<void>) => void;
};

type MonthlyProps = CommonProps & {
  scope: 'monthly';
  onRegisterReload?: (reload: () => Promise<void>) => void;
  onMonthLabelChange?: (label: string) => void;
};

export type ReviewJournalScreenProps = DailyProps | WeeklyProps | MonthlyProps;

export function ReviewJournalScreen(props: ReviewJournalScreenProps) {
  if (props.scope === 'daily') {
    return (
      <DailyReviewGridView
        ymd={props.ymd}
        onYmdChange={props.onYmdChange}
        pageApiKey={props.pageApiKey}
        refreshControl={props.refreshControl}
        onSwitchToWeekly={props.onSwitchToWeekly}
      />
    );
  }
  if (props.scope === 'weekly') {
    return (
      <WeeklyReviewGridView
        pageApiKey={props.pageApiKey}
        refreshControl={props.refreshControl}
        onRegisterReload={props.onRegisterReload}
      />
    );
  }
  return (
    <MonthlyReviewGridView
      pageApiKey={props.pageApiKey}
      refreshControl={props.refreshControl}
      onRegisterReload={props.onRegisterReload}
      onMonthLabelChange={props.onMonthLabelChange}
    />
  );
}

export type { ReviewJournalScope };
