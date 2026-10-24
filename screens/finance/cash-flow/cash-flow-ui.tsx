import { usePullToRefresh } from '@/hooks/use-pull-to-refresh';
import { toast } from '@/lib/app-feedback';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import {
  loadCashFlowState,
  persistCashFlowState,
} from '@/lib/repositories/cash-flow/cash-flow';
import { CASH_FLOW_EMPTY_STATE } from '@/lib/repositories/cash-flow/cash-flow.defaults';
import {
  calculateCashFlowMetrics,
  type CashFlowMetrics,
} from '@/lib/cash-flow/cash-flow-metrics';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { CashFlowState } from '@/lib/repositories/cash-flow/cash-flow.types';
import { CASH_FLOW_DASH_BG, CashFlowFoldDashboard } from './cash-flow-fold-dashboard';
import { CashFlowFoldDetail, type CashFlowDetailTab } from './cash-flow-fold-detail';
import { CashFlowFoldEntry } from './cash-flow-fold-entry';
import { CashFlowFoldLedger } from './cash-flow-fold-ledger';
import { CashFlowFoldSimulator } from './cash-flow-fold-simulator';

type ActiveTab =
  | 'dashboard'
  | 'entry'
  | 'ledger'
  | 'simulator'
  | 'detail_active'
  | 'detail_passive'
  | 'detail_asset'
  | 'detail_liability'
  | 'detail_expense';

type Metrics = CashFlowMetrics;

const VIEW_TITLES: Record<Exclude<ActiveTab, 'dashboard'>, string> = {
  entry: '记一笔现金流',
  ledger: '资产负债台账',
  simulator: '决策模拟',
  detail_active: '主动收入明细',
  detail_passive: '被动收入明细',
  detail_asset: '资产明细',
  detail_liability: '负债明细',
  detail_expense: '流出明细',
};

const VIEW_SUBTITLES: Partial<Record<Exclude<ActiveTab, 'dashboard'>, string>> = {
  entry: 'CASHFLOW · NEW ENTRY',
  ledger: 'BALANCE SHEET · FREEDOM',
  simulator: 'WHAT IF · BUY A HOME',
  detail_active: 'CASHFLOW · ACTIVE',
  detail_passive: 'CASHFLOW · PASSIVE',
  detail_asset: 'CASHFLOW · ASSETS',
  detail_liability: 'CASHFLOW · LIABILITY',
  detail_expense: 'CASHFLOW · EXPENSE',
};

/** URL 段（嵌套路由）；物理返回 = pop 子屏，不再靠 JS 拦返回键 */
export const CASH_FLOW_SECTION_SLUGS: Record<Exclude<ActiveTab, 'dashboard'>, string> = {
  entry: 'entry',
  ledger: 'ledger',
  simulator: 'simulator',
  detail_active: 'detail-active',
  detail_passive: 'detail-passive',
  detail_asset: 'detail-asset',
  detail_liability: 'detail-liability',
  detail_expense: 'detail-expense',
};

export function parseCashFlowSectionSlug(slug: string | undefined): Exclude<ActiveTab, 'dashboard'> | null {
  if (!slug || typeof slug !== 'string') return null;
  const pairs = Object.entries(CASH_FLOW_SECTION_SLUGS) as [Exclude<ActiveTab, 'dashboard'>, string][];
  const hit = pairs.find(([, s]) => s === slug);
  return hit ? hit[0] : null;
}

type CashFlowContextValue = {
  state: CashFlowState;
  setState: React.Dispatch<React.SetStateAction<CashFlowState>>;
  hydrated: boolean;
  metrics: Metrics;
  showToast: (message: string, type?: 'success' | 'warning') => void;
};

const CashFlowContext = React.createContext<CashFlowContextValue | null>(null);

function useCashFlowContext() {
  const v = React.useContext(CashFlowContext);
  if (!v) throw new Error('CashFlowProvider missing');
  return v;
}

