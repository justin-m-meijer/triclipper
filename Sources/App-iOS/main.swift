import SwiftUI

/// The iOS container app.
///
/// Safari on iOS has no equivalent of `SFSafariApplication.showPreferencesForExtension`,
/// so there is no way to drop the user straight into the extension's switch.
/// Walking them there is the whole job this screen has.
@main
struct TriClipperApp: App {
    var body: some Scene {
        WindowGroup {
            SetupView()
        }
    }
}

private struct SetupView: View {
    @Environment(\.openURL) private var openURL

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    header

                    VStack(alignment: .leading, spacing: 18) {
                        Step(number: 1, title: "Open Settings → Apps → Safari",
                             detail: "Then Extensions, and switch on Tri Clipper.")
                        Step(number: 2, title: "Allow it on the sites you clip",
                             detail: "Saving a page means reading it, so the extension needs "
                                   + "permission for the pages you use it on.")
                        Step(number: 3, title: "Open the extension in Safari",
                             detail: "Tap the page menu in the address bar, choose Tri Clipper, "
                                   + "then the gear to enter your server address and token.")
                    }

                    Button {
                        // Lands on this app's own page in Settings, which is as close as
                        // iOS lets an app get to Safari's extension list.
                        if let url = URL(string: UIApplication.openSettingsURLString) {
                            openURL(url)
                        }
                    } label: {
                        Text("Open Settings")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                    }
                    .buttonStyle(.borderedProminent)

                    Text("Your notes go to the Trilium server you configure and nowhere else. "
                       + "A server on your own network needs a VPN to reach from a phone; one "
                       + "reached over the internet has to use https.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(24)
            }
            .navigationTitle("Tri Clipper")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Save web pages into Trilium")
                .font(.title2.weight(.semibold))
            Text("Three steps, once.")
                .foregroundStyle(.secondary)
        }
    }
}

private struct Step: View {
    let number: Int
    let title: String
    let detail: String

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Text("\(number)")
                .font(.callout.weight(.semibold).monospacedDigit())
                .foregroundStyle(.white)
                .frame(width: 26, height: 26)
                .background(Circle().fill(Color.accentColor))
            VStack(alignment: .leading, spacing: 4) {
                Text(title).font(.body.weight(.semibold))
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}
