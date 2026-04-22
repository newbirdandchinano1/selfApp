import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { getTaskById, getTaskTreeByRootTaskId } from '@/lib/repositories/tasks/task';
import type { TaskTreeNode } from '@/lib/repositories/tasks/task';
import { MaterialIcons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function TaskNode({ node, depth = 0 }: { node: TaskTreeNode; depth?: number }) {
  return (
    <View style={{ marginLeft: depth * 12, marginTop: 8 }}>
      <Text style={{ fontWeight: '700' }}>{node.title}</Text>
      <Text style={{ fontSize: 12, opacity: 0.7 }}>优先级 {node.priority} · {node.status}</Text>
      {node.children.map((child) => (
        <TaskNode key={child.id} node={child} depth={depth + 1} />
      ))}
    </View>
  );
}

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const colorScheme = useColorScheme();
  const theme = Colors[colorScheme ?? 'light'];

  const [title, setTitle] = React.useState('');
  const [note, setNote] = React.useState('');
  const [status, setStatus] = React.useState('todo');
  const [tree, setTree] = React.useState<TaskTreeNode | null>(null);

  useFocusEffect(
    React.useCallback(() => {
      if (!id) return;
      const run = async () => {
        const row = await getTaskById(id);
        if (row) {
          setTitle(row.title);
          setNote(row.note ?? '');
          setStatus(row.status);
        }
        const t = await getTaskTreeByRootTaskId(id);
        setTree(t);
      };
      run().catch(() => {});
    }, [id])
  );

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()}><MaterialIcons name="arrow-back" size={22} color={theme.text} /></Pressable>
        <Text style={[styles.title, { color: theme.text }]}>任务详情</Text>
        <Pressable onPress={() => router.push('/add-subtask')}><MaterialIcons name="add" size={22} color={theme.text} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          <Text style={[styles.taskTitle, { color: theme.text }]}>{title || '未找到任务'}</Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>状态：{status}</Text>
          <Text style={[styles.meta, { color: theme.textSecondary }]}>备注：{note || '无'}</Text>
        </View>

        <Text style={[styles.sectionTitle, { color: theme.textSecondary }]}>子任务树</Text>
        <View style={[styles.card, { backgroundColor: theme.surface }]}>
          {tree ? <TaskNode node={tree} /> : <Text style={{ color: theme.textSecondary }}>暂无子任务</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '800' },
  content: { padding: 16, gap: 12 },
  card: { borderRadius: 12, padding: 12, gap: 6 },
  taskTitle: { fontSize: 18, fontWeight: '800' },
  meta: { fontSize: 13 },
  sectionTitle: { fontSize: 13, fontWeight: '700' },
});