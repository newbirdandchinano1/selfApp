import { AddWishBoardModal } from '@/components/wish-board/add-wish-board-modal';
import { WishBoardDeleteDialog } from '@/components/wish-board/wish-board-delete-dialog';
import {
  formatWishBoxPoints,
  wishBoxTintWash,
  type WishBoxPalette,
  type WishBoxShadowSet,
} from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { useReducedMotionState } from '@/hooks/use-reduced-motion';
import { useWishBoardData } from '@/hooks/use-wish-board-data';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { resolveWishBoardIconOption } from '@/lib/constants/wish-board-icons';
import { deleteWishBoardItem } from '@/lib/repositories/wish-board/wish-board';
import type { WishBoardItemRow } from '@/lib/repositories/wish-board/wish-board.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** 「···」行菜单：编辑 / 删除（设计稿 09） */
export default function WishBoardManageScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { c, shadows } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);
  const { enabled: reduceMotion, ready: motionReady } = useReducedMotionState();
  const entranceOn = motionReady && !reduceMotion;

  const {
    items,
    activeItems,
    eligibilityById,
    redeemRecords,
    loading,
    loadError,
    reload,
    refreshControl,
  } = useWishBoardData();

  const [addVisible, setAddVisible] = useState(false);
  const [menuItem, setMenuItem] = useState<WishBoardItemRow | null>(null);
  const [deleteItem, setDeleteItem] = useState<WishBoardItemRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const redeemCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const record of redeemRecords) {
      map.set(record.wish_id, (map.get(record.wish_id) ?? 0) + 1);
    }
    return map;
  }, [redeemRecords]);

  const subtitleOf = useCallback(
    (item: WishBoardItemRow) =>
      buildRowSubtitle(
        item,
        redeemCountById.get(item.id) ?? 0,
        eligibilityById.get(item.id)?.ok ?? false,
      ),
    [eligibilityById, redeemCountById],
  );

  const closeMenu = useCallback(() => setMenuItem(null), []);

  const openEdit = useCallback(
    (item: WishBoardItemRow) => {
      setMenuItem(null);
      router.push(`/edit-wish-board-item/${item.id}`);
    },
    [router],
  );

  const askDelete = useCallback((item: WishBoardItemRow) => {
    setMenuItem(null);
    setDeleteItem(item);
  }, []);

  const confirmDelete = useCallback(async () => {
    if (!deleteItem || deleting) return;
    const target = deleteItem;
    setDeleting(true);
    try {
      await deleteWishBoardItem(target.id);
      setDeleteItem(null);
      setRemovingId(target.id);
      toast.success('已删除心愿');
    } catch (e) {
      toast.error(toUserMessage(e, '删除失败，请稍后重试'));
    } finally {
      setDeleting(false);
    }
  }, [deleteItem, deleting]);

  /** 行折叠退场结束（300ms）后再刷新数据，避免列表闪跳 */
  const onRowRemoved = useCallback(() => {
    setRemovingId(null);
    void reload();
  }, [reload]);

  const renderRow = useCallback(
    ({ item, index }: ListRenderItemInfo<WishBoardItemRow>) => (
      <ManageRow
        item={item}
        index={index}
        animate={entranceOn}
        eligible={eligibilityById.get(item.id)?.ok ?? false}
        subtitle={subtitleOf(item)}
        highlighted={menuItem?.id === item.id || deleteItem?.id === item.id}
        removing={removingId === item.id}
        onPress={() => setMenuItem(item)}
        onRemoved={onRowRemoved}
      />
    ),
    [deleteItem?.id, eligibilityById, entranceOn, menuItem?.id, onRowRemoved, removingId, subtitleOf],
  );

  const listFooter =
    activeItems.length > 0 ? (
      <Text style={styles.note}>💡 点击「···」可编辑心愿信息，或删除不再想要的心愿。</Text>
    ) : null;

  const empty =
    !loading && !loadError && activeItems.length === 0 ? (
      <View style={styles.emptyBox}>
        <Text style={styles.emptyEmoji}>🎁</Text>
        <Text style={styles.emptyTitle}>{items.length === 0 ? '还没有心愿' : '没有可管理的心愿'}</Text>
        <Text style={styles.emptySub}>
          {items.length === 0 ? '点右上角 ＋ 许下第一个心愿' : '兑换完成的心愿已归档到兑换足迹'}
        </Text>
        <Pressable
          onPress={() => setAddVisible(true)}
          style={({ pressed }) => [styles.emptyAdd, { opacity: pressed ? 0.9 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="新增心愿">
          <Text style={styles.emptyAddText}>＋ 新增心愿</Text>
        </Pressable>
      </View>
    ) : null;

  const menuIcon = menuItem ? resolveWishBoardIconOption(menuItem.icon_key) : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top, backgroundColor: c.bg }]}>
      <View style={styles.appbar}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [styles.navBtn, shadows.soft, { opacity: pressed ? 0.88 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="返回">
          <MaterialIcons name="arrow-back-ios-new" size={16} color={c.ink} />
        </Pressable>
        <Text style={[styles.navTitle, { color: c.ink }]}>心愿管理</Text>
        <Pressable
          onPress={() => setAddVisible(true)}
          style={({ pressed }) => [styles.navBtn, shadows.soft, { opacity: pressed ? 0.88 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="新增心愿">
          <MaterialIcons name="add" size={22} color={c.pri} />
        </Pressable>
      </View>

      {loading && items.length === 0 ? (
        <View style={styles.centerBox}>
          <Text style={styles.centerText}>加载中…</Text>
        </View>
      ) : (
        <FlatList
          data={activeItems}
          keyExtractor={item => item.id}
          renderItem={renderRow}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={loadError ? <Text style={styles.errorText}>{loadError}</Text> : null}
          ListFooterComponent={listFooter}
          ListEmptyComponent={empty}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        />
      )}

      <AddWishBoardModal
        visible={addVisible}
        onClose={() => setAddVisible(false)}
        onCreated={() => void reload()}
      />

      <Modal
        visible={Boolean(menuItem)}
        transparent
        animationType="fade"
        onRequestClose={closeMenu}>
        <View style={styles.sheetRoot}>
          <Pressable style={styles.sheetOverlay} onPress={closeMenu} accessibilityLabel="关闭" />
          {menuItem && menuIcon ? (
            <View
              style={[
                styles.sheet,
                shadows.sheet,
                { paddingBottom: Math.max(insets.bottom, 18) },
              ]}>
              <View style={styles.handle} />
              <View style={styles.sheetHead}>
                <View
                  style={[styles.sheetIcon, { backgroundColor: wishBoxTintWash(menuIcon.tint) }]}>
                  <Text style={styles.sheetEmoji}>{menuIcon.emoji}</Text>
                </View>
                <View style={styles.sheetHeadBody}>
                  <Text style={styles.sheetTitle} numberOfLines={1}>
                    {menuItem.title}
                  </Text>
                  <Text style={styles.sheetSub} numberOfLines={1}>
                    {subtitleOf(menuItem)}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => openEdit(menuItem)}
                style={({ pressed }) => [styles.option, { opacity: pressed ? 0.9 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="编辑心愿">
                <View style={styles.optionIcon}>
                  <MaterialIcons name="edit" size={18} color={c.pri} />
                </View>
                <Text style={styles.optionText}>编辑心愿</Text>
                <MaterialIcons name="chevron-right" size={20} color={c.muted} />
              </Pressable>

              <Pressable
                onPress={() => askDelete(menuItem)}
                style={({ pressed }) => [styles.option, { opacity: pressed ? 0.9 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="删除心愿">
                <View style={[styles.optionIcon, styles.optionIconDanger]}>
                  <MaterialIcons name="delete-outline" size={19} color={c.danger} />
                </View>
                <Text style={[styles.optionText, styles.optionTextDanger]}>删除心愿</Text>
                <MaterialIcons name="chevron-right" size={20} color={c.muted} />
              </Pressable>

              <Pressable
                onPress={closeMenu}
                style={({ pressed }) => [styles.cancelBtn, { opacity: pressed ? 0.88 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel="取消">
                <Text style={styles.cancelText}>取消</Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </Modal>

      <WishBoardDeleteDialog
        visible={Boolean(deleteItem)}
        wishTitle={deleteItem?.title ?? ''}
        confirming={deleting}
        onClose={() => {
          if (!deleting) setDeleteItem(null);
        }}
        onConfirm={() => void confirmDelete()}
      />
    </View>
  );
}

/** 行副文案：类型、分值与兑换次数（设计稿 09） */
function buildRowSubtitle(
  item: WishBoardItemRow,
  redeemCount: number,
  eligible: boolean,
): string {
  const typeText = item.wish_type === 'repeat' ? '可重复' : '一次性';
  const points = `${formatWishBoxPoints(item.cost_points)} 积分`;
  if (!eligible) return `${typeText} · ${points} · 暂不可兑`;
  if (item.wish_type === 'repeat' && redeemCount > 0) {
    return `${typeText} · ${points} · 已兑换 ${redeemCount} 次`;
  }
  return `${typeText} · ${points} · 可兑换`;
}

type ManageRowProps = {
  item: WishBoardItemRow;
  index: number;
  animate: boolean;
  eligible: boolean;
  subtitle: string;
  highlighted: boolean;
  removing: boolean;
  onPress: () => void;
  onRemoved: () => void;
};

function ManageRow({
  item,
  index,
  animate,
  eligible,
  subtitle,
  highlighted,
  removing,
  onPress,
  onRemoved,
}: ManageRowProps) {
  const styles = useWishStyles(makeStyles);
  const [rise] = useState(() => new Animated.Value(animate ? 0 : 1));
  const [collapse] = useState(() => new Animated.Value(1));
  const icon = resolveWishBoardIconOption(item.icon_key);

  useEffect(() => {
    if (!animate) {
      rise.setValue(1);
      return;
    }
    rise.setValue(0);
    const anim = Animated.timing(rise, {
      toValue: 1,
      duration: 460,
      delay: Math.min(index, 8) * 55 + 120,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => {
      anim.stop();
    };
  }, [animate, index, rise]);

  useEffect(() => {
    if (!removing) return;
    const anim = Animated.timing(collapse, {
      toValue: 0,
      duration: 300,
      easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) onRemoved();
    });
    return () => {
      anim.stop();
    };
  }, [collapse, onRemoved, removing]);

  const translateY = rise.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });
  const maxHeight = collapse.interpolate({ inputRange: [0, 1], outputRange: [0, 96] });
  const marginBottom = collapse.interpolate({ inputRange: [0, 1], outputRange: [0, 10] });

  return (
    <Animated.View style={{ maxHeight, marginBottom, opacity: collapse, overflow: 'hidden' }}>
      <Animated.View style={{ opacity: rise, transform: [{ translateY }] }}>
        <Pressable
          onPress={onPress}
          style={({ pressed }) => [
            styles.row,
            highlighted && styles.rowActive,
            !eligible && styles.rowDim,
            pressed && styles.rowPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={`管理「${item.title}」`}>
          <View style={[styles.rowIcon, { backgroundColor: wishBoxTintWash(icon.tint) }]}>
            <Text style={styles.rowEmoji}>{icon.emoji}</Text>
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.title}
            </Text>
            <Text style={styles.rowSub} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
          <Text style={[styles.dots, highlighted && styles.dotsActive]}>···</Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

function makeStyles(c: WishBoxPalette, shadows: WishBoxShadowSet) {
  return StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: c.bg,
  },
  appbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 2,
  },
  navBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: c.card,
    borderWidth: 1,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '800',
    color: c.ink,
  },
  listContent: {
    paddingTop: 12,
    paddingHorizontal: 16,
    paddingBottom: 30,
    flexGrow: 1,
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerText: {
    fontSize: 13,
    fontWeight: '600',
    color: c.muted,
  },
  errorText: {
    textAlign: 'center',
    color: c.danger,
    fontWeight: '600',
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.card,
    borderRadius: 19,
    borderWidth: 1,
    borderColor: c.line,
    paddingVertical: 13,
    paddingHorizontal: 14,
    ...shadows.soft,
  },
  rowActive: {
    borderWidth: 1.5,
    borderColor: c.priLine,
    shadowColor: c.pri,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.16,
    shadowRadius: 13,
    elevation: 5,
  },
  rowDim: {
    opacity: 0.8,
  },
  rowPressed: {
    transform: [{ scale: 0.985 }],
  },
  rowIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowEmoji: {
    fontSize: 24,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: c.ink,
  },
  rowSub: {
    fontSize: 11,
    fontWeight: '600',
    color: c.muted,
    fontVariant: ['tabular-nums'],
  },
  dots: {
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 1,
    color: c.dots,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  dotsActive: {
    color: c.pri,
  },
  note: {
    marginTop: 2,
    paddingHorizontal: 6,
    fontSize: 11.5,
    lineHeight: 19,
    fontWeight: '600',
    color: c.muted,
  },
  emptyBox: {
    alignItems: 'center',
    paddingTop: 56,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyEmoji: {
    fontSize: 40,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: c.ink,
  },
  emptySub: {
    fontSize: 12,
    fontWeight: '600',
    color: c.muted,
    textAlign: 'center',
  },
  emptyAdd: {
    marginTop: 10,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: c.dashedLine,
    borderRadius: 16,
    paddingVertical: 11,
    paddingHorizontal: 26,
    backgroundColor: c.card,
  },
  emptyAddText: {
    fontSize: 13,
    fontWeight: '800',
    color: c.dashedText,
  },
  sheetRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: c.overlay,
  },
  sheet: {
    backgroundColor: c.sheet,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 12,
    paddingHorizontal: 20,
  },
  handle: {
    width: 44,
    height: 5,
    borderRadius: 99,
    backgroundColor: c.handle,
    alignSelf: 'center',
    marginTop: 2,
    marginBottom: 14,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  sheetIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetEmoji: {
    fontSize: 24,
  },
  sheetHeadBody: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: c.ink,
  },
  sheetSub: {
    fontSize: 11.5,
    fontWeight: '600',
    color: c.muted,
    fontVariant: ['tabular-nums'],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: c.card,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: c.line,
    paddingVertical: 13,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  optionIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: c.priSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconDanger: {
    backgroundColor: c.dangerSoft,
  },
  optionText: {
    flex: 1,
    fontSize: 14.5,
    fontWeight: '800',
    color: c.ink,
  },
  optionTextDanger: {
    color: c.danger,
  },
  cancelBtn: {
    height: 50,
    borderRadius: 17,
    backgroundColor: c.card,
    borderWidth: 1.5,
    borderColor: c.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '800',
    color: c.ink,
  },
  });
}
