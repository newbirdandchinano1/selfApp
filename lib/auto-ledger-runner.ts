import { makeTimestampEntityId } from '@/lib/entity-id';
import { shouldSkipDuplicateAutoLedgerImage } from '@/lib/auto-ledger-dedupe';
import { readClipboardImageForAutoLedger } from '@/lib/auto-ledger-clipboard';
import {
    getAutoLedgerPendingRows,
    hideAutoLedgerToast,
    notifyAutoLedgerCompleted,
    patchAutoLedgerPendingRow,
    removeAutoLedgerPendingRow,
    setAutoLedgerPendingRows,
    showAutoLedgerToast,
    type AutoLedgerPendingRow,
} from '@/lib/auto-ledger-events';
import { notifyAutoLedgerFailure, notifyAutoLedgerHint } from '@/lib/auto-ledger-notify';
import {
    AUTO_LEDGER_HANDOFF_SPLASH_MS,
    AUTO_LEDGER_MAX_ATTEMPTS,
    AUTO_LEDGER_RETRY_DELAY_MS,
    sleepMs,
} from '@/lib/auto-ledger-retry';
import { enterAutoLedgerSession, leaveAutoLedgerSession } from '@/lib/auto-ledger-session';
import { resolveFinanceAccountForAutoLedgerWithDefaults } from '@/lib/finance-account-match';
import {
    loadFinanceDefaultAccounts,
    sanitizeFinanceDefaultAccounts,
    type FinanceDefaultAccounts,
} from '@/lib/finance-default-accounts';
import {
    consumeFinanceSheetLaunchIntent,
    peekFinanceSheetLaunchIntent,
    type FinanceSheetLaunchIntent,
} from '@/lib/finance-sheet-launch-intent';
import {
    buildExpenseCategories,
    buildIncomeCategories,
    mergeSheetCategories,
    pickSheetCategoryForParsed,
    type ParsedOneLiner,
    type SheetCategory,
} from '@/lib/finance-transaction-sheet/helpers';
import {
    createFinanceTransaction,
    getFinanceAccountsWithBalance,
    validateFinanceLedgerBalanceAfterChange,
} from '@/lib/repositories/finance/finance';
import {
    financeSheetCategoryRowToSheetCategory,
    getFinanceSheetCustomCategories,
} from '@/lib/repositories/finance/finance-sheet-category';
import type { FinanceAccountBalanceRow } from '@/lib/repositories/finance/finance.types';
import { getShortcutHandoffKey } from '@/lib/shortcut-auto-ledger-handoff';
import {
    consumeShortcutAutoLedgerImageDataUri,
    hasShortcutAutoLedgerPending,
} from '@/lib/shortcut-auto-ledger-pending';
import { consumeShortcutImageHandoffExpected } from '@/lib/shortcut-auto-ledger-route-bridge';
import {
    getActiveAiLlmApiKey,
    parseFinanceOneLinerFromImage,
} from '@/lib/zhipu-image-parse';
import { Alert } from 'react-native';
import { moveAppToBackground } from 'zheng-background';

const AUTO_LEDGER_NOT_BILL_MESSAGE =
  '这不是账单或支付凭证截图，请换一张支付成功页、账单详情或小票等图片。';

const CATEGORY_COLORS = {
  primary: '#0058be',
  secondary: '#7c3aed',
  tertiary: '#0d9488',
  subtle: '#94a3b8',
};

const cancelledIds = new Set<string>();
let consumeChain: Promise<void> = Promise.resolve();
let lastConsumedHandoffKey: string | null = null;
let handoffBackgroundTimer: ReturnType<typeof setTimeout> | null = null;
let handoffSessionHeld = false;

function pickAccountForAutoLedger(
  accounts: FinanceAccountBalanceRow[],
  parsed: Pick<ParsedOneLiner, 'transaction_type' | 'account_name' | 'payment_account_label'>,
  defaults: FinanceDefaultAccounts,
): FinanceAccountBalanceRow | null {
  if (!accounts.length) return null;
  const candidates = accounts.map((a) => ({ id: a.id, name: a.name, account_no: a.account_no }));
  const matched = resolveFinanceAccountForAutoLedgerWithDefaults(candidates, {
    transactionType: parsed.transaction_type,
    accountName: parsed.account_name ?? null,
    paymentAccountLabel: parsed.payment_account_label ?? null,
    defaultPaymentAccountId: defaults.defaultPaymentAccountId,
    defaultIncomeAccountId: defaults.defaultIncomeAccountId,
  });
  if (!matched) return accounts[0] ?? null;
  return accounts.find((a) => a.id === matched.id) ?? accounts[0] ?? null;
}

