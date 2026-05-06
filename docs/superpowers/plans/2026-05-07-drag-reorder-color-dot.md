# 分组拖拽排序 & 小圆点颜色 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现分组拖拽排序和圆点颜色更换，均持久化到 chrome.storage.local。

**Architecture:** 修改 popup.js 和 popup.css。新增 storage key `windowOrder`（number[]）和 `windowColors`（{[windowId]: string}）。拖拽基于 HTML5 Drag and Drop API，颜色使用内嵌展开行（12 色预设）。render() 中新增排序逻辑、拖拽手柄 HTML、颜色行 HTML、拖拽/颜色事件绑定。

**Tech Stack:** Chrome Extension Manifest V3，纯 JavaScript，无构建步骤。

---

### Task 1: Add drag-and-drop reorder

**Files:**
- Modify: `popup.js:11-17` (add module-level variables)
- Modify: `popup.js:120-124` (load windowOrder and windowColors)
- Modify: `popup.js:159-162` (smartRefresh to load windowOrder and windowColors)
- Modify: `popup.js:241-244` (render sorting to use windowOrder)
- Modify: `popup.js:264-281` (add drag handle HTML in group header)
- Modify: `popup.js:283-288` (collapse click handler to ignore drag handle)
- Modify: `popup.js:462-462` (add drag/drop event handlers in render)
- Modify: `popup.css` (add drag handle, dragging, drag-over styles)

- [ ] **Step 1: Add module-level variables for windowOrder and windowColors**

After line 17 (`let isWindowMode = false;`), add:

```js
let windowOrder = [];
let windowColors = {};
```

- [ ] **Step 2: Load windowOrder and windowColors in load()**

In `load()`, change line 120 from:
```js
const result = await chrome.storage.local.get(['tabHistory', 'windowNames', 'closedWindowIds']);
```
to:
```js
const result = await chrome.storage.local.get(['tabHistory', 'windowNames', 'closedWindowIds', 'windowOrder', 'windowColors']);
```

After line 123 (`closedWindowIds = result.closedWindowIds || [];`), add:
```js
windowOrder = result.windowOrder || [];
windowColors = result.windowColors || {};
```

- [ ] **Step 3: Load windowOrder and windowColors in smartRefresh()**

In `smartRefresh()`, change line 159 from:
```js
const result = await chrome.storage.local.get(['tabHistory', 'windowNames', 'closedWindowIds']);
```
to:
```js
const result = await chrome.storage.local.get(['tabHistory', 'windowNames', 'closedWindowIds', 'windowOrder', 'windowColors']);
```

After line 162 (`closedWindowIds = result.closedWindowIds || [];`), add:
```js
windowOrder = result.windowOrder || [];
windowColors = result.windowColors || {};
```

- [ ] **Step 4: Add getSortedGroups helper and update render() sorting**

Replace lines 241-243:
```js
const sortedGroups = [...groups.entries()]
    .map(([key, records]) => ({ key, records }))
    .sort((a, b) => b.records[0].openedAt - a.records[0].openedAt);
```
with:
```js
const sortedGroups = getSortedGroups(groups);
```

After the `render()` function's closing `}` (before `renderItem`), add the `getSortedGroups` helper:

```js
function getSortedGroups(groups) {
  const entries = [...groups.entries()].map(([key, records]) => ({ key, records }));
  if (windowOrder.length === 0) {
    return entries.sort((a, b) => b.records[0].openedAt - a.records[0].openedAt);
  }
  const orderMap = new Map(windowOrder.map((id, i) => [Number(id), i]));
  entries.sort((a, b) => {
    const ai = orderMap.has(Number(a.key)) ? orderMap.get(Number(a.key)) : Infinity;
    const bi = orderMap.has(Number(b.key)) ? orderMap.get(Number(b.key)) : Infinity;
    if (ai !== bi) return ai - bi;
    return b.records[0].openedAt - a.records[0].openedAt;
  });
  return entries;
}
```

- [ ] **Step 5: Add drag handle HTML to group header**

In `render()`, modify the group header HTML. Add the drag handle span immediately before the chevron span (after `<div class="group-header">`):

Change:
```js
        <div class="group-header">
          <span class="chevron" data-i18n-title="toggle_collapse">
```
to:
```js
        <div class="group-header">
          <span class="drag-handle" draggable="true" data-i18n-title="drag_to_reorder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="19" r="2"/><circle cx="15" cy="19" r="2"/></svg>
          </span>
          <span class="chevron" data-i18n-title="toggle_collapse">
```

- [ ] **Step 6: Update window-indicator HTML to support inline color**

Change:
```js
          <span class="window-indicator"></span>
```
to:
```js
          <span class="window-indicator" style="${windowColors[String(g.key)] ? 'background-color:' + windowColors[String(g.key)] : ''}"></span>
```

