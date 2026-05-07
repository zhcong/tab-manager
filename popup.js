const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
const countEl = document.getElementById('count');
const groupCountEl = document.getElementById('groupCount');
const clearClosedBtn = document.getElementById('clearClosedBtn');
const toggleAllBtn = document.getElementById('toggleAll');
const toggleIcon = document.getElementById('toggleIcon');
const settingsBtn = document.getElementById('settingsBtn');
const newWindowBtn = document.getElementById('newWindowBtn');
const newWindowDialog = document.getElementById('newWindowDialog');
const groupNameInput = document.getElementById('groupNameInput');
const dialogCloseBtn = document.getElementById('dialogCloseBtn');
const dialogCancelBtn = document.getElementById('dialogCancelBtn');
const dialogConfirmBtn = document.getElementById('dialogConfirmBtn');

let allRecords = [];
let windowNames = {};
let closedWindowIds = [];
let isExpanded = true;
let debounceTimer = null;
let pendingRefresh = false;
let isWindowMode = false;
let windowOrder = [];
let windowColors = {};

searchEl.addEventListener('input', render);

toggleAllBtn.addEventListener('click', () => {
  isExpanded = !isExpanded;
  document.querySelectorAll('.group').forEach(g => {
    if (isExpanded) {
      g.classList.add('expanded');
    } else {
      g.classList.remove('expanded');
    }
  });
  toggleIcon.style.transform = isExpanded ? 'rotate(90deg)' : 'rotate(0deg)';
});

settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

// 新建窗口弹窗
newWindowBtn.addEventListener('click', () => {
  groupNameInput.value = '新分组';
  newWindowDialog.style.display = 'flex';
  groupNameInput.focus();
  groupNameInput.select();
});

function closeDialog() {
  newWindowDialog.style.display = 'none';
}

dialogCloseBtn.addEventListener('click', closeDialog);
dialogCancelBtn.addEventListener('click', closeDialog);
newWindowDialog.addEventListener('click', (e) => {
  if (e.target === newWindowDialog) closeDialog();
});

dialogConfirmBtn.addEventListener('click', async () => {
  const name = groupNameInput.value.trim() || '新分组';
  closeDialog();
  try {
    const win = await chrome.windows.create({ focused: true });
    await saveWindowName(String(win.id), name);
    render();
  } catch (e) {
    console.error('Failed to create window:', e);
  }
});

groupNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') dialogConfirmBtn.click();
  if (e.key === 'Escape') closeDialog();
});

// 清除已关闭窗口
clearClosedBtn.addEventListener('click', async () => {
  const result = await chrome.storage.local.get(['tabHistory', 'closedWindowIds']);
  const history = result.tabHistory || [];
  const closedIds = result.closedWindowIds || [];

  if (closedIds.length === 0) {
    render();
    return;
  }

  // 删除属于已关闭窗口的记录
  const filtered = history.filter(r => !closedIds.includes(r.windowId));
  const removedIds = new Set(closedIds);
  const newOrder = windowOrder.filter(id => !removedIds.has(id));
  const newColors = {};
  for (const [key, val] of Object.entries(windowColors)) {
    if (!removedIds.has(Number(key))) newColors[key] = val;
  }
  await chrome.storage.local.set({ tabHistory: filtered, closedWindowIds: [], windowOrder: newOrder, windowColors: newColors });
  allRecords = filtered.sort((a, b) => b.openedAt - a.openedAt);
  closedWindowIds = [];
  windowOrder = newOrder;
  windowColors = newColors;
  render();
});

