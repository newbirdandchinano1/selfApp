import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type PendingFlushBlockOverlayProps = {
  message: string;
  retrying?: boolean;
  onRetry: () => void;
};

/** 冲刷失败提示：点「进入应用」立刻放行，同步改后台静默。 */
export function PendingFlushBlockOverlay({
  message,
  retrying,
  onRetry,
}: PendingFlushBlockOverlayProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.errorOverlay,
        { paddingTop: Math.max(insets.top, 24), paddingBottom: Math.max(insets.bottom, 24) },
      ]}
    >
          <Text style={styles.errorText}>{message}</Text>
      <Text style={styles.hintText}>可先进入应用，未上传的修改会在后台继续同步。</Text>
      <View style={styles.errorActions}>
        <Pressable
          disabled={retrying}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.errorButton,
            { opacity: retrying ? 0.5 : pressed ? 0.82 : 1 },
          ]}
        >
          <Text style={styles.errorButtonText}>{retrying ? '正在进入…' : '进入应用'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
    backgroundColor: 'rgba(255,255,255,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  errorText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#131b2e',
    textAlign: 'center',
    opacity: 0.85,
    lineHeight: 22,
  },
  hintText: {
    marginTop: 10,
    fontSize: 13,
    fontWeight: '600',
    color: '#131b2e',
    textAlign: 'center',
    opacity: 0.55,
    lineHeight: 20,
  },
  errorActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  errorButton: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(19,27,46,0.18)',
    backgroundColor: '#ffffff',
  },
  errorButtonText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#131b2e',
  },
});