- [ ] **Step 7: Update collapse click handler to ignore drag handle and window-indicator**

In the group-header click handler (around line 284-288), change:
```js
      if (e.target.closest('.open-all-btn') || e.target.closest('.focus-win-btn') || e.target.closest('.window-label') || e.target.closest('.label-input')) return;
```
to:
```js
      if (e.target.closest('.open-all-btn') || e.target.closest('.focus-win-btn') || e.target.closest('.window-label') || e.target.closest('.label-input') || e.target.closest('.drag-handle') || e.target.closest('.window-indicator')) return;
```

- [ ] **Step 8: Add drag-and-drop event handlers in render()**

At the end of `render()`, before the closing `}` (right after the delete-btn handler, around line 461), add:

```js
  // 拖拽排序
  listEl.querySelectorAll('.drag-handle').forEach(handle => {
    handle.addEventListener('dragstart', (e) => {
      const group = handle.closest('.group');
      group.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', group.dataset.key);
    });
    handle.addEventListener('dragend', () => {
      document.querySelectorAll('.group.dragging').forEach(g => g.classList.remove('dragging'));
      document.querySelectorAll('.group.drag-over').forEach(g => g.classList.remove('drag-over'));
    });
  });

  listEl.querySelectorAll('.group').forEach(group => {
    group.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const dragging = document.querySelector('.group.dragging');
      if (!dragging || dragging === group) return;
      group.classList.add('drag-over');
    });
    group.addEventListener('dragleave', () => {
      group.classList.remove('drag-over');
    });
    group.addEventListener('drop', async (e) => {
      e.preventDefault();
      group.classList.remove('drag-over');
      const dragging = document.querySelector('.group.dragging');
      if (!dragging || dragging === group) return;

      const draggedKey = Number(dragging.dataset.key);
      const targetKey = Number(group.dataset.key);

      const allKeys = [...document.querySelectorAll('.group')].map(g => Number(g.dataset.key));
      if (windowOrder.length === 0) {
        windowOrder = [...allKeys];
      }
      // Ensure both keys are in windowOrder
      if (!windowOrder.includes(draggedKey)) windowOrder.push(draggedKey);
      if (!windowOrder.includes(targetKey)) windowOrder.push(targetKey);

      const draggedIdx = windowOrder.indexOf(draggedKey);
      const targetIdx = windowOrder.indexOf(targetKey);
      windowOrder.splice(draggedIdx, 1);
      windowOrder.splice(targetIdx, 0, draggedKey);

      await chrome.storage.local.set({ windowOrder });
      render();
    });
  });
```

- [ ] **Step 9: Add CSS for drag handle and drag states**

Append to `popup.css`:

```css
/* Drag handle */
.drag-handle {
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s;
  color: var(--text3);
  border-radius: 4px;
}

.group-header:hover .drag-handle {
  opacity: 1;
}

.drag-handle:hover {
  background: var(--input-bg);
}

.drag-handle:active {
  cursor: grabbing;
}

.group.dragging {
  opacity: 0.4;
}

.group.drag-over {
  box-shadow: 0 -2px 0 0 var(--accent);
}
```

- [ ] **Step 10: Commit**

```bash
git add popup.js popup.css
git commit -m "feat: add drag-and-drop group reorder with persistence"
```

---

### Task 2: Add color dot picker

**Files:**
- Modify: `popup.js:462-462` (add color row toggle and selection handlers in render)
- Modify: `popup.css` (add color row and color dot styles)

- [ ] **Step 1: Add color dot click handler in render()**

At the end of `render()`, after the drag-and-drop handlers (or before them), add:

```js
  // 小圆点颜色选择
  listEl.querySelectorAll('.window-indicator').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = dot.closest('.group');
      const groupKey = group.dataset.key;
      const existingRow = group.querySelector('.color-row');

      // 关闭其他打开的颜色行
      document.querySelectorAll('.color-row').forEach(r => {
        if (r !== existingRow) r.remove();
      });

      if (existingRow) {
        existingRow.remove();
        return;
      }

      const presetColors = [
        '#6366f1', '#8b5cf6', '#06b6d4', '#10b981',
        '#f59e0b', '#ef4444', '#ec4899', '#f97316',
        '#84cc16', '#14b8a6', '#3b82f6', '#a855f7'
      ];
      const currentColor = windowColors[String(groupKey)];

      const colorRow = document.createElement('div');
      colorRow.className = 'color-row';
      colorRow.innerHTML = presetColors.map(c =>
        `<span class="color-dot${c === currentColor ? ' selected' : ''}"
              style="background:${c}; color:${c}"
              data-color="${c}"></span>`
      ).join('');

      colorRow.addEventListener('click', async (ev) => {
        const colorDot = ev.target.closest('.color-dot');
        if (!colorDot) return;
        const color = colorDot.dataset.color;
        windowColors[String(groupKey)] = color;
        await chrome.storage.local.set({ windowColors });
        dot.style.backgroundColor = color;
        colorRow.remove();
      });

      const header = group.querySelector('.group-header');
      header.after(colorRow);
    });
  });
```

