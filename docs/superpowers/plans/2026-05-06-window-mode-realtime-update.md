# 独立窗口模式实时更新 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在独立窗口模式下通过 `chrome.storage.onChanged` 监听数据变更，实现列表自动实时刷新。

**Architecture:** 仅修改 `popup.js`。新增 3 个模块级变量（debounceTimer、pendingRefresh、isWindowMode）、3 个函数（handleStorageChange、scheduleRefresh、smartRefresh），在 `load()` 末尾注册监听器，在标签编辑 finish 回调中处理待刷新。

**Tech Stack:** Chrome Extension Manifest V3，纯 JavaScript，无构建步骤。

---

### Task 1: Add real-time refresh infrastructure

**Files:**
- Modify: `popup.js:14-14` (add module-level variables)
- Modify: `popup.js:68-68` (change `const isWindowMode` to module-level `isWindowMode`)
- Modify: `popup.js:484-484` (register storage listener, add new functions)

- [ ] **Step 1: Add module-level state variables**

After line 14 (`let isExpanded = true;`), add:

```js
let debounceTimer = null;
let pendingRefresh = false;
let isWindowMode = false;
```

- [ ] **Step 2: Change `isWindowMode` from local const to module-level variable**

On line 68, change:
```js
const isWindowMode = urlParams.get('windowMode') === 'true';
```
to:
```js
isWindowMode = urlParams.get('windowMode') === 'true';
```

- [ ] **Step 3: Add `handleStorageChange`, `scheduleRefresh`, `smartRefresh` functions**

After `load()` (before the last line `load();`), insert:

```js
function handleStorageChange(changes, namespace) {
  if (namespace !== 'local') return;
  if (changes.tabHistory || changes.closedWindowIds || changes.windowNames) {
    scheduleRefresh();
  }
}

function scheduleRefresh() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    debounceTimer = null;
    await smartRefresh();
  }, 300);
}

async function smartRefresh() {
  if (document.querySelector('.label-input')) {
    pendingRefresh = true;
    return;
  }

  const searchText = searchEl.value;
  const expandedStates = new Map();
  document.querySelectorAll('.group').forEach(g => {
    expandedStates.set(g.dataset.key, g.classList.contains('expanded'));
  });

  const result = await chrome.storage.local.get(['tabHistory', 'windowNames', 'closedWindowIds']);
  allRecords = (result.tabHistory || []).sort((a, b) => b.openedAt - a.openedAt);
  windowNames = result.windowNames || {};
  closedWindowIds = result.closedWindowIds || [];

  if (searchText) {
    searchEl.value = searchText;
  }
  render();

  document.querySelectorAll('.group').forEach(g => {
    if (expandedStates.get(g.dataset.key) === false) {
      g.classList.remove('expanded');
    }
  });

  pendingRefresh = false;
}
```

- [ ] **Step 4: Register storage listener at end of `load()`**

At the end of `load()`, after `applyI18n()` (before the closing `}` of `load`), add:

```js
  if (isWindowMode) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }
```

The end of `load()` should now look like:
```js
  render();
  applyI18n();

  if (isWindowMode) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }
}
```

---

### Task 2: Patch label editing to handle pending refresh

**Files:**
- Modify: `popup.js:295-301` (label editing `finish` callback)

- [ ] **Step 1: Add pending refresh check after label editing finishes**

In the `finish` function inside the `.window-label` click handler (around line 295), after `input.remove();`, add the pending refresh check. Change:

```js
      const finish = async () => {
        const name = input.value.trim() || labelEl.dataset.default;
        await saveWindowName(groupKey, name);
        labelEl.textContent = name;
        labelEl.style.display = '';
        input.remove();
      };
```

to:

```js
      const finish = async () => {
        const name = input.value.trim() || labelEl.dataset.default;
        await saveWindowName(groupKey, name);
        labelEl.textContent = name;
        labelEl.style.display = '';
        input.remove();
        if (pendingRefresh) {
          pendingRefresh = false;
          scheduleRefresh();
        }
      };
```

---

### Task 3: Verify in Chrome

- [ ] **Step 1: Reload the extension**

Open `chrome://extensions/`，click the reload button on "标签页管家".

- [ ] **Step 2: Test real-time updates in window mode**

1. 确认设置中开启了"在独立窗口中打开"
2. 点击扩展图标，独立窗口打开
3. 在 Chrome 中打开一个新标签页（如 `example.com`）
4. 验证：300ms 内新标签页出现在独立窗口列表中
5. 关闭一个标签页
6. 验证：该标签页从列表中消失（或窗口组标记为已关闭）
7. 切换到一个已有标签页，修改其 URL
8. 验证：列表中对应项的 URL 更新

- [ ] **Step 3: Test state preservation**

1. 在独立窗口搜索框中输入关键词
2. 打开一个新标签页
3. 验证：搜索结果被更新，搜索文本保留
4. 折叠某个窗口组
5. 打开一个新标签页
6. 验证：折叠状态保持不变
7. 点击组名进入编辑状态（input 出现但不要失焦）
8. 同时打开一个新标签页
9. 完成编辑（按 Enter 或失焦）
10. 验证：列表刷新，新标签页出现（编辑过程中跳过的刷新在编辑完成后补上）

- [ ] **Step 4: Test normal popup is unaffected**

1. 关闭独立窗口
2. 在设置中关闭"在独立窗口中打开"
3. 点击扩展图标
4. 验证：普通 popup 正常显示，不报错
