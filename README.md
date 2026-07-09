# Terms Changed?

A lightweight, **privacy-first Google Chrome extension (Manifest V3)** that lets
you watch important web pages and see **exactly what changed** since the last
saved version — privacy policies, terms of service, pricing pages, refund and
cancellation policies, job listings, university pages, SaaS docs, and product
pages. Everything is stored locally on your device; no page content, URLs, or
snapshots are ever sent to a server.

Developed by **aliaftabk**

## Features

* **Side panel UI** with five sections: **Current Page**, **Watched Pages**,
  **Change History**, **Settings**, and **Privacy**.
* **Watch any page** — extracts the readable text of the current tab (on your
  click) and saves a baseline snapshot locally.
* **Check for changes** — re-extracts the text, compares it against the saved
  baseline via a SHA-256 hash, and shows a clear diff when it differs.
* **Rich diff view** with tabs: **Summary**, **Added**, **Removed**, and
  **Full Diff** (added text in green, removed text struck through in red).
* **Important keyword alerts** grouped by category — **Money**, **Cancellation**,
  **Legal**, **Privacy**, **Access**, and **Deadlines**.
* **Update baseline** on demand — the baseline is *never* overwritten
  automatically; you accept a new version explicitly.
* **Change history** of past change events, each reopenable as a full diff.
* **Search & filter** watched pages by title, domain, and category.
* **Settings** — ignore whitespace / case / numbers, minimum change threshold,
  keyword highlighting, full-history storage, and one-click **Delete all data**.
* **Privacy-first**: no network calls, no analytics, no remote code, no CDN, no
  broad host permissions at install time.
* **Persistent state** via `chrome.storage.local` (metadata/settings) and
  **IndexedDB** (snapshot text and diffs) — your data survives Chrome restarts.
* **Robust edge-case handling**: restricted pages (`chrome://`, Chrome Web
  Store, `file://`), pages with no readable text, mismatched URLs, oversized
  snapshots, and failed script injection all show friendly messages.

## Installation (Load Unpacked in Chrome)

1. **Download / clone** this repository:
   ```bash
   git clone https://github.com/aliaftabk/terms-changed.git
   ```
   Or use **`< > Code` → Download ZIP** and unzip it — you'll get a folder
   containing `manifest.json`.
2. Open Chrome and go to `chrome://extensions`.
3. Toggle **Developer mode** on (top-right corner).
4. Click **Load unpacked**.
5. Select the project folder (the one that contains `manifest.json`).
6. The **Terms Changed?** icon appears in your toolbar. Pin it for quick access,
   then click it to open the side panel.

To update after pulling new changes, return to `chrome://extensions` and click
the **Reload** (↻) button on the Terms Changed? card.

## Usage

1. Click the toolbar icon to open the side panel, then click **Start watching
   pages** on the onboarding screen.
2. Visit a page you care about (e.g. a Terms of Service page).
3. In **Current Page**, optionally set a custom label and category, then click
   **Watch this page**. The readable text is extracted and saved as a baseline.
4. Later, revisit the page and click **Check for changes**.
   * If nothing changed, you'll see **No changes found**.
   * If it changed, you'll see the change percentage, words added/removed,
     keyword alerts, and a full diff.
5. Click **Update baseline** to accept the new version, or keep the old one.
6. Manage everything from **Watched Pages** (open, match current tab, delete) and
   **Change History** (reopen any past diff).

## Testing with the sample pages

The `samples/` folder contains a Terms of Service page before and after a change
(price, age requirement, data sharing, and an added arbitration clause). Chrome
does not read `file://` pages by default, so serve them over `http://`:

```bash
cd samples
python3 -m http.server 8000
```

Quick same-URL change test:

```bash
cd samples
cp sample-terms-v1.html live.html      # serve + watch http://localhost:8000/live.html
cp sample-terms-v2.html live.html      # simulate the page changing
# reload the tab, then click "Check for changes"
```

You should see keyword alerts for **Money**, **Access**, **Privacy**, and
**Legal**, plus a full diff. You can also watch any real Terms/Privacy page on
the web and re-check it later.

