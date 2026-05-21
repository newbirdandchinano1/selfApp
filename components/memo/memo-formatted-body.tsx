import { parseMemoBodyBlocks, type BlockLine, type InlineSegment } from '@/lib/memo-format';
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

function segmentFontSize(seg: InlineSegment, baseSize: number): number {
  if (seg.size === 'small') return Math.max(12, baseSize - 3);
  if (seg.size === 'large') return baseSize + 4;
  return baseSize;
}

function InlineText({
  segments,
  color,
  baseSize,
  baseWeight,
}: {
  segments: InlineSegment[];
  color: string;
  baseSize: number;
  baseWeight: '400' | '600' | '700' | '800';
}) {
  return (
    <Text style={{ fontSize: baseSize, lineHeight: baseSize * 1.5, color }}>
      {segments.map((seg, idx) => {
        const size = segmentFontSize(seg, baseSize);
        return (
          <Text
            key={`${idx}-${seg.text.slice(0, 8)}`}
            style={{
              fontSize: size,
              lineHeight: size * 1.5,
              fontWeight: seg.bold ? '800' : baseWeight,
              fontStyle: seg.italic ? 'italic' : 'normal',
              textDecorationLine: seg.strike ? 'line-through' : 'none',
            }}
          >
            {seg.text}
          </Text>
        );
      })}
    </Text>
  );
}

function BlockContent({
  block,
  color,
  mutedColor,
  quoteBg,
}: {
  block: Exclude<BlockLine, { kind: 'empty' }>;
  color: string;
  mutedColor: string;
  quoteBg: string;
}) {
  const indentStyle = block.indent > 0 ? { paddingLeft: block.indent * INDENT_UNIT } : null;

  if (block.kind === 'heading') {
    const size = block.level === 1 ? 22 : block.level === 2 ? 19 : 17;
    return (
      <View style={indentStyle}>
        <InlineText segments={block.segments} color={color} baseSize={size} baseWeight="800" />
      </View>
    );
  }
  if (block.kind === 'bullet') {
    return (
      <View style={[styles.bulletRow, indentStyle]}>
        <Text style={[styles.bulletDot, { color: mutedColor }]}>•</Text>
        <View style={styles.bulletText}>
          <InlineText segments={block.segments} color={color} baseSize={16} baseWeight="600" />
        </View>
      </View>
    );
  }
  if (block.kind === 'quote') {
    return (
      <View
        style={[
          styles.quoteBox,
          indentStyle,
          { backgroundColor: quoteBg, borderLeftColor: mutedColor },
        ]}
      >
        <InlineText segments={block.segments} color={color} baseSize={15} baseWeight="600" />
      </View>
    );
  }
  return (
    <View style={indentStyle}>
      <InlineText segments={block.segments} color={color} baseSize={16} baseWeight="600" />
    </View>
  );
}

export function MemoFormattedBody({
  body,
  color,
  mutedColor,
  quoteBg,
  emptyLabel = '（无正文）',
}: Props) {
  const blocks = useMemo(() => parseMemoBodyBlocks(body), [body]);
  const trimmed = body.trim();

  if (!trimmed) {
    return <Text style={[styles.empty, { color: mutedColor }]}>{emptyLabel}</Text>;
  }

  return (
    <View style={styles.root}>
      {blocks.map((block, index) => {
        if (block.kind === 'empty') {
          return <View key={`gap-${index}`} style={styles.gap} />;
        }
        return (
          <View key={`b-${index}`} style={styles.block}>
            <BlockContent block={block} color={color} mutedColor={mutedColor} quoteBg={quoteBg} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 2 },
  block: { marginBottom: 6 },
  gap: { height: 8 },
  empty: { fontSize: 15, fontWeight: '600', fontStyle: 'italic' },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletDot: { fontSize: 18, lineHeight: 24, marginTop: 1 },
  bulletText: { flex: 1 },
  quoteBox: {
    borderLeftWidth: 3,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
});
