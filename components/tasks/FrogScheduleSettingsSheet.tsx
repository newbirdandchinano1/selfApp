import { FrogScheduleSettingsCard } from '@/components/settings-drawer/frog-schedule-settings-card';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function FrogScheduleSettingsSheet({ visible, onClose }: Props) {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';
  const primary = theme.primary;
  const outline = theme.textSecondary;
  const text = theme.text;
  const surface = isDark ? '#1e293b' : '#fff';
  const cardBg = isDark ? 'rgba(30,41,59,0.55)' : '#ffffff';
  const cardBorder = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(0,88,190,0.12)';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          onPress={() => {}}
          style={[
            styles.sheet,
            {
              backgroundColor: surface,
              paddingBottom: Math.max(insets.bottom, 16),
              borderColor: isDark ? 'rgba(148,163,184,0.25)' : 'rgba(203,213,225,0.9)',
              maxHeight: '88%',
            },
          ]}>
          <View style={styles.handleRow}>
            <View style={[styles.handle, { backgroundColor: outline }]} />
          </View>
          <View style={styles.header}>
            <Text style={[styles.title, { color: text }]}>周日程表设置</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="关闭">
              <MaterialIcons name="close" size={22} color={outline} />
            </Pressable>
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}>
            <FrogScheduleSettingsCard
              cardBg={cardBg}
              cardBorder={cardBorder}
              text={text}
              outline={outline}
              primary={primary}
              active={visible}
            />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
  },
  handleRow: { alignItems: 'center', paddingVertical: 4 },
  handle: { width: 40, height: 4, borderRadius: 2, opacity: 0.35 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { fontSize: 17, fontWeight: '700' },
  scrollContent: { paddingBottom: 8 },
});
