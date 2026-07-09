# Privacy Policy — Terms Changed?

_Last updated: 2026_

## Summary

**Terms Changed?** stores watched page snapshots locally on your device. Your
watched pages and page text are **not** sent to our servers. We do not have
servers that receive your data.

## What the extension stores

To let you compare a page over time, the extension saves the following **on your
own device only**, using the browser's local storage (`chrome.storage.local`)
and IndexedDB:

- The URLs of pages you explicitly choose to watch.
- The readable text of those pages (baseline snapshots).
- A cryptographic hash (SHA-256) of the page text, used to detect changes.
- Change history and diffs for pages you have checked.
- Your extension settings.

## What the extension does **not** do

- It does **not** send page content, URLs, browsing activity, or snapshots to
  any server.
- It does **not** sell, rent, or share your data with anyone.
- It does **not** use advertising or tracking of any kind.
- It does **not** load or execute any remote/hosted code.
- It does **not** monitor pages in the background without your action. (An
  optional automatic-check feature is shown as "Coming soon" and is disabled.)

## Permissions and why they are used

- **storage** — save your watched pages, snapshots, and settings locally.
- **tabs** — read the current tab's title and URL so the side panel can show the
  current page and tell whether it is already watched. This information is used
  only on your device and is never transmitted anywhere.
- **activeTab** + **scripting** — read the readable text of the current tab
  **only when you click a button** (Watch / Check / Update baseline).
- **sidePanel** — display the extension's user interface in Chrome's side panel.
- **optional** `alarms`, `notifications`, and host permissions — requested
  **only if** you ever opt into the future automatic-checking feature for a
  specific site. They are not requested at install time.

## Data retention and deletion

All data stays on your device until you remove it. You can delete everything at
any time:

1. Open the side panel.
2. Go to **Settings** (or **Privacy**).
3. Click **Delete all local data**.

Removing the extension from Chrome also removes its locally stored data.

## Contact

Because no data leaves your device, there is nothing for us to access, export,
or delete on your behalf. For questions about this policy, please open an issue
in the project's repository.
