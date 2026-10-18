/* Turns extracted page data plus a template into a Trilium note. */
(function (root) {
  "use strict";

  /** The body HTML a mode contributes, before the content template wraps it. */
  function bodyFor(mode, data) {
    const content = data.content || {};
    switch (mode) {
      case "selection":
        // Falling back to the article means the Selection template still does
        // something sensible when invoked without a selection.
        return content.selection || content.article || "";
      case "page":
        return content.page || content.article || "";
      case "bookmark":
        return "";
      case "highlights":
        return (content.highlights || [])
          .map((html) => `<blockquote>${html}</blockquote>`)
          .join("\n");
      case "article":
      default:
        return content.article || "";
    }
  }

  function variablesFor(template) {
    const sources = [template.titleTemplate, template.contentTemplate,
      ...(template.labels || []).map((label) => label.value)];
    const names = new Set();
    for (const source of sources) {
      for (const name of Templates.variablesUsed(source)) names.add(name);
    }
    return [...names];
  }

  /** Renders title, labels and content. `overrides` come from the popup's fields. */
  function buildPayload(template, data, overrides = {}) {
    const body = overrides.body ?? bodyFor(overrides.mode ?? template.mode, data);
    const scope = { ...data, content: body, selection: data.content?.selection || "", date: new Date() };

    const title = (overrides.title ?? Templates.render(template.titleTemplate, scope)).trim()
      || data.title || data.url;

    // The popup shows rendered labels and lets them be edited, so when it sends
    // a list back that list is authoritative — re-rendering would undo the edit.
    const labels = (overrides.labels ?? template.labels ?? [])
      .map((label) => ({
        name: String(label.name || "").trim(),
        value: overrides.labels ? String(label.value ?? "").trim()
                                : Templates.render(label.value, scope).trim(),
      }))
      // An empty label is noise in Trilium's attribute list, so drop it rather
      // than writing #author with nothing after it.
      .filter((label) => label.name && label.value);

    for (const extra of overrides.extraLabels || []) {
      if (extra.name) labels.push({ name: extra.name.trim(), value: String(extra.value ?? "").trim() });
    }

    return {
      title: title.slice(0, 250),
      content: Templates.render(template.contentTemplate, scope).trim(),
      labels,
      destination: overrides.destination ?? template.destination,
      appendToExisting: overrides.appendToExisting ?? template.appendToExisting,
    };
  }

  async function clip(settings, template, data, overrides = {}) {
    const payload = buildPayload(template, data, overrides);
    const parentNoteId = await Trilium.resolveParent(settings, payload.destination);

    if (payload.appendToExisting) {
      const existing = await Trilium.findByUrl(settings, data.url, settings.urlLabel);
      if (existing) {
        const current = await Trilium.getContent(settings, existing.noteId);
        const separator = '<hr>';
        await Trilium.setContent(settings, existing.noteId,
          `${typeof current === "string" ? current : ""}${separator}${payload.content}`);
        return { noteId: existing.noteId, title: existing.title, appended: true, parentNoteId };
      }
    }

    const created = await Trilium.createNote(settings, {
      parentNoteId,
      title: payload.title,
      content: payload.content || "<p></p>",
    });
    const noteId = created?.note?.noteId;
    if (!noteId) throw new Error("Trilium created no note.");

    // Labels are separate calls; one failing should not lose the note that
    // already exists, so they are reported rather than thrown.
    const failed = [];
    for (const label of payload.labels) {
      try {
        await Trilium.addLabel(settings, noteId, label.name, label.value);
      } catch (error) {
        failed.push(`${label.name}: ${error.message}`);
      }
    }
    return { noteId, title: payload.title, appended: false, parentNoteId, failedLabels: failed };
  }

  root.Clipper = { clip, buildPayload, bodyFor, variablesFor };
})(typeof self !== "undefined" ? self : this);
