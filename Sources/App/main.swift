import AppKit
import SafariServices

let extensionIdentifier = "nl.justinmeijer.triclipper.Extension"

/// The containing app exists because Safari only loads extensions that ship
/// inside one. Server address and token live in the extension's own storage,
/// so there is nothing to configure here — just a way in.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private let status = NSTextField(labelWithString: "Checking…")

    func applicationDidFinishLaunching(_ note: Notification) {
        NSApp.setActivationPolicy(.regular)
        buildWindow()
        refresh()
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    private func buildWindow() {
        let title = NSTextField(labelWithString: "Tri Clipper")
        title.font = .systemFont(ofSize: 22, weight: .semibold)

        let blurb = NSTextField(wrappingLabelWithString:
            "Save web pages to Trilium from Safari.\n\n"
            + "Turn the extension on in Safari, then open its settings from the toolbar "
            + "button to enter your server address and ETAPI token.")
        blurb.font = .systemFont(ofSize: 13)
        blurb.textColor = .secondaryLabelColor

        status.font = .systemFont(ofSize: 12)
        status.textColor = .secondaryLabelColor

        let open = NSButton(title: "Open Safari Extension Settings", target: self, action: #selector(openPrefs))
        open.bezelStyle = .rounded
        open.keyEquivalent = "\r"

        let recheck = NSButton(title: "Check again", target: self, action: #selector(recheck))
        recheck.bezelStyle = .rounded

        let buttons = NSStackView(views: [open, recheck])
        buttons.orientation = .horizontal
        buttons.spacing = 10

        let stack = NSStackView(views: [title, blurb, buttons, status])
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 16
        stack.edgeInsets = NSEdgeInsets(top: 30, left: 30, bottom: 30, right: 30)
        blurb.preferredMaxLayoutWidth = 400

        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 280),
                          styleMask: [.titled, .closable, .miniaturizable],
                          backing: .buffered, defer: false)
        window.title = "Tri Clipper"
        window.contentView = stack
        window.center()
        window.makeKeyAndOrderFront(nil)
    }

    @objc private func openPrefs() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionIdentifier) { error in
            guard let error else { return }
            DispatchQueue.main.async { self.status.stringValue = "Safari said: \(error.localizedDescription)" }
        }
    }

    @objc private func recheck() { refresh() }

    private func refresh() {
        status.stringValue = "Checking…"
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionIdentifier) { state, error in
            DispatchQueue.main.async {
                if let error {
                    self.status.stringValue = "Safari does not see the extension yet — \(error.localizedDescription)"
                } else if state?.isEnabled == true {
                    self.status.stringValue = "Extension is on."
                } else {
                    self.status.stringValue = "Extension is installed but switched off in Safari."
                }
            }
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