async function loadSheetCategories(): Promise<{
  expenseCategories: SheetCategory[];
  incomeCategories: SheetCategory[];
}> {
  const { primary, secondary, tertiary, subtle } = CATEGORY_COLORS;
  try {
    const [expRows, incRows] = await Promise.all([
      getFinanceSheetCustomCategories('expense'),
      getFinanceSheetCustomCategories('income'),
    ]);
    const customExpense = expRows.map((r) => financeSheetCategoryRowToSheetCategory(r, subtle));
    const customIncome = incRows.map((r) => financeSheetCategoryRowToSheetCategory(r, subtle));
    return {
      expenseCategories: mergeSheetCategories(
        buildExpenseCategories(primary, secondary, tertiary, subtle),
        customExpense,
      ),
      incomeCategories: mergeSheetCategories(
        buildIncomeCategories(primary, secondary, tertiary, subtle),
        customIncome,
      ),
    };
  } catch {
    return {
      expenseCategories: buildExpenseCategories(primary, secondary, tertiary, subtle),
      incomeCategories: buildIncomeCategories(primary, secondary, tertiary, subtle),
    };
  }
}

function clearHandoffBackgroundTimer(): void {
  if (handoffBackgroundTimer != null) {
    clearTimeout(handoffBackgroundTimer);
    handoffBackgroundTimer = null;
  }
}

function scheduleHandoffReturnToBackground(): void {
  clearHandoffBackgroundTimer();
  handoffBackgroundTimer = setTimeout(() => {
    handoffBackgroundTimer = null;
    hideAutoLedgerToast();
    void moveAppToBackground();
  }, AUTO_LEDGER_HANDOFF_SPLASH_MS);
}

async function beginHandoffSession(message: string): Promise<void> {
  showAutoLedgerToast(message);
  if (!handoffSessionHeld) {
    await enterAutoLedgerSession();
    handoffSessionHeld = true;
  }
  scheduleHandoffReturnToBackground();
}

async function endHandoffSessionIfHeld(): Promise<void> {
  clearHandoffBackgroundTimer();
  if (handoffSessionHeld) {
    handoffSessionHeld = false;
    await leaveAutoLedgerSession();
  }
  hideAutoLedgerToast();
}

export function cancelAutoLedgerJob(pendingId: string): void {
  cancelledIds.add(pendingId);
  removeAutoLedgerPendingRow(pendingId);
  void endHandoffSessionIfHeld();
}

export type ProcessAutoLedgerOptions = {
  /** 快捷指令/深链 handoff：用通知反馈，并尽快切后台 */
  handoff?: boolean;
  /** 相册/相机选图：失败时用 Alert 提示（仍可在后台完成识别） */
  showAlerts?: boolean;
};

function reportAutoLedgerError(message: string, opts?: ProcessAutoLedgerOptions): void {
  if (opts?.handoff) {
    void notifyAutoLedgerFailure(message);
    return;
  }
  if (opts?.showAlerts) {
    Alert.alert('自动记账失败', message);
  }
}

/**
 * 识别截图并写入流水；不依赖财务 Tab 是否聚焦。
 */
