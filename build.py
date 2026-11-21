"""
YoPdfs static site builder.

    py build.py

Reads src/ (site.json, tools.json, icons.json, partials, templates, pages) and
writes the finished static site into this folder:

    index.html, <tool-slug>/index.html (one SEO page per tool),
    about/, contact/, privacy/, terms/, pricing/, account/, admin/, 404.html,
    assets/js/registry.js, sitemap.xml, robots.txt

No dependencies beyond the Python standard library.
"""
import datetime
import html
import json
import os
import re
import time
from urllib.parse import urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")


def read(path):
    with open(path, encoding="utf-8") as f:
        return f.read()


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)


SITE = json.loads(read(os.path.join(SRC, "site.json")))
TOOLS = json.loads(read(os.path.join(SRC, "tools.json")))
ICONS = json.loads(read(os.path.join(SRC, "icons.json")))
BY_SLUG = {t["slug"]: t for t in TOOLS}
VER = str(int(time.time()))
YEAR = str(datetime.date.today().year)
TODAY = datetime.date.today().isoformat()
SITE_URL = SITE["url"].rstrip("/")
BASE_PATH = urlparse(SITE_URL).path.rstrip("/") + "/"

CAT_NAME = {"pdf": "PDF", "image": "Image", "convert": "Convert", "edit": "Edit", "compress": "Compress"}

LOGO = (
    '<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="yplg" x1="0" y1="0" x2="1" y2="1">'
    '<stop offset="0" stop-color="#5B16A0"/><stop offset=".55" stop-color="#A41391"/><stop offset="1" stop-color="#FF2E97"/>'
    '</linearGradient></defs><rect width="40" height="40" rx="12" fill="url(#yplg)"/>'
    '<path d="M13.5 9.5h9.5l6 6v14.5a2.5 2.5 0 0 1-2.5 2.5h-13a2.5 2.5 0 0 1-2.5-2.5v-18a2.5 2.5 0 0 1 2.5-2.5z" fill="#fff"/>'
    '<path d="M23 9.5v6h6" fill="#E9D5FF"/>'
    '<path d="m15.6 17.2 4.4 5 4.4-5M20 22.2v5.3" fill="none" stroke="#541388" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
)


def icon(name, cls="ico"):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>'


def esc(s):
    return html.escape(s, quote=True)


def tool_card(t, root, heading="h3"):
    badge = f'<span class="badge">{esc(t["badge"])}</span>' if t.get("badge") else ""
    fmt = ""
    if t.get("from"):
        fmt = f'<span class="fmt"><span>{t["from"]}</span>→<span>{t["to"]}</span></span>'
    cats = " ".join(t["cats"])
    return (
        f'<a class="tool-card cat-{t["primary"]}" href="{root}{t["slug"]}/" data-cats="{cats}">'
        f'<span class="tool-icon">{icon(t["icon"])}</span>{badge}<span class="go">{icon("arrow")}</span>'
        f'<{heading}>{esc(t["name"])}</{heading}><p>{esc(t["short"])}</p>{fmt}</a>'
    )


MEGA_GROUPS = [
    ("Organize & edit PDF", ["merge-pdf", "split-pdf", "compress-pdf", "edit-pdf", "rotate-pdf", "add-watermark", "add-page-numbers"]),
    ("Convert", ["jpg-to-pdf", "pdf-to-jpg", "png-to-pdf", "pdf-to-png", "word-to-pdf", "pdf-to-word", "excel-to-pdf", "pdf-to-excel"]),
    ("Image tools", ["image-compressor", "image-resizer", "image-cropper", "jpg-to-png", "png-to-jpg"]),
    ("Security & AI", ["protect-pdf", "unlock-pdf", "background-remover", "passport-photo-maker", "ocr-image-to-text"]),
]
FOOT = {
    "foot_pdf": ["merge-pdf", "split-pdf", "compress-pdf", "edit-pdf", "rotate-pdf", "protect-pdf", "unlock-pdf", "add-watermark", "add-page-numbers"],
    "foot_convert": ["jpg-to-pdf", "pdf-to-jpg", "png-to-pdf", "pdf-to-png", "word-to-pdf", "pdf-to-word", "excel-to-pdf", "pdf-to-excel"],
    "foot_image": ["image-compressor", "image-resizer", "image-cropper", "jpg-to-png", "png-to-jpg", "background-remover", "passport-photo-maker", "ocr-image-to-text"],
}


def mega_html(root):
    out = []
    for title, slugs in MEGA_GROUPS:
        links = "".join(
            f'<a role="menuitem" href="{root}{s}/" class="cat-{BY_SLUG[s]["primary"]}"><span class="mini-ico">{icon(BY_SLUG[s]["icon"])}</span>{esc(BY_SLUG[s]["name"])}</a>'
            for s in slugs
        )
        out.append(f"<div><h4>{title}</h4>{links}</div>")
    return "".join(out)


