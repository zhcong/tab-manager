# 独立窗口模式设计

## 功能概述
在设置页面添加一个开关「在独立窗口中打开」，开启后点击扩展图标会在一个动态尺寸的独立浏览器窗口中显示标签页历史列表。

## 窗口尺寸策略
- 获取当前显示器信息：`chrome.system.display.getInfo()`
- 窗口宽度：屏幕宽度 * 0.6（最大 800px）
- 窗口高度：屏幕高度 * 0.7（最大 900px）
- 窗口居中显示

## 数据流
1. `settings.html` 新增开关控件，保存设置到 `chrome.storage.local.openInWindow`
2. `popup.js` 加载时检查 `openInWindow` 设置
3. 如果启用：
   - 调用 `chrome.system.display.getInfo()` 获取屏幕尺寸
   - 计算窗口大小：`width = min(screenWidth * 0.6, 800)`, `height = min(screenHeight * 0.7, 900)`
   - 调用 `chrome.windows.create({ url: 'popup.html', width, height, focused: true })` 打开新窗口
   - 调用 `window.close()` 关闭当前 popup
4. 如果禁用：正常渲染列表

## 需要修改的文件
1. `settings.html` — 添加开关 UI
2. `settings.js` — 保存设置 `openInWindow`
3. `popup.js` — 添加窗口模式检测和切换逻辑
4. `_locales/zh_CN/messages.json` — 新增开关的国际化文案

## UI 文案
- 设置项：`open_in_window_label` = "在独立窗口中打开"
- 设置项：`open_in_window_desc` = "开启后，点击扩展图标会在独立窗口显示历史记录"

## manifest 权限
需要添加 `system.display` 权限以获取屏幕信息。
