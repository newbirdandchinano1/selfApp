import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiDebugLogViewer } from '@/components/api-debug-log-viewer';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { isApiDebugEnabled, loadApiDebugEnabled, subscribeApiDebug } from '@/lib/api-debug';

export function ApiDebugOverlay() {
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const text = isDark ? '#e2e8f0' : '#1f2937';
  const muted = isDark ? 'rgba(148,163,184,0.85)' : '#64748b';
  const cardBg = isDark ? '#0f172a' : '#ffffff';
  const border = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(0,88,190,0.14)';
  const primary = isDark ? '#60a5fa' : '#0058be';

  const [enabled, setEnabled] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(false);

  React.useEffect(() => {
    let mounted = true;
    void loadApiDebugEnabled().then(v => {
      if (mounted) setEnabled(v);
    });
    return subscribeApiDebug(() => {
      setEnabled(isApiDebugEnabled());
    });
  }, []);

  if (!enabled) return null;

  return (
    <>
      <Pressable
        onPress={() => setPanelOpen(true)}
        style={[
          styles.fab,
          {
            top: Math.max(insets.top, 8) + 8,
            right: 12,
            backgroundColor: isDark ? '#1e3a5f' : primary,
            borderColor: isDark ? 'rgba(96,165,250,0.45)' : 'rgba(255,255,255,0.35)',
          },
        ]}>
        <MaterialIcons name="bug-report" size={18} color="#fff" />
        <Text style={styles.fabText}>API</Text>
      </Pressable>

      <Modal visible={panelOpen} animationType="slide" onRequestClose={() => setPanelOpen(false)}>
        <View style={[styles.panelRoot, { paddingTop: insets.top, backgroundColor: isDark ? '#020617' : '#f8fafc' }]}>
          <View style={[styles.panelHeader, { borderBottomColor: border }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: text }}>接口调试</Text>
              <Text style={{ fontSize: 12, color: muted }}>所有 HTTP 请求均会记录在此</Text>
            </View>
            <Pressable
              onPress={() => setPanelOpen(false)}
              style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1, padding: 8 }]}>
              <MaterialIcons name="close" size={22} color={muted} />
            </Pressable>
          </View>
          <View style={{ flex: 1, padding: 12, paddingBottom: insets.bottom + 12 }}>
            <ApiDebugLogViewer
              textColor={text}
              mutedColor={muted}
              borderColor={border}
              cardBg={cardBg}
              primary={primary}
              fill
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute',
    zIndex: 99999,
    elevation: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  fabText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  panelRoot: { flex: 1 },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
