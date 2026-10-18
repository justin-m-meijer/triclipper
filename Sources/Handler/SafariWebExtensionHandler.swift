import Foundation
import SafariServices

/// Relays ETAPI calls from the web extension to a Trilium server.
///
/// The extension cannot call the server itself: Trilium sends no CORS headers,
/// and a plain-HTTP server on the LAN counts as mixed content from the
/// extension's own (secure) origin. Both restrictions apply to WebKit, not to
/// URLSession, so the request is made here instead.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    /// Anything the extension asks for is rewritten against the configured
    /// base URL and confined to /etapi/, so a compromised page that reaches the
    /// extension still cannot use the app as a general-purpose proxy.
    private static let allowedPrefix = "/etapi/"
    private static let timeout: TimeInterval = 30

    func beginRequest(with context: NSExtensionContext) {
        let item = context.inputItems.first as? NSExtensionItem
        let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]

        handle(message) { reply in
            let response = NSExtensionItem()
            response.userInfo = [SFExtensionMessageKey: reply]
            context.completeRequest(returningItems: [response], completionHandler: nil)
        }
    }

    private func handle(_ message: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        switch message["action"] as? String {
        case "version":
            reply(["ok": true, "version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "?"])
        case "request":
            perform(message, reply: reply)
        default:
            reply(["ok": false, "error": "Unknown action"])
        }
    }

    private func perform(_ message: [String: Any], reply: @escaping ([String: Any]) -> Void) {
        guard let base = message["baseUrl"] as? String,
              let path = message["path"] as? String,
              let token = message["token"] as? String else {
            reply(["ok": false, "error": "Missing baseUrl, path or token"])
            return
        }
        guard path.hasPrefix(Self.allowedPrefix) else {
            reply(["ok": false, "error": "Path outside \(Self.allowedPrefix)"])
            return
        }
        // Resolving against the base URL rather than concatenating means a path
        // like "/etapi/../admin" cannot escape, and a scheme in `path` is ignored.
        guard var components = URLComponents(string: base.hasSuffix("/") ? String(base.dropLast()) : base),
              // Schemes are case-insensitive by definition, and iOS capitalises
              // the first letter of a text field, so "Https://…" arrives here.
              let scheme = components.scheme?.lowercased(), scheme == "http" || scheme == "https",
              components.host != nil else {
            reply(["ok": false, "error": "Invalid server address"])
            return
        }
        let split = path.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)
        components.percentEncodedPath = (components.percentEncodedPath.hasSuffix("/")
            ? String(components.percentEncodedPath.dropLast()) : components.percentEncodedPath) + String(split[0])
        components.percentEncodedQuery = split.count > 1 ? String(split[1]) : nil

        guard let url = components.url, url.path.hasPrefix(Self.allowedPrefix) || url.path.contains(Self.allowedPrefix) else {
            reply(["ok": false, "error": "Could not build request URL"])
            return
        }

        var request = URLRequest(url: url, timeoutInterval: Self.timeout)
        request.httpMethod = (message["method"] as? String ?? "GET").uppercased()
        request.setValue(token, forHTTPHeaderField: "Authorization")
        if let body = message["body"] as? String {
            request.httpBody = body.data(using: .utf8)
            request.setValue(message["contentType"] as? String ?? "application/json", forHTTPHeaderField: "Content-Type")
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                reply(["ok": false, "error": error.localizedDescription])
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            reply([
                "ok": (200..<300).contains(status),
                "status": status,
                "body": String(data: data ?? Data(), encoding: .utf8) ?? "",
            ])
        }.resume()
    }
}
