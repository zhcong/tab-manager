# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Chrome Extension (Manifest V3) called "标签页管家" (Tab Manager) that automatically records opened tabs and allows reopening closed ones. It distinguishes between individual tab closes and entire window closes.

## Architecture

### Core Files
- **manifest.json** — Extension manifest (V3). Declares `tabs` and `storage` permissions, popup UI, and background service worker.
- **background.js** — Service worker that tracks tab/window events and persists history to `chrome.storage.local`.
- **popup.html / popup.js / popup.css** — Extension popup UI for viewing and managing tab history.

### Data Flow
1. `background.js` listens to `chrome.tabs.onUpdated`, `chrome.tabs.onRemoved`, `chrome.windows.onRemoved`, and `chrome.runtime.onStartup`.
2. History is stored in `chrome.storage.local` as `tabHistory` (array of tab records) and `closedWindowIds` (array of closed window IDs).
3. A 600ms debounce (`removalTimer`) distinguishes single-tab close from window close — if the window still exists after 600ms, it's a single tab close.
4. `popup.js` reads history from storage and renders the groupable list UI.

### Key Storage Keys
- `tabHistory` — Array of `{ id, url, title, favIconUrl, openedAt, windowId }`
- `closedWindowIds` — Array of window IDs that have been closed
- `windowNames` — Custom names for window groups (persisted by popup)
- `sessionSnapshot` — Temporary backup restored on Chrome startup

### Window vs Tab Close Detection (background.js:40-57)
```js
removalTimer = setTimeout(async () => {
  for (const [wid, tabIds] of batch) {
    try {
      await chrome.windows.get(wid); // Window still exists → single tab close
      for (const tid of tabIds) await removeRecord(`tab-${tid}`);
    } catch {
      // Window gone → mark window closed, preserve records
      await markWindowClosed(wid);
    }
  }
}, 600);
```

## Development

### Loading the Extension
1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select this directory

### No Build Step
This is a pure Chrome Extension — no bundler, no TypeScript, no tests. Files are loaded directly by the browser.

### Testing Changes
Reload the extension in `chrome://extensions/` after editing any file.

### Extension Permissions
- `tabs` — Access tab URL, title, favicon
- `storage` — Persist tab history locally
