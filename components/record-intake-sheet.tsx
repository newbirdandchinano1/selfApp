import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import {
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const { height: screenHeight } = Dimensions.get('window');

type TabKey = 'ai' | 'manual';
type ManualType = 'hydration' | 'protein' | 'sodium';
type ConfirmUnit = 'ml' | 'g' | 'mg';

function getUnitByType(type: ManualType): ConfirmUnit {
  if (type === 'hydration') return 'ml';
  if (type === 'protein') return 'g';
  return 'mg';
}

function getManualMeta(type: ManualType) {
  if (type === 'hydration') {
    return { label: '水分', icon: 'water-drop' as const, unitText: 'ML', convertHint: (n: number) => `约 ${(n / 1000).toFixed(2)} 升` };
  }
  if (type === 'protein') {
    return { label: '蛋白质', icon: 'fitness-center' as const, unitText: 'G', convertHint: (n: number) => `约 ${(n / 1000).toFixed(3)} 千克` };
  }
  return { label: '钠', icon: 'science' as const, unitText: 'MG', convertHint: (n: number) => `约 ${(n / 1000).toFixed(2)} 克` };
}

export function RecordIntakeSheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm?: (payload: { mode: TabKey; text?: string; amount?: number; unit?: ConfirmUnit; type?: ManualType }) => void;
}) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [shouldRender, setShouldRender] = React.useState(visible);
  const [tab, setTab] = React.useState<TabKey>('manual');
  const [text, setText] = React.useState('');
  const [manualType, setManualType] = React.useState<ManualType>('hydration');
  const [amountText, setAmountText] = React.useState('350');

  const translateY = React.useRef(new Animated.Value(screenHeight)).current;
  const backdropOpacity = React.useRef(new Animated.Value(0)).current;
  const aiMiniEnabledAnim = React.useRef(new Animated.Value(0)).current;

  const open = React.useCallback(() => {
    translateY.setValue(screenHeight);
    backdropOpacity.setValue(0);
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 500,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [backdropOpacity, translateY]);

  const close = React.useCallback(
    (after?: () => void) => {
      Animated.parallel([
        Animated.timing(backdropOpacity, {
          toValue: 0,
          duration: 180,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: screenHeight,
          duration: 280,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) after?.();
      });
    },
    [backdropOpacity, translateY],
  );

  React.useEffect(() => {
    if (visible) {
      setShouldRender(true);
      requestAnimationFrame(open);
      return;
    }

    if (!shouldRender) return;
    close(() => setShouldRender(false));
  }, [close, open, shouldRender, visible]);

  React.useEffect(() => {
    if (!visible) return;
    const enabled = text.trim().length > 0;
    Animated.timing(aiMiniEnabledAnim, {
      toValue: enabled ? 1 : 0,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [aiMiniEnabledAnim, text, visible]);

  if (!shouldRender) return null;

  const sheetBackground = theme.surface;
  const mutedText = theme.textSecondary;
  const border = isDark ? 'rgba(148, 163, 184, 0.16)' : '#e2e8f0';
  const tabBg = isDark ? 'rgba(148, 163, 184, 0.12)' : '#f1f5f9';
  const inputBg = isDark ? 'rgba(15, 23, 42, 0.4)' : 'rgba(248, 250, 252, 0.95)';
  const aiMiniEnabled = text.trim().length > 0;
  const aiMiniInactiveOpacity = aiMiniEnabledAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const aiMiniActiveOpacity = aiMiniEnabledAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const amount = Number.parseInt(amountText || '0', 10) || 0;
  const manualMeta = getManualMeta(manualType);

  const handleConfirm = () => {
    if (tab === 'ai') {
      onConfirm?.({ mode: tab, text });
    } else {
      onConfirm?.({ mode: tab, amount, unit: getUnitByType(manualType), type: manualType });
    }
    onClose();
  };

  const onPressDigit = (digit: string) => {
    setAmountText((prev) => {
      if (prev === '0') return digit;
      if (prev.length >= 5) return prev;
      return `${prev}${digit}`;
    });
  };

  const onPressBackspace = () => {
    setAmountText((prev) => {
      if (prev.length <= 1) return '0';
      return prev.slice(0, -1);
    });
  };

  return (
    <Modal transparent visible onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.overlay}>
        <Pressable style={styles.backdropPressable} onPress={onClose}>
          <Animated.View style={[styles.backdrop, { opacity: backdropOpacity, backgroundColor: isDark ? 'rgba(0,0,0,0.6)' : 'rgba(15,23,42,0.36)' }]} />
        </Pressable>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View style={[styles.sheet, { backgroundColor: sheetBackground, transform: [{ translateY }] }]}>
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: isDark ? 'rgba(148,163,184,0.25)' : '#e2e8f0' }]} />
            </View>

            <View style={styles.header}>
              <Pressable style={styles.iconBtn} onPress={onClose}>
                <MaterialIcons name="close" size={22} color={mutedText} />
              </Pressable>
              <Text style={[styles.title, { color: theme.text }]}>记录新摄入</Text>
              <Pressable style={styles.iconBtn}>
                <MaterialIcons name="more-vert" size={20} color={mutedText} />
              </Pressable>
            </View>

            <View style={styles.content}>
              <View style={[styles.tabBar, { backgroundColor: tabBg, borderColor: border }]}>
                <Pressable onPress={() => setTab('ai')} style={[styles.tabBtn, tab === 'ai' && { backgroundColor: sheetBackground }]}>
                  <Text style={[styles.tabText, { color: tab === 'ai' ? theme.primary : mutedText }]}>AI 记录</Text>
                </Pressable>
                <Pressable onPress={() => setTab('manual')} style={[styles.tabBtn, tab === 'manual' && { backgroundColor: sheetBackground }]}>
                  <Text style={[styles.tabText, { color: tab === 'manual' ? theme.primary : mutedText }]}>手动记录</Text>
                </Pressable>
              </View>

              {tab === 'ai' ? (
                <View style={styles.inputSection}>
                  <View style={[styles.textareaWrap, { backgroundColor: inputBg }]}>
                    <TextInput
                      value={text}
                      onChangeText={setText}
                      multiline
                      placeholder="您吃了或喝了什么？（例如：一碗牛肉面）"
                      placeholderTextColor={isDark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)'}
                      style={[styles.textarea, { color: theme.text }]}
                      textAlignVertical="top"
                    />
                    <Pressable disabled={!aiMiniEnabled} onPress={() => {}} style={styles.aiMiniBtn} hitSlop={10}>
                      <Animated.View style={[styles.aiMiniIconLayer, { opacity: aiMiniInactiveOpacity }]}>
                        <MaterialIcons name="auto-awesome" size={20} color="#8fbc8f" />
                      </Animated.View>
                      <Animated.View style={[styles.aiMiniIconLayer, { opacity: aiMiniActiveOpacity }]}>
                        <MaterialIcons name="auto-awesome" size={20} color="#32cd32" />
                      </Animated.View>
                    </Pressable>
                  </View>
                  <Text style={[styles.hint, { color: mutedText }]}>我们的 AI 将自动计算热量与营养成分</Text>
                </View>
              ) : (
                <View style={styles.manualWrap}>
                  <View style={styles.typeGrid}>
                    {[
                      { key: 'hydration' as const, label: '水分', icon: 'water-drop' as const },
                      { key: 'protein' as const, label: '蛋白质', icon: 'fitness-center' as const },
                      { key: 'sodium' as const, label: '钠', icon: 'science' as const },
                    ].map((item) => {
                      const selected = manualType === item.key;
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => setManualType(item.key)}
                          style={({ pressed }) => [
                            styles.typeCard,
                            selected
                              ? { backgroundColor: `${theme.primary}14`, borderColor: `${theme.primary}33`, borderWidth: 2 }
                              : { backgroundColor: isDark ? 'rgba(30,41,59,0.55)' : '#f8fafc', borderColor: isDark ? 'rgba(148,163,184,0.16)' : '#f1f5f9', borderWidth: 1 },
                            pressed && { transform: [{ scale: 0.97 }] },
                          ]}
                        >
                          <View style={[styles.typeIconWrap, { backgroundColor: selected ? `${theme.primary}26` : isDark ? 'rgba(100,116,139,0.35)' : 'rgba(226,232,240,0.6)' }]}>
                            <MaterialIcons name={item.icon} size={20} color={selected ? theme.primary : mutedText} />
                          </View>
                          <Text style={[styles.typeText, { color: selected ? theme.primary : theme.text }]}>{item.label}</Text>
                        </Pressable>
                      );
                    })}
                  </View>

                  <View style={[styles.valuePanel, { backgroundColor: isDark ? 'rgba(30,41,59,0.45)' : 'rgba(241,245,249,0.8)', borderColor: border }]}>
                    <Text style={[styles.valueLabel, { color: mutedText }]}>数值输入 ({manualMeta.unitText})</Text>
                    <View style={styles.valueMainRow}>
                      <Text style={[styles.valueNumber, { color: theme.text }]}>{amount}</Text>
                      <Text style={[styles.valueUnit, { color: theme.primary }]}>{manualMeta.unitText}</Text>
                    </View>
                    <View style={[styles.valueHintPill, { backgroundColor: sheetBackground, borderColor: border }]}>
                      <Text style={[styles.valueHintText, { color: mutedText }]}>{manualMeta.convertHint(amount)}</Text>
                    </View>

                    <View style={styles.keypadGrid}>
                      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                        <Pressable key={d} onPress={() => onPressDigit(d)} style={({ pressed }) => [styles.keypadBtn, { backgroundColor: sheetBackground, borderColor: isDark ? 'rgba(148,163,184,0.18)' : '#f1f5f9' }, pressed && { transform: [{ scale: 0.95 }] }]}>
                          <Text style={[styles.keypadBtnText, { color: theme.text }]}>{d}</Text>
                        </Pressable>
                      ))}
                      <View style={[styles.keypadBtn, styles.keypadGhost]} />
                      <Pressable onPress={() => onPressDigit('0')} style={({ pressed }) => [styles.keypadBtn, { backgroundColor: sheetBackground, borderColor: isDark ? 'rgba(148,163,184,0.18)' : '#f1f5f9' }, pressed && { transform: [{ scale: 0.95 }] }]}>
                        <Text style={[styles.keypadBtnText, { color: theme.text }]}>0</Text>
                      </Pressable>
                      <Pressable onPress={onPressBackspace} style={({ pressed }) => [styles.keypadBtn, { backgroundColor: isDark ? 'rgba(51,65,85,0.6)' : '#f1f5f9', borderColor: isDark ? 'rgba(148,163,184,0.18)' : '#e2e8f0' }, pressed && { transform: [{ scale: 0.95 }] }]}>
                        <MaterialIcons name="backspace" size={22} color={mutedText} />
                      </Pressable>
                    </View>
                  </View>
                </View>
              )}

              <Pressable onPress={handleConfirm} style={({ pressed }) => [styles.confirmBtn, { backgroundColor: theme.primary, opacity: pressed ? 0.94 : 1 }]}>
                <Text style={styles.confirmText}>确认添加</Text>
                <MaterialIcons name="check-circle" size={22} color="#fff" />
              </Pressable>
            </View>
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdropPressable: { ...StyleSheet.absoluteFillObject },
  backdrop: { flex: 1 },
  sheet: {
    width: '100%',
    maxHeight: Math.min(850, screenHeight - 36),
    borderTopLeftRadius: 40,
    borderTopRightRadius: 40,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.2,
    shadowRadius: 18,
    elevation: 18,
  },
  handleWrap: { alignItems: 'center', paddingTop: 12, paddingBottom: 6 },
  handle: { width: 48, height: 6, borderRadius: 999 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 18, paddingBottom: 4 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22, gap: 14 },
  tabBar: { flexDirection: 'row', borderRadius: 16, borderWidth: 1, padding: 4 },
  tabBtn: { flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  tabText: { fontSize: 13, fontWeight: '800' },
  inputSection: { gap: 10 },
  textareaWrap: { borderRadius: 18, padding: 16, minHeight: 160 },
  textarea: { fontSize: 16, lineHeight: 22, paddingRight: 34, minHeight: 128 },
  aiMiniBtn: { position: 'absolute', right: 12, bottom: 12, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  aiMiniIconLayer: { position: 'absolute' },
  hint: { fontSize: 11, fontWeight: '500', fontStyle: 'italic', paddingHorizontal: 2 },
  manualWrap: { gap: 12 },
  typeGrid: { flexDirection: 'row', gap: 10 },
  typeCard: { flex: 1, borderRadius: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 8 },
  typeIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  typeText: { fontSize: 12, fontWeight: '800' },
  valuePanel: { borderRadius: 28, borderWidth: 1, padding: 16, alignItems: 'center' },
  valueLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 },
  valueMainRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  valueNumber: { fontSize: 54, fontWeight: '900', letterSpacing: -1.4, lineHeight: 62 },
  valueUnit: { fontSize: 24, fontWeight: '900', marginBottom: 8 },
  valueHintPill: { marginTop: 8, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 },
  valueHintText: { fontSize: 11, fontWeight: '700' },
  keypadGrid: { width: '100%', marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between' },
  keypadBtn: { width: '31%', aspectRatio: 1.5, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  keypadBtnText: { fontSize: 28, fontWeight: '800' },
  keypadGhost: { opacity: 0 },
  confirmBtn: {
    marginTop: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 24,
    paddingVertical: 16,
    shadowColor: '#10b981',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.24,
    shadowRadius: 18,
    elevation: 8,
  },
  confirmText: { color: '#fff', fontSize: 18, fontWeight: '800', letterSpacing: 0.2 },
});
