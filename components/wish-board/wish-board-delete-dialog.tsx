import type { WishBoxPalette, WishBoxShadowSet } from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

type Props = {
  visible: boolean;
  wishTitle: string;
  onClose: () => void;
  onConfirm: () => void;
  confirming?: boolean;
};

export function WishBoardDeleteDialog({
  visible,
  wishTitle,
  onClose,
  onConfirm,
  confirming = false,
}: Props) {
  const { shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.root}>
        <Pressable
          style={styles.overlay}
          onPress={confirming ? undefined : onClose}
          accessibilityLabel="关闭"
        />
        <View style={[styles.panel, shadows.dialog]}>
          <View style={styles.warn}>
            <Text style={styles.warnEmoji}>🗑️</Text>
          </View>
          <Text style={styles.heading}>删除这个心愿？</Text>
          <Text style={styles.sub}>
            「{wishTitle}」删除后不可恢复，{'\n'}但已产生的积分足迹会保留。
          </Text>
          <View style={styles.footer}>
            <Pressable
              onPress={onClose}
              disabled={confirming}
              style={({ pressed }) => [
                styles.btnGhost,
                { opacity: confirming ? 0.5 : pressed ? 0.88 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="取消">
              <Text style={styles.btnGhostText}>取消</Text>
            </Pressable>
            <Pressable
              onPress={onConfirm}
              disabled={confirming}
              style={({ pressed }) => [
                styles.btnDanger,
                shadows.dangerButton,
                { opacity: confirming ? 0.85 : pressed ? 0.9 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="确认删除">
              {confirming ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnDangerText}>确认删除</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 38,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.overlay,
  },
  panel: {
    width: '100%',
    backgroundColor: c.sheet,
    borderRadius: 26,
    paddingTop: 26,
    paddingHorizontal: 22,
    paddingBottom: 22,
    alignItems: 'center',
  },
  warn: {
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: c.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -52,
    marginBottom: 6,
    borderWidth: 4,
    borderColor: c.sheet,
  },
  warnEmoji: {
    fontSize: 32,
  },
  heading: {
    fontSize: 19,
    fontWeight: '800',
    color: c.ink,
    textAlign: 'center',
  },
  sub: {
    fontSize: 13,
    color: c.muted,
    marginTop: 7,
    lineHeight: 22,
    textAlign: 'center',
  },
  footer: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
    width: '100%',
  },
  btnGhost: {
    flex: 1,
    height: 50,
    borderRadius: 17,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhostText: {
    fontSize: 16,
    fontWeight: '800',
    color: c.ink,
  },
  btnDanger: {
    flex: 1,
    height: 50,
    borderRadius: 17,
    backgroundColor: c.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnDangerText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: 1,
  },
  });
}
