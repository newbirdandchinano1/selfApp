/**
 * 道路场景用的项目任务树：按分类分组，项目可展开看任务子树。
 * 用于「引入项目」弹窗、全景「未归入道路」列表，避免扁平一窝蜂。
 */
import {
  lifeRoadType,
  type LifeRoadPalette,
} from '@/constants/life-road-theme';
import {
  INBOX_PROJECT_CATEGORY_ID,
  isProjectInInboxCategory,
} from '@/lib/repositories/projects/constants';
import type { ProjectCategoryRow, ProjectRow } from '@/lib/repositories/projects/project.types';
import { formatProjectStatusLabel } from '@/lib/repositories/projects/project.types';
import {
  countTaskTreeNodes,
  type TaskTreeNode,
} from '@/lib/repositories/tasks/task';
import { isTaskTerminalStatus } from '@/lib/repositories/tasks/task.types';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type RoadProjectTreeItem = {
  id: string;
  name: string;
  /** 允许旧 status 字符串；展示时走 formatProjectStatusLabel */
  status: ProjectRow['status'] | string;
  category_id: string | null;
  life_month_goal_id?: string | null;
  /** 可选备注行（如「已有道路归属」） */
  hint?: string | null;
};

type CategoryGroup = {
  key: string;
  label: string;
  sortOrder: number;
  projects: RoadProjectTreeItem[];
};

function treeProgress(nodes: TaskTreeNode[]): { total: number; done: number } {
  let total = 0;
  let done = 0;
  const walk = (list: TaskTreeNode[]) => {
    for (const n of list) {
      total += 1;
      if (isTaskTerminalStatus(n.status)) done += 1;
      const ch = Array.isArray(n.children) ? n.children : [];
      if (ch.length > 0) walk(ch);
    }
  };
  walk(nodes);
  return { total, done };
}

function TaskNodeRows({
  nodes,
  depth,
  lr,
}: {
  nodes: TaskTreeNode[];
  depth: number;
  lr: LifeRoadPalette;
}) {
  if (nodes.length === 0 || depth > 3) return null;
  return (
    <>
      {nodes.map((node) => {
        const done = isTaskTerminalStatus(node.status);
        const children = Array.isArray(node.children) ? node.children : [];
        return (
          <View key={node.id}>
            <View style={[styles.taskRow, { paddingLeft: 10 + depth * 12 }]}>
              <Text style={{ fontSize: 11, color: lr.muted2, width: 12 }}>{depth > 0 ? '·' : '•'}</Text>
              <Text
                style={{
                  flex: 1,
                  fontSize: 12,
                  color: done ? lr.muted : lr.ink3,
                  textDecorationLine: done ? 'line-through' : 'none',
                  opacity: done ? 0.7 : 1,
                }}
                numberOfLines={2}>
                {node.title}
              </Text>
            </View>
            {children.length > 0 ? <TaskNodeRows nodes={children} depth={depth + 1} lr={lr} /> : null}
          </View>
        );
      })}
    </>
  );
}

