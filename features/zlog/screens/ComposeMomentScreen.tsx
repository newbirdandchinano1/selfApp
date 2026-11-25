import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useTheme } from '../theme/ThemeContext';
import { fonts } from '../theme/colors';
import { api } from '../api/client';
import { useAppStore } from '../store/AppStore';
import { useToast } from '../components/Toast';
import { GradientCover } from '../components/GradientCover';

interface PickedImage {
  url: string;
  local: string;
}

export default function ComposeMomentScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { show } = useToast();
  const { createMoment } = useAppStore();

  const [content, setContent] = useState('');
  const [images, setImages] = useState<PickedImage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const canPublish = content.trim().length > 0 || images.length > 0;
  const tile = (width - 40 - 18) / 3;

  const pickImages = async () => {
    if (uploading) return;
    if (images.length >= 9) {
      show('最多 9 张图片', 'warn');
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      show('需要相册权限才能选择图片', 'warn');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: true,
      selectionLimit: 9 - images.length,
      quality: 0.85,
    });
    if (result.canceled) return;

    setUploading(true);
    try {
      const uploaded: PickedImage[] = [];
      for (const asset of result.assets) {
        const data = await api.uploadImage(asset.uri);
        uploaded.push({ url: data.url, local: asset.uri });
      }
      setImages((prev) => [...prev, ...uploaded]);
      show(`已上传 ${uploaded.length} 张图片`, 'ok');
    } catch (err: any) {
      show(err?.message || '图片上传失败', 'err');
    } finally {
      setUploading(false);
    }
  };

  const publish = async () => {
    if (!canPublish || publishing) return;
    setPublishing(true);
    try {
      await createMoment({
        content: content.trim(),
        images: images.map((i) => i.url),
      });
      show('说说发布成功 ✓', 'ok');
      router.back();
    } catch (err: any) {
      show(err?.message || '发布失败', 'err');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* 头部 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 20,
          paddingTop: insets.top + 6,
          paddingBottom: 10,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={{ fontSize: 14, color: colors.inkSoft }}>取消</Text>
        </Pressable>
        <Text
          style={{
            fontFamily: fonts.serif,
            fontWeight: '700',
            fontSize: 17,
            color: colors.ink,
          }}
        >
          发说说
        </Text>
        <View style={{ width: 30 }} />
      </View>

      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 24,
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder="此刻的想法…（文字 / 图片至少一项）"
          placeholderTextColor={colors.inkFaint}
          multiline
          maxLength={300}
          textAlignVertical="top"
          style={{
            minHeight: 130,
            backgroundColor: colors.surface,
            borderWidth: 1.5,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 15,
            fontSize: 15,
            lineHeight: 24,
            color: colors.ink,
          }}
        />
        <Text
          style={{
            textAlign: 'right',
            fontSize: 11.5,
            marginTop: 6,
            color:
              content.length >= 300
                ? colors.danger
                : content.length >= 270
                ? colors.amber
                : colors.inkFaint,
          }}
        >
          {content.length} / 300
        </Text>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 16,
            marginBottom: 10,
          }}
        >
          <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.inkSoft }}>
            图片
          </Text>
          <Text style={{ fontSize: 11.5, color: colors.inkFaint }}>
            最多 9 张 · {images.length}/9
          </Text>
        </View>

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
          {images.map((img, i) => (
            <View
              key={`${img.url}-${i}`}
              style={{
                width: tile,
                height: tile,
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: colors.surface2,
              }}
            >
              <Image
                source={{ uri: img.local }}
                style={{ width: '100%', height: '100%' }}
              />
              <Pressable
                onPress={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                style={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  backgroundColor: 'rgba(18,26,22,0.6)',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                hitSlop={6}
              >
                <Ionicons name="close" size={14} color="#FFF" />
              </Pressable>
            </View>
          ))}

          {images.length < 9 ? (
            <Pressable
              onPress={pickImages}
              style={{
                width: tile,
                height: tile,
                borderRadius: 14,
                borderWidth: 1.5,
                borderStyle: 'dashed',
                borderColor: colors.borderStrong,
                backgroundColor: colors.surface2,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
              }}
            >
              {uploading ? (
                <ActivityIndicator color={colors.sage} />
              ) : (
                <>
                  <Ionicons name="add" size={24} color={colors.inkFaint} />
                  <Text style={{ fontSize: 11, color: colors.inkFaint }}>添加</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>

        <Text
          style={{
            fontSize: 12.5,
            fontWeight: '600',
            color: colors.inkSoft,
            marginTop: 20,
            marginBottom: 10,
          }}
        >
          外链卡片
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            backgroundColor: colors.surface2,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            padding: 10,
          }}
        >
          <GradientCover seed={7} glyph="链" width={52} height={52} radius={10} fontSize={20} />
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontSize: 10.5,
                fontWeight: '700',
                letterSpacing: 0.8,
                color: colors.sage,
              }}
            >
              LINK CARD
            </Text>
            <Text style={{ fontSize: 12.5, color: colors.inkFaint, marginTop: 2 }}>
              粘贴链接自动生成卡片（第一期可忽略）
            </Text>
          </View>
        </View>

        <Pressable
          onPress={publish}
          disabled={!canPublish || publishing}
          style={{ marginTop: 24 }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 9,
              paddingVertical: 15,
              borderRadius: 16,
              backgroundColor: colors.brand,
              opacity: !canPublish || publishing ? 0.45 : 1,
            }}
          >
            {publishing ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Ionicons name="paper-plane" size={17} color={colors.onBrand} />
            )}
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.onBrand }}>
              {publishing ? '发布中…' : '发布说说'}
            </Text>
          </View>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
