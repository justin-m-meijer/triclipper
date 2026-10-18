/* Variable substitution for note titles, labels and content.
 *
 * A template is plain text with {{variable}} placeholders, each optionally
 * followed by filters: {{author|split:","|first|trim}}.
 * Unknown variables resolve to an empty string rather than being left in the
 * output, so a template written for one site does not leave debris on another.
 */
(function (root) {
  "use strict";

  const PLACEHOLDER = /\{\{\s*([^}]+?)\s*\}\}/g;

  /* --- filters ------------------------------------------------------- */

  const MONTHS = ["January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];
  const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  function pad(n, width) {
    return String(n).padStart(width || 2, "0");
  }

  /** Subset of the moment.js tokens, enough for note titles and labels. */
  function formatDate(value, pattern) {
    const d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return "";
    const map = {
      YYYY: d.getFullYear(),
      YY: pad(d.getFullYear() % 100),
      MMMM: MONTHS[d.getMonth()],
      MMM: MONTHS[d.getMonth()].slice(0, 3),
      MM: pad(d.getMonth() + 1),
      M: d.getMonth() + 1,
      DDDD: DAYS[d.getDay()],
      DDD: DAYS[d.getDay()].slice(0, 3),
      DD: pad(d.getDate()),
      D: d.getDate(),
      HH: pad(d.getHours()),
      H: d.getHours(),
      mm: pad(d.getMinutes()),
      m: d.getMinutes(),
      ss: pad(d.getSeconds()),
      s: d.getSeconds(),
    };
    // Longest tokens first, so YYYY is not eaten by YY.
    return String(pattern || "YYYY-MM-DD").replace(
      /YYYY|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|D|HH|H|mm|m|ss|s/g,
      (token) => map[token]
    );
  }

  function stripTags(html) {
    return String(html)
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function toArray(value) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined || value === "") return [];
    return [value];
  }

  const FILTERS = {
    upper: (v) => String(v).toUpperCase(),
    lower: (v) => String(v).toLowerCase(),
    trim: (v) => String(v).trim(),
    title: (v) => String(v).replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()),
    striptags: (v) => stripTags(v),
    escape: (v) => String(v).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    slug: (v) => String(v).toLowerCase().normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "").slice(0, 80),
    // Trilium note titles cannot contain a forward slash without reading as a path.
    safe: (v) => String(v).replace(/[\/\\]/g, "-").replace(/\s+/g, " ").trim(),
    split: (v, sep) => String(v).split(sep === undefined ? "," : sep).map((s) => s.trim()).filter(Boolean),
    join: (v, sep) => toArray(v).join(sep === undefined ? ", " : sep),
    first: (v) => toArray(v)[0] ?? "",
    last: (v) => toArray(v).slice(-1)[0] ?? "",
    length: (v) => (Array.isArray(v) ? v.length : String(v).length),
    replace: (v, from, to) => String(v).split(from).join(to === undefined ? "" : to),
    truncate: (v, n) => {
      const s = String(v);
      const max = parseInt(n, 10) || 100;
      return s.length <= max ? s : s.slice(0, max).replace(/\s+\S*$/, "") + "…";
    },
    date: (v, pattern) => formatDate(v || new Date(), pattern),
    number: (v) => {
      const n = parseFloat(String(v).replace(/[^0-9.,-]/g, "").replace(",", "."));
      return isNaN(n) ? "" : String(n);
    },
    default: (v, fallback) => (v === "" || v === null || v === undefined ? fallback ?? "" : v),
  };

  /* --- parsing -------------------------------------------------------- */

  /** Splits `name|filter:"a","b"|other` respecting quotes. */
  function parseExpression(expression) {
    const parts = [];
    let current = "";
    let quote = null;
    for (const ch of expression) {
      if (quote) {
        if (ch === quote) quote = null;
        else current += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === "|") {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    parts.push(current);

    const name = parts.shift().trim();
    const filters = parts.map((part) => {
      const colon = part.indexOf(":");
      if (colon === -1) return { name: part.trim(), args: [] };
      return {
        name: part.slice(0, colon).trim(),
        args: splitArguments(part.slice(colon + 1)),
      };
    });
    return { name, filters };
  }

  function splitArguments(text) {
    const args = [];
    let current = "";
    let quote = null;
    for (const ch of text) {
      if (quote) {
        if (ch === quote) quote = null;
        else current += ch;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === ",") {
        args.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim() !== "" || args.length) args.push(current.trim());
    return args;
  }

  /** Every variable name a template refers to — used to resolve `selector:` lazily. */
  function variablesUsed(template) {
    const names = new Set();
    String(template ?? "").replace(PLACEHOLDER, (_, expression) => {
      names.add(parseExpression(expression).name);
      return "";
    });
    return [...names];
  }

  function lookup(name, data) {
    if (name in data) return data[name];
    // Namespaced lookups: meta:og:title, schema:author.name, selector:h1
    const colon = name.indexOf(":");
    if (colon > 0) {
      const bag = data[name.slice(0, colon)];
      const key = name.slice(colon + 1);
      if (bag && typeof bag === "object") {
        if (key in bag) return bag[key];
        // schema:author.name walks nested objects
        return key.split(".").reduce((acc, part) => (acc == null ? acc : acc[part]), bag) ?? "";
      }
    }
    return "";
  }

  function render(template, data) {
    return String(template ?? "").replace(PLACEHOLDER, (_, expression) => {
      const { name, filters } = parseExpression(expression);
      let value = lookup(name, data);
      for (const filter of filters) {
        const fn = FILTERS[filter.name];
        if (fn) value = fn(value, ...filter.args);
      }
      if (Array.isArray(value)) value = value.join(", ");
      return value === null || value === undefined ? "" : String(value);
    });
  }

  root.Templates = { render, variablesUsed, formatDate, stripTags, FILTERS };
})(typeof self !== "undefined" ? self : this);
