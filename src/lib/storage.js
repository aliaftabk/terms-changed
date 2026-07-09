// storage.js
// Local persistence layer.
//
//   - chrome.storage.local  -> settings + lightweight watched-page metadata
//   - IndexedDB             -> large snapshot text + full change-history diffs
//
// Nothing here ever touches the network. All data stays on the device.

const DB_NAME = "TermsChangedDB";
const DB_VERSION = 1;
const STORE_SNAPSHOTS = "snapshots"; // { id, text }  (current baseline text)
const STORE_HISTORY = "history"; // { historyId, pageId, ... , diffHtml, prevText }

const KEY_SETTINGS = "settings";
const KEY_PAGES = "watchedPages";
const KEY_ONBOARDED = "onboardingComplete";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  ignoreWhitespace: true,
  ignoreCase: false,
  ignoreNumbers: false,
  minChangeThreshold: 1, // percent
  highlightKeywords: true,
  storeFullHistory: false,
  autoChecks: false, // "Coming soon" / optional beta
};

/**
 * Read the user's settings, merged over defaults.
 * @returns {Promise<object>}
 */
export async function getSettings() {
  const data = await chromeStorageGet(KEY_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(data || {}) };
}

/**
 * Persist settings (merged over the existing values).
 * @param {object} partial
 * @returns {Promise<object>} the full saved settings
 */
export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chromeStorageSet(KEY_SETTINGS, next);
  return next;
}

// ---------------------------------------------------------------------------
// Onboarding flag
// ---------------------------------------------------------------------------

export async function isOnboarded() {
  return Boolean(await chromeStorageGet(KEY_ONBOARDED));
}

export async function setOnboarded(value) {
  await chromeStorageSet(KEY_ONBOARDED, Boolean(value));
}

// ---------------------------------------------------------------------------
// Watched-page metadata (chrome.storage.local)
// ---------------------------------------------------------------------------

/**
 * Get the map of watched pages keyed by id.
 * @returns {Promise<Object<string, object>>}
 */
export async function getAllPages() {
  return (await chromeStorageGet(KEY_PAGES)) || {};
}

/**
 * Get a single page's metadata by id.
 * @param {string} id
 * @returns {Promise<object|null>}
 */
export async function getPage(id) {
  const pages = await getAllPages();
  return pages[id] || null;
}

/**
 * Find a watched page by its normalized URL.
 * @param {string} normalizedUrl
 * @returns {Promise<object|null>}
 */
export async function findPageByNormalizedUrl(normalizedUrl) {
  const pages = await getAllPages();
  for (const page of Object.values(pages)) {
    if (page.normalizedUrl === normalizedUrl) return page;
  }
  return null;
}

/**
 * Insert or update a page's metadata.
 * @param {object} page - must contain an `id`
 * @returns {Promise<object>}
 */
export async function savePage(page) {
  const pages = await getAllPages();
  pages[page.id] = page;
  await chromeStorageSet(KEY_PAGES, pages);
  return page;
}

/**
 * Delete a page and all of its snapshots + history.
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deletePage(id) {
  const pages = await getAllPages();
  delete pages[id];
  await chromeStorageSet(KEY_PAGES, pages);
  await deleteSnapshot(id);
  await deleteHistoryForPage(id);
}

// ---------------------------------------------------------------------------
// Snapshot text (IndexedDB) — the current baseline for each page
// ---------------------------------------------------------------------------

/**
 * Store the baseline text for a page.
 * @param {string} pageId
 * @param {string} text
 * @returns {Promise<void>}
 */
export async function saveSnapshot(pageId, text) {
  const db = await openDb();
  await idbRequest(
    db.transaction(STORE_SNAPSHOTS, "readwrite").objectStore(STORE_SNAPSHOTS).put({
      id: pageId,
      text: String(text || ""),
    })
  );
  db.close();
}

/**
 * Read the baseline text for a page.
 * @param {string} pageId
 * @returns {Promise<string>}
 */
