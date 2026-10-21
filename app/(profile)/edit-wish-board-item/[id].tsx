import { WishBoardItemForm } from '@/components/wish-board/wish-board-item-form';
import type { WishBoxPalette, WishBoxShadowSet } from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import {
  loadWishBoardCurrentNetWorth,
  parseWishBoardRedeemConditions,
  type WishBoardRedeemConditions,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import {
  getWishBoardItemById,
  updateWishBoardItem,
} from '@/lib/repositories/wish-board/wish-board';
import type { WishBoardWishType } from '@/lib/repositories/wish-board/wish-board.types';
import { getPointsBalance } from '@/lib/repositories/points/points';
import { forgetUnusedWishUploads } from '@/lib/wish-images';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type FormInitial = {
  title: string;
  description: string | null;
  icon_key: string;
  wish_type: WishBoardWishType;
  cost_points: number;
  redeem_conditions: WishBoardRedeemConditions;
};

/** 编辑 / 查看心愿：与新增同一套表单（设计稿 05「同一表单承载新增与编辑」） */
export default function EditWishBoardItemScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === 'string' ? params.id : '';
  const uploadedUrisRef = useRef<string[]>([]);
  const { c } = useWishBoxTheme();
  const styles = useWishStyles(makeStyles);

  const [ready, setReady] = useState(false);
  const [balance, setBalance] = useState(0);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [currentNetWorth, setCurrentNetWorth] = useState<number | null>(null);
  const [initial, setInitial] = useState<FormInitial | null>(null);
  const [originalDescription, setOriginalDescription] = useState<string | null>(null);
  const [redeemed, setRedeemed] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [row, nextBalance, nextProjects, nextTasks, nextNetWorth] = await Promise.all([
          getWishBoardItemById(id),
          getPointsBalance(),
          getProjects(),
          getTasks(),
          loadWishBoardCurrentNetWorth(),
        ]);
        if (cancelled) return;
        setBalance(nextBalance);
        setProjects(nextProjects);
        setTasks(nextTasks);
        setCurrentNetWorth(nextNetWorth);
        if (!row) {
          toast.error('未找到心愿');
          router.back();
          return;
        }
        setInitial({
          title: row.title,
          description: row.description,
          icon_key: row.icon_key ?? '',
          wish_type: row.wish_type,
          cost_points: row.cost_points,
          redeem_conditions: parseWishBoardRedeemConditions(row.extra_data),
        });
        setOriginalDescription(row.description);
        setRedeemed(row.wish_type === 'once' && row.status === 'redeemed');
        uploadedUrisRef.current = [];
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router]);

  const onCancel = () => {
    const uris = uploadedUrisRef.current;
    uploadedUrisRef.current = [];
    if (uris.length > 0) void forgetUnusedWishUploads(uris, originalDescription);
    router.back();
  };

  const onSubmit = (values: FormInitial) => {
    if (saving) return;
    if (redeemed) {
      toast.warn('已兑换的心愿不可编辑');
      return;
    }
    setSaving(true);
    void (async () => {
      try {
        await updateWishBoardItem(id, {
          title: values.title,
          cost_points: values.cost_points,
          description: values.description,
          icon_key: values.icon_key,
          wish_type: values.wish_type,
          redeem_conditions: values.redeem_conditions,
        });
        await forgetUnusedWishUploads(uploadedUrisRef.current, values.description);
        uploadedUrisRef.current = [];
        toast.success('已保存');
        router.back();
      } catch (e) {
        toast.error(toUserMessage(e, '保存失败，请稍后重试'));
      } finally {
        setSaving(false);
      }
    })();
  };

  if (!ready || !initial) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={c.pri} />
        <Text style={styles.loadingText}>加载中…</Text>
      </View>
    );
  }

  return (
    <WishBoardItemForm
      mode="edit"
      initial={initial}
      wishId={id}
      balance={balance}
      projects={projects}
      tasks={tasks}
      currentNetWorth={currentNetWorth}
      saving={saving}
      readOnly={redeemed}
      notice={redeemed ? '该心愿已兑换，仅可查看' : undefined}
      onUploadedUri={uri => {
        uploadedUrisRef.current.push(uri);
      }}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

function makeStyles(c: WishBoxPalette, _shadows: WishBoxShadowSet) {
  return StyleSheet.create({
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.bg,
    },
    loadingText: {
      fontSize: 12.5,
      fontWeight: '600',
      color: c.muted,
    },
  });
}
