import { ComposerTopBar } from '@/components/composer';
import { useAppTheme } from '@/hooks/use-app-theme';
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export type EntityFormProps = {
  title: string;
  subtitle?: string;
  submitLabel?: string;
  submitting?: boolean;
  onBack: () => void;
  onSubmit: () => void;
  children: React.ReactNode;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  contentStyle?: StyleProp<ViewStyle>;
  /** SafeArea edges；表单页通常避开顶部由 ComposerTopBar 处理 inset */
  edges?: ('top' | 'right' | 'bottom' | 'left')[];
};

/**
 * 任务 / 项目等 add-edit 共用壳：TopBar + KeyboardAvoiding + ScrollView。
 */
export function EntityForm({
  title,
  subtitle,
  submitLabel = '创建',
  submitting,
  onBack,
  onSubmit,
  children,
  refreshControl,
  contentStyle,
  edges = ['left', 'right', 'bottom'],
}: EntityFormProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={edges}>
      <ComposerTopBar
        title={title}
        subtitle={subtitle}
        onBack={onBack}
        onSubmit={onSubmit}
        submitting={submitting}
        submitLabel={submitLabel}
      />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          refreshControl={refreshControl}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: 48 + Math.max(insets.bottom, 12) },
            contentStyle,
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  content: {
    paddingTop: 12,
    paddingHorizontal: 14,
    gap: 12,
  },
});