## File Structure

```
terms-changed/
├── manifest.json               # Manifest V3 definition
├── src/
│   ├── background/
│   │   └── service_worker.js   # Opens the side panel; optional alarm scaffolding
│   ├── lib/                    # Core logic (scripts)
│   │   ├── extractor.js        # Readable-text extraction (injected into the page)
│   │   ├── diff.js             # Local paragraph + word-level diff algorithm
│   │   ├── storage.js          # chrome.storage.local + IndexedDB persistence
│   │   ├── hash.js             # SHA-256 hashing (crypto.subtle)
│   │   └── utils.js            # URL normalization, escaping, keyword detection
│   └── sidepanel/              # User interface
│       ├── sidepanel.html
│       ├── sidepanel.css       # Light + dark theme via CSS variables
│       └── sidepanel.js        # UI orchestration
├── icons/
│   ├── icon16.png
│   ├── icon32.png
│   ├── icon48.png
│   └── icon128.png
├── tools/
│   └── gen_icons.py            # optional: regenerates the icons (no dependencies)
├── samples/
│   ├── sample-terms-v1.html
│   └── sample-terms-v2.html
├── LICENSE
├── privacy-policy.md
└── README.md
```

## Technologies Used

* **Manifest V3** Chrome extension APIs (`sidePanel`, `scripting`, `activeTab`,
  `storage`)
* **Plain HTML, CSS, and JavaScript (ES modules)** — no frameworks, no build step
* **`chrome.scripting.executeScript`** for user-triggered page text extraction
* **Web Crypto (`crypto.subtle`)** for SHA-256 change detection
* **`chrome.storage.local` + IndexedDB** for local-only persistence

## How Extraction Works

When you click a button, the extension injects `extractPageContent` (from
`src/lib/extractor.js`) into the active tab via `chrome.scripting.executeScript`.
It clones the page body, strips scripts/nav/ads/hidden elements, prefers readable
containers (`main`, `article`, `.content`, `.policy`, `.terms`, …), collects text
from headings, paragraphs, lists, tables, and blockquotes, normalizes whitespace,
and returns the clean text plus metadata. Extraction only runs on your action —
never automatically in the background.

## How Diffing Works

The stored baseline and current text are normalized (per your settings) and
hashed with SHA-256. If the hashes match, nothing changed. Otherwise `diff.js`
splits both versions into paragraphs, runs a Longest Common Subsequence to find
added/removed/unchanged blocks, and performs a word-level diff on changed
paragraphs. All page-derived text is HTML-escaped before rendering, so raw page
HTML is never injected into the UI.

## Privacy

See [`privacy-policy.md`](./privacy-policy.md). In short: watched page URLs and
page text are stored **locally**; nothing is sent to a server; nothing is sold
or shared; there is no advertising or tracking; and you can delete all data from
**Settings → Delete all local data**.

## Publishing to the Chrome Web Store

1. Zip the package (you may exclude `samples/` and `tools/`):
   ```bash
   zip -r terms-changed.zip manifest.json src icons LICENSE README.md privacy-policy.md
   ```
2. Upload it in the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   via **Add new item**.
3. Declare privacy practices (data stored locally, not sold/shared) and justify
   permissions: `activeTab` + `scripting` (read current page on user action),
   `storage` (local persistence), `sidePanel` (UI). Broad host access is **not**
   requested at install time.

## Contributing

Contributions are welcome!

1. Fork the repository.
2. Create a feature branch: `git checkout -b feature/my-improvement`.
3. Make your changes. Keep it dependency-free and Manifest V3 compliant.
4. Test by loading the unpacked extension in Chrome (`chrome://extensions`).
5. Commit with a clear message and open a Pull Request describing what and why.

Please keep the UI clean and accessible, and avoid adding unnecessary permissions
to `manifest.json`.

## Author

**aliaftabk** — github.com/aliaftabk

## License

Released under the MIT License. You are free to use, modify, and distribute this
project.

Copyright (c) 2026 aliaftabk.
