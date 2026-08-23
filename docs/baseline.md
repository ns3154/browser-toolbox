# Vimium v2.4.2 基线记录

- 记录日期：2026-08-23
- 基线标签：v2.4.2
- 基线提交：eb737abd（完整提交：eb737abd65b070c05ef06d39f1d78751aa7f738）
- 项目标签：upstream-vimium-v2.4.2
- 上游：<https://github.com/philc/vimium.git>
- 分支：main

## 执行前仓库状态

最初执行 git status --short --branch 时返回：

```text
fatal: not a git repository (or any of the parent directories): .git
```

当时目录只有用户提供的设计文档，没有 Git 元数据。随后在不覆盖该文档的前提下初始化 main、添加
upstream、抓取标签并检出 v2.4.2；没有配置 origin，因为用户没有提供自己的远程仓库地址。

## 环境

- 操作系统：Darwin 24.6.0，macOS，arm64。
- Deno：2.9.5（stable，aarch64-apple-darwin）。
- 系统 Chrome：Google Chrome 151.0.7922.173。
- Puppeteer 目标 Chrome for Testing：131.0.6778.204（mac_arm）；缓存路径为
  /Users/yang/.cache/puppeteer/chrome/mac_arm-131.0.6778.204。
- 测试使用的有效浏览器覆盖：系统 Chrome 151.0.7922.173。

## 基线初始化命令

```bash
git init -b main
git remote add upstream https://github.com/philc/vimium.git
git fetch upstream --tags
git checkout -B main v2.4.2
git tag upstream-vimium-v2.4.2
```

结果：HEAD 为 eb737abd；main、v2.4.2 和 upstream-vimium-v2.4.2
指向同一提交。基线时工作区只有设计文档未跟踪。

## 规定命令和真实结果

### 1. deno --version

退出码 0，Deno 2.9.5。

### 2. deno fmt --check

退出码 1，未修改文件。共报告 14 个未格式化文件：

- 上游测试/页面：test_harnesses/cross_origin_iframe.html、test_harnesses/iframe.html、test_harnesses/page_with_links.html、test_harnesses/has_popup_and_link_hud.html、test_harnesses/event_capture.html、test_harnesses/visibility_test.html；
- 上游页面样式：pages/action.css、pages/command_listing.css、pages/vomnibar_page.css、pages/options.css、content_scripts/vimium.css、pages/hud_page.css；
- 用户提供文档：OpenKeyMouse_Codex_可执行开发设计文档.md；
- 说明：Deno 2.9.5 还会格式化 Markdown/HTML/CSS；本结果未用 deno fmt 覆盖上游文件或用户文档。

### 3. 浏览器安装命令

设计文档原文命令：

```bash
deno run -A puppeteer browsers install chrome
```

退出码 1，错误为 Module not found file:///Users/yang/project/plugin/open-key-mouse/puppeteer。

上游 CONTRIBUTING.md 给出的可执行命令：

```bash
deno run -A npm:puppeteer browsers install chrome
```

退出码 0，但 Deno 提示 Puppeteer 的 npm lifecycle build script 被忽略；随后默认 Puppeteer 缓存中的
Chrome for Testing 不完整，缺少 Framework 文件。安装命令还曾在仓库生成 chrome/ 和修改
deno.lock；该二进制缓存已移出仓库，deno.lock 已恢复到基线，未进入交付。

### 4. ./make.js test

未设置浏览器覆盖时退出码 1：

```text
error: Uncaught (in promise) Error: Failed to launch the browser process!
dlopen /Users/yang/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/../Frameworks/Google Chrome for Testing Framework.framework/Versions/131.0.6778.204/Google Chrome for Testing Framework: dlopen(/Users/yang/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/../Frameworks/Google Chrome for Testing Framework.framework/Versions/131.0.6778.204/Google Chrome for Testing Framework, 0x0105): tried: '/Users/yang/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/../Frameworks/Google Chrome for Testing Framework.framework/Versions/131.0.6778.204/Google Chrome for Testing Framework' (no such file), '/System/Volumes/Preboot/Cryptexes/App/Users/yang/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/../Frameworks/Google Chrome for Testing Framework.framework/Versions/131.0.6778.204/Google Chrome for Testing Framework' (no such file), '/Users/yang/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/131.0.6778.204/Google Chrome for Testing Framework' (no such file), '/System/Volumes/Preboot/Cryptexes/App/Users/yang/.cache/puppeteer/chrome/mac_arm-131.0.6778.204/chrome-mac-arm64/Google Chrome for Testing.app/Contents/Frameworks/Google Chrome for Testing Framework.framework/Versions/131.0.6778.204/Google Chrome for Testing Framework' (no such file).

new Error(
  ^
at Interface.onClose (file:///Users/yang/Library/Caches/deno/npm/registry.npmjs.org/@puppeteer/browsers/2.6.1/src/launch.ts:486:11)
at Interface.emit (ext:deno_node/_events.mjs:462:12)
at Socket.emit (ext:deno_node/_events.mjs:265:12)
at Socket.onend (ext:deno_node/internal/readline/interface.mjs:540:11)
at Socket.emit (ext:deno_node/internal/streams/readable.js:1814:12)
at processTicksAndRejections (ext:core/01_core.js:377:17)
at drainTicks (ext:core/01_core.js:431:17)

命令在单元测试阶段已报告 Pass (171/171)，在 DOM 阶段启动浏览器失败。

使用已确认存在的系统 Chrome 重跑：

~~~bash
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
```

