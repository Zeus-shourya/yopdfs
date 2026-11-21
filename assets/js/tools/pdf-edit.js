/* ==========================================================================
   YoPdfs — Edit PDF
   PDF.js renders each page; a Fabric.js layer on top holds text, drawings,
   highlights, shapes, white-out, images and signatures. Saving flattens each
   page's layer at high resolution onto the original page with pdf-lib.
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP, lib = YP.lib, { h, $, $$, icon, esc } = YP;
  const V = YP.root + "assets/vendor/";

  function vbox(page) {
    let cb; try { cb = page.getCropBox(); } catch (e) { cb = null; }
    if (!cb || !cb.width) { const s = page.getSize(); cb = { x: 0, y: 0, width: s.width, height: s.height }; }
    const w = cb.width, hh = cb.height, R = ((page.getRotation().angle % 360) + 360) % 360;
    const map = (vx, vy) => { const p = R === 90 ? [w - vy, vx] : R === 180 ? [w - vx, hh - vy] : R === 270 ? [vy, hh - vx] : [vx, vy]; return [p[0] + cb.x, p[1] + cb.y]; };
    return { W: R % 180 ? hh : w, H: R % 180 ? w : hh, R, map };
  }

  const TOOLS = [
    ["select", "pointer", "Select"], ["text", "type", "Text"], ["draw", "pen", "Draw"], ["highlight", "highlight", "Highlight"],
    ["rect", "square", "Shape"], ["whiteout", "eraser", "White-out"], ["image", "image", "Image"], ["sign", "signature", "Sign"]
  ];

  YP.registerTool("edit-pdf", {
    preload: () => Promise.all([lib.pdfjs(), lib.pdfLib(), YP.loadScript(V + "fabric.min.js")]),
    async mount(ws) {
      const f = ws.files[0];
      const st = (ws.ed = { tool: "select", color: "#D90368", size: 3, font: 12, pages: [], undo: [], zoom: 1, mute: false });
      ws.root.insertAdjacentHTML("beforeend", `<div class="editor">
        <div class="ed-toolbar" role="toolbar" aria-label="Editing tools">
          ${TOOLS.map(([id, ic, label]) => `<button class="ed-tool" type="button" data-tool="${id}" aria-pressed="${id === "select"}" title="${label}">${icon(ic)}<span>${label}</span></button>`).join("")}
          <span class="sep"></span>
          <div class="ed-props">
            <label class="sr-only" for="ed-color">Colour</label><input class="input" type="color" id="ed-color" value="${st.color}" title="Colour" style="width:40px;padding:3px">
            <label class="sr-only" for="ed-size">Size</label>
            <select class="input" id="ed-size" title="Size / thickness">${[1, 2, 3, 5, 8, 12].map((v) => `<option value="${v}"${v === 3 ? " selected" : ""}>${v}px</option>`).join("")}</select>
            <select class="input" id="ed-font" title="Text size">${[8, 10, 11, 12, 14, 16, 18, 24, 32, 48].map((v) => `<option value="${v}"${v === 12 ? " selected" : ""}>${v}pt</option>`).join("")}</select>
          </div>
          <span class="sep"></span>
          <button class="ed-tool" type="button" data-act="undo" title="Undo (Ctrl+Z)">${icon("undo")}<span>Undo</span></button>
          <button class="ed-tool" type="button" data-act="del" title="Delete selected (Del)">${icon("trash")}<span>Delete</span></button>
          <button class="ed-tool" type="button" data-act="zo" title="Zoom out">${icon("zoomout")}</button>
          <button class="ed-tool" type="button" data-act="zi" title="Zoom in">${icon("zoomin")}</button>
          <span style="flex:1"></span>
          <button class="btn btn-sm btn-ghost" type="button" data-act="change">${icon("refresh")} Change file</button>
          <button class="btn btn-primary" type="button" data-act="save">${icon("download")} Save PDF</button>
        </div>
        <p class="muted ed-hint" style="margin:0;font-size:.85rem">Pick a tool, then click or drag on a page. Double-click text to edit it. <span class="ed-status"></span></p>
        <div class="ed-pages" tabindex="-1"><div class="progress-wrap" style="padding:40px"><span class="loader-dots"><i></i><i></i><i></i></span><p class="muted">Opening ${esc(f.name)}…</p></div></div>
      </div>`);
      const root = ws.root, pagesEl = $(".ed-pages", root);
      const imgInput = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
      root.appendChild(imgInput);

      let doc;
      try {
        await YP.loadScript(V + "fabric.min.js");
        doc = await lib.openPdfjs(f.file);
      } catch (e) {
        pagesEl.innerHTML = `<p class="opt-note warn">${e.name === "PasswordException" ? "This PDF is password-protected. Unlock it first with Unlock PDF." : "Couldn't open this PDF: " + esc(e.message)}</p>`;
        return;
      }
      ws.edDoc = doc;
      pagesEl.innerHTML = "";
      const avail = Math.min(980, pagesEl.clientWidth - 40);
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      fabric.Object.prototype.set({ transparentCorners: false, cornerColor: "#FF2E97", cornerStrokeColor: "#fff", borderColor: "#8A3FFC", cornerSize: 11, cornerStyle: "circle", borderScaleFactor: 1.5 });

      // ---------- page setup (lazy) ----------
      for (let i = 0; i < doc.numPages; i++) {
        const page = await doc.getPage(i + 1);
        const vp1 = page.getViewport({ scale: 1 });
        const base = Math.min(1.6, avail / vp1.width);
        const P = { i, page, w: vp1.width * base, h: vp1.height * base, base, el: null, fc: null, last: null };
        P.el = h("div", { class: "ed-page", style: { width: P.w + "px", height: P.h + "px" } }, h("span", { class: "pg-label", text: `Page ${i + 1} of ${doc.numPages}` }));
        pagesEl.appendChild(P.el);
        st.pages.push(P);
      }
      const renderBg = async (P) => {
        const c = P.el.querySelector("canvas.bg") || h("canvas", { class: "bg" });
        await lib.renderPage(P.page, P.base * st.zoom * dpr, c);
        c.style.width = P.w * st.zoom + "px"; c.style.height = P.h * st.zoom + "px";
        if (!c.parentNode) P.el.prepend(c);
      };
      const setupFabric = (P) => {
        const c = h("canvas");
        P.el.appendChild(c);
        const fc = (P.fc = new fabric.Canvas(c, { width: P.w * st.zoom, height: P.h * st.zoom, selection: true, preserveObjectStacking: true, enableRetinaScaling: true }));
        fc.setZoom(st.zoom);
        P.last = JSON.stringify(fc.toJSON());
        const snap = () => { if (st.mute) return; st.undo.push({ P, state: P.last }); if (st.undo.length > 80) st.undo.shift(); P.last = JSON.stringify(fc.toJSON()); };
        fc.on("object:added", snap); fc.on("object:modified", snap); fc.on("object:removed", snap);
        fc.on("text:editing:exited", (e) => { if (e.target && !e.target.text.trim()) fc.remove(e.target); });
        fc.on("mouse:down", (opt) => onDown(P, opt));
        fc.on("mouse:move", (opt) => onMove(P, opt));
        fc.on("mouse:up", () => onUp(P));
        fc.on("selection:created", syncProps); fc.on("selection:updated", syncProps);
        applyTool(P);
      };
      const io = new IntersectionObserver((ents) => ents.forEach(async (en) => {
        if (!en.isIntersecting) return;
        const P = st.pages.find((p) => p.el === en.target);
        io.unobserve(en.target);
        await renderBg(P);
        setupFabric(P);
      }), { root: pagesEl, rootMargin: "600px" });
      st.pages.forEach((P) => io.observe(P.el));

      // ---------- tools ----------
      let drag = null;
      function applyTool(P) {
        const fc = P.fc; if (!fc) return;
        fc.isDrawingMode = st.tool === "draw";
        if (fc.isDrawingMode) { fc.freeDrawingBrush = new fabric.PencilBrush(fc); fc.freeDrawingBrush.color = st.color; fc.freeDrawingBrush.width = st.size; fc.freeDrawingBrush.decimate = 2; }
        const creating = ["text", "highlight", "rect", "whiteout"].includes(st.tool);
        fc.selection = !creating;
        fc.defaultCursor = creating ? "crosshair" : "default";
        fc.forEachObject((o) => (o.selectable = !creating, o.evented = !creating || o.type === "i-text"));
      }
      function setTool(t) {
        if (t === "image") { imgInput.click(); return; }
        if (t === "sign") { openSign(); return; }
        st.tool = t;
        $$(".ed-tool[data-tool]", root).forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === t));
        st.pages.forEach(applyTool);
        $(".ed-status", root).textContent = { text: "· Click where you want to type.", highlight: "· Drag over text to highlight.", rect: "· Drag to draw a box.", whiteout: "· Drag to cover existing content.", draw: "· Draw freely with mouse or finger." }[t] || "";
      }
      function onDown(P, opt) {
        const fc = P.fc, p = fc.getPointer(opt.e);
        if (st.tool === "text") {
          if (opt.target && opt.target.type === "i-text") return;
          const fs = st.font * P.base; // pt on the page → canvas units
          const t = new fabric.IText("Type here", { left: p.x, top: p.y - fs * 0.6, fontFamily: "Helvetica, Arial, sans-serif", fontSize: fs, fill: st.color });
          fc.add(t); fc.setActiveObject(t); t.enterEditing(); t.selectAll();
          setTool("select");
          return;
        }
        if (["highlight", "rect", "whiteout"].includes(st.tool)) {
          const style = st.tool === "highlight" ? { fill: hexA(st.color === "#D90368" ? "#FFE600" : st.color, 0.38), strokeWidth: 0 }
            : st.tool === "whiteout" ? { fill: "#ffffff", strokeWidth: 0 } : { fill: "transparent", stroke: st.color, strokeWidth: st.size };
          const r = new fabric.Rect(Object.assign({ left: p.x, top: p.y, width: 1, height: 1, strokeUniform: true, objectCaching: false }, style));
          st.mute = true; fc.add(r); st.mute = false;
          drag = { P, r, x: p.x, y: p.y };
        }
      }
      function onMove(P, opt) {
        if (!drag || drag.P !== P) return;
        const p = P.fc.getPointer(opt.e);
        drag.r.set({ left: Math.min(p.x, drag.x), top: Math.min(p.y, drag.y), width: Math.abs(p.x - drag.x), height: Math.abs(p.y - drag.y) });
        P.fc.requestRenderAll();
      }
      function onUp(P) {
        if (!drag || drag.P !== P) return;
        const { r } = drag; drag = null;
        if (r.width < 4 && r.height < 4) { st.mute = true; P.fc.remove(r); st.mute = false; return; }
        r.setCoords();
        st.undo.push({ P, state: P.last }); P.last = JSON.stringify(P.fc.toJSON());
        r.selectable = true;
      }
      const hexA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };

      function activeObjects() { return st.pages.flatMap((P) => (P.fc ? P.fc.getActiveObjects().map((o) => [P, o]) : [])); }
      function syncProps() {
        const [pair] = activeObjects(); if (!pair) return;
        const o = pair[1];
        if (o.type === "i-text" && o.fill) { $("#ed-color").value = toHex(o.fill); $("#ed-font").value = Math.round(o.fontSize / pair[0].base); }
      }
      const toHex = (c) => (/^#/.test(c) ? c : "#D90368");
      function visiblePage() {
        const top = pagesEl.getBoundingClientRect().top;
        let best = st.pages[0], bd = Infinity;
        st.pages.forEach((P) => { const d = Math.abs(P.el.getBoundingClientRect().top - top); if (d < bd && P.fc) { bd = d; best = P; } });
        return best.fc ? best : st.pages.find((p) => p.fc);
      }
      function addImage(url, widthFrac = 0.35) {
        const P = visiblePage(); if (!P) return;
        fabric.Image.fromURL(url, (img) => {
          const s = (P.w * widthFrac) / img.width;
          img.set({ left: P.w / 2 - (img.width * s) / 2, top: P.h / 2 - (img.height * s) / 2, scaleX: s, scaleY: s });
          P.fc.add(img); P.fc.setActiveObject(img); P.fc.requestRenderAll();
          setTool("select");
        });
      }
      imgInput.addEventListener("change", () => {
        const file = imgInput.files[0]; imgInput.value = "";
        if (!file) return;
        const r = new FileReader(); r.onload = () => addImage(r.result); r.readAsDataURL(file);
      });

      // ---------- toolbar wiring ----------
      root.addEventListener("click", (e) => {
        const t = e.target.closest(".ed-tool[data-tool]"); if (t) return setTool(t.dataset.tool);
        const a = e.target.closest("[data-act]"); if (!a) return;
        const act = a.dataset.act;
        if (act === "undo") undo();
        else if (act === "del") del();
        else if (act === "zi" || act === "zo") zoom(act === "zi" ? 1.2 : 1 / 1.2);
        else if (act === "change") { ws.input.click(); }
        else if (act === "save") save();
      });
      $("#ed-color").addEventListener("input", (e) => {
        st.color = e.target.value;
        activeObjects().forEach(([P, o]) => { if (o.type === "i-text") o.set("fill", st.color); else if (o.type === "path") o.set("stroke", st.color); else if (o.type === "rect" && o.stroke) o.set("stroke", st.color); P.fc.requestRenderAll(); });
        st.pages.forEach((P) => P.fc && P.fc.isDrawingMode && (P.fc.freeDrawingBrush.color = st.color));
      });
      $("#ed-size").addEventListener("change", (e) => {
        st.size = +e.target.value;
        activeObjects().forEach(([P, o]) => { if (o.type === "path" || (o.type === "rect" && o.stroke)) o.set("strokeWidth", st.size); P.fc.requestRenderAll(); });
        st.pages.forEach((P) => P.fc && P.fc.isDrawingMode && (P.fc.freeDrawingBrush.width = st.size));
      });
      $("#ed-font").addEventListener("change", (e) => {
        st.font = +e.target.value;
        activeObjects().forEach(([P, o]) => { if (o.type === "i-text") { o.set({ fontSize: st.font * P.base, scaleX: 1, scaleY: 1 }); P.fc.requestRenderAll(); P.fc.fire("object:modified", { target: o }); } });
      });
      function undo() {
        const u = st.undo.pop(); if (!u) return YP.toast("Nothing to undo.");
        st.mute = true;
        u.P.fc.loadFromJSON(u.state, () => { u.P.fc.renderAll(); u.P.last = u.state; st.mute = false; applyTool(u.P); });
      }
      function del() {
        const sel = activeObjects();
        if (!sel.length) return YP.toast("Select something to delete first.");
        sel.forEach(([P, o]) => { if (o.isEditing) return; P.fc.remove(o); P.fc.discardActiveObject(); P.fc.requestRenderAll(); });
      }
      function zoom(k) {
        st.zoom = Math.max(0.5, Math.min(3, st.zoom * k));
        st.pages.forEach((P) => {
          P.el.style.width = P.w * st.zoom + "px"; P.el.style.height = P.h * st.zoom + "px";
          if (P.fc) { P.fc.setZoom(st.zoom); P.fc.setWidth(P.w * st.zoom); P.fc.setHeight(P.h * st.zoom); renderBg(P); }
        });
      }
      ws._edKeys && document.removeEventListener("keydown", ws._edKeys);
      ws._edKeys = (e) => {
        if (ws.state !== "files" || !document.body.contains(pagesEl)) return;
        const editing = activeObjects().some(([, o]) => o.isEditing);
        if (editing || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        if (e.key === "Delete" || e.key === "Backspace") { if (activeObjects().length) { e.preventDefault(); del(); } }
        else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
      };
      document.addEventListener("keydown", ws._edKeys);

      // ---------- signature ----------
      function openSign() {
        const m = h("div", { class: "modal open", role: "dialog", "aria-modal": "true", "aria-label": "Create signature" });
        m.innerHTML = `<div class="modal-bg"></div><div class="modal-card wide"><button class="icon-btn modal-close" type="button" aria-label="Close">${icon("x")}</button>
          <h3>Create your signature</h3>
          <div class="seg" style="margin-bottom:14px"><button type="button" data-st="draw" aria-pressed="true">Draw</button><button type="button" data-st="type" aria-pressed="false">Type</button></div>
          <div data-pane="draw"><canvas class="sig-pad" width="1200" height="400"></canvas><p class="hint" style="margin-top:8px">Sign with your mouse, trackpad or finger.</p></div>
          <div data-pane="type" hidden><input class="input" data-sigtext placeholder="Your full name" style="font-family:'Dancing Script',cursive;font-size:2rem;min-height:70px"></div>
          <div class="row" style="justify-content:space-between;margin-top:12px">
            <div class="swatches">${["#1F1A3D", "#0B3D91", "#541388", "#D90368"].map((c, i) => `<button type="button" class="swatch" data-ink="${c}" aria-pressed="${i === 0}" style="background:${c}" aria-label="Ink ${c}"></button>`).join("")}</div>
            <div class="row"><button class="btn btn-ghost" type="button" data-clear>Clear</button><button class="btn btn-primary" type="button" data-use>Place signature</button></div></div></div>`;
        document.body.appendChild(m);
        if (!document.querySelector("link[data-sigfont]")) document.head.appendChild(h("link", { rel: "stylesheet", "data-sigfont": "1", href: "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600&display=swap" }));
        const pad = $(".sig-pad", m), px = pad.getContext("2d");
        let ink = "#1F1A3D", mode = "draw", drawing = false, has = false, last;
        px.lineCap = px.lineJoin = "round"; px.lineWidth = 10;
        const pos = (e) => { const r = pad.getBoundingClientRect(); return [(e.clientX - r.left) * (pad.width / r.width), (e.clientY - r.top) * (pad.height / r.height)]; };
        pad.addEventListener("pointerdown", (e) => { drawing = true; has = true; last = pos(e); pad.setPointerCapture(e.pointerId); });
        pad.addEventListener("pointermove", (e) => { if (!drawing) return; const p = pos(e); px.strokeStyle = ink; px.beginPath(); px.moveTo(...last); px.lineTo(...p); px.stroke(); last = p; });
        pad.addEventListener("pointerup", () => (drawing = false));
        const close = () => m.remove();
        $(".modal-bg", m).onclick = close; $(".modal-close", m).onclick = close;
        $$("[data-st]", m).forEach((b) => (b.onclick = () => { mode = b.dataset.st; $$("[data-st]", m).forEach((x) => x.setAttribute("aria-pressed", x === b)); $$("[data-pane]", m).forEach((p) => (p.hidden = p.dataset.pane !== mode)); if (mode === "type") $("[data-sigtext]", m).focus(); }));
        $$("[data-ink]", m).forEach((b) => (b.onclick = () => { ink = b.dataset.ink; $$("[data-ink]", m).forEach((x) => x.setAttribute("aria-pressed", x === b)); $("[data-sigtext]", m).style.color = ink; }));
        $("[data-clear]", m).onclick = () => { px.clearRect(0, 0, pad.width, pad.height); has = false; $("[data-sigtext]", m).value = ""; };
        $("[data-use]", m).onclick = async () => {
          let c;
          if (mode === "type") {
            const txt = $("[data-sigtext]", m).value.trim();
            if (!txt) return YP.toast("Type your name first.", "err");
            await document.fonts.load("600 120px 'Dancing Script'").catch(() => {});
            c = document.createElement("canvas"); const x = c.getContext("2d");
            x.font = "600 120px 'Dancing Script', cursive"; c.width = Math.ceil(x.measureText(txt).width) + 40; c.height = 180;
            x.font = "600 120px 'Dancing Script', cursive"; x.fillStyle = ink; x.textBaseline = "middle"; x.fillText(txt, 20, 95);
          } else {
            if (!has) return YP.toast("Draw your signature first.", "err");
            c = trim(pad);
          }
          close();
          addImage(c.toDataURL("image/png"), 0.28);
        };
      }
      function trim(c) {
        const x = c.getContext("2d"), d = x.getImageData(0, 0, c.width, c.height).data;
        let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
        for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) if (d[(y * c.width + xx) * 4 + 3] > 10) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        const o = document.createElement("canvas"); o.width = Math.max(1, x1 - x0 + 16); o.height = Math.max(1, y1 - y0 + 16);
        o.getContext("2d").drawImage(c, x0 - 8, y0 - 8, o.width, o.height, 0, 0, o.width, o.height);
        return o;
      }

      // ---------- save ----------
      async function save() {
        st.pages.forEach((P) => P.fc && (P.fc.discardActiveObject(), P.fc.getObjects().forEach((o) => o.isEditing && o.exitEditing()), P.fc.renderAll()));
        if (!st.pages.some((P) => P.fc && P.fc.getObjects().length)) return YP.toast("Add some text, a drawing or a signature first.", "err");
        ws.editorNodes = Array.from(ws.root.childNodes);
        ws.run({});
      }
      setTool("select");
    },

    async process(files, o, ctx) {
      const st = ctx.ws.ed;
      const PDFLib = await lib.pdfLib();
      ctx.progress(0.05, "Reading original PDF…");
      const doc = await lib.openPdfLib(files[0]);
      const pages = doc.getPages();
      const edited = st.pages.filter((P) => P.fc && P.fc.getObjects().length);
      for (let k = 0; k < edited.length; k++) {
        ctx.check();
        const P = edited[k];
        ctx.progress(0.1 + 0.8 * (k / edited.length), `Applying edits to page ${P.i + 1}…`);
        const page = pages[P.i], B = vbox(page);
        const targetPx = Math.min(3200, B.W * 3); // ≈216 dpi
        const url = P.fc.toDataURL({ format: "png", multiplier: targetPx / (P.w * st.zoom) });
        const png = await doc.embedPng(url);
        const [x, y] = B.map(0, 0);
        page.drawImage(png, { x, y, width: B.W, height: B.H, rotate: PDFLib.degrees(B.R) });
        await ctx.tick();
      }
      ctx.progress(0.95, "Saving…");
      doc.setProducer("YoPdfs");
      return { outputs: [{ name: YP.baseName(files[0].name) + "-edited.pdf", blob: lib.pdfBlob(await doc.save()) }], title: "Your edited PDF is ready!" };
    },
    resultView(ws, wrap) {
      if (!ws.editorNodes) return;
      const btn = h("button", { class: "btn btn-lg btn-soft", type: "button", html: icon("edit") + " Continue editing", onclick: () => { ws.root.replaceChildren(...ws.editorNodes); ws.state = "files"; } });
      wrap.querySelector(".result-actions").appendChild(btn);
    }
  });
})();
