/**
 * 道路清单编辑：年/季=目标，月=任务；顶层按 P0/P1/P2 分层。
 * 年可连季、季可连月；月可嵌套子任务。
 */
import {
  LIFE_ROAD_ACCEPTANCE_MAX_DEPTH,
  LIFE_ROAD_ACCEPTANCE_MAX_ITEMS,
  LIFE_ROAD_ACCEPTANCE_PRIORITIES,
  LIFE_ROAD_ACCEPTANCE_PRIORITY_LABELS,
  LIFE_ROAD_ACCEPTANCE_TEXT_MAX,
  acceptanceLinkLabel,
  addChildAcceptance,
  createAcceptanceItem,
  flattenAcceptanceItems,
  groupAcceptanceByPriority,
  removeAcceptanceById,
  updateAcceptanceById,
  type LifeRoadAcceptanceItem,
  type LifeRoadAcceptancePriority,
  type LifeRoadItemNoun,
} from '@/lib/life-road/life-road-acceptance';
import { monthLabel, quarterLabel } from '@/lib/life-road/life-road-node-model';
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

export type AcceptanceLinkMode = 'quarter' | 'month' | null;

export type AcceptanceChecklistEditorProps = {
  items: LifeRoadAcceptanceItem[];
  onChange: (next: LifeRoadAcceptanceItem[]) => void;
  /** 年/季=目标，月=任务 */
  itemNoun?: LifeRoadItemNoun;
  /** 年 → 连接季；季 → 连接月；其它不显示 */
  linkMode?: AcceptanceLinkMode;
  /** 季节点时，可选的月份列表 */
  linkMonthOptions?: number[];
  /** 是否允许嵌套子任务（月节点） */
  allowChildren?: boolean;
  ink2: string;
  ink3: string;
  muted: string;
  muted2: string;
  faint: string;
  line: string;
  pine: string;
  onRoad: string;
  clay2: string;
};

