/* Service worker: menus, shortcuts, and everything that talks to Trilium.
 * The popup asks; this file does. */

importScripts(
  "lib/templates.js",
  "lib/sanitize.js",
  "lib/settings.js",
  "lib/trilium.js",
  "lib/clipper.js"
);

const api = globalThis.browser ?? globalThis.chrome;

/* --- page access ------------------------------------------------------ */

/** Injects the content scripts once per page load, then leaves them alone. */
async function ensureInjected(tabId) {
  const [probe] = await api.scripting.executeScript({
    target: { tabId },
    func: () => Boolean(window.__triClipperReady),
  });
  if (probe?.result) return;

  await api.scripting.insertCSS({ target: { tabId }, files: ["content/highlighter.css"] });
  await api.scripting.executeScript({
    target: { tabId },
    files: [
      "lib/Readability.js",
      "lib/sanitize.js",
      "content/highlighter.js",
      "content/extract.js",
    ],
  });
}

/* `mode` overrides the template's own, because the popup lets it be changed and
 * the whole page is only read when something actually asks for it. */
async function extractFrom(tab, template, mode) {
  await ensureInjected(tab.id);
  const response = await api.tabs.sendMessage(tab.id, {
    action: "extract",
    variables: template ? Clipper.variablesFor(template) : [],
    needsFullPage: (mode ?? template?.mode) === "page",
  });
  if (!response?.ok) throw new Error(response?.error || "Could not read the page.");
  return response.data;
}

function clippable(tab) {
  return Boolean(tab?.url && /^https?:/i.test(tab.url));
}

/* --- clipping --------------------------------------------------------- */

async function clipTab(tab, { templateId, overrides } = {}) {
  if (!clippable(tab)) throw new Error("This page cannot be clipped.");
  const settings = await Settings.load();
  const template = templateId
    ? settings.templates.find((t) => t.id === templateId) ?? Settings.pickTemplate(settings, tab.url)
    : Settings.pickTemplate(settings, tab.url);

  const data = await extractFrom(tab, template, overrides?.mode);
  const result = await Clipper.clip(settings, template, data, overrides ?? {});

  await Settings.rememberDestination(overrides?.destination ?? template.destination);
  if (settings.showNotification) {
    notify(result.appended ? "Added to existing note" : "Clipped to Trilium", result.title);
  }
  if (settings.openAfterClip) {
    api.tabs.create({ url: `${settings.serverUrl.replace(/\/+$/, "")}/#root/${result.noteId}`, active: true });
  }
  return result;
}

function notify(title, message) {
  // Notifications being switched off is a preference, not a failure, and the
  // call returns undefined rather than a promise on some paths.
  try {
    const pending = api.notifications?.create({
      type: "basic",
      iconUrl: "images/icon-128.png",
      title,
      message: String(message || "").slice(0, 120),
    });
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch {
    /* nothing to do about it here */
  }
}

/* --- menus and shortcuts ---------------------------------------------- */

/* Safari on iOS has no context menus, no keyboard commands, no notifications
 * and no toolbar badge. Each of those is guarded where it is used rather than
 * behind one platform check, so a single missing API cannot take the whole
 * service worker down with it. */
const hasContextMenus = Boolean(api.contextMenus?.create);

async function buildMenus() {
  if (!hasContextMenus) return;
  await api.contextMenus.removeAll();
  api.contextMenus.create({ id: "clip-page", title: "Clip page to Trilium", contexts: ["page"] });
  api.contextMenus.create({ id: "clip-selection", title: "Clip selection to Trilium", contexts: ["selection"] });
  api.contextMenus.create({ id: "highlight", title: "Highlight mode", contexts: ["page", "selection"] });
  api.contextMenus.create({ id: "sep", type: "separator", contexts: ["page"] });

  const settings = await Settings.load();
  for (const template of settings.templates) {
    api.contextMenus.create({
      id: "template:" + template.id,
      title: `Clip with “${template.name}”`,
      contexts: ["page"],
    });
  }
}

api.runtime.onInstalled.addListener(buildMenus);
api.runtime.onStartup?.addListener(buildMenus);
api.storage.onChanged.addListener((changes) => {
  if (changes.templates) buildMenus();
});

api.contextMenus?.onClicked?.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "highlight") {
      await toggleHighlight(tab);
      return;
    }
    if (info.menuItemId === "clip-selection") {
      await clipTab(tab, { overrides: { mode: "selection" } });
      return;
    }
    if (String(info.menuItemId).startsWith("template:")) {
      await clipTab(tab, { templateId: String(info.menuItemId).slice("template:".length) });
      return;
    }
    await clipTab(tab);
  } catch (error) {
    notify("Clip failed", error.message);
  }
});

api.commands?.onCommand.addListener(async (command) => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  try {
    if (command === "clip-page") await clipTab(tab);
    if (command === "toggle-highlight") await toggleHighlight(tab);
  } catch (error) {
    notify("Clip failed", error.message);
  }
});

async function toggleHighlight(tab) {
  if (!clippable(tab)) return false;
  await ensureInjected(tab.id);
  const response = await api.tabs.sendMessage(tab.id, { action: "highlight-toggle" });
  return response?.active ?? false;
}

/* --- badge ------------------------------------------------------------ */

function setBadge(tabId, count) {
  const action = api.action ?? api.browserAction;
  if (!action?.setBadgeText || tabId === undefined) return;
  try {
    action.setBadgeText({ tabId, text: count > 0 ? String(count) : "" });
    action.setBadgeBackgroundColor?.({ tabId, color: "#f0ad4e" });
  } catch {
    /* no badge on iOS */
  }
}

/* --- popup and options API -------------------------------------------- */

api.runtime.onMessage.addListener((request, sender, respond) => {
  (async () => {
    try {
      switch (request?.action) {
        case "highlight-count":
          setBadge(sender.tab?.id, request.count);
          return { ok: true };

        case "page-data": {
          const [tab] = await api.tabs.query({ active: true, currentWindow: true });
          if (!clippable(tab)) return { ok: false, error: "This page cannot be clipped." };
          const settings = await Settings.load();
          const template = request.templateId
            ? settings.templates.find((t) => t.id === request.templateId)
            : Settings.pickTemplate(settings, tab.url);
          const data = await extractFrom(tab, template, request.mode);
          return { ok: true, data, templateId: template.id, settings };
        }

        case "clip": {
          const [tab] = await api.tabs.query({ active: true, currentWindow: true });
          const result = await clipTab(tab, request);
          return { ok: true, result };
        }

        case "toggle-highlight": {
          const [tab] = await api.tabs.query({ active: true, currentWindow: true });
          return { ok: true, active: await toggleHighlight(tab) };
        }

        case "clear-highlights": {
          const [tab] = await api.tabs.query({ active: true, currentWindow: true });
          await api.tabs.sendMessage(tab.id, { action: "highlight-clear" });
          return { ok: true };
        }

        case "test-connection": {
          const info = await Trilium.appInfo(request.settings);
          return { ok: true, version: info?.appVersion, clipper: info?.clipperProtocolVersion };
        }

        case "search-notes": {
          const settings = await Settings.load();
          const query = String(request.query || "").replace(/"/g, '\\"');
          const results = await Trilium.search(settings, `note.title *=* "${query}"`, { limit: 12 });
          return { ok: true, results: results.map((n) => ({ noteId: n.noteId, title: n.title })) };
        }

        default:
          return { ok: false, error: "Unknown request" };
      }
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  })().then(respond);
  return true; // Keeps the message channel open for the async work above.
});
