import {
  WishBoardItemForm,
  type WishBoardItemFormValues,
} from '@/components/wish-board/wish-board-item-form';
import type { WishBoxPalette, WishBoxShadowSet } from '@/constants/wish-box-ui';
import { useWishBoxTheme, useWishStyles } from '@/hooks/use-wish-box-theme';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { getProjects } from '@/lib/repositories/projects/project';
import type { ProjectRow } from '@/lib/repositories/projects/project.types';
import { getTasks } from '@/lib/repositories/tasks/task';
import type { TaskRow } from '@/lib/repositories/tasks/task.types';
import { createWishBoardItem } from '@/lib/repositories/wish-board/wish-board';
import {
  loadWishBoardCurrentNetWorth,
} from '@/lib/repositories/wish-board/wish-board-redeem-conditions';
import { getPointsBalance } from '@/lib/repositories/points/points';
import { forgetUnusedWishUploads } from '@/lib/wish-images';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';

type Props = {
  visible: boolean;
  onClose: () => void;
  onCreated?: () => void;
};

/** 添加心愿：加载上下文后渲染标准全屏表单（设计稿 05） */
export function AddWishBoardModal({ visible, onClose, onCreated }: Props) {
  const styles = useWishStyles(makeStyles);
  const { c } = useWishBoxTheme();
  const [balance, setBalance] = useState(0);
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [currentNetWorth, setCurrentNetWorth] = useState<number | null>(null);
  const [openToken, setOpenToken] = useState(0);
  const [lastVisible, setLastVisible] = useState(visible);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const uploadedUrisRef = useRef<string[]>([]);

  // 打开时重置本次会话（渲染期同步，避免 effect 内同步 setState）
  if (visible !== lastVisible) {
    setLastVisible(visible);
    if (visible) {
      setOpenToken(t => t + 1);
      setReady(false);
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!visible) return;
    uploadedUrisRef.current = [];
    let cancelled = false;
    void (async () => {
      try {
        const [nextBalance, nextProjects, nextTasks, nextNetWorth] = await Promise.all([
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
      } catch {
        // 上下文缺失时仍允许创建：条件选择暂不可用
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [visible, openToken]);

  const handleClose = () => {
    const uris = uploadedUrisRef.current;
    uploadedUrisRef.current = [];
    if (uris.length > 0) void forgetUnusedWishUploads(uris, null);
    onClose();
  };

  const onSubmit = (values: WishBoardItemFormValues) => {
    if (saving) return;
    setSaving(true);
    void (async () => {
      try {
        await createWishBoardItem(values);
        await forgetUnusedWishUploads(uploadedUrisRef.current, values.description);
        uploadedUrisRef.current = [];
        onCreated?.();
        onClose();
        toast.success('已添加心愿');
      } catch (e) {
        toast.error(toUserMessage(e, '添加失败，请稍后重试'));
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}>
      {ready ? (
        <WishBoardItemForm
          key={openToken}
          mode="create"
          balance={balance}
          projects={projects}
          tasks={tasks}
          currentNetWorth={currentNetWorth}
          saving={saving}
          onUploadedUri={uri => {
            uploadedUrisRef.current.push(uri);
          }}
          onSubmit={onSubmit}
          onCancel={handleClose}
        />
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator size="small" color={c.pri} />
          <Text style={styles.loadingText}>加载中…</Text>
        </View>
      )}
    </Modal>
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
