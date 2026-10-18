# Tri Clipper

Made by [Justin Meijer](https://www.justinmeijer.nl) as a hobby project.
On the App Store for Mac, iPhone and iPad: https://apps.apple.com/app/id6806387176 ·
more at https://www.justinmeijer.nl/apps/tri-clipper/ · questions to info@justinmeijer.nl.

Open source under the [Mozilla Public License 2.0](LICENSE).

A Safari extension that saves web pages into [Trilium](https://github.com/TriliumNext/Trilium),
in the spirit of Obsidian's Web Clipper: templates, variables, per-site rules, a
highlighter, and a preview of exactly what will be written before you write it.

Where the Obsidian clipper produces markdown with YAML frontmatter, this one
produces **HTML with Trilium labels** — because that is what Trilium actually
stores. Nothing is converted to markdown and back.

## What it does

- **Article, selection, highlights, whole page, or link only.** Article mode runs
  Mozilla's Readability, then strips the result down to the HTML subset Trilium's
  editor keeps.
- **Templates.** Each one decides where the note goes, what it is called, which
  labels it carries and what its body looks like. A template can claim a site, so
  clipping from that site picks it automatically.
- **Variables and filters**, e.g. `{{title|safe}}`, `{{author|split:","|first}}`,
  `{{published|date:"YYYY-MM-DD"}}`, `{{meta:og:image}}`, `{{schema:author.name}}`,
  `{{selector:h1}}`.
- **Appending.** Templates can add to the note already clipped from that page
  instead of making a second one — found through the `#clipUrl` label.
- **Highlighter.** Turn it on, select passages, clip only those.
- Context menu entries, `⌘⇧Y` for the popup and `⌘⇧U` to clip straight away.

## Requirements

- macOS with the Command Line Tools (no Xcode.app needed).
- Trilium with ETAPI switched on, and a token
  (Trilium → Options → ETAPI → Create new token).

## Install

```
./install.sh
```

Then, in Safari:

1. Settings → Advanced → **Show features for web developers**.
2. Develop → **Developer Settings…** → **Allow unsigned extensions**.
3. Settings → Extensions → switch on **Tri Clipper**, and set site access to
   **Allow on Every Website** (it needs to read the page it is clipping).
4. Toolbar button → gear → server address, ETAPI token, **Test connection**.

### The unsigned-extensions caveat

The app is signed ad-hoc, because signing an extension Safari will load without
that setting needs a paid Apple Developer certificate. **"Allow unsigned
extensions" switches itself off every time Safari quits**, and the extension
disappears with it until you tick it again.

Signing with your own Developer ID certificate removes it entirely.

## Why the requests go through Tri Clipper

"The app" here means Tri Clipper's own containing app, the one you install from
the App Store — not a Trilium client. Nothing else has to be on the device, which
is why this works identically on iPhone and iPad, where Trilium has no app at all.

The extension does not talk to Trilium itself. `SafariWebExtensionHandler.swift`
in the containing app does, and the extension asks it to.

Two WebKit rules make the direct route unreliable: Trilium sends no CORS headers,
and a LAN server on plain `http://` counts as mixed content from the extension's
own secure origin. `URLSession` in the app is bound by neither. The relay only
accepts paths under `/etapi/`, resolved against the configured server address, so
it cannot be used as a general proxy.

If your Trilium is already behind https with CORS opened up, Settings →
**Requests go → straight from Safari** skips the relay. That is the only case it
helps in, on any platform; without those headers Safari refuses the request
before it leaves the browser.

## Where things are

```
Sources/App/main.swift                      the containing app (a window and a way in)
Sources/Handler/…Handler.swift              the ETAPI relay
Extension/manifest.json                     MV3 manifest
Extension/background.js                     menus, shortcuts, everything that writes
Extension/content/extract.js                reads the page: metadata, article, selection
Extension/content/highlighter.js            highlight mode
Extension/lib/templates.js                  variables and filters
Extension/lib/sanitize.js                   page HTML → Trilium's HTML subset
Extension/lib/trilium.js                    ETAPI client
Extension/lib/clipper.js                    template + page data → a note
Extension/lib/settings.js                   settings and the built-in templates
Extension/popup/, Extension/options/        the two screens

build.sh / install.sh                       build the Mac bundles; put them where Safari looks
build-ios.sh                                the same for iOS and iPadOS
Support/*.plist                             Info.plists and entitlements
Support/PrivacyInfo.xcprivacy               the privacy manifest, in both bundles
Resources/                                  app icons for the Mac and iOS builds
```

## iOS and iPadOS

```
./build-ios.sh            # simulator
./build-ios.sh device     # device build, signed ad-hoc
```

Same approach as the Mac build — bundles assembled by hand, no Xcode project. The
bundle is flat rather than nested under `Contents/`, and `actool` compiles
`Resources/Assets.xcassets` for the icon. One build covers iPhone and iPad.
Running it on a real device needs your own signing identity and provisioning
profile.

## Known limits

- Images are kept as links to the original server, not copied into Trilium. A
  page that later disappears takes its pictures with it.
- Protected (encrypted) notes cannot be written through ETAPI, so clipping into
  one does not work.
- Relations (`~target`) are not exposed in the template editor; labels are.
- A destination is looked up by title. If two notes share that title the clip is
  refused rather than guessed at, and the message lists the ids to choose from —
  paste one into **Save under**.

## Support

If this is useful to you, you can support my work with a [donation through PayPal](https://www.paypal.com/donate?hosted_button_id=UNBDNLN8MSC88).

## License

Licensed under the [Mozilla Public License 2.0](LICENSE). You may use, change and share it, also
commercially. If you distribute a changed version of these files, those files must stay under the
MPL 2.0 and their source must be available.

## Credits

Bundles [Readability.js](https://github.com/mozilla/readability) (Apache 2.0);
its licence is in `Extension/lib/`. That is the only third-party code here.

Tri Clipper is not affiliated with or endorsed by the Trilium project. It talks to
Trilium's ETAPI over HTTP and contains none of its code, so Trilium's AGPL does
not reach this project — the licence binds people who run modified Trilium, not
clients that call its API.