- [ ] **Step 2: Add CSS for color row and color dots**

Append to `popup.css`:

```css
/* Color picker row */
.color-row {
  display: flex;
  gap: 6px;
  padding: 4px 14px 8px 52px;
  flex-wrap: wrap;
}

.color-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  cursor: pointer;
  transition: transform 0.15s;
  flex-shrink: 0;
}

.color-dot:hover {
  transform: scale(1.2);
}

.color-dot.selected {
  box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px currentColor;
}
```

- [ ] **Step 3: Commit**

```bash
git add popup.js popup.css
git commit -m "feat: add color dot picker with 12 preset colors"
```

---

### Task 3: Cleanup stale data and edge cases

**Files:**
- Modify: `popup.js:57-65` (clearAll to also clear new keys)
- Modify: `popup.js:38-53` (clearClosed to also clean up new keys)
- Modify: `popup.js:299-311` (close-win-btn to also clean up new keys)
- Modify: `popup.js:314-333` (open-all-btn to also clean up new keys)
- Modify: `popup.js:241-243` (render to filter stale entries from windowOrder/windowColors)

- [ ] **Step 1: Clean up windowOrder and windowColors in clearAll**

In the `clearAllBtn` click handler, change:
```js
await chrome.storage.local.set({ tabHistory: [], windowNames: {}, closedWindowIds: [] });
```
to:
```js
await chrome.storage.local.set({ tabHistory: [], windowNames: {}, closedWindowIds: [], windowOrder: [], windowColors: {} });
```

After the line `closedWindowIds = [];`, add:
```js
windowOrder = [];
windowColors = {};
```

- [ ] **Step 2: Clean up windowOrder and windowColors in clearClosed**

In the `clearClosedBtn` click handler, change the storage set from:
```js
const filtered = history.filter(r => !closedIds.includes(r.windowId));
await chrome.storage.local.set({ tabHistory: filtered, closedWindowIds: [] });
```
to:
```js
const filtered = history.filter(r => !closedIds.includes(r.windowId));
const removedIds = new Set(closedIds);
const newOrder = windowOrder.filter(id => !removedIds.has(id));
const newColors = {};
for (const [key, val] of Object.entries(windowColors)) {
  if (!removedIds.has(Number(key))) newColors[key] = val;
}
await chrome.storage.local.set({ tabHistory: filtered, closedWindowIds: [], windowOrder: newOrder, windowColors: newColors });
windowOrder = newOrder;
windowColors = newColors;
```

- [ ] **Step 3: Clean up windowOrder and windowColors in close-win-btn handler**

In the close-win-btn click handler (around lines 300-311), after determining `wid`, add cleanup. Change the storage set from:
```js
await chrome.storage.local.set({ tabHistory: history, closedWindowIds: closedIds });
```
to:
```js
const newOrder = windowOrder.filter(id => id !== wid);
const newColors = { ...windowColors };
delete newColors[String(wid)];
await chrome.storage.local.set({ tabHistory: history, closedWindowIds: closedIds, windowOrder: newOrder, windowColors: newColors });
windowOrder = newOrder;
windowColors = newColors;
```

- [ ] **Step 4: Clean up windowOrder and windowColors in open-all-btn handler**

In the open-all-btn click handler (around lines 315-333), after determining `oldWindowId`, change the storage set from:
```js
await chrome.storage.local.set({ tabHistory: history, closedWindowIds: closedIds });
```
to:
```js
const newOrder = windowOrder.filter(id => id !== oldWindowId);
const newColors = { ...windowColors };
delete newColors[String(oldWindowId)];
await chrome.storage.local.set({ tabHistory: history, closedWindowIds: closedIds, windowOrder: newOrder, windowColors: newColors });
windowOrder = newOrder;
windowColors = newColors;
```

- [ ] **Step 5: Filter stale entries from windowOrder and windowColors at start of render()**

At the start of `render()`, after the search filter logic and the `groups` Map is built (after line 221), add:

```js
// 清理 windowOrder 和 windowColors 中的过期条目
const existingKeys = new Set([...groups.keys()].map(String));
windowOrder = windowOrder.filter(id => existingKeys.has(String(id)));
windowColors = Object.fromEntries(
  Object.entries(windowColors).filter(([key]) => existingKeys.has(key))
);
```

- [ ] **Step 6: Commit**

```bash
git add popup.js
git commit -m "fix: clean up stale windowOrder and windowColors entries"
```
