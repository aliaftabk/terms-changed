// service_worker.js
// Manifest V3 background service worker.
//
// Responsibilities:
//   - Make the toolbar icon open the side panel.
//   - Initialize default settings on install.
//   - Provide the (optional / "coming soon") automatic-check scaffolding via
//     chrome.alarms. Automatic checks are OFF by default and never run unless
//     the user explicitly enables them and grants host permission for a site.
//
// This worker performs NO network requests and sends NO data anywhere.

import { getSettings, getAllPages, savePage } from "../lib/storage.js";

// Open the side panel when the toolbar icon is clicked.
chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    console.warn("[Terms Changed?] Could not set side panel behavior:", err);
  }
});

// Also set the behavior on startup (service workers can be recycled).
chrome.runtime.onStartup.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    /* ignore */
  }
});

// Fallback: if setPanelBehavior is unavailable, open the panel manually.
chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (tab && tab.windowId !== undefined) {
      await chrome.sidePanel.open({ windowId: tab.windowId });
    }
  } catch (err) {
    /* setPanelBehavior already handles the common case */
  }
});

// ---------------------------------------------------------------------------
// Optional automatic checks (disabled by default — "Coming soon" feature).
//
// The alarm handler below only marks pages as "Needs manual check". True
// background fetching requires host permission for each site AND a network
// request, which this privacy-first build intentionally does not perform
// automatically. The scaffolding is here so the feature can be completed
// later without changing the architecture.
// ---------------------------------------------------------------------------

const AUTO_CHECK_ALARM = "terms-changed-auto-check";

async function ensureAutoCheckAlarm() {
  const settings = await getSettings();
  const hasAlarms = Boolean(chrome.alarms);
  if (settings.autoChecks && hasAlarms) {
    chrome.alarms.create(AUTO_CHECK_ALARM, { periodInMinutes: 360 });
  } else if (hasAlarms) {
    chrome.alarms.clear(AUTO_CHECK_ALARM);
  }
}

if (chrome.alarms) {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name !== AUTO_CHECK_ALARM) return;
    const settings = await getSettings();
    if (!settings.autoChecks) return;

    // Without a background fetch (privacy-first default), we simply flag
    // watched pages so the user knows to check them manually.
    const pages = await getAllPages();
    for (const page of Object.values(pages)) {
      if (page.autoCheckEnabled) {
        page.status = "needs-manual-check";
        await savePage(page);
      }
    }
  });
}

// Re-evaluate the alarm whenever settings change.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.settings) {
    ensureAutoCheckAlarm();
  }
});

ensureAutoCheckAlarm();
