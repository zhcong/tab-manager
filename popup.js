const listEl = document.getElementById('list');
const searchEl = document.getElementById('search');
const searchStatusEl = document.getElementById('searchStatus');
const countEl = document.getElementById('count');
const groupCountEl = document.getElementById('groupCount');
const clearClosedBtn = document.getElementById('clearClosedBtn');
const toggleAllBtn = document.getElementById('toggleAll');
const toggleIcon = document.getElementById('toggleIcon');
const settingsBtn = document.getElementById('settingsBtn');
const newWindowBtn = document.getElementById('newWindowBtn');
const autoNameBtn = document.getElementById('autoNameBtn');
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
let collapsedWindows = [];
let localModelNaming = false;
let aiDuplicateDetection = true;
let aiCloseSuggestions = true;
let aiSmartSearch = true;
let aiSemanticSearch = false;
let aiSearchResults = new Map();
let aiSearchLoading = false;
let aiSearchTimer = null;
let aiSearchRequestId = 0;
let aiSearchError = '';
let namingGroups = new Set();
let activeChromeWindowId = null;

searchEl.addEventListener('input', () => {
  aiSearchResults = new Map();
  aiSearchError = '';
  render();
  scheduleAiSemanticSearch();
});

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

autoNameBtn.addEventListener('click', async () => {
  const groups = getCurrentGroups();
  if (groups.length === 0) return;
  autoNameBtn.disabled = true;
  try {
    for (const group of groups) {
      await nameGroupWithLocalModel(group.key, group.records);
    }
  } finally {
    autoNameBtn.disabled = false;
  }
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

  const result = await chrome.storage.local.get([
    'tabHistory',
    'windowNames',
    'closedWindowIds',
    'windowOrder',
    'windowColors',
    'collapsedWindows',
    'localModelNaming',
    'aiDuplicateDetection',
    'aiCloseSuggestions',
    'aiSmartSearch',
    'aiSemanticSearch'
  ]);
  allRecords = (result.tabHistory || []).sort((a, b) => b.openedAt - a.openedAt);
  windowNames = result.windowNames || {};
  closedWindowIds = result.closedWindowIds || [];
  windowOrder = result.windowOrder || [];
  windowColors = result.windowColors || {};
  collapsedWindows = result.collapsedWindows || [];
  localModelNaming = result.localModelNaming === true;
  aiDuplicateDetection = result.aiDuplicateDetection !== false;
  aiCloseSuggestions = result.aiCloseSuggestions !== false;
  aiSmartSearch = result.aiSmartSearch !== false;
  aiSemanticSearch = result.aiSemanticSearch === true;
  await refreshActiveChromeWindow();

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
    if (chrome.windows?.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener(handleWindowFocusChanged);
    }
  }
}

async function refreshActiveChromeWindow() {
  try {
    const focusedWindow = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    activeChromeWindowId = focusedWindow?.focused ? focusedWindow.id : null;
  } catch {
    activeChromeWindowId = null;
  }
}

async function handleWindowFocusChanged(windowId) {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    activeChromeWindowId = null;
    render();
    return;
  }

  try {
    const focusedWindow = await chrome.windows.get(windowId);
    activeChromeWindowId = focusedWindow?.type === 'normal' && focusedWindow.focused ? windowId : null;
  } catch {
    activeChromeWindowId = null;
  }
  render();
}

