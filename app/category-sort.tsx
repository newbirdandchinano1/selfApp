import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { INBOX_PROJECT_CATEGORY_ID, INBOX_PROJECT_CATEGORY_NAME } from '@/lib/repositories/projects/constants';
import { getProjectCategories, reorderProjectCategories } from '@/lib/repositories/projects/project';
import type { ProjectCategoryRow } from '@/lib/repositories/projects/project.types';
import { MaterialIcons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import DraggableFlatList, { type RenderItemParams } from 'react-native-draggable-flatlist';

export default function CategorySortScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ scope?: string }>();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];
  const isDark = colorScheme === 'dark';

  // task categories are unified into project categories
  const scope = 'project';
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [projectInbox, setProjectInbox] = React.useState<ProjectCategoryRow | null>(null);
  const [projectCategories, setProjectCategories] = React.useState<ProjectCategoryRow[]>([]);
  const persistLockRef = React.useRef(false);

  const bg = isDark ? theme.background : '#faf8ff';
  const surface = isDark ? 'rgba(30, 41, 59, 0.7)' : '#ffffff';
  const outline = isDark ? 'rgba(148,163,184,0.6)' : '#727785';
  const border = isDark ? 'rgba(148,163,184,0.18)' : 'rgba(194,198,214,0.55)';
  const primary = isDark ? '#60a5fa' : '#0058be';

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const rows = await getProjectCategories();
      const inbox = rows.find((r) => r.id === INBOX_PROJECT_CATEGORY_ID) ?? null;
      setProjectInbox(
        inbox ?? {
          id: INBOX_PROJECT_CATEGORY_ID,
          name: INBOX_PROJECT_CATEGORY_NAME,
          sort_order: 0,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          deleted_at: null,
          sync_status: 'synced',
          version: 1,
          extra_data: null,
        }
      );
      setProjectCategories(rows.filter((r) => r.id !== INBOX_PROJECT_CATEGORY_ID));
    } finally {
      setLoading(false);
    }
  }, [scope]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const persist = React.useCallback(async () => {
    if (persistLockRef.current) return;
    persistLockRef.current = true;
    setSaving(true);
    try {
      await reorderProjectCategories(projectCategories.map((c) => c.id));
    } finally {
      setSaving(false);
      persistLockRef.current = false;
    }
  }, [projectCategories, saving]);

  const data = projectCategories;

  const renderItem = React.useCallback(
    ({ item, drag, isActive }: RenderItemParams<ProjectCategoryRow>) => (
      <Pressable
        onLongPress={drag}
        delayLongPress={180}
        disabled={saving}
        style={({ pressed }) => [
          styles.item,
          { backgroundColor: surface, borderColor: border, opacity: isActive ? 0.9 : 1 },
          pressed && styles.itemPressed,
        ]}
      >
        <Text style={[styles.itemText, { color: theme.text }]}>{item.name}</Text>
        <MaterialIcons name="drag-handle" size={22} color={outline} />
      </Pressable>
    ),
    [border, outline, saving, surface, theme.text]
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: border, backgroundColor: isDark ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.8)' }]}>
        <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}>
          <MaterialIcons name="arrow-back" size={22} color={primary} />
        </Pressable>

        <Text style={[styles.title, { color: primary }]}>分类排序</Text>

        <Pressable
          onPress={async () => {
            await persist();
            router.back();
          }}
          disabled={saving}
          style={({ pressed }) => [styles.doneBtn, pressed && styles.pressed, saving && { opacity: 0.55 }]}
        >
          <Text style={[styles.doneText, { color: primary }]}>{saving ? '保存中' : '完成'}</Text>
        </Pressable>
      </View>

      <View style={styles.content}>
        <Text style={[styles.hint, { color: outline }]}>长按拖动以重新排序分类</Text>

        {loading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator />
            <Text style={[styles.loadingText, { color: outline }]}>加载中...</Text>
          </View>
        ) : (
          <View style={styles.listWrap}>
            {scope === 'project' && projectInbox ? (
              <View style={[styles.item, { backgroundColor: surface, borderColor: border, opacity: 0.78 }]}>
                <Text style={[styles.itemText, { color: theme.text }]}>{projectInbox.name}</Text>
                <MaterialIcons name="lock" size={18} color={outline} />
              </View>
            ) : null}

            <DraggableFlatList
              data={data as any}
              keyExtractor={(item: any) => item.id}
              renderItem={renderItem as any}
              onDragEnd={({ data: next }) => {
                setProjectCategories(next as any);
                void persist();
              }}
              activationDistance={8}
              containerStyle={{ flexGrow: 0 }}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    height: 58,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  title: {
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  doneBtn: {
    minWidth: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
    paddingHorizontal: 6,
  },
  doneText: {
    fontSize: 14,
    fontWeight: '700',
  },
  content: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 20,
  },
  hint: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 12,
  },
  listWrap: {
    flex: 1,
    gap: 10,
  },
  item: {
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemPressed: {
    opacity: 0.82,
  },
  itemText: {
    fontSize: 16,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.75,
  },
  loadingWrap: {
    paddingTop: 26,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