export function CashFlowProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CashFlowState>(CASH_FLOW_EMPTY_STATE);
  const [hydrated, setHydrated] = useState(false);
  const skipNextPersist = useRef(true);

  const metrics = useMemo(() => calculateCashFlowMetrics(state), [state]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const loaded = await loadCashFlowState();
        if (!cancelled) setState(loaded);
      } catch (e) {
        console.error(e);
        if (!cancelled) setState(CASH_FLOW_EMPTY_STATE);
      } finally {
        if (!cancelled) setHydrated(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextPersist.current) {
      skipNextPersist.current = false;
      return;
    }
    const t = setTimeout(() => {
      persistCashFlowState(state).catch((err) => console.error(err));
    }, 450);
    return () => clearTimeout(t);
  }, [state, hydrated]);

  const showToast = useCallback((message: string, type: 'success' | 'warning' = 'success') => {
    if (type === 'warning') toast.warn(message);
    else toast.success(message);
  }, []);

  const value = useMemo<CashFlowContextValue>(
    () => ({ state, setState, hydrated, metrics, showToast }),
    [state, hydrated, metrics, showToast]
  );

  return <CashFlowContext.Provider value={value}>{children}</CashFlowContext.Provider>;
}

export function CashFlowShell({ route }: { route: ActiveTab }) {
  const router = useRouter();
  const { state, setState, hydrated, metrics, showToast } = useCashFlowContext();
  const insets = useSafeAreaInsets();
  const { ff, isDark, fonts: ffFonts } = useFinanceFoldTheme();

  const isDash = route === 'dashboard';
  const bg = isDash ? CASH_FLOW_DASH_BG : ff.paper;
  const text = isDash ? '#F6F0E3' : ff.ink;
  const subtle = isDash ? '#9FB5A8' : ff.muted;
  const border = isDash ? 'rgba(235,219,189,0.12)' : ff.line;
  const headerScrim = isDash ? 'rgba(23,43,36,0.96)' : isDark ? 'rgba(23,43,36,0.94)' : 'rgba(243,238,228,0.94)';

  const [financeInsightsRefresh, setFinanceInsightsRefresh] = React.useState(0);
  const simSaveRef = React.useRef<(() => void) | null>(null);
  const bindSimSave = React.useCallback((handler: () => void) => {
    simSaveRef.current = handler;
  }, []);

  const reloadCashFlow = React.useCallback(async () => {
    const loaded = await loadCashFlowState();
    setState(loaded);
    setFinanceInsightsRefresh((t) => t + 1);
  }, [setState]);

  const { refreshControl } = usePullToRefresh(reloadCashFlow);

  const headerTitle =
    route === 'dashboard' ? '现金流' : VIEW_TITLES[route as Exclude<ActiveTab, 'dashboard'>];
  const headerSub =
    route === 'dashboard'
      ? `FREEDOM MODEL · ${new Date().getFullYear()}.${String(new Date().getMonth() + 1).padStart(2, '0')}`
      : VIEW_SUBTITLES[route as Exclude<ActiveTab, 'dashboard'>] ?? null;

  const navigateToSection = useCallback(
    (tab: Exclude<ActiveTab, 'dashboard'>) => {
      router.push({
        pathname: '/cash-flow/[section]',
        params: { section: CASH_FLOW_SECTION_SLUGS[tab] },
      });
    },
    [router],
  );

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['left', 'right']}>
      <View
        style={[
          styles.header,
          {
            borderBottomColor: border,
            backgroundColor: headerScrim,
            paddingTop: insets.top,
          },
        ]}>
        {route !== 'dashboard' ? (
          <View style={styles.headerDetailRow}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.75 }]}>
              <MaterialIcons name="arrow-back-ios-new" size={18} color={subtle} />
            </Pressable>
            <View style={styles.headerDetailMid}>
              <Text style={[styles.headerTitle, { color: text, fontFamily: ffFonts.serif }]}>{headerTitle}</Text>
              {headerSub ? <Text style={[styles.headerSub, { color: subtle }]}>{headerSub}</Text> : null}
            </View>
            {route === 'entry' ? (
              <Pressable
                onPress={() => showToast('保存为常用模板', 'success')}
                style={({ pressed }) => [styles.headerPill, { borderColor: border, opacity: pressed ? 0.8 : 1 }]}>
                <MaterialIcons name="repeat" size={12} color={subtle} />
                <Text style={[styles.headerPillText, { color: subtle }]}>模板</Text>
              </Pressable>
            ) : route === 'ledger' ? (
              <Pressable
                onPress={() => router.push('/assets')}
                style={({ pressed }) => [styles.headerPill, { borderColor: border, opacity: pressed ? 0.8 : 1 }]}>
                <Text style={[styles.headerPillText, { color: subtle }]}>真实资产</Text>
                <MaterialIcons name="chevron-right" size={14} color={subtle} />
              </Pressable>
            ) : route === 'simulator' ? (
              <Pressable
                onPress={() => simSaveRef.current?.() ?? showToast('模拟已保存', 'success')}
                style={({ pressed }) => [styles.headerPill, { borderColor: border, opacity: pressed ? 0.8 : 1 }]}>
                <Text style={[styles.headerPillText, { color: subtle }]}>保存</Text>
              </Pressable>
            ) : route.startsWith('detail_') ? (
              <Pressable
                onPress={() => navigateToSection('simulator')}
                style={({ pressed }) => [styles.headerPill, { borderColor: border, opacity: pressed ? 0.8 : 1 }]}>
                <Text style={[styles.headerPillText, { color: subtle }]}>模拟调整</Text>
              </Pressable>
            ) : (
              <View style={{ width: 56 }} />
            )}
          </View>
        ) : (
          <View style={styles.headerDashRow}>
            <Pressable
              onPress={() => router.back()}
              hitSlop={8}
              style={({ pressed }) => [styles.headerIconBtn, pressed && { opacity: 0.7 }]}>
              <MaterialIcons name="arrow-back-ios-new" size={18} color={subtle} />
            </Pressable>
            <View style={styles.headerDashMid}>
              <Text style={[styles.headerTitle, { color: '#F7F0E2', fontFamily: ffFonts.serif }]}>{headerTitle}</Text>
              <Text style={[styles.headerSub, { color: '#9FB5A8' }]}>{headerSub}</Text>
            </View>
            <View style={styles.headerDashActions}>
              <Pressable
                onPress={() => showToast('模型设置', 'success')}
                style={({ pressed }) => [styles.headerIconBtnSoft, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="settings" size={18} color="#C9D6CE" />
              </Pressable>
              <Pressable
                onPress={() => {
                  void reloadCashFlow().then(() => showToast('已刷新现金流', 'success'));
                }}
                style={({ pressed }) => [styles.headerIconBtnSoft, pressed && { opacity: 0.75 }]}>
                <MaterialIcons name="sync" size={18} color="#C9D6CE" />
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {!hydrated ? (
        <View style={[styles.cashFlowLoading, { paddingBottom: 28 + insets.bottom }]}>
          <ActivityIndicator size="large" color={subtle} />
          <Text style={[styles.cashFlowLoadingText, { color: subtle }]}>正在读取现金流数据…</Text>
        </View>
      ) : (
        <ScrollView
          refreshControl={refreshControl}
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 28 + insets.bottom }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}>
          {route === 'dashboard' ? (
            <CashFlowFoldDashboard
              state={state}
              metrics={metrics}
              onNavigate={navigateToSection}
              financeInsightsRefresh={financeInsightsRefresh}
            />
          ) : null}
          {route === 'entry' ? (
            <CashFlowFoldEntry state={state} metrics={metrics} setState={setState} showToast={showToast} />
          ) : null}
          {route === 'ledger' ? (
            <CashFlowFoldLedger
              state={state}
              metrics={metrics}
              onOpenAssets={() => router.push('/assets')}
            />
          ) : null}
          {route === 'simulator' ? (
            <CashFlowFoldSimulator
              state={state}
              currentMetrics={metrics}
              showToast={showToast}
              onSaveRequest={bindSimSave}
            />
          ) : null}
          {route.startsWith('detail_') ? (
            <CashFlowFoldDetail
              detailType={route as CashFlowDetailTab}
              state={state}
              metrics={metrics}
              setState={setState}
              showToast={showToast}
              onSimulate={() => navigateToSection('simulator')}
            />
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  cashFlowLoading: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  cashFlowLoadingText: { fontSize: 14, textAlign: 'center' },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerDetailRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerDetailMid: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  headerDashRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerDashMid: { flex: 1, paddingHorizontal: 8 },
  headerDashActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerIconBtnSoft: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  headerPill: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerPillText: { fontSize: 11, fontWeight: '700' },
  headerTitle: { fontSize: 17, fontWeight: '800', letterSpacing: 0.3 },
  headerSub: { fontSize: 10, letterSpacing: 0.8, marginTop: 2, textTransform: 'uppercase' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 16 },
});
