/* ==========================================================================
   YoPdfs — account, pricing, contact and admin page logic
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP, { $, $$, h, esc, icon } = YP;
  const CFG = YP.config, page = document.body.dataset.page;

  $$("[data-email]").forEach((a) => { a.href = "mailto:" + CFG.CONTACT_EMAIL; a.textContent = CFG.CONTACT_EMAIL; });
  const msg = (root, text, type = "err") => { const m = $("[data-msg]", root); if (!m) return YP.toast(text, type); m.hidden = !text; m.className = "form-msg " + type; m.textContent = text || ""; };
  const busy = (btn, on, label) => { if (!btn) return; if (on) { btn.dataset.l = btn.innerHTML; btn.innerHTML = '<span class="loader-dots"><i></i><i></i><i></i></span>'; btn.disabled = true; } else { btn.innerHTML = label || btn.dataset.l; btn.disabled = false; } };
  const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
  $$("[data-backend-note]").forEach((el) => (el.textContent = `Data is stored in: ${YP.backendName()}.`));
  document.addEventListener("click", (e) => {
    const b = e.target.closest("[data-showpw]"); if (!b) return;
    const inp = b.parentNode.querySelector("input"); inp.type = inp.type === "password" ? "text" : "password";
  });

  /* ============================================================ account */
  if (page === "account") {
    const authV = $("[data-auth-view]"), dashV = $("[data-dash-view]");
    const params = new URLSearchParams(location.search);
    const setMode = (m) => {
      $$("[data-form]", authV).forEach((f) => (f.hidden = f.dataset.form !== m));
      $$(".auth-tabs [data-mode]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.mode === m));
      msg(authV, "");
      const first = $(`[data-form="${m}"] input`, authV); first && setTimeout(() => first.focus(), 30);
    };
    authV.addEventListener("click", (e) => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); if (e.target.closest("[data-forgot]")) setMode("reset"); });

    const show = () => {
      if (YP.auth.user) { authV.hidden = true; dashV.hidden = false; dashboard(); }
      else { dashV.hidden = true; authV.hidden = false; setMode(params.get("mode") === "signup" ? "signup" : "login"); }
    };
    const afterAuth = () => { const next = params.get("next"); if (next && /^[\w\-/]+$/.test(next)) location.href = YP.root + next; else show(); };

    $('[data-form="login"]').addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = $("button[type=submit]", f);
      if (!validEmail(f.email.value.trim())) return msg(authV, "Please enter a valid email address.");
      if (!f.password.value) return msg(authV, "Please enter your password.");
      busy(btn, true);
      try { const u = await YP.auth.login(f.email.value, f.password.value); YP.toast(`Welcome back, ${u.name.split(" ")[0]}!`, "ok"); afterAuth(); }
      catch (err) { msg(authV, err.message); }
      busy(btn, false);
    });
    $('[data-form="signup"]').addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = $("button[type=submit]", f);
      const d = { name: f.name.value, email: f.email.value, password: f.password.value, role: (f.querySelector("[name=role]:checked") || {}).value, org: f.org.value, phone: f.phone.value, consent: f.consent.checked };
      if (d.name.trim().length < 2) return msg(authV, "Please enter your full name.");
      if (!validEmail(d.email.trim())) return msg(authV, "Please enter a valid email address.");
      if (d.password.length < 8) return msg(authV, "Use a password with at least 8 characters.");
      if (!f.terms.checked) return msg(authV, "Please accept the Terms and Privacy Policy.");
      busy(btn, true);
      try { const u = await YP.auth.signup(d); YP.toast(`Account created — welcome, ${u.name.split(" ")[0]}!`, "ok"); afterAuth(); }
      catch (err) { msg(authV, err.message); }
      busy(btn, false);
    });
    $('[data-form="reset"]').addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = $("button[type=submit]", f), step2 = $("[data-step2]", f);
      if (!validEmail(f.email.value.trim())) return msg(authV, "Please enter your account email.");
      busy(btn, true);
      try {
        if (step2.hidden) {
          await YP.api("reset_request", { email: f.email.value.trim().toLowerCase() });
          step2.hidden = false; msg(authV, "If that email has an account, a 6-digit code has been sent. Enter it below with a new password.", "ok");
        } else {
          if (f.password.value.length < 8) throw new Error("Use a new password with at least 8 characters.");
          const r = await YP.api("reset_confirm", { email: f.email.value.trim().toLowerCase(), code: f.code.value.trim(), passHash: await YP.auth.passHash(f.email.value, f.password.value), token: "" });
          YP.auth.setSession(r.token, r.user); YP.toast("Password updated — you're logged in.", "ok"); show();
        }
      } catch (err) { msg(authV, err.message); }
      busy(btn, false);
    });

    async function dashboard() {
      const u = YP.auth.user;
      $("[data-uname]").textContent = u.name.split(" ")[0];
      $("[data-usub]").textContent = `${u.role || "Member"}${u.org ? " · " + u.org : ""} · member since ${(u.created || "").slice(0, 10)}`;
      $("[data-plan]").textContent = (CFG.PLANS[u.plan] || CFG.PLANS.free).name;
      const pf = $('[data-form="profile"]');
      pf.name.value = u.name || ""; pf.role.value = u.role || "Student"; pf.org.value = u.org || ""; pf.phone.value = u.phone || "";
      try {
        const { items } = await YP.api("history", {});
        const names = Object.fromEntries((window.YP_TOOLS || []).map((t) => [t.slug, t.name]));
        const ok = items.filter((i) => i.ok);
        $("[data-s-tasks]").textContent = ok.length;
        $("[data-s-files]").textContent = ok.reduce((a, i) => a + (+i.files || 0), 0);
        $("[data-s-bytes]").textContent = YP.bytes(ok.reduce((a, i) => a + (+i.inBytes || 0), 0));
        const counts = {}; ok.forEach((i) => (counts[i.tool] = (counts[i.tool] || 0) + 1));
        const fav = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        $("[data-s-fav]").textContent = fav ? names[fav[0]] || fav[0] : "–";
        $("[data-s-fav]").style.fontSize = "1.1rem";
        $("[data-hist]").innerHTML = items.length ? items.slice(0, 50).map((i) => `<tr><td>${esc(String(i.time).replace("T", " ").slice(0, 16))}</td><td><a href="${YP.root}${esc(i.tool)}/">${esc(names[i.tool] || i.tool)}</a></td><td>${+i.files || 0}</td><td>${YP.bytes(+i.inBytes || 0)}</td><td>${i.ok ? '<span class="saving">done</span>' : '<span class="saving bad">error</span>'}</td></tr>`).join("")
          : `<tr><td colspan="5" class="muted">No activity yet — <a href="${YP.root}#tools">try a tool</a> and it will show up here.</td></tr>`;
      } catch (err) { $("[data-hist]").innerHTML = `<tr><td colspan="5" class="muted">${esc(err.message)}</td></tr>`; }
    }
    $('[data-form="profile"]').addEventListener("submit", async (e) => {
      e.preventDefault();
      const f = e.target, btn = $("button[type=submit]", f);
      busy(btn, true);
      try { const r = await YP.api("update_profile", { name: f.name.value.trim(), role: f.role.value, org: f.org.value.trim(), phone: f.phone.value.trim() }); YP.auth.setSession(YP.auth.token, r.user); YP.toast("Profile saved.", "ok"); dashboard(); }
      catch (err) { YP.toast(err.message, "err"); }
      busy(btn, false);
    });
    document.addEventListener("yp:auth", () => { if (!YP.auth.user) show(); });
    show();
  }

  /* ============================================================ pricing */
  if (page === "pricing") {
    const P = CFG.PLANS;
    const paint = (cur) => {
      $$("[data-price]").forEach((el) => {
        const p = P[el.dataset.price]; if (!p) return;
        const v = p.price[cur];
        el.innerHTML = (cur === "inr" ? "₹" : "$") + v + `<small> / ${v ? "month" : "forever"}</small>`;
      });
      $$("[data-cur]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.cur === cur));
      YP.store.set("cur", cur);
    };
    $$("[data-cur]").forEach((b) => (b.onclick = () => paint(b.dataset.cur)));
    paint(YP.store.get("cur", Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Calcutta" || Intl.DateTimeFormat().resolvedOptions().timeZone === "Asia/Kolkata" ? "inr" : "usd"));
    const modal = $("#wl-modal"), form = $('[data-form="waitlist"]');
    const close = () => modal.classList.remove("open");
    $$("[data-close]", modal).forEach((b) => (b.onclick = close));
    document.addEventListener("keydown", (e) => e.key === "Escape" && close());
    $$("[data-waitlist]").forEach((b) => (b.onclick = () => {
      const plan = b.dataset.waitlist;
      form.plan.value = plan; $("[data-wl-plan]").textContent = P[plan].name;
      if (YP.auth.user) { form.name.value = YP.auth.user.name; form.email.value = YP.auth.user.email; }
      modal.classList.add("open"); setTimeout(() => form.email.focus(), 50);
    }));
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!validEmail(form.email.value.trim())) return YP.toast("Please enter a valid email.", "err");
      const btn = $("button[type=submit]", form); busy(btn, true);
      try { await YP.api("waitlist", { name: form.name.value.trim(), email: form.email.value.trim(), plan: form.plan.value }); close(); YP.toast(`You're on the ${P[form.plan.value].name} waitlist!`, "ok"); YP.track("waitlist", { plan: form.plan.value }); }
      catch (err) { YP.toast(err.message, "err"); }
      busy(btn, false);
    });
  }

  /* ============================================================ contact */
  if (page === "contact") {
    const form = $('[data-form="contact"]');
    if (YP.auth.user) { form.name.value = YP.auth.user.name; form.email.value = YP.auth.user.email; }
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!form.name.value.trim()) return msg(form, "Please tell us your name.");
      if (!validEmail(form.email.value.trim())) return msg(form, "Please enter a valid email so we can reply.");
      if (form.message.value.trim().length < 10) return msg(form, "Please write a little more in your message.");
      const btn = $("button[type=submit]", form); busy(btn, true);
      try {
        await YP.api("contact", { name: form.name.value.trim(), email: form.email.value.trim(), subject: form.subject.value, message: form.message.value.trim() });
        form.reset(); msg(form, "Thanks! Your message has been received — we'll reply by email soon.", "ok"); YP.track("contact_submit");
      } catch (err) { msg(form, err.message + " You can also email us directly at " + CFG.CONTACT_EMAIL + "."); }
      busy(btn, false);
    });
  }

  /* ============================================================ admin */
  if (page === "admin") {
    const form = $('[data-form="admin"]');
    let sheets = null;
    form.key.value = sessionStorage.getItem("yp-admin") || "";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const btn = $("button[type=submit]", form); busy(btn, true);
      try {
        const r = await YP.api("admin_export", { adminKey: form.key.value.trim() });
        sessionStorage.setItem("yp-admin", form.key.value.trim());
        sheets = r.sheets; render(); $("[data-xlsx]").disabled = false; msg(form, "");
      } catch (err) { msg(form, err.message); }
      busy(btn, false);
    });
    function render() {
      $("[data-admin-out]").hidden = false;
      const names = Object.keys(sheets);
      $("[data-admin-stats]").innerHTML = names.map((n) => `<div class="stat"><b>${Math.max(0, sheets[n].length - 1)}</b><span>${esc(n)}</span></div>`).join("");
      const tabs = $("[data-admin-tabs]");
      tabs.innerHTML = names.map((n, i) => `<button type="button" data-sheet="${esc(n)}" aria-pressed="${i === 0}">${esc(n)}</button>`).join("");
      const show = (n) => {
        $$("[data-sheet]", tabs).forEach((b) => b.setAttribute("aria-pressed", b.dataset.sheet === n));
        const rows = sheets[n];
        $("[data-admin-table]").innerHTML = `<thead><tr>${rows[0].map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.slice(1).reverse().slice(0, 300).map((r) => `<tr>${r.map((c) => `<td>${esc(c ?? "")}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${rows[0].length}" class="muted">No rows yet.</td></tr>`}</tbody>`;
      };
      $$("[data-sheet]", tabs).forEach((b) => (b.onclick = () => show(b.dataset.sheet)));
      show(names[0]);
    }
    $("[data-xlsx]").addEventListener("click", async () => {
      await YP.loadScript(YP.root + "assets/vendor/xlsx.full.min.js");
      const XLSX = window.XLSX, wb = XLSX.utils.book_new();
      Object.entries(sheets).forEach(([n, rows]) => {
        const ws = XLSX.utils.aoa_to_sheet(rows);
        ws["!cols"] = rows[0].map((_, c) => ({ wch: Math.min(50, Math.max(10, ...rows.map((r) => String(r[c] ?? "").length + 2))) }));
        ws["!autofilter"] = { ref: ws["!ref"] };
        XLSX.utils.book_append_sheet(wb, ws, n.slice(0, 31));
      });
      XLSX.writeFile(wb, `YoPdfs-Data-${new Date().toISOString().slice(0, 10)}.xlsx`);
    });
  }
})();