export async function processAutoLedgerFromImage(
  imageDataUri: string,
  accounts: FinanceAccountBalanceRow[],
  ledgerSource: AutoLedgerPendingRow['source'],
  opts?: ProcessAutoLedgerOptions,
): Promise<void> {
  if (shouldSkipDuplicateAutoLedgerImage(imageDataUri)) {
    return;
  }

  const handoff = opts?.handoff === true;

  if (!handoffSessionHeld) {
    await enterAutoLedgerSession();
  }
  try {
    const key = getActiveAiLlmApiKey().trim();
    if (!key) {
      const msg = '未配置智谱密钥（EXPO_PUBLIC_ZHIPU_API_KEY）。';
      reportAutoLedgerError(msg, opts);
      return;
    }

    if (!accounts.length) {
      reportAutoLedgerError('请先添加至少一个账户。', opts);
      return;
    }

    const pendingId = makeTimestampEntityId('pal_', 8);
    const maxAttempts = AUTO_LEDGER_MAX_ATTEMPTS;
    cancelledIds.delete(pendingId);
    setAutoLedgerPendingRows([
      { id: pendingId, source: ledgerSource, retryAttempt: 1, maxAttempts },
      ...getAutoLedgerPendingRows().filter((r) => r.id !== pendingId),
    ]);

    const isCancelled = () => cancelledIds.has(pendingId);
    const accountHints = accounts.map((a) => ({ name: a.name, account_no: a.account_no }));
    let lastError = '请稍后重试。';

    const { expenseCategories, incomeCategories } = await loadSheetCategories();
    const rawDefaults = await loadFinanceDefaultAccounts();
    const defaults = sanitizeFinanceDefaultAccounts(rawDefaults, accounts);

    try {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (isCancelled()) return;

        if (attempt > 1) {
          patchAutoLedgerPendingRow(pendingId, { retryAttempt: attempt, maxAttempts });
          await sleepMs(AUTO_LEDGER_RETRY_DELAY_MS);
          if (isCancelled()) return;
        }

        try {
          const resolved = await parseFinanceOneLinerFromImage({
            apiKey: key,
            imageDataUri,
            accounts: accountHints,
            maxAttempts: 2,
            retryDelayMs: 800,
          });
          if (isCancelled()) return;

          if (!resolved.ok) {
            if (resolved.notBill) {
              if (handoff) {
                await notifyAutoLedgerHint(AUTO_LEDGER_NOT_BILL_MESSAGE);
              } else if (opts?.showAlerts) {
                Alert.alert('提示', AUTO_LEDGER_NOT_BILL_MESSAGE);
              }
              return;
            }
            lastError = resolved.error;
            console.warn(`Auto ledger parse attempt ${attempt}/${maxAttempts} failed:`, resolved.error);
            continue;
          }

          const account = pickAccountForAutoLedger(
            accounts,
            {
              transaction_type: resolved.transaction_type,
              account_name: resolved.account_name,
              payment_account_label: resolved.payment_account_label,
            },
            defaults,
          );
          if (!account) {
            reportAutoLedgerError('请先添加至少一个账户。', opts);
            return;
          }

          const parsed = {
            transaction_type: resolved.transaction_type,
            amount: resolved.amount,
            name: resolved.name,
            category_label: resolved.category_label,
          };

          const cat = pickSheetCategoryForParsed(
            parsed.transaction_type,
            parsed.category_label,
            expenseCategories,
            incomeCategories,
          );
          const transactionType = parsed.transaction_type;
          const amountAbs = parsed.amount;
          const signedAmount = account.sign_rule > 0 ? amountAbs : -amountAbs;
          const boundsErr = validateFinanceLedgerBalanceAfterChange(
            account.sign_rule,
            account.balance ?? 0,
            transactionType,
            signedAmount,
            null,
          );
          if (boundsErr) {
            reportAutoLedgerError(boundsErr, opts);
            return;
          }

          const txnId = makeTimestampEntityId('ft_', 8);
          const happenedAtIso = new Date().toISOString();
          const noteLine =
            ledgerSource === 'shortcut_intent'
              ? `快捷指令截图 · ${parsed.name}`
              : ledgerSource === 'picker'
                ? `图片记账 · ${parsed.name}`
                : `剪贴板截图 · ${parsed.name}`;

          await createFinanceTransaction({
            id: txnId,
            name: parsed.name,
            happened_at: happenedAtIso,
            account_id: account.id,
            transaction_type: transactionType,
            amount: signedAmount,
            note: noteLine,
            extra_data: JSON.stringify({
              manual: true,
              sentence: true,
              parse_source: 'ai',
              from_clipboard_screenshot: ledgerSource === 'clipboard',
              from_shortcut_intent: ledgerSource === 'shortcut_intent',
              from_picker_image: ledgerSource === 'picker',
              recognized_payment_account: resolved.payment_account_label,
              matched_account_name: account.name,
              category_key: cat.key,
              category_label: cat.label,
              attachments: [{ type: 'image', uri: imageDataUri }],
            }),
          });
          notifyAutoLedgerCompleted();
          return;
        } catch (error) {
          lastError =
            error instanceof Error && error.message.trim() ? error.message : '请稍后重试。';
          console.warn(`Auto ledger attempt ${attempt}/${maxAttempts} failed:`, error);
        }
      }

      if (isCancelled()) return;

      const failMsg = `已自动重试 ${maxAttempts} 次仍未成功，请检查网络或截图是否清晰后重试。\n\n${lastError}`;
      reportAutoLedgerError(failMsg, opts);
    } finally {
      cancelledIds.delete(pendingId);
      removeAutoLedgerPendingRow(pendingId);
    }
  } finally {
    if (!handoffSessionHeld) {
      await leaveAutoLedgerSession();
    }
  }
}