def drawer_html(root):
    out = []
    for title, slugs in MEGA_GROUPS:
        out.append(f"<h4>{title}</h4>")
        out.extend(
            f'<a href="{root}{s}/" class="cat-{BY_SLUG[s]["primary"]}"><span class="mini-ico" style="width:28px;height:28px;border-radius:9px;display:grid;place-items:center;color:#fff">{icon(BY_SLUG[s]["icon"])}</span>{esc(BY_SLUG[s]["name"])}</a>'
            for s in slugs
        )
    return "".join(out)


PARTIALS = {name[:-5]: read(os.path.join(SRC, "partials", name)) for name in os.listdir(os.path.join(SRC, "partials"))}


def render(template, ctx):
    # partial includes first (one level deep is enough; partials may contain {{vars}})
    template = re.sub(r"\{\{>\s*(\w+)\s*\}\}", lambda m: PARTIALS[m.group(1)], template)

    def sub(m):
        key = m.group(1)
        if key not in ctx:
            raise KeyError(f"missing template key: {key}")
        return str(ctx[key])

    return re.sub(r"\{\{(\w+)\}\}", sub, template)


def base_ctx(root, page, title, desc, path, robots="index,follow", jsonld=None, extra_head=""):
    ctx = {
        "root": root,
        "home": root if root else "./",
        "page": page,
        "title": esc(title),
        "desc": esc(desc),
        "canonical": f"{SITE_URL}/{path}",
        "robots": robots,
        "site_url": SITE_URL,
        "ver": VER,
        "year": YEAR,
        "logo": LOGO,
        "mega": mega_html(root),
        "drawer": drawer_html(root),
        "extra_head": extra_head,
        "jsonld": json.dumps(jsonld or {"@context": "https://schema.org", "@type": "WebPage", "name": title, "url": f"{SITE_URL}/{path}"}, ensure_ascii=False).replace("</", "<\\/"),
    }
    for key, slugs in FOOT.items():
        ctx[key] = "".join(f'<li><a href="{root}{s}/">{esc(BY_SLUG[s]["name"])}</a></li>' for s in slugs)
    for name in ICONS:
        ctx["i_" + name] = icon(name)
    return ctx