async function load() {
  // 检测是否需要在独立窗口中打开（但如果是已经创建的窗口则跳过）
  const urlParams = new URLSearchParams(window.location.search);
  isWindowMode = urlParams.get('windowMode') === 'true';

  if (!isWindowMode) {
    const settings = await chrome.storage.local.get(['openInWindow', 'windowModeWindowId']);
    if (settings.openInWindow) {
      try {
        // 检查之前创建的窗口是否还存在
        if (settings.windowModeWindowId) {
          try {
            const existingWindow = await chrome.windows.get(settings.windowModeWindowId);
            if (existingWindow) {
              // 窗口存在，直接聚焦
              await chrome.windows.update(settings.windowModeWindowId, { focused: true });
              window.close();
              return;
            }
          } catch (e) {
            // 窗口不存在，继续创建新的
          }
        }

        const displays = await chrome.system.display.getInfo();
        const primary = displays.find(d => d.isPrimary) || displays[0];
        const width = Math.min(Math.floor(primary.workArea.width * 0.6), 800);
        const height = Math.min(Math.floor(primary.workArea.height * 0.7), 900);
        const newWindow = await chrome.windows.create({
          url: 'popup.html?windowMode=true',
          width,
          height,
          focused: true,
          left: Math.floor(primary.workArea.left + (primary.workArea.width - width) / 2),
          top: Math.floor(primary.workArea.top + (primary.workArea.height - height) / 2),
          type: 'popup'
        });
        // 保存窗口 ID 以便后续聚焦
        await chrome.storage.local.set({ windowModeWindowId: newWindow.id });
      } catch (e) {
        console.error('Failed to create window:', e);
      }
      window.close();
      return;
    }
  }

  // 原有的加载逻辑
  if (isWindowMode) {
    document.body.classList.add('window-mode');
  }

  const result = await chrome.storage.local.get(['tabHistory', 'windowNames', 'closedWindowIds', 'windowOrder', 'windowColors']);
  allRecords = (result.tabHistory || []).sort((a, b) => b.openedAt - a.openedAt);
  windowNames = result.windowNames || {};
  closedWindowIds = result.closedWindowIds || [];
  windowOrder = result.windowOrder || [];
  windowColors = result.windowColors || {};

  // 初次安装时加载当前所有标签页
  if (allRecords.length === 0) {
    const tabs = await chrome.tabs.query({});
    const records = [];
    const seen = new Set();
    for (const tab of tabs) {
      if (!tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;
      if (seen.has(tab.url)) continue;
      seen.add(tab.url);
      records.push({
        id: `tab-${tab.id}`,
        url: tab.url,
        title: tab.title || tab.url,
        favIconUrl: tab.favIconUrl || '',
        openedAt: Date.now(),
        windowId: tab.windowId
      });
    }
    if (records.length > 0) {
      allRecords = records.sort((a, b) => b.openedAt - a.openedAt);
      await chrome.storage.local.set({ tabHistory: allRecords });
    }
  }

  render();
  applyI18n();

  if (isWindowMode) {
    chrome.storage.onChanged.addListener(handleStorageChange);
  }
}

function handleStorageChange(changes, namespace) {
  if (namespace !== 'local') return;
  if (changes.tabHistory || changes.closedWindowIds || changes.windowNames || changes.windowColors) {
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
  if (document.querySelector('.label-input') || document.querySelector('.color-row')) {
    pendingRefresh = true;
    return;
  }

  const searchText = searchEl.value;
  const expandedStates = new Map();
  document.querySelectorAll('.group').forEach(g => {
    expandedStates.set(g.dataset.key, g.classList.contains('expanded'));
  });

  const result = await chrome.storage.local.get(['tabHistory', 'windowNames', 'closedWindowIds', 'windowOrder', 'windowColors']);
  allRecords = (result.tabHistory || []).sort((a, b) => b.openedAt - a.openedAt);
  windowNames = result.windowNames || {};
  closedWindowIds = result.closedWindowIds || [];
  windowOrder = result.windowOrder || [];
  windowColors = result.windowColors || {};

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

function applyI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.textContent = msg;
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.title = msg;
  });
}

async function deleteRecord(id) {
  const result = await chrome.storage.local.get('tabHistory');
  const history = (result.tabHistory || []).filter(r => r.id !== id);
  await chrome.storage.local.set({ tabHistory: history });
  allRecords = history.sort((a, b) => b.openedAt - a.openedAt);
  render();
}

// 保存自定义窗口名
async function saveWindowName(groupKey, name) {
  windowNames[String(groupKey)] = name;
  await chrome.storage.local.set({ windowNames });
}

