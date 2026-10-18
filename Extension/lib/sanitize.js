/* Turns arbitrary page markup into the small HTML subset Trilium's editor keeps.
 *
 * Trilium stores text notes as HTML and re-serialises them through CKEditor on
 * first edit; anything outside its schema (classes, ids, inline styles, custom
 * elements) is dropped there anyway. Dropping it here instead keeps the note
 * that arrives identical to the note you see later, and keeps script out.
 */
(function (root) {
  "use strict";

  const ALLOWED = {
    p: [], br: [], hr: [],
    h1: [], h2: [], h3: [], h4: [], h5: [], h6: [],
    ul: [], ol: ["start"], li: [],
    blockquote: [], pre: [], code: [], kbd: [], samp: [],
    strong: [], b: [], em: [], i: [], u: [], s: [], del: [], ins: [], mark: [],
    sub: [], sup: [], small: [], span: [],
    a: ["href", "title"],
    img: ["src", "alt", "title", "width", "height"],
    figure: [], figcaption: [],
    table: [], thead: [], tbody: [], tfoot: [], tr: [],
    th: ["colspan", "rowspan"], td: ["colspan", "rowspan"],
    dl: [], dt: [], dd: [],
  };

  /** Replaced by their children rather than dropped, so the text survives. */
  const UNWRAP = new Set(["div", "section", "article", "main", "header", "footer",
    "aside", "nav", "font", "center", "time", "abbr", "cite", "q", "picture", "body"]);

  const DROP = new Set(["script", "style", "noscript", "iframe", "object", "embed",
    "svg", "canvas", "form", "input", "button", "select", "textarea", "template",
    "link", "meta", "video", "audio", "source", "track", "map", "area", "dialog"]);

  function absolute(url, base) {
    if (!url) return "";
    try {
      return new URL(url, base).href;
    } catch {
      return "";
    }
  }

  function safeHref(url, base) {
    const resolved = absolute(url, base);
    return /^(https?|mailto|tel):/i.test(resolved) ? resolved : "";
  }

  /**
   * Lazy-loaded images usually carry a placeholder in `src` and the real file in
   * a data attribute; without this the note fills up with 1x1 spacer gifs.
   */
  /** Widest candidate wins: the note outlives the viewport it was clipped at. */
  function widestOf(srcset) {
    if (!srcset) return null;
    const widest = srcset.split(",")
      .map((part) => part.trim().split(/\s+/))
      .map(([url, size]) => ({ url, width: parseInt(size, 10) || 0 }))
      .sort((a, b) => b.width - a.width)[0];
    return widest ? widest.url : null;
  }

  function imageSource(img, base) {
    const candidates = [
      img.getAttribute("src"),
      img.getAttribute("data-src"),
      img.getAttribute("data-original"),
      img.getAttribute("data-lazy-src"),
    ];
    const own = widestOf(img.getAttribute("srcset") || img.getAttribute("data-srcset"));
    if (own) candidates.unshift(own);

    // <picture><source srcset><img></picture>: the img can be an empty shell whose
    // only job is to be a box, with every real file on the sources. Dropping it
    // meant a page's own photographs went missing while the odd plain <img>
    // elsewhere came through.
    const picture = img.parentElement;
    if (picture && picture.tagName && picture.tagName.toLowerCase() === "picture") {
      for (const source of picture.querySelectorAll("source")) {
        const url = widestOf(source.getAttribute("srcset") || source.getAttribute("data-srcset"));
        if (url) candidates.push(url);
      }
    }
    for (const candidate of candidates) {
      const resolved = absolute(candidate, base);
      if (resolved && /^https?:/i.test(resolved)) return resolved;
    }
    return "";
  }

  function clean(node, base, out) {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 3) {
        out.appendChild(out.ownerDocument.createTextNode(child.nodeValue));
        continue;
      }
      if (child.nodeType !== 1) continue;

      const tag = child.tagName.toLowerCase();
      if (DROP.has(tag)) continue;

      // A wrapper contributes nothing itself, but its children might.
      if (UNWRAP.has(tag) || !ALLOWED[tag]) {
        clean(child, base, out);
        continue;
      }

      const copy = out.ownerDocument.createElement(tag);
      for (const attribute of ALLOWED[tag]) {
        let value = child.getAttribute(attribute);
        if (attribute === "href") value = safeHref(value, base);
        if (attribute === "src") value = tag === "img" ? imageSource(child, base) : absolute(value, base);
        if (value) copy.setAttribute(attribute, value);
      }
      if (tag === "img" && !copy.getAttribute("src")) continue;
      // A link wrapped around a picture turns the picture into a tap target. In
      // a saved note that is a hazard rather than a feature: flick-scrolling on
      // a phone lands a finger on the image and navigates away mid-scroll.
      // Trilium's own pasted images are never inside a link, so match that and
      // keep the words, dropping only the link. It also unpicks the invalid
      // <a><p>…</p></a> nesting these cards come with.
      if (tag === "a" && (!copy.getAttribute("href") || child.querySelector("img"))) {
        clean(child, base, out);
        continue;
      }
      clean(child, base, copy);
      if (copy.childNodes.length === 0 && !["img", "br", "hr", "td", "th"].includes(tag)) continue;
      out.appendChild(copy);
    }
    return out;
  }

  /** `input` is an Element or an HTML string; returns an HTML string. */
  /**
   * Lazy-loading scripts often keep the plain <img> in a <noscript> beside the
   * one they animate. With scripting on, that markup is inert text, so nothing
   * downstream can see it. Promote it, but only where the visible image yields
   * nothing — otherwise the note gets every photograph twice.
   */
  function promoteNoscriptImages(source, base) {
    for (const noscript of [...source.querySelectorAll("noscript")]) {
      const parent = noscript.parentElement;
      if (!parent) continue;
      const holder = noscript.ownerDocument.createElement("div");
      // Its children are text when scripting is enabled, real nodes when parsed
      // from a string; textContent covers the first, innerHTML the second.
      holder.innerHTML = noscript.childElementCount ? noscript.innerHTML : noscript.textContent;
      const images = holder.querySelectorAll("img");
      if (images.length !== 1) continue;
      const alreadyShown = [...parent.querySelectorAll("img")]
        .some((img) => !noscript.contains(img) && imageSource(img, base));
      if (alreadyShown) continue;
      parent.replaceChild(images[0], noscript);
    }
  }

  /* Readability grows the article by pulling in siblings that score well, and a
   * figure holding nothing but a photograph scores nothing. On a news page that
   * loses the article's own pictures while the text-bearing "read more" tiles
   * below it are kept — exactly the wrong way round. The page already names its
   * main picture in og:image, so put that back at the top. */
  function imageKey(url) {
    try {
      return new URL(url).pathname.split("/")
        // Two links to one photograph differ only in the size baked into the
        // path: "…-768x432.webp" against "…-1024x576.webp", "500px-x.jpg"
        // against "960px-x.jpg". Strip those and the rest still matches.
        .map((part) => part.replace(/\d+x\d+/g, "").replace(/\d+px/g, "")
                            .replace(/^[-_.]+|[-_.]+$/g, ""))
        .filter(Boolean)
        .sort((a, b) => b.length - a.length)[0] || "";
    } catch {
      return "";
    }
  }

  function withLeadImage(html, image) {
    if (!image || !html) return html;
    const key = imageKey(image);
    const already = (html.match(/<img[^>]+src="([^"]+)"/g) || [])
      .some((tag) => {
        const src = tag.match(/src="([^"]+)"/)[1];
        return src === image || (key && imageKey(src) === key);
      });
    if (already) return html;
    return `<p><img src="${image.replace(/"/g, "&quot;")}" alt=""></p>` + html;
  }

  function sanitize(input, baseUrl) {
    const doc = document.implementation.createHTMLDocument("");
    let source = input;
    if (typeof input === "string") {
      source = doc.createElement("div");
      source.innerHTML = input;
    }
    const base = baseUrl || document.baseURI || location.href;
    // On a live document this would edit the page, so work on a copy.
    source = source.cloneNode(true);
    promoteNoscriptImages(source, base);
    const target = doc.createElement("div");
    clean(source, base, target);
    return target.innerHTML
      .replace(/(<p>(\s|&nbsp;|<br\s*\/?>)*<\/p>)+/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  root.Sanitize = { sanitize, absolute, withLeadImage };
})(typeof self !== "undefined" ? self : this);
