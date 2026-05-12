const MAX_HISTORY = 500;

// 跟踪 tab→window 映射，用于区分窗口关闭和单标签关闭
const tabWindowMap = new Map();
let pendingRemovals = new Map();
let removalTimer = null;

// 记录 tab 所属窗口
function trackTab(tabId, windowId) {
  if (tabId && windowId != null) {
    tabWindowMap.set(tabId, windowId);
  }
}

// --- 会话持久化 ---

setInterval(async () => {
  const history = await getHistory();
  if (history.length > 0) {
    await chrome.storage.local.set({ sessionSnapshot: history });
  }
}, 15000);

// 标签页关闭时：延迟判断是窗口关闭还是单标签关闭
chrome.tabs.onRemoved.addListener((tabId) => {
  const windowId = tabWindowMap.get(tabId);
  tabWindowMap.delete(tabId);

  if (windowId == null) {
    // 不知道属于哪个窗口，直接删除
    removeRecord(`tab-${tabId}`);
    return;
  }

  if (!pendingRemovals.has(windowId)) pendingRemovals.set(windowId, []);
  pendingRemovals.get(windowId).push(tabId);

  if (removalTimer) clearTimeout(removalTimer);

  removalTimer = setTimeout(async () => {
    const batch = new Map(pendingRemovals);
    pendingRemovals.clear();
    removalTimer = null;

    for (const [wid, tabIds] of batch) {
      try {
        await chrome.windows.get(wid);
        // 窗口还在 → 单个标签关闭 → 删除
        for (const tid of tabIds) {
          await removeRecord(`tab-${tid}`);
        }
      } catch {
        // 窗口已关闭 → 保留记录，标记窗口为已关闭
        await markWindowClosed(wid);
      }
    }
  }, 600);
});

// 窗口关闭时直接标记
chrome.windows.onRemoved.addListener((windowId) => {
  markWindowClosed(windowId);
});

// Chrome 启动时恢复
chrome.runtime.onStartup.addListener(async () => {
  const result = await chrome.storage.local.get(['sessionSnapshot', 'closedWindowIds']);
  const snapshot = result.sessionSnapshot || [];
  if (snapshot.length === 0) return;

  await new Promise(r => setTimeout(r, 3000));

  const openTabs = await chrome.tabs.query({});
  const openUrls = new Set(openTabs.map(t => t.url));
  const openWindowIds = new Set(openTabs.map(t => t.windowId));

  // 重建 tab→window 映射
  openTabs.forEach(t => { if (t.id && t.windowId != null) tabWindowMap.set(t.id, t.windowId); });

  const history = [];
  const seenUrls = new Set();
  const closedIds = result.closedWindowIds || [];

  for (const tab of openTabs) {
    if (!tab.url || tab.url.startsWith('chrome://')) continue;
    if (seenUrls.has(tab.url)) continue;
    seenUrls.add(tab.url);
    history.push({
      id: `tab-${tab.id}`,
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
      openedAt: Date.now(),
      windowId: tab.windowId,
      tabIndex: tab.index
    });
  }

  for (const r of snapshot) {
    if (!seenUrls.has(r.url)) {
      seenUrls.add(r.url);
      if (r.windowId != null && !openWindowIds.has(r.windowId) && !closedIds.includes(r.windowId)) {
        closedIds.push(r.windowId);
      }
      history.push(r);
    }
  }

  if (closedIds.length > 0) {
    await chrome.storage.local.set({ closedWindowIds: closedIds });
  }
  await setHistory(history);
  await chrome.storage.local.remove('sessionSnapshot');
});

// --- 标签页事件 ---

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
  if (changeInfo.url || changeInfo.title || changeInfo.favIconUrl || changeInfo.status === 'complete') {
    trackTab(tabId, tab.windowId);
    upsertRecord(`tab-${tabId}`, {
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
      windowId: tab.windowId,
      tabIndex: tab.index
    });
  }
});

chrome.tabs.onAttached.addListener((tabId, attachInfo) => {
  tabWindowMap.set(tabId, attachInfo.newWindowId);
  updateWindow(`tab-${tabId}`, attachInfo.newWindowId);
});

chrome.tabs.onMoved.addListener((tabId, moveInfo) => {
  chrome.tabs.get(tabId, (tab) => {
    if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;
    trackTab(tabId, tab.windowId);
    upsertRecord(`tab-${tabId}`, {
      url: tab.url,
      title: tab.title || tab.url,
      favIconUrl: tab.favIconUrl || '',
      windowId: tab.windowId,
      tabIndex: tab.index
    });
  });
});

// --- Storage 操作 ---

function getHistory() {
  return chrome.storage.local.get('tabHistory').then(r => r.tabHistory || []);
}

function setHistory(history) {
  return chrome.storage.local.set({ tabHistory: history });
}

function getClosedWindows() {
  return chrome.storage.local.get('closedWindowIds').then(r => r.closedWindowIds || []);
}

async function markWindowClosed(windowId) {
  const result = await chrome.storage.local.get(['keepClosedGroups']);
  const keepClosed = result.keepClosedGroups !== false;

  if (!keepClosed) {
    const history = await getHistory();
    const filtered = history.filter(r => r.windowId !== windowId);
    if (filtered.length !== history.length) {
      await setHistory(filtered);
    }
    return;
  }

  const ids = await getClosedWindows();
  if (!ids.includes(windowId)) {
    ids.push(windowId);
    await chrome.storage.local.set({ closedWindowIds: ids });
  }
}

async function shouldSaveUrl(url) {
  const result = await chrome.storage.local.get(['urlIncludeKeywords', 'urlExcludeKeywords']);
  const include = result.urlIncludeKeywords || [];
  const exclude = result.urlExcludeKeywords || [];

  if (exclude.length > 0 && exclude.some(kw => url.includes(kw))) {
    return false;
  }
  if (include.length > 0 && !include.some(kw => url.includes(kw))) {
    return false;
  }
  return true;
}

async function upsertRecord(id, data) {
  if (!await shouldSaveUrl(data.url)) return;

  const history = await getHistory();
  const idx = history.findIndex(r => r.id === id);
  if (idx !== -1) {
    Object.assign(history[idx], {
      url: data.url,
      title: data.title,
      favIconUrl: data.favIconUrl,
      windowId: data.windowId,
      tabIndex: data.tabIndex
    });
  } else {
    history.push({
      id,
      url: data.url,
      title: data.title,
      favIconUrl: data.favIconUrl || '',
      openedAt: Date.now(),
      windowId: data.windowId,
      tabIndex: data.tabIndex
    });
    while (history.length > MAX_HISTORY) history.shift();
  }
  await setHistory(history);
}

async function updateWindow(id, windowId) {
  const history = await getHistory();
  const idx = history.findIndex(r => r.id === id);
  if (idx !== -1) {
    history[idx].windowId = windowId;
    await setHistory(history);
  }
}

async function removeRecord(id) {
  const history = await getHistory();
  const filtered = history.filter(r => r.id !== id);
  if (filtered.length !== history.length) {
    await setHistory(filtered);
  }
}
