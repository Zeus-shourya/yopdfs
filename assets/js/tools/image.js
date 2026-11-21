/* ==========================================================================
   YoPdfs — image tools (Canvas API, all in-browser)
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP, lib = YP.lib, ui = YP.ui, { h, $, $$, icon, esc } = YP;
  const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

  function srcFormat(f) {
    const e = YP.ext(f.name);
    if (/jpe?g/.test(e) || f.type === "image/jpeg") return "jpg";
    if (e === "webp" || f.type === "image/webp") return "webp";
    return "png";
  }
  function hasAlpha(c) {
    const x = c.getContext("2d"), { width: w, height: hh } = c;
    const d = x.getImageData(0, 0, w, hh).data;
    const step = Math.max(4, Math.floor((w * hh) / 250000) * 4);
    for (let i = 3; i < d.length; i += step) if (d[i] < 250) return true;
    return false;
  }
  /* high quality downscale: halve repeatedly, then final pass */
  function scaleCanvas(src, w, hh, bg) {
    let cur = src;
    while (cur.width / 2 > w && cur.height / 2 > hh) {
      const t = document.createElement("canvas");
      t.width = Math.round(cur.width / 2); t.height = Math.round(cur.height / 2);
      const x = t.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, t.width, t.height);
      if (cur !== src) cur.width = cur.height = 0;
      cur = t;
    }
    const out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(w)); out.height = Math.max(1, Math.round(hh));
    const x = out.getContext("2d");
    if (bg) { x.fillStyle = bg; x.fillRect(0, 0, out.width, out.height); }
    x.imageSmoothingQuality = "high"; x.drawImage(cur, 0, 0, out.width, out.height);
    if (cur !== src) cur.width = cur.height = 0;
    return out;
  }
  function flatten(c, bg) {
    const o = document.createElement("canvas"); o.width = c.width; o.height = c.height;
    const x = o.getContext("2d"); x.fillStyle = bg || "#fff"; x.fillRect(0, 0, o.width, o.height); x.drawImage(c, 0, 0);
    return o;
  }
  async function encode(c, fmt, q) {
    if (fmt === "jpg") c = flatten(c, "#fff");
    const blob = await lib.toBlob(c, MIME[fmt], q);
    if (fmt === "webp" && blob.type !== "image/webp") return { blob: await lib.toBlob(c, "image/png"), ext: "png" }; // very old Safari
    return { blob, ext: fmt };
  }
  const fmtSeg = (withKeep = true, val = "keep") => ui.seg("fmt", "Output format", (withKeep ? [["keep", "Same"]] : []).concat([["jpg", "JPG"], ["png", "PNG"], ["webp", "WebP"]]), val);

  /* ======================================================== compressor */
  YP.registerTool("image-compressor", {
    actionLabel: "Compress images",
    options: () =>
      ui.range("q", "Quality", 10, 100, 1, 75, "%") +
      ui.seg("fmt", "Output format", [["auto", "Best"], ["jpg", "JPG"], ["webp", "WebP"], ["keep", "Same"]], "auto",
        "“Best” keeps transparency (WebP) and uses JPG for photos.") +
      ui.input("maxw", "Max width (px, optional)", "", 'type="number" min="16" placeholder="Keep original size"'),
    async process(files, o, ctx) {
      const outs = [];
      for (let i = 0; i < files.length; i++) {
        ctx.check();
        const f = files[i];
        ctx.progress(i / files.length, `Compressing ${f.name}…`);
        let c = await lib.imageCanvas(f);
        if (o.maxw && c.width > o.maxw) c = scaleCanvas(c, o.maxw, (c.height * o.maxw) / c.width);
        const src = srcFormat(f);
        let fmt = o.fmt;
        if (fmt === "auto") fmt = src === "jpg" ? "jpg" : hasAlpha(c) ? "webp" : "jpg";
        if (fmt === "keep") fmt = src;
        const r = await encode(c, fmt, o.q / 100);
        c.width = c.height = 0;
        const keep = r.blob.size >= f.size && fmt === src && !o.maxw;
        outs.push({ name: `${YP.baseName(f.name)}-compressed.${keep ? YP.ext(f.name) : r.ext}`, blob: keep ? f : r.blob, before: f.size });
        await ctx.tick();
      }
      const a = files.reduce((s, f) => s + f.size, 0), b = outs.reduce((s, o) => s + o.blob.size, 0);
      const pct = Math.round((1 - b / a) * 100);
      return { outputs: outs, zipName: "yopdfs-compressed-images.zip", title: pct > 0 ? `Saved ${pct}%!` : "Already optimised", summary: `${YP.bytes(a)} → <b>${YP.bytes(b)}</b>` };
    }
  });

  /* ======================================================== resizer */
  YP.registerTool("image-resizer", {
    actionLabel: "Resize images",
    async onFiles(ws) {
      const img = await lib.loadImage(ws.files[0].file);
      ws.dim = [img.naturalWidth, img.naturalHeight];
      URL.revokeObjectURL(img.src);
    },
    options: (ws) =>
      ui.seg("mode", "Resize by", [["px", "Pixels"], ["pct", "Percentage"]], "px") +
      `<div data-rm="px"><div class="row">${ui.input("w", "Width", ws.dim[0], 'type="number" min="1"')}${ui.input("h", "Height", ws.dim[1], 'type="number" min="1"')}</div>
        ${ui.check("lock", "Keep aspect ratio", true)}<p class="hint">Original: ${ws.dim[0]} × ${ws.dim[1]} px${ws.files.length > 1 ? " (first image). With aspect locked, every image is scaled to this width." : ""}</p></div>
       <div data-rm="pct" hidden>${ui.range("pct", "Scale", 5, 200, 1, 50, "%")}</div>` +
      fmtSeg() + ui.range("q", "Quality (JPG / WebP)", 40, 100, 1, 90, "%"),
    bind(ws, form) {
      const W = form.w, H = form.h, ar = ws.dim[1] / ws.dim[0];
      W.addEventListener("input", () => { if (form.lock.checked && W.value) H.value = Math.round(W.value * ar); });
      H.addEventListener("input", () => { if (form.lock.checked && H.value) W.value = Math.round(H.value / ar); });
      const u = () => { const m = ui.read(form).mode; $$("[data-rm]", form).forEach((d) => (d.hidden = d.dataset.rm !== m)); };
      form.addEventListener("change", u); u();
    },
    validate: (f, o) => (o.mode === "px" && (!(o.w > 0) || !(o.h > 0)) ? "Enter a width and height." : o.w > 16000 || o.h > 16000 ? "Maximum size is 16,000 px." : null),
    async process(files, o, ctx) {
      const outs = [];
      for (let i = 0; i < files.length; i++) {
        ctx.check();
        const f = files[i];
        ctx.progress(i / files.length, `Resizing ${f.name}…`);
        const c = await lib.imageCanvas(f);
        let w, hh;
        if (o.mode === "pct") { w = c.width * o.pct / 100; hh = c.height * o.pct / 100; }
        else if (o.lock) { w = +o.w; hh = c.height * (w / c.width); }
        else { w = +o.w; hh = +o.h; }
        const fmt = o.fmt === "keep" ? srcFormat(f) : o.fmt;
        const out = scaleCanvas(c, w, hh);
        const r = await encode(out, fmt, o.q / 100);
        outs.push({ name: `${YP.baseName(f.name)}-${out.width}x${out.height}.${r.ext}`, blob: r.blob });
        c.width = c.height = out.width = out.height = 0;
        await ctx.tick();
      }
      return { outputs: outs, zipName: "yopdfs-resized-images.zip" };
    }
  });

  /* ======================================================== cropper */
  const RATIOS = [["free", "Free"], ["1", "1:1"], ["0.8", "4:5"], ["1.7778", "16:9"], ["0.5625", "9:16"], ["1.3333", "4:3"], ["1.5", "3:2"], ["0.7071", "A4"]];
  YP.registerTool("image-cropper", {
    actionLabel: "Crop image",
    preload: () => YP.loadScript(YP.root + "assets/vendor/cropper.min.js"),
    mainView(ws, main) {
      YP.loadCSS("assets/vendor/cropper.min.css");
      const f = ws.files[0];
      main.innerHTML = `<div class="ws-files-head"><h3>${esc(f.name)} <span class="muted" data-size style="font-weight:500;font-size:.85rem"></span></h3>
        <div class="row" style="gap:6px">
          <button class="icon-btn" type="button" data-act="rl" aria-label="Rotate left">${icon("rotl")}</button>
          <button class="icon-btn" type="button" data-act="rr" aria-label="Rotate right">${icon("rotr")}</button>
          <button class="icon-btn" type="button" data-act="fh" aria-label="Flip horizontally">${icon("flip")}</button>
          <button class="icon-btn" type="button" data-act="zi" aria-label="Zoom in">${icon("zoomin")}</button>
          <button class="icon-btn" type="button" data-act="zo" aria-label="Zoom out">${icon("zoomout")}</button>
          <button class="btn btn-sm btn-ghost" type="button" data-act="reset">Reset</button>
          <button class="btn btn-sm btn-soft" type="button" data-act="change">${icon("refresh")} Change</button></div></div>
        <div class="crop-stage"><img alt="Image to crop" style="max-width:100%"></div>`;
      const img = $("img", main);
      img.src = URL.createObjectURL(f.file);
      YP.loadScript(YP.root + "assets/vendor/cropper.min.js").then(() => {
        if (ws.cropper) ws.cropper.destroy();
        ws.cropper = new window.Cropper(img, {
          viewMode: 1, autoCropArea: 0.9, background: false, responsive: true,
          crop(e) { const s = $("[data-size]", main); if (s) s.textContent = `· crop ${Math.round(e.detail.width)} × ${Math.round(e.detail.height)} px`; }
        });
      });
      let sx = 1;
      main.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]"); if (!b || !ws.cropper) return;
        const c = ws.cropper;
        ({ rl: () => c.rotate(-90), rr: () => c.rotate(90), fh: () => c.scaleX((sx = -sx)), zi: () => c.zoom(0.1), zo: () => c.zoom(-0.1), reset: () => { sx = 1; c.reset(); }, change: () => ws.input.click() })[b.dataset.act]();
      });
    },
    options: () => ui.group("Aspect ratio", `<div class="seg" data-ratios>${RATIOS.map(([v, l], i) => `<button type="button" data-r="${v}" aria-pressed="${i === 0}">${l}</button>`).join("")}</div>`) + fmtSeg(true) + ui.range("q", "Quality (JPG / WebP)", 40, 100, 1, 92, "%"),
    bind(ws, form) {
      $$("[data-r]", form).forEach((b) => b.addEventListener("click", () => {
        $$("[data-r]", form).forEach((x) => x.setAttribute("aria-pressed", x === b));
        ws.cropper && ws.cropper.setAspectRatio(b.dataset.r === "free" ? NaN : +b.dataset.r);
      }));
    },
    async process(files, o, ctx) {
      const c = ctx.ws.cropper;
      if (!c) throw new Error("The cropper is still loading — try again in a second.");
      const fmt = o.fmt === "keep" ? srcFormat(files[0]) : o.fmt;
      const cv = c.getCroppedCanvas({ imageSmoothingQuality: "high", maxWidth: 16000, maxHeight: 16000 });
      const r = await encode(cv, fmt, o.q / 100);
      return [{ name: `${YP.baseName(files[0].name)}-cropped.${r.ext}`, blob: r.blob }];
    }
  });

  /* ======================================================== format converters */
  YP.registerTool("jpg-to-png", {
    actionLabel: "Convert to PNG",
    async process(files, o, ctx) {
      const outs = [];
      for (let i = 0; i < files.length; i++) {
        ctx.check(); ctx.progress(i / files.length, `Converting ${files[i].name}…`);
        const c = await lib.imageCanvas(files[i]);
        outs.push({ name: YP.baseName(files[i].name) + ".png", blob: await lib.toBlob(c, "image/png") });
        c.width = c.height = 0; await ctx.tick();
      }
      return { outputs: outs, zipName: "yopdfs-png.zip" };
    }
  });
  YP.registerTool("png-to-jpg", {
    actionLabel: "Convert to JPG",
    options: () => ui.range("q", "JPG quality", 40, 100, 1, 90, "%") + ui.color("bg", "Background for transparent areas", "#ffffff"),
    async process(files, o, ctx) {
      const outs = [];
      for (let i = 0; i < files.length; i++) {
        ctx.check(); ctx.progress(i / files.length, `Converting ${files[i].name}…`);
        const c = await lib.imageCanvas(files[i], o.bg);
        outs.push({ name: YP.baseName(files[i].name) + ".jpg", blob: await lib.toBlob(c, "image/jpeg", o.q / 100), before: files[i].size });
        c.width = c.height = 0; await ctx.tick();
      }
      return { outputs: outs, zipName: "yopdfs-jpg.zip" };
    }
  });

  YP.imageHelpers = { scaleCanvas, flatten, encode, hasAlpha };
})();