function handleStorageChange(changes, namespace) {
  if (namespace !== 'local') return;
  if (changes.localModelNaming) {
    localModelNaming = changes.localModelNaming.newValue === true;
  }
  if (changes.aiDuplicateDetection) {
    aiDuplicateDetection = changes.aiDuplicateDetection.newValue !== false;
  }
  if (changes.aiCloseSuggestions) {
    aiCloseSuggestions = changes.aiCloseSuggestions.newValue !== false;
  }
  if (changes.aiSmartSearch) {
    aiSmartSearch = changes.aiSmartSearch.newValue !== false;
  }
  if (changes.aiSemanticSearch) {
    aiSemanticSearch = changes.aiSemanticSearch.newValue === true;
    aiSearchResults = new Map();
    aiSearchError = '';
    scheduleAiSemanticSearch();
  }
  if (changes.tabHistory || changes.closedWindowIds || changes.windowNames || changes.windowColors || changes.windowOrder || changes.collapsedWindows || changes.localModelNaming || changes.aiDuplicateDetection || changes.aiCloseSuggestions || changes.aiSmartSearch || changes.aiSemanticSearch) {
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

  const result = await chrome.storage.local.get([
    'tabHistory',
    'windowNames',
    'closedWindowIds',
    'windowOrder',
    'windowColors',
    'collapsedWindows',
    'localModelNaming',
    'aiDuplicateDetection',
    'aiCloseSuggestions',
    'aiSmartSearch',
    'aiSemanticSearch'
  ]);
  allRecords = (result.tabHistory || []).sort((a, b) => b.openedAt - a.openedAt);
  windowNames = result.windowNames || {};
  closedWindowIds = result.closedWindowIds || [];
  windowOrder = result.windowOrder || [];
  windowColors = result.windowColors || {};
  collapsedWindows = result.collapsedWindows || [];
  localModelNaming = result.localModelNaming === true;
  aiDuplicateDetection = result.aiDuplicateDetection !== false;
  aiCloseSuggestions = result.aiCloseSuggestions !== false;
  aiSmartSearch = result.aiSmartSearch !== false;
  aiSemanticSearch = result.aiSemanticSearch === true;
  await refreshActiveChromeWindow();

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
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.dataset.i18nPlaceholder;
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.placeholder = msg;
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
  await ensureWindowOrderStable();
  windowNames[String(groupKey)] = name;
  await chrome.storage.local.set({ windowNames, windowOrder });
}

async function ensureWindowOrderStable() {
  if (windowOrder.length > 0) return;

  const groups = new Map();
  allRecords.forEach(record => {
    const wid = record.windowId != null ? record.windowId : -1;
    if (!groups.has(wid)) groups.set(wid, []);
    groups.get(wid).push(record);
  });

  windowOrder = getSortedGroups(groups).map(group => Number(group.key));
}

async function nameGroupWithLocalModel(groupKey, records) {
  const key = String(groupKey);
  if (!localModelNaming || namingGroups.has(key)) return;

  namingGroups.add(key);
  render();

  try {
    const name = await generateGroupName(records);
    if (name) {
      await saveWindowName(key, name);
    }
  } catch (error) {
    console.warn('Local model naming failed:', error);
    showToast(chrome.i18n.getMessage('local_model_unavailable') || 'Local model is unavailable');
  } finally {
    namingGroups.delete(key);
    render();
  }
}

async function generateGroupName(records) {
  const session = await createLocalModelSession('你是一个浏览器标签页分组命名助手，只返回短小、清晰的分组名称。');
  const language = (chrome.i18n.getUILanguage && chrome.i18n.getUILanguage()) || navigator.language || 'zh-CN';
  const titles = buildWeightedTitleLines(records);

  const prompt = [
    `请根据下面这些浏览器标签页标题，为这个标签页分组生成一个简短名称。`,
    `重复的标题已经合并为一行，并用“出现 N 次”表示。每行都带有权重分，权重越高说明标题越能代表这个分组。请优先参考高权重标题和高出现次数标题，但忽略重复词、站点后缀、任务编号、无意义导航词。`,
    `要求：使用 ${language}；只输出名称本身；3 到 12 个汉字或 2 到 6 个英文单词；不要解释，不要引号，不要编号。`,
    '',
    titles
  ].join('\n');

  try {
    const response = await session.prompt(prompt);
    return cleanModelTitle(response) || getGroupLabel(records);
  } finally {
    if (typeof session.destroy === 'function') {
      session.destroy();
    }
  }
}

function buildWeightedTitleLines(records) {
  const domainCount = {};
  const titleTerms = {};
  records.forEach(r => {
    const host = extractHost(r.url);
    domainCount[host] = (domainCount[host] || 0) + 1;
    getMeaningfulTerms(r.title).forEach(term => {
      titleTerms[term] = (titleTerms[term] || 0) + 1;
    });
  });

  const mergedTitleMap = new Map();
  records.forEach((record, index) => {
      const title = normalizeTitle(record.title || extractHost(record.url));
    if (!title) return;
      const host = extractHost(record.url);
      const terms = getMeaningfulTerms(title);
      const lengthScore = Math.min(Math.max(title.length - 8, 0), 80) / 80;
      const domainScore = Math.min(domainCount[host] || 1, 6) / 6;
      const repeatedTermScore = Math.min(terms.filter(term => titleTerms[term] > 1).length, 5) / 5;
      const specificSignalScore = hasSpecificSignal(title) ? 0.16 : 0;
      const noisePenalty = getTitleNoisePenalty(title);
      const positionScore = Math.max(0, 1 - index / Math.max(records.length, 1)) * 0.08;
    const baseWeight = Math.round((0.32 + lengthScore * 0.22 + domainScore * 0.2 + repeatedTermScore * 0.22 + specificSignalScore + positionScore - noisePenalty) * 100);
    const normalizedTitleKey = normalizeForSearch(title);
    const existing = mergedTitleMap.get(normalizedTitleKey);

    if (existing) {
      existing.count += 1;
      existing.weight = Math.max(existing.weight, baseWeight);
      existing.hosts.add(host);
    } else {
      mergedTitleMap.set(normalizedTitleKey, {
        title,
        weight: baseWeight,
        count: 1,
        hosts: new Set([host])
      });
    }
  });

  return [...mergedTitleMap.values()]
    .map(item => ({
      ...item,
      weight: Math.max(10, Math.min(item.weight + Math.min(item.count - 1, 5) * 6, 100))
    }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 18)
    .map((item, index) => {
      const countText = item.count > 1 ? `，出现 ${item.count} 次` : '';
      const hosts = [...item.hosts].slice(0, 3).join(', ');
      return `${index + 1}. [权重 ${item.weight}${countText}] ${item.title} (${hosts})`;
    })
    .join('\n');
}

function normalizeTitle(title) {
  return String(title || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*[-|—–]\s*(Google Chrome|Chrome|飞书|Lark|GitHub|GitLab|Google Search|百度搜索|Bing)$/i, '')
    .replace(/^\(\d+\)\s*/, '')
    .trim();
}

function getMeaningfulTerms(title) {
  const normalized = normalizeForSearch(title);
  const rawTerms = normalized.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9][a-z0-9_-]{1,}/g) || [];
  const stopWords = new Set([
    'www', 'com', 'http', 'https', 'html', 'page', 'home', 'index',
    'chrome', 'google', 'search', 'github', 'gitlab', 'lark', 'feishu',
    '任务', '页面', '搜索', '文档', '首页', '平台'
  ]);
  return rawTerms.filter(term => !stopWords.has(term) && term.length > 1);
}

