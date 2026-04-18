import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type TabMode = 'date' | 'time';

const dateQuickChips = ['今天', '今晚', '明天', '本周六', '下周一'];
const timeQuickChips = ['本周', '下周', '本月', '下月', '未来半年'];
const lunarLabels = ['十五','十六','十七','十八','清明','廿十','廿一','廿二','廿三','廿四','廿五','廿六','廿七','廿八','廿九','三十','三月','初二','初三','初四','初五','谷雨','初七','初八','初九','初十','十一','十二','十三','十四'];

export default function SchedulePickerScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const theme = Colors[scheme ?? 'light'];
  const isDark = scheme === 'dark';

  const [tab, setTab] = React.useState<TabMode>('date');
  const [selectedDay, setSelectedDay] = React.useState(24);
  const [allDay, setAllDay] = React.useState(false);
  const [hasExactTime, setHasExactTime] = React.useState(true);

  const outline = isDark ? 'rgba(148,163,184,0.7)' : '#727785';
  const outlineVariant = isDark ? 'rgba(148,163,184,0.25)' : 'rgba(194,198,214,0.45)';
  const surfaceLow = isDark ? 'rgba(30,41,59,0.5)' : '#f2f3ff';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
      <View style={[styles.header, { backgroundColor: isDark ? 'rgba(15,23,42,0.86)' : 'rgba(255,255,255,0.86)' }]}>
        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <MaterialIcons name="close" size={22} color={outline} />
        </Pressable>

        <View style={[styles.tabSwitch, { backgroundColor: surfaceLow }]}>
          <Pressable onPress={() => setTab('date')} style={[styles.tabBtn, tab === 'date' && { backgroundColor: theme.surface }]}>
            <Text style={[styles.tabText, { color: tab === 'date' ? theme.primary : outline, fontWeight: tab === 'date' ? '700' : '500' }]}>日期</Text>
          </Pressable>
          <Pressable onPress={() => setTab('time')} style={[styles.tabBtn, tab === 'time' && { backgroundColor: theme.surface }]}>
            <Text style={[styles.tabText, { color: tab === 'time' ? theme.primary : outline, fontWeight: tab === 'time' ? '700' : '500' }]}>时刻</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.back()} style={styles.iconBtn}>
          <MaterialIcons name={tab === 'time' ? 'done' : 'check'} size={22} color={theme.primary} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {(tab === 'date' ? dateQuickChips : timeQuickChips).map((chip) => (
            <Pressable key={chip} style={[styles.chip, { backgroundColor: theme.surface, borderColor: outlineVariant }]}>
              <Text style={[styles.chipText, { color: theme.text }]}>{chip}</Text>
            </Pressable>
          ))}
        </ScrollView>

        <View style={styles.calendarHead}>
          <Text style={[styles.monthTitle, { color: theme.text }]}>2026年4月</Text>
          <View style={styles.monthActions}>
            <Pressable style={styles.iconBtn}><MaterialIcons name="chevron-left" size={22} color={outline} /></Pressable>
            <Pressable style={styles.iconBtn}><MaterialIcons name="chevron-right" size={22} color={outline} /></Pressable>
          </View>
        </View>

        <View style={styles.weekRow}>{['一', '二', '三', '四', '五', '六', '日'].map((w) => <Text key={w} style={[styles.weekText, { color: outline }]}>{w}</Text>)}</View>

        <View style={styles.grid}>
          {Array.from({ length: 30 }).map((_, i) => {
            const day = i + 1;
            const lunar = lunarLabels[i] ?? '农历';
            const today = day === 5;
            const selected = day === selectedDay;

            const inRange = tab === 'time' && day >= 1 && day <= 8;
            const start = tab === 'time' && day === 1;
            const end = tab === 'time' && day === 8;

            return (
              <Pressable key={day} onPress={() => setSelectedDay(day)} style={styles.dayCell}>
                {inRange ? (
                  <View style={styles.rangeWrap}>
                    {!start ? <View style={styles.rangeLeftFill} /> : null}
                    {!end ? <View style={styles.rangeRightFill} /> : null}

                    {start || end ? (
                      <View style={[styles.dayCircle, { backgroundColor: '#006c49' }]}>
                        <Text style={[styles.dayNum, { color: '#fff' }]}>{day}</Text>
                        <Text style={[styles.dayLunar, { color: '#fff' }]}>{lunar}</Text>
                      </View>
                    ) : (
                      <View style={[styles.dayCircle, today ? styles.todayCircle : undefined]}>
                        <Text style={[styles.dayNum, { color: today ? '#006c49' : theme.text }]}>{day}</Text>
                        <Text style={[styles.dayLunar, { color: today ? '#006c49' : outline }]}>{lunar}</Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <View style={[styles.dayCircle, selected && tab === 'date' && { backgroundColor: '#006c49' }, today && tab === 'date' && !selected && { backgroundColor: 'rgba(0,108,73,0.12)' }]}>
                    <Text style={[styles.dayNum, { color: selected && tab === 'date' ? '#fff' : today ? '#006c49' : theme.text }]}>{day}</Text>
                    <Text style={[styles.dayLunar, { color: selected && tab === 'date' ? '#fff' : today ? '#006c49' : outline }]}>{lunar}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>

        {tab === 'date' ? (
          <View style={[styles.settingList, { backgroundColor: surfaceLow }]}> 
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}><View style={[styles.settingIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="schedule" size={20} color={theme.primary} /></View><Text style={[styles.settingLabel, { color: theme.text }]}>具体时间</Text></View>
              <View style={styles.settingRight}><Text style={[styles.settingValue, { color: theme.primary }]}>13:00</Text><Switch value={hasExactTime} onValueChange={setHasExactTime} /></View>
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}><View style={[styles.settingIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="notifications" size={20} color={theme.primary} /></View><Text style={[styles.settingLabel, { color: theme.text }]}>提醒设置</Text></View>
              <View style={styles.settingRight}><Text style={[styles.settingHint, { color: outline }]}>不提醒</Text><MaterialIcons name="chevron-right" size={20} color={outline} /></View>
            </View>
            <View style={styles.settingRow}>
              <View style={styles.settingLeft}><View style={[styles.settingIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="repeat" size={20} color={theme.primary} /></View><Text style={[styles.settingLabel, { color: theme.text }]}>重复设置</Text></View>
              <View style={styles.settingRight}><Text style={[styles.settingHint, { color: outline }]}>不重复</Text><MaterialIcons name="chevron-right" size={20} color={outline} /></View>
            </View>
          </View>
        ) : (
          <>
            <View style={[styles.settingList, { backgroundColor: surfaceLow }]}> 
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}><View style={[styles.settingIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="brightness-7" size={20} color={theme.primary} /></View><Text style={[styles.settingLabel, { color: theme.text }]}>全天</Text></View>
                <View style={styles.settingRight}><Switch value={allDay} onValueChange={setAllDay} /></View>
              </View>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}><View style={[styles.settingIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="schedule" size={20} color={theme.primary} /></View><Text style={[styles.settingLabel, { color: theme.text }]}>开始</Text></View>
                <View style={styles.settingRight}><Text style={[styles.settingValueSmall, { color: theme.primary }]}>4月1日 13:00</Text><MaterialIcons name="chevron-right" size={20} color={outline} /></View>
              </View>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}><View style={[styles.settingIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="timer-off" size={20} color={theme.primary} /></View><Text style={[styles.settingLabel, { color: theme.text }]}>结束</Text></View>
                <View style={styles.settingRight}><Text style={[styles.settingValueSmall, { color: theme.primary }]}>4月8日 14:00</Text><MaterialIcons name="chevron-right" size={20} color={outline} /></View>
              </View>
            </View>

            <View style={[styles.settingList, { backgroundColor: surfaceLow }]}> 
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}><View style={[styles.settingIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="notifications" size={20} color={theme.primary} /></View><Text style={[styles.settingLabel, { color: theme.text }]}>提醒设置</Text></View>
                <View style={styles.settingRight}><Text style={[styles.settingHint, { color: outline }]}>无</Text><MaterialIcons name="chevron-right" size={20} color={outline} /></View>
              </View>
              <View style={styles.settingRow}>
                <View style={styles.settingLeft}><View style={[styles.settingIcon, { backgroundColor: theme.surface }]}><MaterialIcons name="repeat" size={20} color={theme.primary} /></View><Text style={[styles.settingLabel, { color: theme.text }]}>重复设置</Text></View>
                <View style={styles.settingRight}><Text style={[styles.settingHint, { color: outline }]}>不重复</Text><MaterialIcons name="chevron-right" size={20} color={outline} /></View>
              </View>
            </View>

            <Pressable style={[styles.clearBtn, { borderColor: 'rgba(186,26,26,0.2)', backgroundColor: theme.surface }]}>
              <Text style={styles.clearText}>清除</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
  iconBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tabSwitch: { flexDirection: 'row', borderRadius: 12, padding: 4, gap: 2 },
  tabBtn: { paddingHorizontal: 20, paddingVertical: 6, borderRadius: 10 },
  tabText: { fontSize: 14 },
  content: { padding: 16, gap: 20, paddingBottom: 40 },
  chipsRow: { gap: 10 },
  chip: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  chipText: { fontSize: 14, fontWeight: '500' },
  calendarHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  monthTitle: { fontSize: 28, fontWeight: '900' },
  monthActions: { flexDirection: 'row', gap: 8 },
  weekRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8 },
  weekText: { width: '14.28%', textAlign: 'center', fontSize: 11, fontWeight: '800' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: '14.28%', alignItems: 'center', paddingVertical: 8 },
  rangeWrap: { width: '100%', alignItems: 'center', justifyContent: 'center' },
  rangeLeftFill: { position: 'absolute', left: 0, right: '50%', top: 6, bottom: 6, backgroundColor: 'rgba(0,108,73,0.12)' },
  rangeRightFill: { position: 'absolute', left: '50%', right: 0, top: 6, bottom: 6, backgroundColor: 'rgba(0,108,73,0.12)' },
  dayCircle: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  todayCircle: { borderWidth: 2, borderColor: 'rgba(0,108,73,0.2)' },
  dayNum: { fontSize: 18, fontWeight: '700', lineHeight: 20 },
  dayLunar: { fontSize: 9, fontWeight: '600' },
  settingList: { borderRadius: 14, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  settingLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { fontSize: 16, fontWeight: '500' },
  settingRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  settingValue: { fontSize: 22, fontWeight: '800' },
  settingValueSmall: { fontSize: 22, fontWeight: '700' },
  settingHint: { fontSize: 14, fontWeight: '500' },
  clearBtn: { borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  clearText: { color: '#ba1a1a', fontSize: 16, fontWeight: '600' },
});
