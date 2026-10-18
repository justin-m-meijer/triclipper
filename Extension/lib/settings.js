/* Settings and templates, stored in the extension's own local storage.
 *
 * A template decides four things: where the note goes, what it is called, what
 * labels it carries, and what its body is. Everything else is shared setup. */
(function (root) {
  "use strict";

  const api = globalThis.browser ?? globalThis.chrome;

  const HEADER = [
    '<p><a href="{{url|escape}}">{{title}}</a>{{site|default:""}}</p>',
  ].join("");

  const DEFAULT_TEMPLATES = [
    {
      id: "article",
      name: "Article",
      destination: "Clippings",
      triggers: [],
      mode: "article",
      titleTemplate: "{{title|safe}}",
      labels: [
        { name: "clipUrl", value: "{{url}}" },
        { name: "clipped", value: '{{date|date:"YYYY-MM-DD HH:mm"}}' },
        { name: "author", value: "{{author}}" },
        { name: "published", value: '{{published|date:"YYYY-MM-DD"}}' },
        { name: "site", value: "{{site}}" },
      ],
      contentTemplate:
        '<blockquote><p>{{excerpt|truncate:300}}</p></blockquote>\n' +
        '<p><a href="{{url|escape}}">{{domain}}</a> · {{author|default:"unknown author"}}</p>\n' +
        "<hr>\n{{content}}",
      appendToExisting: false,
    },
    {
      id: "selection",
      name: "Selection",
      destination: "Clippings",
      triggers: [],
      mode: "selection",
      titleTemplate: "{{title|safe}}",
      labels: [
        { name: "clipUrl", value: "{{url}}" },
        { name: "clipped", value: '{{date|date:"YYYY-MM-DD HH:mm"}}' },
      ],
      contentTemplate: "{{content}}\n<p><a href=\"{{url}}\">{{title}}</a></p>",
      appendToExisting: true,
    },
    {
      id: "highlights",
      name: "Highlights",
      destination: "Clippings",
      triggers: [],
      mode: "highlights",
      titleTemplate: "{{title|safe}}",
      labels: [
        { name: "clipUrl", value: "{{url}}" },
        { name: "clipped", value: '{{date|date:"YYYY-MM-DD HH:mm"}}' },
      ],
      contentTemplate: "{{content}}\n<p><a href=\"{{url}}\">{{title}}</a></p>",
      appendToExisting: true,
    },
    {
      id: "bookmark",
      name: "Bookmark",
      destination: "Clippings",
      triggers: [],
      mode: "bookmark",
      titleTemplate: "{{title|safe}}",
      labels: [
        { name: "clipUrl", value: "{{url}}" },
        { name: "clipped", value: '{{date|date:"YYYY-MM-DD HH:mm"}}' },
        { name: "site", value: "{{site}}" },
      ],
      contentTemplate: HEADER + "\n<p>{{description}}</p>",
      appendToExisting: false,
    },
  ];

  const DEFAULTS = {
    serverUrl: "",
    token: "",
    transport: "native",
    templates: DEFAULT_TEMPLATES,
    defaultTemplateId: "article",
    urlLabel: "clipUrl",
    openAfterClip: false,
    recentDestinations: [],
    showNotification: true,
  };

  /** Matches "example.com", "https://example.com/blog/", or "/^https:\/\/.*\/docs\//". */
  function triggerMatches(trigger, url) {
    const pattern = String(trigger || "").trim();
    if (!pattern) return false;
    if (pattern.length > 2 && pattern.startsWith("/") && pattern.endsWith("/")) {
      try {
        return new RegExp(pattern.slice(1, -1)).test(url);
      } catch {
        return false; // A broken pattern must not shadow the templates below it.
      }
    }
    if (pattern.startsWith("http://") || pattern.startsWith("https://")) return url.startsWith(pattern);
    try {
      return new URL(url).hostname.replace(/^www\./, "").endsWith(pattern.replace(/^www\./, ""));
    } catch {
      return false;
    }
  }

  /**
   * First template with a matching trigger wins, so ordering in the options page
   * is the tie-breaker. Nothing matching falls back to the chosen default.
   */
  function pickTemplate(settings, url) {
    for (const template of settings.templates) {
      if ((template.triggers || []).some((trigger) => triggerMatches(trigger, url))) return template;
    }
    return settings.templates.find((t) => t.id === settings.defaultTemplateId) ?? settings.templates[0];
  }

  async function load() {
    const stored = await api.storage.local.get(Object.keys(DEFAULTS));
    const settings = { ...DEFAULTS, ...stored };
    if (!Array.isArray(settings.templates) || settings.templates.length === 0) {
      settings.templates = DEFAULT_TEMPLATES;
    }
    return settings;
  }

  function save(patch) {
    return api.storage.local.set(patch);
  }

  async function rememberDestination(destination) {
    if (!destination) return;
    const { recentDestinations = [] } = await api.storage.local.get("recentDestinations");
    const next = [destination, ...recentDestinations.filter((d) => d !== destination)].slice(0, 8);
    await save({ recentDestinations: next });
  }

  root.Settings = {
    DEFAULTS, DEFAULT_TEMPLATES, load, save, pickTemplate, triggerMatches, rememberDestination,
  };
})(typeof self !== "undefined" ? self : this);