function hasSpecificSignal(title) {
  return /(#\d+|[A-Z]+-\d+|\bPR\b|\bMR\b|\bRFC\b|需求|缺陷|修复|方案|设计|项目|任务|审批|会议|代码|发布|bug|fix|feat|docs?)/i.test(title);
}

function getTitleNoisePenalty(title) {
  let penalty = 0;
  if (/^\s*(new tab|新标签页|about:blank)\s*$/i.test(title)) penalty += 0.35;
  if (/(搜索|search|百度一下|Google Search)$/i.test(title)) penalty += 0.12;
  if (title.length > 120) penalty += 0.08;
  return penalty;
}

async function createLocalModelSession(systemPrompt = '你是一个浏览器标签页助手。') {
  const languageModel = globalThis.LanguageModel;

  if (languageModel && typeof languageModel.availability === 'function' && typeof languageModel.create === 'function') {
    const availability = await languageModel.availability();
    if (availability === 'unavailable') {
      throw new Error('Chrome local model is unavailable');
    }
    try {
      return await languageModel.create({ systemPrompt });
    } catch {
      return await languageModel.create();
    }
  }

  const ai = globalThis.ai || (globalThis.chrome && globalThis.chrome.ai);
  if (ai && ai.languageModel && typeof ai.languageModel.create === 'function') {
    return ai.languageModel.create();
  }
  if (ai && typeof ai.canCreateTextSession === 'function' && typeof ai.createTextSession === 'function') {
    const canCreate = await ai.canCreateTextSession();
    if (canCreate === 'no') {
      throw new Error('Chrome local model text session is unavailable');
    }
    return ai.createTextSession();
  }

  throw new Error('Chrome local model API is not available in this browser');
}

function cleanModelTitle(value) {
  if (!value) return '';
  return String(value)
    .replace(/^[\s"'“”‘’`*_#-]+|[\s"'“”‘’`*_#-]+$/g, '')
    .replace(/^(名称|分组名|标题)\s*[:：]\s*/i, '')
    .split('\n')[0]
    .trim()
    .slice(0, 28);
}

function showToast(message) {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 180);
  }, 2600);
}