function render() {
  const query = searchEl.value.toLowerCase();
  let filtered = allRecords;

  if (query) {
    filtered = filtered.filter(r =>
      r.title.toLowerCase().includes(query) ||
      r.url.toLowerCase().includes(query)
    );
  }

  const groups = new Map();
  filtered.forEach(r => {
    const wid = r.windowId != null ? r.windowId : -1;
    if (!groups.has(wid)) groups.set(wid, []);
    groups.get(wid).push(r);
  });

  countEl.textContent = filtered.length;
  const winMsg = chrome.i18n.getMessage('window');
  const winPluralMsg = chrome.i18n.getMessage('window_plural');
  groupCountEl.textContent = `${groups.size} ${groups.size === 1 ? winMsg : winPluralMsg}`;

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" opacity="0.3">
          <rect x="2" y="3" width="20" height="14" rx="2"/>
          <path d="M8 21h8M12 17v4"/>
        </svg>
        <p data-i18n="open_new_page_tip">打开新页面后将自动记录</p>
      </div>
    `;
    return;
  }

  const sortedGroups = getSortedGroups(groups);

  const colorPresets = ['#6366f1', '#8b5cf6', '#06b6d4', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#f97316', '#84cc16', '#14b8a6', '#3b82f6', '#a855f7'];

  listEl.innerHTML = sortedGroups.map((g, idx) => {
    const isClosed = closedWindowIds.includes(Number(g.key));
    const hasValidWindow = Number(g.key) > 0;
    const defaultLabel = getGroupLabel(g.records);
    const label = windowNames[String(g.key)] || defaultLabel;
    const groupColor = windowColors[String(g.key)] || colorPresets[idx % colorPresets.length];
    const sortedRecords = [...g.records].sort((a, b) => (b.tabIndex || 0) - (a.tabIndex || 0));
    const itemsHtml = sortedRecords.map(r => renderItem(r)).join('');
    const focusBtn = (!isClosed && hasValidWindow)
      ? `<button class="focus-win-btn" data-wid="${g.key}" data-i18n-title="focus_window"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C12 22 19 14 19 9a7 7 0 0 0-14 0c0 5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg></button>`
      : '';

    const openAllBtn = isClosed
      ? `<button class="open-all-btn" data-i18n="open_all">${chrome.i18n.getMessage('open_all') || 'Open All'}</button>`
      : '';
    const closeWinBtn = (isClosed && hasValidWindow)
      ? `<button class="close-win-btn" data-wid="${g.key}" data-i18n-title="clear"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`
      : '';

    const closedMsg = chrome.i18n.getMessage('closed') || '已关闭';

    return `
      <div class="group expanded" data-key="${g.key}">
        <div class="group-header" style="background:${groupColor}10">
          <span class="drag-handle" draggable="true" data-i18n-title="drag_to_reorder">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="2"/><circle cx="15" cy="5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="9" cy="19" r="2"/><circle cx="15" cy="19" r="2"/></svg>
          </span>
          <span class="chevron" data-i18n-title="toggle_collapse">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="transition: transform 0.2s ease; transform-box: fill-box; transform-origin: center;"><path d="M9 6l6 7-6 7"/></svg>
          </span>
          <span class="window-indicator" style="background-color:${groupColor}"></span>
          <span class="window-label" data-key="${g.key}" data-default="${escapeHtml(defaultLabel)}">${escapeHtml(label)}</span>
          ${isClosed ? `<span class="closed-win-badge">${closedMsg}</span>` : ''}
          <span class="window-count">${g.records.length}</span>
          ${focusBtn}
          ${openAllBtn}
          ${closeWinBtn}
        </div>
        <div class="group-items">${itemsHtml}</div>
      </div>
    `;
  }).join('');

  // 组折叠
  listEl.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', (e) => {
      if (e.target.closest('.open-all-btn') || e.target.closest('.focus-win-btn') || e.target.closest('.window-label') || e.target.closest('.label-input') || e.target.closest('.drag-handle') || e.target.closest('.window-indicator')) return;
      header.parentElement.classList.toggle('expanded');
    });
  });

  // 切换到窗口
  listEl.querySelectorAll('.focus-win-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.windows.update(Number(btn.dataset.wid), { focused: true });
    });
  });

  // 清除已关闭窗口记录
  listEl.querySelectorAll('.close-win-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const wid = Number(btn.dataset.wid);
      const result = await chrome.storage.local.get(['tabHistory', 'closedWindowIds']);
      const history = (result.tabHistory || []).filter(r => r.windowId !== wid);
      const closedIds = (result.closedWindowIds || []).filter(id => id !== wid);
      const newOrder = windowOrder.filter(id => id !== wid);
      const newColors = { ...windowColors };
      delete newColors[String(wid)];
      await chrome.storage.local.set({ tabHistory: history, closedWindowIds: closedIds, windowOrder: newOrder, windowColors: newColors });
      allRecords = history.sort((a, b) => b.openedAt - a.openedAt);
      closedWindowIds = closedIds;
      windowOrder = newOrder;
      windowColors = newColors;
      render();
    });
  });

  // 打开全部（在新窗口中）
  listEl.querySelectorAll('.open-all-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const group = btn.closest('.group');
      const oldWindowId = Number(group.dataset.key);
      const urls = [...group.querySelectorAll('.item')].map(item => item.dataset.url);

      // 在新窗口中打开全部
      await chrome.windows.create({ url: urls });

      // 删除旧窗口的记录，并从 closedWindowIds 中移除
      const result = await chrome.storage.local.get(['tabHistory', 'closedWindowIds']);
      const history = (result.tabHistory || []).filter(r => r.windowId !== oldWindowId);
      const closedIds = (result.closedWindowIds || []).filter(id => id !== oldWindowId);
      const newOrder = windowOrder.filter(id => id !== oldWindowId);
      const newColors = { ...windowColors };
      delete newColors[String(oldWindowId)];
      await chrome.storage.local.set({ tabHistory: history, closedWindowIds: closedIds, windowOrder: newOrder, windowColors: newColors });

      allRecords = history.sort((a, b) => b.openedAt - a.openedAt);
      closedWindowIds = closedIds;
      windowOrder = newOrder;
      windowColors = newColors;
      render();
    });
  });

  // 可编辑组名
  listEl.querySelectorAll('.window-label').forEach(labelEl => {
    labelEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = labelEl.textContent;
      const groupKey = labelEl.dataset.key;
      const input = document.createElement('input');
      input.className = 'label-input';
      input.value = current;
      input.dataset.key = groupKey;

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

      input.addEventListener('blur', finish);
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { input.blur(); }
        if (ev.key === 'Escape') {
          input.value = labelEl.dataset.default;
          input.blur();
        }
      });

      labelEl.style.display = 'none';
      labelEl.parentElement.insertBefore(input, labelEl.nextElementSibling);
      input.focus();
      input.select();
    });
  });

  // 点击 item 打开
  listEl.querySelectorAll('.item').forEach(item => {
    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-btn')) return;
      const url = item.dataset.url;
      const windowId = Number(item.closest('.group').dataset.key);
      const isClosed = closedWindowIds.includes(windowId);
      const tabId = Number(item.dataset.id.replace('tab-', ''));

      if (isClosed) {
        chrome.tabs.create({ url });
      } else {
        const normalizeUrl = u => u.replace(/\/$/, '').toLowerCase();

        chrome.tabs.get(tabId, tab => {
          if (chrome.runtime.lastError || !tab) {
            chrome.tabs.query({}).then(allTabs => {
              const matched = allTabs.find(t => normalizeUrl(t.url) === normalizeUrl(url));
              if (matched) {
                if (matched.windowId === chrome.windows.WINDOW_ID_CURRENT) {
                  chrome.tabs.update(matched.id, { active: true });
                } else {
                  chrome.windows.update(matched.windowId, { focused: true }, () => {
                    chrome.tabs.update(matched.id, { active: true });
                  });
                }
              } else {
                chrome.tabs.create({ url });
              }
            });
            return;
          }

          const isUrlMatched = normalizeUrl(tab.url) === normalizeUrl(url);

          if (isUrlMatched) {
            chrome.windows.getCurrent(win => {
              if (win.id === tab.windowId) {
                chrome.tabs.update(tab.id, { active: true });
              } else {
                chrome.windows.update(tab.windowId, { focused: true }, () => {
                  chrome.tabs.update(tab.id, { active: true });
                });
              }
            });
          } else {
            chrome.tabs.query({}).then(allTabs => {
              const matched = allTabs.find(t => normalizeUrl(t.url) === normalizeUrl(url));
              if (matched) {
                if (matched.windowId === chrome.windows.WINDOW_ID_CURRENT) {
                  chrome.tabs.update(matched.id, { active: true });
                } else {
                  chrome.windows.update(matched.windowId, { focused: true }, () => {
                    chrome.tabs.update(matched.id, { active: true });
                  });
                }
              } else {
                chrome.tabs.create({ url });
              }
            });
          }
        });
      }
    });

    // hover 轮播文本（各自独立）
    const titleEl = item.querySelector('.title');
    const urlEl = item.querySelector('.url');

    if (titleEl) {
      titleEl.addEventListener('mouseenter', () => checkMarquee(item, titleEl, 'marquee-title'));
      titleEl.addEventListener('mouseleave', () => item.classList.remove('marquee-title'));
    }
    if (urlEl) {
      urlEl.addEventListener('mouseenter', () => checkMarquee(item, urlEl, 'marquee-url'));
      urlEl.addEventListener('mouseleave', () => item.classList.remove('marquee-url'));
    }
  });

  // 删除单条（关闭标签页）
  listEl.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const tabId = Number(btn.dataset.id.replace('tab-', ''));
      try {
        await chrome.tabs.remove(tabId);
      } catch {
        deleteRecord(btn.dataset.id);
      }
    });
  });

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

  // 小圆点颜色选择
  listEl.querySelectorAll('.window-indicator').forEach(dot => {
    dot.addEventListener('click', (e) => {
      e.stopPropagation();
      const group = dot.closest('.group');
      const groupKey = group.dataset.key;
      const existingRow = group.querySelector('.color-row');

      document.querySelectorAll('.color-row').forEach(r => {
        if (r !== existingRow) r.remove();
      });

      if (existingRow) {
        existingRow.remove();
        if (pendingRefresh) {
          pendingRefresh = false;
          scheduleRefresh();
        }
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
        const headerEl = group.querySelector('.group-header');
        if (headerEl) headerEl.style.background = color + '10';
        colorRow.remove();
        if (pendingRefresh) {
          pendingRefresh = false;
          scheduleRefresh();
        }
      });

      const header = group.querySelector('.group-header');
      header.after(colorRow);
    });
  });
}

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

function renderItem(r) {
  const timeStr = formatTime(r.openedAt);
  const displayHost = extractHost(r.url);
  const firstChar = displayHost.charAt(0).toUpperCase();

  const iconHtml = r.favIconUrl
    ? `<img src="${escapeHtml(r.favIconUrl)}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" crossorigin="anonymous"><div class="fallback-icon" style="display:none">${firstChar}</div>`
    : `<div class="fallback-icon">${firstChar}</div>`;

  return `
    <div class="item" data-id="${escapeHtml(r.id)}" data-url="${escapeHtml(r.url)}">
      ${iconHtml}
      <div class="info">
        <div class="title"><span class="text-inner">${escapeHtml(r.title)}</span></div>
        <div class="url"><span class="text-inner">${escapeHtml(r.url)}</span></div>
      </div>
      <span class="time">${timeStr}</span>
      <button class="delete-btn" data-id="${escapeHtml(r.id)}" data-i18n-title="delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `;
}

function getGroupLabel(records) {
  const domainCount = {};
  records.forEach(r => {
    const host = extractHost(r.url);
    domainCount[host] = (domainCount[host] || 0) + 1;
  });
  let topDomain = '';
  let maxCount = 0;
  for (const [host, count] of Object.entries(domainCount)) {
    if (count > maxCount) {
      maxCount = count;
      topDomain = host;
    }
  }
  return topDomain || '新窗口';
}

function checkMarquee(item, container, className) {
  const inner = container.querySelector('.text-inner');
  if (!inner) return;
  const overflow = inner.scrollWidth - container.clientWidth;
  if (overflow > 5) {
    inner.style.setProperty('--scroll-amount', `-${overflow}px`);
    item.classList.add(className);
  }
}

function formatTime(ts) {
  const now = Date.now();
  const diff = now - ts;
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function extractHost(url) {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

load();
