# Tab Manager

[English](README.md) | [中文](README_zh.md)

---

**Automatically record, organize, search, and restore browser tabs by window.**

Current version: `3.0.0`

## Screenshots

### Popup View — Tab History Grouped by Window
<img src="images/1.png" width="600" alt="Popup view showing tab history grouped by window with search, color dots, AI and settings buttons" />

### Independent Window Mode — Expanded Tab History
<img src="images/2.png" width="600" alt="Independent window mode showing expanded tab history with full tab details per group" />

### Local AI Model Features
<img src="images/setting.png" width="600" alt="Settings panel with Local AI Model Features toggles for AI group naming, duplicate marking, close suggestions, smart search and AI semantic search" />

## Features

### Tab History Recording
- Automatically records all opened tabs in the background
- Stores tab URL, title, favicon, and open time
- Groups tabs by window for easy management
- Keeps closed window groups when the option is enabled

### Quick Restore
- Click any tab to jump directly to it (if still open)
- Click on closed window tabs to reopen them in a new window
- "Open All" button to restore all closed tabs at once

### Window Management
- Rename window groups with custom labels
- Clear closed window records individually
- Delete specific tab records
- Open history in an independent window (enable in settings)
- Reorder groups by dragging
- Use color dots to distinguish groups
- The currently focused Chrome window is highlighted in the list

### Local AI Features
Optional local AI features can be enabled in settings. When supported by Chrome, the extension uses the browser's local model rather than uploading tab titles to a remote service.

- AI group naming: generate or regenerate a group name from the titles and domains in that group
- Smarter naming input: repeated titles are merged and counted before being sent to the model
- Duplicate tab marking: detects duplicates by normalized URL and marks them with a special badge
- Close suggestions: marks duplicate or low-value tabs with a suggestion badge without closing them automatically
- Smart search: matches title, URL, domain, acronym, and common intent words
- AI semantic search: shows normal search results first, then asynchronously adds semantically related tabs from the local AI model

### Settings
Settings are organized into three sections:

- Management: independent window mode and closed group retention
- Local AI Model Features: AI naming, duplicate marking, close suggestions, smart search, and AI semantic search
- URL Filtering: include and exclude keyword rules

### URL Filtering
- Filter which tabs to save using keywords
- Set include/exclude rules in settings
- Exclusion takes priority over inclusion

### Independent Window Mode
Enable "Open in Independent Window" in settings to display your tab history in a dedicated popup window instead of the browser's default popup. The window size automatically adjusts to your screen.

### Multi-language Support
- Supports: English, Chinese, Korean, Japanese, German
- Automatically follows browser language setting

## How to Use

1. **Install**: Load this extension in `chrome://extensions/` (enable Developer mode → Load unpacked → select folder)

2. **View History**: Click the extension icon to see all recorded tabs grouped by window

3. **Restore Tab**: Click any tab item to jump to it (if open) or create new tab (if closed)

4. **Use AI Features**: Open settings and enable the local AI features you need

5. **Filter Tabs**: Open settings to configure URL keyword filters

6. **Organize**: Rename groups, drag groups to reorder them, use color dots to distinguish work contexts, and remove records when needed

## Privacy

All tab records and settings are stored locally in your Chrome browser. No user data is collected or uploaded by the extension.

If local AI features are enabled, tab titles and simplified URL information are only passed to Chrome's local model APIs when those APIs are available. AI semantic search is asynchronous and falls back to normal search if the local model is unavailable.

## License

MIT License
