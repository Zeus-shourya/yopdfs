/* ==========================================================================
   YoPdfs auth + data API
   One protocol, three backends:
     • Python dev server  (server.py → data/YoPdfs-Data.xlsx)
     • Google Apps Script (backend/google-apps-script.gs → Google Sheet)
     • local              (browser localStorage, for offline/demo use)
   ========================================================================== */
(function () {
  "use strict";
  const YP = window.YP;
  const CFG = YP.config;
  const ROOT = YP.root;

  /* ---------- visitor id (anonymous, for unique-user counts) ---------- */
  let vid = YP.store.get("vid");
  if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)); YP.store.set("vid", vid); }

  async function sha256(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  /* passwords never leave the browser in plain text */
  const passHash = (email, pw) => sha256("yopdfs:" + email.trim().toLowerCase() + ":" + pw);

  function device() {
    const w = window.innerWidth;
    return w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop";
  }

  /* ---------- backend selection ---------- */
  const isLocalHost = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  function pickBackend() {
    const b = CFG.BACKEND || "auto";
    if (b === "local") return { kind: "local" };
    if (b === "sheets") return CFG.SHEETS_URL ? { kind: "remote", url: CFG.SHEETS_URL, name: "Google Sheets" } : { kind: "local" };
    if (b === "api") return { kind: "remote", url: CFG.API_URL, name: "API" };
    if (isLocalHost) return { kind: "remote", url: CFG.API_URL || "/api", name: "Local Excel server", fallback: true };
    if (CFG.SHEETS_URL) return { kind: "remote", url: CFG.SHEETS_URL, name: "Google Sheets" };
    return { kind: "local" };
  }
  let BACKEND = pickBackend();

  async function remote(action, payload) {
    const res = await fetch(BACKEND.url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },   // simple request: no CORS preflight (Apps Script friendly)
      body: JSON.stringify(Object.assign({ action }, payload)),
      redirect: "follow"
    });
    if (!res.ok) throw Object.assign(new Error("Server error " + res.status), { network: true });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Something went wrong.");
    return data;
  }

  /* ---------- local (browser-only) backend ---------- */
  const L = {
    db() { return YP.store.get("db", { users: {}, sessions: {}, events: [], contact: [], newsletter: [], waitlist: [] }); },
    save(db) { YP.store.set("db", db); },
    pub(u) { const { passHash, ...rest } = u; return rest; },
    async call(action, p) {
      const db = L.db(); const now = new Date().toISOString();
      const sess = p.token && db.sessions[p.token];
      const me = sess && db.users[sess];
      switch (action) {
        case "ping": return { ok: true, backend: "local" };
        case "signup": {
          const email = p.email.toLowerCase();
          if (db.users[email]) throw new Error("An account with this email already exists. Try logging in.");
          db.users[email] = { id: "U" + Date.now(), name: p.name, email, role: p.role, org: p.org || "", phone: p.phone || "", plan: "free", created: now, lastLogin: now, logins: 1, passHash: p.passHash };
          const token = crypto.randomUUID(); db.sessions[token] = email; L.save(db);
          return { ok: true, token, user: L.pub(db.users[email]) };
        }
        case "login": {
          const u = db.users[(p.email || "").toLowerCase()];
          if (!u || u.passHash !== p.passHash) throw new Error("Wrong email or password.");
          u.lastLogin = now; u.logins = (u.logins || 0) + 1;
          const token = crypto.randomUUID(); db.sessions[token] = u.email; L.save(db);
          return { ok: true, token, user: L.pub(u) };
        }
        case "me": if (!me) throw new Error("Session expired."); return { ok: true, user: L.pub(me) };
        case "logout": delete db.sessions[p.token]; L.save(db); return { ok: true };
        case "update_profile": if (!me) throw new Error("Please log in again."); Object.assign(me, { name: p.name, role: p.role, org: p.org, phone: p.phone }); L.save(db); return { ok: true, user: L.pub(me) };
        case "history": if (!me) throw new Error("Please log in again."); return { ok: true, items: db.events.filter((e) => e.email === me.email).slice(-200).reverse() };
        case "event": db.events.push(Object.assign({ time: now, email: me ? me.email : "" }, p, { token: undefined })); if (db.events.length > 2000) db.events.splice(0, db.events.length - 2000); L.save(db); return { ok: true };
        case "contact": db.contact.push(Object.assign({ time: now }, p)); L.save(db); return { ok: true };
        case "newsletter": db.newsletter.push({ time: now, email: p.email }); L.save(db); return { ok: true };
        case "waitlist": db.waitlist.push({ time: now, email: p.email, plan: p.plan, name: p.name || "" }); L.save(db); return { ok: true };
        case "reset_request": throw new Error("Password reset needs the online backend. Please contact us from your registered email.");
        case "admin_export": {
          const users = Object.values(db.users).map((u) => [u.id, u.name, u.email, u.role, u.org, u.phone, u.plan, u.created, u.lastLogin, u.logins]);
          return { ok: true, sheets: {
            Users: [["User ID", "Name", "Email", "Role", "Organisation", "Phone", "Plan", "Signed up", "Last login", "Logins"]].concat(users),
            ToolUsage: [["Time", "Email", "Visitor", "Tool", "Files", "Input bytes", "Output bytes", "Duration ms", "Device", "Result"]].concat(db.events.map((e) => [e.time, e.email, e.vid, e.tool, e.files, e.inBytes, e.outBytes, e.ms, e.device, e.ok ? "ok" : "error: " + (e.error || "")])),
            Contact: [["Time", "Name", "Email", "Subject", "Message"]].concat(db.contact.map((c) => [c.time, c.name, c.email, c.subject, c.message])),
            Newsletter: [["Time", "Email"]].concat(db.newsletter.map((n) => [n.time, n.email])),
            Waitlist: [["Time", "Email", "Name", "Plan"]].concat(db.waitlist.map((w) => [w.time, w.email, w.name, w.plan]))
          } };
        }
      }
      throw new Error("Unknown action " + action);
    }
  };

  /* ---------- public API ---------- */
  YP.api = async function (action, payload = {}) {
    const p = Object.assign({ vid, device: device() }, payload);
    if (auth.token && !p.token) p.token = auth.token;
    if (BACKEND.kind === "local") return L.call(action, p);
    try { return await remote(action, p); }
    catch (err) {
      if (err.network || err instanceof TypeError) {
        if (BACKEND.fallback) { BACKEND = { kind: "local" }; return L.call(action, p); }
        throw new Error("Can't reach the server. Check your connection and try again.");
      }
      throw err;
    }
  };
  YP.backendName = () => (BACKEND.kind === "local" ? "this browser (local mode)" : BACKEND.name);

  /* ---------- session ---------- */
  const saved = YP.store.get("session", null);
  const auth = (YP.auth = { token: saved && saved.token, user: saved && saved.user });
  function setSession(token, user) {
    auth.token = token; auth.user = user;
    if (token) YP.store.set("session", { token, user }); else YP.store.del("session");
    renderSlot();
    document.dispatchEvent(new CustomEvent("yp:auth", { detail: user }));
  }
  auth.signup = async (f) => {
    const r = await YP.api("signup", { name: f.name.trim(), email: f.email.trim().toLowerCase(), passHash: await passHash(f.email, f.password), role: f.role, org: (f.org || "").trim(), phone: (f.phone || "").trim(), consent: !!f.consent, token: "" });
    setSession(r.token, r.user); YP.track("sign_up", { role: f.role }); return r.user;
  };
  auth.login = async (email, pw) => {
    const r = await YP.api("login", { email: email.trim().toLowerCase(), passHash: await passHash(email, pw), token: "" });
    setSession(r.token, r.user); YP.track("login"); return r.user;
  };
  auth.logout = async () => { try { await YP.api("logout", {}); } catch (e) {} setSession(null, null); YP.toast("You've been logged out."); };
  auth.refresh = async () => {
    if (!auth.token) return;
    try { const r = await YP.api("me", {}); setSession(auth.token, r.user); }
    catch (e) { if (!/connection|reach/i.test(e.message)) setSession(null, null); }
  };
  auth.passHash = passHash;
  auth.setSession = setSession;

  /* tool usage logging (called by workspace.js) — no file names or contents */
  YP.logUsage = function (data) {
    if (CFG.LOG_TOOL_USAGE === false) return;
    YP.api("event", data).catch(() => {});
  };

  /* ---------- header slot ---------- */
  function initials(n) { return (n || "?").split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase(); }
  function renderSlot() {
    const slot = document.querySelector("[data-auth-slot]");
    if (!slot) return;
    if (!auth.user) {
      slot.innerHTML = `<a class="btn btn-sm btn-ghost" href="${ROOT}account/">Log in</a><a class="btn btn-sm btn-primary" href="${ROOT}account/?mode=signup">Sign up</a>`;
      return;
    }
    const u = auth.user;
    slot.innerHTML = `<div class="user-menu"><button class="avatar" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">${YP.esc(initials(u.name))}</button>
      <div class="user-pop" role="menu"><div class="who"><b>${YP.esc(u.name)}</b><span>${YP.esc(u.email)}</span></div>
      <a href="${ROOT}account/" role="menuitem">${YP.icon("user")} My account</a>
      <a href="${ROOT}account/#history" role="menuitem">${YP.icon("clock")} Tool history</a>
      <a href="${ROOT}pricing/" role="menuitem">${YP.icon("star")} Plan: ${YP.esc((CFG.PLANS[u.plan] || CFG.PLANS.free).name)}</a>
      <button type="button" data-logout role="menuitem">${YP.icon("logout")} Log out</button></div></div>`;
    const menu = slot.querySelector(".user-menu"), btn = menu.querySelector(".avatar");
    btn.addEventListener("click", (e) => { e.stopPropagation(); const o = !menu.classList.contains("open"); menu.classList.toggle("open", o); btn.setAttribute("aria-expanded", o); });
    document.addEventListener("click", () => menu.classList.remove("open"));
  }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-logout]")) { auth.logout().then(() => { if (document.body.dataset.page === "account") location.reload(); }); } });
  renderSlot();
  auth.refresh();
})();
