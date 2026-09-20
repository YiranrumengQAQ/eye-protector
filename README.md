# Eye Protector · 护眼模式

一个极简的 Firefox 护眼扩展：平时只需要一个按钮一键开关，需要调参数时再进入设置页。

## 设计理念

- **Popup = 极简遥控器**：只回答两个问题——现在开没开？要不要开/关？
- **设置 = 完整控制台**：左侧导航 + 圆角卡片布局，功能再多也不乱
- **网页 = 尽量无感**：滤镜实时生效、平滑过渡，不弹打扰提示

界面上不使用任何 emoji，所有图标均为内联 SVG。

## 功能

- 一键开关护眼模式（工具栏按钮 / `Alt + Shift + E`）
- 暖色程度、页面亮度、对比度、饱和度四档调节，设置页内置实时预览
- 护眼方案预设：暖阳 / 夜间 / 阅读 / 专注，手动调参数自动转为“自定义”
- 图片处理四种模式：跟随网页 / 保持原色 / 降低亮度 / 降低饱和度
- 网站排除列表（自动匹配子域名，可一键排除当前网站）
- 自动模式：手动控制 / 定时开启（支持跨夜时段）/ 跟随系统主题
- 自定义 CSS 注入；所有设置仅保存在浏览器本地
- 界面随系统浅色 / 深色主题自适应

## 技术说明

### 护眼滤镜

在 `<html>` 根元素上应用组合滤镜：

```css
html { filter: brightness(b) contrast(c) sepia(a) saturate(t); }
```

暖色通过 `sepia` 实现，上限控制在 `0.55`，避免整个页面变成刺眼的纯黄色——目标是“暖白 / 米白”的观感。

### 保持图片原色的原理

普通的全局滤镜会把图片一并染色。本扩展对媒体元素额外应用一层**补偿滤镜**：

```
img, video, canvas …  { filter: url(#inverse) contrast(1/c) brightness(1/b); }
```

其中 `url(#inverse)` 指向注入页面的 SVG `<feColorMatrix>`，其值是
`sat(t) · sep(a)` 复合颜色矩阵的**数值逆矩阵**，可在数学上精确还原图片原始颜色
（对比度 / 亮度为一阶线性运算，以 `1/c`、`1/b` 精确抵消）。

### 目录结构

```
├── manifest.json          # Manifest V3
├── lib/shared.js          # 共享逻辑：预设、滤镜换算、逆矩阵、自动模式判定
├── background/            # 事件页：状态徽章、默认值初始化
├── content/               # 内容脚本：向页面注入滤镜与 SVG 补偿矩阵
├── popup/                 # 极简弹窗：状态 / 一键开关 / 设置入口
├── options/               # 设置页：侧边导航 + 卡片布局 + 实时预览
├── docs/                  # 界面预览页与 WebExtension API 桩（不属于扩展本体）
├── icons/                 # SVG 源图标与导出的 PNG
├── dist/                  # `npm run build` 生成的可上传 zip
└── web-ext-config.cjs     # web-ext 配置：声明哪些文件不打进扩展包
```

界面代码全部使用 DOM API（`createElement` / `createElementNS` / `<template>` 克隆）构建节点，
不对 `innerHTML` 做动态赋值，以通过 AMO 审核的安全检查。

## 环境要求

- Firefox 140+（桌面）/ Firefox for Android 142+
  ——`manifest.json` 中声明的 `data_collection_permissions`（本扩展不收集任何数据）自这两个版本起被支持。

## 本地调试

1. 打开 Firefox，地址栏输入 `about:debugging#/runtime/this-firefox`
2. 点击「临时载入附加组件」，选择本仓库中的 `manifest.json`
3. 修改代码后在同一页面点击「重新加载」即可

也可以使用 [web-ext](https://github.com/mozilla/web-ext)：

```bash
npm install
npm start        # 等价于 web-ext run，在临时配置的 Firefox 中加载扩展
```

## 打包与上传 AMO

```bash
npm install
npm run lint     # 与 AMO 相同的校验器（addons-linter），应为 0 errors / 0 warnings
npm run build    # 生成 dist/eye-protector-<version>.zip
```

`npm run build` 调用 `web-ext build`，按 `web-ext-config.cjs` 中的规则只把扩展本体
（`manifest.json`、`lib/`、`background/`、`content/`、`popup/`、`options/`、`icons/`）打进 zip，
并保证 `manifest.json` 位于压缩包根目录。把生成的 zip 上传到
[AMO 开发者中心](https://addons.mozilla.org/developers/) 即可。

> **不要直接压缩仓库目录上传。** 右键“压缩文件夹”或 GitHub 的 Download ZIP
> 会把所有文件套在 `eye-protector-1.0.0/` 这一层目录下，AMO 会报
> `manifest.json was not found`；同时 `docs/`、`README.md` 等非扩展文件也会被一并
> 打包，触发额外警告。
>
> 如果没有 Node 环境，可在仓库根目录手动执行（同样只打包扩展本体、不带外层目录）：
>
> ```bash
> zip -r dist/eye-protector-1.0.0.zip manifest.json lib background content popup options icons
> ```

### 不安装扩展预览界面

仓库内置了一个界面预览页，适合快速验收 UI 或二次开发时对照：

```bash
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000/docs/preview.html
```

该页面通过 `docs/mock-browser.js` 模拟 WebExtension API，
加载的是真实的 popup 与 options 源码。

## 已知限制

- 背景图片（`background-image`）属于元素本身，无法与“保持原色”的图片节点一样被单独补偿
- 少数设置了严格 CSP 且不允许内联样式的网站，注入的 `<style>` 可能被浏览器拦截
- iframe 内的内容跟随顶层页面的滤镜统一处理

## 路线图

- 按网站独立配置滤镜参数
- 日落 / 日出自动模式
- 视频与 PDF 页面的特殊处理
- 配置导入 / 导出

## 许可证

[MIT](LICENSE)
