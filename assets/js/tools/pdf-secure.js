/* ==========================================================================
   YoPdfs — Protect / Unlock PDF
   Uses qpdf (Apache-2.0) compiled to WebAssembly, running in the browser.
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP, lib = YP.lib, ui = YP.ui;
  const V = YP.root + "assets/vendor/qpdf/";
  let factory = null, wasm = null;

  async function qpdf(args, input) {
    if (!factory) {
      await YP.loadScript(V + "qpdf.js");
      // qpdf.js declares a global `Module` factory (and also tries exports.Module)
      factory = (window.exports && window.exports.Module) || window.Module;
      try { delete window.exports; } catch (e) { window.exports = undefined; }
      if (!factory) throw new Error("The PDF security engine failed to load. Please refresh and try again.");
    }
    if (!wasm) wasm = await fetch(V + "qpdf.wasm").then((r) => { if (!r.ok) throw new Error("Couldn't download the PDF security engine."); return r.arrayBuffer(); });
    const log = [];
    const mod = await factory({ wasmBinary: wasm, print: (t) => log.push(t), printErr: (t) => log.push(t), noInitialRun: true });
    mod.FS.writeFile("/in.pdf", input);
    const code = mod.callMain(args.map((a) => (a === "IN" ? "/in.pdf" : a === "OUT" ? "/out.pdf" : a)));
    let out = null;
    try { out = mod.FS.readFile("/out.pdf"); } catch (e) {}
    return { code, out, log: log.join("\n") };
  }

  /* is this PDF encrypted? (pdf-lib refuses encrypted files without ignoreEncryption) */
  async function isEncrypted(file) {
    const PDFLib = await lib.pdfLib();
    try { await PDFLib.PDFDocument.load(await lib.buffer(file), { updateMetadata: false }); return false; }
    catch (e) { if (/encrypt/i.test(e.message)) return true; throw new Error("This file doesn't look like a valid PDF."); }
  }

  const authBox = (txt) => ui.check("auth", txt, false);

  /* ---------------------------------------------------------------- unlock */
  YP.registerTool("unlock-pdf", {
    actionLabel: "Unlock PDF", preload: () => Promise.all([lib.pdfLib(), YP.loadScript(V + "qpdf.js").catch(() => {})]),
    options: () =>
      ui.input("password", "Document password", "", 'type="password" autocomplete="off" placeholder="Leave empty if the PDF opens without one"') +
      ui.note("Only the correct password unlocks a file. YoPdfs does not crack or guess passwords.") +
      authBox("I own this file or am authorised to remove its protection."),
    validate: (f, o) => (o.auth ? null : "Please confirm you're authorised to unlock this file."),
    async process(files, o, ctx) {
      const f = files[0];
      ctx.progress(0.1, "Checking protection…");
      if (!(await isEncrypted(f))) throw new Error("This PDF isn't password-protected — there's nothing to unlock.");
      ctx.progress(0.35, "Loading security engine…");
      const input = new Uint8Array(await lib.buffer(f));
      ctx.progress(0.6, "Decrypting…");
      const args = o.password ? ["--password=" + o.password, "--decrypt", "IN", "OUT"] : ["--decrypt", "IN", "OUT"];
      const r = await qpdf(args, input);
      if (!r.out || r.code === 2) {
        if (/password/i.test(r.log) || !r.log.trim()) throw new Error(o.password ? "That password is incorrect. Please check it and try again." : "This PDF needs a password to open. Enter it and try again.");
        throw new Error("Couldn't unlock this PDF. " + r.log.split("\n").pop());
      }
      return { outputs: [{ name: YP.baseName(f.name) + "-unlocked.pdf", blob: lib.pdfBlob(r.out) }], title: "PDF unlocked!", summary: "The new copy opens without a password and has no restrictions." };
    }
  });

  /* ---------------------------------------------------------------- protect */
  YP.registerTool("protect-pdf", {
    actionLabel: "Protect PDF", preload: () => Promise.all([lib.pdfLib(), YP.loadScript(V + "qpdf.js").catch(() => {})]),
    options: () =>
      ui.input("pw", "Password", "", 'type="password" autocomplete="new-password" minlength="4" placeholder="At least 4 characters"') +
      ui.input("pw2", "Repeat password", "", 'type="password" autocomplete="new-password"') +
      `<div class="opt-group"><span class="label">Permissions for people with the password</span>
        ${ui.check("print", "Allow printing", true)}${ui.check("copy", "Allow copying text & images", true)}${ui.check("modify", "Allow editing", false)}</div>` +
      ui.input("owner", "Owner password (optional)", "", 'type="password" autocomplete="new-password" placeholder="Lets you change permissions later"') +
      ui.note("Encryption: AES-256. Remember your password — it can't be recovered."),
    validate(f, o) {
      if (!o.pw || o.pw.length < 4) return "Choose a password with at least 4 characters.";
      if (o.pw !== o.pw2) return "The two passwords don't match.";
    },
    async process(files, o, ctx) {
      const f = files[0];
      ctx.progress(0.1, "Checking file…");
      if (await isEncrypted(f)) throw new Error("This PDF is already protected. Unlock it first, then set a new password.");
      ctx.progress(0.35, "Loading security engine…");
      const input = new Uint8Array(await lib.buffer(f));
      const owner = o.owner || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random())) + "-yp";
      const restr = [];
      if (!o.print) restr.push("--print=none");
      if (!o.copy) restr.push("--extract=n");
      if (!o.modify) restr.push("--modify=none");
      ctx.progress(0.6, "Encrypting with AES-256…");
      const r = await qpdf(["--encrypt", o.pw, owner, "256", ...restr, "--", "IN", "OUT"], input);
      if (!r.out || r.code === 2) throw new Error("Couldn't protect this PDF. " + r.log.split("\n").pop());
      return { outputs: [{ name: YP.baseName(f.name) + "-protected.pdf", blob: lib.pdfBlob(r.out) }], title: "PDF protected!", summary: "AES-256 encrypted. You'll need your password to open it." };
    }
  });
})();
