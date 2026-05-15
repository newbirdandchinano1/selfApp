import AppIntents
import SwiftUI

@available(iOS 18.0, iOSApplicationExtension 18.0, *)
struct ZhengClipboardLedgerIntent: AppIntent {
    static var title: LocalizedStringResource = "剪贴板截图记账"

    static var description = IntentDescription(
        "读取剪贴板截图，在屏幕顶部展示 AI 识别结果，可确认或取消记账。"
    )

    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ShowsSnippetView {
        let sessionId = UUID().uuidString

        let clip = ZhipuVisionClient.readClipboardImageBase64()
        let imageUri = clip.map { "data:\($0.mime);base64,\($0.base64)" }

        switch await ZhipuVisionClient.parseFinanceFromClipboardImage() {
        case let .success(parsed):
            let draft = LedgerDraft(
                sessionId: sessionId,
                transactionType: parsed.transactionType,
                amount: parsed.amount,
                name: parsed.name,
                categoryLabel: parsed.categoryLabel,
                categoryKey: mapCategoryKey(type: parsed.transactionType, label: parsed.categoryLabel),
                imageDataUri: imageUri,
                statusMessage: "AI 已识别截图中的记账信息",
                isError: false
            )
            LedgerSharedStore.saveSession(draft)
            return .result(view: LedgerSnippetView(sessionId: sessionId, draft: draft))

        case let .failure(parseError):
            let draft = LedgerDraft(
                sessionId: sessionId,
                transactionType: "expense",
                amount: 0,
                name: "识别失败",
                categoryLabel: nil,
                categoryKey: nil,
                imageDataUri: imageUri,
                statusMessage: parseError.message,
                isError: true
            )
            LedgerSharedStore.saveSession(draft)
            return .result(view: LedgerSnippetView(sessionId: sessionId, draft: draft))
        }
    }
}

@available(iOS 18.0, iOSApplicationExtension 18.0, *)
private func mapCategoryKey(type: String, label: String?) -> String? {
    let expense: [String: String] = [
        "餐饮": "food", "零食": "snack", "水果": "fruit", "饮品": "drink",
        "做饭食材": "cook", "交通": "traffic", "居住": "home", "服饰": "cloth",
        "娱乐": "play", "其他": "other",
    ]
    let income: [String: String] = [
        "工资": "salary", "奖金": "bonus", "报销": "refund", "理财": "invest",
        "副业": "sideline", "补贴": "allowance", "红包": "redpack", "礼金": "gift",
        "租金": "rent", "其他": "other-income",
    ]
    let pool = type == "income" ? income : expense
    guard let label, !label.isEmpty else {
        return type == "income" ? "salary" : "food"
    }
    if let exact = pool[label] { return exact }
    for (k, v) in pool where label.contains(k) || k.contains(label) { return v }
    return type == "income" ? "other-income" : "other"
}

@available(iOS 18.0, iOSApplicationExtension 18.0, *)
struct ConfirmLedgerIntent: AppIntent {
    static var title: LocalizedStringResource = "确认记账"

    @Parameter(title: "会话", default: "")
    var sessionId: String

    static var isDiscoverable: Bool = false

    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard !sessionId.isEmpty else {
            return .result(dialog: IntentDialog("缺少会话信息。"))
        }
        guard let draft = LedgerSharedStore.loadSession(sessionId: sessionId), !draft.isError else {
            return .result(dialog: IntentDialog("无法确认：识别结果无效。"))
        }
        guard let accountId = LedgerSharedStore.defaultAccountId(), !accountId.isEmpty else {
            return .result(dialog: IntentDialog("请先在 App 财务页添加账户后再确认记账。"))
        }

        let txnId = "ft_\(Int(Date().timeIntervalSince1970 * 1000))_\(UUID().uuidString.prefix(8))"
        let iso = ISO8601DateFormatter().string(from: Date())

        let pending = PendingFinanceTransaction(
            id: txnId,
            name: draft.name,
            happenedAt: iso,
            accountId: accountId,
            transactionType: draft.transactionType,
            amount: draft.amount,
            note: "剪贴板截图 · \(draft.name)",
            categoryKey: draft.categoryKey,
            categoryLabel: draft.categoryLabel,
            imageDataUri: draft.imageDataUri
        )

        LedgerSharedStore.enqueuePendingTransaction(pending)
        LedgerSharedStore.removeSession(sessionId: sessionId)

        return .result(dialog: IntentDialog("已记账：\(draft.typeDisplay) \(draft.amountDisplay) · \(draft.name)"))
    }
}

@available(iOS 18.0, iOSApplicationExtension 18.0, *)
extension ConfirmLedgerIntent {
    init(sessionId: String) {
        self.init()
        self.sessionId = sessionId
    }
}

@available(iOS 18.0, iOSApplicationExtension 18.0, *)
struct CancelLedgerIntent: AppIntent {
    static var title: LocalizedStringResource = "取消记账"

    @Parameter(title: "会话", default: "")
    var sessionId: String

    static var isDiscoverable: Bool = false

    static var openAppWhenRun: Bool = false

    func perform() async throws -> some IntentResult & ProvidesDialog {
        if !sessionId.isEmpty {
            LedgerSharedStore.removeSession(sessionId: sessionId)
        }
        return .result(dialog: IntentDialog("已取消"))
    }
}

@available(iOS 18.0, iOSApplicationExtension 18.0, *)
extension CancelLedgerIntent {
    init(sessionId: String) {
        self.init()
        self.sessionId = sessionId
    }
}

@available(iOS 18.0, iOSApplicationExtension 18.0, *)
struct ZhengAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: ZhengClipboardLedgerIntent(),
            phrases: [
                "在\(.applicationName)里截图记账",
                "\(.applicationName)截图记账",
                "用\(.applicationName)记账",
            ],
            shortTitle: "截图记账",
            systemImageName: "creditcard.and.scribble"
        )
    }
}

@main
@available(iOS 18.0, iOSApplicationExtension 18.0, *)
struct ZhengLedgerIntentExtension: AppIntentsExtension {}