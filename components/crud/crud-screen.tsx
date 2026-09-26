import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenLoadingShell } from '@/components/screen-loading-shell';
import { ScreenHeader, type ScreenHeaderProps } from '@/components/ui/screen-header';
import { useAppTheme } from '@/hooks/use-app-theme';

import { ScreenEmptyState, type ScreenEmptyStateProps } from './screen-empty-state';
import { ScreenErrorBanner } from './screen-error-banner';
import { ScreenMissingState } from './screen-missing-state';

export type CrudScreenProps = {
  /** 使用标准 ScreenHeader；传 `header` 可整段覆盖 */
  title?: string;
  subtitle?: string;
  onBack?: () => void;
  headerRight?: React.ReactNode;
  headerLeft?: React.ReactNode;
  headerProps?: Partial<Omit<ScreenHeaderProps, 'title' | 'subtitle' | 'onBack' | 'right' | 'left'>>;
  /** 自定义顶栏（食谱等主题页）；有值时忽略 title / onBack 等 */
  header?: React.ReactNode;
  loading?: boolean;
  loadingHint?: string;
  error?: string | null;
  onRetryError?: () => void;
  /** 列表空数据（非加载、非错误） */
  empty?: boolean;
  emptyProps?: ScreenEmptyStateProps;
  /** 详情/编辑找不到实体 */
  missing?: boolean;
  missingMessage?: string;
  /** 编辑页：包一层 KeyboardAvoidingView */
  keyboardAvoiding?: boolean;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
};

/**
 * CRUD 页面壳：统一 Header / Loading / 错误条 / 空态 / 缺失态。
 * 业务仍自行渲染列表、详情正文或表单（children）。
 */
export function CrudScreen({
  title = '',
  subtitle,
  onBack,
  headerRight,
  headerLeft,
  headerProps,
  header,
  loading = false,
  loadingHint,
  error,
  onRetryError,
  empty = false,
  emptyProps,
  missing = false,
  missingMessage,
  keyboardAvoiding = false,
  children,
  style,
  bodyStyle,
}: CrudScreenProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  const headerNode =
    header ??
    (title || onBack || headerRight || headerLeft ? (
      <ScreenHeader
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        right={headerRight}
        left={headerLeft}
        {...headerProps}
      />
    ) : null);

  const showEmpty = !loading && !error && empty && !missing;
  const showMissing = !loading && missing;

  let body: React.ReactNode;
  if (showMissing) {
    body = <ScreenMissingState message={missingMessage} />;
  } else if (showEmpty && emptyProps) {
    body = <ScreenEmptyState {...emptyProps} />;
  } else {
    body = children;
  }

  const shell = (
    <ScreenLoadingShell loading={loading} hint={loadingHint} style={styles.shell}>
      <View style={[styles.body, bodyStyle]}>{body}</View>
    </ScreenLoadingShell>
  );

  const content = keyboardAvoiding ? (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.top + 56}>
      {shell}
    </KeyboardAvoidingView>
  ) : (
    shell
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.background }, style]}>
      {headerNode}
      {error ? <ScreenErrorBanner message={error} onRetry={onRetryError} /> : null}
      {content}
    </View>
  );
}

/** 列表页别名：默认不包键盘避让 */
export function CrudListScreen(props: CrudScreenProps) {
  return <CrudScreen keyboardAvoiding={false} {...props} />;
}

/** 详情页别名 */
export function CrudDetailScreen(props: CrudScreenProps) {
  return <CrudScreen keyboardAvoiding={false} {...props} />;
}

/** 编辑页别名：默认开启键盘避让 */
export function CrudEditScreen(props: CrudScreenProps) {
  return <CrudScreen keyboardAvoiding {...props} />;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  shell: {
    flex: 1,
  },
  body: {
    flex: 1,
  },
});
