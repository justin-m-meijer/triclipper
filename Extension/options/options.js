/* Settings page. Everything saves as you type; there is no Save button to forget. */
(function () {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;
  const $ = (id) => document.getElementById(id);

  let settings = null;
  let selectedId = null;
  let saveTimer = null;

  const VARIABLES = [
    ["{{title}}", "page title"],
    ["{{url}}", "page address"],
    ["{{domain}}", "host, without www"],
    ["{{path}}", "path part of the address"],
    ["{{author}}", "byline, if the page names one"],
    ["{{published}}", "publication date"],
    ["{{site}}", "site name"],
    ["{{description}}", "meta description"],
    ["{{excerpt}}", "first lines of the article"],
    ["{{image}}", "lead image address"],
    ["{{favicon}}", "site icon address"],
    ["{{language}}", "page language"],
    ["{{wordCount}}", "words in the article"],
    ["{{content}}", "the clipped body itself"],
    ["{{selection}}", "what was selected"],
    ["{{date}}", "now — pair with |date:\"…\""],
    ["{{meta:og:title}}", "any meta tag by name"],
    ["{{schema:author.name}}", "any JSON-LD field"],
    ["{{selector:h1}}", "text of the first match"],
    ["{{selectorHtml:.price}}", "html of the first match"],
  ];

  const FILTER_HELP = [
    ["|upper |lower |title", "change case"],
    ["|trim |truncate:120", "shorten"],
    ["|slug |safe", "make it fit a title"],
    ["|split:\",\" |first |last |join:\", \"", "lists"],
    ["|date:\"YYYY-MM-DD\"", "format a date"],
    ["|replace:\"a\",\"b\" |striptags |escape", "clean up"],
    ["|default:\"unknown\"", "when it is empty"],
  ];

  /* --- saving ---------------------------------------------------------- */

  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      await Settings.save(settings);
      $("saved").textContent = "Saved";
      setTimeout(() => ($("saved").textContent = ""), 1200);
    }, 300);
  }

  /* --- templates -------------------------------------------------------- */

  function selected() {
    return settings.templates.find((t) => t.id === selectedId) ?? settings.templates[0];
  }

  function renderList() {
    const list = $("template-list");
    list.innerHTML = "";
    for (const template of settings.templates) {
      const item = document.createElement("li");
      item.setAttribute("aria-selected", String(template.id === selectedId));
      const name = document.createElement("div");
      name.textContent = template.name;
      const hint = document.createElement("small");
      hint.textContent = (template.triggers || []).length
        ? (template.triggers || []).join(", ")
        : "no automatic match";
      item.append(name, hint);
      item.addEventListener("click", () => {
        selectedId = template.id;
        renderList();
        renderEditor();
      });
      list.appendChild(item);
    }

    const select = $("defaultTemplateId");
    select.innerHTML = "";
    for (const template of settings.templates) {
      const option = document.createElement("option");
      option.value = template.id;
      option.textContent = template.name;
      select.appendChild(option);
    }
    select.value = settings.defaultTemplateId;
  }

  function labelRow(name, value) {
    const row = document.createElement("div");
    row.className = "label-row";
    for (const [className, placeholder, initial] of
         [["label-name", "name", name], ["label-value", "value", value]]) {
      const input = document.createElement("input");
      input.type = "text";
      input.className = className;
      input.placeholder = placeholder;
      input.value = initial;
      input.addEventListener("input", collectLabels);
      row.appendChild(input);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      row.remove();
      collectLabels();
    });
    row.appendChild(remove);
    return row;
  }

  function collectLabels() {
    selected().labels = [...document.querySelectorAll("#t-labels .label-row")]
      .map((row) => ({
        name: row.querySelector(".label-name").value.trim(),
        value: row.querySelector(".label-value").value,
      }))
      .filter((label) => label.name);
    renderList();
    queueSave();
  }

  function renderEditor() {
    const template = selected();
    selectedId = template.id;
    $("t-name").value = template.name;
    $("t-destination").value = template.destination || "";
    $("t-mode").value = template.mode || "article";
    $("t-triggers").value = (template.triggers || []).join("\n");
    $("t-title").value = template.titleTemplate || "";
    $("t-content").value = template.contentTemplate || "";
    $("t-append").checked = Boolean(template.appendToExisting);

    const box = $("t-labels");
    box.innerHTML = "";
    for (const label of template.labels || []) box.appendChild(labelRow(label.name, label.value));

    // The built-in set is what a fresh install falls back to; keeping at least
    // one template means the popup always has something to show.
    $("delete-template").disabled = settings.templates.length <= 1;
  }

  function bindEditor() {
    const fields = {
      "t-name": (t, v) => (t.name = v),
      "t-destination": (t, v) => (t.destination = v),
      "t-mode": (t, v) => (t.mode = v),
      "t-title": (t, v) => (t.titleTemplate = v),
      "t-content": (t, v) => (t.contentTemplate = v),
      "t-triggers": (t, v) => (t.triggers = v.split("\n").map((s) => s.trim()).filter(Boolean)),
    };
    for (const [id, apply] of Object.entries(fields)) {
      $(id).addEventListener("input", (event) => {
        apply(selected(), event.target.value);
        renderList();
        queueSave();
      });
    }
    $("t-append").addEventListener("change", (event) => {
      selected().appendToExisting = event.target.checked;
      queueSave();
    });
    $("t-add-label").addEventListener("click", () => {
      $("t-labels").appendChild(labelRow("", ""));
    });
  }

  function newId(name) {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "template";
    let id = base;
    let n = 2;
    while (settings.templates.some((t) => t.id === id)) id = `${base}-${n++}`;
    return id;
  }

  /* --- connection -------------------------------------------------------- */

  async function testConnection() {
    const result = $("test-result");
    result.className = "result";
    result.textContent = "Checking…";
    const response = await api.runtime.sendMessage({
      action: "test-connection",
      settings: {
        serverUrl: $("serverUrl").value.trim(),
        token: $("token").value.trim(),
        transport: $("transport").value,
      },
    });
    if (response?.ok) {
      result.className = "result ok";
      result.textContent = `Trilium ${response.version} answered.`;
    } else {
      result.className = "result error";
      result.textContent = response?.error || "No answer.";
    }
  }

  /* --- import and export -------------------------------------------------- */

  function exportTemplates() {
    const blob = new Blob([JSON.stringify(settings.templates, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "tri-clipper-templates.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  async function importTemplates(file) {
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed) || !parsed.every((t) => t && typeof t.name === "string")) {
        throw new Error("That file does not look like a template export.");
      }
      // Imported ids are re-minted so an import never silently overwrites a
      // template that happens to share a name.
      for (const template of parsed) {
        template.id = newId(template.name);
        settings.templates.push(template);
      }
      selectedId = settings.templates[settings.templates.length - 1].id;
      renderList();
      renderEditor();
      queueSave();
      $("saved").textContent = `Imported ${parsed.length} templates`;
    } catch (error) {
      $("saved").textContent = error.message;
    }
  }

  /* --- help ---------------------------------------------------------------- */

  function renderHelp() {
    const box = $("variable-help");
    for (const [name, description] of [...VARIABLES, ...FILTER_HELP]) {
      const row = document.createElement("div");
      const code = document.createElement("code");
      code.textContent = name;
      row.append(code, document.createTextNode(" — " + description));
      box.appendChild(row);
    }
  }

  /* --- start ---------------------------------------------------------------- */

  async function start() {
    settings = await Settings.load();
    selectedId = settings.templates[0].id;

    for (const id of ["serverUrl", "token", "urlLabel", "transport"]) {
      $(id).value = settings[id] ?? "";
      $(id).addEventListener("input", () => {
        settings[id] = $(id).value.trim();
        queueSave();
      });
      $(id).addEventListener("change", () => {
        settings[id] = $(id).value.trim();
        queueSave();
      });
    }
    for (const id of ["showNotification", "openAfterClip"]) {
      $(id).checked = Boolean(settings[id]);
      $(id).addEventListener("change", () => {
        settings[id] = $(id).checked;
        queueSave();
      });
    }
    $("defaultTemplateId").addEventListener("change", (event) => {
      settings.defaultTemplateId = event.target.value;
      queueSave();
    });

    $("test").addEventListener("click", testConnection);
    $("add-template").addEventListener("click", () => {
      const template = { ...Settings.DEFAULT_TEMPLATES[0], id: newId("new template"), name: "New template", triggers: [] };
      settings.templates.push(template);
      selectedId = template.id;
      renderList();
      renderEditor();
      queueSave();
    });
    $("duplicate-template").addEventListener("click", () => {
      const copy = JSON.parse(JSON.stringify(selected()));
      copy.name += " copy";
      copy.id = newId(copy.name);
      settings.templates.push(copy);
      selectedId = copy.id;
      renderList();
      renderEditor();
      queueSave();
    });
    $("delete-template").addEventListener("click", () => {
      if (settings.templates.length <= 1) return;
      settings.templates = settings.templates.filter((t) => t.id !== selectedId);
      if (settings.defaultTemplateId === selectedId) settings.defaultTemplateId = settings.templates[0].id;
      selectedId = settings.templates[0].id;
      renderList();
      renderEditor();
      queueSave();
    });
    $("export").addEventListener("click", exportTemplates);
    $("import").addEventListener("click", () => $("import-file").click());
    $("import-file").addEventListener("change", (event) => {
      if (event.target.files[0]) importTemplates(event.target.files[0]);
      event.target.value = "";
    });
    $("reset").addEventListener("click", () => {
      settings.templates = JSON.parse(JSON.stringify(Settings.DEFAULT_TEMPLATES));
      settings.defaultTemplateId = "article";
      selectedId = settings.templates[0].id;
      renderList();
      renderEditor();
      queueSave();
    });

    bindEditor();
    renderList();
    renderEditor();
    renderHelp();
  }

  start();
})();
