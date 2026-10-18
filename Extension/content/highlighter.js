/* Highlight mode: collect passages from a page, then clip only those.
 *
 * Highlights live in sessionStorage keyed by URL, so they survive a reload but
 * do not accumulate silently across browsing sessions. */
(function () {
  "use strict";
  if (window.__triClipperHighlights) return;

  const STORE_KEY = "tri-clipper:highlights:" + location.href;
  const MARK_CLASS = "tri-clipper-highlight";
  let active = false;
  let items = load();

  function load() {
    try {
      return JSON.parse(sessionStorage.getItem(STORE_KEY) || "[]");
    } catch {
      return [];
    }
  }

  function save() {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify(items));
    } catch {
      /* Private windows refuse writes; the highlights still work for this page view. */
    }
  }

  function toast(message) {
    let node = document.getElementById("tri-clipper-toast");
    if (!node) {
      node = document.createElement("div");
      node.id = "tri-clipper-toast";
      document.documentElement.appendChild(node);
    }
    node.textContent = message;
    node.classList.add("visible");
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.classList.remove("visible"), 1600);
  }

  function paint(range, id) {
    const mark = document.createElement("mark");
    mark.className = MARK_CLASS;
    mark.dataset.triliumId = id;
    mark.title = "Click to remove this highlight";
    try {
      range.surroundContents(mark);
      return true;
    } catch {
      // surroundContents refuses ranges that cross element boundaries; wrapping
      // the extracted fragment handles those, at the cost of moving the nodes.
      try {
        mark.appendChild(range.extractContents());
        range.insertNode(mark);
        return true;
      } catch {
        return false;
      }
    }
  }

  function capture() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const holder = document.createElement("div");
    holder.appendChild(range.cloneContents());
    const text = holder.textContent.trim();
    if (!text) return;

    const id = "h" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    items.push({ id, html: holder.innerHTML, text });
    save();
    paint(range, id);
    selection.removeAllRanges();
    toast(items.length + (items.length === 1 ? " highlight" : " highlights"));
    notifyCount();
  }

  function removeMark(mark) {
    const id = mark.dataset.triliumId;
    items = items.filter((item) => item.id !== id);
    save();
    const parent = mark.parentNode;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
    notifyCount();
  }

  function onMouseUp(event) {
    if (!active) return;
    const mark = event.target.closest?.("mark." + MARK_CLASS);
    if (mark) {
      event.preventDefault();
      removeMark(mark);
      return;
    }
    setTimeout(capture, 0); // Let the selection settle before reading it.
  }

  function onKeyDown(event) {
    if (active && event.key === "Escape") toggle();
  }

  function notifyCount() {
    // Nothing listening is the normal case, not an error — and the call does not
    // always hand back a promise to attach a handler to.
    try {
      const api = globalThis.browser ?? globalThis.chrome;
      const pending = api?.runtime?.sendMessage?.(
        { action: "highlight-count", count: items.length, url: location.href });
      if (pending && typeof pending.catch === "function") pending.catch(() => {});
    } catch {
      /* nothing to do about it here */
    }
  }

  function toggle() {
    active = !active;
    document.documentElement.classList.toggle("tri-clipper-active", active);
    toast(active ? "Highlight mode on — select text. Esc to stop." : "Highlight mode off");
    return active;
  }

  document.addEventListener("mouseup", onMouseUp, true);
  document.addEventListener("keydown", onKeyDown, true);

  window.__triClipperHighlights = {
    list: () => items.slice(),
    count: () => items.length,
    toggle,
    isActive: () => active,
    clear() {
      for (const mark of document.querySelectorAll("mark." + MARK_CLASS)) {
        const parent = mark.parentNode;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      }
      items = [];
      save();
      notifyCount();
    },
  };
})();
