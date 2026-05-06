# 分组拖拽排序 & 小圆点颜色 — 设计文档

日期：2026-05-07

## 目标

1. 分组支持拖拽排序，排序结果持久化
2. 分组小圆点支持点击更换颜色，颜色持久化

## 功能一：拖拽排序

### 存储

新增 storage key `windowOrder`，类型 `number[]`（windowId 数组）。

- 不存在 → 按 `openedAt` 降序排列（现有行为）
- 存在 → render 时按数组顺序排列
- 新窗口不在数组中 → 追加到末尾

### UI

- 拖拽手柄：分组头部 chevron 左侧加 `⠿` 六点图标
- `draggable="true"` 仅在手柄上
- 拖拽中：被拖拽组 `opacity: 0.4`，目标位置显示蓝色上边框指示线
- 释放后：更新 `windowOrder`、保存 storage、重新渲染

### 交互规则

- 只有手柄可拖拽，其他头部区域行为不变（折叠/编辑/聚焦按钮等）
- 插入位置为两个分组之间

## 功能二：小圆点颜色

### 存储

新增 storage key `windowColors`，类型 `{ [windowId]: string }`。

- 未自定义 → 使用 CSS nth-child 默认色
- 自定义后 → inline style 覆盖

### 12 色预设

```
#6366f1 #8b5cf6 #06b6d4 #10b981
#f59e0b #ef4444 #ec4899 #f97316
#84cc16 #14b8a6 #3b82f6 #a855f7
```

### UI

- 点击圆点 → toggle 展开/收起颜色行
- 颜色行在分组头部下方，flex 排列 12 个 20x20 色点
- 点击颜色 → 更新 storage + inline style + 收起颜色行
- 当前选中颜色带 2px 白色边框
- hover 放大效果（scale 1.2）

### CSS

- 颜色行：`display: flex; gap: 6px; padding: 4px 14px 8px 52px`
- 色点：`width: 20px; height: 20px; border-radius: 50%; cursor: pointer; transition: transform 0.15s`
- 色点 hover：`transform: scale(1.2)`
- 选中：`box-shadow: 0 0 0 2px var(--surface), 0 0 0 3px currentColor`

## 改动范围

- `popup.js` — 拖拽事件（dragstart/dragover/drop）、颜色行 toggle 和选择逻辑、render 中排序和颜色注入
- `popup.css` — 拖拽手柄样式、拖拽态样式、颜色行样式
- `popup.html` — 无结构变化（拖拽手柄和颜色行在 JS 中动态生成）

## 边界处理

| 场景 | 处理方式 |
|------|---------|
| 拖拽到自身位置释放 | 无变化，不更新 storage |
| 颜色行展开时点击另一个圆点 | 先收起当前，再展开新 |
| 独立窗口模式拖拽 | 拖拽更新后，storage.onChanged 会触发其他窗口刷新（已有实时更新） |
| 删除分组后 windowOrder 残留 | render 时过滤掉不存在的 windowId |
| 删除分组后 windowColors 残留 | render 时不读取不存在的 windowId，存储残留可接受 |
