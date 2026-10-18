/* ETAPI client.
 *
 * Requests normally go through the containing app (transport "native"):
 * Trilium sends no CORS headers, and a LAN server on plain http counts as
 * mixed content from the extension's own https-equivalent origin. Both are
 * WebKit rules that URLSession in the app is not bound by. "direct" is there
 * for a Trilium already behind https with CORS opened up.
 */
(function (root) {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;
  const NATIVE_APP = "nl.justinmeijer.triclipper";

  class TriliumError extends Error {
    constructor(message, status) {
      super(message);
      this.name = "TriliumError";
      this.status = status;
    }
  }

  function trimSlash(url) {
    // Trimmed and lower-cased at the scheme: phones capitalise the first letter
    // of a text field, and "Https://" is the same address as "https://".
    return String(url || "").trim()
      .replace(/^([A-Za-z][A-Za-z0-9+.-]*):/, (m, s) => s.toLowerCase() + ":")
      .replace(/\/+$/, "");
  }

  async function viaNative(settings, method, path, body, contentType) {
    let response;
    try {
      response = await api.runtime.sendNativeMessage(NATIVE_APP, {
        action: "request",
        baseUrl: trimSlash(settings.serverUrl),
        token: settings.token,
        method,
        path,
        body,
        contentType,
      });
    } catch (error) {
      throw new TriliumError(
        "Could not reach the Tri Clipper app. Is it still in /Applications?", 0);
    }
    if (!response) throw new TriliumError("The app sent no reply.", 0);
    if (response.ok === false && response.status === undefined) {
      throw new TriliumError(response.error || "The app could not make the request.", 0);
    }
    return { status: response.status, text: response.body ?? "" };
  }

  async function viaDirect(settings, method, path, body, contentType) {
    const response = await fetch(trimSlash(settings.serverUrl) + path, {
      method,
      headers: {
        Authorization: settings.token,
        ...(body === undefined ? {} : { "Content-Type": contentType }),
      },
      body,
    });
    return { status: response.status, text: await response.text() };
  }

  /** `body` is JSON-encoded unless `options.raw` is set (note content is text/plain). */
  async function call(settings, method, path, body, options = {}) {
    if (!settings.serverUrl || !settings.token) {
      throw new TriliumError("Set the server address and ETAPI token first.", 0);
    }
    const transport = settings.transport === "direct" ? viaDirect : viaNative;
    const encoded = body === undefined ? undefined : options.raw ? String(body) : JSON.stringify(body);
    const contentType = options.raw ? "text/plain" : "application/json";
    const { status, text } = await transport(settings, method, path, encoded, contentType);

    if (status === 401) throw new TriliumError("Trilium rejected the token (401).", 401);
    if (status === 404) throw new TriliumError("Not found (404) — check the parent note.", 404);
    if (status < 200 || status >= 300) {
      let detail = text;
      try {
        detail = JSON.parse(text).message || text;
      } catch { /* a non-JSON error body is still worth showing */ }
      throw new TriliumError(detail ? `Trilium said: ${detail}` : `Request failed (${status}).`, status);
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /* --- operations ------------------------------------------------------ */

  const Trilium = {
    TriliumError,

    appInfo: (settings) => call(settings, "GET", "/etapi/app-info"),

    async search(settings, query, options = {}) {
      const params = new URLSearchParams({ search: query });
      if (options.ancestorNoteId) params.set("ancestorNoteId", options.ancestorNoteId);
      params.set("fastSearch", options.fastSearch ? "true" : "false");
      params.set("includeArchivedNotes", options.includeArchived ? "true" : "false");
      if (options.limit) params.set("limit", String(options.limit));
      const result = await call(settings, "GET", "/etapi/notes?" + params.toString());
      return result?.results ?? [];
    },

    getNote: (settings, noteId) => call(settings, "GET", `/etapi/notes/${encodeURIComponent(noteId)}`),

    createNote(settings, { parentNoteId, title, content, type = "text", mime = "text/html" }) {
      return call(settings, "POST", "/etapi/create-note", {
        parentNoteId, title, type, mime, content,
      });
    },

    getContent: (settings, noteId) =>
      call(settings, "GET", `/etapi/notes/${encodeURIComponent(noteId)}/content`),

    setContent(settings, noteId, html) {
      return call(settings, "PUT", `/etapi/notes/${encodeURIComponent(noteId)}/content`, html, { raw: true });
    },

    addLabel(settings, noteId, name, value) {
      return call(settings, "POST", "/etapi/attributes", {
        noteId, type: "label", name, value: value ?? "", isInheritable: false,
      });
    },

    addRelation(settings, noteId, name, targetNoteId) {
      return call(settings, "POST", "/etapi/attributes", {
        noteId, type: "relation", name, value: targetNoteId, isInheritable: false,
      });
    },

    /** Finds a note already clipped from this URL, so a second clip can extend it. */
    async findByUrl(settings, url, labelName) {
      const escaped = String(url).replace(/"/g, '\\"');
      const results = await this.search(settings, `#${labelName}="${escaped}"`, { limit: 1 });
      return results[0] ?? null;
    },

    /**
     * Accepts a note id, a `#label` search, or a title. Returns a note id.
     * Falling back to a title search is what makes "Clippings" work as a
     * destination without anyone copying ids out of Trilium.
     */
    async resolveParent(settings, destination) {
      let value = String(destination || "root").trim();
      if (!value || value.toLowerCase() === "root") return "root";

      // A note path, which is what copying from Trilium's address bar gives you:
      // "#root/QOqCGm9OjW7r/eRtjo9trRyAE", with or without the leading hash and
      // possibly with the whole server URL in front. The last segment is the
      // note itself. Without this the leading # made it look like a label search,
      // so nothing was ever found.
      const path = value.replace(/^.*#/, "");
      // "#root" on its own is the tree root, not a label called "root".
      if (path.toLowerCase() === "root") return "root";
      if (path.includes("/")) {
        const last = path.split("/").filter(Boolean).pop();
        if (!last || last.toLowerCase() === "root") return "root";
        value = last;
      }

      if (/^[A-Za-z0-9_]{4,32}$/.test(value) && !value.includes(" ")) {
        try {
          const note = await this.getNote(settings, value);
          if (note?.noteId) return note.noteId;
        } catch { /* not an id after all — fall through to searching by title */ }
      }
      const query = value.startsWith("#") ? value : `note.title = "${value.replace(/"/g, '\\"')}"`;
      const results = await this.search(settings, query, { limit: 5 });
      if (results.length === 1) return results[0].noteId;
      if (results.length === 0) {
        throw new TriliumError(
          `No note found for destination "${value}". Use a note title, a note id, `
          + "a path copied from Trilium's address bar, or root.", 404);
      }
      // Picking one of several notes with the same title would quietly file the
      // clip in the wrong place, which is worse than refusing.
      throw new TriliumError(
        `${results.length} notes are called "${value}". Put one of these ids in “Save under” instead: `
        + results.map((note) => note.noteId).join(", "), 409);
    },
  };

  root.Trilium = Trilium;
})(typeof self !== "undefined" ? self : this);