type PendingJob =
  | { kind: 'image'; imageDataUri: string; source: 'clipboard' | 'shortcut_intent' | 'picker'; handoff: boolean }
  | { kind: 'clipboard_pending'; handoff: boolean };

async function resolvePendingJob(intent: FinanceSheetLaunchIntent | null): Promise<PendingJob | null> {
  if (intent?.kind === 'auto_ledger_clipboard_image') {
    return { kind: 'image', imageDataUri: intent.imageDataUri, source: 'clipboard', handoff: true };
  }
  if (intent?.kind === 'auto_ledger_clipboard_pending') {
    return { kind: 'clipboard_pending', handoff: true };
  }

  const expectingShortcutImage = consumeShortcutImageHandoffExpected();
  let shortcutImageUri = await consumeShortcutAutoLedgerImageDataUri();
  if (!shortcutImageUri && expectingShortcutImage) {
    shortcutImageUri = await readClipboardImageForAutoLedger();
  }
  if (shortcutImageUri) {
    return { kind: 'image', imageDataUri: shortcutImageUri, source: 'shortcut_intent', handoff: true };
  }

  if (hasShortcutAutoLedgerPending()) {
    return null;
  }

  return null;
}

async function runPendingJob(job: PendingJob): Promise<void> {
  const accounts = await getFinanceAccountsWithBalance();
  if (!accounts.length) {
    if (job.handoff) {
      await beginHandoffSession('正在识别截图并记账…');
      await notifyAutoLedgerFailure('请先添加至少一个账户。');
      await endHandoffSessionIfHeld();
    }
    return;
  }

  if (job.kind === 'clipboard_pending') {
    if (job.handoff) {
      await beginHandoffSession('正在读取并识别截图…');
    }
    const imageUri = await readClipboardImageForAutoLedger();
    if (!imageUri) {
      if (job.handoff) {
        await notifyAutoLedgerFailure(
          '剪贴板里没有图片或读取失败，请先在快捷指令中复制截图并允许粘贴。',
        );
        await endHandoffSessionIfHeld();
      }
      return;
    }
    await processAutoLedgerFromImage(imageUri, accounts, 'clipboard', { handoff: job.handoff });
    await endHandoffSessionIfHeld();
    return;
  }

  if (job.handoff && job.source !== 'picker') {
    await beginHandoffSession(
      job.source === 'shortcut_intent' ? '正在识别快捷指令截图…' : '正在识别剪贴板截图…',
    );
  }

  await processAutoLedgerFromImage(job.imageDataUri, accounts, job.source, { handoff: job.handoff });
  await endHandoffSessionIfHeld();
}

export type ConsumeAutoLedgerTrigger = 'bootstrap' | 'handoff' | 'active' | 'focus';

/**
 * 在根布局挂载后消费待处理截图/剪贴板 intent，不依赖财务 Tab 聚焦或前台停留。
 */
function buildConsumeScopeKey(
  handoffKey: string | null,
  intent: FinanceSheetLaunchIntent | null,
): string | null {
  if (handoffKey) {
    return handoffKey;
  }
  if (intent?.kind === 'auto_ledger_clipboard_image') {
    return `intent:image:${intent.imageDataUri.length}`;
  }
  if (intent?.kind === 'auto_ledger_clipboard_pending') {
    return 'intent:clipboard_pending';
  }
  return null;
}

export function scheduleConsumeAutoLedger(trigger: ConsumeAutoLedgerTrigger): void {
  consumeChain = consumeChain
    .then(async () => {
      const handoffKey = getShortcutHandoffKey();
      const peekedIntent = peekFinanceSheetLaunchIntent();
      const scopeKey = buildConsumeScopeKey(handoffKey, peekedIntent);
      const hasWork = scopeKey != null;

      if (!hasWork) {
        return;
      }

      if (scopeKey === lastConsumedHandoffKey) {
        return;
      }

      const intent = consumeFinanceSheetLaunchIntent();
      const job = await resolvePendingJob(intent);
      if (!job) {
        return;
      }

      lastConsumedHandoffKey = scopeKey;

      await runPendingJob(job);
    })
    .catch((e) => {
      console.warn('scheduleConsumeAutoLedger failed:', e);
      void endHandoffSessionIfHeld();
    });
}
