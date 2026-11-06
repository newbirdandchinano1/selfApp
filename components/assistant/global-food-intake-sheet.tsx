/**
 * 根级饮食预览 Sheet：订阅 openFoodIntakeSheet，确认后写 health_records。
 */
import { RecordIntakeSheet, type RecordIntakeConfirmPayload } from '@/components/record-intake-sheet';
import {
  subscribeFoodIntakeSheetOpen,
  type FoodIntakeSheetLaunchIntent,
} from '@/lib/assistant/food-intake-sheet';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { getResolvedGlobalIntakeTargets } from '@/lib/global-intake-targets';
import { createHealthRecord } from '@/lib/repositories/health/health';
import { getDefaultUser } from '@/lib/repositories/users/user';
import { getDayBoundaryForPageSync, getLogicalLocalYmd } from '@/lib/tasks-logical-day';
import type { FoodTextIntakeJson } from '@/lib/ai-types';
import React from 'react';

const AI_TEXT_KEY = 'ai_text_intake';

function clampTitle(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  return t.slice(0, 80);
}

function clampComment(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  return t.slice(0, 500);
}

export function GlobalFoodIntakeSheet() {
  const [visible, setVisible] = React.useState(false);
  const [seed, setSeed] = React.useState<FoodTextIntakeJson | null>(null);
  const [recordYmd, setRecordYmd] = React.useState<string | null>(null);

  React.useEffect(() => {
    return subscribeFoodIntakeSheetOpen((intent: FoodIntakeSheetLaunchIntent) => {
      setSeed(intent.seedAiDraft);
      setRecordYmd(intent.recordDateYmd?.trim() || null);
      setVisible(true);
    });
  }, []);

  const close = React.useCallback(() => {
    setVisible(false);
    setSeed(null);
    setRecordYmd(null);
  }, []);

  const onConfirm = React.useCallback(
    async (payload: RecordIntakeConfirmPayload) => {
      try {
        const user = await getDefaultUser();
        if (!user?.id) {
          toast.error('未找到用户，无法保存');
          return;
        }
        const boundary = getDayBoundaryForPageSync('health');
        const ymd =
          recordYmd || getLogicalLocalYmd(new Date(), boundary);
        const targets = getResolvedGlobalIntakeTargets();

        if (payload.mode === 'ai') {
          let d = payload.parsed;
          if (!d && payload.text?.trim()) {
            const { parseFoodIntakeFromText } = await import('@/lib/zhipu-image-parse');
            const r = await parseFoodIntakeFromText({ text: payload.text.trim() });
            if (!r.ok) {
              toast.error(r.error || '识别失败');
              return;
            }
            d = r.data;
          }
          if (!d) {
            toast.error('没有可保存的饮食草稿');
            return;
          }
          const h = Math.max(0, Number(d.hydration_ml) || 0);
          const p = Math.max(0, Number(d.protein_g) || 0);
          const c = Math.max(0, Number(d.carbohydrate_g) || 0);
          const cal = Math.max(0, Number(d.calories_kcal) || 0);
          if (h + p + c + cal <= 0) {
            toast.error('营养值均为 0，未保存');
            return;
          }
          await createHealthRecord({
            id: makeTimestampEntityId('h_', 8),
            user_id: user.id,
            record_date: ymd,
            quick_add_key: AI_TEXT_KEY,
            source_image_uri: null,
            intake_display_title: clampTitle(d.food_summary),
            intake_ai_comment: clampComment(d.ai_evaluation),
            hydration: h,
            protein: p,
            carbohydrate: c,
            calories: cal,
            target_hydration: targets.hydrationMl,
            target_protein: targets.proteinG,
            target_carbohydrate: targets.carbohydrateG,
            target_calories: targets.caloriesKcal,
          });
          toast.success('已记饮食');
          close();
          return;
        }

        toast.info('请在助手预填的 AI 页确认保存');
      } catch (e) {
        toast.error(toUserMessage(e, '保存失败'));
      }
    },
    [close, recordYmd],
  );

  if (!visible) return null;

  return (
    <RecordIntakeSheet
      visible={visible}
      onClose={close}
      onConfirm={onConfirm}
      seedAiDraft={seed}
    />
  );
}
