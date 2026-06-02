import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { usePageApiSync, usePagePullRefresh } from '@/hooks/use-page-api-sync';
import { createHabitContext, deleteHabitContexts, getHabitContexts, updateHabitContextsSortOrder } from '@/lib/repositories/habits/habit-context';
import { getHabits } from '@/lib/repositories/habits/habit';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import React from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

type ContextRow = { id: string; name: string; count: number | null; isDefault?: boolean };

const PAGE_API_KEY = 'habit-context';

export default function HabitContextScreen() {
  const router = useRouter();
  const { wrapLoad } = usePageApiSync(PAGE_API_KEY);
  const insets = useSafeAreaInsets();
  const colorScheme = useColorScheme();
  const scheme = (colorScheme ?? 'light') as keyof typeof Colors;
  const theme = Colors[scheme];
  const isDark = colorScheme === 'dark';

  const bg = isDark ? theme.background : '#ffffff';
  const card = isDark ? 'rgba(15,23,42,0.86)' : '#F7F7F9';
  const textSub = theme.textSecondary;
  const headerBg = isDark ? 'rgba(15,23,42,0.88)' : 'rgba(255,255,255,0.92)';

  const [contextData, setContextData] = React.useState<ContextRow[]>([]);
  const [editMode, setEditMode] = React.useState(false);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [addVisible, setAddVisible] = React.useState(false);
  const [newContextName, setNewContextName] = React.useState('');

  const reload = React.useCallback(async (forceApi = false) => {
    await wrapLoad(async () => {
    try {
      const [contexts, habits] = await Promise.all([getHabitContexts(), getHabits()]);
      const countByContext = new Map<string, number>();
      habits.forEach((r) => {
        const prev = countByContext.get(r.context) ?? 0;
        countByContext.set(r.context, prev + 1);
      });

      const orderedContexts = contexts.map((c) => ({ id: c.id, name: c.name }));
      const knownNames = new Set(orderedContexts.map((c) => c.name));
      const legacyContexts = Array.from(countByContext.keys())
        .filter((ctx) => !knownNames.has(ctx))
        .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
      const allContexts = [...orderedContexts, ...legacyContexts.map((name) => ({ id: name, name }))];

      const next = allContexts.map((ctx) => {
        const cnt = countByContext.get(ctx.name) ?? 0;
        return { id: ctx.id, name: ctx.name, count: cnt > 0 ? cnt : null, isDefault: ctx.name === '全天' };
      });
      setContextData(next);
    } catch (err) {
      console.warn('加载习惯情境失败', err);
      setContextData((prev) => prev);
    }
    }, forceApi);
  }, [wrapLoad]);

  const { refreshControl } = usePagePullRefresh(PAGE_API_KEY, reload);

  useFocusEffect(
    React.useCallback(() => {
      void reload();
    }, [reload])
  );

  const persistOrder = React.useCallback(async (rows: ContextRow[]) => {
    try {
      await updateHabitContextsSortOrder(rows.map((r) => r.id));
    } catch (err) {
      console.warn('更新情境排序失败', err);
    }
  }, []);

  const toggleEditMode = () => {
    setEditMode((v) => {
      const next = !v;
      if (!next) setSelectedIds(new Set());
      return next;
    });
  };

  const toggleSelected = React.useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const confirmDeleteSelected = React.useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;

    const selectedRows = contextData.filter((r) => ids.includes(r.id));
    const hasHabits = selectedRows.filter((r) => (r.count ?? 0) > 0);
    if (hasHabits.length > 0) {
      const names = hasHabits.map((r) => r.name).join('、');
      Alert.alert(
        '无法删除',
        hasHabits.length === 1
          ? `「${hasHabits[0].name}」下仍有打卡项，请先在「打卡管理」中编辑或移除相关打卡后再删除该情境。`
          : `以下情境下仍有打卡项：${names}。请先在「打卡管理」中处理后再删除。`,
        [{ text: '知道了', style: 'default' }]
      );
      return;
    }

    Alert.alert('删除情境', `确认删除选中的 ${ids.length} 个情境吗？`, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteHabitContexts(ids);
              setSelectedIds(new Set());
              setEditMode(false);
              await loadContextCounts();
            } catch (err) {
              console.warn('删除情境失败', err);
            }
          })();
        },
      },
    ]);
  }, [contextData, loadContextCounts, selectedIds]);

  const openAdd = () => {
    setNewContextName('');
    setAddVisible(true);
  };
  const closeAdd = () => setAddVisible(false);

  const saveNewContext = React.useCallback(() => {
    const name = newContextName.trim();
    if (!name) return;
    void (async () => {
      try {
        await createHabitContext(name);
        setAddVisible(false);
        await loadContextCounts();
      } catch (err) {
        Alert.alert('添加失败', err instanceof Error ? err.message : '添加情境失败');
      }
    })();
  }, [loadContextCounts, newContextName]);

  const renderItem = React.useCallback(
    ({ item, drag, isActive }: RenderItemParams<ContextRow>) => {
      const isProtected = item.isDefault === true;
      const isChecked = selectedIds.has(item.id);
      return (
        <Pressable
          onPress={() => {
            if (!editMode) return;
            if (isProtected) return;
            toggleSelected(item.id);
          }}
          onLongPress={() => {
            if (editMode) return;
            drag();
          }}
          delayLongPress={200}
          style={({ pressed }) => [
            styles.row,
            { backgroundColor: card },
            (pressed || isActive) && { opacity: 0.92 },
          ]}>
          <View style={styles.rowLeft}>
            {editMode ? (
              <MaterialIcons
                name={isProtected ? 'lock' : isChecked ? 'check-circle' : 'radio-button-unchecked'}
                size={20}
                color={isProtected ? textSub : isChecked ? '#433B3E' : textSub}
              />
            ) : (
              <MaterialIcons name="drag-indicator" size={20} color={textSub} />
            )}
            <Text style={[styles.rowText, { color: theme.text }]}>
              {item.name}
              {item.isDefault ? <Text style={{ color: textSub, fontWeight: '500' }}> (系统默认)</Text> : null}
            </Text>
          </View>

          {item.count !== null ? <Text style={[styles.countText, { color: textSub }]}>{item.count}</Text> : null}
        </Pressable>
      );
    },
    [card, editMode, selectedIds, textSub, theme.text, toggleSelected]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top']}>
      <View
        style={[
          styles.header,
          {
            backgroundColor: headerBg,
            borderBottomColor: isDark ? 'rgba(148,163,184,0.18)' : 'rgba(226,232,240,0.85)',
          },
        ]}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.closeBtn}>
          <MaterialIcons name="close" size={24} color={theme.text} />
        </Pressable>

        <View style={styles.titleWrap}>
          <Text style={[styles.title, { color: theme.text }]}>习惯情境</Text>
        </View>

        <View style={styles.headerRight}>
          <Pressable onPress={toggleEditMode} hitSlop={10}>
            <Text style={[styles.selectText, { color: textSub }]}>{editMode ? '完成' : '选择'}</Text>
          </Pressable>
          {editMode ? (
            <Pressable
              onPress={confirmDeleteSelected}
              disabled={selectedIds.size === 0}
              hitSlop={10}
              style={({ pressed }) => [pressed && { opacity: 0.85 }, selectedIds.size === 0 && { opacity: 0.35 }]}>
              <MaterialIcons name="delete" size={22} color={theme.text} />
            </Pressable>
          ) : (
            <Pressable onPress={openAdd} hitSlop={10} style={({ pressed }) => [pressed && { opacity: 0.85 }]}>
              <MaterialIcons name="add" size={24} color={theme.text} />
            </Pressable>
          )}
        </View>
      </View>

      <DraggableFlatList
        data={contextData}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        refreshControl={refreshControl}
        contentContainerStyle={[styles.content, { paddingBottom: 18 + Math.max(insets.bottom, 8) }]}
        showsVerticalScrollIndicator={false}
        activationDistance={editMode ? 9999 : 0}
        onDragEnd={({ data }) => {
          setContextData(data);
          void persistOrder(data);
        }}
      />

      <Modal visible={addVisible} transparent animationType="fade" onRequestClose={closeAdd}>
        <Pressable style={styles.modalBackdrop} onPress={closeAdd} />
        <View style={[styles.modalCard, { borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(226,232,240,0.9)' }]}>
          <Text style={[styles.modalTitle, { color: theme.text }]}>添加情境</Text>
          <TextInput
            value={newContextName}
            onChangeText={setNewContextName}
            placeholder="例如：通勤 / 运动后 / 学习"
            placeholderTextColor={textSub}
            autoFocus
            style={[
              styles.input,
              {
                color: theme.text,
                borderColor: isDark ? 'rgba(148,163,184,0.22)' : 'rgba(148,163,184,0.26)',
                backgroundColor: isDark ? 'rgba(15,23,42,0.35)' : 'rgba(255,255,255,0.9)',
              },
            ]}
          />
          <View style={styles.modalActions}>
            <Pressable onPress={closeAdd} style={({ pressed }) => [styles.modalBtn, pressed && { opacity: 0.85 }]}>
              <Text style={[styles.modalBtnText, { color: textSub }]}>取消</Text>
            </Pressable>
            <Pressable
              onPress={saveNewContext}
              disabled={!newContextName.trim()}
              style={({ pressed }) => [
                styles.modalBtnPrimary,
                pressed && { opacity: 0.9 },
                !newContextName.trim() && { opacity: 0.5 },
              ]}>
              <Text style={styles.modalBtnPrimaryText}>添加</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  selectText: { fontSize: 14, fontWeight: '600' },
  content: { paddingHorizontal: 18, paddingBottom: 18 },
  row: {
    marginBottom: 10,
    paddingHorizontal: 14,
    paddingVertical: 16,
    borderRadius: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowText: { fontSize: 15, fontWeight: '800' },
  countText: { fontSize: 15, fontWeight: '700' },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15,23,42,0.35)',
  },
  modalCard: {
    position: 'absolute',
    left: 18,
    right: 18,
    top: '30%',
    borderRadius: 18,
    borderWidth: 1,
    backgroundColor: 'rgba(255,255,255,0.98)',
    paddingHorizontal: 14,
    paddingVertical: 14,
    gap: 10,
  },
  modalTitle: { fontSize: 15, fontWeight: '800' },
  input: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: '600',
  },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 2 },
  modalBtn: { paddingHorizontal: 12, paddingVertical: 10 },
  modalBtnText: { fontSize: 14, fontWeight: '700' },
  modalBtnPrimary: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: '#433B3E',
  },
  modalBtnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});

