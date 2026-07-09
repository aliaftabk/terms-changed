// sidepanel.js
// Orchestrates the side panel UI. Uses only local browser APIs + our own
// ES modules. No network access anywhere.

import { extractPageContent } from "../lib/extractor.js";
import { sha256 } from "../lib/hash.js";
import { diffText } from "../lib/diff.js";
import {
  escapeHtml,
  generateId,
  normalizeUrl,
  getDomain,
  isRestrictedUrl,
  normalizeTextForCompare,
  formatDate,
  timeAgo,
  truncate,
} from "../lib/utils.js";
import * as store from "../lib/storage.js";

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
const state = {
  tab: null, // active chrome.tabs.Tab
  normalizedUrl: "",
  page: null, // watched-page record for the current tab (or null)
  settings: null,
  lastResult: null, // { diff, historyId, page } from the most recent check
};

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", init);

async function init() {
  state.settings = await store.getSettings();
  wireStaticEvents();

  const onboarded = await store.isOnboarded();
  if (!onboarded) {
    show("onboarding");
    return;
  }
  show("app");
  await refreshCurrentTab();
}

function show(which) {
  $("onboarding").classList.toggle("hidden", which !== "onboarding");
  $("app").classList.toggle("hidden", which !== "app");
  $("onboarding").setAttribute("aria-hidden", which !== "onboarding");
}

// ---------------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------------
function wireStaticEvents() {
  $("onboarding-start").addEventListener("click", async () => {
    await store.setOnboarded(true);
    show("app");
    await refreshCurrentTab();
  });

  // Top-level tab navigation
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  // Current page actions
  $("btn-watch").addEventListener("click", onWatch);
  $("btn-check").addEventListener("click", onCheck);
  $("btn-update-baseline").addEventListener("click", onUpdateBaseline);
  $("btn-stop").addEventListener("click", onStopWatching);
  $("btn-open-diff").addEventListener("click", () => {
    if (state.lastResult) openDiffView(state.lastResult.page, state.lastResult.diff);
  });

  // Watched filters
  $("watched-search").addEventListener("input", renderWatched);
  $("watched-filter-category").addEventListener("change", renderWatched);

  // Settings
  wireSettingsEvents();
  $("btn-delete-all").addEventListener("click", onDeleteAll);
  $("btn-delete-all-2").addEventListener("click", onDeleteAll);

  // Diff view
  $("diff-back").addEventListener("click", closeDiffView);
  document.querySelectorAll(".subtab").forEach((st) => {
    st.addEventListener("click", () => switchDiffTab(st.dataset.difftab));
  });

  // Confirm dialog
  $("confirm-cancel").addEventListener("click", () => resolveConfirm(false));
  $("confirm-ok").addEventListener("click", () => resolveConfirm(true));

  // Refresh the current tab info when the panel regains focus.
  window.addEventListener("focus", () => {
    if (!$("app").classList.contains("hidden")) refreshCurrentTab();
  });
}

function switchView(view) {
  document.querySelectorAll(".tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === view);
  });
  document.querySelectorAll(".view").forEach((v) => {
    v.classList.toggle("active", v.id === `view-${view}`);
  });
  if (view === "watched") renderWatched();
  if (view === "history") renderHistory();
  if (view === "settings") renderSettings();
}

// ---------------------------------------------------------------------------
// Current tab handling
// ---------------------------------------------------------------------------
async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs && tabs[0] ? tabs[0] : null;
}

async function refreshCurrentTab() {
  hide($("check-result"));
  hide($("current-message"));
  state.lastResult = null;

  const tab = await getActiveTab();
  state.tab = tab;

  if (!tab || !tab.url) {
    $("current-title").textContent = "No active tab";
    $("current-url").textContent = "";
    setBadge("current-badge", "muted", "—");
    hideAllCurrentButtons();
    return;
  }

  state.normalizedUrl = normalizeUrl(tab.url);
  $("current-title").textContent = tab.title || "(untitled page)";
  $("current-url").textContent = tab.url;

  state.page = await store.findPageByNormalizedUrl(state.normalizedUrl);

  if (isRestrictedUrl(tab.url)) {
    setBadge("current-badge", "error", "Restricted");
    hideAllCurrentButtons();
    showMessage(
      "current-message",
      "info",
      "Chrome does not allow extensions to read this page."
    );
    return;
  }

  if (state.page) {
    renderWatchedCurrent();
  } else {
    renderUnwatchedCurrent();
  }
}

