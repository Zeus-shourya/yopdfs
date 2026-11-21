/* ==========================================================================
   YoPdfs workspace — the shared tool runner
   upload → preview/options → progress → results/download
   Tool modules call YP.registerTool(slug, definition).
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP;
  const { h, $, $$, icon, esc, bytes } = YP;
  const ROOT = YP.root;
  const V = ROOT + "assets/vendor/";

  YP.tools = YP.tools || {};
  YP.registerTool = (slug, def) => { YP.tools[slug] = def; };

  /* ======================================================================
     Library helpers (lazy-loaded engines)
     ====================================================================== */
  const lib = (YP.lib = {});
  lib.pdfLib = async () => { await YP.loadScript(V + "pdf-lib.min.js"); return window.PDFLib; };
  lib.pdfjs = async () => {
    await YP.loadScript(V + "pdfjs/pdf.min.js");
    const p = window.pdfjsLib;
    if (!p.GlobalWorkerOptions.workerSrc) p.GlobalWorkerOptions.workerSrc = new URL(V + "pdfjs/pdf.worker.min.js", location.href).href;
    return p;
  };
  lib.jszip = async () => { await YP.loadScript(V + "jszip.min.js"); return window.JSZip; };
  lib.buffer = (file) => (file.arrayBuffer ? file.arrayBuffer() : new Response(file).arrayBuffer());
  lib.openPdfjs = async (file, password) => {
    const pdfjs = await lib.pdfjs();
    const data = new Uint8Array(await lib.buffer(file));
    return pdfjs.getDocument({ data, password, isEvalSupported: false, useSystemFonts: true }).promise;
  };
  /* load with pdf-lib; friendly error for encrypted files */
  lib.openPdfLib = async (file, opts = {}) => {
    const PDFLib = await lib.pdfLib();
    try {
      return await PDFLib.PDFDocument.load(await lib.buffer(file), Object.assign({ updateMetadata: false }, opts));
    } catch (e) {
      if (/encrypt/i.test(e.message)) throw new Error(`“${file.name}” is password-protected. Unlock it first with Unlock PDF, then try again.`);
      throw new Error(`“${file.name}” doesn't look like a valid PDF (${e.message}).`);
    }
  };
  lib.renderPage = async (page, scale, canvas) => {
    const vp = page.getViewport({ scale });
    canvas = canvas || document.createElement("canvas");
    canvas.width = Math.max(1, Math.floor(vp.width)); canvas.height = Math.max(1, Math.floor(vp.height));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return canvas;
  };
  lib.toBlob = (canvas, type = "image/png", q) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Your browser ran out of memory creating the image. Try a lower quality or fewer pages."))), type, q));
  lib.loadImage = (src) => new Promise((res, rej) => {
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("This image format isn't supported by your browser."));
    img.src = url;
  });
  lib.imageCanvas = async (file, bg) => {
    const img = await lib.loadImage(file);
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (bg) { ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height); }
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    return c;
  };
  /* parse "1-3, 5, 8-" into zero-based page indexes (in order, unique) */
  lib.parseRanges = (str, total) => {
    const out = [];
    const s = (str || "").trim();
    if (!s || s.toLowerCase() === "all") return Array.from({ length: total }, (_, i) => i);
    for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
      let a, b;
      if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
      else if (/^\d+$/.test(part)) { a = b = +part; }
      else throw new Error(`“${part}” isn't a valid page range. Use something like 1-3, 5.`);
      if (a < 1 || b < 1 || a > total || b > total) throw new Error(`Page ${Math.max(a, b)} doesn't exist — this PDF has ${total} pages.`);
      if (a > b) [a, b] = [b, a];
      for (let i = a; i <= b; i++) if (!out.includes(i - 1)) out.push(i - 1);
    }
    if (!out.length) throw new Error("Please enter at least one page.");
    return out;
  };
  lib.rangeGroups = (str, total) => {
    // "1-3, 4-6" → [[0,1,2],[3,4,5]]
    return (str || "").split(/[,;]+/).map((p) => p.trim()).filter(Boolean).map((p) => lib.parseRanges(p, total));
  };
  lib.zip = async (files, name) => {
    const JSZip = await lib.jszip();
    const zip = new JSZip();
    const used = {};
    files.forEach((f) => {
      let n = f.name, k = 1;
      while (used[n]) n = f.name.replace(/(\.[^.]+)?$/, ` (${++k})$1`);
      used[n] = 1;
      zip.file(n, f.blob);
    });
    return { name, blob: await zip.generateAsync({ type: "blob", compression: "STORE" }) };
  };
  lib.pdfBlob = (bytesArr) => new Blob([bytesArr], { type: "application/pdf" });
  lib.isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
  lib.isImage = (f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name);

  /* lazily render page thumbnails into a grid of tiles */
  lib.pageGrid = async (doc, container, { scale = 0.35, tile } = {}) => {
    container.innerHTML = "";
    const tiles = [];
    const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
      if (!en.isIntersecting) return;
      io.unobserve(en.target);
      const i = +en.target.dataset.i;
      try {
        const page = await doc.getPage(i + 1);
        const c = await lib.renderPage(page, scale);
        en.target.querySelector(".pv").replaceChildren(c);
        en.target.dispatchEvent(new CustomEvent("rendered", { detail: c }));
      } catch (e) { /* leave placeholder */ }
    }), { rootMargin: "300px" });
    for (let i = 0; i < doc.numPages; i++) {
      const el = h("div", { class: "page-tile", "data-i": i, tabindex: 0, role: "button", "aria-label": "Page " + (i + 1) },
        h("div", { class: "pv", html: '<span class="loader-dots"><i></i><i></i><i></i></span>' }), h("div", { class: "pn", text: "Page " + (i + 1) }));
      if (tile) tile(el, i);
      container.appendChild(el); tiles.push(el); io.observe(el);
    }
    return tiles;
  };

  /* EXIF orientation for JPEGs (1 = normal) */
  lib.jpegOrientation = (buf) => {
    const v = new DataView(buf);
    if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
    let off = 2;
    while (off + 4 < v.byteLength) {
      const marker = v.getUint16(off);
      if (marker === 0xffe1) {
        if (v.getUint32(off + 4) !== 0x45786966) return 1;
        const t = off + 10, little = v.getUint16(t) === 0x4949;
        const ifd = t + v.getUint32(t + 4, little);
        const n = v.getUint16(ifd, little);
        for (let i = 0; i < n; i++) {
          const e = ifd + 2 + i * 12;
          if (e + 10 > v.byteLength) break;
          if (v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little);
        }
        return 1;
      }
      if ((marker & 0xff00) !== 0xff00) break;
      off += 2 + v.getUint16(off + 2);
    }
    return 1;
  };

  /* ======================================================================
     UI builders for option panels
     ====================================================================== */
  const ui = (YP.ui = {});
  let uid = 0;
  ui.id = () => "o" + ++uid;
  ui.group = (label, inner, hint) => `<div class="opt-group">${label ? `<span class="label">${label}</span>` : ""}${inner}${hint ? `<p class="hint" style="margin:6px 0 0">${hint}</p>` : ""}</div>`;
  ui.seg = (name, label, opts, val, hint) => ui.group(label, `<div class="seg" role="radiogroup" aria-label="${esc(label || name)}">${opts.map(([v, l]) => `<label><input type="radio" name="${name}" value="${esc(v)}"${String(v) === String(val) ? " checked" : ""}><span>${l}</span></label>`).join("")}</div>`, hint);
  ui.select = (name, label, opts, val, hint) => { const id = ui.id(); return `<div class="field"><label for="${id}">${label}</label><select class="input" id="${id}" name="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val) ? " selected" : ""}>${l}</option>`).join("")}</select>${hint ? `<span class="hint" style="margin:0">${hint}</span>` : ""}</div>`; };
  ui.input = (name, label, val = "", attrs = "", hint) => { const id = ui.id(); return `<div class="field"><label for="${id}">${label}</label><input class="input" id="${id}" name="${name}" value="${esc(val)}" ${attrs}>${hint ? `<span class="hint" style="margin:0">${hint}</span>` : ""}</div>`; };
  ui.range = (name, label, min, max, step, val, suffix = "") => { const id = ui.id(); return `<div class="field"><label for="${id}">${label}</label><div class="range-row"><input type="range" id="${id}" name="${name}" min="${min}" max="${max}" step="${step}" value="${val}" oninput="this.nextElementSibling.value=this.value+'${suffix}'"><output>${val}${suffix}</output></div></div>`; };
  ui.check = (name, label, checked) => `<label class="check"><input type="checkbox" name="${name}"${checked ? " checked" : ""}><span>${label}</span></label>`;
  ui.color = (name, label, val) => { const id = ui.id(); return `<div class="field"><label for="${id}">${label}</label><input class="input" type="color" id="${id}" name="${name}" value="${val}"></div>`; };
  ui.note = (html, warn) => `<div class="opt-note${warn ? " warn" : ""}">${html}</div>`;
  ui.read = (root) => {
    const o = {};
    $$("[name]", root).forEach((el) => {
      if (el.type === "radio") { if (el.checked) o[el.name] = el.value; }
      else if (el.type === "checkbox") o[el.name] = el.checked;
      else if (el.type === "range" || el.type === "number") o[el.name] = el.value === "" ? null : +el.value;
      else if (el.type === "file") o[el.name] = el.files;
      else o[el.name] = el.value;
    });
    return o;
  };

  /* ======================================================================
     Hand-off between tools (IndexedDB; never leaves the device)
     ====================================================================== */
  const handoff = (YP.handoff = {
    db() {
      return new Promise((res, rej) => {
        const r = indexedDB.open("yopdfs", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("handoff");
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
    },
    async put(files) {
      const db = await handoff.db();
      await new Promise((res, rej) => { const tx = db.transaction("handoff", "readwrite"); tx.objectStore("handoff").put(files.map((f) => ({ name: f.name, type: f.blob.type, blob: f.blob })), "files"); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    },
    async take() {
      const db = await handoff.db();
      return new Promise((res) => {
        const tx = db.transaction("handoff", "readwrite"), st = tx.objectStore("handoff");
        const g = st.get("files");
        g.onsuccess = () => { st.delete("files"); res((g.result || []).map((f) => new File([f.blob], f.name, { type: f.type }))); };
        g.onerror = () => res([]);
      });
    }
  });

  /* ======================================================================
     Workspace
     ====================================================================== */
  const NEXT = {
    pdf: ["compress-pdf", "merge-pdf", "protect-pdf", "add-page-numbers", "edit-pdf", "split-pdf"],
    image: ["image-compressor", "image-resizer", "image-cropper", "jpg-to-pdf", "background-remover"]
  };

  function Workspace(root, def) {
    const ws = this;
    ws.root = root; ws.def = def; ws.slug = root.dataset.tool;
    ws.accept = def.accept || root.dataset.accept || "*";
    ws.multiple = def.multiple != null ? def.multiple : root.dataset.multiple === "true";
    ws.min = def.minFiles || +root.dataset.min || 1;
    ws.files = []; ws.state = "empty"; ws.opts = {};
    ws.name = $("h1") ? $("h1").textContent : ws.slug;
    ws.input = h("input", { type: "file", accept: ws.accept, hidden: true, multiple: ws.multiple || null });
    ws.input.addEventListener("change", () => { ws.add(Array.from(ws.input.files)); ws.input.value = ""; });
    root.appendChild(ws.input);

    // drag & drop anywhere on the workspace
    let depth = 0;
    root.addEventListener("dragenter", (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth++; root.querySelector(".dropzone")?.classList.add("drag"); });
    root.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
    root.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; root.querySelector(".dropzone")?.classList.remove("drag"); } });
    root.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault(); depth = 0; root.querySelector(".dropzone")?.classList.remove("drag");
      if (ws.state === "processing") return;
      ws.add(Array.from(e.dataTransfer.files));
    });
    // paste
    document.addEventListener("paste", (e) => {
      if (ws.state === "processing" || /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      const files = Array.from(e.clipboardData?.files || []);
      if (files.length) { e.preventDefault(); ws.add(files.map((f, i) => (f.name === "image.png" ? new File([f], `pasted-${Date.now()}-${i}.png`, { type: f.type }) : f))); }
    });

    ws.renderEmpty();
    // hand-off from a previous tool
    if (new URLSearchParams(location.search).get("from") === "handoff") {
      handoff.take().then((files) => { if (files.length) { ws.add(files); YP.toast(`Loaded ${files.length} file${files.length > 1 ? "s" : ""} from your previous tool.`, "ok"); } }).catch(() => {});
      history.replaceState(null, "", location.pathname);
    }
  }
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");

  Workspace.prototype.limits = function () {
    const plan = (YP.auth?.user?.plan) || "free";
    return (YP.config.PLANS || {})[plan] || { maxFileMB: 250, maxFiles: 50 };
  };

  Workspace.prototype.accepts = function (f) {
    if (this.accept === "*") return true;
    const name = f.name.toLowerCase(), type = (f.type || "").toLowerCase();
    return this.accept.split(",").map((s) => s.trim().toLowerCase()).some((a) =>
      a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? type.startsWith(a.slice(0, -1)) : type === a);
  };

  Workspace.prototype.add = function (list) {
    const ws = this, lim = ws.limits();
    let rejected = 0, big = 0;
    for (const f of list) {
      if (!ws.accepts(f)) { rejected++; continue; }
      if (f.size > lim.maxFileMB * 1048576) { big++; continue; }
      if (!ws.multiple) ws.files = [];
      ws.files.push({ id: Math.random().toString(36).slice(2), file: f, name: f.name, size: f.size });
      if (!ws.multiple) break;
    }
    if (ws.files.length > lim.maxFiles) { ws.files = ws.files.slice(0, lim.maxFiles); YP.toast(`Your plan handles up to ${lim.maxFiles} files at once.`, "err"); }
    if (rejected) YP.toast(`${rejected} file${rejected > 1 ? "s" : ""} skipped — ${ws.name} accepts ${(this.root.dataset.formats || ws.accept).replace(/,/g, ", ")}.`, "err", 6000);
    if (big) YP.toast(`${big} file${big > 1 ? "s are" : " is"} larger than ${lim.maxFileMB} MB.`, "err");
    if (!ws.files.length) return;
    ws.def.onFiles ? Promise.resolve(ws.def.onFiles(ws)).then(() => ws.renderFiles()).catch((e) => { YP.toast(e.message, "err"); ws.files = []; ws.renderEmpty(); }) : ws.renderFiles();
  };

  Workspace.prototype.renderEmpty = function () {
    const ws = this;
    ws.state = "empty";
    let dz = ws.root.querySelector(".dropzone");
    if (!dz || ws.root.children.length > 2) {
      ws.root.innerHTML = "";
      ws.root.appendChild(ws.input);
      dz = h("div", { class: "dropzone", tabindex: 0, role: "button", "aria-label": "Choose files" });
      const fm = (ws.root.dataset.formats || "").split(",").filter(Boolean).slice(0, 7).map((x) => `<span>${esc(x)}</span>`).join("");
      dz.innerHTML = `<span class="dz-icon">${icon("upload")}</span><h2>Drop ${ws.multiple ? "your files" : "your file"} here</h2><p class="dz-or">or <b style="color:var(--violet-neon)">browse your device</b> · paste with Ctrl+V</p><div class="dz-formats">${fm}</div><span class="dz-privacy">${icon("shield")} Stays on your device</span>`;
      ws.root.appendChild(dz);
    }
    dz.onclick = () => ws.input.click();
    dz.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ws.input.click(); } };
    // warm up engines while the user picks files
    if (ws.def.preload) setTimeout(() => ws.def.preload().catch(() => {}), 600);
  };

  /* -------------------- files + options view -------------------- */
  Workspace.prototype.renderFiles = function () {
    const ws = this, def = ws.def;
    ws.state = "files";
    if (def.mount) { ws.root.innerHTML = ""; ws.root.appendChild(ws.input); def.mount(ws); return; }
    ws.root.innerHTML = ""; ws.root.appendChild(ws.input);

    const grid = h("div", { class: "ws-grid" + (def.layout === "single" ? " single" : "") });
    const main = h("div", { class: "ws-main" });
    const side = h("aside", { class: "ws-side", "aria-label": "Options" });
    grid.append(main, side);
    ws.root.appendChild(grid);
    ws.main = main; ws.side = side;

    if (def.mainView) def.mainView(ws, main);
    else ws.renderFileList(main);

    const optsHtml = def.options ? def.options(ws) : "";
    side.innerHTML = `<h3>${icon("sparkles")} ${def.optionsTitle || "Options"}</h3><form class="ws-opts" onsubmit="return false">${optsHtml || `<p class="muted" style="font-size:.9rem">No settings needed — just hit the button.</p>`}</form>
      <div class="ws-summary muted" style="font-size:.82rem;margin:6px 0 2px"></div>
      <button class="btn btn-primary btn-lg btn-block" type="button" data-run>${esc(def.actionLabel || "Convert")} ${icon("arrow")}</button>`;
    ws.form = $(".ws-opts", side);
    if (def.bind) def.bind(ws, ws.form);
    $("[data-run]", side).addEventListener("click", () => ws.run());
    ws.updateSummary();
  };

  Workspace.prototype.updateSummary = function () {
    const s = this.side && $(".ws-summary", this.side);
    if (!s) return;
    const total = this.files.reduce((a, f) => a + f.size, 0);
    s.textContent = `${this.files.length} file${this.files.length === 1 ? "" : "s"} · ${bytes(total)}`;
    const btn = $("[data-run]", this.side);
    if (btn) btn.disabled = this.files.length < this.min;
    if (this.files.length < this.min) s.textContent += ` — add at least ${this.min} files`;
  };

  Workspace.prototype.renderFileList = function (main) {
    const ws = this, def = ws.def;
    main.innerHTML = "";
    const head = h("div", { class: "ws-files-head" });
    head.innerHTML = `<h3>${ws.files.length} file${ws.files.length === 1 ? "" : "s"} selected${def.sortable && ws.files.length > 1 ? ` <span class="muted" style="font-weight:500;font-size:.85rem">· drag to reorder</span>` : ""}</h3>`;
    const actions = h("div", { class: "row", style: { gap: "6px" } });
    if (def.sortable && ws.files.length > 1) {
      actions.appendChild(h("button", { class: "btn btn-sm btn-ghost", type: "button", html: "Sort A→Z", onclick: () => { ws.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })); ws.renderFileList(main); } }));
    }
    if (ws.multiple) actions.appendChild(h("button", { class: "btn btn-sm btn-soft", type: "button", html: icon("plus") + " Add files", onclick: () => ws.input.click() }));
    actions.appendChild(h("button", { class: "btn btn-sm btn-ghost", type: "button", html: icon("trash") + " Clear", onclick: () => { ws.files = []; ws.renderEmpty(); } }));
    head.appendChild(actions);
    main.appendChild(head);

    const list = h("div", { class: "file-list" });
    ws.files.forEach((f, i) => list.appendChild(ws.fileCard(f, i)));
    if (ws.multiple) list.appendChild(h("button", { class: "add-more", type: "button", html: icon("plus") + "Add more", onclick: () => ws.input.click() }));
    main.appendChild(list);
    ws.updateSummary();
  };

  Workspace.prototype.fileCard = function (f, i) {
    const ws = this, def = ws.def;
    const card = h("div", { class: "file-card", "data-id": f.id });
    const thumb = h("div", { class: "file-thumb" });
    card.appendChild(thumb);
    const meta = h("div", { class: "file-meta", html: `<b title="${esc(f.name)}">${esc(f.name)}</b><span>${bytes(f.size)}${f.pages ? ` · ${f.pages} page${f.pages > 1 ? "s" : ""}` : ""}</span>` });
    card.appendChild(meta);
    if (def.sortable && ws.files.length > 1) card.appendChild(h("span", { class: "file-index", text: i + 1 }));
    const acts = h("div", { class: "file-actions" });
    if (def.sortable && ws.files.length > 1) {
      acts.appendChild(h("button", { class: "icon-btn sm", type: "button", "aria-label": "Move earlier", html: icon("up"), onclick: () => ws.move(i, -1) }));
      acts.appendChild(h("button", { class: "icon-btn sm", type: "button", "aria-label": "Move later", html: icon("down"), onclick: () => ws.move(i, 1) }));
    }
    acts.appendChild(h("button", { class: "icon-btn sm", type: "button", "aria-label": "Remove " + f.name, html: icon("x"), onclick: () => { ws.files.splice(i, 1); ws.files.length ? (ws.def.mainView ? ws.renderFiles() : ws.renderFileList(ws.main)) : ws.renderEmpty(); } }));
    card.appendChild(acts);
    ws.thumb(f, thumb, meta);

    if (def.sortable) {
      card.draggable = true;
      card.addEventListener("dragstart", (e) => { card.classList.add("dragging"); e.dataTransfer.setData("text/yp-id", f.id); e.dataTransfer.effectAllowed = "move"; });
      card.addEventListener("dragend", () => card.classList.remove("dragging"));
      card.addEventListener("dragover", (e) => { if (Array.from(e.dataTransfer.types).includes("text/yp-id")) { e.preventDefault(); card.classList.add("drop-target"); } });
      card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
      card.addEventListener("drop", (e) => {
        const id = e.dataTransfer.getData("text/yp-id");
        if (!id) return;
        e.preventDefault(); e.stopPropagation();
        const from = ws.files.findIndex((x) => x.id === id), to = ws.files.findIndex((x) => x.id === f.id);
        if (from < 0 || to < 0 || from === to) return card.classList.remove("drop-target");
        const [it] = ws.files.splice(from, 1); ws.files.splice(to, 0, it);
        ws.renderFileList(ws.main);
      });
    }
    return card;
  };
  Workspace.prototype.move = function (i, d) {
    const j = i + d;
    if (j < 0 || j >= this.files.length) return;
    [this.files[i], this.files[j]] = [this.files[j], this.files[i]];
    this.renderFileList(this.main);
  };

  Workspace.prototype.thumb = async function (f, el, meta) {
    const file = f.file;
    if (f.thumbUrl) { el.innerHTML = `<img alt="" src="${f.thumbUrl}">`; return; }
    if (lib.isImage(file)) {
      f.thumbUrl = URL.createObjectURL(file);
      el.innerHTML = `<img alt="Preview of ${esc(f.name)}" src="${f.thumbUrl}">`;
      return;
    }
    const ext = YP.ext(f.name).toUpperCase() || "FILE";
    el.innerHTML = `<span class="ph">${icon(ext === "PDF" ? "file" : ext.startsWith("XL") || ext === "CSV" ? "excel" : ext.startsWith("DOC") ? "word" : "file")}${esc(ext)}</span>`;
    if (lib.isPdf(file)) {
      try {
        const doc = await lib.openPdfjs(file);
        f.pages = doc.numPages;
        const c = await lib.renderPage(await doc.getPage(1), 0.4);
        f.thumbUrl = c.toDataURL("image/jpeg", 0.75);
        el.innerHTML = `<img alt="First page of ${esc(f.name)}" src="${f.thumbUrl}">`;
        meta.querySelector("span").textContent = `${bytes(f.size)} · ${f.pages} page${f.pages > 1 ? "s" : ""}`;
        doc.destroy();
      } catch (e) {
        if (e && e.name === "PasswordException") { f.encrypted = true; el.innerHTML = `<span class="ph">${icon("lock")}Protected</span>`; }
      }
    }
  };

  /* -------------------- run -------------------- */
  Workspace.prototype.readOpts = function () { return this.form ? ui.read(this.form) : {}; };

  Workspace.prototype.run = async function (customOpts) {
    const ws = this, def = ws.def;
    if (ws.files.length < ws.min) return YP.toast(`Please add at least ${ws.min} files.`, "err");
    const opts = customOpts || ws.readOpts();
    ws.opts = opts;
    if (def.validate) { const msg = def.validate(ws.files, opts, ws); if (msg) return YP.toast(msg, "err", 5500); }

    const prevView = Array.from(ws.root.childNodes);
    ws.state = "processing";
    const box = h("div", { class: "progress-wrap", role: "status", "aria-live": "polite" });
    box.innerHTML = `<div class="progress-ring"><svg viewBox="0 0 120 120"><defs><linearGradient id="pgrad" x1="0" x2="1"><stop stop-color="#8A3FFC"/><stop offset="1" stop-color="#FF2E97"/></linearGradient></defs><circle class="track" cx="60" cy="60" r="50"/><circle class="val" cx="60" cy="60" r="50" stroke-dasharray="314.16" stroke-dashoffset="314.16"/></svg><b>0%</b></div>
      <div class="progress-label">Starting…</div><div class="progress-bar"><i></i></div>
      <button class="btn btn-sm btn-ghost" type="button" style="margin-top:18px" data-cancel>Cancel</button>`;
    ws.root.replaceChildren(ws.input, box);
    const ring = $(".val", box), pct = $("b", box), label = $(".progress-label", box), bar = $(".progress-bar i", box);
    let cancelled = false;
    $("[data-cancel]", box).onclick = () => { cancelled = true; label.textContent = "Cancelling…"; };
    let lastPaint = 0;
    const ctx = {
      ws,
      progress(fr, text) {
        fr = Math.max(0, Math.min(1, fr || 0));
        const now = performance.now();
        if (text) label.textContent = text;
        if (now - lastPaint < 40 && fr < 1) return;
        lastPaint = now;
        ring.style.strokeDashoffset = 314.16 * (1 - fr);
        pct.textContent = Math.round(fr * 100) + "%";
        bar.style.width = fr * 100 + "%";
      },
      check() { if (cancelled) throw Object.assign(new Error("Cancelled"), { cancelled: true }); },
      tick: () => YP.nextFrame()
    };
    const t0 = performance.now();
    const inBytes = ws.files.reduce((a, f) => a + f.size, 0);
    try {
      await YP.nextFrame();
      let res = await def.process(ws.files.map((f) => f.file), opts, ctx);
      if (!res) throw new Error("Nothing was produced.");
      if (Array.isArray(res)) res = { outputs: res };
      ctx.progress(1, "Done");
      const ms = Math.round(performance.now() - t0);
      const outBytes = (res.outputs || []).reduce((a, o) => a + (o.blob ? o.blob.size : 0), 0);
      YP.logUsage({ tool: ws.slug, files: ws.files.length, inBytes, outBytes, ms, ok: true });
      YP.track("tool_complete", { tool: ws.slug, files: ws.files.length, ms });
      await YP.sleep(250);
      ws.renderResults(res, { inBytes, outBytes, ms });
    } catch (err) {
      if (err.cancelled) { ws.root.replaceChildren(...prevView); ws.state = "files"; YP.toast("Cancelled."); return; }
      console.error(err);
      YP.logUsage({ tool: ws.slug, files: ws.files.length, inBytes, ms: Math.round(performance.now() - t0), ok: false, error: String(err.message || err).slice(0, 160) });
      ws.root.replaceChildren(...prevView); ws.state = "files";
      YP.toast(err.message || "Something went wrong.", "err", 7000);
    }
  };

  /* -------------------- results -------------------- */
  Workspace.prototype.renderResults = function (res, stats) {
    const ws = this, def = ws.def;
    ws.state = "done"; ws.outputs = res.outputs || [];
    const outs = ws.outputs;
    const wrap = h("div", { class: "results" });
    const title = res.title || def.doneTitle || "Your files are ready!";
    const summary = res.summary || (outs.length ? `${outs.length} file${outs.length > 1 ? "s" : ""} · ${bytes(stats.outBytes)} · done in ${(stats.ms / 1000).toFixed(1)}s` : "");
    wrap.innerHTML = `<div class="result-head"><div class="done-ico">${icon("check")}</div><h2>${esc(title)}</h2><p class="muted" style="margin:0">${summary}</p></div>`;
    const acts = h("div", { class: "result-actions" });
    if (outs.length === 1) {
      acts.appendChild(h("button", { class: "btn btn-primary btn-xl", type: "button", html: icon("download") + " Download " + esc(YP.ext(outs[0].name).toUpperCase()), onclick: () => ws.dl(outs[0]) }));
    } else if (outs.length > 1) {
      acts.appendChild(h("button", { class: "btn btn-primary btn-xl", type: "button", html: icon("download") + ` Download all (ZIP)`, onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { const z = await lib.zip(outs, res.zipName || `yopdfs-${ws.slug}.zip`); ws.dl(z); } catch (err) { YP.toast(err.message, "err"); }
        b.disabled = false;
      } }));
    }
    acts.appendChild(h("button", { class: "btn btn-lg", type: "button", html: icon("refresh") + " Start over", onclick: () => { ws.files = []; ws.renderEmpty(); window.scrollTo({ top: ws.root.offsetTop - 120, behavior: "smooth" }); } }));
    if (!def.mount && def.backToEdit !== false) acts.appendChild(h("button", { class: "btn btn-lg btn-ghost", type: "button", html: "← Back to options", onclick: () => ws.renderFiles() }));
    wrap.appendChild(acts);

    if (res.html) wrap.appendChild(typeof res.html === "string" ? h("div", { html: res.html }) : res.html);
    if (def.resultView) def.resultView(ws, wrap, res);
    if (outs.length && !res.hideList) {
      const list = h("div", { class: "result-list" });
      outs.forEach((o) => list.appendChild(ws.resultCard(o)));
      wrap.appendChild(list);
    }

    // continue with another tool (files handed over locally via IndexedDB)
    const kind = outs.length && outs.every((o) => /pdf$/i.test(o.name)) ? "pdf" : outs.length && outs.every((o) => /\.(png|jpe?g|webp)$/i.test(o.name)) ? "image" : null;
    if (kind) {
      const next = NEXT[kind].filter((s) => s !== ws.slug).slice(0, 5).map((s) => (window.YP_TOOLS || []).find((t) => t.slug === s)).filter(Boolean);
      const nt = h("div", { class: "next-tools" });
      nt.innerHTML = `<h3>Continue with your ${kind === "pdf" ? "PDF" : "images"} →</h3>`;
      const row = h("div", { class: "quick-chips", style: { justifyContent: "flex-start", marginTop: 0 } });
      next.forEach((t) => row.appendChild(h("button", { class: "chip", type: "button", html: icon(t.icon) + " " + esc(t.name), onclick: async () => {
        try { await handoff.put(outs); location.href = ROOT + t.slug + "/?from=handoff"; } catch (e) { location.href = ROOT + t.slug + "/"; }
      } })));
      nt.appendChild(row);
      wrap.appendChild(nt);
    }
    if (!YP.auth?.user) wrap.appendChild(h("p", { class: "muted", style: { textAlign: "center", fontSize: ".86rem", marginTop: "22px" }, html: `<a href="${ROOT}account/?mode=signup">Create a free account</a> to keep a history of your conversions.` }));

    ws.root.replaceChildren(ws.input, wrap);
    if (outs.length === 1 && def.autoDownload) ws.dl(outs[0]);
  };

  Workspace.prototype.dl = function (o) {
    YP.download(o.blob, o.name);
    YP.track("file_download", { tool: this.slug });
  };

  Workspace.prototype.resultCard = function (o) {
    const ws = this;
    const card = h("div", { class: "result-card" });
    const th = h("div", { class: "file-thumb" + (/\.(png|webp)$/i.test(o.name) ? " checker" : "") });
    card.appendChild(th);
    let extra = "";
    if (o.before != null) {
      const pctv = Math.round((1 - o.blob.size / o.before) * 100);
      extra = pctv > 0 ? `<span class="saving">−${pctv}%</span>` : `<span class="saving bad">already optimal</span>`;
    }
    card.appendChild(h("div", { class: "file-meta", html: `<b title="${esc(o.name)}">${esc(o.name)}</b><span>${o.before != null ? bytes(o.before) + " → " : ""}${bytes(o.blob.size)}</span> ${extra}` }));
    card.appendChild(h("button", { class: "btn btn-sm btn-soft", type: "button", html: icon("download") + " Download", onclick: () => ws.dl(o) }));
    if (o.blob.type.startsWith("image/")) {
      const u = URL.createObjectURL(o.blob);
      th.innerHTML = `<img alt="" src="${u}">`;
    } else if (o.blob.type === "application/pdf") {
      th.innerHTML = `<span class="ph">${icon("file")}PDF</span>`;
      (async () => { try { const d = await lib.openPdfjs(o.blob); const c = await lib.renderPage(await d.getPage(1), 0.45); th.replaceChildren(c); d.destroy(); } catch (e) {} })();
    } else {
      const ext = YP.ext(o.name).toUpperCase();
      th.innerHTML = `<span class="ph">${icon(ext.startsWith("XL") ? "excel" : ext.startsWith("DOC") ? "word" : "file")}${esc(ext)}</span>`;
    }
    return card;
  };

  YP.Workspace = Workspace;

  document.addEventListener("DOMContentLoaded", () => {
    const root = document.getElementById("workspace");
    if (!root) return;
    const def = YP.tools[root.dataset.tool];
    if (!def) { root.innerHTML = `<p class="opt-note warn">This tool failed to load. Please refresh the page.</p>`; return; }
    YP.ws = new Workspace(root, def);
  });
})();
