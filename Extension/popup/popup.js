/* The popup shows what will actually be written to Trilium — rendered title,
 * rendered labels, rendered body — and sends those exact values back, so what
 * you approve is what you get. */
(function () {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;
  const $ = (id) => document.getElementById(id);

  const MODES = [
    { id: "article", label: "Article" },
    { id: "selection", label: "Selection" },
    { id: "highlights", label: "Highlights" },
    { id: "page", label: "Page" },
    { id: "bookmark", label: "Link" },
  ];

  let state = { data: null, settings: null, template: null, mode: "article" };

  /* An iPhone puts the popup in a sheet shorter than the page, so the Clip
   * button has to sit near the top or it is never on screen. iPad and macOS
   * show a popover tall enough for the ordinary layout, and an iPad reports
   * itself as a Mac, so testing for the phone covers exactly the right case.
   * The width test is a fallback and deliberately not the main signal: Safari
   * reports the popup's layout viewport as the body's own width, not the
   * sheet's, so it reads 420px on a 402pt screen. */
  if (/iPhone|iPod/.test(navigator.userAgent) || window.innerWidth < 420) {
    document.body.classList.add("compact");
  }

  /* --- rendering ------------------------------------------------------- */

  function say(text, kind) {
    const node = $("message");
    node.textContent = text || "";
    node.className = "message" + (kind ? " " + kind : "");
  }

  function renderTemplates() {
    const select = $("template");
    select.innerHTML = "";
    for (const template of state.settings.templates) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      select.appendChild(option);
    }
    select.value = state.template.id;
  }

  function renderModes() {
    const box = $("modes");
    box.innerHTML = "";
    for (const mode of MODES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chip";
      button.textContent = mode.label;
      button.setAttribute("aria-pressed", String(mode.id === state.mode));
      // Offering "Selection" with nothing selected would produce a silent
      // fallback to the article; disabling says so up front.
      if (mode.id === "selection" && !state.data.hasSelection) button.disabled = true;
      if (mode.id === "highlights" && state.data.highlightCount === 0) button.disabled = true;
      button.addEventListener("click", () => {
        // The whole page is only read when asked for, so switching to it the
        // first time means going back to the tab for the rest of the markup.
        if (mode.id === "page" && !state.data.content.page) {
          load(state.template.id, "page");
          return;
        }
        state.mode = mode.id;
        renderModes();
        renderPreview();
      });
      box.appendChild(button);
    }
  }

  function labelRow(name, value) {
    const row = document.createElement("div");
    row.className = "label-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = name;
    nameInput.placeholder = "name";
    nameInput.className = "label-name";

    const valueInput = document.createElement("input");
    valueInput.type = "text";
    valueInput.value = value;
    valueInput.placeholder = "value";
    valueInput.className = "label-value";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.title = "Remove this label";
    remove.addEventListener("click", () => row.remove());

    row.append(nameInput, valueInput, remove);
    return row;
  }

  function renderLabels(labels) {
    const box = $("labels");
    box.innerHTML = "";
    for (const label of labels) box.appendChild(labelRow(label.name, label.value));
  }

  function currentLabels() {
    return [...document.querySelectorAll(".label-row")]
      .map((row) => ({
        name: row.querySelector(".label-name").value.trim(),
        value: row.querySelector(".label-value").value.trim(),
      }))
      .filter((label) => label.name);
  }

  function renderPreview() {
    const payload = Clipper.buildPayload(state.template, state.data, { mode: state.mode });
    const words = payload.content.replace(/<[^>]*>/g, " ").match(/\S+/g)?.length ?? 0;
    $("preview-meta").textContent = words ? `· ${words} words` : "· empty";
    // A sandboxed frame keeps the clipped page's markup from touching the popup,
    // and no-referrer keeps image loads from announcing the clip to the site.
    $("preview").srcdoc =
      '<meta charset="utf-8"><base target="_blank">' +
      '<style>body{font:13px/1.5 -apple-system,system-ui,sans-serif;margin:10px;color:#1c1c1e}' +
      "img{max-width:100%;height:auto}blockquote{margin:0 0 1em;padding-left:10px;" +
      "border-left:3px solid #ddd;color:#555}pre{overflow-x:auto;background:#f5f5f7;padding:8px;border-radius:4px}" +
      "table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:4px 6px}</style>" +
      payload.content;
  }

  function renderAll() {
    const payload = Clipper.buildPayload(state.template, state.data, { mode: state.mode });
    $("title").value = payload.title;
    $("destination").value = payload.destination || "";
    renderTemplates();
    renderModes();
    renderLabels(payload.labels);
    renderPreview();
    $("form").hidden = false;
    $("clip").disabled = false;
  }

  /* --- data ------------------------------------------------------------ */

  async function load(templateId, mode) {
    say("Reading the page…");
    const response = await api.runtime.sendMessage({ action: "page-data", templateId, mode });
    if (!response?.ok) {
      say(response?.error || "Could not read this page.", "error");
      return;
    }
    state.data = response.data;
    state.settings = response.settings;
    state.template = response.settings.templates.find((t) => t.id === response.templateId)
      ?? response.settings.templates[0];

    // A template asking for a selection that is not there would clip the whole
    // article instead; start on something the page can actually supply.
    state.mode = mode ?? state.template.mode;
    if (state.mode === "selection" && !state.data.hasSelection) state.mode = "article";
    if (state.mode === "highlights" && state.data.highlightCount === 0) state.mode = "article";

    fillDestinations(response.settings.recentDestinations || []);
    renderAll();

    if (!response.settings.serverUrl || !response.settings.token) {
      say("No server set yet — open settings first.", "error");
      $("clip").disabled = true;
    } else {
      say(state.data.highlightCount ? `${state.data.highlightCount} highlights on this page` : "");
    }
  }

  function fillDestinations(list) {
    const datalist = $("destinations");
    datalist.innerHTML = "";
    for (const value of list) {
      const option = document.createElement("option");
      option.value = value;
      datalist.appendChild(option);
    }
  }

  let searchTimer = null;
  function searchDestinations(query) {
    clearTimeout(searchTimer);
    if (query.trim().length < 2) return;
    searchTimer = setTimeout(async () => {
      const response = await api.runtime.sendMessage({ action: "search-notes", query });
      if (!response?.ok) return;
      const known = new Set((state.settings.recentDestinations || []));
      fillDestinations([...known, ...response.results.map((note) => note.title)]);
    }, 250);
  }

  /* --- actions ---------------------------------------------------------- */

  async function clip() {
    $("clip").disabled = true;
    say("Saving…");
    const response = await api.runtime.sendMessage({
      action: "clip",
      templateId: state.template.id,
      overrides: {
        title: $("title").value,
        destination: $("destination").value.trim() || "root",
        labels: currentLabels(),
        mode: state.mode,
      },
    });
    if (response?.ok) {
      say(response.result.appended ? "Added to the existing note." : "Saved to Trilium.", "ok");
      setTimeout(() => window.close(), 700);
    } else {
      say(response?.error || "Saving failed.", "error");
      $("clip").disabled = false;
    }
  }

  /* --- wiring ----------------------------------------------------------- */

  $("template").addEventListener("change", (event) => load(event.target.value));
  $("add-label").addEventListener("click", () => $("labels").appendChild(labelRow("", "")));
  $("destination").addEventListener("input", (event) => searchDestinations(event.target.value));
  $("clip").addEventListener("click", clip);
  $("open-options").addEventListener("click", () => {
    api.runtime.openOptionsPage();
    window.close();
  });
  $("highlight").addEventListener("click", async () => {
    const response = await api.runtime.sendMessage({ action: "toggle-highlight" });
    if (response?.ok) {
      $("highlight").setAttribute("aria-pressed", String(response.active));
      say(response.active ? "Highlight mode on — select text on the page." : "Highlight mode off");
    }
  });
  document.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") clip();
  });

  load();
})();