function hideAllCurrentButtons() {
  ["btn-watch", "btn-check", "btn-update-baseline", "btn-stop"].forEach((id) =>
    hide($(id))
  );
  hide($("watch-form"));
  hide($("current-status-block"));
  hide($("current-not-watched"));
}

function renderUnwatchedCurrent() {
  setBadge("current-badge", "muted", "Not watched");
  hide($("current-status-block"));
  show($("current-not-watched"));
  show($("watch-form"));
  // Prefill label with the page title.
  $("watch-label").value = "";
  $("watch-label").placeholder = truncate(state.tab.title || "", 50);

  showBtn("btn-watch");
  hide($("btn-check"));
  hide($("btn-update-baseline"));
  hide($("btn-stop"));
}

function renderWatchedCurrent() {
  const p = state.page;
  setBadge("current-badge", statusToBadge(p.status), statusLabel(p.status));
  hide($("current-not-watched"));
  hide($("watch-form"));

  show($("current-status-block"));
  $("current-last-checked").textContent = formatDate(p.lastCheckedAt);
  $("current-last-changed").textContent = formatDate(p.lastChangedAt);
  $("current-status").textContent = statusLabel(p.status);

  hide($("btn-watch"));
  showBtn("btn-check");
  showBtn("btn-update-baseline");
  showBtn("btn-stop");
}

// ---------------------------------------------------------------------------
// Extraction (runs the extractor inside the page)
// ---------------------------------------------------------------------------
async function extractFromActiveTab() {
  if (!state.tab || !state.tab.id) {
    throw new AppError("There is no active tab to read.");
  }
  if (isRestrictedUrl(state.tab.url)) {
    throw new AppError("Chrome does not allow extensions to read this page.");
  }

  let injection;
  try {
    injection = await chrome.scripting.executeScript({
      target: { tabId: state.tab.id },
      func: extractPageContent,
    });
  } catch (err) {
    throw new AppError(
      "Script injection failed. Try reloading the page, then check again."
    );
  }

  if (!injection || !injection[0] || !injection[0].result) {
    throw new AppError("Could not read this page. Try reloading it.");
  }

  const data = injection[0].result;
  if (!data.extractedText || data.extractedText.trim().length < 20) {
    throw new AppError(
      "No readable text found. This page may require login or its content " +
        "loads dynamically. Try scrolling to load the content, then check again."
    );
  }
  return data;
}

