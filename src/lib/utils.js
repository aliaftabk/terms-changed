// utils.js
// Shared helper utilities for the "Terms Changed?" extension.
// Plain ES module: no external dependencies.

/**
 * Escape a string so it is safe to insert into HTML.
 * We NEVER insert raw page HTML into the UI; all page-derived text
 * must pass through this function first.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generate a reasonably unique id without external libraries.
 * @returns {string}
 */
export function generateId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return (
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 10)
  );
}

// Common tracking parameters that carry no page-content meaning.
const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "gclid",
  "fbclid",
  "mc_cid",
  "mc_eid",
  "_hsenc",
  "_hsmi",
  "igshid",
];

/**
 * Normalize a URL for stable comparison and storage.
 * - Removes the hash fragment.
 * - Removes common tracking query parameters.
 * - Lowercases protocol and hostname.
 * - Removes a trailing slash when safe (path only, no query).
 * Meaningful query parameters are preserved.
 * @param {string} rawUrl
 * @returns {string}
 */
export function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    url.hash = "";

    for (const param of TRACKING_PARAMS) {
      url.searchParams.delete(param);
    }
    // Keep the params sorted so equivalent URLs match regardless of order.
    url.searchParams.sort();

    let normalized = url.toString();

    // Remove a trailing slash only when there is no query string,
    // and only when the path is more than just "/".
    if (!url.search && url.pathname !== "/" && normalized.endsWith("/")) {
      normalized = normalized.slice(0, -1);
    }
    return normalized;
  } catch (err) {
    // If the URL cannot be parsed, return it unchanged.
    return rawUrl || "";
  }
}

/**
 * Extract the domain (hostname) from a URL.
 * @param {string} rawUrl
 * @returns {string}
 */
export function getDomain(rawUrl) {
  try {
    return new URL(rawUrl).hostname.toLowerCase();
  } catch (err) {
    return "";
  }
}

/**
 * Determine whether a URL is one the extension can inject scripts into.
 * Restricted pages include chrome://, chrome-extension://, edge://, about:,
 * the Chrome Web Store, and view-source: pages.
 * @param {string} rawUrl
 * @returns {boolean}
 */
export function isRestrictedUrl(rawUrl) {
  if (!rawUrl) return true;
  const lower = rawUrl.toLowerCase();
  const restrictedSchemes = [
    "chrome://",
    "chrome-extension://",
    "edge://",
    "about:",
    "view-source:",
    "devtools://",
    "chrome-search://",
    "chrome-untrusted://",
    "moz-extension://",
    "file://",
  ];
  if (restrictedSchemes.some((scheme) => lower.startsWith(scheme))) {
    return true;
  }
  // The Chrome Web Store blocks content scripts.
  if (
    lower.startsWith("https://chrome.google.com/webstore") ||
    lower.startsWith("https://chromewebstore.google.com")
  ) {
    return true;
  }
  return false;
}

/**
 * Normalize page text according to the user's comparison settings.
 * Used before hashing and diffing so equivalent text produces equal hashes.
 * @param {string} text
 * @param {object} settings
 * @returns {string}
 */
export function normalizeTextForCompare(text, settings = {}) {
  let out = String(text || "");

  if (settings.ignoreCase) {
    out = out.toLowerCase();
  }
  if (settings.ignoreNumbers) {
    // Replace runs of digits (and common separators) with a placeholder.
    out = out.replace(/\d[\d.,:/-]*/g, "#");
  }
  if (settings.ignoreWhitespace) {
    // Collapse all whitespace runs to a single space and trim lines.
    out = out
      .split(/\n+/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line.length > 0)
      .join("\n");
  }
  return out;
}

/**
 * Count words in a block of text.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
  if (!text) return 0;
  const matches = String(text).trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/**
 * Split text into paragraphs on blank lines / newlines.
 * @param {string} text
 * @returns {string[]}
 */
export function splitParagraphs(text) {
  if (!text) return [];
  return String(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Format a timestamp (ms) into a short human-readable string.
 * @param {number|null|undefined} ts
 * @returns {string}
 */
export function formatDate(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (err) {
    return "—";
  }
}

/**
 * Format a timestamp as a relative "time ago" string.
 * @param {number|null|undefined} ts
 * @returns {string}
 */
export function timeAgo(ts) {
  if (!ts) return "never";
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const days = Math.round(hr / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} mo ago`;
  return `${Math.round(months / 12)} yr ago`;
}

// Categories of "important" keywords the extension watches for in diffs.
export const KEYWORD_CATEGORIES = {
  Money: [
    "price",
    "fee",
    "cost",
    "charge",
    "billing",
    "payment",
    "subscription",
    "pricing",
    "invoice",
    "surcharge",
  ],
  Cancellation: [
    "cancel",
    "cancellation",
    "renewal",
    "auto-renew",
    "auto renew",
    "renew",
    "refund",
    "return",
    "termination",
  ],
  Legal: [
    "arbitration",
    "dispute",
    "liability",
    "warranty",
    "indemnify",
    "indemnity",
    "governing law",
    "class action",
    "waiver",
  ],
  Privacy: [
    "collect",
    "share",
    "sell",
    "tracking",
    "cookies",
    "cookie",
    "data",
    "third party",
    "third-party",
    "personal information",
  ],
  Access: [
    "account",
    "suspend",
    "terminate",
    "eligibility",
    "restriction",
    "ban",
    "revoke",
    "deactivate",
  ],
  Deadlines: [
    "deadline",
    "expires",
    "expiry",
    "effective date",
    "notice period",
    "within",
    "days",
    "prior notice",
  ],
};

/**
 * Scan changed text for important keywords and group hits by category.
 * @param {string} text - Combined added/removed text to scan.
 * @returns {Array<{category: string, keywords: string[]}>}
 */
export function detectKeywordAlerts(text) {
  const lower = String(text || "").toLowerCase();
  const alerts = [];
  for (const [category, words] of Object.entries(KEYWORD_CATEGORIES)) {
    const found = new Set();
    for (const word of words) {
      // Word-boundary-ish match; keep it simple and safe.
      const re = new RegExp(
        `(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`,
        "i"
      );
      if (re.test(lower)) {
        found.add(word);
      }
    }
    if (found.size > 0) {
      alerts.push({ category, keywords: Array.from(found) });
    }
  }
  return alerts;
}

/**
 * Truncate a string to a maximum length with an ellipsis.
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
export function truncate(text, max = 80) {
  const s = String(text || "");
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
