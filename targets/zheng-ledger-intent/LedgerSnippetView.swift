import AppIntents
import SwiftUI

@available(iOS 18.0, iOSApplicationExtension 18.0, *)
struct LedgerSnippetView: View {
    let sessionId: String
    let draft: LedgerDraft?

    private var appName: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? "小郑的自我修养"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 10) {
                Image(systemName: "creditcard.and.scribble")
                    .font(.title3)
                    .foregroundStyle(.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(appName)
                        .font(.headline)
                    Text("自动记账")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
            }

            if let draft {
                if draft.isError {
                    Label(draft.statusMessage ?? "识别失败", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline)
                        .foregroundStyle(.orange)
                } else {
                    HStack {
                        Text(draft.typeDisplay)
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(Color.accentColor.opacity(0.15))
                            .clipShape(Capsule())
                        Spacer()
                        Text(draft.amountDisplay)
                            .font(.title2.weight(.bold))
                    }

                    Text(draft.name)
                        .font(.body.weight(.medium))
                        .lineLimit(2)

                    if let cat = draft.categoryLabel, !cat.isEmpty {
                        Text("分类：\(cat)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    if let msg = draft.statusMessage {
                        Label(msg, systemImage: "sparkles")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                Text("会话已过期，请重新运行快捷指令。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }

            if let draft, !draft.isError {
                HStack(spacing: 10) {
                    Button(intent: CancelLedgerIntent(sessionId: sessionId)) {
                        Text("取消")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)

                    Button(intent: ConfirmLedgerIntent(sessionId: sessionId)) {
                        Text("确认记账")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                }
            } else {
                Button(intent: CancelLedgerIntent(sessionId: sessionId)) {
                    Text("完成")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
            }
        }
        .padding(16)
    }
}
