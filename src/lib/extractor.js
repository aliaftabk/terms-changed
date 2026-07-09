// extractor.js
// Readable-text extraction that runs INSIDE the target web page.
//
// IMPORTANT: `extractPageContent` is injected via
// chrome.scripting.executeScript({ func: extractPageContent }). Because the
// function body is serialized and run in the page's world, it must be fully
// self-contained: it may NOT reference imports, module-scope variables, or
// anything outside its own body.

/**
 * Extract readable text from the current document.
 * Runs in the page context.
 * @returns {{
 *   title: string,
 *   url: string,
 *   canonicalUrl: string|null,
 *   domain: string,
 *   extractedText: string,
 *   wordCount: number,
 *   extractedAt: number,
 *   extractionWarnings: string[]
 * }}
 */
export function extractPageContent() {
  const warnings = [];

  // Tags whose content is not meaningful body text.
  const STRIP_TAGS = [
    "script",
    "style",
    "noscript",
    "iframe",
    "svg",
    "canvas",
    "nav",
    "footer",
    "header",
    "form",
    "button",
    "input",
    "textarea",
    "select",
    "aside",
    "template",
    "video",
    "audio",
    "map",
    "object",
    "embed",
  ];

  // Selectors that commonly wrap ads, banners, and modals.
  const STRIP_SELECTORS = [
    "[aria-hidden='true']",
    "[role='dialog']",
    "[role='banner']",
    "[role='navigation']",
    "[role='complementary']",
    ".advertisement",
    ".ad",
    ".ads",
    ".cookie",
    ".cookie-banner",
    ".cookie-consent",
    ".consent",
    ".modal",
    ".popup",
    ".newsletter",
    ".subscribe",
    ".social-share",
    ".breadcrumb",
    ".sidebar",
    ".menu",
  ];

  // Preferred readable containers, in priority order.
  const PREFERRED = [
    "main",
    "article",
    "[role='main']",
    ".content",
    ".post",
    ".entry-content",
    ".policy",
    ".terms",
  ];

  function isHidden(el) {
    try {
      const style = window.getComputedStyle(el);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return true;
      }
      // Elements with zero rendered size are usually not real content.
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0 && el.offsetParent === null) {
        // Still could be content that's just scrolled off; only treat truly
        // collapsed elements as hidden.
        if (style.height === "0px" || style.maxHeight === "0px") return true;
      }
    } catch (err) {
      /* ignore */
    }
    return false;
  }

  // Pick the best root element to read from.
  let root = null;
  for (const selector of PREFERRED) {
    const candidate = document.querySelector(selector);
    if (candidate && candidate.innerText && candidate.innerText.trim().length > 200) {
      root = candidate;
      break;
    }
  }
  if (!root) {
    root = document.body;
    if (root) warnings.push("no-preferred-container");
  }
  if (!root) {
    return {
      title: document.title || "",
      url: location.href,
      canonicalUrl: null,
      domain: location.hostname,
      extractedText: "",
      wordCount: 0,
      extractedAt: Date.now(),
      extractionWarnings: ["no-body"],
    };
  }

  // Work on a clone so we never mutate the live page.
  const clone = root.cloneNode(true);

  // Remove unwanted tags.
  for (const tag of STRIP_TAGS) {
    clone.querySelectorAll(tag).forEach((el) => el.remove());
  }
  // Remove unwanted selectors (ads/banners/modals).
  for (const selector of STRIP_SELECTORS) {
    try {
      clone.querySelectorAll(selector).forEach((el) => el.remove());
    } catch (err) {
      /* invalid selector in some engines; ignore */
    }
  }

  // Remove elements that are hidden in the live DOM. We look them up in the
  // original tree because computed styles do not apply to detached clones.
  try {
    const liveNodes = root.querySelectorAll("*");
    const cloneNodes = clone.querySelectorAll("*");
    // Best-effort: only when the trees are still aligned in length.
    if (liveNodes.length === cloneNodes.length) {
      for (let i = 0; i < liveNodes.length; i++) {
        if (isHidden(liveNodes[i]) && cloneNodes[i]) {
          cloneNodes[i].remove();
        }
      }
    }
  } catch (err) {
    /* ignore alignment issues */
  }

  // Collect text from meaningful block elements, preserving paragraph breaks.
  const BLOCK_SELECTOR =
    "h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,td,th,dd,dt,figcaption";
  const blocks = clone.querySelectorAll(BLOCK_SELECTOR);

  const lines = [];
  if (blocks.length > 0) {
    blocks.forEach((el) => {
      const text = (el.innerText || el.textContent || "").trim();
      if (text) lines.push(text);
    });
  } else {
    // Fallback: use the whole clone's text.
    const text = (clone.innerText || clone.textContent || "").trim();
    if (text) lines.push(text);
    warnings.push("block-fallback");
  }

  // Normalize whitespace and collapse repeated blank lines.
  let extractedText = lines
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").replace(/\s*\n\s*/g, "\n").trim())
    .filter((line) => line.length > 0)
    .join("\n\n");

  extractedText = extractedText.replace(/\n{3,}/g, "\n\n").trim();

  if (!extractedText || extractedText.length < 20) {
    warnings.push("low-text");
  }

  // Canonical URL if present.
  let canonicalUrl = null;
  const canonicalLink = document.querySelector("link[rel='canonical']");
  if (canonicalLink && canonicalLink.href) {
    canonicalUrl = canonicalLink.href;
  }

  const wordCount = (extractedText.match(/\S+/g) || []).length;

  return {
    title: document.title || "",
    url: location.href,
    canonicalUrl,
    domain: location.hostname,
    extractedText,
    wordCount,
    extractedAt: Date.now(),
    extractionWarnings: warnings,
  };
}
