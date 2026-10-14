// SPDX-License-Identifier: Apache-2.0
// Optional client library for HTML notes. No Tauri or same-origin privileges.
(function () {
  "use strict";
  var channel = "baalda.dashboard.v1", sequence = 0, pending = new Map();
  function call(method, params) {
    return new Promise(function (resolve, reject) {
      var id = String(++sequence);
      var timer = setTimeout(function () { pending.delete(id); reject(new Error("Baalda did not answer")); }, 15000);
      pending.set(id, { resolve: resolve, reject: reject, timer: timer });
      parent.postMessage({ channel: channel, id: id, method: method, params: params }, "*");
    });
  }
  function theme(info) {
    document.documentElement.dataset.theme = info.theme;
    Object.keys(info.tokens || {}).forEach(function (key) { document.documentElement.style.setProperty(key, info.tokens[key]); });
  }
  window.addEventListener("message", function (event) {
    if (event.source !== parent || !event.data || event.data.channel !== channel) return;
    var message = event.data;
    if (message.event === "theme") { theme(message.result); return; }
    if (message.event === "beforeReload") {
      clearTimeout(scrollTimer);
      call("state.set", { key: "__scroll", value: [scrollX, scrollY] }).then(function () {
        parent.postMessage({ channel: channel, event: "snapshotAck", id: message.id }, "*");
      }).catch(function () {});
      return;
    }
    var waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id); clearTimeout(waiting.timer);
    if (message.error) waiting.reject(new Error(message.error)); else waiting.resolve(message.result);
  });
  window.baalda = {
    vault: { info: function () { return call("vault.info"); }, stats: function () { return call("vault.stats"); } },
    notes: {
      search: function (q, limit) { return call("notes.search", { q: q, limit: limit }); },
      list: function (query) { return call("notes.list", query || {}); },
      read: function (note) { return call("notes.read", note); },
      meta: function (note) { return call("notes.meta", note); },
      backlinks: function (note) { return call("notes.backlinks", note); }
    },
    graph: { edges: function () { return call("graph.edges"); } },
    tags: { list: function () { return call("tags.list"); } },
    properties: { keys: function () { return call("properties.keys"); }, values: function (key) { return call("properties.values", { key: key }); } },
    state: { get: function (key) { return call("state.get", { key: key }); }, set: function (key, value) { return call("state.set", { key: key, value: value }); } },
    app: { open: function (note) { return call("app.open", note); }, openExternal: function (url) { return call("app.openExternal", { url: url }); } }
  };
  window.baalda.ready = call("vault.info").then(function (info) { theme(info); return info; });
  // Navigation and shortcuts are relayed only when this optional SDK is used.
  document.addEventListener("click", function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest("a[href]") : null;
    if (!anchor) return;
    var href = anchor.getAttribute("href");
    if (/^(https:|mailto:)/i.test(href)) {
      event.preventDefault(); call("app.openExternal", { url: href }).catch(console.error);
    } else if (/\.(md|markdown|mdx|txt|html|htm|canvas|url|webloc)(?:#.*)?$/i.test(href)) {
      event.preventDefault();
      var url = new URL(href, location.href), marker = "/__baalda/vault/", at = url.pathname.indexOf(marker);
      if (at !== -1) {
        var parts = url.pathname.slice(at + marker.length).split("/"); parts.shift();
        call("app.open", { path: parts.map(decodeURIComponent).join("/") }).catch(console.error);
      }
    }
  });
  document.addEventListener("keydown", function (event) {
    var key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && ["k", "p", "w", "f", "g", "h", "tab", "[", "]"].indexOf(key) !== -1 || key === "escape") {
      event.preventDefault();
      call("app.keydown", { key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, shiftKey: event.shiftKey, altKey: event.altKey }).catch(console.error);
    }
  });
  // Persist scroll before the watcher replaces the frame. Opaque origins cannot
  // use localStorage. Widgets may store additional state with baalda.state.
  var scrollTimer;
  window.addEventListener("scroll", function () {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(function () { call("state.set", { key: "__scroll", value: [scrollX, scrollY] }).catch(function () {}); }, 100);
  });
  function restore() { call("state.get", { key: "__scroll" }).then(function (position) { if (Array.isArray(position)) requestAnimationFrame(function () { scrollTo(position[0], position[1]); }); }).catch(function () {}); }
  if (document.readyState === "complete") restore(); else window.addEventListener("load", restore);
}());
