import React, { useEffect, useState } from 'react';
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
import { Chip } from '../components/Chip';
import { Segmented } from '../components/Segmented';
import { GradientCover } from '../components/GradientCover';
import { textToHtml } from '../utils/html';

const STATUS_OPTIONS = [
  { label: '存草稿', value: 0 },
  { label: '发布', value: 1 },
];

export default function ComposeBlogScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { show } = useToast();
  const { categories, refreshCategories, publishPost } = useAppStore();

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [content, setContent] = useState('');
  const [categoryId, setCategoryId] = useState<number | undefined>(undefined);
  const [status, setStatus] = useState<0 | 1>(1);
  const [cover, setCover] = useState<{ url: string; local: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const coverTile = (width - 40 - 18) / 3;

  useEffect(() => {
    void refreshCategories();
  }, [refreshCategories]);

  useEffect(() => {
    if (categoryId === undefined && categories.length) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const pickCover = async () => {
    if (uploading) return;
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      show('需要相册权限才能选择封面', 'warn');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'] as any,
      allowsMultipleSelection: false,
      quality: 0.85,
    });
    if (result.canceled || !result.assets.length) return;
    setUploading(true);
    try {
      const data = await api.uploadImage(result.assets[0].uri);
      setCover({ url: data.url, local: result.assets[0].uri });
      show('封面上传成功', 'ok');
    } catch (err: any) {
      show(err?.message || '封面上传失败', 'err');
    } finally {
      setUploading(false);
    }
  };

  const publish = async () => {
    if (!title.trim()) {
      show('请填写标题', 'err');
      return;
    }
    if (publishing) return;
    setPublishing(true);
    try {
      await publishPost({
        title: title.trim(),
        summary: summary.trim(),
        contentMd: content,
        contentHtml: textToHtml(content || title),
        cover: cover?.url ?? null,
        categoryId,
        tagIds: [],
        status,
      });
      show(status === 1 ? '博客发布成功 ✓' : '草稿已保存 ✓', 'ok');
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
          写博客
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
        <FieldLabel text="标题" />
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="给文章起个标题"
          placeholderTextColor={colors.inkFaint}
          style={inputStyle(colors)}
        />

        <FieldLabel text="分类" hint="GET /api/post-category/list" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {categories.map((c) => (
            <Chip
              key={c.id}
              label={c.name}
              color={c.color}
              active={categoryId === c.id}
              onPress={() => setCategoryId(c.id)}
            />
          ))}
        </ScrollView>

        <FieldLabel text="封面" hint="可选" />
        <View style={{ flexDirection: 'row', gap: 9 }}>
          {cover ? (
            <View
              style={{
                width: coverTile,
                height: coverTile,
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: colors.surface2,
              }}
            >
              <Image source={{ uri: cover.local }} style={{ width: '100%', height: '100%' }} />
              <Pressable
                onPress={() => setCover(null)}
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
          ) : (
            <Pressable
              onPress={pickCover}
              style={{
                width: coverTile,
                height: coverTile,
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
                  <Ionicons name="image-outline" size={22} color={colors.inkFaint} />
                  <Text style={{ fontSize: 11, color: colors.inkFaint }}>封面</Text>
                </>
              )}
            </Pressable>
          )}
          <View
            style={{
              width: coverTile,
              height: coverTile,
              borderRadius: 14,
              overflow: 'hidden',
              opacity: 0.55,
            }}
          >
            <GradientCover seed={5} glyph="封" width={coverTile} height={coverTile} radius={14} />
          </View>
        </View>

        <FieldLabel text="摘要" hint="可选" />
        <TextInput
          value={summary}
          onChangeText={setSummary}
          placeholder="一两句话概括…"
          placeholderTextColor={colors.inkFaint}
          style={[inputStyle(colors), { height: 72 }]}
          multiline
          textAlignVertical="top"
        />

        <FieldLabel text="正文" hint="Markdown" />
        <TextInput
          value={content}
          onChangeText={setContent}
          placeholder={'# 标题\n\n开始书写…'}
          placeholderTextColor={colors.inkFaint}
          style={[inputStyle(colors), { height: 170, lineHeight: 24 }]}
          multiline
          textAlignVertical="top"
        />

        <FieldLabel text="状态" />
        <Segmented
          options={STATUS_OPTIONS}
          value={status}
          onChange={(v) => setStatus(v as 0 | 1)}
        />

        <Pressable
          onPress={publish}
          disabled={publishing}
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
              opacity: publishing ? 0.55 : 1,
            }}
          >
            {publishing ? (
              <ActivityIndicator color={colors.onBrand} />
            ) : (
              <Ionicons
                name={status === 1 ? 'paper-plane' : 'save-outline'}
                size={17}
                color={colors.onBrand}
              />
            )}
            <Text style={{ fontSize: 15, fontWeight: '700', color: colors.onBrand }}>
              {publishing ? '提交中…' : status === 1 ? '发布博客' : '保存草稿'}
            </Text>
          </View>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function FieldLabel({ text, hint }: { text: string; hint?: string }) {
  const { colors } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: 18,
        marginBottom: 8,
      }}
    >
      <Text style={{ fontSize: 12.5, fontWeight: '600', color: colors.inkSoft }}>
        {text}
      </Text>
      {hint ? (
        <Text style={{ fontSize: 11.5, color: colors.inkFaint }}>{hint}</Text>
      ) : null}
    </View>
  );
}

function inputStyle(colors: any) {
  return {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 15,
    paddingVertical: 13,
    fontSize: 14.5,
    color: colors.ink,
  } as const;
}
