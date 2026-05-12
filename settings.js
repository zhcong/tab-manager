const includeEl = document.getElementById('include');
const excludeEl = document.getElementById('exclude');
const openInWindowEl = document.getElementById('openInWindow');
const keepClosedGroupsEl = document.getElementById('keepClosedGroups');
const saveBtn = document.getElementById('saveBtn');
const cancelBtn = document.getElementById('cancelBtn');

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

async function load() {
  applyI18n();
  const result = await chrome.storage.local.get(['urlIncludeKeywords', 'urlExcludeKeywords', 'openInWindow', 'keepClosedGroups']);
  const include = result.urlIncludeKeywords || [];
  const exclude = result.urlExcludeKeywords || [];
  includeEl.value = include.join('\n');
  excludeEl.value = exclude.join('\n');
  openInWindowEl.checked = result.openInWindow || false;
  keepClosedGroupsEl.checked = result.keepClosedGroups !== false;
}

function parseKeywords(text) {
  return text.split('\n')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

saveBtn.addEventListener('click', async () => {
  const include = parseKeywords(includeEl.value);
  const exclude = parseKeywords(excludeEl.value);
  await chrome.storage.local.set({
    urlIncludeKeywords: include,
    urlExcludeKeywords: exclude,
    openInWindow: openInWindowEl.checked,
    keepClosedGroups: keepClosedGroupsEl.checked
  });
  window.close();
});

cancelBtn.addEventListener('click', () => {
  window.close();
});

load();
