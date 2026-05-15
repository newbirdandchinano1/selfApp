import Foundation
import UIKit

// 👈 修复：让 String 遵守 Error 协议，解决 Result 报错问题
extension String: Error {}

enum ZhipuVisionClient {
    private static let apiURL = URL(string: "https://open.bigmodel.cn/api/paas/v4/chat/completions")!
    private static let embeddedKey = "d0ab5a5e402040d291d9b77f58996d32.nL1sXtGfaUMXzW7W"
    private static let model = "glm-4.6v-flash"

    struct ParsedLedger: Sendable {
        var transactionType: String
        var amount: Double
        var name: String
        var categoryLabel: String?
    }

    static func readClipboardImageBase64() -> (base64: String, mime: String)? {
        guard let image = UIPasteboard.general.image else { return nil }
        guard let png = image.pngData() else { return nil }
        return (png.base64EncodedString(), "image/png")
    }

    static func parseFinanceFromClipboardImage() async -> Result<ParsedLedger, String> {
        guard let clip = readClipboardImageBase64() else {
            return .failure("剪贴板里没有图片，请先在快捷指令中复制截图。")
        }

        let question =
            "请查看这张手机屏幕截图（支付成功页、账单、小票、转账或收款记录等）。识别其中一笔主要交易；若有多笔，取金额最大或信息最完整的一笔。" +
            "要求：transaction_type 仅 expense 或 income；amount 为人民币元且为正数，不得编造截图中不存在的数字；" +
            "name 为不超过 20 字的中文事由；category_label 为简短中文分类名或 null。若无法识别任何可信金额，将 amount 设为 0。"

        let jsonTemplate = #"{"transaction_type":"expense","amount":0,"name":"","category_label":null}"#

        let system =
            """
            你是一个图片解析工具。严格按照以下规则输出：
            1. 只返回一个标准JSON对象
            2. 完全遵循我给你的JSON格式和字段类型
            3. 不要添加任何JSON以外的内容（包括解释、说明、代码块）
            4. 如果无法识别某个字段，填null或默认值

            必须严格遵循的JSON格式：
            \(jsonTemplate)
            """

        let dataUri = "data:\(clip.mime);base64,\(clip.base64)"

        let body: [String: Any] = [
            "model": model,
            "temperature": 0.1,
            "max_tokens": 4096,
            "response_format": ["type": "json_object"],
            "messages": [
                ["role": "system", "content": system],
                [
                    "role": "user",
                    "content": [
                        ["type": "text", "text": question],
                        [
                            "type": "image_url",
                            "image_url": ["url": dataUri],
                        ],
                    ],
                ],
            ],
        ]

        do {
            var request = URLRequest(url: apiURL)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(embeddedKey)", forHTTPHeaderField: "Authorization")
            request.httpBody = try JSONSerialization.data(withJSONObject: body)

            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
                let snippet = String(data: data, encoding: .utf8) ?? ""
                return .failure("AI 请求失败（\( (response as? HTTPURLResponse)?.statusCode ?? 0)）：\(snippet.prefix(120))")
            }

            guard
                let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let choices = root["choices"] as? [[String: Any]],
                let first = choices.first,
                let message = first["message"] as? [String: Any],
                let content = message["content"] as? String
            else {
                return .failure("AI 返回格式异常")
            }

            let cleaned = stripMarkdownFence(content)
            guard let jsonData = cleaned.data(using: .utf8),
                  let parsed = try JSONSerialization.jsonObject(with: jsonData) as? [String: Any]
            else {
                return .failure("AI 返回的不是合法 JSON")
            }

            var payload = parsed
            if payload["amount"] == nil, let inner = parsed["result"] as? [String: Any] {
                payload = inner
            }

            guard let norm = normalizePayload(payload) else {
                return .failure("未能从截图中识别出有效金额与标题")
            }

            return .success(norm)
        } catch {
            return .failure("网络异常：\(error.localizedDescription)")
        }
    }

    private static func stripMarkdownFence(_ raw: String) -> String {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.hasPrefix("```") {
            s = s.replacingOccurrences(of: "^```(?:json)?\\s*", with: "", options: .regularExpression)
            s = s.replacingOccurrences(of: "\\s*```$", with: "", options: .regularExpression)
        }
        return s.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func normalizePayload(_ o: [String: Any]) -> ParsedLedger? {
        let typeRaw = (o["transaction_type"] as? String ?? "expense").lowercased()
        let transactionType = typeRaw == "income" ? "income" : "expense"

        let rawAmt = o["amount"]
        let amount: Double
        if let n = rawAmt as? Double {
            amount = n
        } else if let n = rawAmt as? Int {
            amount = Double(n)
        } else if let s = rawAmt as? String {
            amount = Double(s.replacingOccurrences(of: ",", with: "")) ?? 0
        } else {
            amount = 0
        }

        guard amount > 0, amount <= 99_999_999.99 else { return nil }

        let nameRaw: String
        if let s = o["name"] as? String {
            nameRaw = s.trimmingCharacters(in: .whitespacesAndNewlines)
        } else {
            nameRaw = ""
        }
        guard !nameRaw.isEmpty else { return nil }

        let name = nameRaw.count > 80 ? String(nameRaw.prefix(77)) + "…" : nameRaw
        let cat = (o["category_label"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        let categoryLabel = (cat?.isEmpty == false) ? String(cat!.prefix(40)) : nil

        return ParsedLedger(
            transactionType: transactionType,
            amount: amount,
            name: name,
            categoryLabel: categoryLabel
        )
    }
}