function updateSearchStatus(query, aiAddedCount) {
  if (!query || !aiSemanticSearch) {
    searchStatusEl.style.display = 'none';
    searchStatusEl.textContent = '';
    searchStatusEl.className = 'search-status';
    return;
  }

  searchStatusEl.className = 'search-status';
  if (aiSearchLoading) {
    searchStatusEl.style.display = 'flex';
    searchStatusEl.classList.add('loading');
    searchStatusEl.textContent = chrome.i18n.getMessage('ai_searching') || 'AI 搜索中...';
    return;
  }

  if (aiSearchError) {
    searchStatusEl.style.display = 'flex';
    searchStatusEl.classList.add('error');
    searchStatusEl.textContent = aiSearchError;
    return;
  }

  if (aiAddedCount > 0) {
    searchStatusEl.style.display = 'flex';
    searchStatusEl.classList.add('ready');
    const template = chrome.i18n.getMessage('ai_search_added') || '已补充 $1 个 AI 匹配结果';
    searchStatusEl.textContent = template.replace('$1', String(aiAddedCount));
    return;
  }

  searchStatusEl.style.display = 'none';
  searchStatusEl.textContent = '';
}

function scheduleAiSemanticSearch() {
  if (aiSearchTimer) clearTimeout(aiSearchTimer);
  const query = searchEl.value.trim();

  if (!aiSemanticSearch || query.length < 2) {
    aiSearchLoading = false;
    aiSearchResults = new Map();
    aiSearchError = '';
    aiSearchRequestId += 1;
    render();
    return;
  }

  const requestId = ++aiSearchRequestId;
  aiSearchLoading = true;
  aiSearchError = '';
  render();

  aiSearchTimer = setTimeout(async () => {
    try {
      const results = await runAiSemanticSearch(query);
      if (requestId !== aiSearchRequestId || query !== searchEl.value.trim()) return;
      aiSearchResults = results;
      aiSearchError = '';
    } catch (error) {
      if (requestId !== aiSearchRequestId) return;
      console.warn('AI semantic search failed:', error);
      aiSearchResults = new Map();
      aiSearchError = chrome.i18n.getMessage('ai_search_unavailable') || 'AI search unavailable';
    } finally {
      if (requestId === aiSearchRequestId) {
        aiSearchLoading = false;
        render();
      }
    }
  }, 700);
}

async function runAiSemanticSearch(query) {
  const candidates = buildAiSearchCandidates(query);
  if (candidates.length === 0) return new Map();

  const session = await createLocalModelSession('你是一个浏览器标签页语义搜索助手。你只能从给定候选标签页中选择相关项，并且只返回 JSON。');
  const candidateText = candidates.map((item, index) => [
    `${index + 1}. id: ${item.id}`,
    `title: ${item.title}`,
    `domain: ${item.domain}`,
    `path: ${item.path}`
  ].join('\n')).join('\n\n');

  const prompt = [
    `用户正在搜索浏览器标签页。请从候选标签页中找出与查询语义相关的项目。`,
    `查询：${query}`,
    `要求：只返回 JSON，不要解释。JSON 格式为 {"matches":[{"id":"tab-123","score":0.86,"reason":"简短原因"}]}。`,
    `score 范围 0 到 1，只返回 score >= 0.55 的项目，最多返回 12 个。id 必须来自候选列表。`,
    '',
    `候选标签页：`,
    candidateText
  ].join('\n');

  try {
    const response = await session.prompt(prompt);
    return parseAiSearchResponse(response, new Set(candidates.map(item => item.id)));
  } finally {
    if (typeof session.destroy === 'function') {
      session.destroy();
    }
  }
}

