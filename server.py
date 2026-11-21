"""
YoPdfs local server — static site + accounts/data API that writes an Excel workbook.

    py server.py               # http://localhost:4431
    py server.py --port 8080

Every signup, login, tool use, contact message, newsletter and waitlist entry is
stored in data/store.json and mirrored to data/YoPdfs-Data.xlsx (one sheet each).
Passwords are hashed in the browser (SHA-256) and hashed again here with a
per-user salt; they are never written to the Excel file.

Pure standard library — no pip installs needed. The same JSON protocol is
implemented for Google Sheets in backend/google-apps-script.gs.
"""
import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import secrets
import sys
import threading
import zipfile
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(ROOT, "data")
STORE = os.path.join(DATA, "store.json")
XLSX = os.path.join(DATA, "YoPdfs-Data.xlsx")
ADMIN = os.path.join(DATA, "admin.json")
LOCK = threading.Lock()
SESSION_DAYS = 30

SHEETS = {
    "Users": ["User ID", "Name", "Email", "Role", "Organisation", "Phone", "Plan", "Signed up", "Last login", "Logins", "Marketing consent"],
    "Logins": ["Time", "Email", "Event", "Device", "Visitor ID"],
    "ToolUsage": ["Time", "Email", "Visitor ID", "Tool", "Files", "Input KB", "Output KB", "Seconds", "Device", "Result"],
    "Contact": ["Time", "Name", "Email", "Subject", "Message", "Account email"],
    "Newsletter": ["Time", "Email", "Page"],
    "Waitlist": ["Time", "Name", "Email", "Plan"],
}


def now():
    return dt.datetime.now().replace(microsecond=0).isoformat(sep=" ")


def load():
    if not os.path.exists(STORE):
        return {"users": {}, "sessions": {}, "resets": {}, "rows": {k: [] for k in SHEETS if k != "Users"}}
    with open(STORE, encoding="utf-8") as f:
        db = json.load(f)
    for k in SHEETS:
        if k != "Users":
            db["rows"].setdefault(k, [])
    db.setdefault("resets", {})
    return db


def save(db):
    os.makedirs(DATA, exist_ok=True)
    tmp = STORE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STORE)
    try:
        write_xlsx(sheet_rows(db), XLSX)
    except PermissionError:
        print("  ! YoPdfs-Data.xlsx is open in Excel — data saved to store.json; the workbook updates on the next write after you close it.")


def sheet_rows(db):
    out = {"Users": [SHEETS["Users"]]}
    for u in db["users"].values():
        out["Users"].append([u["id"], u["name"], u["email"], u.get("role", ""), u.get("org", ""), u.get("phone", ""), u.get("plan", "free"),
                             u["created"], u.get("lastLogin", ""), u.get("logins", 0), "yes" if u.get("consent") else "no"])
    for k, header in SHEETS.items():
        if k != "Users":
            out[k] = [header] + db["rows"][k]
    return out


# ---------------------------------------------------------------- xlsx writer
def _col(n):
    s = ""
    n += 1
    while n:
        n, r = divmod(n - 1, 26)
        s = chr(65 + r) + s
    return s


def write_xlsx(sheets, path):
    names = list(sheets)
    ct = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>']
    ct += [f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(len(names))]
    ct.append("</Types>")
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
          + "".join(f'<sheet name="{escape(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, n in enumerate(names)) + "</sheets></workbook>")
    wbrels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
              + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>' for i in range(len(names)))
              + f'<Relationship Id="rId{len(names) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
              '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
              '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
              '<fill><patternFill patternType="solid"><fgColor rgb="FF541388"/><bgColor indexed="64"/></patternFill></fill></fills>'
              '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
              '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
              '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
              '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs></styleSheet>')
    with zipfile.ZipFile(path + ".tmp", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", "".join(ct))
        z.writestr("_rels/.rels", rels)
        z.writestr("xl/workbook.xml", wb)
        z.writestr("xl/_rels/workbook.xml.rels", wbrels)
        z.writestr("xl/styles.xml", styles)
        for i, n in enumerate(names):
            rows = sheets[n]
            ncol = max(len(r) for r in rows)
            widths = [min(60, max(10, max(len(str(r[c])) if c < len(r) else 0 for r in rows) + 2)) for c in range(ncol)]
            x = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                 '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>']
            x += [f'<col min="{c + 1}" max="{c + 1}" width="{w}" customWidth="1"/>' for c, w in enumerate(widths)]
            x.append("</cols><sheetData>")
            for ri, row in enumerate(rows):
                x.append(f'<row r="{ri + 1}">')
                for ci, v in enumerate(row):
                    ref = f"{_col(ci)}{ri + 1}"
                    st = ' s="1"' if ri == 0 else ""
                    if isinstance(v, bool):
                        v = "yes" if v else "no"
                    if isinstance(v, (int, float)) and ri > 0:
                        x.append(f'<c r="{ref}"{st}><v>{v}</v></c>')
                    else:
                        x.append(f'<c r="{ref}" t="inlineStr"{st}><is><t xml:space="preserve">{escape(str(v if v is not None else ""))}</t></is></c>')
                x.append("</row>")
            x.append("</sheetData>")
            if len(rows) > 1:
                x.append(f'<autoFilter ref="A1:{_col(ncol - 1)}{len(rows)}"/>')
            x.append("</worksheet>")
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", "".join(x))
    os.replace(path + ".tmp", path)


