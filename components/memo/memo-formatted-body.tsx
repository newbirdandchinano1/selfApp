import {
  parseMemoBody,
  type RichBlock,
  type RichMark,
  type RichTextRun,
} from '@/lib/memo-richdoc';
import { Image } from 'expo-image';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

type Props = {
  body: string;
  color: string;
  mutedColor: string;
  quoteBg: string;
  emptyLabel?: string;
};

const INDENT_UNIT = 16;

function runStyle(marks: RichMark[], baseWeight: '400' | '600' | '700' | '800') {
  return {
    fontWeight: (marks.includes('bold') ? '800' : baseWeight) as '400' | '600' | '700' | '800',
    fontStyle: (marks.includes('italic') ? 'italic' : 'normal') as 'italic' | 'normal',
    textDecorationLine: (marks.includes('strike') ? 'line-through' : 'none') as
      | 'line-through'
      | 'none',
  };
}

function InlineRuns({
  runs,
  color,
  baseSize,
  baseWeight,
}: {
  runs: RichTextRun[];
  color: string;
  baseSize: number;
  baseWeight: '400' | '600' | '700' | '800';
}) {
  return (
    <Text style={{ fontSize: baseSize, lineHeight: baseSize * 1.5, color }}>
      {runs.map((r, idx) => (
        <Text
          key={`${idx}-${r.text.slice(0, 8)}`}
          style={{
            fontSize: baseSize,
            lineHeight: baseSize * 1.5,
            ...runStyle(r.marks, baseWeight),
          }}
        >
          {r.text}
        </Text>
      ))}
    </Text>
  );
}

function isEmptyParagraph(b: RichBlock): boolean {
  return b.type === 'paragraph' && b.runs.every((r) => !r.text);
}

function BlockView({
  block,
  color,
  mutedColor,
  quoteBg,
}: {
  block: RichBlock;
  color: string;
  mutedColor: string;
  quoteBg: string;
}) {
  if (isEmptyParagraph(block)) {
    return <View style={styles.gap} />;
  }

  switch (block.type) {
    case 'heading': {
      const size = block.level === 1 ? 22 : block.level === 2 ? 19 : 17;
      return (
        <InlineRuns runs={block.runs} color={color} baseSize={size} baseWeight="800" />
      );
    }
    case 'bullet_list':
      return (
        <View style={styles.listCol}>
          {block.items.map((it, i) => (
            <View
              key={`bu-${i}`}
              style={[styles.bulletRow, it.indent > 0 ? { paddingLeft: it.indent * INDENT_UNIT } : null]}
            >
              <Text style={[styles.bulletDot, { color: mutedColor }]}>•</Text>
              <View style={styles.bulletText}>
                <InlineRuns runs={it.runs} color={color} baseSize={16} baseWeight="600" />
              </View>
            </View>
          ))}
        </View>
      );
    case 'ordered_list':
      return (
        <View style={styles.listCol}>
          {block.items.map((it, i) => (
            <View
              key={`ol-${i}`}
              style={[styles.bulletRow, it.indent > 0 ? { paddingLeft: it.indent * INDENT_UNIT } : null]}
            >
              <Text style={[styles.orderNum, { color: mutedColor }]}>{i + 1}.</Text>
              <View style={styles.bulletText}>
                <InlineRuns runs={it.runs} color={color} baseSize={16} baseWeight="600" />
              </View>
            </View>
          ))}
        </View>
      );
    case 'todo':
      return (
        <View
          style={[
            styles.bulletRow,
            block.indent > 0 ? { paddingLeft: block.indent * INDENT_UNIT } : null,
          ]}
        >
          <Text style={[styles.todoMark, { color: mutedColor }]}>
            {block.checked ? '☑' : '☐'}
          </Text>
          <View style={styles.bulletText}>
            <InlineRuns
              runs={block.runs}
              color={color}
              baseSize={16}
              baseWeight="600"
            />
          </View>
        </View>
      );
    case 'quote':
      return (
        <View
          style={[styles.quoteBox, { backgroundColor: quoteBg, borderLeftColor: mutedColor }]}
        >
          <InlineRuns runs={block.runs} color={color} baseSize={15} baseWeight="600" />
        </View>
      );
    case 'code':
      return (
        <View style={[styles.codeBox, { backgroundColor: quoteBg, borderColor: mutedColor }]}>
          <Text style={[styles.codeText, { color }]}>{block.text || ' '}</Text>
        </View>
      );
    case 'divider':
      return <View style={[styles.divider, { backgroundColor: mutedColor }]} />;
    case 'image':
      return (
        <View style={styles.imageWrap}>
          <Image
            source={{ uri: block.uri }}
            style={[
              styles.image,
              block.width > 0 && block.height > 0
                ? { aspectRatio: block.width / block.height }
                : null,
            ]}
            contentFit="contain"
          />
        </View>
      );
    case 'paragraph':
    default:
      return (
        <InlineRuns
          runs={'runs' in block ? block.runs : [{ text: '', marks: [] }]}
          color={color}
          baseSize={16}
          baseWeight="600"
        />
      );
  }
}

export function MemoFormattedBody({
  body,
  color,
  mutedColor,
  quoteBg,
  emptyLabel = '（无正文）',
}: Props) {
  const blocks = useMemo(() => parseMemoBody(body).doc.blocks, [body]);
  const trimmed = body.trim();

  if (!trimmed) {
    return <Text style={[styles.empty, { color: mutedColor }]}>{emptyLabel}</Text>;
  }

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => (
        <View key={`b-${index}`} style={styles.block}>
          <BlockView
            block={block}
            color={color}
            mutedColor={mutedColor}
            quoteBg={quoteBg}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 2 },
  block: { marginBottom: 6 },
  gap: { height: 8 },
  empty: { fontSize: 15, fontWeight: '600', fontStyle: 'italic' },
  listCol: { gap: 4 },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletDot: { fontSize: 18, lineHeight: 24, marginTop: 1 },
  orderNum: { fontSize: 15, lineHeight: 24, fontWeight: '700', minWidth: 22 },
  todoMark: { fontSize: 16, lineHeight: 24, marginTop: 1 },
  bulletText: { flex: 1 },
  quoteBox: {
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  codeBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  codeText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 20,
    fontWeight: '500',
  },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 8, opacity: 0.45 },
  imageWrap: { borderRadius: 10, overflow: 'hidden' },
  image: { width: '100%', aspectRatio: 16 / 9, maxHeight: 320 },
});
