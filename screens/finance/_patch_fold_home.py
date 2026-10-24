# -*- coding: utf-8 -*-
from pathlib import Path

p = Path(__file__).with_name("FinanceScreen.tsx")
text = p.read_text(encoding="utf-8")

start = text.find("          <View style={styles.headerInner}>")
end = text.find("      <Modal visible={isSheetVisible}")
if start < 0 or end < 0:
    raise SystemExit(f"bad markers start={start} end={end}")

new_block = r'''          <View style={styles.headerInner}>
            <View style={styles.headerTitleCol}>
              <Text
                style={[styles.headerTitleFold, { color: text, fontFamily: ffFonts.serif }]}
                numberOfLines={1}>
                {headerDateLabel}
              </Text>
              <Text style={[styles.headerSub, { color: subtle }]} numberOfLines={1}>
                {headerSubLabel}
              </Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable
                onPress={() => router.push('/finance-calendar')}
                style={({ pressed }) => [
                  styles.headerSoftBtn,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,252,245,0.72)', borderColor: outlineVariant },
                  pressed && { opacity: 0.82 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="财务日历"
                hitSlop={Layout.hitSlop}>
                <MaterialIcons name="calendar-today" size={18} color={text} />
              </Pressable>
              <Pressable
                onPress={() => {
                  toast.success('已同步全部账户');
                  void reloadFinanceAccounts(true);
                  void reloadFinanceTransactions(true);
                }}
                style={({ pressed }) => [
                  styles.headerSoftBtn,
                  { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,252,245,0.72)', borderColor: outlineVariant },
                  pressed && { opacity: 0.82 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="同步账户"
                hitSlop={Layout.hitSlop}>
                <MaterialIcons name="sync" size={18} color={text} />
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.content}>
          <View style={styles.financeBodyStack}>
          {!initialFinanceLoadPending ? (
            <Animated.View style={{ opacity: financeContentOpacity }}>
          <View style={styles.sectionStack}>

          <FoldRiseIn animate={foldEntranceAnimate} index={0}>
            <Pressable
              onPress={openBudgetAdjust}
              style={({ pressed }) => [
                styles.budgetCardFold,
                {
                  backgroundColor: ff.budgetFrom,
                  borderColor: ff.budgetBorder,
                  opacity: pressed ? 0.96 : 1,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel="调整本周期预算">
              <View pointerEvents="none" style={[styles.budgetCardDecorLg, { borderColor: 'rgba(244,199,132,0.13)' }]} />
              <View pointerEvents="none" style={[styles.budgetCardDecorSm, { borderColor: 'rgba(255,255,255,0.055)' }]} />
              <View style={styles.budgetCardRow}>
                <View style={styles.budgetMainFold}>
                  <View style={styles.budgetLabelRow}>
                    <Text style={[styles.budgetLabelFold, { color: ff.budgetLabel }]}>本周期预算结余</Text>
                    <Pressable
                      onPress={(e) => {
                        // @ts-expect-error RN synthetic event may expose stopPropagation
                        e?.stopPropagation?.();
                        setShowNetAmounts((prev) => !prev);
                      }}
                      style={({ pressed: eyePressed }) => [
                        styles.miniEyeBtn,
                        eyePressed && { opacity: 0.75 },
                      ]}
                      hitSlop={8}
                      accessibilityRole="button"
                      accessibilityLabel={showNetAmounts ? '隐藏金额' : '显示金额'}>
                      <MaterialIcons
                        name={showNetAmounts ? 'visibility-off' : 'visibility'}
                        size={14}
                        color={ff.budgetLabel}
                      />
                    </Pressable>
                  </View>
                  {showNetAmounts && foldAnimate ? (
                    <FoldCountUpText
                      value={budgetSurplusAmount}
                      animate={foldAnimate}
                      duration={760}
                      formatter={formatCurrencyWithDecimals}
                      textStyle={[
                        styles.budgetAmountMono,
                        { color: ff.budgetAmount, fontFamily: ffFonts.mono },
                      ]}
                    />
                  ) : (
                    <Text
                      style={[
                        styles.budgetAmountMono,
                        { color: ff.budgetAmount, fontFamily: ffFonts.mono },
                      ]}>
                      {showNetAmounts
                        ? formatCurrencyWithDecimals(budgetSurplusAmount)
                        : hiddenAmountText}
                    </Text>
                  )}
                  <View style={styles.budgetProgressFold}>
                    <View style={[styles.budgetTrackFold, { backgroundColor: ff.budgetTrack }]}>
                      <View
                        style={[
                          styles.budgetTrackFillFold,
                          { width: `${budgetUsedPercent}%`, backgroundColor: ff.amber },
                        ]}
                      />
                    </View>
                    <View style={styles.budgetFootFold}>
                      <Text style={[styles.budgetFootText, { color: ff.budgetFoot }]}>
                        已用{' '}
                        <Text style={{ color: ff.budgetAmountSoft, fontWeight: '700' }}>
                          {showNetAmounts ? `${Math.round(budgetUsedPercent)}%` : '--'}
                        </Text>
                        {' · 还剩 '}
                        {daysLeftIncludingToday} 天
                      </Text>
                      <Text style={[styles.budgetFootText, { color: ff.budgetFoot }]}>
                        月预算{' '}
                        <Text style={{ color: ff.budgetAmountSoft, fontWeight: '700' }}>
                          {showNetAmounts
                            ? formatCurrencyWithDecimals(budgetTotalAmount)
                            : hiddenAmountText}
                        </Text>
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.budgetRingFold}>
                  {(() => {
                    const ringSize = 72;
                    const stroke = 5;
                    const r = (ringSize - stroke) / 2;
                    const c = 2 * Math.PI * r;
                    const ringPct = isTodayBudgetOver ? 1 : todayAvailableRingPct;
                    const dash = c * ringPct;
                    const ringProg = isTodayBudgetOver ? danger : ff.ringStroke;
                    return (
                      <>
                        <View style={{ width: ringSize, height: ringSize, alignItems: 'center', justifyContent: 'center' }}>
                          <Svg
                            key={`today-budget-ring-${todayAvailableRingPct.toFixed(4)}-${todayAvailableAmount.toFixed(2)}`}
                            width={ringSize}
                            height={ringSize}
                            viewBox={`0 0 ${ringSize} ${ringSize}`}
                            style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
                            <Circle
                              cx={ringSize / 2}
                              cy={ringSize / 2}
                              r={r}
                              stroke={ff.ringTrack}
                              strokeWidth={stroke}
                              fill="none"
                            />
                            <Circle
                              cx={ringSize / 2}
                              cy={ringSize / 2}
                              r={r}
                              stroke={ringProg}
                              strokeWidth={stroke}
                              fill="none"
                              strokeDasharray={`${dash} ${c}`}
                              strokeLinecap="round"
                            />
                          </Svg>
                          <View style={styles.budgetRingCenterFold}>
                            <Text
                              style={[
                                styles.budgetRingValueFold,
                                {
                                  color: isTodayBudgetOver ? danger : ff.budgetAmount,
                                  fontFamily: ffFonts.mono,
                                },
                              ]}
                              numberOfLines={1}>
                              {showNetAmounts
                                ? formatCurrencyWithDecimals(
                                    isTodayBudgetOver ? todayBudgetOverAmount : todayAvailableAmount,
                                  )
                                : hiddenAmountText}
                            </Text>
                            <Text style={[styles.budgetRingLabelFold, { color: ff.budgetFoot }]}>
                              {isTodayBudgetOver ? '超出预算' : '今日可用'}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.budgetRingCap}>
                          <View style={[styles.budgetRingCapDot, { backgroundColor: ff.amber }]} />
                          <Text style={[styles.budgetRingCapText, { color: ff.budgetFoot }]} numberOfLines={1}>
                            今日已用{' '}
                            {showNetAmounts
                              ? formatCurrencyWithDecimals(todayBudgetExpenseTotal)
                              : hiddenAmountText}
                          </Text>
                        </View>
                      </>
                    );
                  })()}
                </View>
              </View>
            </Pressable>
          </FoldRiseIn>

          <FoldRiseIn animate={foldEntranceAnimate} index={1}>
            <FinanceSavingsGoalBlock
              currentNetWorth={netTotalForTrend}
              today={today}
              showAmounts={showNetAmounts}
              hiddenAmountText={hiddenAmountText}
              formatCurrency={formatCurrencyWithDecimals}
              isDark={isDark}
              text={text}
              subtle={subtle}
              primary={primary}
              surface={surface}
              surfaceMuted={surfaceMuted}
              primaryMuted={primaryMuted}
              danger={danger}
              secondary={secondary}
              outlineVariant={outlineVariant}
              tertiary={tertiary}
              scheduledDrainUntilTarget={scheduledWithholdingRemaining}
              scheduledBudgetDeduction={scheduledWithholdingRemaining}
              logicalTodayYmd={calendarTodayYmd}
              dayBoundaryHour={financeDayBoundary.hour}
              dayBoundaryMinute={financeDayBoundary.minute}
              onGoalChange={(g) => setSavingsGoalTargetDate(g?.targetDate ?? null)}
            />
          </FoldRiseIn>

          <FoldRiseIn animate={foldEntranceAnimate} index={2}>
            <View
              style={[
                styles.netCardFold,
                Shadows.card,
                { backgroundColor: surface, borderColor: outlineStrong },
              ]}>
              <View style={styles.netTopFold}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.netLabelRow}>
                    <Text style={[styles.netLabelFold, { color: subtle }]}>净资产</Text>
                    <Pressable
                      onPress={() => setShowNetAmounts((prev) => !prev)}
                      style={({ pressed }) => [
                        styles.miniEyeBtnLight,
                        {
                          backgroundColor: isDark ? 'rgba(255,255,255,0.08)' : '#F2EDE2',
                          borderColor: isDark ? outlineVariant : '#E3D8C5',
                        },
                        pressed && { opacity: 0.75 },
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={showNetAmounts ? '隐藏金额' : '显示金额'}>
                      <MaterialIcons
                        name={showNetAmounts ? 'visibility-off' : 'visibility'}
                        size={14}
                        color={subtle}
                      />
                    </Pressable>
                  </View>
                  <Text
                    style={[
                      styles.netAmountFold,
                      { color: primary, fontFamily: ffFonts.mono },
                    ]}>
                    {showNetAmounts
                      ? formatCurrencyWithDecimals(displayedNetWorthAmount)
                      : hiddenAmountText}
                  </Text>
                  {netMonthChange && isSelectedNetTrendToday ? (
                    <View style={styles.netChangeRow}>
                      <Text
                        style={{
                          color: netMonthChange.delta >= 0 ? secondary : danger,
                          fontSize: 11,
                          fontWeight: '700',
                        }}>
                        {netMonthChange.delta >= 0 ? '↗' : '↘'}{' '}
                        {netMonthChange.pct != null
                          ? `${Math.abs(netMonthChange.pct).toFixed(1)}%`
                          : ''}
                      </Text>
                      <Text style={{ color: subtle, fontSize: 11, fontWeight: '600' }}>
                        较月初{' '}
                        {showNetAmounts
                          ? `${netMonthChange.delta >= 0 ? '+' : ''}${formatCurrencyWithDecimals(netMonthChange.delta)}`
                          : hiddenAmountText}
                      </Text>
                    </View>
                  ) : (
                    <Text
                      style={[
                        styles.trendChartDayLabel,
                        { color: isSelectedNetTrendToday ? textMuted : primary, marginTop: 4 },
                      ]}>
                      {selectedNetTrend.label}
                      {!isSelectedNetTrendToday ? ' · 净资产' : ''}
                    </Text>
                  )}
                </View>
                <Pressable
                  onPress={() => router.push('/finance-stats')}
                  style={({ pressed }) => [
                    styles.rangePillFold,
                    {
                      borderColor: outlineVariant,
                      backgroundColor: isDark ? surfaceMuted : '#FAF6EC',
                    },
                    pressed && { opacity: 0.8 },
                  ]}>
                  <Text style={[styles.rangePillText, { color: subtle }]}>30 日</Text>
                  <MaterialIcons name="chevron-right" size={14} color={subtle} />
                </Pressable>
              </View>

              <View style={styles.trendChartWrap}>
                <GestureDetector gesture={netWorthTrendScrubGesture}>
                  <View
                    collapsable={false}
                    style={styles.trendChartPlot}
                    onLayout={(e) => {
                      trendChartPlotWidthRef.current = e.nativeEvent.layout.width;
                    }}
                    accessibilityRole="adjustable"
                    accessibilityLabel="净资产趋势图，点按或滑动查看不同日期"
                    accessibilityHint="在图表上点按或左右滑动以查看各日净资产">
                    <View
                      pointerEvents="none"
                      style={[
                        styles.trendChartPlotBg,
                        {
                          backgroundColor: surfaceSubtle,
                          borderColor: outlineVariant,
                        },
                      ]}
                    />
                    <Svg
                      width="100%"
                      height={NET_WORTH_TREND_CHART_H}
                      viewBox={`0 0 ${NET_WORTH_TREND_CHART_W} ${NET_WORTH_TREND_CHART_H}`}
                      preserveAspectRatio="none"
                      pointerEvents="none"
                      style={StyleSheet.absoluteFill}>
                      {trendChartGeometry ? (
                        <>
                          <Defs>
                            <LinearGradient
                              id="netWorthTrendFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1">
                              <Stop
                                offset="0"
                                stopColor={primary}
                                stopOpacity={isDark ? 0.22 : 0.16}
                              />
                              <Stop offset="1" stopColor={primary} stopOpacity={0} />
                            </LinearGradient>
                          </Defs>
                          <Path d={trendChartGeometry.areaD} fill="url(#netWorthTrendFill)" />
                          <Path
                            d={trendChartGeometry.pathD}
                            fill="none"
                            stroke={primary}
                            strokeWidth={2}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          {selectedNetTrendChartPoint && !isSelectedNetTrendToday ? (
                            <Path
                              d={`M${selectedNetTrendChartPoint.x.toFixed(1)},${NET_WORTH_TREND_CHART_INSET} L${selectedNetTrendChartPoint.x.toFixed(1)},${NET_WORTH_TREND_CHART_H - NET_WORTH_TREND_CHART_INSET}`}
                              stroke={primaryMuted}
                              strokeWidth={1}
                              strokeDasharray="3 3"
                            />
                          ) : null}
                        </>
                      ) : null}
                    </Svg>
                    {trendChartGeometry ? (
                      <View
                        style={styles.trendChartNodes}
                        pointerEvents="none"
                        collapsable={false}>
                        {netTrendVisibleNodeIndices.map((i) => {
                          const pt = trendChartGeometry.points[i];
                          if (!pt) return null;
                          const isSelected = i === selectedNetTrendIndex;
                          const isLast = i === netTrendLastIndex;
                          const dotSize = isSelected ? 10 : 8;
                          return (
                            <View
                              key={`net-trend-node-${i}`}
                              style={[
                                styles.trendChartNodeHit,
                                {
                                  left: `${(pt.x / NET_WORTH_TREND_CHART_W) * 100}%`,
                                  top: `${(pt.y / NET_WORTH_TREND_CHART_H) * 100}%`,
                                },
                              ]}>
                              <View
                                style={[
                                  styles.trendChartNodeDot,
                                  {
                                    width: dotSize,
                                    height: dotSize,
                                    borderRadius: dotSize / 2,
                                    backgroundColor: isSelected ? primary : surface,
                                    borderColor: primary,
                                    borderWidth: isSelected ? 2 : 1.5,
                                    opacity: isLast && !isSelected ? 0.85 : 1,
                                  },
                                ]}
                              />
                            </View>
                          );
                        })}
                      </View>
                    ) : null}
                  </View>
                </GestureDetector>
              </View>

              <Pressable
                onPress={() => setBudgetCardNetExpanded((v) => !v)}
                style={({ pressed }) => [
                  styles.netExpandRow,
                  { borderTopColor: outlineVariant },
                  pressed && { opacity: 0.85 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={budgetCardNetExpanded ? '收起本月明细' : '展开本月明细'}>
                <Text style={[styles.netExpandText, { color: subtle }]} numberOfLines={1}>
                  本月{' '}
                  <Text style={{ color: text, fontWeight: '700' }}>
                    收入 {monthlyIncomeText}
                  </Text>
                  {' · '}
                  <Text style={{ color: text, fontWeight: '700' }}>
                    支出 {monthlyExpenseText}
                  </Text>
                </Text>
                <View style={styles.netExpandRight}>
                  <Text style={[styles.netExpandHint, { color: subtle }]}>
                    {budgetCardNetExpanded ? '收起' : '展开明细'}
                  </Text>
                  <MaterialIcons
                    name={budgetCardNetExpanded ? 'keyboard-arrow-up' : 'keyboard-arrow-down'}
                    size={16}
                    color={subtle}
                  />
                </View>
              </Pressable>

              {budgetCardNetExpanded ? (
                <View style={styles.netStats}>
                  <View style={[styles.netStatCol, { backgroundColor: surfaceSubtle }]}>
                    <Text style={[styles.netStatLabel, { color: subtle }]}>本月收入</Text>
                    <Text style={[styles.netStatValue, { color: secondary }]}>{monthlyIncomeText}</Text>
                  </View>
                  <View style={[styles.netStatCol, { backgroundColor: surfaceSubtle }]}>
                    <Text style={[styles.netStatLabel, { color: subtle }]}>本月支出</Text>
                    <Text style={[styles.netStatValue, { color: danger }]}>{monthlyExpenseText}</Text>
                  </View>
                  <View style={[styles.netStatCol, { backgroundColor: surfaceSubtle }]}>
                    <Text style={[styles.netStatLabel, { color: subtle }]}>本月盈余</Text>
                    <Text style={[styles.netStatValue, { color: monthlySurplusColor }]}>
                      {monthlySurplusText}
                    </Text>
                  </View>
                  <View style={[styles.netStatCol, { backgroundColor: surfaceSubtle }]}>
                    <Text style={[styles.netStatLabel, { color: subtle }]}>储蓄率</Text>
                    <Text style={[styles.netStatValue, { color: text }]}>{savingRateText}</Text>
                  </View>
                </View>
              ) : null}
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldEntranceAnimate} index={3}>
            <View style={styles.quickRow}>
              <Pressable
                onPress={() => router.push('/assets')}
                style={({ pressed }) => [
                  styles.quickBtn,
                  {
                    backgroundColor: isDark ? surface : 'rgba(255,252,245,0.78)',
                    borderColor: outlineVariant,
                  },
                  pressed && { opacity: 0.88 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="资产">
                <View style={[styles.quickIcon, { backgroundColor: isDark ? primaryMuted : '#E9EFE8' }]}>
                  <MaterialIcons name="account-balance" size={16} color={isDark ? primary : '#456857'} />
                </View>
                <View style={styles.quickCopy}>
                  <Text style={[styles.quickTitle, { color: text }]}>资产</Text>
                  <Text style={[styles.quickSub, { color: subtle }]}>
                    {financeAccounts.length} 个账户
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => router.push('/scheduled-expenses')}
                style={({ pressed }) => [
                  styles.quickBtn,
                  {
                    backgroundColor: isDark ? surface : 'rgba(255,252,245,0.78)',
                    borderColor: outlineVariant,
                  },
                  pressed && { opacity: 0.88 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="定时支出">
                <View style={[styles.quickIcon, { backgroundColor: isDark ? ff.amber2 : '#F5EAD8' }]}>
                  <MaterialIcons name="event-repeat" size={16} color={isDark ? tertiary : '#976628'} />
                </View>
                <View style={styles.quickCopy}>
                  <Text style={[styles.quickTitle, { color: text }]}>定时支出</Text>
                  <Text style={[styles.quickSub, { color: subtle }]}>
                    {enabledScheduledCount} 项启用
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => router.push('/cash-flow')}
                style={({ pressed }) => [
                  styles.quickBtn,
                  {
                    backgroundColor: isDark ? surface : 'rgba(255,252,245,0.78)',
                    borderColor: outlineVariant,
                  },
                  pressed && { opacity: 0.88 },
                ]}
                accessibilityRole="button"
                accessibilityLabel="现金流">
                <View style={[styles.quickIcon, { backgroundColor: isDark ? 'rgba(88,122,131,0.25)' : '#E7EEF0' }]}>
                  <MaterialIcons name="show-chart" size={16} color={isDark ? '#8FB0B8' : '#587A83'} />
                </View>
                <View style={styles.quickCopy}>
                  <Text style={[styles.quickTitle, { color: text }]}>现金流</Text>
                  <Text style={[styles.quickSub, { color: subtle }]}>
                    储蓄率 {savingRateText}
                  </Text>
                </View>
              </Pressable>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldEntranceAnimate} index={4}>
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderFold}>
                <Text style={[styles.sectionEyebrow, { color: subtle }]}>Accounts / 账户</Text>
                <Pressable
                  onPress={() => router.push('/assets')}
                  style={({ pressed }) => [styles.sectionLink, pressed && { opacity: 0.8 }]}>
                  <Text style={[styles.sectionLinkTextFold, { color: subtle }]}>全部</Text>
                  <MaterialIcons name="chevron-right" size={14} color={subtle} />
                </Pressable>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.carousel}>
                {financeAccounts.length === 0 ? (
                  <Pressable
                    onPress={() => router.push('/add-account')}
                    style={({ pressed }) => [
                      styles.accountCardAdd,
                      { borderColor: isDark ? outlineVariant : '#CDBFA9' },
                      pressed && { opacity: 0.9 },
                    ]}>
                    <MaterialIcons name="add" size={18} color={subtle} />
                    <Text style={[styles.accountAddText, { color: subtle }]}>添加账户</Text>
                  </Pressable>
                ) : (
                  <>
                    {financeAccountsSortedByBalance.map((acc, accIdx) => {
                      const tone =
                        accIdx % 3 === 0
                          ? { bg: ff.budgetFrom, fg: ff.onPine, muted: 'rgba(247,240,226,0.72)' }
                          : accIdx % 3 === 1
                            ? { bg: '#C88947', fg: '#FFF8EC', muted: 'rgba(255,248,236,0.72)' }
                            : { bg: isDark ? '#3A433C' : '#E9DED0', fg: isDark ? ff.onPine : '#3D473F', muted: isDark ? 'rgba(247,240,226,0.65)' : 'rgba(61,71,63,0.65)' };
                      return (
                        <Pressable
                          key={acc.id}
                          onPress={() =>
                            router.push({
                              pathname: '/account-detail',
                              params: {
                                accountId: acc.id,
                                accountName: acc.name,
                                accountNo: acc.account_no ?? '',
                              },
                            })
                          }
                          style={({ pressed }) => [
                            styles.accountCardFold,
                            { backgroundColor: tone.bg },
                            pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                          ]}>
                          <View style={styles.accountTopFold}>
                            <Text style={[styles.accountNameFold, { color: tone.fg }]} numberOfLines={1}>
                              {isFinanceLiabilityAccount(acc)
                                ? acc.account_no
                                  ? `负债 · ${acc.name} · ${acc.account_no}`
                                  : `负债 · ${acc.name}`
                                : acc.account_no
                                  ? `${acc.name} · ${acc.account_no}`
                                  : acc.name}
                            </Text>
                            <MaterialIcons name={accountIcon(acc)} size={16} color={tone.muted} />
                          </View>
                          <Text
                            style={[
                              styles.accountBalFold,
                              { color: tone.fg, fontFamily: ffFonts.mono },
                            ]}>
                            {formatCurrencyBalanceForAccount(acc)}
                          </Text>
                          <View style={styles.accountFootFold}>
                            <Text style={[styles.accountFootText, { color: tone.muted }]}>
                              {isFinanceLiabilityAccount(acc) ? '负债' : '账户'}
                            </Text>
                            <Text style={[styles.accountFootText, { color: tone.muted }]}>
                              {acc.sign_rule === 'liability' ? '欠款' : '余额'}
                            </Text>
                          </View>
                        </Pressable>
                      );
                    })}
                    <Pressable
                      onPress={() => router.push('/add-account')}
                      style={({ pressed }) => [
                        styles.accountCardAdd,
                        { borderColor: isDark ? outlineVariant : '#CDBFA9' },
                        pressed && { opacity: 0.9 },
                      ]}>
                      <MaterialIcons name="add" size={18} color={subtle} />
                      <Text style={[styles.accountAddText, { color: subtle }]}>添加账户</Text>
                    </Pressable>
                  </>
                )}
              </ScrollView>
            </View>
          </FoldRiseIn>

          <FoldRiseIn animate={foldEntranceAnimate} index={5}>
            <View style={styles.sectionBlock}>
              <View style={styles.sectionHeaderFold}>
                <Text style={[styles.sectionEyebrow, { color: subtle }]}>Ledger / 今日流水</Text>
                <Text style={[styles.txnSwipeHint, { color: subtle }]}>左滑删除</Text>
              </View>
              <View style={styles.dayGroups}>
                <View style={styles.dayGroupFold}>
                  <View style={styles.ledgerGroupH}>
                    <Text style={[styles.ledgerGroupTitle, { color: text }]}>
                      {today.getMonth() + 1}月{today.getDate()}日 · 今天
                    </Text>
                    <Text style={[styles.ledgerGroupSum, { color: subtle, fontFamily: ffFonts.mono }]}>
                      支出 {formatCurrencyWithDecimals(todayExpenseTotal)}
                    </Text>
                  </View>
                  {todayDisplayTxns.length === 0 ? (
                    <View style={styles.dayGroupEmpty}>
                      <View style={[styles.emptyStateIconWrap, { backgroundColor: outlineVariant }]}>
                        <MaterialIcons name="event-note" size={18} color={subtle} />
                      </View>
                      <Text style={[styles.emptyStateTitle, { color: text }]}>今天暂无记录</Text>
                      <Text style={[styles.emptyStateSubTitle, { color: subtle }]}>
                        点右下角记一笔，开始第一笔
                      </Text>
                    </View>
                  ) : (
                    todayDisplayTxns.map((t, index) => {
                      const showDivider = index < todayDisplayTxns.length - 1;
                      const rowBody = (
                        <Animated.View
                          style={[
                            styles.txnSwipeForeground,
                            t.isPendingPlaceholder ? styles.txnSwipeForegroundPending : null,
                          ]}>
                          <TxnItem
                            themeText={text}
                            themeSubtle={subtle}
                            dividerColor={outlineVariant}
                            monoFont={ffFonts.mono}
                            item={t}
                            showDivider={showDivider && !t.isPendingPlaceholder}
                            onPress={
                              t.isPendingPlaceholder
                                ? undefined
                                : () => router.push(`/edit-finance-transaction/${t.id}`)
                            }
                          />
                        </Animated.View>
                      );

                      if (t.isPendingPlaceholder) {
                        return (
                          <React.Fragment key={t.id}>
                            {rowBody}
                            <Pressable
                              onPress={() => cancelPendingAutoLedger(t.id)}
                              style={({ pressed }) => [
                                styles.pendingAutoLedgerCancelBtn,
                                { borderColor: outlineVariant, backgroundColor: surface },
                                pressed && { opacity: 0.88 },
                              ]}
                              accessibilityRole="button"
                              accessibilityLabel="取消 AI 识别">
                              <Text style={[styles.pendingAutoLedgerCancelText, { color: subtle }]}>
                                取消识别
                              </Text>
                            </Pressable>
                            {showDivider ? (
                              <View style={[styles.txnRowDivider, { backgroundColor: outlineVariant }]} />
                            ) : null}
                          </React.Fragment>
                        );
                      }

                      return (
                        <Swipeable
                          key={t.id}
                          friction={2}
                          overshootRight={false}
                          rightThreshold={40}
                          childrenContainerStyle={{ backgroundColor: bg }}
                          renderRightActions={() => (
                            <View style={[styles.swipeDeleteTrack, { backgroundColor: ff.clay2 }]}>
                              <Pressable
                                onPress={() => handleDeleteFinanceTxn(t.id, t.title)}
                                style={({ pressed }) => [
                                  styles.swipeDeletePill,
                                  { backgroundColor: ff.clay },
                                  pressed && { opacity: 0.88 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`删除 ${t.title}`}>
                                <Text style={styles.swipeDeleteText}>删除</Text>
                              </Pressable>
                            </View>
                          )}>
                          {rowBody}
                        </Swipeable>
                      );
                    })
                  )}
                </View>

                {historySections.map((section) => {
                  const isYesterday = section.dayKey === calendarYesterdayYmd;
                  const dayTitle = isYesterday
                    ? `${section.date.getMonth() + 1}月${section.date.getDate()}日 · 昨天`
                    : `${section.date.getMonth() + 1}月${section.date.getDate()}日 · ${weekdayCn[section.date.getDay()]}`;
                  return (
                    <View key={section.dayKey} style={styles.dayGroupFold}>
                      <View style={styles.ledgerGroupH}>
                        <Text style={[styles.ledgerGroupTitle, { color: text }]}>{dayTitle}</Text>
                        <Text
                          style={[styles.ledgerGroupSum, { color: subtle, fontFamily: ffFonts.mono }]}>
                          支出 {formatCurrencyWithDecimals(section.expense)}
                        </Text>
                      </View>
                      {section.items.map((t, index) => (
                        <Swipeable
                          key={t.id}
                          friction={2}
                          overshootRight={false}
                          rightThreshold={40}
                          childrenContainerStyle={{ backgroundColor: bg }}
                          renderRightActions={() => (
                            <View style={[styles.swipeDeleteTrack, { backgroundColor: ff.clay2 }]}>
                              <Pressable
                                onPress={() => handleDeleteFinanceTxn(t.id, t.title)}
                                style={({ pressed }) => [
                                  styles.swipeDeletePill,
                                  { backgroundColor: ff.clay },
                                  pressed && { opacity: 0.88 },
                                ]}
                                accessibilityRole="button"
                                accessibilityLabel={`删除 ${t.title}`}>
                                <Text style={styles.swipeDeleteText}>删除</Text>
                              </Pressable>
                            </View>
                          )}>
                          <Animated.View style={styles.txnSwipeForeground}>
                            <TxnItem
                              themeText={text}
                              themeSubtle={subtle}
                              dividerColor={outlineVariant}
                              monoFont={ffFonts.mono}
                              item={t}
                              showDivider={index < section.items.length - 1}
                              onPress={() => router.push(`/edit-finance-transaction/${t.id}`)}
                            />
                          </Animated.View>
                        </Swipeable>
                      ))}
                    </View>
                  );
                })}

                {displayTxns.length > 0 && isLoadingMoreDays ? (
                  <View style={styles.loadMoreRow}>
                    <ActivityIndicator size="small" color={primarySoft} />
                    <Text style={[styles.loadMoreText, { color: subtle }]}>正在加载更早的流水</Text>
                  </View>
                ) : null}
                {displayTxns.length > 0 && !hasMoreHistoryDays ? (
                  <Text style={[styles.loadMoreText, { color: subtle }]}>没有更早记录了</Text>
                ) : null}
              </View>
            </View>
          </FoldRiseIn>

          </View>
            </Animated.View>
          ) : null}

          {showFinanceSkeleton ? (
            <HomeSkeletonShell
              pending={initialFinanceLoadPending}
              mounted={financeSkeletonMounted}
              opacity={financeSkeletonOpacity}
              backgroundColor={bg}
            >
              <View style={styles.sectionStack}>
                <FinanceBudgetCardSkeleton
                  colors={{ surface, outline: outlineStrong, cardBg: surface }}
                />
                <View style={[styles.sectionPanel, { backgroundColor: surface, borderColor: outlineStrong }, Shadows.card]}>
                  <FinanceAccountCarouselSkeleton colors={{ surface: surfaceSubtle, outline: outlineVariant, cardBg: surfaceSubtle }} />
                </View>
                <View style={[styles.sectionPanel, { backgroundColor: surface, borderColor: outlineStrong }, Shadows.card]}>
                  <FinanceTxnListSkeleton colors={{ surface: surfaceSubtle, outline: outlineVariant, cardBg: surfaceSubtle }} />
                </View>
              </View>
            </HomeSkeletonShell>
          ) : null}
          </View>
        </View>
      </ScrollView>

      <Animated.View
        style={[
          styles.recordFabWrap,
          { bottom: baseBottomAnim, opacity: !hasAccounts ? 0.78 : 1 },
        ]}
        pointerEvents="box-none">
        <Pressable
          onPress={() => {
            void handleOpenComposer();
          }}
          onLongPress={() => {
            void handlePickImage('library');
          }}
          delayLongPress={380}
          style={({ pressed }) => [
            styles.recordFab,
            {
              backgroundColor: ff.budgetFrom,
              borderColor: 'rgba(255,255,255,0.09)',
              transform: [{ scale: pressed ? 0.97 : 1 }],
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="记一笔"
          accessibilityHint="长按可从相册识图记账">
          <View style={styles.recordFabPlus}>
            <MaterialIcons name="add" size={16} color={ff.onPine} />
          </View>
          <Text style={[styles.recordFabText, { color: ff.onPine }]}>记一笔</Text>
        </Pressable>
      </Animated.View>

'''

text2 = text[:start] + new_block + text[end:]
p.write_text(text2, encoding="utf-8")
print("replaced", end - start, "->", len(new_block))
print("ok")
