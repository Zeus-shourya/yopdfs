# YoPdfs

Premium, privacy-first PDF & image tools — 25 tools that run entirely in the
browser. Light/neon design built on the `lo.pdf` palette (violet `#541388`,
magenta `#D90368`, cream `#F1E9DA`, navy `#2E294E`, periwinkle `#9DACFF`).

## Run locally

```powershell
py server.py          # http://localhost:4431  (admin key printed in the console)
```

`server.py` serves the site **and** the accounts/data API, writing everything to
`data/YoPdfs-Data.xlsx` (Users, Logins, ToolUsage, Contact, Newsletter, Waitlist).
For the live site (GitHub Pages) use the Google Sheets backend — see
[`backend/SETUP.md`](backend/SETUP.md).

## Edit content / rebuild

Pages are generated from `src/` — edit there, then:

```powershell
py build.py
```

| File | What it controls |
| --- | --- |
| `src/tools.json` | Every tool: name, SEO title/description, FAQs, steps, related tools |
| `src/site.json` | Site name and canonical URL (change `url` when you get a domain) |
| `src/pages/*.html` | Home, About, Contact, Pricing, Privacy, Terms, Account, Admin, 404 |
| `src/partials/*` | Shared `<head>`, header (mega menu), footer |
| `assets/js/config.js` | Backend URL, plans/limits, ads, analytics — **no rebuild needed** |
| `assets/css/app.css` | Design system (light + dark) |

## Tools and engines

| Group | Tools | Engine (all in-browser) |
| --- | --- | --- |
| `pdf-basic.js` | JPG/PNG→PDF, PDF→JPG/PNG, Merge, Split, Compress, Rotate, Watermark, Page numbers | pdf-lib, PDF.js |
| `pdf-secure.js` | Protect (AES-256), Unlock | qpdf (WebAssembly) |
| `pdf-edit.js` | Edit PDF (text, draw, highlight, shapes, white-out, images, signature) | PDF.js + Fabric.js + pdf-lib |
| `office.js` | Word→PDF, PDF→Word, Excel→PDF, PDF→Excel | docx-preview + html2canvas + jsPDF, SheetJS, jsPDF-AutoTable |
| `image.js` | Compressor, Resizer, Cropper, JPG→PNG, PNG→JPG | Canvas, Cropper.js |
| `ai.js` | Background remover, Passport photo maker, OCR | @imgly/background-removal, Tesseract.js |

Libraries are vendored in `assets/vendor/` (no CDN needed), except the
background-removal model and OCR language data, which download once on first use.

## Folder notes

* `data/` — private user data written by `server.py`; git-ignored, never publish.
* `dev/` — dev helpers (`make-images.ps1` regenerates icons + social image;
  `test-helpers.js` is used for in-browser testing and is not loaded by the site).
