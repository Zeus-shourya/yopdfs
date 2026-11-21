/* ==========================================================================
   YoPdfs — core PDF tools (pdf-lib + PDF.js, all in-browser)
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP, lib = YP.lib, ui = YP.ui, { h, $, $$, icon, esc } = YP;

  const SIZES = { a4: [595.28, 841.89], letter: [612, 792], legal: [612, 1008] };

  /* ---------------------------------------------------------------- shared */
  /* visual page box → user space mapping, so stamps land correctly on rotated pages */
  function vbox(page) {
    let cb;
    try { cb = page.getCropBox(); } catch (e) { cb = null; }
    if (!cb || !cb.width) { const s = page.getSize(); cb = { x: 0, y: 0, width: s.width, height: s.height }; }
    const w = cb.width, h = cb.height, ox = cb.x, oy = cb.y;
    const R = ((page.getRotation().angle % 360) + 360) % 360;
    const W = R % 180 ? h : w, H = R % 180 ? w : h;
    const map = (vx, vy) => {
      const p = R === 90 ? [w - vy, vx] : R === 180 ? [w - vx, h - vy] : R === 270 ? [vy, h - vx] : [vx, vy];
      return [p[0] + ox, p[1] + oy];
    };
    return { W, H, R, map };
  }
  const hexRgb = (PDFLib, hex) => { const n = parseInt(hex.slice(1), 16); return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); };
  const canEncode = (font, text) => { try { font.encodeText(text); return true; } catch (e) { return false; } };
  /* render arbitrary (e.g. Hindi) text to a PNG for fonts the PDF standard fonts can't draw */
  async function textPng(text, px, color, bold) {
    const c = document.createElement("canvas"), x = c.getContext("2d");
    const font = `${bold ? "700" : "500"} ${px}px "Noto Sans", "Nirmala UI", "Segoe UI", Arial, sans-serif`;
    x.font = font;
    const w = Math.ceil(x.measureText(text).width) + 8, hh = Math.ceil(px * 1.35);
    c.width = w; c.height = hh;
    x.font = font; x.fillStyle = color; x.textBaseline = "middle"; x.fillText(text, 4, hh / 2);
    return { bytes: new Uint8Array(await (await lib.toBlob(c, "image/png")).arrayBuffer()), w, h: hh };
  }
  const pdfOut = (bytes, name, extra) => Object.assign({ name, blob: lib.pdfBlob(bytes) }, extra || {});
  const pagesField = (val = "") => ui.input("pages", "Pages", val, 'placeholder="All pages — or e.g. 1-3, 5"');
  const pdfPreload = () => Promise.all([lib.pdfLib(), lib.pdfjs()]);

  /* ======================================================== images → PDF */
  function imagesToPdf(kind) {
    return {
      sortable: true, actionLabel: "Convert to PDF", preload: lib.pdfLib,
      options: () =>
        ui.seg("size", "Page size", [["fit", "Fit image"], ["a4", "A4"], ["letter", "Letter"]], "a4") +
        ui.seg("orient", "Orientation", [["auto", "Auto"], ["portrait", "Portrait"], ["landscape", "Landscape"]], "auto") +
        ui.seg("margin", "Margin", [["0", "None"], ["18", "Small"], ["40", "Large"]], "18") +
        ui.seg("out", "Output", [["one", "One PDF"], ["each", "One per image"]], "one"),
      async process(files, o, ctx) {
        const PDFLib = await lib.pdfLib();
        const margin = +o.margin;
        const outs = [];
        let doc = await PDFLib.PDFDocument.create();
        for (let i = 0; i < files.length; i++) {
          ctx.check();
          const f = files[i];
          ctx.progress(i / files.length, `Placing image ${i + 1} of ${files.length}…`);
          const img = await embedImage(PDFLib, doc, f);
          const iw = img.width * 0.75, ih = img.height * 0.75; // px → pt at 96 dpi
          let pw, ph;
          if (o.size === "fit") { pw = iw + margin * 2; ph = ih + margin * 2; }
          else {
            [pw, ph] = SIZES[o.size];
            const land = o.orient === "landscape" || (o.orient === "auto" && img.width > img.height);
            if (land) [pw, ph] = [ph, pw];
          }
          const page = doc.addPage([pw, ph]);
          const s = Math.min((pw - margin * 2) / iw, (ph - margin * 2) / ih, o.size === "fit" ? 1 : Infinity);
          const dw = iw * s, dh = ih * s;
          page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
          if (o.out === "each") {
            outs.push(pdfOut(await doc.save(), YP.baseName(f.name) + ".pdf"));
            doc = await PDFLib.PDFDocument.create();
          }
          await ctx.tick();
        }
        if (o.out !== "each") {
          ctx.progress(0.95, "Saving PDF…");
          doc.setTitle(YP.baseName(files[0].name)); doc.setProducer("YoPdfs"); doc.setCreator("YoPdfs — yopdfs.com");
          outs.push(pdfOut(await doc.save(), (files.length === 1 ? YP.baseName(files[0].name) : "yopdfs-images") + ".pdf"));
        }
        return outs;
      }
    };
  }
  async function embedImage(PDFLib, doc, file) {
    const buf = await lib.buffer(file);
    const u8 = new Uint8Array(buf);
    const isJpg = u8[0] === 0xff && u8[1] === 0xd8, isPng = u8[0] === 0x89 && u8[1] === 0x50;
    try {
      if (isJpg && lib.jpegOrientation(buf) === 1) return await doc.embedJpg(u8);
      if (isPng) return await doc.embedPng(u8);
    } catch (e) { /* fall back to canvas re-encode below */ }
    // webp/gif/bmp/rotated JPEG → canvas (browser applies EXIF orientation)
    const c = await lib.imageCanvas(file, isPng ? null : "#fff");
    const asPng = !isJpg && /png|gif|bmp/i.test(file.type + file.name);
    const blob = await lib.toBlob(c, asPng ? "image/png" : "image/jpeg", 0.92);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    c.width = c.height = 0;
    return asPng ? doc.embedPng(bytes) : doc.embedJpg(bytes);
  }
  YP.registerTool("jpg-to-pdf", imagesToPdf("jpg"));
  YP.registerTool("png-to-pdf", imagesToPdf("png"));

  /* ======================================================== PDF → images */
  function pdfToImages(fmt) {
    const mime = fmt === "png" ? "image/png" : "image/jpeg";
    return {
      actionLabel: `Convert to ${fmt.toUpperCase()}`, preload: lib.pdfjs,
      options: () =>
        ui.seg("dpi", "Image quality", [["72", "72 DPI"], ["150", "150 DPI"], ["300", "300 DPI"]], "150", "150 for screens, 300 for print.") +
        (fmt === "jpg" ? ui.range("q", "JPG quality", 60, 100, 1, 90, "%") : "") +
        pagesField(),
      async process(files, o, ctx) {
        const outs = [];
        const scale = +o.dpi / 72;
        for (let fi = 0; fi < files.length; fi++) {
          const f = files[fi];
          let doc;
          try { doc = await lib.openPdfjs(f); }
          catch (e) { throw new Error(e.name === "PasswordException" ? `“${f.name}” is password-protected. Unlock it first.` : `Couldn't open “${f.name}”: ${e.message}`); }
          const idx = lib.parseRanges(o.pages, doc.numPages);
          for (let k = 0; k < idx.length; k++) {
            ctx.check();
            ctx.progress((fi + k / idx.length) / files.length, `Rendering page ${idx[k] + 1} of ${doc.numPages}${files.length > 1 ? ` · file ${fi + 1}/${files.length}` : ""}…`);
            const page = await doc.getPage(idx[k] + 1);
            const c = await lib.renderPage(page, scale);
            const blob = await lib.toBlob(c, mime, (o.q || 90) / 100);
            c.width = c.height = 0; page.cleanup();
            outs.push({ name: `${YP.baseName(f.name)}-page-${idx[k] + 1}.${fmt}`, blob });
          }
          doc.destroy();
        }
        return { outputs: outs, zipName: `${YP.baseName(files[0].name)}-${fmt}.zip` };
      }
    };
  }
  YP.registerTool("pdf-to-jpg", pdfToImages("jpg"));
  YP.registerTool("pdf-to-png", pdfToImages("png"));

  /* ======================================================== merge */
  YP.registerTool("merge-pdf", {
    sortable: true, minFiles: 2, actionLabel: "Merge PDF", preload: lib.pdfLib,
    options: () => ui.note("Files are merged in the order shown. Drag cards or use the arrows to reorder.") + ui.check("blank", "Insert a blank page after files with an odd page count (for double-sided printing)", false),
    async process(files, o, ctx) {
      const PDFLib = await lib.pdfLib();
      const out = await PDFLib.PDFDocument.create();
      for (let i = 0; i < files.length; i++) {
        ctx.check();
        ctx.progress(i / files.length, `Adding ${files[i].name}…`);
        const src = await lib.openPdfLib(files[i]);
        const pages = await out.copyPages(src, src.getPageIndices());
        pages.forEach((p) => out.addPage(p));
        if (o.blank && pages.length % 2 && i < files.length - 1) { const s = pages[pages.length - 1].getSize(); out.addPage([s.width, s.height]); }
        await ctx.tick();
      }
      ctx.progress(0.95, "Saving…");
      out.setProducer("YoPdfs"); out.setCreator("YoPdfs — yopdfs.com");
      return [pdfOut(await out.save(), "yopdfs-merged.pdf")];
    }
  });

  /* ======================================================== split */
  YP.registerTool("split-pdf", {
    actionLabel: "Split PDF", preload: pdfPreload, optionsTitle: "Split mode",
    async onFiles(ws) { ws.sel = new Set(); },
    mainView(ws, main) {
      const f = ws.files[0];
      main.innerHTML = `<div class="ws-files-head"><h3>${esc(f.name)} <span class="muted" style="font-weight:500;font-size:.85rem" data-pc></span></h3>
        <div class="row" style="gap:6px"><button class="btn btn-sm btn-ghost" type="button" data-all>Select all</button><button class="btn btn-sm btn-ghost" type="button" data-none>Clear</button><button class="btn btn-sm btn-soft" type="button" data-change>${icon("refresh")} Change file</button></div></div><div class="page-grid"></div>`;
      $("[data-change]", main).onclick = () => ws.input.click();
      const grid = $(".page-grid", main);
      grid.innerHTML = `<div class="muted" style="padding:30px;grid-column:1/-1;text-align:center"><span class="loader-dots"><i></i><i></i><i></i></span><br>Loading pages…</div>`;
      lib.openPdfjs(f.file).then(async (doc) => {
        ws.pages = doc.numPages;
        $("[data-pc]", main).textContent = `· ${doc.numPages} pages · click pages to select`;
        const tiles = await lib.pageGrid(doc, grid, {
          tile: (el, i) => (el.classList.toggle("sel", ws.sel.has(i)), el.addEventListener("click", () => {
            ws.sel.has(i) ? ws.sel.delete(i) : ws.sel.add(i);
            el.classList.toggle("sel", ws.sel.has(i));
            const r = ws.form && ws.form.querySelector('input[value="select"]');
            if (r && !r.checked) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
            sync(ws);
          }))
        });
        sync(ws);
        $("[data-all]", main).onclick = () => { tiles.forEach((t, i) => { ws.sel.add(i); t.classList.add("sel"); }); sync(ws); };
        $("[data-none]", main).onclick = () => { ws.sel.clear(); tiles.forEach((t) => t.classList.remove("sel")); sync(ws); };
      }).catch((e) => { grid.innerHTML = `<p class="opt-note warn">${e.name === "PasswordException" ? "This PDF is password-protected — unlock it first." : "Couldn't read this PDF."}</p>`; });
    },
    options: () =>
      ui.seg("mode", "", [["ranges", "Ranges"], ["every", "Every N"], ["all", "All pages"], ["select", "Selected"]], "ranges") +
      `<div data-m="ranges">${ui.input("ranges", "Page ranges", "", 'placeholder="e.g. 1-3, 4-8, 9"', "Each range becomes its own PDF.")}</div>
       <div data-m="every" hidden>${ui.input("every", "Split every", "1", 'type="number" min="1"', "pages per file")}</div>
       <div data-m="all" hidden>${ui.note("Every page becomes a separate PDF (downloaded as a ZIP).")}</div>
       <div data-m="select" hidden>${ui.seg("selout", "Selected pages as", [["one", "One PDF"], ["each", "Separate PDFs"]], "one")}<p class="hint" data-selcount style="margin-top:8px">No pages selected — click thumbnails.</p></div>`,
    bind(ws, form) {
      const upd = () => { const m = ui.read(form).mode; $$("[data-m]", form).forEach((d) => (d.hidden = d.dataset.m !== m)); sync(ws); };
      form.addEventListener("change", upd); upd();
    },
    validate(files, o, ws) {
      if (o.mode === "select" && !ws.sel.size) return "Click the page thumbnails you want to extract.";
      if (o.mode === "ranges" && !o.ranges.trim()) return "Enter at least one page range, like 1-3.";
    },
    async process(files, o, ctx) {
      const PDFLib = await lib.pdfLib();
      const src = await lib.openPdfLib(files[0]);
      const n = src.getPageCount(), base = YP.baseName(files[0].name);
      let groups;
      if (o.mode === "ranges") groups = lib.rangeGroups(o.ranges, n);
      else if (o.mode === "every") { const k = Math.max(1, o.every | 0); groups = []; for (let i = 0; i < n; i += k) groups.push(Array.from({ length: Math.min(k, n - i) }, (_, j) => i + j)); }
      else if (o.mode === "all") groups = Array.from({ length: n }, (_, i) => [i]);
      else { const s = Array.from(ctx.ws.sel).sort((a, b) => a - b); groups = o.selout === "each" ? s.map((i) => [i]) : [s]; }
      const outs = [];
      for (let g = 0; g < groups.length; g++) {
        ctx.check();
        ctx.progress(g / groups.length, `Creating file ${g + 1} of ${groups.length}…`);
        const d = await PDFLib.PDFDocument.create();
        (await d.copyPages(src, groups[g])).forEach((p) => d.addPage(p));
        const idx = groups[g];
        const label = idx.length === 1 ? `page-${idx[0] + 1}` : isRun(idx) ? `pages-${idx[0] + 1}-${idx[idx.length - 1] + 1}` : `pages-${idx.map((i) => i + 1).slice(0, 6).join("_")}`;
        outs.push(pdfOut(await d.save(), `${base}-${label}.pdf`));
        await ctx.tick();
      }
      return { outputs: outs, zipName: `${base}-split.zip` };
    }
  });
  const isRun = (a) => a.every((v, i) => !i || v === a[i - 1] + 1);
  function sync(ws) {
    const el = ws.form && $("[data-selcount]", ws.form);
    if (el) el.textContent = ws.sel.size ? `${ws.sel.size} page${ws.sel.size > 1 ? "s" : ""} selected: ${Array.from(ws.sel).sort((a, b) => a - b).map((i) => i + 1).join(", ")}` : "No pages selected — click thumbnails.";
  }

  /* ======================================================== compress */
  const LEVELS = {
    low: { max: 2400, q: 0.82, label: "Light" },
    rec: { max: 1600, q: 0.66, label: "Recommended" },
    high: { max: 1100, q: 0.5, label: "Strong" }
  };
  YP.registerTool("compress-pdf", {
    actionLabel: "Compress PDF", preload: pdfPreload, optionsTitle: "Compression level",
    options: () =>
      ui.seg("level", "", [["low", "Light"], ["rec", "Recommended"], ["high", "Strong"], ["max", "Maximum"]], "rec") +
      `<div data-lv="low" hidden>${ui.note("Best quality. Re-compresses only very large images.")}</div>
       <div data-lv="rec">${ui.note("Great quality, much smaller. Text and vector graphics stay sharp and selectable.")}</div>
       <div data-lv="high" hidden>${ui.note("Smallest size while keeping text selectable. Images get softer.")}</div>
       <div data-lv="max" hidden>${ui.note("Turns every page into an optimised image — best for scanned PDFs. Text will no longer be selectable.", true)}${ui.seg("mdpi", "Resolution", [["96", "96 DPI"], ["130", "130 DPI"], ["160", "160 DPI"]], "130")}</div>`,
    bind(ws, form) { const u = () => { const l = ui.read(form).level; $$("[data-lv]", form).forEach((d) => (d.hidden = d.dataset.lv !== l)); }; form.addEventListener("change", u); u(); },
    async process(files, o, ctx) {
      const outs = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        const sub = (fr, t) => ctx.progress((i + fr) / files.length, (files.length > 1 ? `File ${i + 1}/${files.length} · ` : "") + t);
        let bytesOut = o.level === "max" ? await rasterCompress(f, +o.mdpi, sub, ctx) : await smartCompress(f, LEVELS[o.level], sub, ctx);
        const better = bytesOut.length < f.size;
        outs.push({ name: YP.baseName(f.name) + "-compressed.pdf", blob: better ? lib.pdfBlob(bytesOut) : new Blob([await lib.buffer(f)], { type: "application/pdf" }), before: f.size });
      }
      const tot0 = files.reduce((a, f) => a + f.size, 0), tot1 = outs.reduce((a, o) => a + o.blob.size, 0);
      const pct = Math.round((1 - tot1 / tot0) * 100);
      return { outputs: outs, title: pct > 0 ? `Your PDF is ${pct}% smaller!` : "Already well optimised", summary: `${YP.bytes(tot0)} → <b>${YP.bytes(tot1)}</b>` + (pct <= 0 ? " · try the Maximum level for scanned files" : "") };
    }
  });

  async function inflate(u8) {
    const ds = new DecompressionStream("deflate");
    const stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  function unpredict(data, colors, bpc, cols) {
    const bpp = Math.max(1, (colors * bpc) >> 3), rowLen = (colors * bpc * cols + 7) >> 3;
    const rows = Math.floor(data.length / (rowLen + 1));
    const out = new Uint8Array(rows * rowLen);
    for (let r = 0; r < rows; r++) {
      const ft = data[r * (rowLen + 1)], src = r * (rowLen + 1) + 1, dst = r * rowLen;
      for (let i = 0; i < rowLen; i++) {
        const raw = data[src + i];
        const a = i >= bpp ? out[dst + i - bpp] : 0, b = r ? out[dst - rowLen + i] : 0, c = r && i >= bpp ? out[dst - rowLen + i - bpp] : 0;
        let v;
        switch (ft) {
          case 1: v = raw + a; break;
          case 2: v = raw + b; break;
          case 3: v = raw + ((a + b) >> 1); break;
          case 4: { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v = raw + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
          default: v = raw;
        }
        out[dst + i] = v & 255;
      }
    }
    return out;
  }

  async function smartCompress(file, L, sub, ctx) {
    const PDFLib = await lib.pdfLib();
    const { PDFName, PDFRawStream, PDFArray, PDFDict, PDFRef } = PDFLib;
    sub(0.02, "Reading PDF…");
    const doc = await lib.openPdfLib(file);
    const c = doc.context;
    const N = (n) => PDFName.of(n);
    const imgs = [], smasks = new Set();
    for (const [ref, obj] of c.enumerateIndirectObjects()) {
      if (!(obj instanceof PDFRawStream) || obj.dict.get(N("Subtype")) !== N("Image")) continue;
      const sm = obj.dict.get(N("SMask"));
      if (sm instanceof PDFRef) smasks.add(sm.toString());
      imgs.push([ref, obj]);
    }
    let done = 0, replaced = 0;
    for (const [ref, obj] of imgs) {
      ctx.check();
      sub(0.05 + 0.8 * (done++ / Math.max(1, imgs.length)), `Optimising image ${done} of ${imgs.length}…`);
      if (smasks.has(ref.toString())) continue;
      try {
        const d = obj.dict;
        if (d.get(N("ImageMask")) || d.get(N("Decode")) || d.lookup(N("Mask")) instanceof PDFArray) continue;
        const w = d.lookup(N("Width")).asNumber(), hgt = d.lookup(N("Height")).asNumber();
        if (w * hgt < 60000 || obj.contents.length < 25000) continue;
        let filter = d.lookup(N("Filter"));
        if (filter instanceof PDFArray) { if (filter.size() !== 1) continue; filter = filter.lookup(0); }
        let cs = d.lookup(N("ColorSpace")), comps = 0;
        if (cs === N("DeviceRGB")) comps = 3;
        else if (cs === N("DeviceGray")) comps = 1;
        else if (cs instanceof PDFArray && cs.lookup(0) === N("ICCBased")) { const icc = cs.lookup(1); const n = icc && icc.dict && icc.dict.lookup(N("N")); comps = n ? n.asNumber() : 0; }
        if (comps !== 1 && comps !== 3) continue;
        let bitmap;
        if (filter === N("DCTDecode")) {
          bitmap = await createImageBitmap(new Blob([obj.contents], { type: "image/jpeg" }));
        } else if (filter === N("FlateDecode")) {
          const bpc = d.lookup(N("BitsPerComponent"));
          if (!bpc || bpc.asNumber() !== 8) continue;
          let raw = await inflate(obj.contents);
          const parms = d.lookup(N("DecodeParms"));
          const pred = parms instanceof PDFDict && parms.lookup(N("Predictor")) ? parms.lookup(N("Predictor")).asNumber() : 1;
          if (pred >= 10) raw = unpredict(raw, comps, 8, w);
          else if (pred !== 1) continue;
          if (raw.length < w * hgt * comps) continue;
          const rgba = new Uint8ClampedArray(w * hgt * 4);
          for (let p = 0, q = 0; p < w * hgt; p++, q += comps) {
            const o4 = p * 4;
            if (comps === 3) { rgba[o4] = raw[q]; rgba[o4 + 1] = raw[q + 1]; rgba[o4 + 2] = raw[q + 2]; }
            else rgba[o4] = rgba[o4 + 1] = rgba[o4 + 2] = raw[q];
            rgba[o4 + 3] = 255;
          }
          bitmap = await createImageBitmap(new ImageData(rgba, w, hgt));
        } else continue;
        const s = Math.min(1, L.max / Math.max(w, hgt));
        const nw = Math.max(1, Math.round(w * s)), nh = Math.max(1, Math.round(hgt * s));
        const cv = document.createElement("canvas"); cv.width = nw; cv.height = nh;
        const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, nw, nh); cx.imageSmoothingQuality = "high";
        cx.drawImage(bitmap, 0, 0, nw, nh); bitmap.close && bitmap.close();
        const jpg = new Uint8Array(await (await lib.toBlob(cv, "image/jpeg", L.q)).arrayBuffer());
        cv.width = cv.height = 0;
        if (jpg.length >= obj.contents.length * 0.9) continue;
        const nd = c.obj({ Type: "XObject", Subtype: "Image", Width: nw, Height: nh, ColorSpace: "DeviceRGB", BitsPerComponent: 8, Filter: "DCTDecode", Length: jpg.length });
        const sm = d.get(N("SMask")); if (sm) nd.set(N("SMask"), sm);
        const it = d.get(N("Interpolate")); if (it) nd.set(N("Interpolate"), it);
        c.assign(ref, PDFRawStream.of(nd, jpg));
        replaced++;
      } catch (e) { /* skip images we can't safely touch */ }
      if (done % 4 === 0) await ctx.tick();
    }
    sub(0.88, "Repacking file structure…");
    let target = doc;
    const cat = doc.catalog;
    if (!cat.get(N("AcroForm")) && !cat.get(N("Outlines")) && !cat.get(N("StructTreeRoot"))) {
      // copy pages into a fresh document: drops orphaned objects and old revisions
      target = await PDFLib.PDFDocument.create();
      (await target.copyPages(doc, doc.getPageIndices())).forEach((p) => target.addPage(p));
      const t = doc.getTitle(); if (t) target.setTitle(t);
    }
    target.setProducer("YoPdfs");
    return target.save({ useObjectStreams: true });
  }

  async function rasterCompress(file, dpi, sub, ctx) {
    const PDFLib = await lib.pdfLib();
    let src;
    try { src = await lib.openPdfjs(file); } catch (e) { throw new Error(e.name === "PasswordException" ? "This PDF is password-protected — unlock it first." : e.message); }
    const out = await PDFLib.PDFDocument.create();
    for (let i = 1; i <= src.numPages; i++) {
      ctx.check();
      sub((i - 1) / src.numPages, `Optimising page ${i} of ${src.numPages}…`);
      const page = await src.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const cv = await lib.renderPage(page, dpi / 72);
      const jpg = await out.embedJpg(new Uint8Array(await (await lib.toBlob(cv, "image/jpeg", 0.6)).arrayBuffer()));
      cv.width = cv.height = 0; page.cleanup();
      out.addPage([vp.width, vp.height]).drawImage(jpg, { x: 0, y: 0, width: vp.width, height: vp.height });
      await ctx.tick();
    }
    src.destroy();
    out.setProducer("YoPdfs");
    return out.save();
  }

  /* ======================================================== rotate */
  YP.registerTool("rotate-pdf", {
    actionLabel: "Apply rotation", preload: pdfPreload,
    async onFiles(ws) { ws.rot = []; },
    mainView(ws, main) {
      const f = ws.files[0];
      main.innerHTML = `<div class="ws-files-head"><h3>${esc(f.name)}</h3><div class="row" style="gap:6px">
        <button class="btn btn-sm btn-soft" type="button" data-all="-90">${icon("rotl")} All left</button>
        <button class="btn btn-sm btn-soft" type="button" data-all="90">${icon("rotr")} All right</button>
        <button class="btn btn-sm btn-ghost" type="button" data-reset>Reset</button>
        <button class="btn btn-sm btn-ghost" type="button" data-change>${icon("refresh")} Change file</button></div></div><div class="page-grid"></div>`;
      $("[data-change]", main).onclick = () => ws.input.click();
      const grid = $(".page-grid", main);
      const apply = (t, i) => { const cv = t.querySelector("canvas"); if (cv) cv.style.transform = `rotate(${ws.rot[i] || 0}deg) scale(${(ws.rot[i] || 0) % 180 ? 0.75 : 1})`; };
      grid.innerHTML = `<div class="muted" style="padding:30px;grid-column:1/-1;text-align:center"><span class="loader-dots"><i></i><i></i><i></i></span><br>Loading pages…</div>`;
      lib.openPdfjs(f.file).then(async (doc) => {
        if (!ws.rot || ws.rot.length !== doc.numPages) ws.rot = new Array(doc.numPages).fill(0);
        const tiles = await lib.pageGrid(doc, grid, {
          tile(el, i) {
            el.style.cursor = "default";
            const btns = h("div", { class: "rot-btns" },
              h("button", { class: "icon-btn sm", type: "button", "aria-label": `Rotate page ${i + 1} left`, html: icon("rotl"), onclick: (e) => { e.stopPropagation(); ws.rot[i] = (ws.rot[i] - 90) % 360; apply(el, i); } }),
              h("button", { class: "icon-btn sm", type: "button", "aria-label": `Rotate page ${i + 1} right`, html: icon("rotr"), onclick: (e) => { e.stopPropagation(); ws.rot[i] = (ws.rot[i] + 90) % 360; apply(el, i); } }));
            el.appendChild(btns);
            el.addEventListener("rendered", () => apply(el, i));
          }
        });
        $$("[data-all]", main).forEach((b) => (b.onclick = () => { ws.rot = ws.rot.map((r) => (r + +b.dataset.all) % 360); tiles.forEach(apply); }));
        $("[data-reset]", main).onclick = () => { ws.rot.fill(0); tiles.forEach(apply); };
      }).catch(() => { grid.innerHTML = `<p class="opt-note warn">Couldn't read this PDF. If it's password-protected, unlock it first.</p>`; });
    },
    options: () => ui.note("Use the buttons on each page — or rotate all pages at once from the toolbar."),
    validate: (f, o, ws) => (ws.rot.some((r) => r % 360) ? null : "Rotate at least one page first."),
    async process(files, o, ctx) {
      const PDFLib = await lib.pdfLib();
      const doc = await lib.openPdfLib(files[0]);
      doc.getPages().forEach((p, i) => {
        const d = ctx.ws.rot[i] || 0;
        if (d) p.setRotation(PDFLib.degrees((((p.getRotation().angle + d) % 360) + 360) % 360));
      });
      ctx.progress(0.9, "Saving…");
      return [pdfOut(await doc.save(), YP.baseName(files[0].name) + "-rotated.pdf")];
    }
  });

  /* ======================================================== watermark */
  YP.registerTool("add-watermark", {
    actionLabel: "Add watermark", preload: lib.pdfLib,
    options: () =>
      ui.seg("type", "Watermark type", [["text", "Text"], ["image", "Image / logo"]], "text") +
      `<div data-wt="text">${ui.input("text", "Text", "CONFIDENTIAL", 'maxlength="80"')}${ui.range("size", "Font size", 12, 140, 2, 56, "pt")}<div class="row">${ui.color("color", "Colour", "#D90368")}<div class="field" style="flex:1"></div></div></div>
       <div data-wt="image" hidden><div class="field"><label>Logo image</label><input class="input" type="file" name="img" accept="image/png,image/jpeg,image/webp"></div>${ui.range("scale", "Logo width (% of page)", 5, 100, 1, 35, "%")}</div>` +
      ui.range("opacity", "Opacity", 5, 100, 1, 25, "%") +
      ui.select("pos", "Position", [["center", "Centre"], ["tile", "Tiled (repeat)"], ["tl", "Top left"], ["tc", "Top centre"], ["tr", "Top right"], ["bl", "Bottom left"], ["bc", "Bottom centre"], ["br", "Bottom right"]], "center") +
      ui.select("angle", "Rotation", [["45", "45° diagonal"], ["0", "Horizontal"], ["-45", "−45°"], ["90", "Vertical"]], "45") +
      pagesField(),
    bind(ws, form) { const u = () => { const t = ui.read(form).type; $$("[data-wt]", form).forEach((d) => (d.hidden = d.dataset.wt !== t)); }; form.addEventListener("change", u); u(); },
    validate(f, o) {
      if (o.type === "text" && !o.text.trim()) return "Type the watermark text.";
      if (o.type === "image" && !(o.img && o.img[0])) return "Choose a logo image.";
    },
    async process(files, o, ctx) {
      const PDFLib = await lib.pdfLib();
      const outs = [];
      for (let fi = 0; fi < files.length; fi++) {
        ctx.progress(fi / files.length, `Watermarking ${files[fi].name}…`);
        const doc = await lib.openPdfLib(files[fi]);
        const font = await doc.embedFont(PDFLib.StandardFonts.HelveticaBold);
        let img = null, iw = 0, ih = 0;
        const text = (o.text || "").trim();
        if (o.type === "image") {
          const file = o.img[0];
          img = /png/i.test(file.type) ? await doc.embedPng(new Uint8Array(await file.arrayBuffer())) : await embedImage(PDFLib, doc, file);
        } else if (!canEncode(font, text)) {
          const t = await textPng(text, o.size * 3, o.color, true);
          img = await doc.embedPng(t.bytes); iw = t.w / 3; ih = t.h / 3;
        }
        const pages = doc.getPages();
        const idx = lib.parseRanges(o.pages, pages.length);
        for (const i of idx) {
          const page = pages[i], B = vbox(page);
          let w, hh;
          if (o.type === "image") { w = B.W * (o.scale / 100); hh = w * (img.height / img.width); }
          else if (img) { w = iw; hh = ih; }
          else { w = font.widthOfTextAtSize(text, o.size); hh = o.size * 0.72; }
          const th = (+o.angle * Math.PI) / 180, cos = Math.cos(th), sin = Math.sin(th);
          const pad = 28;
          const centers = [];
          if (o.pos === "tile") {
            const stepX = Math.abs(w * cos) + Math.abs(hh * sin) + 70, stepY = Math.abs(w * sin) + Math.abs(hh * cos) + 70;
            for (let y = stepY / 2, r = 0; y < B.H + stepY; y += stepY, r++) for (let x = (r % 2 ? stepX / 2 : 0); x < B.W + stepX; x += stepX) centers.push([x, y]);
          } else {
            const bw = Math.abs(w * cos) + Math.abs(hh * sin), bh = Math.abs(w * sin) + Math.abs(hh * cos);
            const X = { l: pad + bw / 2, c: B.W / 2, r: B.W - pad - bw / 2 }, Y = { t: B.H - pad - bh / 2, c: B.H / 2, b: pad + bh / 2 };
            const p = o.pos === "center" ? "cc" : o.pos;
            centers.push([X[p[1] === "c" ? "c" : p[1]], Y[p[0]]]);
          }
          for (const [cx, cy] of centers) {
            // origin so the (rotated) box is centred on (cx, cy) in visual space
            const ox = cx - (w / 2) * cos + (hh / 2) * sin, oy = cy - (w / 2) * sin - (hh / 2) * cos;
            const [ux, uy] = B.map(ox, oy);
            const rot = PDFLib.degrees(+o.angle + B.R);
            if (img) page.drawImage(img, { x: ux, y: uy, width: w, height: hh, rotate: rot, opacity: o.opacity / 100 });
            else page.drawText(text, { x: ux, y: uy, size: o.size, font, color: hexRgb(PDFLib, o.color), rotate: rot, opacity: o.opacity / 100 });
          }
        }
        outs.push(pdfOut(await doc.save(), YP.baseName(files[fi].name) + "-watermarked.pdf"));
        await ctx.tick();
      }
      return outs;
    }
  });

  /* ======================================================== page numbers */
  YP.registerTool("add-page-numbers", {
    actionLabel: "Add page numbers", preload: lib.pdfLib,
    options: () =>
      ui.select("pos", "Position", [["bc", "Bottom centre"], ["br", "Bottom right"], ["bl", "Bottom left"], ["tc", "Top centre"], ["tr", "Top right"], ["tl", "Top left"]], "bc") +
      ui.select("fmt", "Format", [["{n}", "1"], ["Page {n}", "Page 1"], ["Page {n} of {t}", "Page 1 of N"], ["{n} / {t}", "1 / N"], ["- {n} -", "- 1 -"]], "Page {n} of {t}") +
      `<div class="row">${ui.input("start", "Start at", "1", 'type="number" min="0"')}${ui.input("size", "Font size", "11", 'type="number" min="6" max="48"')}</div>` +
      `<div class="row">${ui.input("margin", "Margin (pt)", "28", 'type="number" min="4" max="120"')}${ui.color("color", "Colour", "#2E294E")}</div>` +
      ui.check("skip", "Skip first page (cover)", false) + pagesField(),
    async process(files, o, ctx) {
      const PDFLib = await lib.pdfLib();
      const outs = [];
      for (let fi = 0; fi < files.length; fi++) {
        ctx.progress(fi / files.length, `Numbering ${files[fi].name}…`);
        const doc = await lib.openPdfLib(files[fi]);
        const font = await doc.embedFont(PDFLib.StandardFonts.Helvetica);
        const pages = doc.getPages();
        let idx = lib.parseRanges(o.pages, pages.length);
        if (o.skip) idx = idx.filter((i) => i !== 0);
        const total = idx.length + (+o.start || 1) - 1;
        const size = +o.size || 11, m = +o.margin || 28, color = hexRgb(PDFLib, o.color);
        idx.forEach((i, k) => {
          const page = pages[i], B = vbox(page);
          const text = o.fmt.replace("{n}", k + (+o.start || 1)).replace("{t}", total);
          const tw = font.widthOfTextAtSize(text, size);
          const vx = o.pos[1] === "l" ? m : o.pos[1] === "r" ? B.W - m - tw : (B.W - tw) / 2;
          const vy = o.pos[0] === "b" ? m : B.H - m - size * 0.72;
          const [x, y] = B.map(vx, vy);
          page.drawText(text, { x, y, size, font, color, rotate: PDFLib.degrees(B.R) });
        });
        outs.push(pdfOut(await doc.save(), YP.baseName(files[fi].name) + "-numbered.pdf"));
        await ctx.tick();
      }
      return outs;
    }
  });

  YP.pdfHelpers = { embedImage, vbox, hexRgb, canEncode, textPng, pdfOut };
})();