def build_tools():
    tpl = read(os.path.join(SRC, "templates", "tool.html"))
    root = "../"
    for t in TOOLS:
        url = f'{SITE_URL}/{t["slug"]}/'
        exts = []
        for part in t["accept"].split(","):
            part = part.strip()
            if part.startswith("."):
                e = part[1:].upper()
                if e == "JPEG":
                    continue
                exts.append(e)
        formats_html = "".join(f"<span>{e}</span>" for e in exts[:7])
        jsonld = {
            "@context": "https://schema.org",
            "@graph": [
                {
                    "@type": "WebApplication",
                    "name": f'{t["name"]} — YoPdfs',
                    "url": url,
                    "applicationCategory": "UtilitiesApplication",
                    "operatingSystem": "Any (runs in the browser)",
                    "description": t["desc"],
                    "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
                    "browserRequirements": "Requires JavaScript and a modern browser",
                },
                {
                    "@type": "HowTo",
                    "name": f'How to use {t["name"]}',
                    "step": [{"@type": "HowToStep", "position": i + 1, "text": s} for i, s in enumerate(t["steps"])],
                },
                {
                    "@type": "FAQPage",
                    "mainEntity": [
                        {"@type": "Question", "name": q, "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in t["faqs"]
                    ],
                },
                {
                    "@type": "BreadcrumbList",
                    "itemListElement": [
                        {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL + "/"},
                        {"@type": "ListItem", "position": 2, "name": t["name"], "item": url},
                    ],
                },
            ],
        }
        ctx = base_ctx(root, "tool", t["title"], t["desc"], f'{t["slug"]}/', jsonld=jsonld)
        ctx.update(
            {
                "slug": t["slug"],
                "name": esc(t["name"]),
                "h1": esc(t["h1"]),
                "sub": esc(t["sub"]),
                "primary": t["primary"],
                "cat_name": CAT_NAME[t["cats"][0]],
                "icon_svg": icon(t["icon"]),
                "accept": esc(t["accept"]),
                "multiple": "true" if t.get("multiple") else "false",
                "min_files": str(t.get("minFiles", 1)),
                "formats": esc(",".join(exts)),
                "formats_html": formats_html,
                "drop_word": "your files" if t.get("multiple") else "your file",
                "group": t["group"],
                "steps_html": "".join(f"<li>{esc(s)}</li>" for s in t["steps"]),
                "faq_html": "".join(f"<details><summary>{esc(q)}</summary><p>{esc(a)}</p></details>" for q, a in t["faqs"]),
                "related_html": "".join(tool_card(BY_SLUG[s], root) for s in t["related"]),
            }
        )
        write(os.path.join(ROOT, t["slug"], "index.html"), render(tpl, ctx))
    print(f"  {len(TOOLS)} tool pages")


def build_pages():
    pages_dir = os.path.join(SRC, "pages")
    built = []
    for name in sorted(os.listdir(pages_dir)):
        if not name.endswith(".html"):
            continue
        raw = read(os.path.join(pages_dir, name))
        m = re.match(r"\s*<!--meta\s*(\{.*?\})\s*-->\s*", raw, re.S)
        if not m:
            raise SystemExit(f"{name}: missing <!--meta {{...}} --> header")
        meta = json.loads(m.group(1))
        body = raw[m.end():]
        path = meta["path"]  # "" | "about/" | "404.html"
        if path == "404.html":
            root = BASE_PATH
        else:
            root = "../" * path.count("/")
        jsonld = meta.get("jsonld")
        if path == "":
            jsonld = {
                "@context": "https://schema.org",
                "@graph": [
                    {
                        "@type": "WebSite",
                        "name": "YoPdfs",
                        "url": SITE_URL + "/",
                        "potentialAction": {"@type": "SearchAction", "target": SITE_URL + "/?q={search_term_string}", "query-input": "required name=search_term_string"},
                    },
                    {"@type": "Organization", "name": "YoPdfs", "url": SITE_URL + "/", "logo": SITE_URL + "/assets/img/icon-512.png"},
                    {
                        "@type": "ItemList",
                        "name": "YoPdfs tools",
                        "itemListElement": [
                            {"@type": "ListItem", "position": i + 1, "name": t["name"], "url": f'{SITE_URL}/{t["slug"]}/'} for i, t in enumerate(TOOLS)
                        ],
                    },
                ],
            }
        ctx = base_ctx(root, meta.get("page", name[:-5]), meta["title"], meta["desc"], "" if path == "404.html" else path,
                       robots=meta.get("robots", "index,follow"), jsonld=jsonld, extra_head=meta.get("extra_head", ""))
        ctx["tool_cards"] = "".join(tool_card(t, root) for t in TOOLS)
        ctx["tool_count"] = str(len(TOOLS))
        for c in ["pdf", "image", "convert", "edit", "compress"]:
            ctx["count_" + c] = str(sum(1 for t in TOOLS if c in t["cats"]))
        doc = "{{> head}}\n{{> header}}\n" + body + "\n{{> footer}}\n{{> scripts}}\n" + "".join(
            f'<script src="{{{{root}}}}{s}?v={{{{ver}}}}" defer></script>\n' for s in meta.get("scripts", [])
        ) + "</body>\n</html>\n"
        out = os.path.join(ROOT, path if path.endswith(".html") else os.path.join(path, "index.html"))
        write(out, render(doc, ctx))
        if meta.get("sitemap", True) and path != "404.html":
            built.append((path, meta.get("priority", "0.6")))
    print(f"  {len(built)} content pages")
    return built


def build_registry():
    tools = [
        {k: t[k] for k in ("slug", "name", "short", "cats", "primary", "icon") if k in t} | ({"badge": t["badge"]} if t.get("badge") else {}) |
        ({"from": t["from"], "to": t["to"]} if t.get("from") else {}) | {"kw": t["title"] + " " + t["desc"]}
        for t in TOOLS
    ]
    js = (
        "/* generated by build.py — do not edit */\n"
        f"window.YP_SITE={json.dumps({'name': SITE['name'], 'url': SITE_URL, 'email': SITE['email']})};\n"
        f"window.YP_TOOLS={json.dumps(tools, ensure_ascii=False)};\n"
        f"window.YP_ICONS={json.dumps(ICONS)};\n"
    )
    write(os.path.join(ROOT, "assets", "js", "registry.js"), js)


def build_sitemap(pages):
    urls = [(f"{SITE_URL}/{p}", pr) for p, pr in pages]
    urls += [(f'{SITE_URL}/{t["slug"]}/', "0.9") for t in TOOLS]
    body = "".join(f"  <url><loc>{u}</loc><lastmod>{TODAY}</lastmod><priority>{pr}</priority></url>\n" for u, pr in urls)
    write(os.path.join(ROOT, "sitemap.xml"), f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n{body}</urlset>\n')
    write(os.path.join(ROOT, "robots.txt"), f"User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: {SITE_URL}/sitemap.xml\n")


if __name__ == "__main__":
    print("Building YoPdfs…")
    build_registry()
    build_tools()
    pages = build_pages()
    build_sitemap(pages)
    print("Done.")
