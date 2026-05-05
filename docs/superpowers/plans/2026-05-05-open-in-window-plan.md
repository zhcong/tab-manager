# 独立窗口模式实现计划

**目标：** 在设置页面添加开关，控制 popup 是否在独立窗口中打开

**架构：**
- 在 `settings.html` 添加开关控件，保存到 `chrome.storage.local.openInWindow`
- `popup.js` 加载时检测设置，如果启用则调用 `chrome.windows.create` 打开新窗口并关闭当前 popup
- 窗口尺寸根据屏幕尺寸动态计算：宽度 = 屏幕宽度 * 0.6（最大 800px），高度 = 屏幕高度 * 0.7（最大 900px）

---

## 文件结构

| 文件 | 操作 |
|------|------|
| `_locales/zh_CN/messages.json` | 修改 - 添加开关 i18n 文案 |
| `settings.html` | 修改 - 添加开关 UI |
| `settings.css` | 修改 - 添加开关样式 |
| `settings.js` | 修改 - 保存/加载 `openInWindow` 设置 |
| `popup.js` | 修改 - 添加窗口模式检测和切换逻辑 |
| `manifest.json` | 修改 - 添加 `system.display` 权限 |

---

## Task 1: 添加国际化文案

**文件：** `_locales/zh_CN/messages.json`

- [ ] **Step 1: 添加 i18n 字符串**

在 JSON 中添加两个新键值对（放在 `save` 之后）：

```json
"open_in_window": {
  "message": "在独立窗口中打开",
  "description": "Toggle label for open in window mode"
},
"open_in_window_desc": {
  "message": "开启后，点击扩展图标会在独立窗口显示历史记录",
  "description": "Description for open in window setting"
}
```

---

## Task 2: 添加开关 UI

**文件：** `settings.html`

- [ ] **Step 1: 在 `.section` 末尾添加开关字段**

在 `<div class="section">` 中最后一个 `</div>` 前添加：

```html
<div class="field">
  <label class="toggle-label" for="openInWindow">
    <span data-i18n="open_in_window">在独立窗口中打开</span>
    <input type="checkbox" id="openInWindow">
    <span class="toggle-slider"></span>
  </label>
  <span class="hint" data-i18n="open_in_window_desc">开启后，点击扩展图标会在独立窗口显示历史记录</span>
</div>
```

---

## Task 3: 添加开关样式

**文件：** `settings.css`

- [ ] **Step 1: 在文件末尾添加 toggle 样式**

```css
.toggle-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  user-select: none;
}

.toggle-label input {
  display: none;
}

.toggle-slider {
  position: relative;
  width: 36px;
  height: 20px;
  background: var(--text4);
  border-radius: 10px;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle-slider::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-label input:checked + .toggle-slider {
  background: var(--accent);
}

.toggle-label input:checked + .toggle-slider::after {
  transform: translateX(16px);
}
```

---

## Task 4: 修改 settings.js 加载和保存开关设置

**文件：** `settings.js`

- [ ] **Step 1: 在 `load()` 函数中添加加载逻辑**

修改 `load()` 函数：

```js
async function load() {
  applyI18n();
  const result = await chrome.storage.local.get(['urlIncludeKeywords', 'urlExcludeKeywords', 'openInWindow']);
  const include = result.urlIncludeKeywords || [];
  const exclude = result.urlExcludeKeywords || [];
  includeEl.value = include.join('\n');
  excludeEl.value = exclude.join('\n');
  openInWindowEl.checked = result.openInWindow || false;
}
```

- [ ] **Step 2: 在文件顶部添加 `openInWindowEl` 引用**

在现有变量声明后添加：

```js
const openInWindowEl = document.getElementById('openInWindow');
```

- [ ] **Step 3: 修改 `saveBtn` 点击事件保存开关状态**

修改 `saveBtn.addEventListener('click', ...)` 中的保存逻辑：

```js
saveBtn.addEventListener('click', async () => {
  const include = parseKeywords(includeEl.value);
  const exclude = parseKeywords(excludeEl.value);
  await chrome.storage.local.set({
    urlIncludeKeywords: include,
    urlExcludeKeywords: exclude,
    openInWindow: openInWindowEl.checked
  });
  window.close();
});
```

---

## Task 5: 修改 popup.js 添加窗口模式检测

**文件：** `popup.js`

- [ ] **Step 1: 在 `load()` 函数开头添加窗口模式检测**

在 `load()` 函数的最开始（`async function load() {` 之后）添加：

```js
async function load() {
  // 检测是否需要在独立窗口中打开
  const settings = await chrome.storage.local.get(['openInWindow']);
  if (settings.openInWindow) {
    try {
      const displays = await chrome.system.display.getInfo();
      const primary = displays.find(d => d.isPrimary) || displays[0];
      const width = Math.min(Math.floor(primary.workArea.width * 0.6), 800);
      const height = Math.min(Math.floor(primary.workArea.height * 0.7), 900);
      await chrome.windows.create({
        url: 'popup.html',
        width,
        height,
        focused: true,
        left: Math.floor(primary.workArea.left + (primary.workArea.width - width) / 2),
        top: Math.floor(primary.workArea.top + (primary.workArea.height - height) / 2)
      });
    } catch (e) {
      console.error('Failed to create window:', e);
    }
    window.close();
    return;
  }

  // 原有的加载逻辑
  const result = await chrome.storage.local.get(['tabHistory', 'windowNames', 'closedWindowIds']);
  // ... 后续不变
```

---

## Task 6: 添加 manifest 权限

**文件：** `manifest.json`

- [ ] **Step 1: 在 `permissions` 数组中添加 `system.display`**

```json
"permissions": ["tabs", "storage", "activeTab", "system.display"],
```

---

## Task 7: 测试

1. 打开 `chrome://extensions/`
2. 点击扩展详情中的刷新按钮
3. 点击扩展图标，确认 popup 正常显示
4. 打开设置页面，找到新添加的开关
5. 开启开关并保存
6. 关闭设置页面
7. 再次点击扩展图标，确认在独立窗口中打开（尺寸约 600x700 左右，居中显示）
8. 在设置中关闭开关，验证 popup 恢复正常
