import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  uris: string[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
};

/** 全屏图片预览：左右滑动切换，点空白 / 关闭退出 */
export function ImageLightbox({ uris, initialIndex, visible, onClose }: Props) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const list = uris.map((u) => u.trim()).filter(Boolean);
  const startIndex = Math.max(0, Math.min(initialIndex, Math.max(0, list.length - 1)));
  const [index, setIndex] = useState(startIndex);
  const listRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    if (!visible) return;
    setIndex(startIndex);
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: startIndex, animated: false });
    });
    return () => cancelAnimationFrame(id);
  }, [visible, startIndex]);

  if (list.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="关闭图片预览"
        />
        <FlatList
          ref={listRef}
          data={list}
          keyExtractor={(item, i) => `${item}-${i}`}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={startIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) => {
            const next = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
            setIndex(Math.max(0, Math.min(list.length - 1, next)));
          }}
          onScrollToIndexFailed={() => {
            listRef.current?.scrollToOffset({ offset: width * startIndex, animated: false });
          }}
          renderItem={({ item }) => (
            <Pressable
              style={{ width, height, justifyContent: 'center', alignItems: 'center' }}
              onPress={onClose}
            >
              <Image
                source={{ uri: item }}
                style={{ width, height: height * 0.82 }}
                resizeMode="contain"
              />
            </Pressable>
          )}
        />
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityLabel="关闭"
          style={({ pressed }) => [
            styles.close,
            { top: Math.max(12, insets.top + 8), opacity: pressed ? 0.7 : 1 },
          ]}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>
        {list.length > 1 ? (
          <Text style={[styles.counter, { bottom: Math.max(20, insets.bottom + 12) }]}>
            {index + 1} / {list.length}
          </Text>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
  },
  close: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '600',
  },
});