function ProjectTreeCard({
  project,
  tree,
  lr,
  expanded,
  onToggleExpand,
  actionLabel,
  actionBusy,
  onAction,
  onPressProject,
}: {
  project: RoadProjectTreeItem;
  tree: TaskTreeNode[];
  lr: LifeRoadPalette;
  expanded: boolean;
  onToggleExpand: () => void;
  actionLabel?: string;
  actionBusy?: boolean;
  onAction?: () => void;
  onPressProject?: () => void;
}) {
  const progress = treeProgress(tree);
  const taskCount = countTaskTreeNodes(tree);
  const hasTree = taskCount > 0;
  const meta = [
    formatProjectStatusLabel(project.status),
    taskCount > 0 ? `${progress.done}/${progress.total} 任务` : '无任务',
    project.hint?.trim() || null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <View
      style={[
        styles.projectCard,
        { borderColor: lr.line, backgroundColor: lr.chip },
        actionBusy ? { opacity: 0.55 } : null,
      ]}>
      <View style={styles.projectHead}>
        {hasTree ? (
          <Pressable
            onPress={onToggleExpand}
            hitSlop={6}
            accessibilityLabel={expanded ? '收起任务树' : '展开任务树'}
            style={styles.chevHit}>
            <Text style={{ fontSize: 11, color: lr.sage, fontWeight: '700' }}>
              {expanded ? '▼' : '▶'}
            </Text>
          </Pressable>
        ) : (
          <View style={styles.chevHit}>
            <Text style={{ fontSize: 11, color: lr.muted2 }}>•</Text>
          </View>
        )}
        <Pressable
          onPress={onPressProject ?? onToggleExpand}
          style={{ flex: 1, minWidth: 0 }}
          disabled={!onPressProject && !hasTree}>
          <Text style={{ fontSize: 13, fontWeight: '600', color: lr.ink2 }} numberOfLines={2}>
            {project.name}
          </Text>
          <Text style={{ fontSize: 10, color: lr.muted, marginTop: 2 }} numberOfLines={1}>
            {meta}
          </Text>
        </Pressable>
        {actionLabel && onAction ? (
          <Pressable onPress={onAction} disabled={actionBusy} hitSlop={8}>
            <Text style={{ fontSize: 12, fontWeight: '700', color: lr.pine }}>
              {actionBusy ? '…' : actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {expanded && hasTree ? (
        <View style={[styles.taskTree, { borderTopColor: lr.line }]}>
          <TaskNodeRows nodes={tree} depth={0} lr={lr} />
        </View>
      ) : null}
    </View>
  );
}

export type RoadProjectTaskTreeListProps = {
  projects: RoadProjectTreeItem[];
  categories: ProjectCategoryRow[];
  treeMap: Record<string, TaskTreeNode[]>;
  lr: LifeRoadPalette;
  emptyText?: string;
  /** 项目行动作，如「引入」「去挂载」 */
  actionLabel?: string | ((project: RoadProjectTreeItem) => string);
  actionBusyId?: string | null;
  onAction?: (project: RoadProjectTreeItem) => void;
  onPressProject?: (project: RoadProjectTreeItem) => void;
  /** 默认展开含任务的项目（默认 false，避免列表过长） */
  defaultExpandProjects?: boolean;
};

export function RoadProjectTaskTreeList({
  projects,
  categories,
  treeMap,
  lr,
  emptyText = '暂无项目',
  actionLabel,
  actionBusyId,
  onAction,
  onPressProject,
  defaultExpandProjects = false,
}: RoadProjectTaskTreeListProps) {
  const groups = useMemo((): CategoryGroup[] => {
    const catById = new Map(categories.map((c) => [c.id, c]));
    const bucket = new Map<string, CategoryGroup>();

    const ensure = (key: string, label: string, sortOrder: number) => {
      let g = bucket.get(key);
      if (!g) {
        g = { key, label, sortOrder, projects: [] };
        bucket.set(key, g);
      }
      return g;
    };

    for (const p of projects) {
      // 道路场景不展示收集箱（归档）分类
      if (isProjectInInboxCategory(p.category_id)) continue;
      const cid = String(p.category_id ?? '').trim();
      const cat = cid ? catById.get(cid) : undefined;
      if (cat && cat.id !== INBOX_PROJECT_CATEGORY_ID) {
        ensure(cat.id, cat.name, cat.sort_order ?? 0).projects.push(p);
      } else {
        ensure('__uncategorized__', '未分类', 10_000).projects.push(p);
      }
    }

    return [...bucket.values()].sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      return a.label.localeCompare(b.label, 'zh');
    });
  }, [categories, projects]);

  const [collapsedCats, setCollapsedCats] = useState<Record<string, boolean>>({});
  const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>(() => {
    if (!defaultExpandProjects) return {};
    const init: Record<string, boolean> = {};
    for (const p of projects) {
      const tree = treeMap[p.id] ?? [];
      if (countTaskTreeNodes(tree) > 0) init[p.id] = true;
    }
    return init;
  });

  const toggleCat = useCallback((key: string) => {
    setCollapsedCats((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const toggleProject = useCallback((id: string) => {
    setExpandedProjects((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const resolveActionLabel = useCallback(
    (project: RoadProjectTreeItem) => {
      if (!actionLabel) return undefined;
      return typeof actionLabel === 'function' ? actionLabel(project) : actionLabel;
    },
    [actionLabel],
  );

  if (projects.length === 0) {
    return (
      <Text style={{ color: lr.muted, fontSize: 13, paddingVertical: 16, textAlign: 'center' }}>
        {emptyText}
      </Text>
    );
  }

  return (
    <View style={styles.wrap}>
      {groups.map((group) => {
        const collapsed = !!collapsedCats[group.key];
        return (
          <View key={group.key} style={styles.group}>
            <Pressable
              onPress={() => toggleCat(group.key)}
              style={[styles.catHead, { borderColor: lr.line2, backgroundColor: lr.chipSoft }]}>
              <Text style={{ fontSize: 11, color: lr.sage, fontWeight: '700', width: 14 }}>
                {collapsed ? '▶' : '▼'}
              </Text>
              <Text style={[lifeRoadType.kickerTiny, { color: lr.sage, flex: 1 }]} numberOfLines={1}>
                {group.label}
              </Text>
              <Text style={{ fontSize: 11, color: lr.muted, fontWeight: '600' }}>
                {group.projects.length}
              </Text>
            </Pressable>
            {!collapsed
              ? group.projects.map((project) => (
                  <ProjectTreeCard
                    key={project.id}
                    project={project}
                    tree={treeMap[project.id] ?? []}
                    lr={lr}
                    expanded={!!expandedProjects[project.id]}
                    onToggleExpand={() => toggleProject(project.id)}
                    actionLabel={resolveActionLabel(project)}
                    actionBusy={actionBusyId === project.id}
                    onAction={onAction ? () => onAction(project) : undefined}
                    onPressProject={onPressProject ? () => onPressProject(project) : undefined}
                  />
                ))
              : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 10 },
  group: { gap: 6 },
  catHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  projectCard: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
  projectHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  chevHit: {
    width: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTree: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
    paddingRight: 8,
    gap: 2,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 4,
    paddingVertical: 2,
  },
});
