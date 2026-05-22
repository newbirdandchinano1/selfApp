import type { VisionWallAiAssessmentPayload } from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

type Props = {
  isDark: boolean;
  textColor: string;
  outlineColor: string;
  primaryColor: string;
  planCount: number;
  assessment: VisionWallAiAssessmentPayload | null;
  generatedAt: string | null;
  loading: boolean;
  stale: boolean;
  onRun: () => void;
};

export function VisionWallAiAssessmentSection({
  isDark,
  textColor,
  outlineColor,
  primaryColor,
  planCount,
  assessment,
  generatedAt,
  loading,
  stale,
  onRun,
}: Props) {
  const surface = isDark ? 'rgba(30,41,59,0.88)' : 'rgba(255,255,255,0.98)';
  const border = isDark ? 'rgba(148,163,184,0.22)' : 'rgba(15,23,42,0.08)';

  return (
    <View style={[styles.wrap, { backgroundColor: surface, borderColor: border }]}>
      <View style={styles.headRow}>
        <View style={[styles.iconBadge, { backgroundColor: `${primaryColor}18` }]}>
          <MaterialIcons name="auto-awesome" size={22} color={primaryColor} />
        </View>
        <View style={styles.headTextCol}>
          <Text style={[styles.title, { color: textColor }]}>AI 评估：目标可行性评估与优化</Text>
          <Text style={[styles.sub, { color: outlineColor }]}>
            汇总 {planCount} 条计划（含剩余完成时间，默认截止 {new Date().getFullYear()}-12-31）并生成结构化建议
          </Text>
        </View>
      </View>

      <Pressable
        onPress={onRun}
        disabled={loading || planCount === 0}
        style={({ pressed }) => [
          styles.runBtn,
          {
            backgroundColor: planCount === 0 ? outlineColor : primaryColor,
            opacity: pressed ? 0.88 : loading ? 0.65 : 1,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <MaterialIcons name="psychology" size={20} color="#fff" />
            <Text style={styles.runBtnText}>
              {assessment ? (stale ? '重新生成 AI 评估' : '刷新 AI 评估') : '生成 AI 评估'}
            </Text>
          </>
        )}
      </Pressable>

      {planCount === 0 ? (
        <Text style={[styles.hint, { color: outlineColor }]}>
          请先创建总目标或存钱计划，系统将自动计算各条计划的剩余完成时间后再评估。
        </Text>
      ) : null}

      {assessment ? (
        <View style={styles.resultBlock}>
          <View style={styles.scoreRow}>
            <Text style={[styles.scoreLabel, { color: outlineColor }]}>整体可达成度</Text>
            <Text style={[styles.scoreValue, { color: primaryColor }]}>{assessment.feasibility_score}</Text>
            <Text style={[styles.scoreSuffix, { color: outlineColor }]}>/ 100</Text>
          </View>
          {assessment.headline ? (
            <Text style={[styles.headline, { color: textColor }]}>{assessment.headline}</Text>
          ) : null}

          {assessment.sections.map((sec, idx) => (
            <View
              key={`${sec.title}-${idx}`}
              style={[styles.sectionCard, { borderColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.06)' }]}
            >
              <Text style={[styles.sectionTitle, { color: primaryColor }]}>{sec.title}</Text>
              <Text style={[styles.sectionBody, { color: textColor }]}>{sec.body}</Text>
            </View>
          ))}

          {assessment.per_goal.length > 0 ? (
            <View style={styles.perGoalBlock}>
              <Text style={[styles.perGoalKicker, { color: outlineColor }]}>逐条计划诊断</Text>
              {assessment.per_goal.map(row => (
                <View
                  key={row.goal_id}
                  style={[styles.perGoalCard, { backgroundColor: isDark ? 'rgba(15,23,42,0.35)' : 'rgba(248,250,252,0.9)' }]}
                >
                  <View style={styles.perGoalHead}>
                    <Text style={[styles.perGoalTitle, { color: textColor }]} numberOfLines={2}>
                      {row.title || row.goal_id}
                    </Text>
                    {row.feasibility_level ? (
                      <View style={[styles.levelPill, { borderColor: `${primaryColor}44` }]}>
                        <Text style={[styles.levelPillText, { color: primaryColor }]}>{row.feasibility_level}</Text>
                      </View>
                    ) : null}
                  </View>
                  {row.remain_assessment ? (
                    <Text style={[styles.perGoalBody, { color: textColor }]}>
                      <Text style={{ fontWeight: '800', color: outlineColor }}>时间评估 </Text>
                      {row.remain_assessment}
                    </Text>
                  ) : null}
                  {row.optimization ? (
                    <Text style={[styles.perGoalBody, { color: textColor, marginTop: 8 }]}>
                      <Text style={{ fontWeight: '800', color: outlineColor }}>优化建议 </Text>
                      {row.optimization}
                    </Text>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}

          {assessment.closing_summary ? (
            <View style={[styles.sectionCard, { borderColor: isDark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.06)' }]}>
              <Text style={[styles.sectionTitle, { color: primaryColor }]}>行动优先级总结</Text>
              <Text style={[styles.sectionBody, { color: textColor }]}>{assessment.closing_summary}</Text>
            </View>
          ) : null}

          {generatedAt ? (
            <Text style={[styles.meta, { color: outlineColor }]}>
              生成于 {new Date(generatedAt).toLocaleString('zh-CN')}
              {stale ? ' · 计划数据已更新，建议重新生成' : ''}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    borderRadius: 20,
    borderWidth: 1,
    padding: 16,
    gap: 12,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headTextCol: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.2,
  },
  sub: {
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  runBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
  },
  runBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
  },
  hint: {
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 20,
  },
  resultBlock: {
    gap: 12,
    marginTop: 4,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  scoreLabel: {
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  scoreValue: {
    fontSize: 32,
    fontWeight: '900',
    letterSpacing: -1,
  },
  scoreSuffix: {
    fontSize: 14,
    fontWeight: '700',
  },
  headline: {
    fontSize: 15,
    fontWeight: '800',
    lineHeight: 22,
  },
  sectionCard: {
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    paddingTop: 12,
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 0.2,
  },
  sectionBody: {
    fontSize: 14,
    fontWeight: '600',
    lineHeight: 24,
  },
  perGoalBlock: {
    gap: 10,
    marginTop: 4,
  },
  perGoalKicker: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  perGoalCard: {
    borderRadius: 12,
    padding: 12,
    gap: 6,
  },
  perGoalHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  perGoalTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '800',
  },
  levelPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  levelPillText: {
    fontSize: 10,
    fontWeight: '800',
  },
  perGoalBody: {
    fontSize: 13,
    lineHeight: 21,
    fontWeight: '600',
  },
  meta: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 4,
  },
});
