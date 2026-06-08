import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  clearApiDebugLogs,
  formatApiDebugTime,
  getApiDebugLogs,
  subscribeApiDebug,
  type ApiDebugLogEntry,
} from '@/lib/api-debug';

async function copyDebugText(label: string, value: string): Promise<void> {
  try {
    await Clipboard.setStringAsync(value);
    Alert.alert('已复制', `${label}已复制到剪贴板（${value.length} 字符）`);
  } catch (e) {
    Alert.alert('复制失败', e instanceof Error ? e.message : String(e));
  }
}

function LogDetailBlock({
  label,
  value,
  textColor,
  mutedColor,
  primary,
}: {
  label: string;
  value?: string | null;
  textColor: string;
  mutedColor: string;
  primary: string;
}) {
  if (!value?.trim()) return null;
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.detailToolbar}>
        <Text style={{ fontSize: 11, fontWeight: '800', color: mutedColor }}>
          {label}（{value.length} 字符）
        </Text>
        <Pressable
          onPress={() => void copyDebugText(label, value)}
          hitSlop={10}
          style={({ pressed }) => [styles.copyBtn, { opacity: pressed ? 0.7 : 1 }]}>
          <Text style={{ color: primary, fontWeight: '800', fontSize: 12 }}>复制</Text>
        </Pressable>
      </View>
      <ScrollView
        nestedScrollEnabled
        style={styles.detailScroll}
        contentContainerStyle={{ paddingBottom: 4 }}>
        <Text selectable style={{ fontSize: 11, lineHeight: 16, fontFamily: 'monospace', color: textColor }}>
          {value}
        </Text>
      </ScrollView>
    </View>
  );
}

function LogRow({
  entry,
  expanded,
  onToggle,
  textColor,
  mutedColor,
  borderColor,
  primary,
}: {
  entry: ApiDebugLogEntry;
  expanded: boolean;
  onToggle: () => void;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  primary: string;
}) {
  const statusColor = entry.ok ? '#16a34a' : '#dc2626';
  const path = entry.url.replace(/^https?:\/\/[^/]+/, '') || entry.url;

  const copyAll = async () => {
    const parts = [
      `${entry.method} ${entry.url}`,
      entry.status > 0 ? `HTTP ${entry.status}` : '',
      entry.error ? `error: ${entry.error}` : '',
      entry.requestBody ? `--- request ---\n${entry.requestBody}` : '',
      entry.responseBody ? `--- response ---\n${entry.responseBody}` : '',
    ].filter(Boolean);
    await copyDebugText('整条日志', parts.join('\n\n'));
  };

  return (
    <View style={[styles.logRow, { borderColor }]}>
      <Pressable onPress={onToggle} style={({ pressed }) => [{ opacity: pressed ? 0.92 : 1 }]}>
        <View style={styles.logRowHead}>
          <Text style={{ fontSize: 11, color: mutedColor, fontFamily: 'monospace' }}>
            {formatApiDebugTime(entry.at)}
          </Text>
          <Text style={{ fontSize: 11, fontWeight: '800', color: statusColor }}>
            {entry.method} {entry.ok ? 'OK' : 'ERR'} {entry.status > 0 ? entry.status : ''}
          </Text>
          {entry.durationMs > 0 ? (
            <Text style={{ fontSize: 11, color: mutedColor }}>{entry.durationMs}ms</Text>
          ) : null}
        </View>
        <Text style={{ fontSize: 12, fontWeight: '800', color: textColor }} numberOfLines={expanded ? undefined : 3}>
          {entry.method === 'SYS' ? entry.responseBody : `${entry.method} ${path}`}
        </Text>
        {entry.error ? (
          <Text style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }} numberOfLines={expanded ? undefined : 2}>
            {entry.error}
          </Text>
        ) : null}
        {!expanded ? (
          <Text style={{ fontSize: 11, color: mutedColor, marginTop: 6 }}>点击展开 · 查看完整内容与复制</Text>
        ) : null}
      </Pressable>

      {expanded ? (
        <View style={{ gap: 10, marginTop: 10 }}>
          <Pressable
            onPress={() => void copyAll()}
            hitSlop={8}
            style={({ pressed }) => [styles.copyAllBtn, { borderColor, opacity: pressed ? 0.75 : 1 }]}>
            <Text style={{ color: primary, fontWeight: '800', fontSize: 12 }}>复制本条全部</Text>
          </Pressable>
          <LogDetailBlock
            label="请求体"
            value={entry.requestBody}
            textColor={textColor}
            mutedColor={mutedColor}
            primary={primary}
          />
          <LogDetailBlock
            label="响应体"
            value={entry.responseBody}
            textColor={textColor}
            mutedColor={mutedColor}
            primary={primary}
          />
        </View>
      ) : null}
    </View>
  );
}

type Props = {
  textColor: string;
  mutedColor: string;
  borderColor: string;
  cardBg: string;
  primary: string;
  maxHeight?: number;
  emptyHint?: string;
  fill?: boolean;
};

export function ApiDebugLogViewer({
  textColor,
  mutedColor,
  borderColor,
  cardBg,
  primary,
  maxHeight = 280,
  emptyHint = '暂无记录。切换页面或下拉刷新后会自动记录 HTTP 请求。',
  fill = false,
}: Props) {
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  const [logRevision, bumpLogRevision] = React.useReducer((n: number) => n + 1, 0);

  React.useEffect(() => subscribeApiDebug(() => bumpLogRevision()), []);

  const logs = React.useMemo(() => getApiDebugLogs(), [logRevision]);

  return (
    <View style={[styles.wrap, { borderColor, backgroundColor: cardBg }, fill ? styles.wrapFill : null]}>
      <View style={styles.toolbar}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: textColor }}>请求日志（{logs.length}）</Text>
        <Pressable
          onPress={() => {
            clearApiDebugLogs();
            setExpandedId(null);
          }}
          style={({ pressed }) => [{ opacity: pressed ? 0.75 : 1, padding: 4 }]}>
          <Text style={{ color: primary, fontWeight: '700', fontSize: 12 }}>清空</Text>
        </Pressable>
      </View>
      <ScrollView
        style={fill ? styles.scrollFill : { maxHeight }}
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
        {logs.length === 0 ? (
          <Text style={{ fontSize: 12, lineHeight: 18, color: mutedColor }}>{emptyHint}</Text>
        ) : (
          logs.map(entry => (
            <LogRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onToggle={() => setExpandedId(prev => (prev === entry.id ? null : entry.id))}
              textColor={textColor}
              mutedColor={mutedColor}
              borderColor={borderColor}
              primary={primary}
            />
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 8,
  },
  wrapFill: { flex: 1 },
  scrollFill: { flex: 1 },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  logRow: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 4 },
  logRowHead: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  detailToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  copyBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 44,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyAllBtn: {
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  detailScroll: {
    maxHeight: 360,
    borderRadius: 8,
  },
});