// ---------------------------------------------------------------------------
// Watch this page
// ---------------------------------------------------------------------------
async function onWatch() {
  hide($("current-message"));
  const btn = $("btn-watch");
  btn.disabled = true;
  btn.textContent = "Reading page…";

  try {
    const data = await extractFromActiveTab();
    const normalized = normalizeUrl(data.url);
    const compareText = normalizeTextForCompare(data.extractedText, state.settings);
    const textHash = await sha256(compareText);
    const now = Date.now();

    const label = $("watch-label").value.trim();
    const category = $("watch-category").value || "Other";

    const page = {
      id: generateId(),
      originalUrl: data.url,
      normalizedUrl: normalized,
      domain: data.domain || getDomain(data.url),
      pageTitle: data.title || state.tab.title || "(untitled)",
      textHash,
      createdAt: now,
      lastCheckedAt: now,
      lastChangedAt: null,
      wordCount: data.wordCount,
      userLabel: label,
      category,
      status: "no-change",
      history: [],
      autoCheckEnabled: false,
      canonicalUrl: data.canonicalUrl || null,
    };

    await store.savePage(page);
    await store.saveSnapshot(page.id, data.extractedText);

    state.page = page;
    renderWatchedCurrent();
    toast("Page saved. You're now watching this page.");
    showMessage("current-message", "success", "This page is now being watched.");
  } catch (err) {
    showMessage("current-message", "error", errText(err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Watch this page";
  }
}

// ---------------------------------------------------------------------------
// Check for changes
// ---------------------------------------------------------------------------
async function onCheck() {
  if (!state.page) return;
  hide($("current-message"));
  hide($("check-result"));
  const btn = $("btn-check");
  btn.disabled = true;
  btn.textContent = "Checking…";

  try {
    const data = await extractFromActiveTab();
    const compareText = normalizeTextForCompare(data.extractedText, state.settings);
    const newHash = await sha256(compareText);
    const now = Date.now();

    state.page.lastCheckedAt = now;
    state.page.wordCount = data.wordCount;

    if (newHash === state.page.textHash) {
      state.page.status = "no-change";
      await store.savePage(state.page);
      renderWatchedCurrent();
      showMessage("current-message", "success", "No changes found.");
      return;
    }

    // Something changed — build a diff against the stored baseline.
    const baselineText = await store.getSnapshot(state.page.id);
    const baseCompare = normalizeTextForCompare(baselineText, state.settings);
    const currCompare = compareText;

    const diff = diffText(baseCompare, currCompare, {
      wordLevel: true,
    });

    // Respect the minimum change threshold.
    const threshold = Number(state.settings.minChangeThreshold) || 0;
    if (diff.changePercentage < threshold) {
      state.page.status = "no-change";
      await store.savePage(state.page);
      renderWatchedCurrent();
      showMessage(
        "current-message",
        "info",
        `Change of ${diff.changePercentage}% is below your ${threshold}% ` +
          "threshold. Treating as no change."
      );
      return;
    }

    state.page.status = "changed";
    state.page.lastChangedAt = now;

    // Persist a history record.
    const historyId = generateId();
    const record = {
      historyId,
      pageId: state.page.id,
      pageTitle: state.page.userLabel || state.page.pageTitle,
      domain: state.page.domain,
      checkedAt: now,
      changePercentage: diff.changePercentage,
      addedWordCount: diff.addedWordCount,
      removedWordCount: diff.removedWordCount,
      alerts: diff.importantAlerts,
      addedParagraphs: diff.addedParagraphs,
      removedParagraphs: diff.removedParagraphs,
      htmlSafeDiff: diff.htmlSafeDiff,
      truncated: diff.truncated,
      // The "new" text is kept so the user can later inspect / update baseline.
      newText: data.extractedText,
    };
    await store.addHistory(record);

    state.page.history = state.page.history || [];
    state.page.history.unshift({
      historyId,
      checkedAt: now,
      changePercentage: diff.changePercentage,
    });
    await store.savePage(state.page);

    // Prune history if the user hasn't opted into full history.
    if (!state.settings.storeFullHistory) {
      await pruneHistoryForPage(state.page.id, historyId);
      state.page.history = state.page.history.slice(0, 1);
      await store.savePage(state.page);
    }

    state.lastResult = { diff, historyId, page: state.page };

    renderWatchedCurrent();
    renderCheckResult(state.page, diff);
    toast("Changes detected on this page.");
  } catch (err) {
    state.page.status = "error";
    await store.savePage(state.page);
    renderWatchedCurrent();
    showMessage("current-message", "error", errText(err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Check for changes";
  }
}

// When "Store full history" is off we keep only the newest change record
// per page, deleting the rest to save space.
async function pruneHistoryForPage(pageId, keepHistoryId) {
  const all = await store.getAllHistory();
  for (const rec of all) {
    if (rec.pageId === pageId && rec.historyId !== keepHistoryId) {
      await store.deleteHistoryById(rec.historyId);
    }
  }
}

function renderCheckResult(page, diff) {
  const el = $("check-result-body");
  el.innerHTML = "";
  el.appendChild(buildSummaryNode(diff));
  show($("check-result"));
  showBtn("btn-open-diff");
}

// ---------------------------------------------------------------------------
// Update baseline
// ---------------------------------------------------------------------------
async function onUpdateBaseline() {
  if (!state.page) return;
  const ok = await showConfirm(
    "Update baseline?",
    "Future checks will compare against the current version of this page.",
    "Update baseline"
  );
  if (!ok) return;

  const btn = $("btn-update-baseline");
  btn.disabled = true;
  btn.textContent = "Updating…";
  try {
    const data = await extractFromActiveTab();
    const compareText = normalizeTextForCompare(data.extractedText, state.settings);
    const newHash = await sha256(compareText);
    const now = Date.now();

    await store.saveSnapshot(state.page.id, data.extractedText);
    state.page.textHash = newHash;
    state.page.wordCount = data.wordCount;
    state.page.lastCheckedAt = now;
    state.page.status = "no-change";
    await store.savePage(state.page);

    state.lastResult = null;
    hide($("check-result"));
    renderWatchedCurrent();
    toast("Baseline updated.");
    showMessage(
      "current-message",
      "success",
      "Baseline updated. Future checks will compare against this version."
    );
  } catch (err) {
    showMessage("current-message", "error", errText(err));
  } finally {
    btn.disabled = false;
    btn.textContent = "Update baseline";
  }
}

// ---------------------------------------------------------------------------
// Stop watching
// ---------------------------------------------------------------------------
async function onStopWatching() {
  if (!state.page) return;
  const ok = await showConfirm(
    "Stop watching this page?",
    "This will remove saved snapshots and change history for this page.",
    "Stop watching"
  );
  if (!ok) return;

  await store.deletePage(state.page.id);
  state.page = null;
  state.lastResult = null;
  hide($("check-result"));
  renderUnwatchedCurrent();
  toast("Stopped watching this page.");
}

// ---------------------------------------------------------------------------
// Watched Pages view
// ---------------------------------------------------------------------------
async function renderWatched() {
  const pagesMap = await store.getAllPages();
  const pages = Object.values(pagesMap).sort(
    (a, b) => (b.lastCheckedAt || 0) - (a.lastCheckedAt || 0)
  );
  $("watched-count").textContent = String(pages.length);

  const query = $("watched-search").value.trim().toLowerCase();
  const cat = $("watched-filter-category").value;

  const filtered = pages.filter((p) => {
    const hay = `${p.userLabel || ""} ${p.pageTitle || ""} ${p.domain || ""}`.toLowerCase();
    const matchQuery = !query || hay.includes(query);
    const matchCat = !cat || p.category === cat;
    return matchQuery && matchCat;
  });

  const list = $("watched-list");
  list.innerHTML = "";

  if (pages.length === 0) {
    show($("watched-empty"));
    return;
  }
  hide($("watched-empty"));

  for (const p of filtered) {
    list.appendChild(buildWatchedItem(p));
  }
}

function buildWatchedItem(p) {
  const item = document.createElement("div");
  item.className = "list-item";

  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = p.userLabel || p.pageTitle || "(untitled)";

  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.appendChild(makeBadge(statusToBadge(p.status), statusLabel(p.status)));
  meta.appendChild(makeBadge("muted", p.category || "Other"));
  const domainSpan = document.createElement("span");
  domainSpan.textContent = p.domain || "";
  meta.appendChild(domainSpan);
  const checkedSpan = document.createElement("span");
  checkedSpan.textContent = "checked " + timeAgo(p.lastCheckedAt);
  meta.appendChild(checkedSpan);

  const actions = document.createElement("div");
  actions.className = "item-actions";

  const openBtn = button("Open page", "btn btn-secondary", () => {
    chrome.tabs.create({ url: p.originalUrl });
  });
  const matchBtn = button("Check current tab", "btn btn-secondary", async () => {
    const tab = await getActiveTab();
    if (tab && normalizeUrl(tab.url) === p.normalizedUrl) {
      switchView("current");
      await refreshCurrentTab();
      toast("This tab matches. Use “Check for changes”.");
    } else {
      toast("The current tab does not match this watched page.");
    }
  });
  const delBtn = button("Delete", "btn btn-danger-ghost", async () => {
    const ok = await showConfirm(
      "Stop watching this page?",
      "This will remove saved snapshots and change history for this page.",
      "Delete"
    );
    if (!ok) return;
    await store.deletePage(p.id);
    if (state.page && state.page.id === p.id) {
      state.page = null;
      renderUnwatchedCurrent();
    }
    renderWatched();
    toast("Page deleted.");
  });

  actions.append(openBtn, matchBtn, delBtn);
  item.append(title, meta, actions);
  return item;
}

// ---------------------------------------------------------------------------
// Change History view
// ---------------------------------------------------------------------------
async function renderHistory() {
  const records = await store.getAllHistory();
  $("history-count").textContent = String(records.length);
  const list = $("history-list");
  list.innerHTML = "";

  if (records.length === 0) {
    show($("history-empty"));
    return;
  }
  hide($("history-empty"));

  for (const rec of records) {
    list.appendChild(buildHistoryItem(rec));
  }
}

function buildHistoryItem(rec) {
  const item = document.createElement("div");
  item.className = "list-item";

  const title = document.createElement("div");
  title.className = "item-title";
  title.textContent = rec.pageTitle || "(untitled)";

  const meta = document.createElement("div");
  meta.className = "item-meta";
  meta.appendChild(makeBadge("changed", `${rec.changePercentage}% changed`));
  const domainSpan = document.createElement("span");
  domainSpan.textContent = rec.domain || "";
  meta.appendChild(domainSpan);
  const dateSpan = document.createElement("span");
  dateSpan.textContent = formatDate(rec.checkedAt);
  meta.appendChild(dateSpan);

  if (rec.alerts && rec.alerts.length) {
    const alertSpan = document.createElement("span");
    alertSpan.textContent =
      "⚠ " + rec.alerts.map((a) => a.category).join(", ");
    meta.appendChild(alertSpan);
  }

  const actions = document.createElement("div");
  actions.className = "item-actions";
  actions.appendChild(
    button("View diff", "btn btn-secondary", () => {
      openDiffViewFromRecord(rec);
    })
  );

  item.append(title, meta, actions);
  return item;
}

// ---------------------------------------------------------------------------
// Diff view
// ---------------------------------------------------------------------------
function openDiffView(page, diff) {
  $("diff-title").textContent = page.userLabel || page.pageTitle || "Changes";
  $("diff-subtitle").textContent = page.domain || "";
  renderDiffTabs(diff);
  switchDiffTab("summary");
  $("diff-view").classList.remove("hidden");
  $("diff-view").setAttribute("aria-hidden", "false");
}

function openDiffViewFromRecord(rec) {
  const diff = {
    addedParagraphs: rec.addedParagraphs || [],
    removedParagraphs: rec.removedParagraphs || [],
    addedWordCount: rec.addedWordCount || 0,
    removedWordCount: rec.removedWordCount || 0,
    changePercentage: rec.changePercentage || 0,
    importantAlerts: rec.alerts || [],
    htmlSafeDiff: rec.htmlSafeDiff || "",
    unchangedCount: 0,
    truncated: rec.truncated || false,
  };
  $("diff-title").textContent = rec.pageTitle || "Changes";
  $("diff-subtitle").textContent =
    (rec.domain || "") + " · " + formatDate(rec.checkedAt);
  renderDiffTabs(diff);
  switchDiffTab("summary");
  $("diff-view").classList.remove("hidden");
  $("diff-view").setAttribute("aria-hidden", "false");
}

function renderDiffTabs(diff) {
  // Summary
  const summary = $("difftab-summary");
  summary.innerHTML = "";
  summary.appendChild(buildSummaryNode(diff));

  // Added
  const added = $("difftab-added");
  added.innerHTML = "";
  if (diff.addedParagraphs.length === 0) {
    added.appendChild(emptyNode("Nothing was added."));
  } else {
    for (const p of diff.addedParagraphs) {
      const div = document.createElement("div");
      div.className = "para added";
      div.textContent = p; // textContent = safe, no HTML injection
      added.appendChild(div);
    }
  }

  // Removed
  const removed = $("difftab-removed");
  removed.innerHTML = "";
  if (diff.removedParagraphs.length === 0) {
    removed.appendChild(emptyNode("Nothing was removed."));
  } else {
    for (const p of diff.removedParagraphs) {
      const div = document.createElement("div");
      div.className = "para removed";
      div.textContent = p;
      removed.appendChild(div);
    }
  }

  // Full diff — htmlSafeDiff is already escaped in diff.js.
  const full = $("difftab-full");
  full.innerHTML = diff.htmlSafeDiff || "<p class='diff-note'>No diff available.</p>";
}

function buildSummaryNode(diff) {
  const wrap = document.createElement("div");

  const heading = document.createElement("h2");
  heading.textContent = "What changed?";
  wrap.appendChild(heading);

  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.appendChild(metric("added", "+" + diff.addedWordCount, "words added"));
  metrics.appendChild(
    metric("removed", "-" + diff.removedWordCount, "words removed")
  );
  metrics.appendChild(metric("", diff.changePercentage + "%", "changed"));
  wrap.appendChild(metrics);

  if (diff.truncated) {
    const note = document.createElement("p");
    note.className = "diff-note";
    note.textContent =
      "This page changed too much to display a full diff. Showing summary only.";
    wrap.appendChild(note);
  }

  if (state.settings.highlightKeywords && diff.importantAlerts.length) {
    const alertWrap = document.createElement("div");
    alertWrap.className = "alert-group";
    const label = document.createElement("div");
    label.className = "hint";
    label.textContent = "Important keyword alerts:";
    alertWrap.appendChild(label);

    for (const alert of diff.importantAlerts) {
      const chip = document.createElement("span");
      chip.className = "alert-chip";
      const cat = document.createElement("span");
      cat.className = "alert-cat";
      cat.textContent = alert.category + ": ";
      chip.appendChild(cat);
      chip.appendChild(
        document.createTextNode(alert.keywords.slice(0, 4).join(", "))
      );
      alertWrap.appendChild(chip);
    }
    wrap.appendChild(alertWrap);
  } else if (state.settings.highlightKeywords) {
    const none = document.createElement("p");
    none.className = "hint";
    none.textContent = "No important keywords detected in this change.";
    wrap.appendChild(none);
  }

  return wrap;
}

function switchDiffTab(tab) {
  document.querySelectorAll(".subtab").forEach((st) => {
    st.classList.toggle("active", st.dataset.difftab === tab);
  });
  document.querySelectorAll(".difftab").forEach((dt) => {
    dt.classList.remove("active");
  });
  const map = {
    summary: "difftab-summary",
    added: "difftab-added",
    removed: "difftab-removed",
    full: "difftab-full",
  };
  $(map[tab]).classList.add("active");
}

function closeDiffView() {
  $("diff-view").classList.add("hidden");
  $("diff-view").setAttribute("aria-hidden", "true");
}

// ---------------------------------------------------------------------------
// Settings view
// ---------------------------------------------------------------------------
function wireSettingsEvents() {
  const bind = (id, key, kind) => {
    $(id).addEventListener("change", async () => {
      let value;
      if (kind === "bool") value = $(id).checked;
      else if (kind === "num") value = Number($(id).value);
      state.settings = await store.saveSettings({ [key]: value });
      toast("Settings saved.");
    });
  };
  bind("set-ignore-whitespace", "ignoreWhitespace", "bool");
  bind("set-ignore-case", "ignoreCase", "bool");
  bind("set-ignore-numbers", "ignoreNumbers", "bool");
  bind("set-threshold", "minChangeThreshold", "num");
  bind("set-highlight-keywords", "highlightKeywords", "bool");
  bind("set-store-history", "storeFullHistory", "bool");
}

async function renderSettings() {
  const s = state.settings || (await store.getSettings());
  $("set-ignore-whitespace").checked = !!s.ignoreWhitespace;
  $("set-ignore-case").checked = !!s.ignoreCase;
  $("set-ignore-numbers").checked = !!s.ignoreNumbers;
  $("set-threshold").value = s.minChangeThreshold;
  $("set-highlight-keywords").checked = !!s.highlightKeywords;
  $("set-store-history").checked = !!s.storeFullHistory;

  const est = await store.estimateStorage();
  if (est.quota > 0) {
    const usedMb = (est.usage / (1024 * 1024)).toFixed(2);
    $("storage-estimate").textContent = `Using about ${usedMb} MB of local storage.`;
  } else {
    $("storage-estimate").textContent = "Local storage usage is unavailable.";
  }
}

async function onDeleteAll() {
  const ok = await showConfirm(
    "Delete all local data?",
    "This permanently removes all watched pages, snapshots, change history, " +
      "and settings from this device. This cannot be undone.",
    "Delete everything"
  );
  if (!ok) return;

  await store.deleteAllData();
  state.settings = await store.getSettings();
  state.page = null;
  state.lastResult = null;

  renderSettings();
  renderWatched();
  renderHistory();
  await refreshCurrentTab();
  toast("All local data deleted.");
}

// ---------------------------------------------------------------------------
// Small UI helpers
// ---------------------------------------------------------------------------
function hide(el) {
  el && el.classList.add("hidden");
}
function show(el) {
  el && el.classList.remove("hidden");
}
function showBtn(id) {
  $(id).classList.remove("hidden");
}

function setBadge(id, kind, text) {
  const el = $(id);
  el.className = "badge " + badgeClass(kind);
  el.textContent = text;
}

function makeBadge(kind, text) {
  const span = document.createElement("span");
  span.className = "badge " + badgeClass(kind);
  span.textContent = text;
  return span;
}

function badgeClass(kind) {
  switch (kind) {
    case "watching":
      return "badge-watching";
    case "changed":
      return "badge-changed";
    case "nochange":
      return "badge-nochange";
    case "error":
      return "badge-error";
    case "manual":
      return "badge-manual";
    default:
      return "badge-muted";
  }
}

function statusToBadge(status) {
  switch (status) {
    case "changed":
      return "changed";
    case "no-change":
      return "nochange";
    case "error":
      return "error";
    case "needs-manual-check":
      return "manual";
    default:
      return "watching";
  }
}

function statusLabel(status) {
  switch (status) {
    case "changed":
      return "Changed";
    case "no-change":
      return "No change";
    case "error":
      return "Error";
    case "needs-manual-check":
      return "Needs manual check";
    default:
      return "Watching";
  }
}

function metric(kind, num, label) {
  const div = document.createElement("div");
  div.className = "metric " + (kind || "");
  const n = document.createElement("div");
  n.className = "metric-num";
  n.textContent = num;
  const l = document.createElement("div");
  l.className = "metric-label";
  l.textContent = label;
  div.append(n, l);
  return div;
}

function emptyNode(text) {
  const div = document.createElement("div");
  div.className = "empty";
  div.textContent = text;
  return div;
}

function button(label, className, onClick) {
  const b = document.createElement("button");
  b.className = className;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function showMessage(id, kind, text) {
  const el = $(id);
  el.className = "inline-message " + kind;
  el.textContent = text;
  show(el);
}

let toastTimer = null;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  show(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(el), 2600);
}

// Promise-based confirmation dialog.
let confirmResolver = null;
function showConfirm(title, message, okLabel = "Confirm") {
  $("confirm-title").textContent = title;
  $("confirm-message").textContent = message;
  $("confirm-ok").textContent = okLabel;
  $("confirm-dialog").classList.remove("hidden");
  $("confirm-dialog").setAttribute("aria-hidden", "false");
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}
function resolveConfirm(value) {
  $("confirm-dialog").classList.add("hidden");
  $("confirm-dialog").setAttribute("aria-hidden", "true");
  if (confirmResolver) {
    confirmResolver(value);
    confirmResolver = null;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------
class AppError extends Error {}

function errText(err) {
  if (err instanceof AppError) return err.message;
  console.error("[Terms Changed?]", err);
  return "Something went wrong. Please try again.";
}