export async function getSnapshot(pageId) {
  const db = await openDb();
  const record = await idbRequest(
    db.transaction(STORE_SNAPSHOTS, "readonly").objectStore(STORE_SNAPSHOTS).get(pageId)
  );
  db.close();
  return record ? record.text : "";
}

export async function deleteSnapshot(pageId) {
  const db = await openDb();
  await idbRequest(
    db.transaction(STORE_SNAPSHOTS, "readwrite").objectStore(STORE_SNAPSHOTS).delete(pageId)
  );
  db.close();
}

// ---------------------------------------------------------------------------
// Change history (IndexedDB) — full diff detail per change event
// ---------------------------------------------------------------------------

/**
 * Add a change-history record.
 * @param {object} record - must include historyId + pageId
 * @returns {Promise<void>}
 */
export async function addHistory(record) {
  const db = await openDb();
  await idbRequest(
    db.transaction(STORE_HISTORY, "readwrite").objectStore(STORE_HISTORY).put(record)
  );
  db.close();
}

/**
 * Read one history record by its id.
 * @param {string} historyId
 * @returns {Promise<object|null>}
 */
export async function getHistory(historyId) {
  const db = await openDb();
  const record = await idbRequest(
    db.transaction(STORE_HISTORY, "readonly").objectStore(STORE_HISTORY).get(historyId)
  );
  db.close();
  return record || null;
}

/**
 * List every history record, newest first.
 * @returns {Promise<object[]>}
 */
export async function getAllHistory() {
  const db = await openDb();
  const records = await idbRequest(
    db.transaction(STORE_HISTORY, "readonly").objectStore(STORE_HISTORY).getAll()
  );
  db.close();
  return (records || []).sort((a, b) => (b.checkedAt || 0) - (a.checkedAt || 0));
}

/**
 * Delete a single history record by id.
 * @param {string} historyId
 * @returns {Promise<void>}
 */
export async function deleteHistoryById(historyId) {
  const db = await openDb();
  await idbRequest(
    db.transaction(STORE_HISTORY, "readwrite").objectStore(STORE_HISTORY).delete(historyId)
  );
  db.close();
}

async function deleteHistoryForPage(pageId) {
  const all = await getAllHistory();
  const db = await openDb();
  const tx = db.transaction(STORE_HISTORY, "readwrite");
  const store = tx.objectStore(STORE_HISTORY);
  for (const record of all) {
    if (record.pageId === pageId) {
      store.delete(record.historyId);
    }
  }
  await txDone(tx);
  db.close();
}

// ---------------------------------------------------------------------------
// Wipe everything
// ---------------------------------------------------------------------------

/**
 * Remove ALL extension data: settings, pages, snapshots, and history.
 * @returns {Promise<void>}
 */
export async function deleteAllData() {
  await new Promise((resolve) => chrome.storage.local.clear(() => resolve()));
  const db = await openDb();
  const tx = db.transaction([STORE_SNAPSHOTS, STORE_HISTORY], "readwrite");
  tx.objectStore(STORE_SNAPSHOTS).clear();
  tx.objectStore(STORE_HISTORY).clear();
  await txDone(tx);
  db.close();
}

/**
 * Estimate current storage usage (best effort).
 * @returns {Promise<{usage:number, quota:number}>}
 */
export async function estimateStorage() {
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      return { usage: est.usage || 0, quota: est.quota || 0 };
    }
  } catch (err) {
    /* ignore */
  }
  return { usage: 0, quota: 0 };
}

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function chromeStorageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result[key]);
      }
    });
  });
}

function chromeStorageSet(key, value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve();
      }
    });
  });
}

// Open a fresh connection per operation. Each caller closes it when done,
// which keeps things simple and avoids reusing a closed connection.
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SNAPSHOTS)) {
        db.createObjectStore(STORE_SNAPSHOTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_HISTORY)) {
        db.createObjectStore(STORE_HISTORY, { keyPath: "historyId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