function RemoveIcon({ color }: { color: string }) {
  return (
    <Svg width={10} height={10} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 5l14 14M19 5L5 19"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function AcceptanceRow({
  item,
  depth,
  roots,
  onChange,
  itemNoun,
  linkMode,
  linkMonthOptions,
  allowChildren,
  ink3,
  muted,
  muted2,
  faint,
  line,
  pine,
  onRoad,
  clay2,
}: {
  item: LifeRoadAcceptanceItem;
  depth: number;
  roots: LifeRoadAcceptanceItem[];
  onChange: (next: LifeRoadAcceptanceItem[]) => void;
  itemNoun: LifeRoadItemNoun;
  linkMode: AcceptanceLinkMode;
  linkMonthOptions: number[];
  allowChildren: boolean;
  ink3: string;
  muted: string;
  muted2: string;
  faint: string;
  line: string;
  pine: string;
  onRoad: string;
  clay2: string;
}) {
  const canAddChild = allowChildren && depth < LIFE_ROAD_ACCEPTANCE_MAX_DEPTH;
  const linkLabel = acceptanceLinkLabel(item);
  const showLink = depth === 1 && (linkMode === 'quarter' || linkMode === 'month');

  return (
    <View style={styles.itemBlock}>
      <View style={[styles.row, { paddingLeft: 4 + (depth - 1) * 14 }]}>
        <Pressable
          onPress={() =>
            onChange(updateAcceptanceById(roots, item.id, { done: !item.done }))
          }
          accessibilityRole="checkbox"
          accessibilityState={{ checked: item.done }}
          hitSlop={6}
          style={[
            styles.check,
            item.done
              ? { borderColor: pine, backgroundColor: pine }
              : {
                  borderColor: line,
                  backgroundColor: 'rgba(255,255,255,0.45)',
                },
          ]}>
          {item.done ? (
            <Svg width={9} height={9} viewBox="0 0 24 24" fill="none">
              <Path
                d="M5 12.5l4.5 4.5L19 7"
                stroke={onRoad}
                strokeWidth={2.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          ) : null}
        </Pressable>
        <TextInput
          value={item.text}
          onChangeText={(text) =>
            onChange(
              updateAcceptanceById(roots, item.id, {
                text: [...text].slice(0, LIFE_ROAD_ACCEPTANCE_TEXT_MAX).join(''),
              }),
            )
          }
          maxLength={LIFE_ROAD_ACCEPTANCE_TEXT_MAX}
          placeholder={depth === 1 ? `写一条${itemNoun}…` : '子任务…'}
          placeholderTextColor={faint}
          style={[
            styles.input,
            {
              color: item.done ? muted : ink3,
              textDecorationLine: item.done ? 'line-through' : 'none',
            },
          ]}
        />
        {canAddChild ? (
          <Pressable
            onPress={() => {
              const total = flattenAcceptanceItems(roots).length;
              if (total >= LIFE_ROAD_ACCEPTANCE_MAX_ITEMS) return;
              onChange(
                addChildAcceptance(roots, item.id, createAcceptanceItem('')),
              );
            }}
            hitSlop={6}
            style={[styles.miniBtn, { borderColor: line }]}>
            <Text style={{ fontSize: 10, fontWeight: '600', color: muted }}>子</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onChange(removeAcceptanceById(roots, item.id))}
          accessibilityLabel="删除本条"
          hitSlop={8}
          style={({ pressed }) => [
            styles.remove,
            pressed && { backgroundColor: clay2, opacity: 1 },
          ]}>
          <RemoveIcon color={muted2} />
        </Pressable>
      </View>

      {depth === 1 ? (
        <View style={[styles.priorityRow, { paddingLeft: 29 + (depth - 1) * 14 }]}>
          <Text style={[styles.linkHint, { color: muted2 }]}>优先级</Text>
          {LIFE_ROAD_ACCEPTANCE_PRIORITIES.map((p) => {
            const on = (item.priority ?? 'p1') === p;
            return (
              <Pressable
                key={p}
                onPress={() =>
                  onChange(updateAcceptanceById(roots, item.id, { priority: p }))
                }
                style={[
                  styles.linkChip,
                  {
                    borderColor: on ? pine : line,
                    backgroundColor: on
                      ? 'rgba(33,69,58,0.1)'
                      : 'rgba(255,255,255,0.35)',
                  },
                ]}>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: on ? '700' : '500',
                    color: on ? pine : muted,
                  }}>
                  {LIFE_ROAD_ACCEPTANCE_PRIORITY_LABELS[p]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {showLink && linkMode === 'quarter' ? (
        <View style={[styles.linkRow, { paddingLeft: 29 + (depth - 1) * 14 }]}>
          <Text style={[styles.linkHint, { color: muted2 }]}>连接季</Text>
          {([1, 2, 3, 4] as const).map((q) => {
            const on = item.link_quarter === q;
            return (
              <Pressable
                key={q}
                onPress={() =>
                  onChange(
                    updateAcceptanceById(roots, item.id, {
                      link_quarter: on ? null : q,
                      link_month: null,
                    }),
                  )
                }
                style={[
                  styles.linkChip,
                  {
                    borderColor: on ? pine : line,
                    backgroundColor: on
                      ? 'rgba(33,69,58,0.1)'
                      : 'rgba(255,255,255,0.35)',
                  },
                ]}>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: on ? '700' : '500',
                    color: on ? pine : muted,
                  }}>
                  {quarterLabel(q)}
                </Text>
              </Pressable>
            );
          })}
          <Text style={{ fontSize: 10, color: muted2 }}>{linkLabel ?? '未连'}</Text>
        </View>
      ) : null}

      {showLink && linkMode === 'month' ? (
        <View style={[styles.linkRow, { paddingLeft: 29 + (depth - 1) * 14 }]}>
          <Text style={[styles.linkHint, { color: muted2 }]}>连接月</Text>
          {(linkMonthOptions.length ? linkMonthOptions : [1, 2, 3]).map((m) => {
            const on = item.link_month === m;
            return (
              <Pressable
                key={m}
                onPress={() =>
                  onChange(
                    updateAcceptanceById(roots, item.id, {
                      link_month: on ? null : m,
                      link_quarter: null,
                    }),
                  )
                }
                style={[
                  styles.linkChip,
                  {
                    borderColor: on ? pine : line,
                    backgroundColor: on
                      ? 'rgba(33,69,58,0.1)'
                      : 'rgba(255,255,255,0.35)',
                  },
                ]}>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: on ? '700' : '500',
                    color: on ? pine : muted,
                  }}>
                  {monthLabel(m)}
                </Text>
              </Pressable>
            );
          })}
          <Text style={{ fontSize: 10, color: muted2 }}>{linkLabel ?? '未连'}</Text>
        </View>
      ) : null}

      {(item.children ?? []).map((ch) => (
        <AcceptanceRow
          key={ch.id}
          item={ch}
          depth={depth + 1}
          roots={roots}
          onChange={onChange}
          itemNoun={itemNoun}
          linkMode={null}
          linkMonthOptions={[]}
          allowChildren={allowChildren}
          ink3={ink3}
          muted={muted}
          muted2={muted2}
          faint={faint}
          line={line}
          pine={pine}
          onRoad={onRoad}
          clay2={clay2}
        />
      ))}
    </View>
  );
}

export function AcceptanceChecklistEditor({
  items,
  onChange,
  itemNoun = '目标',
  linkMode = null,
  linkMonthOptions = [],
  allowChildren = false,
  ink2,
  ink3,
  muted,
  muted2,
  faint,
  line,
  pine,
  onRoad,
  clay2,
}: AcceptanceChecklistEditorProps) {
  const [draft, setDraft] = useState('');
  const [draftPriority, setDraftPriority] =
    useState<LifeRoadAcceptancePriority>('p1');
  const total = flattenAcceptanceItems(items).length;
  const groups = groupAcceptanceByPriority(items);

  const addFromDraft = () => {
    if (total >= LIFE_ROAD_ACCEPTANCE_MAX_ITEMS) return;
    const text = draft.trim();
    if (!text) return;
    onChange([
      ...items,
      createAcceptanceItem(
        text.slice(0, LIFE_ROAD_ACCEPTANCE_TEXT_MAX),
        draftPriority,
      ),
    ]);
    setDraft('');
  };

  return (
    <View style={styles.wrap}>
      {LIFE_ROAD_ACCEPTANCE_PRIORITIES.map((p) => {
        const layer = groups[p];
        if (layer.length === 0) return null;
        return (
          <View key={p} style={styles.layer}>
            <Text style={[styles.layerLabel, { color: muted2 }]}>
              {LIFE_ROAD_ACCEPTANCE_PRIORITY_LABELS[p]}
            </Text>
            {layer.map((item) => (
              <AcceptanceRow
                key={item.id}
                item={item}
                depth={1}
                roots={items}
                onChange={onChange}
                itemNoun={itemNoun}
                linkMode={linkMode}
                linkMonthOptions={linkMonthOptions}
                allowChildren={allowChildren}
                ink3={ink3}
                muted={muted}
                muted2={muted2}
                faint={faint}
                line={line}
                pine={pine}
                onRoad={onRoad}
                clay2={clay2}
              />
            ))}
          </View>
        );
      })}

      {total < LIFE_ROAD_ACCEPTANCE_MAX_ITEMS ? (
        <View style={styles.addBlock}>
          <View style={styles.priorityRow}>
            <Text style={[styles.linkHint, { color: muted2 }]}>加到</Text>
            {LIFE_ROAD_ACCEPTANCE_PRIORITIES.map((p) => {
              const on = draftPriority === p;
              return (
                <Pressable
                  key={p}
                  onPress={() => setDraftPriority(p)}
                  style={[
                    styles.linkChip,
                    {
                      borderColor: on ? pine : line,
                      backgroundColor: on
                        ? 'rgba(33,69,58,0.1)'
                        : 'rgba(255,255,255,0.35)',
                    },
                  ]}>
                  <Text
                    style={{
                      fontSize: 10,
                      fontWeight: on ? '700' : '500',
                      color: on ? pine : muted,
                    }}>
                    {LIFE_ROAD_ACCEPTANCE_PRIORITY_LABELS[p]}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.addRow}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              maxLength={LIFE_ROAD_ACCEPTANCE_TEXT_MAX}
              placeholder={`加一条${itemNoun}`}
              placeholderTextColor={muted2}
              onSubmitEditing={addFromDraft}
              returnKeyType="done"
              style={[
                styles.addInput,
                {
                  color: ink3,
                  borderColor: line,
                  backgroundColor: 'rgba(255,255,255,0.38)',
                },
              ]}
            />
            <Pressable
              onPress={addFromDraft}
              disabled={!draft.trim()}
              accessibilityLabel={`添加${itemNoun}`}
              style={({ pressed }) => [
                styles.addBtn,
                {
                  backgroundColor: pine,
                  opacity: !draft.trim() ? 0.4 : pressed ? 0.9 : 1,
                },
              ]}>
              <Text style={{ color: onRoad, fontSize: 18, lineHeight: 20, marginTop: -1 }}>
                +
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <Text style={[styles.cap, { color: faint }]}>
          已达上限 {LIFE_ROAD_ACCEPTANCE_MAX_ITEMS} 条
        </Text>
      )}

      {items.length === 0 ? (
        <Text style={[styles.empty, { color: ink2 }]}>
          {linkMode === 'quarter'
            ? `按 P0 / P1 / P2 分层写${itemNoun}；可连到对应季，勾选表示已抵达。`
            : linkMode === 'month'
              ? `按 P0 / P1 / P2 分层写${itemNoun}；可连到对应月，勾选表示已抵达。`
              : allowChildren
                ? `按 P0 / P1 / P2 分层写${itemNoun}，可拆子任务。`
                : `暂无。按 P0 / P1 / P2 分层写清${itemNoun}，可随时增删勾选。`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 1 },
  layer: { gap: 2 },
  layerLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: 2,
    marginBottom: 2,
    paddingLeft: 4,
  },
  itemBlock: { gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderRadius: 9,
  },
  check: {
    width: 18,
    height: 18,
    borderRadius: 5,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
    paddingVertical: 2,
    paddingHorizontal: 0,
  },
  miniBtn: {
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    flexShrink: 0,
  },
  remove: {
    width: 22,
    height: 22,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.55,
    flexShrink: 0,
  },
  priorityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    paddingBottom: 2,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 5,
    paddingBottom: 4,
  },
  linkHint: { fontSize: 10, fontWeight: '600', marginRight: 2 },
  linkChip: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
  },
  addBlock: { gap: 6, marginTop: 4 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  addInput: {
    flex: 1,
    minWidth: 0,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 9,
    paddingHorizontal: 10,
    paddingVertical: 9,
    fontSize: 13,
  },
  addBtn: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  cap: { fontSize: 11, marginTop: 4 },
  empty: { fontSize: 12, lineHeight: 18, fontStyle: 'italic', marginTop: 4 },
});
