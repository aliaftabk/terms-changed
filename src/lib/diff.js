// diff.js
// A simple, local text diff implementation. No external libraries.
//
// Strategy:
//   1. Split both texts into paragraphs.
//   2. Run a Longest Common Subsequence (LCS) over paragraphs to find
//      added / removed / unchanged blocks.
//   3. For visually changed regions, run an optional word-level diff.
//   4. Return structured results plus HTML-safe rendered diff pieces.
//
// SECURITY: All page-derived text is escaped via escapeHtml before it is
// placed into any HTML string. We never inject raw page HTML.

import { escapeHtml, splitParagraphs, countWords, detectKeywordAlerts } from "./utils.js";

/**
 * Compute the LCS matrix and backtrack an edit script for two arrays.
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Array<{type: 'equal'|'add'|'remove', value: string}>}
 */
function lcsDiff(a, b) {
  const n = a.length;
  const m = b.length;

  // Build LCS length table. For very large inputs this could be heavy,
  // so callers should guard on size before rendering a full diff.
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const script = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      script.push({ type: "equal", value: a[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      script.push({ type: "remove", value: a[i] });
      i++;
    } else {
      script.push({ type: "add", value: b[j] });
      j++;
    }
  }
  while (i < n) {
    script.push({ type: "remove", value: a[i] });
    i++;
  }
  while (j < m) {
    script.push({ type: "add", value: b[j] });
    j++;
  }
  return script;
}

/**
 * Word-level diff between two strings, returned as HTML-safe markup.
 * @param {string} oldStr
 * @param {string} newStr
 * @returns {string} HTML string with .diff-added / .diff-removed spans
 */
function wordDiffHtml(oldStr, newStr) {
  const aWords = String(oldStr).split(/(\s+)/);
  const bWords = String(newStr).split(/(\s+)/);
  const script = lcsDiff(aWords, bWords);

  let html = "";
  for (const part of script) {
    const safe = escapeHtml(part.value);
    if (part.type === "equal") {
      html += safe;
    } else if (part.type === "add") {
      html += `<span class="diff-added">${safe}</span>`;
    } else {
      html += `<span class="diff-removed">${safe}</span>`;
    }
  }
  return html;
}

// Guard rail: paragraph counts above this make a full LCS too expensive.
const MAX_PARAGRAPHS_FOR_FULL_DIFF = 1200;

/**
 * Produce a structured diff of two text snapshots.
 * @param {string} oldText - the baseline text (already normalized)
 * @param {string} newText - the current text (already normalized)
 * @param {object} options
 * @param {boolean} [options.wordLevel=true] - run word diff on changed regions
 * @returns {{
 *   addedParagraphs: string[],
 *   removedParagraphs: string[],
 *   unchangedCount: number,
 *   addedWordCount: number,
 *   removedWordCount: number,
 *   changePercentage: number,
 *   importantAlerts: Array<{category:string, keywords:string[]}>,
 *   htmlSafeDiff: string,
 *   truncated: boolean
 * }}
 */
export function diffText(oldText, newText, options = {}) {
  const wordLevel = options.wordLevel !== false;

  const oldParas = splitParagraphs(oldText);
  const newParas = splitParagraphs(newText);

  const addedParagraphs = [];
  const removedParagraphs = [];
  let unchangedCount = 0;
  let addedWordCount = 0;
  let removedWordCount = 0;

  const truncated =
    oldParas.length + newParas.length > MAX_PARAGRAPHS_FOR_FULL_DIFF;

  let htmlSafeDiff = "";

  if (truncated) {
    // Too large for a full paragraph LCS: fall back to a set comparison
    // so we can still report summary numbers cheaply.
    const oldSet = new Set(oldParas);
    const newSet = new Set(newParas);
    for (const p of newParas) {
      if (!oldSet.has(p)) {
        addedParagraphs.push(p);
        addedWordCount += countWords(p);
      } else {
        unchangedCount++;
      }
    }
    for (const p of oldParas) {
      if (!newSet.has(p)) {
        removedParagraphs.push(p);
        removedWordCount += countWords(p);
      }
    }
    htmlSafeDiff =
      '<p class="diff-note">This page changed too much to display a full ' +
      "diff. Showing summary only.</p>";
  } else {
    const script = lcsDiff(oldParas, newParas);

    // Pair adjacent remove+add blocks so we can render word-level changes.
    for (let idx = 0; idx < script.length; idx++) {
      const part = script[idx];
      if (part.type === "equal") {
        unchangedCount++;
        htmlSafeDiff += `<p class="diff-context">${escapeHtml(part.value)}</p>`;
        continue;
      }

      if (part.type === "remove") {
        const next = script[idx + 1];
        if (wordLevel && next && next.type === "add") {
          // Changed paragraph: render an inline word-level diff.
          removedParagraphs.push(part.value);
          addedParagraphs.push(next.value);
          removedWordCount += countWords(part.value);
          addedWordCount += countWords(next.value);
          htmlSafeDiff += `<p class="diff-changed">${wordDiffHtml(
            part.value,
            next.value
          )}</p>`;
          idx++; // consume the paired add
          continue;
        }
        removedParagraphs.push(part.value);
        removedWordCount += countWords(part.value);
        htmlSafeDiff += `<p class="diff-removed-block"><span class="diff-removed">${escapeHtml(
          part.value
        )}</span></p>`;
        continue;
      }

      // Pure addition.
      addedParagraphs.push(part.value);
      addedWordCount += countWords(part.value);
      htmlSafeDiff += `<p class="diff-added-block"><span class="diff-added">${escapeHtml(
        part.value
      )}</span></p>`;
    }
  }

  const totalOldWords = countWords(oldText) || 1;
  const changedWords = addedWordCount + removedWordCount;
  const changePercentage = Math.min(
    100,
    Math.round((changedWords / totalOldWords) * 1000) / 10
  );

  const importantAlerts = detectKeywordAlerts(
    addedParagraphs.join("\n") + "\n" + removedParagraphs.join("\n")
  );

  return {
    addedParagraphs,
    removedParagraphs,
    unchangedCount,
    addedWordCount,
    removedWordCount,
    changePercentage,
    importantAlerts,
    htmlSafeDiff,
    truncated,
  };
}