function buildAiSearchCandidates(query) {
  const normalMatches = allRecords.filter(record => smartMatchRecord(record, query));
  const normalIds = new Set(normalMatches.map(record => record.id));
  const recentFallback = allRecords
    .filter(record => !normalIds.has(record.id))
    .slice()
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, 50);

  return [...normalMatches.slice(0, 30), ...recentFallback]
    .slice(0, 60)
    .map(record => ({
      id: record.id,
      title: normalizeTitle(record.title || record.url).slice(0, 120),
      domain: extractHost(record.url),
      path: getUrlPath(record.url).slice(0, 120)
    }));
}

function parseAiSearchResponse(response, allowedIds) {
  const jsonText = extractJsonText(response);
  const data = JSON.parse(jsonText);
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const result = new Map();

  matches.forEach(match => {
    const id = String(match.id || '');
    const score = Number(match.score);
    if (!allowedIds.has(id) || Number.isNaN(score) || score < 0.55) return;
    result.set(id, {
      score: Math.min(Math.max(score, 0), 1),
      reason: String(match.reason || '').slice(0, 80)
    });
  });

  return result;
}

function extractJsonText(value) {
  const text = String(value || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return text.slice(start, end + 1);
  }
  return text;
}

function getUrlPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url || '';
  }
}

function analyzeTabSignals(records) {
  const byNormalizedUrl = new Map();

  const signals = new Map();
  const ensureSignal = id => {
    if (!signals.has(id)) {
      signals.set(id, { duplicate: false, closeSuggested: false, reasons: [] });
    }
    return signals.get(id);
  };

  if (aiDuplicateDetection || aiCloseSuggestions) {
    records.forEach(record => {
      const urlKey = normalizeUrlForCompare(record.url);

      if (urlKey) {
        if (!byNormalizedUrl.has(urlKey)) byNormalizedUrl.set(urlKey, []);
        byNormalizedUrl.get(urlKey).push(record);
      }
    });
  }

  if (aiDuplicateDetection) {
    byNormalizedUrl.forEach(group => {
      if (group.length < 2) return;
      const sorted = [...group].sort((a, b) => b.openedAt - a.openedAt);
      sorted.slice(1).forEach(record => {
        const signal = ensureSignal(record.id);
        signal.duplicate = true;
        signal.reasons.push(chrome.i18n.getMessage('duplicate_tab') || '重复');
      });
    });
  }

  if (aiCloseSuggestions) {
    byNormalizedUrl.forEach(group => {
      if (group.length < 2) return;
      const sorted = [...group].sort((a, b) => b.openedAt - a.openedAt);
      sorted.slice(1).forEach(record => {
        const signal = ensureSignal(record.id);
        signal.closeSuggested = true;
        signal.reasons.push(chrome.i18n.getMessage('suggest_close') || '建议关闭');
      });
    });

    records.forEach(record => {
      const signal = ensureSignal(record.id);
      if (isLowValueTab(record)) {
        signal.closeSuggested = true;
        signal.reasons.push(chrome.i18n.getMessage('suggest_close') || '建议关闭');
      }
      if (!signal.duplicate && !signal.closeSuggested) {
        signals.delete(record.id);
      }
    });
  }

  return signals;
}