# ---------------------------------------------------------------- API
class ApiError(Exception):
    pass


def salted(salt, client_hash):
    return hashlib.sha256((salt + ":" + client_hash).encode()).hexdigest()


def public(u):
    return {k: u.get(k) for k in ("id", "name", "email", "role", "org", "phone", "plan", "created", "lastLogin", "logins")}


def clean(s, n=300):
    return str(s or "").strip()[:n]


def new_session(db, email):
    token = secrets.token_urlsafe(32)
    db["sessions"][token] = {"email": email, "expires": (dt.datetime.now() + dt.timedelta(days=SESSION_DAYS)).isoformat()}
    return token


def session_user(db, token):
    s = db["sessions"].get(token or "")
    if not s:
        return None
    if s["expires"] < dt.datetime.now().isoformat():
        db["sessions"].pop(token, None)
        return None
    return db["users"].get(s["email"])


def admin_key():
    if not os.path.exists(ADMIN):
        os.makedirs(DATA, exist_ok=True)
        with open(ADMIN, "w", encoding="utf-8") as f:
            json.dump({"adminKey": secrets.token_urlsafe(12)}, f)
    with open(ADMIN, encoding="utf-8") as f:
        return json.load(f)["adminKey"]


def handle(p):
    action = p.get("action")
    with LOCK:
        db = load()
        me = session_user(db, p.get("token"))
        t = now()
        dev, vid = clean(p.get("device"), 20), clean(p.get("vid"), 64)

        if action == "ping":
            return {"ok": True, "backend": "python-excel"}

        if action == "signup":
            email = clean(p.get("email"), 120).lower()
            name = clean(p.get("name"), 80)
            if "@" not in email or "." not in email.split("@")[-1]:
                raise ApiError("Please enter a valid email address.")
            if len(name) < 2:
                raise ApiError("Please enter your name.")
            if len(clean(p.get("passHash"), 80)) != 64:
                raise ApiError("Invalid password.")
            if email in db["users"]:
                raise ApiError("An account with this email already exists. Try logging in.")
            salt = secrets.token_hex(8)
            u = {"id": "U" + secrets.token_hex(4).upper(), "name": name, "email": email, "role": clean(p.get("role"), 30),
                 "org": clean(p.get("org"), 120), "phone": clean(p.get("phone"), 30), "plan": "free", "created": t, "lastLogin": t,
                 "logins": 1, "consent": bool(p.get("consent")), "salt": salt, "hash": salted(salt, p["passHash"])}
            db["users"][email] = u
            db["rows"]["Logins"].append([t, email, "signup", dev, vid])
            token = new_session(db, email)
            save(db)
            return {"ok": True, "token": token, "user": public(u)}

        if action == "login":
            email = clean(p.get("email"), 120).lower()
            u = db["users"].get(email)
            if not u or not hmac.compare_digest(u["hash"], salted(u["salt"], clean(p.get("passHash"), 80))):
                db["rows"]["Logins"].append([t, email, "failed login", dev, vid])
                save(db)
                raise ApiError("Wrong email or password.")
            u["lastLogin"] = t
            u["logins"] = u.get("logins", 0) + 1
            db["rows"]["Logins"].append([t, email, "login", dev, vid])
            token = new_session(db, email)
            save(db)
            return {"ok": True, "token": token, "user": public(u)}

        if action == "me":
            if not me:
                raise ApiError("Session expired. Please log in again.")
            return {"ok": True, "user": public(me)}

        if action == "logout":
            s = db["sessions"].pop(p.get("token") or "", None)
            if s:
                db["rows"]["Logins"].append([t, s["email"], "logout", dev, vid])
                save(db)
            return {"ok": True}

        if action == "update_profile":
            if not me:
                raise ApiError("Please log in again.")
            for k, n in (("name", 80), ("role", 30), ("org", 120), ("phone", 30)):
                if k in p:
                    me[k] = clean(p[k], n)
            save(db)
            return {"ok": True, "user": public(me)}

        if action == "history":
            if not me:
                raise ApiError("Please log in again.")
            rows = [r for r in db["rows"]["ToolUsage"] if r[1] == me["email"]][-200:]
            items = [{"time": r[0], "tool": r[3], "files": r[4], "inBytes": r[5] * 1024, "outBytes": r[6] * 1024, "ms": r[7] * 1000, "ok": r[9] == "ok"} for r in reversed(rows)]
            return {"ok": True, "items": items}

        if action == "event":
            kb = lambda v: round((v or 0) / 1024, 1)
            db["rows"]["ToolUsage"].append([t, me["email"] if me else "", vid, clean(p.get("tool"), 40), int(p.get("files") or 0), kb(p.get("inBytes")),
                                            kb(p.get("outBytes")), round((p.get("ms") or 0) / 1000, 2), dev, "ok" if p.get("ok") else "error: " + clean(p.get("error"), 160)])
            save(db)
            return {"ok": True}

        if action == "contact":
            email = clean(p.get("email"), 120)
            if "@" not in email or not clean(p.get("message")):
                raise ApiError("Please add your email and a message.")
            db["rows"]["Contact"].append([t, clean(p.get("name"), 80), email, clean(p.get("subject"), 120), clean(p.get("message"), 4000), me["email"] if me else ""])
            save(db)
            return {"ok": True}

        if action == "newsletter":
            email = clean(p.get("email"), 120).lower()
            if "@" not in email:
                raise ApiError("Please enter a valid email.")
            if not any(r[1] == email for r in db["rows"]["Newsletter"]):
                db["rows"]["Newsletter"].append([t, email, clean(p.get("page"), 120)])
                save(db)
            return {"ok": True}

        if action == "waitlist":
            email = clean(p.get("email"), 120).lower()
            if "@" not in email:
                raise ApiError("Please enter a valid email.")
            db["rows"]["Waitlist"].append([t, clean(p.get("name"), 80), email, clean(p.get("plan"), 20)])
            save(db)
            return {"ok": True}

        if action == "reset_request":
            email = clean(p.get("email"), 120).lower()
            if email in db["users"]:
                code = f"{secrets.randbelow(10 ** 6):06d}"
                db["resets"][email] = {"code": code, "expires": (dt.datetime.now() + dt.timedelta(minutes=15)).isoformat()}
                save(db)
                print(f"  >> Password reset code for {email}: {code}  (connect an email service to send this automatically)")
            return {"ok": True, "message": "If that email has an account, a reset code has been issued."}

        if action == "reset_confirm":
            email = clean(p.get("email"), 120).lower()
            r = db["resets"].get(email)
            if not r or r["expires"] < dt.datetime.now().isoformat() or not hmac.compare_digest(r["code"], clean(p.get("code"), 10)):
                raise ApiError("That code is invalid or has expired.")
            u = db["users"][email]
            u["salt"] = secrets.token_hex(8)
            u["hash"] = salted(u["salt"], clean(p.get("passHash"), 80))
            db["resets"].pop(email, None)
            db["rows"]["Logins"].append([t, email, "password reset", dev, vid])
            token = new_session(db, email)
            save(db)
            return {"ok": True, "token": token, "user": public(u)}

        if action == "admin_export":
            if not hmac.compare_digest(clean(p.get("adminKey"), 100), admin_key()):
                raise ApiError("Wrong admin key.")
            return {"ok": True, "sheets": sheet_rows(db)}

    raise ApiError("Unknown action.")


