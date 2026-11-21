/**
 * YoPdfs backend for Google Sheets (Apps Script web app)
 * -------------------------------------------------------
 * Same JSON protocol as server.py. Every signup, login, tool use, contact
 * message, newsletter and waitlist entry is written to this spreadsheet
 * (File → Download → Microsoft Excel gives you the .xlsx).
 *
 * Setup: see backend/SETUP.md (5 minutes, free).
 *
 * Sheets created automatically:
 *   Users, Logins, ToolUsage, Contact, Newsletter, Waitlist   (visible)
 *   _Auth, _Sessions, _Resets                                 (hidden; password hashes + tokens)
 */

var SESSION_DAYS = 30;

var HEADERS = {
  Users:      ['User ID', 'Name', 'Email', 'Role', 'Organisation', 'Phone', 'Plan', 'Signed up', 'Last login', 'Logins', 'Marketing consent'],
  Logins:     ['Time', 'Email', 'Event', 'Device', 'Visitor ID'],
  ToolUsage:  ['Time', 'Email', 'Visitor ID', 'Tool', 'Files', 'Input KB', 'Output KB', 'Seconds', 'Device', 'Result'],
  Contact:    ['Time', 'Name', 'Email', 'Subject', 'Message', 'Account email'],
  Newsletter: ['Time', 'Email', 'Page'],
  Waitlist:   ['Time', 'Name', 'Email', 'Plan'],
  _Auth:      ['Email', 'Salt', 'Hash'],
  _Sessions:  ['Token', 'Email', 'Expires'],
  _Resets:    ['Email', 'Code', 'Expires']
};

function doGet() {
  return json_({ ok: true, backend: 'google-sheets', message: 'YoPdfs backend is running.' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    return json_(handle_(p));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

/* ------------------------------------------------------------------ helpers */
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(msg) { throw new Error(msg); }
function now_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function clean_(s, n) {
  var v = String(s == null ? '' : s).trim().slice(0, n || 300);
  return /^[=+\-@]/.test(v) ? "'" + v : v; // stop spreadsheet formula injection
}
function fmt_(v) { return v instanceof Date ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : String(v); }
function sha256_(s) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 255).toString(16)).slice(-2); }).join('');
}
function token_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, ''); }
function validEmail_(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e); }

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADERS[name].length).setValues([HEADERS[name]]).setFontWeight('bold').setBackground('#541388').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (name.charAt(0) === '_') sh.hideSheet();
  }
  return sh;
}
function append_(name, row) { sheet_(name).appendRow(row); }
function findRow_(name, col, value) {
  var sh = sheet_(name);
  if (sh.getLastRow() < 2) return 0;
  var hit = sh.getRange(2, col, sh.getLastRow() - 1, 1).createTextFinder(String(value)).matchEntireCell(true).findNext();
  return hit ? hit.getRow() : 0;
}
function userByEmail_(email) {
  var r = findRow_('Users', 3, email);
  if (!r) return null;
  var v = sheet_('Users').getRange(r, 1, 1, HEADERS.Users.length).getValues()[0];
  return { row: r, id: v[0], name: v[1], email: v[2], role: v[3], org: v[4], phone: v[5], plan: v[6] || 'free', created: fmt_(v[7]), lastLogin: fmt_(v[8]), logins: v[9] };
}
function pub_(u) { return { id: u.id, name: u.name, email: u.email, role: u.role, org: u.org, phone: u.phone, plan: u.plan, created: u.created, lastLogin: u.lastLogin, logins: u.logins }; }
function newSession_(email) {
  var t = token_();
  append_('_Sessions', [t, email, Date.now() + SESSION_DAYS * 864e5]);
  return t;
}
function sessionUser_(token) {
  if (!token) return null;
  var r = findRow_('_Sessions', 1, token);
  if (!r) return null;
  var v = sheet_('_Sessions').getRange(r, 1, 1, 3).getValues()[0];
  if (Number(v[2]) < Date.now()) { sheet_('_Sessions').deleteRow(r); return null; }
  return userByEmail_(v[1]);
}
function setPassword_(email, clientHash) {
  var salt = Utilities.getUuid().slice(0, 16);
  var hash = sha256_(salt + ':' + clientHash);
  var r = findRow_('_Auth', 1, email);
  if (r) sheet_('_Auth').getRange(r, 2, 1, 2).setValues([[salt, hash]]);
  else append_('_Auth', [email, salt, hash]);
}
function checkPassword_(email, clientHash) {
  var r = findRow_('_Auth', 1, email);
  if (!r) return false;
  var v = sheet_('_Auth').getRange(r, 1, 1, 3).getValues()[0];
  return sha256_(v[1] + ':' + clientHash) === v[2];
}