退出码 0：

- test-unit：171/171 通过；
- test-dom：107/107 通过；
- 总计：278/278 通过。

### 5. 手工加载扩展

使用独立临时 profile 和系统 Chrome 启动 unpacked 扩展：

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox --remote-debugging-port=9338 --user-data-dir=/tmp/open-key-mouse-cdp-options --load-extension="/Users/yang/project/plugin/open-key-mouse" --disable-extensions-except="/Users/yang/project/plugin/open-key-mouse" --no-first-run about:blank
```

通过 CDP 列表确认 Service Worker 已出现，扩展 ID 为 fignfifoniblkonapihmkfakmlgkbkcf。尝试直接打开
pages/options.html、pages/help_dialog_page.html 和 pages/vomnibar_page.html 均未通过；Chrome 返回
ERR_FILE_NOT_FOUND，日志同时报告 content_verify_job failed，reason:1。由 Service Worker 调用
chrome.runtime.openOptionsPage() 也返回 Could not create an options page。

因此本基线只确认了 unpacked 扩展进程级加载和 Service Worker 出现；Options、帮助、链接提示和 Vomnibar
的“手工加载后正常”没有验证通过，不在本轮声称完成。上游 DOM/单元测试通过不能替代这项手工 UI 证据。

## 基线结论

- 自动基线：在系统 Chrome 覆盖下，171 个单元测试和 107 个 DOM 测试全部通过。
- 格式检查：因上游与用户文档的既有格式差异失败，不作为本轮新改动结论。
- 手工扩展页面：被当前 Chrome unpacked content verification 环境阻塞，仍是遗留风险。
- 当前没有新增权限、运行时依赖、遥测、商业化入口或鼠标功能。

## 基线运行时间

基线命令均在 2026-08-23 本轮实际执行；完整输出保留在本轮工具日志中。

## 后续实现验证补充

后续一次性实现全部 OpenKeyMouse 模块后，使用独立临时 profile 启动 Chrome for Testing
148.0.7778.96（不是用户正在使用的 Chrome），加载最终打包目录 `dist/vimium`，通过
`chrome://extensions` 的“扩展程序选项”进入设置页。实际确认了以下内容：

- 设置页中文侧栏、English 切换、保存后语言持久化，以及命令下拉中的 OpenKeyMouse 命令；
- 真实扩展内容页中右键按下并移动时轨迹 Shadow DOM 显示，释放后隐藏，浏览器错误为空；
- 上传本地 `icons/icon16.png` 后，真实内容页出现带 `data-open-key-mouse-cursor` 标记的本地 PNG
  光标样式。

这些证据只覆盖列出的子项。Super Drag、Wheel、Rocker 的真实命令效果、导入导出、站点规则、完整 Vimium
手工矩阵和跨平台验证仍未完成；不能把它们写成已验证。此前系统 Chrome 的 unpacked content verification
阻塞仍然有效，Chrome 151 仅作为自动 DOM 测试的浏览器覆盖。

## 真实扩展消息 E2E 补充

在后续修复 Super Drag 原生 `dragstart`/默认 click 冲突和 Rocker 多按钮事件模型后，使用全新临时
profile 的 Chrome for Testing 148.0.7778.96 完成了三条代表性链路：Super Drag LINK 前台打开、
右键按住上滚触发 `scrollToTop`、右键按住再点左键触发 `goBack`。验证过程中页面错误为空；完整
矩阵中的其他上下文、组合、跨 frame、设置导入导出、站点规则和跨平台行为仍未完成。
