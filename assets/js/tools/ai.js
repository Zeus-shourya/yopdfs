/* ==========================================================================
   YoPdfs — AI tools that run on-device
     Background remover : @imgly/background-removal (ONNX model in the browser)
     Passport photo     : Cropper.js + optional background replacement
     OCR                : Tesseract.js (WebAssembly)
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP, lib = YP.lib, ui = YP.ui, { h, $, $$, icon, esc } = YP;
  const V = YP.root + "assets/vendor/";
  const IMGLY = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

  /* ---------------------------------------------------------- background removal */
  let bgMod = null;
  async function removeBg(blob, quality, onProgress) {
    if (!bgMod) {
      try { bgMod = await import(IMGLY); }
      catch (e) { throw new Error("Couldn't load the AI model. Check your internet connection — the model downloads once, then works from cache."); }
    }
    const fn = bgMod.removeBackground || (bgMod.default && bgMod.default.removeBackground) || bgMod.default;
    return fn(blob, {
      model: quality === "best" ? "isnet_fp16" : "isnet_quint8",
      output: { format: "image/png", quality: 1 },
      progress: (key, cur, total) => onProgress && onProgress(key, total ? cur / total : 0)
    });
  }
  async function composite(cutBlob, bg) {
    const img = await lib.loadImage(cutBlob);
    const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
    const x = c.getContext("2d");
    if (bg && bg !== "transparent") { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
    x.drawImage(img, 0, 0); URL.revokeObjectURL(img.src);
    return c;
  }
  const modelStep = (ctx, base, span) => (key, fr) => {
    if (/fetch|download/i.test(key)) ctx.progress(base + span * 0.6 * fr, `Downloading AI model (one-time)… ${Math.round(fr * 100)}%`);
    else ctx.progress(base + span * (0.6 + 0.4 * fr), "Removing background…");
  };

  const BGS = [["transparent", "Transparent"], ["#ffffff", "White"], ["#000000", "Black"], ["#9DACFF", "Periwinkle"], ["#F1E9DA", "Cream"], ["#FF2E97", "Neon pink"]];
  YP.registerTool("background-remover", {
    actionLabel: "Remove background",
    preload: () => import(IMGLY).then((m) => (bgMod = m)).catch(() => {}),
    options: () =>
      ui.seg("quality", "Model", [["fast", "Fast"], ["best", "Best quality"]], "fast", "First run downloads the AI model once (about 40–80 MB); it's cached afterwards.") +
      ui.note("Your photo is processed by an AI model running on your device. Nothing is uploaded."),
    async process(files, o, ctx) {
      const outs = [];
      for (let i = 0; i < files.length; i++) {
        ctx.check();
        const span = 1 / files.length;
        ctx.progress(i * span, `Preparing ${files[i].name}…`);
        // downscale huge photos first (keeps memory in check, model works at ~1024 px anyway)
        let input = files[i];
        const img = await lib.loadImage(files[i]);
        const max = 2600;
        if (Math.max(img.naturalWidth, img.naturalHeight) > max) {
          const s = max / Math.max(img.naturalWidth, img.naturalHeight);
          const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          input = await lib.toBlob(c, "image/png");
        }
        URL.revokeObjectURL(img.src);
        const cut = await removeBg(input, o.quality, modelStep(ctx, i * span, span));
        outs.push({ name: YP.baseName(files[i].name) + "-no-bg.png", blob: cut, cut, original: files[i] });
      }
      return { outputs: outs, zipName: "yopdfs-no-background.zip", title: "Background removed!" };
    },
    resultView(ws, wrap) {
      const first = ws.outputs[0];
      const box = h("div", { style: { margin: "0 auto 26px", maxWidth: "760px" } });
      box.innerHTML = `<div class="compare"><img alt="Original photo" data-before><div class="after"><img alt="Background removed" data-after></div><span class="tag" style="left:12px">Before</span><span class="tag" style="right:12px">After</span><div class="handle" role="slider" aria-label="Compare before and after" aria-valuemin="0" aria-valuemax="100" aria-valuenow="50" tabindex="0"></div></div>
        <div class="row" style="justify-content:center;margin-top:16px;gap:10px"><span class="label">Background:</span><div class="swatches">${BGS.map(([c, n], i) => `<button type="button" class="swatch${c === "transparent" ? " checker" : ""}" data-bg="${c}" aria-pressed="${i === 0}" title="${n}" aria-label="${n} background" style="${c === "transparent" ? "" : "background:" + c}"></button>`).join("")}<label class="swatch" title="Custom colour" style="display:grid;place-items:center;background:conic-gradient(red,yellow,lime,cyan,blue,magenta,red)"><input type="color" data-custom style="opacity:0;width:0;height:0;position:absolute"></label></div></div>`;
      const cmp = $(".compare", box);
      $("[data-before]", box).src = URL.createObjectURL(first.original);
      const after = $("[data-after]", box);
      after.src = URL.createObjectURL(first.cut);
      const setPos = (p) => { p = Math.max(0, Math.min(100, p)); $(".after", cmp).style.clipPath = `inset(0 0 0 ${p}%)`; $(".handle", cmp).style.left = p + "%"; $(".handle", cmp).setAttribute("aria-valuenow", Math.round(p)); };
      let dragging = false;
      const fromEv = (e) => { const r = cmp.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
      cmp.addEventListener("pointerdown", (e) => { dragging = true; cmp.setPointerCapture(e.pointerId); fromEv(e); });
      cmp.addEventListener("pointermove", (e) => dragging && fromEv(e));
      cmp.addEventListener("pointerup", () => (dragging = false));
      $(".handle", cmp).addEventListener("keydown", (e) => { const v = +$(".handle", cmp).getAttribute("aria-valuenow"); if (e.key === "ArrowLeft") setPos(v - 5); if (e.key === "ArrowRight") setPos(v + 5); });
      setPos(50);
      const apply = async (bg) => {
        for (const o of ws.outputs) {
          if (bg === "transparent") { o.blob = o.cut; o.name = o.name.replace(/\.jpg$/, ".png"); }
          else { const c = await composite(o.cut, bg); o.blob = await lib.toBlob(c, "image/jpeg", 0.95); o.name = o.name.replace(/\.png$/, ".jpg"); c.width = c.height = 0; }
        }
        after.src = URL.createObjectURL(ws.outputs[0].blob);
        const list = $(".result-list", wrap);
        if (list) { list.replaceChildren(...ws.outputs.map((o) => ws.resultCard(o))); }
        const dlBtn = $(".result-actions .btn-primary", wrap);
        if (dlBtn && ws.outputs.length === 1) dlBtn.innerHTML = icon("download") + " Download " + YP.ext(ws.outputs[0].name).toUpperCase();
      };
      $$("[data-bg]", box).forEach((b) => (b.onclick = () => { $$(".swatch", box).forEach((x) => x.setAttribute("aria-pressed", x === b)); apply(b.dataset.bg); }));
      $("[data-custom]", box).addEventListener("input", (e) => { $$(".swatch", box).forEach((x) => x.setAttribute("aria-pressed", "false")); apply(e.target.value); });
      wrap.insertBefore(box, $(".result-actions", wrap).nextSibling);
    }
  });

  /* ---------------------------------------------------------- passport photo */
  const SIZES = [
    ["in-pass", "India — Passport (35 × 45 mm)", 35, 45],
    ["in-visa", "India — Visa / OCI (2 × 2 in)", 50.8, 50.8],
    ["in-stamp", "India — Stamp size (20 × 25 mm)", 20, 25],
    ["us", "USA — Passport & Visa (2 × 2 in)", 50.8, 50.8],
    ["uk", "UK — Passport (35 × 45 mm)", 35, 45],
    ["eu", "Schengen / EU (35 × 45 mm)", 35, 45],
    ["ca", "Canada — Passport (50 × 70 mm)", 50, 70],
    ["au", "Australia — Passport (35 × 45 mm)", 35, 45],
    ["cn", "China — Visa (33 × 48 mm)", 33, 48],
    ["custom", "Custom size…", 35, 45]
  ];
  const PBG = [["#ffffff", "White"], ["#EAF2FF", "Light blue"], ["#DCE6F5", "Blue-grey"], ["#F0F0F0", "Light grey"]];
  const mmPx = (mm) => Math.round((mm / 25.4) * 300);

  YP.registerTool("passport-photo-maker", {
    actionLabel: "Create passport photos", optionsTitle: "Photo settings",
    preload: () => YP.loadScript(V + "cropper.min.js"),
    mainView(ws, main) {
      YP.loadCSS("assets/vendor/cropper.min.css");
      main.innerHTML = `<div class="ws-files-head"><h3>Position your face in the oval</h3><div class="row" style="gap:6px">
        <button class="icon-btn" type="button" data-act="rl" aria-label="Rotate left">${icon("rotl")}</button><button class="icon-btn" type="button" data-act="rr" aria-label="Rotate right">${icon("rotr")}</button>
        <button class="icon-btn" type="button" data-act="zi" aria-label="Zoom in">${icon("zoomin")}</button><button class="icon-btn" type="button" data-act="zo" aria-label="Zoom out">${icon("zoomout")}</button>
        <button class="btn btn-sm btn-soft" type="button" data-act="change">${icon("refresh")} Change photo</button></div></div>
        <div class="crop-stage"><img alt="Your photo"></div>
        <p class="hint" style="margin-top:10px">Tip: head straight, neutral expression, even lighting. Top of head near the upper line, chin near the lower line.</p>`;
      const img = $("img", main);
      img.src = URL.createObjectURL(ws.files[0].file);
      YP.loadScript(V + "cropper.min.js").then(() => {
        if (ws.cropper) ws.cropper.destroy();
        const s = SIZES[0];
        ws.cropper = new window.Cropper(img, {
          viewMode: 1, aspectRatio: s[2] / s[3], autoCropArea: 0.6, background: false, dragMode: "move", cropBoxResizable: true,
          ready() {
            const box = main.querySelector(".cropper-crop-box");
            if (box && !box.querySelector(".pp-guide")) box.insertAdjacentHTML("beforeend", `<svg class="pp-guide" viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none"><ellipse cx="50" cy="46" rx="25" ry="31" fill="none" stroke="#FF2E97" stroke-width=".7" stroke-dasharray="2 1.5" vector-effect="non-scaling-stroke"/><line x1="10" x2="90" y1="12" y2="12" stroke="#9DACFF" stroke-width="1" vector-effect="non-scaling-stroke"/><line x1="10" x2="90" y1="80" y2="80" stroke="#9DACFF" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>`);
          }
        });
      });
      main.addEventListener("click", (e) => {
        const b = e.target.closest("[data-act]"); if (!b) return;
        if (b.dataset.act === "change") return ws.input.click();
        const c = ws.cropper; if (!c) return;
        ({ rl: () => c.rotate(-90), rr: () => c.rotate(90), zi: () => c.zoom(0.08), zo: () => c.zoom(-0.08) })[b.dataset.act]();
      });
    },
    options: () =>
      ui.select("size", "Country / document", SIZES.map((s) => [s[0], s[1]]), "in-pass") +
      `<div data-custom hidden class="row">${ui.input("cw", "Width (mm)", "35", 'type="number" min="10" max="150"')}${ui.input("ch", "Height (mm)", "45", 'type="number" min="10" max="150"')}</div>` +
      ui.group("Background colour", `<div class="swatches">${PBG.map(([c, n], i) => `<button type="button" class="swatch" data-pbg="${c}" aria-pressed="${i === 0}" title="${n}" aria-label="${n}" style="background:${c}"></button>`).join("")}</div><input type="hidden" name="bg" value="#ffffff">`) +
      ui.check("ai", "Replace background with AI (recommended)", true) +
      ui.seg("sheet", "Print sheet", [["4x6", "4 × 6 in"], ["a4", "A4"], ["none", "None"]], "4x6") +
      ui.check("lines", "Draw cut lines on the sheet", true),
    bind(ws, form) {
      const sync = () => {
        const v = form.size.value, custom = v === "custom";
        $("[data-custom]", form).hidden = !custom;
        const s = SIZES.find((x) => x[0] === v);
        const w = custom ? +form.cw.value || 35 : s[2], hh = custom ? +form.ch.value || 45 : s[3];
        ws.cropper && ws.cropper.setAspectRatio(w / hh);
      };
      form.size.addEventListener("change", sync); form.cw.addEventListener("input", sync); form.ch.addEventListener("input", sync);
      $$("[data-pbg]", form).forEach((b) => (b.onclick = () => { $$("[data-pbg]", form).forEach((x) => x.setAttribute("aria-pressed", x === b)); form.bg.value = b.dataset.pbg; }));
    },
    async process(files, o, ctx) {
      const c = ctx.ws.cropper;
      if (!c) throw new Error("The photo editor is still loading — try again in a second.");
      const s = SIZES.find((x) => x[0] === o.size);
      const wmm = o.size === "custom" ? +o.cw : s[2], hmm = o.size === "custom" ? +o.ch : s[3];
      const W = mmPx(wmm), H = mmPx(hmm);
      ctx.progress(0.05, "Cropping…");
      let photo = c.getCroppedCanvas({ width: W, height: H, imageSmoothingQuality: "high", fillColor: o.bg });
      if (o.ai) {
        const cut = await removeBg(await lib.toBlob(photo, "image/png"), "fast", modelStep(ctx, 0.1, 0.7));
        photo = await composite(cut, o.bg);
      } else {
        const f = document.createElement("canvas"); f.width = W; f.height = H;
        const x = f.getContext("2d"); x.fillStyle = o.bg; x.fillRect(0, 0, W, H); x.drawImage(photo, 0, 0); photo = f;
      }
      ctx.progress(0.85, "Laying out print sheet…");
      const label = `${wmm}x${hmm}mm`.replace(/\.8/g, ".8");
      const outs = [{ name: `passport-photo-${label}.jpg`, blob: await lib.toBlob(photo, "image/jpeg", 0.95) }];
      if (o.sheet !== "none") {
        const [SW, SH] = o.sheet === "a4" ? [2480, 3508] : [1200, 1800];
        const sheet = document.createElement("canvas"); sheet.width = SW; sheet.height = SH;
        const x = sheet.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, SW, SH);
        const gap = 24, margin = 40;
        const cols = Math.max(1, Math.floor((SW - margin * 2 + gap) / (W + gap))), rows = Math.max(1, Math.floor((SH - margin * 2 + gap) / (H + gap)));
        const ox = (SW - (cols * W + (cols - 1) * gap)) / 2, oy = (SH - (rows * H + (rows - 1) * gap)) / 2;
        for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
          const px = ox + k * (W + gap), py = oy + r * (H + gap);
          x.drawImage(photo, px, py);
          if (o.lines) { x.strokeStyle = "#B8B4C8"; x.lineWidth = 1; x.setLineDash([8, 6]); x.strokeRect(px - 0.5, py - 0.5, W + 1, H + 1); }
        }
        x.setLineDash([]); x.fillStyle = "#9A96AE"; x.font = "22px Arial";
        x.fillText(`${rows * cols} × ${s ? s[1].replace(/ \(.*/, "") : "Custom"} ${wmm} × ${hmm} mm · print at 100% · YoPdfs`, margin, SH - 14);
        const sheetBlob = await lib.toBlob(sheet, "image/jpeg", 0.95);
        outs.push({ name: `passport-sheet-${o.sheet}-${rows * cols}-copies.jpg`, blob: sheetBlob });
        // PDF version of the sheet at exact physical size
        const PDFLib = await lib.pdfLib();
        const pdf = await PDFLib.PDFDocument.create();
        const ptW = (SW / 300) * 72, ptH = (SH / 300) * 72;
        const jpg = await pdf.embedJpg(new Uint8Array(await sheetBlob.arrayBuffer()));
        pdf.addPage([ptW, ptH]).drawImage(jpg, { x: 0, y: 0, width: ptW, height: ptH });
        outs.push({ name: `passport-sheet-${o.sheet}.pdf`, blob: lib.pdfBlob(await pdf.save()) });
      }
      return { outputs: outs, title: "Your passport photos are ready!", summary: `${wmm} × ${hmm} mm at 300 DPI (${W} × ${H} px)${o.sheet !== "none" ? " · print the sheet at 100% / actual size" : ""}` };
    }
  });

  /* ---------------------------------------------------------- OCR */
  const LANGS = [["eng", "English"], ["hin", "Hindi"], ["mar", "Marathi"], ["ben", "Bengali"], ["tam", "Tamil"], ["tel", "Telugu"], ["guj", "Gujarati"], ["pan", "Punjabi"], ["urd", "Urdu"], ["kan", "Kannada"], ["mal", "Malayalam"],
    ["spa", "Spanish"], ["fra", "French"], ["deu", "German"], ["por", "Portuguese"], ["ita", "Italian"], ["rus", "Russian"], ["ara", "Arabic"], ["chi_sim", "Chinese (Simplified)"], ["jpn", "Japanese"], ["kor", "Korean"]];
  YP.registerTool("ocr-image-to-text", {
    actionLabel: "Extract text", sortable: true,
    preload: () => YP.loadScript(V + "tesseract/tesseract.min.js"),
    options: () =>
      ui.select("lang", "Document language", LANGS, "eng") +
      ui.select("lang2", "Second language (optional)", [["", "None"]].concat(LANGS), "") +
      ui.input("pages", "PDF pages", "", 'placeholder="All pages — or e.g. 1-3"') +
      ui.note("Language data downloads once per language and is cached by your browser."),
    async process(files, o, ctx) {
      await YP.loadScript(V + "tesseract/tesseract.min.js");
      const langs = [o.lang, o.lang2].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join("+");
      let phase = "Loading OCR engine…", base = 0, span = 0.1;
      ctx.progress(0.02, phase);
      const worker = await window.Tesseract.createWorker(langs, 1, {
        workerPath: new URL(V + "tesseract/worker.min.js", location.href).href,
        logger: (m) => {
          if (m.status === "recognizing text") ctx.progress(base + span * m.progress, phase);
          else if (/loading|initializ/i.test(m.status)) ctx.progress(Math.min(0.09, 0.02 + (m.progress || 0) * 0.07), m.status.replace(/^./, (c) => c.toUpperCase()) + "…");
        }
      });
      try {
        // collect jobs (images and PDF pages)
        const jobs = [];
        for (const f of files) {
          if (lib.isPdf(f)) {
            let doc;
            try { doc = await lib.openPdfjs(f); } catch (e) { throw new Error(e.name === "PasswordException" ? `“${f.name}” is password-protected. Unlock it first.` : e.message); }
            lib.parseRanges(o.pages, doc.numPages).forEach((i) => jobs.push({ f, doc, page: i + 1, label: `${f.name} — page ${i + 1}` }));
          } else jobs.push({ f, label: f.name });
        }
        const parts = [];
        let confSum = 0;
        for (let j = 0; j < jobs.length; j++) {
          ctx.check();
          const job = jobs[j];
          base = 0.1 + 0.88 * (j / jobs.length); span = 0.88 / jobs.length;
          phase = `Reading text · ${job.label} (${j + 1}/${jobs.length})`;
          ctx.progress(base, phase);
          let src = job.f;
          if (job.doc) src = await lib.renderPage(await job.doc.getPage(job.page), 2.4);
          const { data } = await worker.recognize(src);
          confSum += data.confidence || 0;
          parts.push({ label: job.label, text: (data.text || "").trim() });
          if (src.getContext) src.width = src.height = 0;
        }
        const text = parts.map((p) => (parts.length > 1 ? `===== ${p.label} =====\n` : "") + p.text).join("\n\n");
        if (!text.replace(/=+.*=+/g, "").trim()) throw new Error("No text was found. Try a sharper image, or pick the right language.");
        const words = text.split(/\s+/).filter(Boolean).length;
        return {
          outputs: [{ name: YP.baseName(files[0].name) + "-text.txt", blob: new Blob([text], { type: "text/plain;charset=utf-8" }) }],
          title: "Text extracted!", summary: `${words.toLocaleString()} words · average confidence ${Math.round(confSum / jobs.length)}%`, text, hideList: true
        };
      } finally { worker.terminate(); }
    },
    resultView(ws, wrap, res) {
      const box = h("div", { class: "card", style: { maxWidth: "900px", margin: "0 auto" } });
      box.innerHTML = `<div class="row" style="justify-content:space-between;margin-bottom:10px"><h3 style="margin:0">Extracted text</h3><button class="btn btn-sm btn-soft" type="button" data-copy>${icon("copy")} Copy all</button></div><textarea class="input text-out" spellcheck="false" aria-label="Extracted text"></textarea>`;
      $("textarea", box).value = res.text;
      $("[data-copy]", box).onclick = async () => { try { await navigator.clipboard.writeText($("textarea", box).value); YP.toast("Copied to clipboard.", "ok"); } catch (e) { $("textarea", box).select(); document.execCommand("copy"); YP.toast("Copied.", "ok"); } };
      wrap.appendChild(box);
    }
  });
})();