class Handler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm": "application/wasm", ".mjs": "text/javascript",
                      ".js": "text/javascript", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml"}

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        if args and "/api" in str(args[0]):
            sys.stderr.write("  api %s\n" % (fmt % args))

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if self.path.startswith("/assets/vendor/"):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def blocked(self):
        path = urlparse(self.path).path.lower()
        return path.startswith(("/data", "/.git", "/server.py", "/backend/"))

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/api/excel":
            key = (parse_qs(u.query).get("key") or [""])[0]
            if not hmac.compare_digest(key, admin_key()) or not os.path.exists(XLSX):
                return self.send_error(403)
            with open(XLSX, "rb") as f:
                body = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
            self.send_header("Content-Disposition", 'attachment; filename="YoPdfs-Data.xlsx"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.blocked():
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if self.blocked():
            return self.send_error(404)
        return super().do_HEAD()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_POST(self):
        if urlparse(self.path).path != "/api":
            return self.send_error(404)
        try:
            n = int(self.headers.get("Content-Length") or 0)
            if n > 200_000:
                raise ApiError("Request too large.")
            p = json.loads(self.rfile.read(n) or b"{}")
            out = handle(p)
        except ApiError as e:
            out = {"ok": False, "error": str(e)}
        except Exception as e:  # noqa
            out = {"ok": False, "error": "Server error: " + str(e)}
        body = json.dumps(out).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=4431)
    a = ap.parse_args()
    key = admin_key()
    with LOCK:
        db = load()
        save(db)
    print(f"YoPdfs running at http://localhost:{a.port}/")
    print(f"  Excel data file : {XLSX}")
    print(f"  Admin page      : http://localhost:{a.port}/admin/   (admin key: {key})")
    ThreadingHTTPServer(("127.0.0.1", a.port), Handler).serve_forever()
