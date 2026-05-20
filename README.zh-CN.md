# Rancher Log Plus

<p align="right">
  <a href="./README.md">English</a> | <strong>中文</strong>
</p>

Rancher Log Plus 是一个本地 Chrome 扩展，用来增强 Rancher Pod 日志查看体验。它保留 Rancher 原始日志窗口，同时提供更适合排查问题的美化日志视图，包括日志级别着色、过滤、类搜索语法、导出、清除和滚动控制。

这个扩展完全在浏览器本地运行，不会把日志、Cookie、Token 或页面内容发送到任何远程服务器。

## 功能

- 高亮 `ERROR`、`WARN`、`INFO`、`DEBUG`、`TRACE` 日志级别。
- 根据浏览器语言自动切换扩展界面的中文或英文显示。
- 使用自定义深色日志级别下拉框，避免系统原生浅色菜单影响黑底日志阅读。
- 支持关键字过滤、多个 `and` 条件、`not` 排除条件，以及 `/timeout|failed/i` 这类 JavaScript 风格正则。
- 保留 Rancher 原始日志视图，作为回退方案。
- 打开全屏美化日志弹窗。
- 暂停或恢复自动滚动。
- 通过 Rancher 原生 `清除屏幕` 动作清除日志，并同步清空扩展缓存。
- 导出当前过滤结果为本地 `.log` 文件。
- 关闭美化弹窗时同步关闭 Rancher 原生日志弹窗。

## 支持的 Rancher 日志结构

Rancher Log Plus 针对 Rancher 2.x 常见日志弹窗结构做了适配：

- 日志容器：`pre.log-body.wrap-lines`
- 单条日志：`.log-msg.log-combined`
- 日志时间：`.log-date`
- 原生关闭按钮：带 `data-ember-action-*`，文本为 `Close` 或 `关闭`
- 原生清屏按钮：带 `data-ember-action-*`，文本为 `Clear Screen` 或 `清除屏幕`

扩展只有检测到 Rancher 风格日志容器后才会激活。虽然 manifest 会在 `http` 和 `https` 页面注入脚本，但代码不会采集或上传页面数据。

## 安装

1. 克隆或下载这个仓库。
2. 打开 Chrome，进入 `chrome://extensions/`。
3. 开启 `开发者模式`。
4. 点击 `加载已解压的扩展程序`。
5. 选择本仓库目录。
6. 打开 Rancher 工作负载页面，点击 `查看日志`。

## 使用

1. 打开 Rancher Pod 日志弹窗。
2. 扩展会在原始日志窗口附近添加一个 `Log Style` 工具条。
3. 点击 `美化日志` 打开增强日志视图。
4. 使用日志级别下拉框查看全部日志或指定级别日志。
5. 使用过滤输入框输入关键字、`and`、`not` 或正则条件。
6. 点击 `清除日志` 清除 Rancher 原始屏幕并重置扩展缓存。
7. 点击 `下载日志` 导出当前过滤后的日志。
8. 点击 `关闭` 或按 `Escape` 关闭美化视图和 Rancher 原生日志弹窗。

扩展界面会自动跟随 Chrome 浏览器语言：中文浏览器显示中文，其他语言默认显示英文。

## 过滤示例

```text
timeout
timeout and user
timeout not healthcheck
/error|exception/i
```

## 排查

如果工具栏没有出现，在 Rancher 页面控制台执行：

```js
!!window.RLS
```

- `true`：扩展脚本已经注入。
- `false`：需要在 `chrome://extensions/` 刷新扩展，然后刷新 Rancher 页面。

如果美化视图打开但没有日志，请确认 Rancher 日志弹窗里存在 `pre.log-body` 和 `.log-msg` 元素。

## 隐私

Rancher Log Plus 是一个客户端 content script。它不会发起网络请求，不会上传日志，不会读取浏览器 Cookie，也不会持久化保存日志内容。它只会在 `localStorage` 中保存当前选择的日志级别和过滤文本，方便下次继续使用。

## 项目文件

- `manifest.json`：Chrome 扩展配置。
- `utils.js`：共享状态、DOM 检测、查询解析和工具函数。
- `parser.js`：Rancher 日志解析和增量日志接收。
- `ui.js`：日志行渲染和自定义级别下拉框。
- `content.js`：扩展主生命周期和 Rancher 集成逻辑。
- `content.css`：美化日志视图样式。
