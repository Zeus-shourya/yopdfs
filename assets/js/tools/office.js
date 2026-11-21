/* ==========================================================================
   YoPdfs — Office conversions (all in-browser)
     Word → PDF  : docx-preview renders the document, html2canvas + jsPDF paginate
     PDF → Word  : PDF.js text layout → paragraphs → .docx (built with JSZip)
     Excel → PDF : SheetJS reads the workbook, jsPDF-AutoTable draws real text tables
     PDF → Excel : PDF.js text positions → rows/columns → .xlsx via SheetJS
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP, lib = YP.lib, ui = YP.ui, { h, $, esc } = YP;
  const V = YP.root + "assets/vendor/";
  const load = (...s) => Promise.all(s.map((x) => YP.loadScript(V + x)));

  /* ======================================================== Word → PDF */
  YP.registerTool("word-to-pdf", {
    actionLabel: "Convert to PDF",
    preload: () => load("jszip.min.js").then(() => load("docx-preview.min.js", "html2canvas.min.js", "jspdf.umd.min.js")),
    options: () =>
      ui.seg("q", "Output quality", [["1.5", "Standard"], ["2", "High"], ["3", "Print"]], "2", "Higher quality gives sharper text and bigger files.") +
      ui.note("Works with .docx files. Pages are rendered exactly as laid out; text in the PDF is not selectable."),
    async process(files, o, ctx) {
      await load("jszip.min.js"); await load("docx-preview.min.js", "html2canvas.min.js", "jspdf.umd.min.js");
      const { jsPDF } = window.jspdf;
      const outs = [];
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi];
        const sub = (fr, t) => ctx.progress((fi + fr) / files.length, (files.length > 1 ? `File ${fi + 1}/${files.length} · ` : "") + t);
        sub(0.05, "Reading document…");
        const host = h("div", { style: { position: "fixed", left: "-10000px", top: "0", width: "1000px", background: "#fff", color: "#000" } });
        document.body.appendChild(host);
        try {
          await window.docx.renderAsync(await lib.buffer(f), host, null, {
            className: "docx", inWrapper: false, ignoreWidth: false, ignoreHeight: false, breakPages: true,
            ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true, renderFootnotes: true, useBase64URL: true
          });
        } catch (e) {
          host.remove();
          throw new Error(`Couldn't read “${f.name}”. Make sure it's a .docx file (not .doc), then try again.`);
        }
        await document.fonts.ready;
        await YP.sleep(60);
        const sections = Array.from(host.querySelectorAll("section.docx"));
        if (!sections.length) { host.remove(); throw new Error("This document appears to be empty."); }
        let pdf = null;
        for (let s = 0; s < sections.length; s++) {
          ctx.check();
          sub(0.1 + 0.85 * (s / sections.length), `Rendering page ${s + 1} of ${sections.length}…`);
          const sec = sections[s];
          const pageWpx = sec.offsetWidth;
          const pageHpx = parseFloat(sec.style.minHeight) || parseFloat(getComputedStyle(sec).minHeight) || pageWpx * 1.414;
          const canvas = await window.html2canvas(sec, { scale: +o.q, backgroundColor: "#ffffff", useCORS: true, logging: false });
          // px (96dpi) → pt
          const wPt = pageWpx * 0.75, hPt = pageHpx * 0.75;
          if (!pdf) pdf = new jsPDF({ unit: "pt", format: [wPt, hPt], orientation: wPt > hPt ? "l" : "p", compress: true });
          // a section can overflow its page height: paginate it, cutting on blank rows and keeping page margins
          const S = +o.q, cs = getComputedStyle(sec);
          const pageHc = Math.round(pageHpx * S), padT = (parseFloat(cs.paddingTop) || 0) * S, padB = (parseFloat(cs.paddingBottom) || 0) * S;
          let y = 0, k = 0;
          while (y < canvas.height - 2) {
            const fitsAll = k === 0 && canvas.height <= pageHc + 2;
            const avail = k === 0 ? pageHc - padB : pageHc - padT - padB;
            let end = fitsAll ? canvas.height : Math.min(canvas.height, y + avail);
            if (!fitsAll && end < canvas.height) end = blankRow(canvas, end, y + avail * 0.7);
            const part = document.createElement("canvas");
            part.width = canvas.width; part.height = pageHc;
            const px = part.getContext("2d"); px.fillStyle = "#fff"; px.fillRect(0, 0, part.width, part.height);
            const dy = k === 0 ? 0 : padT;
            px.drawImage(canvas, 0, y, canvas.width, end - y, 0, dy, canvas.width, end - y);
            if (s > 0 || k > 0) pdf.addPage([wPt, hPt], wPt > hPt ? "l" : "p");
            pdf.addImage(part.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, wPt, hPt, undefined, "FAST");
            part.width = part.height = 0;
            y = end; k++;
            if (k > 200) break;
          }
          canvas.width = canvas.height = 0;
          await ctx.tick();
        }
        host.remove();
        pdf.setProperties({ title: YP.baseName(f.name), creator: "YoPdfs" });
        outs.push({ name: YP.baseName(f.name) + ".pdf", blob: pdf.output("blob") });
      }
      return outs;
    }
  });

  /* find the nearest fully blank (white) pixel row at or above `y`, not above `minY` */
  function blankRow(canvas, y, minY) {
    const x = canvas.getContext("2d", { willReadFrequently: true });
    const w = canvas.width, from = Math.floor(y), to = Math.max(0, Math.floor(minY));
    const data = x.getImageData(0, to, w, from - to + 1).data;
    for (let r = from - to; r >= 0; r--) {
      let blank = true;
      for (let c = 0; c < w; c += 3) {
        const i = (r * w + c) * 4;
        if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) { blank = false; break; }
      }
      if (blank) return to + r;
    }
    return from;
  }

  /* ======================================================== PDF → Word */
  async function pageLines(page) {
    const tc = await page.getTextContent({ normalizeWhitespace: true });
    const vp = page.getViewport({ scale: 1 });
    const items = tc.items.filter((it) => it.str && it.str.trim() !== "" || it.hasEOL).map((it) => {
      const [a, b, , d, e, f] = it.transform;
      const size = Math.hypot(a, b) || Math.abs(d) || 10;
      const style = tc.styles[it.fontName] || {};
      const fam = (style.fontFamily || "") + " " + it.fontName;
      return { str: it.str, x: e, y: vp.height - f, w: it.width, size, bold: /bold|black|heavy|semibold/i.test(fam), italic: /italic|oblique/i.test(fam), eol: it.hasEOL };
    }).filter((it) => it.str.trim() !== "");
    items.sort((p, q) => (Math.abs(p.y - q.y) < Math.min(p.size, q.size) * 0.5 ? p.x - q.x : p.y - q.y));
    const lines = [];
    for (const it of items) {
      const L = lines[lines.length - 1];
      if (L && Math.abs(L.y - it.y) < Math.min(L.size, it.size) * 0.5) {
        const last = L.items[L.items.length - 1];
        const gap = it.x - (last.x + last.w);
        if (gap > it.size * 0.15 && !/\s$/.test(last.str) && !/^\s/.test(it.str)) it.str = " " + it.str;
        L.items.push(it); L.size = Math.max(L.size, it.size); L.x1 = it.x + it.w;
      } else lines.push({ y: it.y, x: it.x, x1: it.x + it.w, size: it.size, items: [it] });
    }
    return { lines, width: vp.width, height: vp.height };
  }
  function paragraphs(lines, pageW) {
    const paras = [];
    let cur = null;
    lines.forEach((L, i) => {
      const prev = lines[i - 1];
      const gap = prev ? L.y - prev.y : 0;
      const newPara = !cur || gap > prev.size * 1.75 || Math.abs(L.size - prev.size) > 1.2 || (prev.x1 < pageW * 0.6 && gap > 0) || L.x > prev.x + L.size * 2.5;
      if (newPara) { cur = { size: L.size, x: L.x, runs: [], center: false }; paras.push(cur); }
      else cur.runs.push({ str: " " });
      L.items.forEach((it) => cur.runs.push(it));
      const mid = (L.x + L.x1) / 2;
      cur.center = Math.abs(mid - pageW / 2) < pageW * 0.06 && L.x > pageW * 0.18;
    });
    return paras;
  }
  const X = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
  function runXml(r, baseSize) {
    if (!r.size) return `<w:r><w:t xml:space="preserve">${X(r.str)}</w:t></w:r>`;
    const hp = Math.max(12, Math.min(144, Math.round(r.size * 2)));
    return `<w:r><w:rPr>${r.bold ? "<w:b/>" : ""}${r.italic ? "<w:i/>" : ""}<w:sz w:val="${hp}"/><w:szCs w:val="${hp}"/></w:rPr><w:t xml:space="preserve">${X(r.str)}</w:t></w:r>`;
  }
  async function buildDocx(pagesData, opts) {
    const JSZip = await lib.jszip();
    const z = new JSZip();
    const media = [];
    let body = "";
    pagesData.forEach((pg, pi) => {
      const sizes = pg.paras.map((p) => p.size).sort((a, b) => a - b);
      const median = sizes[Math.floor(sizes.length / 2)] || 11;
      pg.paras.forEach((p) => {
        const heading = p.size > median * 1.45 ? 1 : p.size > median * 1.18 ? 2 : 0;
        const ppr = `<w:pPr>${heading ? `<w:pStyle w:val="Heading${heading}"/>` : ""}${p.center ? '<w:jc w:val="center"/>' : ""}<w:spacing w:after="120"/></w:pPr>`;
        body += `<w:p>${ppr}${p.runs.map((r) => runXml(r, median)).join("")}</w:p>`;
      });
      if (pg.image) {
        const id = "rIdImg" + media.length, n = media.length + 1;
        media.push({ id, name: `image${n}.jpeg`, data: pg.image.bytes });
        const cx = Math.round(pg.image.wIn * 914400), cy = Math.round(pg.image.hIn * 914400);
        body += `<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Page ${pi + 1}"/>
          <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
          <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.jpeg"/><pic:cNvPicPr/></pic:nvPicPr>
          <pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>
          </a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
      }
      if (opts.breaks && pi < pagesData.length - 1) body += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    });
    const first = pagesData[0] || { width: 612, height: 792 };
    const pgW = Math.round(first.width * 20), pgH = Math.round(first.height * 20);
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}<w:sectPr><w:pgSz w:w="${pgW}" w:h="${pgH}"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
      <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="2E294E"/></w:rPr></w:style>
      <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="541388"/></w:rPr></w:style></w:styles>`;
    z.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    z.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    z.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${X(opts.title)}</dc:title><dc:creator>YoPdfs</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().slice(0, 19)}Z</dcterms:created></cp:coreProperties>`);
    z.file("word/document.xml", doc);
    z.file("word/styles.xml", styles);
    z.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${media.map((m) => `<Relationship Id="${m.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.name}"/>`).join("")}</Relationships>`);
    media.forEach((m) => z.file("word/media/" + m.name, m.data));
    return z.generateAsync({ type: "blob", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", compression: "DEFLATE" });
  }
  YP.registerTool("pdf-to-word", {
    actionLabel: "Convert to Word", preload: () => Promise.all([lib.pdfjs(), lib.jszip()]),
    options: () =>
      ui.check("breaks", "Keep page breaks", true) +
      ui.seg("img", "Page images", [["scanned", "Scanned pages only"], ["all", "Every page"], ["none", "Never"]], "scanned", "Adds a picture of the page — useful for scans, charts and complex layouts.") +
      pagesFieldOffice(),
    async process(files, o, ctx) {
      const outs = [];
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi];
        let doc;
        try { doc = await lib.openPdfjs(f); } catch (e) { throw new Error(e.name === "PasswordException" ? `“${f.name}” is password-protected. Unlock it first.` : e.message); }
        const idx = lib.parseRanges(o.pages, doc.numPages);
        const data = [];
        let textChars = 0;
        for (let k = 0; k < idx.length; k++) {
          ctx.check();
          ctx.progress((fi + k / idx.length) / files.length, `Reading page ${idx[k] + 1} of ${doc.numPages}…`);
          const page = await doc.getPage(idx[k] + 1);
          const { lines, width, height } = await pageLines(page);
          const paras = paragraphs(lines, width);
          const chars = paras.reduce((a, p) => a + p.runs.reduce((b, r) => b + r.str.length, 0), 0);
          textChars += chars;
          const pg = { paras, width, height };
          if (o.img === "all" || (o.img === "scanned" && chars < 40)) {
            const c = await lib.renderPage(page, 1.6);
            const bytes = new Uint8Array(await (await lib.toBlob(c, "image/jpeg", 0.8)).arrayBuffer());
            const maxW = (width - 108) / 72;
            pg.image = { bytes, wIn: maxW, hIn: maxW * (height / width) };
            c.width = c.height = 0;
          }
          data.push(pg); page.cleanup();
          await ctx.tick();
        }
        doc.destroy();
        if (textChars < 20 && o.img === "none") throw new Error("This PDF has no selectable text (it's probably scanned). Choose “Scanned pages only” to include page images, or use OCR Image to Text.");
        ctx.progress((fi + 0.95) / files.length, "Building Word document…");
        outs.push({ name: YP.baseName(f.name) + ".docx", blob: await buildDocx(data, { breaks: o.breaks, title: YP.baseName(f.name) }) });
      }
      return outs;
    }
  });
  function pagesFieldOffice() { return ui.input("pages", "Pages", "", 'placeholder="All pages — or e.g. 1-3, 5"'); }

  /* ======================================================== Excel → PDF */
  YP.registerTool("excel-to-pdf", {
    actionLabel: "Convert to PDF",
    preload: () => load("xlsx.full.min.js", "jspdf.umd.min.js").then(() => load("jspdf.autotable.min.js")),
    options: () =>
      ui.seg("orient", "Orientation", [["auto", "Auto"], ["p", "Portrait"], ["l", "Landscape"]], "auto") +
      ui.seg("size", "Paper", [["a4", "A4"], ["letter", "Letter"], ["a3", "A3"]], "a4") +
      ui.seg("sheets", "Sheets", [["all", "All sheets"], ["first", "First sheet"]], "all") +
      ui.check("head", "Treat first row as a header (repeats on every page)", true) +
      ui.check("grid", "Show grid lines", true),
    async process(files, o, ctx) {
      await load("xlsx.full.min.js", "jspdf.umd.min.js"); await load("jspdf.autotable.min.js");
      const { jsPDF } = window.jspdf;
      const outs = [];
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi];
        ctx.progress(fi / files.length, `Reading ${f.name}…`);
        let wb;
        try { wb = window.XLSX.read(await lib.buffer(f), { type: "array", cellDates: true }); }
        catch (e) { throw new Error(`Couldn't read “${f.name}” as a spreadsheet.`); }
        const names = o.sheets === "first" ? wb.SheetNames.slice(0, 1) : wb.SheetNames;
        let pdf = null, drawn = 0;
        for (let si = 0; si < names.length; si++) {
          ctx.check();
          ctx.progress((fi + si / names.length) / files.length, `Laying out sheet “${names[si]}”…`);
          const rows = window.XLSX.utils.sheet_to_json(wb.Sheets[names[si]], { header: 1, raw: false, defval: "", blankrows: false });
          // drop empty trailing columns
          let ncol = 0;
          rows.forEach((r) => { for (let c = r.length - 1; c >= 0; c--) if (String(r[c]).trim() !== "") { ncol = Math.max(ncol, c + 1); break; } });
          if (!rows.length || !ncol) continue;
          const data = rows.map((r) => Array.from({ length: ncol }, (_, c) => (r[c] == null ? "" : String(r[c]))));
          const orient = o.orient === "auto" ? (ncol > 7 ? "l" : "p") : o.orient;
          if (!pdf) pdf = new jsPDF({ orientation: orient, unit: "pt", format: o.size });
          else pdf.addPage(o.size, orient);
          const pw = pdf.internal.pageSize.getWidth();
          const fontSize = Math.max(5.5, Math.min(10, (pw - 60) / (ncol * 7)));
          pdf.setFont("helvetica", "bold"); pdf.setFontSize(13); pdf.setTextColor(46, 41, 78);
          pdf.text(names.length > 1 ? names[si] : YP.baseName(f.name), 30, 34);
          pdf.autoTable({
            head: o.head ? [data[0]] : undefined, body: o.head ? data.slice(1) : data, startY: 46, margin: { left: 30, right: 30, top: 40, bottom: 34 },
            theme: o.grid ? "grid" : "plain", styles: { fontSize, cellPadding: 3, overflow: "linebreak", lineColor: [220, 215, 235], lineWidth: o.grid ? 0.5 : 0, textColor: [31, 26, 61] },
            headStyles: { fillColor: [84, 19, 136], textColor: 255, fontStyle: "bold" }, alternateRowStyles: { fillColor: [248, 245, 252] },
            didDrawPage: () => { pdf.setFontSize(8); pdf.setTextColor(150); pdf.text(`Page ${pdf.internal.getNumberOfPages()}`, pw - 30, pdf.internal.pageSize.getHeight() - 14, { align: "right" }); }
          });
          drawn++;
          await ctx.tick();
        }
        if (!drawn) throw new Error(`“${f.name}” has no data to convert.`);
        pdf.setProperties({ title: YP.baseName(f.name), creator: "YoPdfs" });
        outs.push({ name: YP.baseName(f.name) + ".pdf", blob: pdf.output("blob") });
      }
      return outs;
    }
  });

  /* ======================================================== PDF → Excel */
  function toNumber(s) {
    const t = s.trim();
    if (!/^[-+]?\(?[₹$€£]?\s?\d[\d,]*(\.\d+)?\)?%?$/.test(t)) return null;
    const digits = t.replace(/\D/g, "");
    if (digits.length > 15 || (/^0\d/.test(digits) && !t.includes("."))) return null; // ids, phone numbers, leading zeros stay text
    let v = parseFloat(t.replace(/[₹$€£,\s()%+]/g, ""));
    if (isNaN(v)) return null;
    if (/^\(.*\)$/.test(t) || t.startsWith("-")) v = -Math.abs(v);
    if (t.endsWith("%")) v = v / 100;
    return v;
  }
  async function pageTable(page) {
    const tc = await page.getTextContent({ normalizeWhitespace: true });
    const vp = page.getViewport({ scale: 1 });
    const items = tc.items.filter((it) => it.str && it.str.trim()).map((it) => ({ s: it.str.trim(), x: it.transform[4], y: vp.height - it.transform[5], w: it.width, size: Math.hypot(it.transform[0], it.transform[1]) || 10 }));
    if (!items.length) return [];
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    // rows
    const rows = [];
    for (const it of items) {
      const r = rows[rows.length - 1];
      if (r && Math.abs(r.y - it.y) < it.size * 0.55) r.items.push(it); else rows.push({ y: it.y, items: [it] });
    }
    rows.forEach((r) => {
      r.items.sort((a, b) => a.x - b.x);
      // merge fragments that touch (same cell split by the PDF generator)
      const merged = [];
      r.items.forEach((it) => { const m = merged[merged.length - 1]; if (m && it.x - (m.x + m.w) < it.size * 0.6) { m.s += (it.x - (m.x + m.w) > it.size * 0.15 ? " " : "") + it.s; m.w = it.x + it.w - m.x; } else merged.push({ ...it }); });
      r.items = merged;
    });
    // column anchors: cluster left edges across rows
    const xs = rows.flatMap((r) => r.items.map((i) => i.x)).sort((a, b) => a - b);
    const cols = [];
    xs.forEach((x) => { const c = cols[cols.length - 1]; if (c && x - c.max < 9) { c.max = x; c.n++; c.sum += x; } else cols.push({ min: x, max: x, n: 1, sum: x }); });
    const anchors = cols.filter((c) => c.n >= Math.max(1, rows.length * 0.08) || cols.length < 4).map((c) => c.sum / c.n);
    if (!anchors.length) anchors.push(0);
    return rows.map((r) => {
      const out = new Array(anchors.length).fill("");
      r.items.forEach((it) => {
        let best = 0, bd = Infinity;
        anchors.forEach((a, i) => { const d = Math.abs(it.x - a); if (d < bd && it.x >= a - 12) { bd = d; best = i; } });
        if (bd === Infinity) best = 0;
        out[best] = out[best] ? out[best] + " " + it.s : it.s;
      });
      return out.map((v) => { const n = toNumber(v); return n == null ? v : n; });
    });
  }
  YP.registerTool("pdf-to-excel", {
    actionLabel: "Convert to Excel", preload: () => Promise.all([lib.pdfjs(), load("xlsx.full.min.js")]),
    options: () => ui.seg("layout", "Layout", [["page", "One sheet per page"], ["one", "All in one sheet"]], "page") + ui.input("pages", "Pages", "", 'placeholder="All pages — or e.g. 1-3"'),
    async process(files, o, ctx) {
      await load("xlsx.full.min.js");
      const XLSX = window.XLSX;
      const outs = [];
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi];
        let doc;
        try { doc = await lib.openPdfjs(f); } catch (e) { throw new Error(e.name === "PasswordException" ? `“${f.name}” is password-protected. Unlock it first.` : e.message); }
        const idx = lib.parseRanges(o.pages, doc.numPages);
        const wb = XLSX.utils.book_new();
        const all = [];
        let any = 0;
        for (let k = 0; k < idx.length; k++) {
          ctx.check();
          ctx.progress((fi + k / idx.length) / files.length, `Extracting table from page ${idx[k] + 1}…`);
          const rows = await pageTable(await doc.getPage(idx[k] + 1));
          any += rows.length;
          if (o.layout === "one") { if (all.length && rows.length) all.push([]); all.push(...rows); }
          else if (rows.length) {
            const ws = XLSX.utils.aoa_to_sheet(rows);
            ws["!cols"] = autoCols(rows);
            XLSX.utils.book_append_sheet(wb, ws, "Page " + (idx[k] + 1));
          }
          await ctx.tick();
        }
        doc.destroy();
        if (!any) throw new Error(`No text found in “${f.name}”. If it's a scan, run OCR Image to Text first.`);
        if (o.layout === "one") { const ws = XLSX.utils.aoa_to_sheet(all); ws["!cols"] = autoCols(all); XLSX.utils.book_append_sheet(wb, ws, "Data"); }
        const out = XLSX.write(wb, { bookType: "xlsx", type: "array", compression: true });
        outs.push({ name: YP.baseName(f.name) + ".xlsx", blob: new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }) });
      }
      return outs;
    }
  });
  function autoCols(rows) {
    const n = Math.max(0, ...rows.map((r) => r.length));
    return Array.from({ length: n }, (_, c) => ({ wch: Math.min(50, Math.max(8, ...rows.map((r) => String(r[c] ?? "").length + 2))) }));
  }
})();
