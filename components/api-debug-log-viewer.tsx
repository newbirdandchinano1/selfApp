import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  clearApiDebugLogs,
  formatApiDebugTime,
  getApiDebugLogs,
  subscribeApiDebug,
  type ApiDebugLogEntry,
} from '@/lib/api-debug';

function LogDetailBlock({
  label,
  value,
  textColor,
  mutedColor,
}: {
  label: string;
  value?: string | null;
  textColor: string;
  mutedColor: string;
}) {
  if (!value?.trim()) return null;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 11, fontWeight: '800', color: mutedColor }}>{label}</Text>
      <Text selectable style={{ fontSize: 11, lineHeight: 16, fontFamily: 'monospace', color: textColor }}>
        {value}
      </Text>
    </View>
  );
}

function LogRow({
  entry,
  expanded,
  onPress,
  textColor,
  mutedColor,
  borderColor,
}: {
  entry: ApiDebugLogEntry;
  expanded: boolean;
  onPress: () => void;
  textColor: string;
  mutedColor: string;
  borderColor: string;
}) {
  const statusColor = entry.ok ? '#16a34a' : '#dc2626';
  const path = entry.url.replace(/^https?:\/\/[^/]+/, '') || entry.url;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.logRow, { borderColor, opacity: pressed ? 0.92 : 1 }]}>
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
      <Text
        style={{ fontSize: 12, fontWeight: '800', color: textColor }}
        numberOfLines={expanded ? undefined : 3}>
        {entry.method === 'SYS' ? entry.responseBody : `${entry.method} ${path}`}
      </Text>
      {entry.error ? (
        <Text style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }} numberOfLines={expanded ? undefined : 2}>
          {entry.error}
        </Text>
      ) : null}
      {expanded ? (
        <View style={{ gap: 10, marginTop: 10 }}>
          <LogDetailBlock label="请求体" value={entry.requestBody} textColor={textColor} mutedColor={mutedColor} />
          <LogDetailBlock label="响应体" value={entry.responseBody} textColor={textColor} mutedColor={mutedColor} />
        </View>
      ) : null}
    </Pressable>
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
        contentContainerStyle={{ gap: 8, paddingBottom: 4 }}>
        {logs.length === 0 ? (
          <Text style={{ fontSize: 12, lineHeight: 18, color: mutedColor }}>{emptyHint}</Text>
        ) : (
          logs.map(entry => (
            <LogRow
              key={entry.id}
              entry={entry}
              expanded={expandedId === entry.id}
              onPress={() => setExpandedId(prev => (prev === entry.id ? null : entry.id))}
              textColor={textColor}
              mutedColor={mutedColor}
              borderColor={borderColor}
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
});
