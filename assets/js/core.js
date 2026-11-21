/* ==========================================================================
   YoPdfs core — helpers, theme, navigation, search, toasts, analytics, ads
   ========================================================================== */
(function () {
  "use strict";
  const YP = (window.YP = window.YP || {});
  const CFG = (YP.config = window.YP_CONFIG || {});
  const ROOT = document.body.dataset.root || "";
  YP.root = ROOT;

  /* ---------- small helpers ---------- */
  YP.$ = (s, r = document) => r.querySelector(s);
  YP.$$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  YP.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "text") el.textContent = v;
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  };
  YP.icon = (name, cls = "ico") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${(window.YP_ICONS || {})[name] || ""}</svg>`;
  YP.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  YP.bytes = function (n) {
    if (!isFinite(n)) return "–";
    const u = ["B", "KB", "MB", "GB"]; let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (i ? n.toFixed(n < 10 ? 2 : 1) : n) + " " + u[i];
  };
  YP.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  YP.nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  YP.baseName = (name) => name.replace(/\.[^.]+$/, "");
  YP.ext = (name) => (name.match(/\.([^.]+)$/) || [, ""])[1].toLowerCase();

  /* load a script once; resolves when ready */
  const loaded = {};
  YP.loadScript = function (src) {
    const url = /^(https?:|\/|\.)/.test(src) ? src : ROOT + src; // already-relative paths ("../x") are used as-is
    if (!loaded[url]) {
      loaded[url] = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = url; s.async = true;
        s.onload = () => resolve();
        s.onerror = () => { delete loaded[url]; reject(new Error("Could not load " + src + ". Check your connection and try again.")); };
        document.head.appendChild(s);
      });
    }
    return loaded[url];
  };
  YP.loadCSS = function (href) {
    const url = /^(https?:|\/|\.)/.test(href) ? href : ROOT + href;
    if (document.querySelector(`link[href="${url}"]`)) return;
    document.head.appendChild(YP.h("link", { rel: "stylesheet", href: url }));
  };

  /* download a Blob */
  YP.download = function (blob, name) {
    const url = URL.createObjectURL(blob);
    const a = YP.h("a", { href: url, download: name, style: { display: "none" } });
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
  };

  /* ---------- toasts ---------- */
  YP.toast = function (msg, type = "info", ms = 4200) {
    let box = document.getElementById("toasts");
    if (!box) { box = YP.h("div", { class: "toasts", id: "toasts", "aria-live": "polite" }); document.body.appendChild(box); }
    const ic = type === "err" ? "info" : type === "ok" ? "check" : "sparkles";
    const t = YP.h("div", { class: "toast " + type, role: type === "err" ? "alert" : "status", html: YP.icon(ic) + "<span>" + YP.esc(msg) + "</span>" });
    box.appendChild(t);
    setTimeout(() => { t.style.transition = "opacity .3s, transform .3s"; t.style.opacity = "0"; t.style.transform = "translateY(8px)"; setTimeout(() => t.remove(), 300); }, ms);
  };

  /* ---------- storage (safe) ---------- */
  YP.store = {
    get(k, d) { try { const v = localStorage.getItem("yp-" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("yp-" + k, JSON.stringify(v)); } catch (e) {} },
    del(k) { try { localStorage.removeItem("yp-" + k); } catch (e) {} }
  };

  /* ---------- theme ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("yp-theme", t); } catch (e) {}
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === "dark" ? "#0F0C22" : "#541388";
  }
  document.addEventListener("click", (e) => {
    if (e.target.closest("[data-theme-toggle]")) {
      const cur = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(cur);
      YP.track("theme_toggle", { theme: cur });
    }
  });

  /* ---------- header: scroll state, mega menu, drawer ---------- */
  const header = YP.$(".site-header");
  const onScroll = () => header && header.classList.toggle("scrolled", window.scrollY > 8);
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  YP.$$(".nav-dd").forEach((dd) => {
    const btn = dd.querySelector("button");
    let t;
    const open = (v) => { dd.classList.toggle("open", v); btn.setAttribute("aria-expanded", v); };
    btn.addEventListener("click", () => open(!dd.classList.contains("open")));
    dd.addEventListener("mouseenter", () => { clearTimeout(t); open(true); });
    dd.addEventListener("mouseleave", () => { t = setTimeout(() => open(false), 180); });
    document.addEventListener("click", (e) => { if (!dd.contains(e.target)) open(false); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") open(false); });
  });

  const drawer = YP.$("#drawer");
  if (drawer) {
    const setD = (v) => { drawer.classList.toggle("open", v); drawer.setAttribute("aria-hidden", !v); document.body.style.overflow = v ? "hidden" : ""; };
    document.addEventListener("click", (e) => {
      if (e.target.closest("[data-drawer-open]")) setD(true);
      else if (e.target.closest("[data-drawer-close]")) setD(false);
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") setD(false); });
  }

  /* ---------- search ---------- */
  const TOOLS = window.YP_TOOLS || [];
  const SYN = {
    shrink: "compress", reduce: "compress", smaller: "compress", size: "compress resize", combine: "merge", join: "merge",
    separate: "split", extract: "split ocr", cut: "crop split", sign: "edit", signature: "edit", annotate: "edit", write: "edit",
    password: "protect unlock", encrypt: "protect", decrypt: "unlock", doc: "word", docx: "word", xls: "excel", xlsx: "excel",
    sheet: "excel", spreadsheet: "excel", photo: "image jpg", picture: "image jpg", text: "ocr word", scan: "ocr jpg",
    transparent: "background", bg: "background", cutout: "background", id: "passport", visa: "passport", number: "page numbers",
    stamp: "watermark", logo: "watermark", turn: "rotate", jpeg: "jpg", webp: "image compress", heic: "jpg"
  };
  YP.searchTools = function (q) {
    q = (q || "").toLowerCase().trim();
    if (!q) return TOOLS.slice(0, 8);
    const words = q.split(/\s+/).flatMap((w) => [w].concat((SYN[w] || "").split(" ").filter(Boolean)));
    return TOOLS.map((t) => {
      const name = t.name.toLowerCase(), hay = (t.name + " " + t.short + " " + t.cats.join(" ") + " " + (t.kw || "")).toLowerCase();
      let s = 0;
      if (name === q) s += 100;
      if (name.startsWith(q)) s += 40;
      if (name.includes(q)) s += 25;
      words.forEach((w) => {
        const re = new RegExp("\\b" + w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
        if (re.test(name)) s += 10; else if (re.test(hay)) s += 3;
      });
      return { t, s };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.t);
  };
  function resultItem(t, i) {
    return `<a class="sr-item cat-${t.primary}${i === 0 ? " active" : ""}" role="option" href="${ROOT}${t.slug}/"><span class="mini-ico">${YP.icon(t.icon)}</span><span><b>${YP.esc(t.name)}</b><small>${YP.esc(t.short)}</small></span></a>`;
  }
  function bindSearch(input, list, onPick) {
    let items = [], idx = 0;
    const draw = () => {
      items = YP.searchTools(input.value);
      idx = 0;
      list.innerHTML = items.length ? items.map(resultItem).join("") : `<div class="sr-empty">No tool matches “${YP.esc(input.value)}”. Try “pdf”, “image” or “convert”.</div>`;
      list.hidden = false; input.setAttribute("aria-expanded", "true");
    };
    const mark = () => YP.$$(".sr-item", list).forEach((el, i) => el.classList.toggle("active", i === idx));
    input.addEventListener("input", draw);
    input.addEventListener("focus", draw);
    input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { idx = Math.min(idx + 1, items.length - 1); mark(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { idx = Math.max(idx - 1, 0); mark(); e.preventDefault(); }
      else if (e.key === "Enter" && items[idx]) { e.preventDefault(); YP.track("search", { q: input.value, pick: items[idx].slug }); location.href = ROOT + items[idx].slug + "/"; }
      else if (e.key === "Escape") { list.hidden = true; input.blur(); onPick && onPick(); }
    });
    return draw;
  }
  const heroBox = YP.$("[data-hero-search]");
  if (heroBox) {
    const input = YP.$("input", heroBox), list = YP.$(".search-results", heroBox);
    bindSearch(input, list);
    document.addEventListener("click", (e) => { if (!heroBox.contains(e.target)) { list.hidden = true; input.setAttribute("aria-expanded", "false"); } });
    const q = new URLSearchParams(location.search).get("q");
    if (q) { input.value = q; setTimeout(() => input.focus(), 50); }
  }
  /* command palette (header search button and "/" key) */
  let palette;
  function openPalette() {
    if (heroBox && window.scrollY < 300) { YP.$("input", heroBox).focus(); return; }
    if (!palette) {
      palette = YP.h("div", { class: "palette", role: "dialog", "aria-modal": "true", "aria-label": "Search tools" });
      palette.innerHTML = `<div class="modal-bg"></div><div class="palette-card"><div class="palette-input">${YP.icon("search")}<input type="search" placeholder="Search ${TOOLS.length} tools…" aria-label="Search tools" role="combobox" aria-expanded="true"><kbd>Esc</kbd></div><div class="palette-list" role="listbox"></div></div>`;
      document.body.appendChild(palette);
      const close = () => palette.classList.remove("open");
      palette.querySelector(".modal-bg").addEventListener("click", close);
      palette._draw = bindSearch(YP.$("input", palette), YP.$(".palette-list", palette), close);
      palette.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
    }
    palette.classList.add("open");
    const inp = YP.$("input", palette); inp.value = ""; palette._draw(); setTimeout(() => inp.focus(), 20);
  }
  YP.openSearch = openPalette;
  document.addEventListener("click", (e) => { if (e.target.closest("[data-search-open]")) openPalette(); });
  document.addEventListener("keydown", (e) => {
    const tag = (document.activeElement || {}).tagName;
    if ((e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(tag) && !document.activeElement.isContentEditable) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k")) {
      e.preventDefault(); openPalette();
    }
  });

  /* ---------- category tabs on home ---------- */
  const grid = YP.$("#tool-grid");
  if (grid) {
    YP.$$(".cat-tab").forEach((tab) => tab.addEventListener("click", () => {
      YP.$$(".cat-tab").forEach((t) => t.setAttribute("aria-selected", t === tab));
      const c = tab.dataset.cat;
      YP.$$(".tool-card", grid).forEach((card, i) => {
        const show = c === "all" || card.dataset.cats.split(" ").includes(c);
        card.classList.toggle("is-hidden", !show);
        if (show) { card.style.animation = "none"; card.offsetHeight; card.style.animation = `pop .35s ${Math.min(i, 12) * 0.02}s var(--ease) both`; }
      });
      YP.track("category_filter", { cat: c });
    }));
  }
  /* spotlight hover on cards */
  document.addEventListener("pointermove", (e) => {
    const card = e.target.closest && e.target.closest(".tool-card");
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--mx", ((e.clientX - r.left) / r.width) * 100 + "%");
    card.style.setProperty("--my", ((e.clientY - r.top) / r.height) * 100 + "%");
  }, { passive: true });

  /* ---------- reveal on scroll ---------- */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } }), { rootMargin: "0px 0px -8% 0px" });
    YP.$$(".reveal").forEach((el) => io.observe(el));
  } else YP.$$(".reveal").forEach((el) => el.classList.add("in"));

  /* ---------- analytics ---------- */
  window.dataLayer = window.dataLayer || [];
  const A = CFG.ANALYTICS || {};
  if (A.GTM_ID) {
    window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });
    YP.loadScript("https://www.googletagmanager.com/gtm.js?id=" + encodeURIComponent(A.GTM_ID)).catch(() => {});
  }
  if (A.GA4_ID) {
    window.gtag = function () { window.dataLayer.push(arguments); };
    window.gtag("js", new Date()); window.gtag("config", A.GA4_ID, { anonymize_ip: true });
    YP.loadScript("https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(A.GA4_ID)).catch(() => {});
  }
  YP.track = function (event, props = {}) {
    try {
      window.dataLayer.push(Object.assign({ event: "yp_" + event }, props));
      if (window.gtag && A.GA4_ID) window.gtag("event", event, props);
    } catch (e) {}
  };

  /* ---------- ads ---------- */
  YP.renderAds = function () {
    const ads = CFG.ADS || {};
    const plan = (YP.auth && YP.auth.user && YP.auth.user.plan) || "free";
    const planCfg = (CFG.PLANS || {})[plan] || {};
    if (!ads.ENABLED || !ads.ADSENSE_CLIENT || planCfg.ads === false) return;
    const slots = YP.$$(".ad-slot[data-ad]");
    if (!slots.length) return;
    YP.loadScript("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=" + encodeURIComponent(ads.ADSENSE_CLIENT)).catch(() => {});
    slots.forEach((slot) => {
      const id = (ads.SLOTS || {})[slot.dataset.ad];
      if (!id || slot.classList.contains("on")) return;
      slot.classList.add("on");
      slot.innerHTML = `<ins class="adsbygoogle" style="display:block" data-ad-client="${YP.esc(ads.ADSENSE_CLIENT)}" data-ad-slot="${YP.esc(id)}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
      (window.adsbygoogle = window.adsbygoogle || []).push({});
    });
  };

  /* ---------- newsletter (footer) ---------- */
  document.addEventListener("submit", async (e) => {
    const form = e.target.closest("[data-newsletter]");
    if (!form) return;
    e.preventDefault();
    const email = form.email.value.trim();
    const btn = form.querySelector("button"); btn.disabled = true;
    try {
      await YP.api("newsletter", { email, page: location.pathname });
      YP.toast("You're on the list — thanks!", "ok"); form.reset();
      YP.track("newsletter_signup");
    } catch (err) { YP.toast(err.message || "Could not subscribe right now.", "err"); }
    btn.disabled = false;
  });

  document.addEventListener("DOMContentLoaded", () => setTimeout(() => YP.renderAds && YP.renderAds(), 50));
})();
