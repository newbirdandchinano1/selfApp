import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import {
  getActiveAiLlmApiKey,
  parseFoodIntakeFromText,
  type FoodTextIntakeJson,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

const { height: screenHeight } = Dimensions.get('window');

type TabKey = 'ai' | 'photo' | 'manual';
type ManualType = 'hydration' | 'protein' | 'carbohydrate' | 'calories';
type ConfirmUnit = 'ml' | 'g' | 'kcal';

type AiIntakeFieldTexts = {
  food_summary: string;
  hydration_ml: string;
  protein_g: string;
  carbohydrate_g: string;
  calories_kcal: string;
  ai_evaluation: string;
};

function foodTextIntakeFromFieldTexts(fields: AiIntakeFieldTexts): FoodTextIntakeJson {
  return {
    food_summary: fields.food_summary.trim(),
    hydration_ml: parseNonNegMetricInput(fields.hydration_ml),
    protein_g: parseNonNegMetricInput(fields.protein_g),
    carbohydrate_g: parseNonNegMetricInput(fields.carbohydrate_g),
    calories_kcal: parseNonNegMetricInput(fields.calories_kcal),
    ai_evaluation: fields.ai_evaluation.trim(),
  };
}

function aiIntakeFieldTextsFromData(data: FoodTextIntakeJson): AiIntakeFieldTexts {
  return {
    food_summary: data.food_summary ?? '',
    hydration_ml: String(data.hydration_ml ?? 0),
    protein_g: String(data.protein_g ?? 0),
    carbohydrate_g: String(data.carbohydrate_g ?? 0),
    calories_kcal: String(data.calories_kcal ?? 0),
    ai_evaluation: data.ai_evaluation ?? '',
  };
}

function parseNonNegMetricInput(raw: string): number {
  const t = raw.replace(/,/g, '').trim();
  if (!t) return 0;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export type RecordIntakeConfirmPayload =
  /** 无 parsed 时由首页后台请求 AI 解析；有 parsed 时直接落库 */
  | { mode: 'ai'; text: string; parsed?: FoodTextIntakeJson }
  | { mode: 'manual'; amount: number; unit: ConfirmUnit; type: ManualType }
  | {
      mode: 'photo';
      imageBase64: string;
      imageMimeType: string;
      sourceImageUri: string | null;
      /** 选填，与图片一并交给识别模型 */
      photoNote?: string;
    };

function getUnitByType(type: ManualType): ConfirmUnit {
  if (type === 'hydration') return 'ml';
  if (type === 'protein') return 'g';
  if (type === 'carbohydrate') return 'g';
  return 'kcal';
}

function getManualMeta(type: ManualType) {
  if (type === 'hydration') {
    return { label: '水分', icon: 'water-drop' as const, unitText: 'ML', convertHint: (n: number) => `约 ${(n / 1000).toFixed(2)} 升` };
  }
  if (type === 'protein') {
    return { label: '蛋白质', icon: 'fitness-center' as const, unitText: 'G', convertHint: (n: number) => `约 ${(n / 1000).toFixed(3)} 千克` };
  }
  if (type === 'carbohydrate') {
    return { label: '碳水', icon: 'rice-bowl' as const, unitText: 'G', convertHint: (n: number) => `约 ${(n / 1000).toFixed(3)} 千克` };
  }
  return { label: '热量', icon: 'local-fire-department' as const, unitText: 'KCAL', convertHint: (n: number) => `约 ${(n / 1000).toFixed(2)} 千卡` };
}

export function RecordIntakeSheet({
  visible,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  onClose: () => void;
  onConfirm?: (payload: RecordIntakeConfirmPayload) => void | Promise<void>;
}) {
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  const [shouldRender, setShouldRender] = React.useState(visible);
  const [tab, setTab] = React.useState<TabKey>('manual');
  const [text, setText] = React.useState('');
  const [manualType, setManualType] = React.useState<ManualType>('hydration');
  const [amountText, setAmountText] = React.useState('0');
  const [photoUri, setPhotoUri] = React.useState<string | null>(null);
  const [photoBase64, setPhotoBase64] = React.useState<string | null>(null);
  const [photoMime, setPhotoMime] = React.useState('image/jpeg');
  const [photoNote, setPhotoNote] = React.useState('');
  const [photoError, setPhotoError] = React.useState<string | null>(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiError, setAiError] = React.useState<string | null>(null);
  const [aiResolved, setAiResolved] = React.useState<{ text: string; data: FoodTextIntakeJson } | null>(null);
  const [aiFieldTexts, setAiFieldTexts] = React.useState<AiIntakeFieldTexts | null>(null);

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
    setText('');
    setTab('manual');
    setManualType('hydration');
    setAmountText('0');
    setPhotoUri(null);
    setPhotoBase64(null);
    setPhotoMime('image/jpeg');
    setPhotoNote('');
    setPhotoError(null);
    setAiBusy(false);
    setAiError(null);
    setAiResolved(null);
    setAiFieldTexts(null);
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    if (aiResolved && text.trim() !== aiResolved.text) {
      setAiResolved(null);
      setAiFieldTexts(null);
      setAiError(null);
    }
  }, [text, visible, aiResolved]);

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

  const runAiIntakeParse = React.useCallback(async () => {
    const t = text.trim();
    if (!t) return;
    setAiBusy(true);
    setAiError(null);
    try {
      const r = await parseFoodIntakeFromText({ apiKey: getActiveAiLlmApiKey(), text: t });
      if (!r.ok) {
        setAiError(r.error);
        setAiResolved(null);
        setAiFieldTexts(null);
        return;
      }
      setAiResolved({ text: t, data: r.data });
      setAiFieldTexts(aiIntakeFieldTextsFromData(r.data));
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
      setAiResolved(null);
      setAiFieldTexts(null);
    } finally {
      setAiBusy(false);
    }
  }, [text]);

  const pickFromLibrary = React.useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setPhotoError('需要相册权限才能选图');
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: false,
      quality: 0.85,
      base64: true,
    });
    const asset = picked.assets?.[0];
    if (picked.canceled || !asset?.uri) return;
    const b64 = asset.base64;
    if (!b64) {
      setPhotoUri(asset.uri);
      setPhotoBase64(null);
      setPhotoError('无法读取图片数据，请重试或压缩后重选');
      return;
    }
    const mime = asset.mimeType?.trim() || 'image/jpeg';
    setPhotoUri(asset.uri);
    setPhotoBase64(b64);
    setPhotoMime(mime);
    setPhotoError(null);
  }, []);

  const takePhoto = React.useCallback(async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setPhotoError('需要相机权限才能拍照');
      return;
    }
    const shot = await ImagePicker.launchCameraAsync({
      allowsEditing: false,
      quality: 0.85,
      base64: true,
    });
    const asset = shot.assets?.[0];
    if (shot.canceled || !asset?.uri) return;
    const b64 = asset.base64;
    if (!b64) {
      setPhotoUri(asset.uri);
      setPhotoBase64(null);
      setPhotoError('无法读取图片数据，请重试');
      return;
    }
    const mime = asset.mimeType?.trim() || 'image/jpeg';
    setPhotoUri(asset.uri);
    setPhotoBase64(b64);
    setPhotoMime(mime);
    setPhotoError(null);
  }, []);

  if (!shouldRender) return null;

  const sheetBackground = theme.surface;
  const mutedText = theme.textSecondary;
  const border = isDark ? 'rgba(148, 163, 184, 0.16)' : '#e2e8f0';
  const tabBg = isDark ? 'rgba(148, 163, 184, 0.12)' : '#f1f5f9';
  const inputBg = isDark ? 'rgba(15, 23, 42, 0.4)' : 'rgba(248, 250, 252, 0.95)';
  const aiMiniEnabled = text.trim().length > 0;
  const aiMiniInactiveOpacity = aiMiniEnabledAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const aiMiniActiveOpacity = aiMiniEnabledAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 1] });

  const amount = Number.isFinite(Number(amountText)) ? Number(amountText) : 0;
  const amountDisplay = amountText === '' ? '0' : amountText;
  const manualMeta = getManualMeta(manualType);
  const photoConfirmDisabled = tab === 'photo' && !photoBase64;
  const aiConfirmDisabled = tab === 'ai' && !text.trim();
  const confirmDisabled = (tab === 'manual' && amount <= 0) || photoConfirmDisabled || aiConfirmDisabled;

  const handleConfirm = async () => {
    if (tab === 'manual' && amount <= 0) return;
    if (tab === 'photo' && photoConfirmDisabled) return;
    if (tab === 'ai') {
      const t = text.trim();
      if (!t) return;
      const hasParsedPreview = aiResolved?.text === t && aiFieldTexts != null;
      await Promise.resolve(
        onConfirm?.({
          mode: 'ai',
          text: t,
          ...(hasParsedPreview ? { parsed: foodTextIntakeFromFieldTexts(aiFieldTexts) } : {}),
        })
      );
      onClose();
      return;
    }
    if (tab === 'photo' && photoBase64) {
      const note = photoNote.trim();
      await Promise.resolve(
        onConfirm?.({
          mode: 'photo',
          imageBase64: photoBase64,
          imageMimeType: photoMime,
          sourceImageUri: photoUri,
          ...(note ? { photoNote: note } : {}),
        })
      );
      onClose();
      return;
    }
    await Promise.resolve(onConfirm?.({ mode: 'manual', amount, unit: getUnitByType(manualType), type: manualType }));
    onClose();
  };

  const onPressDigit = (digit: string) => {
    setAmountText((prev) => {
      const nextPrev = prev === '' ? '0' : prev;
      if (nextPrev.includes('.')) {
        const [, decimals = ''] = nextPrev.split('.');
        if (decimals.length >= 2) return nextPrev;
        if (nextPrev.length >= 7) return nextPrev;
        return `${nextPrev}${digit}`;
      }
      if (nextPrev === '0') return digit;
      if (nextPrev.length >= 5) return nextPrev;
      return `${nextPrev}${digit}`;
    });
  };

  const onPressDot = () => {
    setAmountText((prev) => {
      const nextPrev = prev === '' ? '0' : prev;
      if (nextPrev.includes('.')) return nextPrev;
      if (nextPrev.length >= 6) return nextPrev;
      return `${nextPrev}.`;
    });
  };

  const onPressBackspace = () => {
    setAmountText((prev) => {
      const nextPrev = prev === '' ? '0' : prev;
      if (nextPrev.length <= 1) return '0';
      const next = nextPrev.slice(0, -1);
      if (next === '' || next === '-') return '0';
      return next;
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

            <ScrollView
              style={styles.contentScroll}
              contentContainerStyle={styles.content}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={[styles.tabBar, { backgroundColor: tabBg, borderColor: border }]}>
                <Pressable onPress={() => setTab('ai')} style={[styles.tabBtn, tab === 'ai' && { backgroundColor: sheetBackground }]}>
                  <Text style={[styles.tabText, { color: tab === 'ai' ? theme.primary : mutedText }]}>AI 记录</Text>
                </Pressable>
                <Pressable onPress={() => setTab('photo')} style={[styles.tabBtn, tab === 'photo' && { backgroundColor: sheetBackground }]}>
                  <Text style={[styles.tabText, { color: tab === 'photo' ? theme.primary : mutedText }]}>拍照记录</Text>
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
                      editable={!aiBusy}
                      placeholder="您吃了或喝了什么？（例如：一碗牛肉面）"
                      placeholderTextColor={isDark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)'}
                      style={[styles.textarea, { color: theme.text }]}
                      textAlignVertical="top"
                    />
                    <Pressable
                      disabled={!aiMiniEnabled || aiBusy}
                      onPress={() => void runAiIntakeParse()}
                      style={styles.aiMiniBtn}
                      hitSlop={10}
                    >
                      {aiBusy ? (
                        <ActivityIndicator size="small" color={theme.primary} />
                      ) : (
                        <>
                          <Animated.View style={[styles.aiMiniIconLayer, { opacity: aiMiniInactiveOpacity }]}>
                            <MaterialIcons name="auto-awesome" size={20} color="#8fbc8f" />
                          </Animated.View>
                          <Animated.View style={[styles.aiMiniIconLayer, { opacity: aiMiniActiveOpacity }]}>
                            <MaterialIcons name="auto-awesome" size={20} color="#32cd32" />
                          </Animated.View>
                        </>
                      )}
                    </Pressable>
                    {aiBusy ? (
                      <View style={styles.aiTextareaOverlay}>
                        <Text style={[styles.aiOverlayHint, { color: theme.text }]}>AI 解析中…</Text>
                      </View>
                    ) : null}
                  </View>
                  {aiError ? <Text style={[styles.photoErrorText, { color: '#ef4444' }]}>{aiError}</Text> : null}
                  {aiResolved && aiResolved.text === text.trim() && aiFieldTexts && !aiBusy ? (
                    <View style={[styles.photoResultCard, { backgroundColor: isDark ? 'rgba(30,41,59,0.55)' : '#f8fafc', borderColor: border }]}>
                      <View style={styles.photoResultRow}>
                        <MaterialIcons name="auto-awesome" size={18} color="#10b981" />
                        <Text style={[styles.photoResultTitle, { color: theme.text }]}>估算结果（可编辑）</Text>
                      </View>
                      <Text style={[styles.aiEditLabel, { color: mutedText }]}>食物摘要</Text>
                      <TextInput
                        value={aiFieldTexts.food_summary}
                        onChangeText={(v) => setAiFieldTexts((prev) => (prev ? { ...prev, food_summary: v } : prev))}
                        multiline
                        placeholder="模型生成的食物摘要"
                        placeholderTextColor={isDark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)'}
                        style={[styles.aiEditInput, styles.aiEditInputMultiline, { color: theme.text, borderColor: border, backgroundColor: inputBg }]}
                      />
                      <Text style={[styles.aiEditHint, { color: mutedText }]}>
                        水分仅计汤/粥/饮料/水果等显性饮水，正餐不显性计水
                      </Text>
                      {(
                        [
                          { key: 'hydration_ml' as const, label: '水分 (ml)' },
                          { key: 'protein_g' as const, label: '蛋白质 (g)' },
                          { key: 'carbohydrate_g' as const, label: '碳水 (g)' },
                          { key: 'calories_kcal' as const, label: '热量 (kcal)' },
                        ] as const
                      ).map((row) => (
                        <View key={row.key} style={styles.aiMetricRow}>
                          <Text style={[styles.aiEditLabel, { color: mutedText }]}>{row.label}</Text>
                          <TextInput
                            value={aiFieldTexts[row.key]}
                            onChangeText={(v) => setAiFieldTexts((prev) => (prev ? { ...prev, [row.key]: v } : prev))}
                            keyboardType="decimal-pad"
                            placeholder="0"
                            placeholderTextColor={isDark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)'}
                            style={[styles.aiEditInput, styles.aiMetricInput, { color: theme.text, borderColor: border, backgroundColor: inputBg }]}
                          />
                        </View>
                      ))}
                      <Text style={[styles.aiEditLabel, { color: mutedText, marginTop: 4 }]}>AI 评价</Text>
                      <TextInput
                        value={aiFieldTexts.ai_evaluation}
                        onChangeText={(v) => setAiFieldTexts((prev) => (prev ? { ...prev, ai_evaluation: v } : prev))}
                        multiline
                        placeholder="预解析后可编辑；保存后写入摄入详情的 AI 评价"
                        placeholderTextColor={isDark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)'}
                        style={[styles.aiEditInput, styles.aiEditInputMultiline, { color: theme.text, borderColor: border, backgroundColor: inputBg }]}
                      />
                    </View>
                  ) : null}
                  <Text style={[styles.hint, { color: mutedText }]}>
                    点右下角魔法棒预解析后可修改数值；已预解析时点「确认添加」将直接写入，不再请求 AI。未预解析时确认后将在后台解析并写入。
                  </Text>
                </View>
              ) : tab === 'photo' ? (
                <View style={styles.photoWrap}>
                  <View style={styles.photoActionRow}>
                    <Pressable
                      onPress={() => void pickFromLibrary()}
                      style={({ pressed }) => [
                        styles.photoActionBtn,
                        {
                          backgroundColor: isDark ? 'rgba(51,65,85,0.75)' : '#f1f5f9',
                          borderColor: border,
                          opacity: pressed ? 0.92 : 1,
                        },
                      ]}
                    >
                      <MaterialIcons name="photo-library" size={22} color={theme.primary} />
                      <Text style={[styles.photoActionText, { color: theme.text }]}>相册选图</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void takePhoto()}
                      style={({ pressed }) => [
                        styles.photoActionBtn,
                        {
                          backgroundColor: isDark ? 'rgba(51,65,85,0.75)' : '#f1f5f9',
                          borderColor: border,
                          opacity: pressed ? 0.92 : 1,
                        },
                      ]}
                    >
                      <MaterialIcons name="photo-camera" size={22} color={theme.primary} />
                      <Text style={[styles.photoActionText, { color: theme.text }]}>拍照</Text>
                    </Pressable>
                  </View>

                  <View style={[styles.photoPreviewBox, { backgroundColor: inputBg, borderColor: border }]}>
                    {photoUri ? (
                      <Image source={{ uri: photoUri }} style={styles.photoPreviewImage} contentFit="cover" />
                    ) : (
                      <View style={styles.photoPreviewPlaceholder}>
                        <MaterialIcons name="image" size={40} color={mutedText} />
                        <Text style={[styles.photoPreviewHint, { color: mutedText }]}>请选择或拍摄食物照片</Text>
                      </View>
                    )}
                  </View>

                  {photoError ? (
                    <Text style={[styles.photoErrorText, { color: '#ef4444' }]}>{photoError}</Text>
                  ) : null}

                  <View style={[styles.photoNoteWrap, { backgroundColor: inputBg, borderColor: border }]}>
                    <Text style={[styles.photoNoteLabel, { color: mutedText }]}>文字说明（选填）</Text>
                    <TextInput
                      value={photoNote}
                      onChangeText={setPhotoNote}
                      multiline
                      placeholder="例如：半份、两人分食、菜名补充…"
                      placeholderTextColor={isDark ? 'rgba(148,163,184,0.7)' : 'rgba(100,116,139,0.7)'}
                      style={[styles.photoNoteInput, { color: theme.text }]}
                      textAlignVertical="top"
                    />
                  </View>

                  <Text style={[styles.hint, { color: mutedText }]}>
                    须先选择或拍摄照片；可选填说明帮助更准确估算。点「确认添加」后在后台识别并写入；失败时会提示。
                  </Text>
                </View>
              ) : (
                <View style={styles.manualWrap}>
                  <View style={styles.typeGrid}>
                    {[
                      { key: 'hydration' as const, label: '水分', icon: 'water-drop' as const },
                      { key: 'protein' as const, label: '蛋白质', icon: 'fitness-center' as const },
                      { key: 'carbohydrate' as const, label: '碳水', icon: 'rice-bowl' as const },
                      { key: 'calories' as const, label: '热量', icon: 'local-fire-department' as const },
                    ].map((item) => {
                      const selected = manualType === item.key;
                      return (
                        <Pressable
                          key={item.key}
                          onPress={() => {
                            setManualType(item.key);
                            setAmountText('0');
                          }}
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
                      <Text style={[styles.valueNumber, { color: theme.text }]}>{amountDisplay}</Text>
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
                      <Pressable
                        onPress={onPressDot}
                        style={({ pressed }) => [
                          styles.keypadBtn,
                          { backgroundColor: sheetBackground, borderColor: isDark ? 'rgba(148,163,184,0.18)' : '#f1f5f9' },
                          pressed && { transform: [{ scale: 0.95 }] },
                        ]}
                      >
                        <Text style={[styles.keypadBtnText, { color: theme.text }]}>.</Text>
                      </Pressable>
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

            </ScrollView>
            <View style={[styles.confirmFooter, { borderTopColor: border }]}>
              <Pressable
                disabled={confirmDisabled}
                onPress={() => {
                  void handleConfirm();
                }}
                style={({ pressed }) => [
                  styles.confirmBtn,
                  {
                    backgroundColor: theme.primary,
                    opacity: confirmDisabled ? 0.42 : pressed ? 0.94 : 1,
                  },
                ]}
              >
                <>
                  <Text style={styles.confirmText}>确认添加</Text>
                  <MaterialIcons name="check-circle" size={22} color="#fff" />
                </>
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
  contentScroll: { maxHeight: screenHeight - 240, flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingTop: 10, paddingBottom: 10, gap: 14 },
  tabBar: { flexDirection: 'row', borderRadius: 16, borderWidth: 1, padding: 4 },
  tabBtn: { flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingVertical: 10 },
  tabText: { fontSize: 11, fontWeight: '800' },
  inputSection: { gap: 10 },
  photoWrap: { gap: 12 },
  photoNoteWrap: { borderRadius: 16, borderWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 12 },
  photoNoteLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4, marginBottom: 8 },
  photoNoteInput: { fontSize: 15, lineHeight: 22, minHeight: 72, paddingVertical: 0 },
  photoActionRow: { flexDirection: 'row', gap: 10 },
  photoActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    paddingVertical: 14,
  },
  photoActionText: { fontSize: 14, fontWeight: '800' },
  photoPreviewBox: {
    borderRadius: 18,
    borderWidth: 1,
    height: 200,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoPreviewImage: { width: '100%', height: '100%' },
  photoPreviewPlaceholder: { alignItems: 'center', justifyContent: 'center', gap: 8, padding: 16 },
  photoPreviewHint: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  photoAnalyzingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  photoAnalyzingText: { fontSize: 14, fontWeight: '700' },
  photoErrorText: { fontSize: 12, fontWeight: '600', lineHeight: 18 },
  photoResultCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 6 },
  photoResultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  photoResultTitle: { fontSize: 15, fontWeight: '800' },
  photoResultLine: { fontSize: 13, fontWeight: '600', lineHeight: 20 },
  aiEditLabel: { fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  aiEditHint: { fontSize: 10, fontWeight: '600', lineHeight: 15, marginTop: -2 },
  aiEditInput: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, fontWeight: '600' },
  aiEditInputMultiline: { minHeight: 56, textAlignVertical: 'top' },
  aiMetricRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  aiMetricInput: { flex: 1, paddingVertical: 8 },
  textareaWrap: { borderRadius: 18, padding: 16, minHeight: 160, position: 'relative' },
  textarea: { fontSize: 16, lineHeight: 22, paddingRight: 34, minHeight: 128 },
  aiTextareaOverlay: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 18,
    backgroundColor: 'rgba(15,23,42,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiOverlayHint: { fontSize: 13, fontWeight: '700' },
  aiMiniBtn: { position: 'absolute', right: 12, bottom: 12, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  aiMiniIconLayer: { position: 'absolute' },
  hint: { fontSize: 11, fontWeight: '500', fontStyle: 'italic', paddingHorizontal: 2 },
  manualWrap: { gap: 12 },
  typeGrid: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'space-between' },
  typeCard: { width: '48%', borderRadius: 16, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', gap: 8 },
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
  confirmFooter: {
    paddingHorizontal: 18,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  confirmBtn: {
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
