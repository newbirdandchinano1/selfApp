/**
 * 助手气泡轻量 Markdown（无第三方依赖）：
 * 粗体、行内 code、标题、列表、引用、围栏代码块。
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Radius, Typography } from '@/constants/design-tokens';
import {
  parseInlineMarkdown,
  parseMarkdownBlocks,
  type InlineSeg,
} from '@/lib/assistant/chat-markdown-parse';

type Props = {
  text: string;
  color: string;
  mutedColor?: string;
  codeBg?: string;
  selectable?: boolean;
  trailing?: React.ReactNode;
};

function InlineText({
  text,
  color,
  codeBg,
  selectable,
}: {
  text: string;
  color: string;
  codeBg?: string;
  selectable?: boolean;
}) {
  const segs: InlineSeg[] = parseInlineMarkdown(text);
  return (
    <Text style={[styles.body, { color }]} selectable={selectable}>
      {segs.map((s, i) => {
        if (s.type === 'bold') {
          return (
            <Text key={i} style={styles.bold}>
              {s.value}
            </Text>
          );
        }
        if (s.type === 'code') {
          return (
            <Text
              key={i}
              style={[
                styles.code,
                { backgroundColor: codeBg || 'rgba(0,0,0,0.06)', color },
              ]}>
              {s.value}
            </Text>
          );
        }
        return <Text key={i}>{s.value}</Text>;
      })}
    </Text>
  );
}

export function ChatMarkdownText({
  text,
  color,
  mutedColor,
  codeBg,
  selectable,
  trailing,
}: Props) {
  const blocks = React.useMemo(() => parseMarkdownBlocks(text), [text]);
  if (!blocks.length) {
    return (
      <Text style={[styles.body, { color }]} selectable={selectable}>
        {trailing}
      </Text>
    );
  }

  return (
    <View style={styles.col}>
      {blocks.map((b, idx) => {
        const isLast = idx === blocks.length - 1;
        if (b.kind === 'h') {
          return (
            <Text
              key={idx}
              style={[
                styles.body,
                styles.heading,
                b.level === 1 ? styles.h1 : b.level === 2 ? styles.h2 : styles.h3,
                { color },
              ]}
              selectable={selectable}>
              <InlineText text={b.text} color={color} codeBg={codeBg} selectable={selectable} />
              {isLast ? trailing : null}
            </Text>
          );
        }
        if (b.kind === 'ul' || b.kind === 'ol') {
          return (
            <View key={idx} style={styles.list}>
              {b.items.map((item, j) => (
                <View key={j} style={styles.listRow}>
                  <Text style={[styles.body, { color: mutedColor || color }]}>
                    {b.kind === 'ul' ? '•' : `${j + 1}.`}
                  </Text>
                  <View style={styles.listBody}>
                    <InlineText text={item} color={color} codeBg={codeBg} selectable={selectable} />
                  </View>
                </View>
              ))}
              {isLast ? (
                <View style={styles.trailRow}>{trailing}</View>
              ) : null}
            </View>
          );
        }
        if (b.kind === 'quote') {
          return (
            <View
              key={idx}
              style={[
                styles.quote,
                { borderLeftColor: mutedColor || color, backgroundColor: codeBg || 'rgba(0,0,0,0.04)' },
              ]}>
              <InlineText
                text={b.text}
                color={mutedColor || color}
                codeBg={codeBg}
                selectable={selectable}
              />
              {isLast ? trailing : null}
            </View>
          );
        }
        if (b.kind === 'code') {
          return (
            <View
              key={idx}
              style={[styles.codeBlock, { backgroundColor: codeBg || 'rgba(0,0,0,0.06)' }]}>
              <Text style={[styles.codeBlockText, { color }]} selectable={selectable}>
                {b.text || (b.incomplete ? '…' : '')}
              </Text>
              {isLast ? trailing : null}
            </View>
          );
        }
        return (
          <Text key={idx} style={[styles.body, { color }]} selectable={selectable}>
            <InlineText text={b.text} color={color} codeBg={codeBg} selectable={selectable} />
            {isLast ? trailing : null}
          </Text>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  col: { gap: 6 },
  body: {
    ...Typography.body,
    fontSize: 15,
    lineHeight: 22,
  },
  bold: { fontWeight: '700' },
  code: {
    fontFamily: 'monospace',
    fontSize: 13,
    borderRadius: Radius.sm,
    paddingHorizontal: 4,
  },
  heading: { fontWeight: '700' },
  h1: { fontSize: 17, lineHeight: 24 },
  h2: { fontSize: 16, lineHeight: 23 },
  h3: { fontSize: 15, lineHeight: 22 },
  list: { gap: 4 },
  listRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  listBody: { flex: 1 },
  trailRow: { marginTop: 2 },
  quote: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    paddingRight: 8,
    borderRadius: Radius.sm,
  },
  codeBlock: {
    borderRadius: Radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  codeBlockText: {
    fontFamily: 'monospace',
    fontSize: 13,
    lineHeight: 19,
  },
});