/* ------------------------------------------------------------------ actions */
function handle_(p) {
  var a = p.action, t = now_();
  var dev = clean_(p.device, 20), vid = clean_(p.vid, 64);
  var me = sessionUser_(p.token);

  switch (a) {
    case 'ping': return { ok: true, backend: 'google-sheets' };

    case 'signup': {
      var email = clean_(p.email, 120).toLowerCase(), name = clean_(p.name, 80);
      if (!validEmail_(email)) fail_('Please enter a valid email address.');
      if (name.length < 2) fail_('Please enter your name.');
      if (clean_(p.passHash, 80).length !== 64) fail_('Invalid password.');
      if (userByEmail_(email)) fail_('An account with this email already exists. Try logging in.');
      var id = 'U' + Utilities.getUuid().slice(0, 8).toUpperCase();
      append_('Users', [id, name, email, clean_(p.role, 30), clean_(p.org, 120), clean_(p.phone, 30), 'free', t, t, 1, p.consent ? 'yes' : 'no']);
      setPassword_(email, p.passHash);
      append_('Logins', [t, email, 'signup', dev, vid]);
      return { ok: true, token: newSession_(email), user: pub_(userByEmail_(email)) };
    }

    case 'login': {
      var em = clean_(p.email, 120).toLowerCase();
      var u = userByEmail_(em);
      if (!u || !checkPassword_(em, clean_(p.passHash, 80))) { append_('Logins', [t, em, 'failed login', dev, vid]); fail_('Wrong email or password.'); }
      sheet_('Users').getRange(u.row, 9, 1, 2).setValues([[t, (Number(u.logins) || 0) + 1]]);
      append_('Logins', [t, em, 'login', dev, vid]);
      return { ok: true, token: newSession_(em), user: pub_(userByEmail_(em)) };
    }

    case 'me':
      if (!me) fail_('Session expired. Please log in again.');
      return { ok: true, user: pub_(me) };

    case 'logout': {
      var r = findRow_('_Sessions', 1, p.token || '#');
      if (r) { var em2 = sheet_('_Sessions').getRange(r, 2).getValue(); sheet_('_Sessions').deleteRow(r); append_('Logins', [t, em2, 'logout', dev, vid]); }
      return { ok: true };
    }

    case 'update_profile':
      if (!me) fail_('Please log in again.');
      sheet_('Users').getRange(me.row, 2).setValue(clean_(p.name, 80) || me.name);
      sheet_('Users').getRange(me.row, 4, 1, 3).setValues([[clean_(p.role, 30), clean_(p.org, 120), clean_(p.phone, 30)]]);
      return { ok: true, user: pub_(userByEmail_(me.email)) };

    case 'history': {
      if (!me) fail_('Please log in again.');
      var sh = sheet_('ToolUsage'), last = sh.getLastRow(), items = [];
      if (last > 1) {
        var start = Math.max(2, last - 5000);
        var rows = sh.getRange(start, 1, last - start + 1, 10).getValues();
        for (var i = rows.length - 1; i >= 0 && items.length < 200; i--) {
          var row = rows[i];
          if (row[1] === me.email) items.push({ time: fmt_(row[0]), tool: row[3], files: row[4], inBytes: row[5] * 1024, outBytes: row[6] * 1024, ms: row[7] * 1000, ok: row[9] === 'ok' });
        }
      }
      return { ok: true, items: items };
    }

    case 'event': {
      var kb = function (v) { return Math.round((Number(v) || 0) / 102.4) / 10; };
      append_('ToolUsage', [t, me ? me.email : '', vid, clean_(p.tool, 40), Number(p.files) || 0, kb(p.inBytes), kb(p.outBytes), Math.round((Number(p.ms) || 0) / 10) / 100, dev, p.ok ? 'ok' : 'error: ' + clean_(p.error, 160)]);
      return { ok: true };
    }

    case 'contact': {
      var ce = clean_(p.email, 120);
      if (!validEmail_(ce) || !clean_(p.message)) fail_('Please add your email and a message.');
      append_('Contact', [t, clean_(p.name, 80), ce, clean_(p.subject, 120), clean_(p.message, 4000), me ? me.email : '']);
      var notify = PropertiesService.getScriptProperties().getProperty('NOTIFY_EMAIL');
      if (notify) { try { MailApp.sendEmail(notify, 'YoPdfs contact: ' + clean_(p.subject, 80), clean_(p.message, 4000) + '\n\nFrom: ' + clean_(p.name, 80) + ' <' + ce + '>'); } catch (x) {} }
      return { ok: true };
    }

    case 'newsletter': {
      var ne = clean_(p.email, 120).toLowerCase();
      if (!validEmail_(ne)) fail_('Please enter a valid email.');
      if (!findRow_('Newsletter', 2, ne)) append_('Newsletter', [t, ne, clean_(p.page, 120)]);
      return { ok: true };
    }

    case 'waitlist': {
      var we = clean_(p.email, 120).toLowerCase();
      if (!validEmail_(we)) fail_('Please enter a valid email.');
      append_('Waitlist', [t, clean_(p.name, 80), we, clean_(p.plan, 20)]);
      return { ok: true };
    }

    case 'reset_request': {
      var re = clean_(p.email, 120).toLowerCase();
      if (userByEmail_(re)) {
        var code = ('00000' + Math.floor(Math.random() * 1e6)).slice(-6);
        var exp = Date.now() + 15 * 60000;
        var rr = findRow_('_Resets', 1, re);
        if (rr) sheet_('_Resets').getRange(rr, 2, 1, 2).setValues([["'" + code, exp]]); else append_('_Resets', [re, "'" + code, exp]);
        MailApp.sendEmail(re, 'Your YoPdfs password reset code', 'Your reset code is ' + code + '. It expires in 15 minutes.\n\nIf you did not request this, you can ignore this email.');
      }
      return { ok: true };
    }

    case 'reset_confirm': {
      var ce2 = clean_(p.email, 120).toLowerCase();
      var r2 = findRow_('_Resets', 1, ce2);
      var v2 = r2 ? sheet_('_Resets').getRange(r2, 1, 1, 3).getValues()[0] : null;
      if (!v2 || String(v2[1]).replace(/^'/, '') !== String(p.code || '').trim() || Number(v2[2]) < Date.now()) fail_('That code is invalid or has expired.');
      setPassword_(ce2, clean_(p.passHash, 80));
      sheet_('_Resets').deleteRow(r2);
      append_('Logins', [t, ce2, 'password reset', dev, vid]);
      return { ok: true, token: newSession_(ce2), user: pub_(userByEmail_(ce2)) };
    }

    case 'admin_export': {
      var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
      if (!key || clean_(p.adminKey, 100) !== key) fail_('Wrong admin key.');
      var out = {};
      ['Users', 'Logins', 'ToolUsage', 'Contact', 'Newsletter', 'Waitlist'].forEach(function (n) {
        var s = sheet_(n);
        out[n] = s.getRange(1, 1, Math.max(1, s.getLastRow()), HEADERS[n].length).getValues().map(function (row) {
          return row.map(function (c) { return c instanceof Date ? Utilities.formatDate(c, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss') : c; });
        });
      });
      return { ok: true, sheets: out };
    }
  }
  fail_('Unknown action.');
}

/** Run once from the editor (▶ Run → setup) to create all sheets. */
function setup() {
  Object.keys(HEADERS).forEach(sheet_);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var blank = ss.getSheetByName('Sheet1');
  if (blank && ss.getSheets().length > 1 && blank.getLastRow() === 0) ss.deleteSheet(blank);
}
