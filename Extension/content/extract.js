/* Runs in the page. Collects everything a template might refer to and hands it
 * back to the extension; nothing is sent anywhere from here. */
(function () {
  "use strict";
  if (window.__triClipperReady) return;
  window.__triClipperReady = true;

  const api = globalThis.browser ?? globalThis.chrome;
  // <base href> wins over the page address for relative URLs, and Readability
  // already resolves against it; the sanitizer has to agree or links split.
  const BASE = document.baseURI || location.href;

  /* --- metadata ------------------------------------------------------- */

  function metaBag() {
    const bag = {};
    for (const tag of document.querySelectorAll("meta[name], meta[property], meta[itemprop]")) {
      const key = tag.getAttribute("property") || tag.getAttribute("name") || tag.getAttribute("itemprop");
      const value = tag.getAttribute("content");
      if (key && value && !(key in bag)) bag[key] = value;
    }
    return bag;
  }

  /** JSON-LD blocks, flattened so {{schema:author.name}} works regardless of nesting. */
  function schemaBag() {
    const bag = {};
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let parsed;
      try {
        parsed = JSON.parse(script.textContent);
      } catch {
        continue; // A malformed block on one site should not cost us the others.
      }
      const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
      while (queue.length) {
        const node = queue.shift();
        if (!node || typeof node !== "object") continue;
        if (Array.isArray(node["@graph"])) queue.push(...node["@graph"]);
        for (const [key, value] of Object.entries(node)) {
          if (key === "@graph") continue;
          if (!(key in bag)) bag[key] = value;
        }
      }
    }
    return bag;
  }

  function firstOf(...values) {
    for (const value of values) {
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
  }

  function authorFrom(meta, schema) {
    const candidates = [
      meta["author"], meta["article:author"], meta["parsely-author"],
      meta["twitter:creator"], meta["citation_author"],
    ];
    const fromSchema = schema.author ?? schema.creator;
    if (Array.isArray(fromSchema)) {
      candidates.push(fromSchema.map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean).join(", "));
    } else if (fromSchema && typeof fromSchema === "object") {
      candidates.push(fromSchema.name);
    } else if (typeof fromSchema === "string") {
      candidates.push(fromSchema);
    }
    const node = document.querySelector('[rel="author"], [itemprop="author"], .byline, .author');
    candidates.push(node?.textContent);
    return firstOf(...candidates).replace(/^\s*(by|door|van)\s+/i, "");
  }

  function publishedFrom(meta, schema) {
    return firstOf(
      meta["article:published_time"], meta["datePublished"], meta["citation_publication_date"],
      typeof schema.datePublished === "string" ? schema.datePublished : "",
      document.querySelector("time[datetime]")?.getAttribute("datetime")
    );
  }

  function faviconUrl() {
    const link = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    return link ? Sanitize.absolute(link.getAttribute("href"), BASE) : new URL("/favicon.ico", BASE).href;
  }

  /* --- content -------------------------------------------------------- */

  function articleHtml() {
    // Readability rewrites the document it is given, so it never sees the real one.
    try {
      const clone = document.cloneNode(true);
      const article = new Readability(clone, { charThreshold: 250 }).parse();
      if (article?.content) {
        return { html: article.content, title: article.title, excerpt: article.excerpt, byline: article.byline };
      }
    } catch (error) {
      console.warn("Tri Clipper: Readability failed,falling back to <body>", error);
    }
    const main = document.querySelector("article, main, [role=main]") || document.body;
    return { html: main.innerHTML, title: "", excerpt: "", byline: "" };
  }

  function selectionHtml() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return "";
    const holder = document.createElement("div");
    for (let i = 0; i < selection.rangeCount; i++) {
      holder.appendChild(selection.getRangeAt(i).cloneContents());
    }
    return holder.innerHTML;
  }

  /** {{selector:h1}} and {{selectorHtml:.price}} are resolved here, where the DOM is. */
  function resolveSelectors(names) {
    const text = {};
    const html = {};
    for (const name of names || []) {
      const [prefix, ...rest] = name.split(":");
      const query = rest.join(":");
      if (!query) continue;
      let node = null;
      try {
        node = document.querySelector(query);
      } catch {
        continue; // An invalid selector in a template is not worth failing the clip over.
      }
      if (!node) continue;
      if (prefix === "selector") text[query] = node.textContent.trim().replace(/\s+/g, " ");
      if (prefix === "selectorHtml") html[query] = Sanitize.sanitize(node, BASE);
    }
    return { text, html };
  }

  /* --- assembly -------------------------------------------------------- */

  function extract(request) {
    const meta = metaBag();
    const schema = schemaBag();
    const article = articleHtml();
    const selection = selectionHtml();
    const highlights = window.__triClipperHighlights?.list() ?? [];
    const selectors = resolveSelectors(request.variables);

    const leadImage = Sanitize.absolute(firstOf(meta["og:image"], meta["twitter:image"]), BASE);

    const clean = {
      article: Sanitize.withLeadImage(Sanitize.sanitize(article.html, BASE), leadImage),
      selection: selection ? Sanitize.sanitize(selection, BASE) : "",
      page: "",
      highlights: highlights.map((h) => Sanitize.sanitize(h.html, BASE)),
    };
    if (request.needsFullPage) clean.page = Sanitize.sanitize(document.body, BASE);

    return {
      url: location.href,
      domain: location.hostname.replace(/^www\./, ""),
      path: location.pathname,
      title: firstOf(meta["og:title"], article.title, document.title, document.querySelector("h1")?.textContent),
      pageTitle: document.title,
      author: authorFrom(meta, schema),
      published: publishedFrom(meta, schema),
      description: firstOf(meta["description"], meta["og:description"], article.excerpt),
      excerpt: firstOf(article.excerpt, meta["description"], meta["og:description"]),
      site: firstOf(meta["og:site_name"], meta["application-name"], location.hostname),
      image: leadImage,
      favicon: faviconUrl(),
      language: document.documentElement.lang || "",
      wordCount: (Sanitize.sanitize(article.html, BASE).replace(/<[^>]*>/g, " ").match(/\S+/g) || []).length,
      hasSelection: selection.length > 0,
      highlightCount: highlights.length,
      content: clean,
      meta,
      schema,
      selector: selectors.text,
      selectorHtml: selectors.html,
    };
  }

  api.runtime.onMessage.addListener((request, _sender, respond) => {
    if (request?.action === "extract") {
      try {
        respond({ ok: true, data: extract(request) });
      } catch (error) {
        respond({ ok: false, error: String(error?.message || error) });
      }
      return true;
    }
    if (request?.action === "highlight-toggle") {
      respond({ ok: true, active: window.__triClipperHighlights?.toggle() ?? false });
      return true;
    }
    if (request?.action === "highlight-clear") {
      window.__triClipperHighlights?.clear();
      respond({ ok: true });
      return true;
    }
    return false;
  });
})();
