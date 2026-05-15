import Foundation

enum LedgerSharedKeys {
    static let appGroupId = "group.com.myselfManage.appdemo.ledger"
    static let sessionPrefix = "ledger_session_"
    static let defaultAccountId = "ledger_default_account_id"
    static let pendingTransaction = "pending_finance_transaction"
}

struct LedgerDraft: Codable, Sendable {
    var sessionId: String
    var transactionType: String
    var amount: Double
    var name: String
    var categoryLabel: String?
    var categoryKey: String?
    var imageDataUri: String?
    var statusMessage: String?
    var isError: Bool

    var typeDisplay: String {
        transactionType == "income" ? "收入" : "支出"
    }

    var amountDisplay: String {
        String(format: "¥%.2f", amount)
    }
}

enum LedgerSharedStore {
    private static var defaults: UserDefaults? {
        UserDefaults(suiteName: LedgerSharedKeys.appGroupId)
    }

    static func saveSession(_ draft: LedgerDraft) {
        guard let data = try? JSONEncoder().encode(draft) else { return }
        defaults?.set(data, forKey: LedgerSharedKeys.sessionPrefix + draft.sessionId)
    }

    static func loadSession(sessionId: String) -> LedgerDraft? {
        guard let data = defaults?.data(forKey: LedgerSharedKeys.sessionPrefix + sessionId) else {
            return nil
        }
        return try? JSONDecoder().decode(LedgerDraft.self, from: data)
    }

    static func removeSession(sessionId: String) {
        defaults?.removeObject(forKey: LedgerSharedKeys.sessionPrefix + sessionId)
    }

    static func defaultAccountId() -> String? {
        defaults?.string(forKey: LedgerSharedKeys.defaultAccountId)
    }

    static func enqueuePendingTransaction(_ payload: PendingFinanceTransaction) {
        guard let data = try? JSONEncoder().encode(payload) else { return }
        defaults?.set(data, forKey: LedgerSharedKeys.pendingTransaction)
    }

    static func clearPendingTransaction() {
        defaults?.removeObject(forKey: LedgerSharedKeys.pendingTransaction)
    }
}

struct PendingFinanceTransaction: Codable, Sendable {
    var id: String
    var name: String
    var happenedAt: String
    var accountId: String
    var transactionType: String
    var amount: Double
    var note: String?
    var categoryKey: String?
    var categoryLabel: String?
    var imageDataUri: String?
}
