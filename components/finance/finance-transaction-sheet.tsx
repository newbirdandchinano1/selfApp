import { FinanceCategoryPicker } from '@/components/finance/finance-category-picker';
import {
  FinanceFoldAlbumScanPanel,
  FinanceFoldExpenseIncomePanel,
  FinanceFoldPhrasePanel,
  FinanceFoldSegment,
  FinanceFoldSheetChrome,
  FinanceFoldSheetHead,
  FinanceFoldTransferPanel,
  type FinanceAlbumScanResult,
  type FinanceFoldParsePill,
} from '@/components/finance/finance-fold-record-sheet';
import { useFinanceFoldTheme } from '@/constants/finance-fold-theme';
import { parseStoredDatetime } from '@/lib/api-mysql-datetime';
import { toast, toUserMessage } from '@/lib/app-feedback';
import { makeTimestampEntityId } from '@/lib/entity-id';
import { resolveHappenedAtForBillLedger } from '@/lib/finance-bill-happened-at';
import {
  getCachedFinanceLastUsedAccountId,
  sanitizeFinanceLastUsedAccountId,
} from '@/lib/finance-last-used-account';
import {
  notifyFinanceSheetSaved,
  subscribeFinanceSheetOpen,
  useFinanceTransactionSheetController,
  type FinanceSheetLaunchIntent,
  type FinanceTransactionSheetController,
} from '@/lib/finance-transaction-sheet/controller';
import { pickSheetCategoryForParsed } from '@/lib/finance-transaction-sheet/helpers';
import {
  createFinanceTransaction,
  financeSignedAmountForSave,
  validateFinanceTransactionBeforeSave,
} from '@/lib/repositories/finance/finance';
import { budgetExtraPatchForTransaction } from '@/lib/repositories/finance/finance-transaction-extra';
import {
  getActiveAiLlmApiKey,
  parseFinanceOneLinerFromImage,
} from '@/lib/zhipu-image-parse';
import { MaterialIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';

const AUTO_LEDGER_NOT_BILL_MESSAGE =
  '这不是账单或支付凭证截图，请换一张支付成功页、账单详情或小票等图片。';

type AlbumScanPhase = 'off' | 'scanning' | 'result' | 'error';

/** 相册识图结果时间片：`10.23 12:18` */
function formatAlbumHappenedLabel(at: Date): string {
  const mm = at.getMonth() + 1;
  const dd = String(at.getDate()).padStart(2, '0');
  const hh = String(at.getHours()).padStart(2, '0');
  const mi = String(at.getMinutes()).padStart(2, '0');
  return `${mm}.${dd} ${hh}:${mi}`;
}

function FinanceTransactionSheetBody({ c }: { c: FinanceTransactionSheetController }) {
  const { ff, isDark: foldDark, fonts: ffFonts } = useFinanceFoldTheme();
  const {
    styles,
    insets,
    isDark,
    surface,
    text,
    subtle,
    outlineVariant,
    primary,
    closeSheet,
    sheetKeyboardInset,
    sheetModalMaxHeight,
    sheetModalBodyMaxHeight,
    activeSheetTab,
    setActiveSheetTab,
    switchSheetTab,
    transferFromAccount,
    transferToAccount,
    transferFromAccountId,
    transferToAccountId,
    transferPairMeta,
    setTransferFromAccountId,
    setTransferToAccountId,
    transferAmountTarget,
    setTransferAmountTarget,
    transferFeeDisplay,
    setIsDatePickerVisible,
    setIsTimePickerVisible,
    setIsAccountPickerVisible,
    setAccountPickerTarget,
    accountIcon,
    amountDisplay,
    sheetDateLabel,
    sheetTimeLabel,
    sheetNote,
    setSheetNote,
    isDatePickerVisible,
    isTimePickerVisible,
    selectedHappenedAt,
    handleAmountKeyPress,
    handleSaveTransaction,
    canSaveTransaction,
    isSavingTransaction,
    activeCategories,
    expenseCategories,
    incomeCategories,
    selectedCategoryKey,
    setSelectedCategoryKey,
    setSelectedAccountId,
    pickAccountForAutoLedger,
    openAddCategoryModal,
    closeAddCategoryModal,
    saveNewCategory,
    confirmDeleteCustomCategory,
    addModalVisible,
    newCategoryName,
    setNewCategoryName,
    newCategoryIcon,
    setNewCategoryIcon,
    isSavingCategory,
    zhipuTxnReady,
    sheetSentence,
    setSheetSentence,
    sentenceLedgerPreview,
    setSentenceLedgerPreview,
    isSentencePreviewBusy,
    handleSentenceLedgerPreview,
    canSaveSentence,
    isParsingSentence,
    sheetIncludeInBudget,
    applySheetIncludeInBudget,
    sheetIncludeInBudgetRef,
    selectedAccount,
    sheetImageUris,
    setSheetImageUris,
    handleDatePickerChange,
    handleTimePickerChange,
    isAccountPickerVisible,
    accountPickerTarget,
    financeAccounts,
    handleSelectAccount,
    formatCurrencyBalanceForAccount,
    keypadRows,
    setSelectedHappenedAt,
    setSheetAmount,
    loadFinanceAccounts,
  } = c;

  const [albumScanPhase, setAlbumScanPhase] = React.useState<AlbumScanPhase>('off');
  const [albumImageUri, setAlbumImageUri] = React.useState<string | null>(null);
  const [albumScanError, setAlbumScanError] = React.useState<string | null>(null);
  const [albumScanResult, setAlbumScanResult] = React.useState<FinanceAlbumScanResult | null>(null);
  const [albumParsePayload, setAlbumParsePayload] = React.useState<null | {
    transaction_type: 'expense' | 'income';
    amount: number;
    name: string;
    category_key: string;
    category_label: string;
    account_id: string;
    account_name: string;
    happened_at: string;
    imageDataUri: string;
  }>(null);
  const [albumConfirming, setAlbumConfirming] = React.useState(false);
  const [isPickingImage, setIsPickingImage] = React.useState(false);
  const albumScanGenerationRef = React.useRef(0);

  const resetAlbumScanState = React.useCallback(() => {
    albumScanGenerationRef.current += 1;
    setAlbumScanPhase('off');
    setAlbumImageUri(null);
    setAlbumScanError(null);
    setAlbumScanResult(null);
    setAlbumParsePayload(null);
    setAlbumConfirming(false);
  }, []);

  const guardedCloseSheet = React.useCallback(() => {
    if (albumConfirming) return;
    resetAlbumScanState();
    closeSheet();
  }, [albumConfirming, closeSheet, resetAlbumScanState]);

  const openAlbumScanFlow = React.useCallback(async () => {
    if (isPickingImage || albumConfirming || albumScanPhase === 'scanning') return;
    if (!financeAccounts.length) {
      toast.warn('当前还没有可用账户，请先前往资产页添加账户后再记账。');
      return;
    }

    const gen = ++albumScanGenerationRef.current;
    const isStale = () => gen !== albumScanGenerationRef.current;

    setIsDatePickerVisible(false);
    setIsTimePickerVisible(false);
    setIsAccountPickerVisible(false);
    setIsPickingImage(true);

    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (isStale()) return;
      if (!permission.granted) {
        toast.warn('需要相册权限才能选择图片。');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: false,
        quality: 0.85,
        base64: true,
      });

      if (isStale()) return;
      if (result.canceled) return;

      const asset = result.assets[0];
      const b64 = asset?.base64;
      if (!b64) {
        toast.error('未能获取图片数据，请换一张图片重试。');
        return;
      }

      const mime = asset.mimeType?.trim() || 'image/jpeg';
      const imageDataUri = `data:${mime};base64,${b64}`;
      setAlbumScanError(null);
      setAlbumScanResult(null);
      setAlbumParsePayload(null);
      setAlbumImageUri(imageDataUri);
      setAlbumScanPhase('scanning');

      const key = getActiveAiLlmApiKey().trim();
      if (!key) {
        setAlbumScanPhase('error');
        setAlbumScanError('未配置 AI 密钥，无法识图。');
        return;
      }

      const accountHints = financeAccounts.map((a) => ({ name: a.name, account_no: a.account_no }));
      const resolved = await parseFinanceOneLinerFromImage({
        apiKey: key,
        imageDataUri,
        accounts: accountHints,
        maxAttempts: 2,
        retryDelayMs: 800,
      });

      if (isStale()) return;

      if (!resolved.ok) {
        setAlbumScanPhase('error');
        setAlbumScanError(
          resolved.notBill ? AUTO_LEDGER_NOT_BILL_MESSAGE : resolved.error || '未能识别出有效账单。',
        );
        return;
      }

      const lastUsedAccountId = sanitizeFinanceLastUsedAccountId(
        getCachedFinanceLastUsedAccountId(),
        financeAccounts,
      );
      const account = pickAccountForAutoLedger(
        financeAccounts,
        {
          transaction_type: resolved.transaction_type,
          account_name: resolved.account_name,
          payment_account_label: resolved.payment_account_label,
        },
        lastUsedAccountId,
      );
      if (!account) {
        setAlbumScanPhase('error');
        setAlbumScanError('请先添加至少一个账户。');
        return;
      }

      const cat = pickSheetCategoryForParsed(
        resolved.transaction_type,
        resolved.category_label,
        expenseCategories,
        incomeCategories,
      );
      const { iso: happenedAtIso } = resolveHappenedAtForBillLedger(resolved.happened_at);
      const happenedAtDate = parseStoredDatetime(happenedAtIso);
      const happenedLabel = formatAlbumHappenedLabel(
        Number.isNaN(happenedAtDate.getTime()) ? new Date() : happenedAtDate,
      );

      setAlbumScanResult({
        transaction_type: resolved.transaction_type,
        amount: resolved.amount,
        name: resolved.name,
        categoryLabel: cat.label,
        accountName: account.name,
        happenedLabel,
        confidenceLabel: '置信度 高',
      });
      setAlbumParsePayload({
        transaction_type: resolved.transaction_type,
        amount: resolved.amount,
        name: resolved.name,
        category_key: cat.key,
        category_label: cat.label,
        account_id: account.id,
        account_name: account.name,
        happened_at: happenedAtIso,
        imageDataUri,
      });
      setAlbumScanPhase('result');
    } catch (error) {
      if (isStale()) return;
      console.warn('Global sheet album scan failed:', error);
      setAlbumScanPhase('error');
      setAlbumScanError(toUserMessage(error, '识图失败，请稍后重试。'));
    } finally {
      setIsPickingImage(false);
    }
  }, [
    albumConfirming,
    albumScanPhase,
    expenseCategories,
    financeAccounts,
    incomeCategories,
    isPickingImage,
    pickAccountForAutoLedger,
    resetAlbumScanState,
    setIsAccountPickerVisible,
    setIsDatePickerVisible,
    setIsTimePickerVisible,
  ]);

  const confirmAlbumScan = React.useCallback(async () => {
    if (albumConfirming || !albumParsePayload) return;
    const payload = albumParsePayload;
    const account = financeAccounts.find((a) => a.id === payload.account_id);
    if (!account) {
      toast.warn('账户已失效，请重新识图或手动记账。');
      return;
    }

    const signedAmount = financeSignedAmountForSave(account.sign_rule, account.account_type, payload.amount);
    const boundsErr = await validateFinanceTransactionBeforeSave({
      accountId: account.id,
      transactionType: payload.transaction_type,
      amount: signedAmount,
      extraData: null,
      accountName: account.name,
      uiLedgerBalance: account.balance,
    });
    if (boundsErr) {
      toast.warn(boundsErr);
      return;
    }

    setAlbumConfirming(true);
    try {
      const txnId = makeTimestampEntityId('ft_', 8);
      await createFinanceTransaction(
        {
          id: txnId,
          name: payload.name,
          happened_at: payload.happened_at,
          account_id: account.id,
          transaction_type: payload.transaction_type,
          amount: signedAmount,
          note: `图片记账 · ${payload.name}`,
          extra_data: JSON.stringify({
            manual: true,
            sentence: true,
            parse_source: 'ai',
            from_picker_image: true,
            from_album_scan_sheet: true,
            category_key: payload.category_key,
            category_label: payload.category_label,
            matched_account_name: payload.account_name,
            attachments: [{ type: 'image', uri: payload.imageDataUri }],
            ...budgetExtraPatchForTransaction(payload.transaction_type, sheetIncludeInBudgetRef.current),
          }),
        },
        { skipBalanceRecheck: true },
      );
      await loadFinanceAccounts();
      resetAlbumScanState();
      notifyFinanceSheetSaved();
      closeSheet();
      toast.success('已记账');
    } catch (error) {
      console.warn('Confirm album scan failed:', error);
      toast.error(toUserMessage(error, '入账失败，请稍后重试。'));
    } finally {
      setAlbumConfirming(false);
    }
  }, [
    albumConfirming,
    albumParsePayload,
    closeSheet,
    financeAccounts,
    loadFinanceAccounts,
    resetAlbumScanState,
    sheetIncludeInBudgetRef,
  ]);

  const applyAlbumScanToForm = React.useCallback(() => {
    if (!albumParsePayload) {
      resetAlbumScanState();
      return;
    }
    const p = albumParsePayload;
    setActiveSheetTab(p.transaction_type);
    setSheetAmount(String(p.amount));
    setSheetSentence(`${p.name} ${p.amount}`);
    setSheetNote(p.name);
    setSelectedCategoryKey(p.category_key);
    setSelectedAccountId(p.account_id);
    const happened = parseStoredDatetime(p.happened_at);
    setSelectedHappenedAt(Number.isNaN(happened.getTime()) ? new Date() : happened);
    setSheetImageUris([p.imageDataUri]);
    setSentenceLedgerPreview(null);
    setAlbumScanPhase('off');
    setAlbumScanError(null);
    setAlbumScanResult(null);
    setAlbumParsePayload(null);
    setAlbumConfirming(false);
  }, [
    albumParsePayload,
    resetAlbumScanState,
    setActiveSheetTab,
    setSelectedAccountId,
    setSelectedCategoryKey,
    setSelectedHappenedAt,
    setSentenceLedgerPreview,
    setSheetAmount,
    setSheetImageUris,
    setSheetNote,
    setSheetSentence,
  ]);

  const sentenceFoldPills = React.useMemo((): FinanceFoldParsePill[] => {
    if (sentenceLedgerPreview?.kind !== 'ok') return [];
    const typeLabel = sentenceLedgerPreview.transaction_type === 'income' ? '收入' : '支出';
    const pills: FinanceFoldParsePill[] = [
      {
        key: 'amt',
        label: `${typeLabel} ¥${sentenceLedgerPreview.amount.toFixed(2)}`,
        emphasize: true,
      },
      { key: 'cat', label: sentenceLedgerPreview.categoryLabel },
    ];
    if (selectedAccount?.name) {
      pills.push({ key: 'acc', label: selectedAccount.name, amber: true });
    }
    pills.push({ key: 'time', label: formatAlbumHappenedLabel(selectedHappenedAt) });
    return pills;
  }, [selectedAccount?.name, selectedHappenedAt, sentenceLedgerPreview]);

  const sentenceAiLine = React.useMemo(() => {
    if (sentenceLedgerPreview?.kind === 'error') return sentenceLedgerPreview.message;
    if (sentenceLedgerPreview?.kind === 'ok') {
      return sentenceLedgerPreview.source === 'ai'
        ? `智谱已识别：${sentenceLedgerPreview.name}`
        : `本地规则：${sentenceLedgerPreview.name}`;
    }
    return zhipuTxnReady
      ? '说一句日常消费，AI 会帮你拆成金额、分类与账户'
      : '未检测到 AI：仅本地规则（需句中含阿拉伯数字金额）';
  }, [sentenceLedgerPreview, zhipuTxnReady]);

  const foldTransferLabel =
    transferPairMeta.mode === 'repay'
      ? '还款'
      : transferPairMeta.mode === 'draw'
        ? '取款'
        : '转账';

  const softSurface = ff.paper2;
  const accent = ff.pine;

  if (albumScanPhase !== 'off') {
    return (
      <FinanceFoldSheetChrome
        ff={ff}
        isDark={foldDark}
        paddingBottom={sheetKeyboardInset > 0 ? 0 : Math.max(16, insets.bottom)}
        maxHeight={sheetModalMaxHeight}
        marginBottom={sheetKeyboardInset}
        onClose={guardedCloseSheet}>
        <ScrollView
          style={[styles.sheetBodyScroll, { maxHeight: sheetModalBodyMaxHeight }]}
          contentContainerStyle={styles.sheetBodyScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator
          nestedScrollEnabled
          bounces>
          <FinanceFoldAlbumScanPanel
            ff={ff}
            fonts={ffFonts}
            imageUri={albumImageUri}
            scanning={albumScanPhase === 'scanning'}
            result={albumScanResult}
            error={albumScanError}
            includeInBudget={sheetIncludeInBudget}
            onToggleBudget={() => applySheetIncludeInBudget((prev) => !prev)}
            onConfirm={() => void confirmAlbumScan()}
            onCorrect={applyAlbumScanToForm}
            onClose={() => {
              if (!albumConfirming) resetAlbumScanState();
            }}
            confirming={albumConfirming}
          />
        </ScrollView>
      </FinanceFoldSheetChrome>
    );
  }

  return (
    <FinanceFoldSheetChrome
      ff={ff}
      isDark={foldDark}
      paddingBottom={sheetKeyboardInset > 0 ? 0 : Math.max(16, insets.bottom)}
      maxHeight={sheetModalMaxHeight}
      marginBottom={sheetKeyboardInset}
      onClose={guardedCloseSheet}>
      <FinanceFoldSheetHead
        ff={ff}
        fonts={ffFonts}
        title="记一笔"
        subtitle="说一句、拍一张，剩下的交给账本。"
        onClose={guardedCloseSheet}
      />
      <FinanceFoldSegment
        ff={ff}
        active={activeSheetTab}
        onChange={switchSheetTab}
        transferLabel={foldTransferLabel}
      />

      <ScrollView
        style={[styles.sheetBodyScroll, { maxHeight: sheetModalBodyMaxHeight }]}
        contentContainerStyle={
          sheetKeyboardInset > 0
            ? [styles.sheetBodyScrollContent, styles.sheetBodyScrollContentKeyboardOpen]
            : styles.sheetBodyScrollContent
        }
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
        nestedScrollEnabled
        bounces>
        {activeSheetTab === 'transfer' ? (
          <FinanceFoldTransferPanel
            ff={ff}
            fonts={ffFonts}
            amountDisplay={amountDisplay}
            feeDisplay={transferFeeDisplay}
            amountTarget={transferAmountTarget}
            onFocusAmount={() => setTransferAmountTarget('amount')}
            onFocusFee={() => setTransferAmountTarget('fee')}
            fromLabel={transferPairMeta.fromLabel}
            toLabel={transferPairMeta.toLabel}
            fromName={transferFromAccount?.name ?? '选择账户'}
            toName={transferToAccount?.name ?? '选择账户'}
            onPressFrom={() => {
              setIsDatePickerVisible(false);
              setIsTimePickerVisible(false);
              setAccountPickerTarget('transferFrom');
              setIsAccountPickerVisible(true);
            }}
            onPressTo={() => {
              setIsDatePickerVisible(false);
              setIsTimePickerVisible(false);
              setAccountPickerTarget('transferTo');
              setIsAccountPickerVisible(true);
            }}
            onSwap={() => {
              setTransferFromAccountId(transferToAccountId);
              setTransferToAccountId(transferFromAccountId);
            }}
            hint={
              transferFromAccount && transferToAccount
                ? transferFromAccount.id === transferToAccount.id
                  ? '请选择两个不同的账户。'
                  : transferPairMeta.hint
                : null
            }
            note={sheetNote}
            onChangeNote={setSheetNote}
            timeLabel={`${sheetDateLabel} ${sheetTimeLabel}`}
            onPressTime={() => {
              setIsAccountPickerVisible(false);
              setIsTimePickerVisible(false);
              setIsDatePickerVisible(true);
            }}
            canSave={canSaveTransaction}
            isSaving={isSavingTransaction}
            onSave={() => void handleSaveTransaction()}
            keypadKeys={keypadRows.flat()}
            onKeypadKey={handleAmountKeyPress}
          />
        ) : activeSheetTab === 'sentence' ? (
          <>
            <View style={[styles.sheetConfigRow, { marginBottom: 10 }]}>
              <Pressable
                onPress={() => {
                  setIsTimePickerVisible(false);
                  setIsAccountPickerVisible(false);
                  setIsDatePickerVisible(true);
                }}
                style={[styles.configChip, { backgroundColor: softSurface, borderColor: ff.line }]}>
                <MaterialIcons name="calendar-today" size={16} color={ff.muted} />
                <Text style={[styles.configChipText, { color: ff.ink }]}>{sheetDateLabel}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setIsTimePickerVisible(false);
                  setIsAccountPickerVisible(false);
                  setIsDatePickerVisible(true);
                }}
                style={({ pressed }) => [
                  styles.configChip,
                  { backgroundColor: softSurface, borderColor: ff.line },
                  pressed ? { opacity: 0.8 } : null,
                ]}>
                <MaterialIcons name="schedule" size={16} color={ff.muted} />
                <Text style={[styles.configChipText, { color: ff.ink }]}>{sheetTimeLabel}</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setIsDatePickerVisible(false);
                  setIsTimePickerVisible(false);
                  setIsAccountPickerVisible((prev) => {
                    if (!prev) setAccountPickerTarget('sheet');
                    return !prev;
                  });
                }}
                style={({ pressed }) => [
                  styles.configChip,
                  { backgroundColor: softSurface, borderColor: ff.line },
                  pressed ? { opacity: 0.8 } : null,
                ]}>
                <MaterialIcons name="account-balance-wallet" size={16} color={accent} />
                <Text style={[styles.configChipText, { color: ff.ink }]}>
                  {selectedAccount?.name ?? '支付账户'}
                </Text>
                <MaterialIcons name="expand-more" size={16} color={ff.muted} />
              </Pressable>
            </View>
            <FinanceFoldPhrasePanel
              ff={ff}
              fonts={ffFonts}
              sentence={sheetSentence}
              onChangeSentence={setSheetSentence}
              pills={sentenceFoldPills}
              aiLine={sentenceAiLine}
              includeInBudget={sheetIncludeInBudget}
              onToggleBudget={() => applySheetIncludeInBudget((prev) => !prev)}
              budgetDetail="占用本月"
              canSave={canSaveSentence}
              isSaving={isParsingSentence}
              onPreview={() => void handleSentenceLedgerPreview()}
              isPreviewBusy={isSentencePreviewBusy}
              onConfirm={() => void handleSaveTransaction()}
              onOpenAlbum={() => void openAlbumScanFlow()}
              quickTags={['午餐', '打车', '咖啡', '工资']}
              onQuickTag={(tag) =>
                setSheetSentence((prev) => {
                  const t = prev.trim();
                  return t ? `${t} ${tag}` : tag;
                })
              }
            />
          </>
        ) : (
          <>
            <FinanceFoldExpenseIncomePanel
              ff={ff}
              fonts={ffFonts}
              mode={activeSheetTab === 'income' ? 'income' : 'expense'}
              amountDisplay={amountDisplay}
              amountFocused
              onFocusAmount={() => {}}
              categories={activeCategories.map((cat) => ({
                key: cat.key,
                label: cat.label,
                isCustom: cat.isCustom,
              }))}
              selectedCategoryKey={selectedCategoryKey}
              onSelectCategory={setSelectedCategoryKey}
              onAddCategory={() =>
                openAddCategoryModal(activeSheetTab === 'income' ? 'income' : 'expense')
              }
              onLongPressCustomCategory={(item) => {
                const cat = activeCategories.find((c) => c.key === item.key);
                if (cat) confirmDeleteCustomCategory(cat);
              }}
              accountLabel={selectedAccount?.name ?? '选择账户'}
              onPressAccount={() => {
                setIsDatePickerVisible(false);
                setIsTimePickerVisible(false);
                setIsAccountPickerVisible((prev) => {
                  if (!prev) setAccountPickerTarget('sheet');
                  return !prev;
                });
              }}
              timeLabel={`${sheetDateLabel} ${sheetTimeLabel}`}
              onPressTime={() => {
                setIsTimePickerVisible(false);
                setIsAccountPickerVisible(false);
                setIsDatePickerVisible(true);
              }}
              title={sheetNote}
              onChangeTitle={setSheetNote}
              includeInBudget={sheetIncludeInBudget}
              onToggleBudget={() => applySheetIncludeInBudget((prev) => !prev)}
              imageUris={sheetImageUris}
              onRemoveImage={(idx) =>
                setSheetImageUris((prev) => prev.filter((_, i) => i !== idx))
              }
              onPressImage={() => void openAlbumScanFlow()}
              canSave={canSaveTransaction}
              isSaving={isSavingTransaction}
              onSave={() => void handleSaveTransaction()}
              keypadKeys={keypadRows.flat()}
              onKeypadKey={handleAmountKeyPress}
            />
            <View style={{ height: 0, overflow: 'hidden', opacity: 0 }} pointerEvents="none">
              <FinanceCategoryPicker
                categories={activeCategories}
                selectedKey={selectedCategoryKey}
                onSelectKey={setSelectedCategoryKey}
                transactionType={activeSheetTab === 'income' ? 'income' : 'expense'}
                singleRowCollapsed
                subtle={subtle}
                primary={primary}
                text={text}
                surface={surface}
                outlineVariant={outlineVariant}
                styles={styles}
                onAddPress={() => openAddCategoryModal(activeSheetTab === 'income' ? 'income' : 'expense')}
                onLongPressCustom={confirmDeleteCustomCategory}
                addModalVisible={addModalVisible}
                newCategoryName={newCategoryName}
                onChangeNewCategoryName={setNewCategoryName}
                newCategoryIcon={newCategoryIcon}
                onChangeNewCategoryIcon={setNewCategoryIcon}
                isSavingCategory={isSavingCategory}
                onCloseAddModal={closeAddCategoryModal}
                onSaveNewCategory={() => void saveNewCategory(setSelectedCategoryKey)}
              />
            </View>
          </>
        )}
      </ScrollView>

      <Modal
        visible={isDatePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsDatePickerVisible(false)}>
        <View style={styles.pickerModalOverlay}>
          <Pressable style={styles.pickerModalBackdrop} onPress={() => setIsDatePickerVisible(false)} />
          <View
            style={[
              styles.pickerModalCard,
              { backgroundColor: ff.card, borderColor: ff.line, shadowColor: foldDark ? '#000' : '#0f172a' },
            ]}>
            <View style={[styles.pickerModalHeader, { borderBottomColor: ff.line }]}>
              <Text style={[styles.pickerModalTitle, { color: ff.ink }]}>选择日期</Text>
              <Pressable onPress={() => setIsDatePickerVisible(false)} style={styles.pickerModalCloseBtn}>
                <MaterialIcons name="close" size={22} color={ff.muted} />
              </Pressable>
            </View>
            <View style={styles.pickerModalBody}>
              <DateTimePicker
                value={selectedHappenedAt}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                locale="zh-CN"
                themeVariant={foldDark ? 'dark' : 'light'}
                onChange={handleDatePickerChange}
                style={styles.nativePicker}
              />
              <View style={styles.pickerModalFooter}>
                <Pressable
                  onPress={() => setSelectedHappenedAt(new Date())}
                  style={[styles.pickerModalAction, { borderColor: ff.line, backgroundColor: ff.cardSoft }]}>
                  <Text style={[styles.pickerModalActionText, { color: ff.ink }]}>今天</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setIsDatePickerVisible(false);
                    setIsTimePickerVisible(true);
                  }}
                  style={[styles.pickerModalAction, { borderColor: ff.pine, backgroundColor: ff.pine }]}>
                  <Text style={styles.pickerModalPrimaryText}>确定</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={isTimePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsTimePickerVisible(false)}>
        <View style={styles.pickerModalOverlay}>
          <Pressable style={styles.pickerModalBackdrop} onPress={() => setIsTimePickerVisible(false)} />
          <View
            style={[
              styles.pickerModalCard,
              { backgroundColor: ff.card, borderColor: ff.line, shadowColor: foldDark ? '#000' : '#0f172a' },
            ]}>
            <View style={[styles.pickerModalHeader, { borderBottomColor: ff.line }]}>
              <Text style={[styles.pickerModalTitle, { color: ff.ink }]}>选择时间</Text>
              <Pressable onPress={() => setIsTimePickerVisible(false)} style={styles.pickerModalCloseBtn}>
                <MaterialIcons name="close" size={22} color={ff.muted} />
              </Pressable>
            </View>
            <View style={styles.pickerModalBody}>
              <DateTimePicker
                value={selectedHappenedAt}
                mode="time"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                locale="zh-CN"
                themeVariant={foldDark ? 'dark' : 'light'}
                onChange={handleTimePickerChange}
                style={styles.nativePicker}
              />
              <View style={styles.pickerModalFooter}>
                <Pressable
                  onPress={() => setSelectedHappenedAt(new Date())}
                  style={[styles.pickerModalAction, { borderColor: ff.line, backgroundColor: ff.cardSoft }]}>
                  <Text style={[styles.pickerModalActionText, { color: ff.ink }]}>现在</Text>
                </Pressable>
                <Pressable
                  onPress={() => setIsTimePickerVisible(false)}
                  style={[styles.pickerModalAction, { borderColor: ff.pine, backgroundColor: ff.pine }]}>
                  <Text style={styles.pickerModalPrimaryText}>确定</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={isAccountPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setIsAccountPickerVisible(false);
          setAccountPickerTarget('sheet');
        }}>
        <View style={styles.pickerModalOverlay}>
          <Pressable
            style={styles.pickerModalBackdrop}
            onPress={() => {
              setIsAccountPickerVisible(false);
              setAccountPickerTarget('sheet');
            }}
          />
          <View
            style={[
              styles.pickerModalCard,
              { backgroundColor: surface, borderColor: outlineVariant, shadowColor: isDark ? '#000' : '#0f172a' },
            ]}>
            <View style={[styles.pickerModalHeader, { borderBottomColor: outlineVariant }]}>
              <Text style={[styles.pickerModalTitle, { color: text }]}>
                {accountPickerTarget === 'transferFrom'
                  ? `选择${transferPairMeta.fromLabel}`
                  : accountPickerTarget === 'transferTo'
                    ? `选择${transferPairMeta.toLabel}`
                    : '选择账户'}
              </Text>
              <Pressable
                onPress={() => {
                  setIsAccountPickerVisible(false);
                  setAccountPickerTarget('sheet');
                }}
                style={styles.pickerModalCloseBtn}>
                <MaterialIcons name="close" size={22} color={subtle} />
              </Pressable>
            </View>
            <View style={styles.pickerModalBody}>
              <ScrollView
                style={styles.accountPickerScroll}
                contentContainerStyle={styles.accountPickerList}
                showsVerticalScrollIndicator={false}>
                {financeAccounts.map((account) => {
                  const selected =
                    accountPickerTarget === 'transferFrom'
                      ? account.id === transferFromAccountId
                      : accountPickerTarget === 'transferTo'
                        ? account.id === transferToAccountId
                        : account.id === selectedAccount?.id;
                  const transferPickBlocked =
                    (accountPickerTarget === 'transferFrom' && account.id === transferToAccountId) ||
                    (accountPickerTarget === 'transferTo' && account.id === transferFromAccountId);
                  return (
                    <Pressable
                      key={account.id}
                      disabled={transferPickBlocked}
                      onPress={() => handleSelectAccount(account.id)}
                      style={({ pressed }) => [
                        styles.accountPickerItem,
                        {
                          backgroundColor: selected ? `${accent}18` : softSurface,
                          borderColor: selected ? accent : ff.line,
                        },
                        transferPickBlocked ? { opacity: 0.45 } : null,
                        pressed && !transferPickBlocked ? { opacity: 0.84 } : null,
                      ]}>
                      <MaterialIcons name={accountIcon(account)} size={18} color={selected ? accent : subtle} />
                      <View style={styles.accountPickerTextCol}>
                        <Text style={[styles.accountPickerName, { color: text }]}>{account.name}</Text>
                        <Text style={[styles.accountPickerBalance, { color: subtle }]}>
                          {formatCurrencyBalanceForAccount(account)}
                        </Text>
                      </View>
                      {selected ? <MaterialIcons name="check" size={18} color={accent} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </View>
      </Modal>
    </FinanceFoldSheetChrome>
  );
}

function FinanceTransactionSheetModal({
  visible,
  launchIntent,
  onClose,
}: {
  visible: boolean;
  launchIntent: FinanceSheetLaunchIntent | null;
  onClose: () => void;
}) {
  const controller = useFinanceTransactionSheetController({
    visible,
    launchIntent,
    onClose,
    onSaved: onClose,
  });

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={controller.closeSheet}>
      <FinanceTransactionSheetBody c={controller} />
    </Modal>
  );
}

/**
 * 全局记账 Bottom Sheet：订阅 openFinanceSheet，自管可见性与 Modal。
 * 与 controller 组成两层：本视图 + `@/lib/finance-transaction-sheet/controller`。
 */
export function FinanceTransactionSheet() {
  const [visible, setVisible] = React.useState(false);
  const [launchIntent, setLaunchIntent] = React.useState<FinanceSheetLaunchIntent | null>(null);

  React.useEffect(() => {
    return subscribeFinanceSheetOpen((intent) => {
      setLaunchIntent(intent);
      setVisible(true);
    });
  }, []);

  const handleClose = React.useCallback(() => {
    setVisible(false);
    setLaunchIntent(null);
  }, []);

  if (!visible) return null;

  return (
    <FinanceTransactionSheetModal
      visible={visible}
      launchIntent={launchIntent}
      onClose={handleClose}
    />
  );
}