function isLowValueTab(record) {
  const title = normalizeForSearch(record.title);
  const url = record.url || '';
  const host = extractHost(url);

  if (/^(new tab|about blank|新标签页|空白页)$/.test(title)) return true;
  if (/^(google\.[^/]+|bing\.com|baidu\.com|duckduckgo\.com)$/.test(host) && /[?&](q|wd|query)=/.test(url)) return true;
  if (/(search|results|s\?wd=|\/search\?)/i.test(url) && title.length < 32) return true;
  return false;
}

function normalizeUrlForCompare(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'spm', 'from', 'ref', 'ref_src', 'fbclid', 'gclid'
    ].forEach(key => parsed.searchParams.delete(key));
    const searchParams = [...parsed.searchParams.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('&');
    const pathname = decodeURIComponent(parsed.pathname).replace(/\/$/, '');
    return `${parsed.hostname.replace(/^www\./, '')}${pathname}${searchParams ? `?${searchParams}` : ''}`.toLowerCase();
  } catch {
    return String(url || '').replace(/\/$/, '').toLowerCase();
  }
}

function smartMatchRecord(record, query) {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return true;

  const corpus = buildSearchCorpus(record);
  if (corpus.includes(normalizedQuery)) return true;
  if (!aiSmartSearch) return false;

  const queryTerms = expandSearchTerms(normalizedQuery);
  if (queryTerms.length === 0) return true;

  return queryTerms.every(term =>
    corpus.includes(term) ||
    isSubsequence(term, corpus) ||
    getSearchAliases(term).some(alias => corpus.includes(alias))
  );
}

function buildSearchCorpus(record) {
  const host = extractHost(record.url);
  const title = normalizeTitle(record.title || '');
  const parts = [
    title,
    record.url,
    host,
    host.replace(/\./g, ' '),
    getAcronym(title),
    getSearchIntentText(title, record.url)
  ];
  return normalizeForSearch(parts.join(' '));
}

function expandSearchTerms(query) {
  const terms = query.match(/[\u4e00-\u9fa5]{1,}|[a-z0-9][a-z0-9_-]*/g) || [];
  return [...new Set(terms.flatMap(term => [term, ...getSearchAliases(term)]))].filter(Boolean);
}

function getSearchAliases(term) {
  const aliases = {
    pr: ['pull request', 'github', 'merge request'],
    mr: ['merge request', 'gitlab'],
    代码: ['code', 'github', 'gitlab', 'codem'],
    文档: ['doc', 'docs', 'docx', 'lark', '飞书'],
    任务: ['task', 'issue', 'meego', 'codem', 'jira'],
    bug: ['fix', 'issue', '缺陷', '修复'],
    修复: ['fix', 'bug', 'issue'],
    会议: ['meeting', 'minutes', '日程'],
    搜索: ['search', 'google', 'bing', 'baidu']
  };
  return aliases[term] || [];
}

function getSearchIntentText(title, url) {
  const text = `${title} ${url}`.toLowerCase();
  const tags = [];
  if (/github|gitlab|pull|merge|commit|branch|pr\b|mr\b/.test(text)) tags.push('代码 code pr mr pull request merge request');
  if (/jira|meego|codem|issue|task|任务|缺陷|需求/.test(text)) tags.push('任务 issue task 项目 project');
  if (/docs?|docx|wiki|lark|feishu|飞书|文档/.test(text)) tags.push('文档 docs wiki knowledge');
  if (/meet|calendar|minutes|会议|日程|纪要/.test(text)) tags.push('会议 meeting calendar minutes');
  if (/search|google|bing|baidu|搜索/.test(text)) tags.push('搜索 search');
  return tags.join(' ');
}

function normalizeForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/https?:\/\//g, ' ')
    .replace(/[^\u4e00-\u9fa5a-z0-9_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getAcronym(value) {
  return String(value || '')
    .split(/[\s:/|—–\-_.]+/)
    .filter(Boolean)
    .map(word => word[0])
    .join('')
    .toLowerCase();
}

function isSubsequence(needle, haystack) {
  if (needle.length < 3) return false;
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function getCurrentGroups() {
  const query = searchEl.value;
  let filtered = allRecords;

  if (query) {
    filtered = filtered.filter(r => smartMatchRecord(r, query));
  }

  const groups = new Map();
  filtered.forEach(r => {
    const wid = r.windowId != null ? r.windowId : -1;
    if (!groups.has(wid)) groups.set(wid, []);
    groups.get(wid).push(r);
  });

  return getSortedGroups(groups);
}

function render() {
  const query = searchEl.value;
  let filtered = allRecords;
  let normalMatchedIds = new Set();
  let aiAddedCount = 0;

  if (query) {
    const normalFiltered = allRecords.filter(r => smartMatchRecord(r, query));
    normalMatchedIds = new Set(normalFiltered.map(r => r.id));
    const aiFiltered = allRecords
      .filter(r => aiSearchResults.has(r.id) && !normalMatchedIds.has(r.id))
      .sort((a, b) => (aiSearchResults.get(b.id)?.score || 0) - (aiSearchResults.get(a.id)?.score || 0));
    aiAddedCount = aiFiltered.length;
    filtered = [...normalFiltered, ...aiFiltered];
  }

  const tabSignals = analyzeTabSignals(allRecords);
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
  autoNameBtn.style.display = localModelNaming && groups.size > 0 ? 'flex' : 'none';
  updateSearchStatus(query, aiAddedCount);

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
    applyI18n();
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
    const sortedRecords = [...g.records].sort((a, b) => (a.tabIndex || 0) - (b.tabIndex || 0));
    const isActiveWindow = !isClosed && hasValidWindow && Number(g.key) === activeChromeWindowId;
    const itemsHtml = sortedRecords.map(r => {
      const signal = {
        ...(tabSignals.get(r.id) || {}),
        aiMatched: query && aiSearchResults.has(r.id)
      };
      return renderItem(r, signal);
    }).join('');
    const focusBtn = (!isClosed && hasValidWindow)
      ? `<button class="focus-win-btn" data-wid="${g.key}" data-i18n-title="focus_window"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22C12 22 19 14 19 9a7 7 0 0 0-14 0c0 5 7 13 7 13z"/><circle cx="12" cy="9" r="2.5"/></svg></button>`
      : '';

    const openAllBtn = isClosed
      ? `<button class="open-all-btn" data-i18n="open_all">${chrome.i18n.getMessage('open_all') || 'Open All'}</button>`
      : '';
    const aiNameBtn = localModelNaming
      ? `<button class="ai-name-btn" data-key="${g.key}" data-i18n-title="regenerate_group_name">${namingGroups.has(String(g.key)) ? '<span class="mini-spinner"></span>' : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 1-15.2 6.5"/><path d="M3 12A9 9 0 0 1 18.2 5.5"/><path d="M18 2v4h-4"/><path d="M6 22v-4h4"/><path d="M12 7l.9 2.1L15 10l-2.1.9L12 13l-.9-2.1L9 10l2.1-.9L12 7z"/></svg>'}</button>`
      : '';
    const closeWinBtn = (isClosed && hasValidWindow)
      ? `<button class="close-win-btn" data-wid="${g.key}" data-i18n-title="clear"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`
      : '';

    const closedMsg = chrome.i18n.getMessage('closed') || '已关闭';

    const collapsed = collapsedWindows.includes(Number(g.key));
    return `
      <div class="group${collapsed ? '' : ' expanded'}${isActiveWindow ? ' active-window' : ''}" data-key="${g.key}">
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
          ${aiNameBtn}
          ${openAllBtn}
          ${closeWinBtn}
        </div>
        <div class="group-items">${itemsHtml}</div>
      </div>
    `;
  }).join('');

  // 组折叠
  listEl.querySelectorAll('.group-header').forEach(header => {
    header.addEventListener('click', async (e) => {
      if (e.target.closest('.open-all-btn') || e.target.closest('.focus-win-btn') || e.target.closest('.ai-name-btn') || e.target.closest('.window-label') || e.target.closest('.label-input') || e.target.closest('.drag-handle') || e.target.closest('.window-indicator')) return;
      const group = header.parentElement;
      const wid = Number(group.dataset.key);
      group.classList.toggle('expanded');
      const isExpanded = group.classList.contains('expanded');
      if (isExpanded) {
        collapsedWindows = collapsedWindows.filter(id => id !== wid);
      } else {
        if (!collapsedWindows.includes(wid)) collapsedWindows.push(wid);
      }
      await chrome.storage.local.set({ collapsedWindows });
    });
  });

  // 切换到窗口
  listEl.querySelectorAll('.focus-win-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      chrome.windows.update(Number(btn.dataset.wid), { focused: true });
    });
  });

  // 本地模型命名单个分组
  listEl.querySelectorAll('.ai-name-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const groupKey = btn.dataset.key;
      const group = getCurrentGroups().find(g => String(g.key) === String(groupKey));
      if (!group || namingGroups.has(String(groupKey))) return;
      await nameGroupWithLocalModel(group.key, group.records);
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

  setupFaviconFallbacks();
  applyI18n();
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

function renderItem(r, signal) {
  const timeStr = formatTime(r.openedAt);
  const displayHost = extractHost(r.url);
  const firstChar = displayHost.charAt(0).toUpperCase();
  const signalClasses = [
    signal?.duplicate ? 'item-duplicate' : '',
    signal?.closeSuggested ? 'item-close-suggested' : ''
  ].filter(Boolean).join(' ');
  const badges = renderSignalBadges(signal);

  const iconHtml = r.favIconUrl
    ? `<img class="favicon-img" src="${escapeHtml(r.favIconUrl)}" alt="" crossorigin="anonymous"><div class="fallback-icon" style="display:none">${firstChar}</div>`
    : `<div class="fallback-icon">${firstChar}</div>`;

  return `
    <div class="item ${signalClasses}" data-id="${escapeHtml(r.id)}" data-url="${escapeHtml(r.url)}">
      ${iconHtml}
      <div class="info">
        <div class="title"><span class="text-inner">${escapeHtml(r.title)}</span></div>
        <div class="url"><span class="text-inner">${escapeHtml(r.url)}</span></div>
      </div>
      ${badges}
      <span class="time">${timeStr}</span>
      <button class="delete-btn" data-id="${escapeHtml(r.id)}" data-i18n-title="delete">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  `;
}

function renderSignalBadges(signal) {
  if (!signal) return '';
  const badges = [];
  if (signal.aiMatched) {
    badges.push(`<span class="signal-badge ai-match-badge" data-i18n="ai_match">AI 匹配</span>`);
  }
  if (signal.duplicate) {
    badges.push(`<span class="signal-badge duplicate-badge" data-i18n="duplicate_tab">重复</span>`);
  } else if (signal.closeSuggested) {
    badges.push(`<span class="signal-badge close-badge" data-i18n="suggest_close">建议关闭</span>`);
  }
  return badges.join('');
}

function setupFaviconFallbacks() {
  listEl.querySelectorAll('.favicon-img').forEach(img => {
    const showFallback = () => {
      const fallback = img.nextElementSibling;
      img.remove();
      if (fallback) fallback.style.display = 'flex';
    };

    img.addEventListener('error', showFallback, { once: true });
    if (img.complete && img.naturalWidth === 0) {
      showFallback();
    }
  });
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

// 每 10s 检查列表中的标签是否仍然打开，关闭则删除记录
setInterval(async () => {
  try {
    const tabs = await chrome.tabs.query({});
    const openTabIds = new Set(tabs.map(t => t.id));

    // 找出已关闭的标签（记录中有但实际已不存在）
    const staleIds = allRecords
      .filter(r => {
        const tabId = Number(r.id.replace('tab-', ''));
        return !openTabIds.has(tabId);
      })
      .map(r => r.id);

    if (staleIds.length === 0) return;

    const result = await chrome.storage.local.get('tabHistory');
    const history = (result.tabHistory || []).filter(r => !staleIds.includes(r.id));
    await chrome.storage.local.set({ tabHistory: history });
    allRecords = history.sort((a, b) => b.openedAt - a.openedAt);
    render();
  } catch (e) {
    // ignore errors during tab query
  }
}, 10000);
