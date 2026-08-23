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

## 真实扩展消息 E2E 完整闭环（2026-08-23）

使用独立临时 profile 的 Chrome for Testing 148.0.7778.96，加载最终 `dist/vimium`，由
`scripts/e2e_open_key_mouse.js` 启动本地 fixture 服务；未连接、关闭或修改用户现有 Chrome。

实际执行：

```bash
./make.js package
PUPPETEER_EXECUTABLE_PATH="/tmp/open-key-mouse-cft-lizqY7/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" \
  deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys \
  scripts/e2e_open_key_mouse.js
```

结果：退出码 0，输出 `OpenKeyMouse E2E 通过`，页面错误为空。已实际覆盖：

- 真实右键轨迹：低于阈值旁路、后退、前进、滚轮到顶/到底、关闭标签页；
- Super Drag：链接前台/后台、图片打开、选择文字复制、draggable 组件保护、Alt 原生旁路；
- Wheel/Rocker：右键滚轮上下、摇杆正反组合；
- 跨域 localhost/127.0.0.1 iframe 的右键轨迹；
- 设置保存、语言持久化、设置导出、有效导入、非法导入不覆盖、运行时站点规则；
- 强制终止扩展 Service Worker 后，由真实内容页继续执行 `scrollToTop`。

该 E2E 仍不能替代 Windows/Linux/Edge 手工兼容性矩阵、GitHub/Gmail/Google Docs/Notion/YouTube/
Reddit/在线编辑器等真实站点矩阵，也不能替代完整 Vimium 原有 E2E 的逐项人工回归；这些项目仍未
验证，不在本轮宣称完成。

## Linux ARM64 Chromium 补充验证（2026-08-23）

为补充非 macOS 证据，使用 Docker `linux/arm64` 的 Debian 13 容器、Chromium
151.0.7922.169 和独立临时 profile 执行。完整基线测试在容器内以非 root 用户运行；容器额外使用
`--security-opt seccomp=unconfined` 以满足 Chromium 的 namespace 启动条件，不改变宿主机浏览器或仓库
配置。增强扩展 E2E 使用脚本自身声明的 `--no-sandbox`，只访问本地 fixture 服务。

实际结果：

- `./make.js test` 退出码 0；单元测试 `282/282`，DOM 测试 `109/109`，总计 `391/391`；
- `scripts/e2e_open_key_mouse.js` 退出码 0，页面错误为空，设置导入导出、站点规则、核心手势、
  Super Drag、Wheel、Rocker、跨 frame 和 Service Worker 重启均通过；
- 该项是 Linux ARM64 Chromium 自动/隔离补充证据，不是设计文档 §18.4 要求的 Linux + Chrome Stable
  手工矩阵，因此不将 `V-002`、`O-001` 至 `O-005` 或 `C-001` 至 `C-003` 改为 `DONE`。

## 设置页键盘、语义、高对比度补充验证（2026-08-24）

在 macOS arm64 上使用 Chrome for Testing 148.0.7778.96 独立临时 profile 重跑
`scripts/e2e_open_key_mouse.js`，退出码为 0，页面错误为空。新增自动断言实际覆盖：

- 设置页导航为垂直 `tablist`，11 个 tab 与 11 个 tabpanel 的 `id`、`aria-controls`、
  `aria-labelledby` 对应关系，以及 roving `tabindex`；
- 侧栏通过 `ArrowUp`/`ArrowDown`/`Home`/`End` 键盘切换，所有表单控件都有可计算名称；
- 在没有依赖画布拖动的情况下，通过文本框输入 `L>R` 并用键盘提交绑定；
- 通过 CDP 检查 `forced-colors: active` 与 `prefers-contrast: more`，并在 480px 窄视口确认
  设置页退化为单列布局。

随后在 Linux ARM64 Debian 13 Chromium 151.0.7922.169 隔离容器中重跑同一增强 E2E，退出码同样为 0。
这些是自动化语义和响应式冒烟证据，不等同于屏幕阅读器、人工高对比度、缩放或设计文档 §18.4 的
跨平台手工矩阵验收。

## 真实站点隔离注入冒烟（2026-08-24）

使用 Chrome for Testing 独立临时 profile，不使用登录态、不读取用户资料；通过扩展设置页调用
`chrome.scripting.executeScript` 的 `ISOLATED` world 检查内容脚本状态。每个站点均返回 HTTP 200，
`controller` 和 `initialized` 均为 `true`，监听器数量为 13，页面错误为空：

| 站点类别 | 实际地址或结果 |
| --- | --- |
| 静态网页 | `https://example.com/` |
| GitHub | `https://github.com/` |
| Gmail | 跳转到 Google 登录页，未使用登录态 |
| Google Docs | 跳转到 Google Docs 登录页，未使用登录态 |
| Notion | 跳转到 `https://www.notion.com/` |
| YouTube | `https://www.youtube.com/` |
| Reddit | 返回 Reddit challenge 页面，未绕过验证 |
| 在线编辑器 | `https://stackblitz.com/` |
| 长列表 | Wikipedia 编程语言列表页 |

该结果只证明这些页面上的内容脚本隔离注入和初始化冒烟通过，不证明已登录 Gmail/Docs/Notion 或在线
编辑器中的手势功能，也不替代真实站点人工操作、跨 frame、长列表和 Windows/Edge/Linux Chrome Stable
矩阵；功能矩阵中的相关项继续保持 `IN_PROGRESS`。

## 当前 checkout 最终自动门禁（2026-08-24）

本轮在新增覆盖率测试、配置仓库测试、命令路由测试和窗口状态实现后，重新构建 `dist/vimium`，并对当前
checkout 执行完整自动门禁：

- macOS arm64 系统 Chrome 151 覆盖下，`./make.js test` 通过：单元 `308/308`、DOM `109/109`，总计
  `417/417`；系统 Chrome 的扩展命令行加载仍被 Google Chrome 明确拒绝，因此该结果只作为 Vimium
  基线测试覆盖，不作为系统 Chrome Stable unpacked 扩展手工证据；
- macOS arm64 Chrome for Testing `148.0.7778.96` 独立临时 profile 的增强扩展 E2E 通过，页面错误为空，
  覆盖设置、无障碍语义、核心手势、Super Drag、Wheel、Rocker、跨 frame、站点规则、导入导出和
  Service Worker 重启；
- Docker `linux/arm64`、Debian 13、Chromium `151.0.7922.169`，以非 root 用户在临时容器中重跑当前
  checkout：`./make.js test` 为 `417/417`，增强扩展 E2E 退出码为 0，页面错误为空；这仍不是
  §18.4 要求的 Linux + Chrome Stable 手工矩阵。

覆盖率使用 Deno V8 coverage 对 `test-unit` 实际采集：

| 范围 | 行覆盖率结果 |
| --- | ---: |
| 新增纯算法模块（方向量化、手势识别、拖拽分类、轨迹、滚轮、摇杆、超级拖拽、光标） | `95.2%`–`100%` |
| 配置模块（schema、validator、migrations、repository） | `98.1%`–`99.7%` |
| Command Dispatcher | `100%` |
| 本轮纳入范围总计 | `97.6%` |

此外，权限审计仍为 9 项权限且无禁止权限/远程脚本，网络审计扫描 26 个新增模块且无后台或隐式网络调用，
`deno check`、`scripts/build_release.js`、商店包重建和 `git diff --check` 均通过。Windows、Edge、
认证态真实站点、屏幕阅读器以及四平台手工矩阵没有可复核证据，继续保持未完成状态。

本次重建产物 SHA-256：Chrome 商店包
`c8af2b604024069ace7e5edd2bbf89b37e783122743649ff0b7b5aa8db7972e6`；Firefox 包
`c2a02027409c4c4d7f2e6d879a86719a76bc55a5b506abba0efb09a6be09a39a`；Canary 包
`11af2eacad4b3ea57d530eeae07b4b3b594c38c9eb908bf0e2b2fdc18730bd6e`；源码包
`ba76e75dda45c2a94b12465c3b4cda59865d4af4713a000e3e8cbc74e7ac96a0`。

## 当前 checkout 受限动作页修复后的最终门禁（2026-08-24）

本轮修复动作页在受限标签页先显示操作控件的问题，并为限制提示接入现有中英文文案；同时新增真实扩展 E2E
断言。当前 checkout 的自动验证结果如下：

- macOS arm64 系统 Chrome 151 覆盖下，`./make.js test` 通过：单元 `308/308`、DOM `109/109`，总计
  `417/417`；系统 Chrome 的扩展命令行加载限制仍不作为手工扩展证据。
- macOS arm64 Chrome for Testing `148.0.7778.96` 独立临时 profile 的增强扩展 E2E 退出码为 0，页面错误为空；
  动作页受限分支实际确认提示可见、OpenKeyMouse 操作控件隐藏，原有手势、设置、站点规则、导入导出、迁移、
  跨 frame 和 Service Worker 重启继续通过。
- Docker `linux/arm64` Debian 13、Chromium `151.0.7922.169` 非 root 临时容器中，`./make.js test` 为
  `417/417`，增强扩展 E2E 退出码为 0；动作页受限分支同样通过。该证据仍不是 §18.4 要求的 Linux + Chrome
  Stable 手工矩阵。
- Deno V8 coverage 的 `test-unit` 为 `308/308`，本轮纳入范围行覆盖率 `97.6%`；新增纯算法模块为
  `95.2%`–`100%`，配置模块为 `98.1%`–`99.7%`，Dispatcher 为 `100%`。
- 权限审计通过 9 项权限，网络审计扫描 26 个新增模块且无后台或隐式网络调用；`deno check`、定向
  `deno fmt --check`、`git diff --check`、发布检查、商店/Firefox/Canary/源码包生成和禁入路径审计均通过。

本次重建产物 SHA-256：Chrome 商店包
`f2ea61ce0868595371b5c26fa627687e37cf2d5bce7498b7c188193716e1e896`；Firefox 包
`b61b49dfca555657a2b4f907a6e14895f1df4d0bee8242d38f2a2d7a8265c6f2`；Canary 包
`c83f591d63cb4274654ebf098b05b2dfc39dbbb28279fa137826e12c41637317`；源码包
`9e7424adfbbd3791161b7155ac9fb56e18f3f5b91a8d7023a3163d2f3fa114cd`。

系统 Chrome 的隔离 UI 尝试实际确认“加载已解压”会进入浏览器原生文件选择器，Puppeteer/CDP 无法代替用户
选择目录；命令行扩展加载参数也被 Google Chrome 拒绝。Windows、Edge、Linux Chrome Stable、认证态真实站点、
屏幕阅读器、人工高对比度/缩放和完整 Vimium 手工回归没有可复核证据，功能矩阵仍保持 `IN_PROGRESS`，本轮不
宣称这些项目完成。

## 当前 checkout 设计文档 fixtures 补充门禁（2026-08-24）

新增真实扩展 E2E 对设计文档 §18.2 的 8 个仓库 fixture 做结构冒烟：`basic-links.html`、`inputs.html`、
`scroll-containers.html`、`iframes.html`、`shadow-dom.html`、`drag-drop-app.html`、`contenteditable.html`、
`images.html`。图片资源在本地测试服务内改写为本地 PNG，避免测试过程产生第三方图片请求。

Chrome for Testing 148 macOS 与 Linux ARM64 Debian Chromium 151 均退出码 0；macOS 系统 Chrome 覆盖下
`./make.js test` 仍为 `417/417`。本次最终重建产物 SHA-256：Chrome 商店包
`ff7bae3401955da6b99a4eb656f2060446c73e617a0bea460f54cae995186e23`；Firefox 包
`6b918bbf93cf443f3f4a5e16b94ffba0ecedaafa9d641db6ba2d3c929b85c355`；Canary 包
`b51a656cdc6bdefaed42ba128d0034ed55fad281694acdfee7a884fba25d38e8`；源码包
`9c9e2a157638225a2efd85c1ebb7787a387f80e68cba36b0fffa0a9d43279a5f`。
这仍是自动化 fixture 证据，不替代设计文档 §18.4 的 Windows、Edge、Chrome Stable 人工矩阵。

## 当前 checkout 预发布版本与设置迁移补充门禁（2026-08-24）

为满足设计文档 Phase 8 的预发布要求，扩展版本从上游继承的 `2.4.2` 改为 OpenKeyMouse `0.1.0`；Vimium
设置迁移单独固定使用兼容版本 `2.4.2`，避免预发布版本号触发上游旧版新标签页迁移。新增单元测试覆盖该边界。

当前 checkout 实际验证：macOS 系统 Chrome `./make.js test` 为单元 `309/309`、DOM `109/109`，总计
`418/418`；macOS Chrome for Testing 148 增强扩展 E2E 退出码 0；Linux ARM64 Debian 13 Chromium 151
基线为 `309/309`、`109/109`、总计 `418/418`，增强 E2E 退出码 0；官方 Microsoft Edge
`151.0.4129.101` Debian amd64 隔离环境同样为 `418/418`，增强 E2E 退出码 0。

本轮 `deno run -A scripts/build_release.js --package` 生成 [源码包](/Users/yang/project/plugin/open-key-mouse/dist/open-key-mouse-0.1.0.zip)，
四类产物 SHA-256：Chrome 商店
`162c01666c97320ece953ab0ad5388a1f1b39ef05f7546e504b633d37c9f3c5d`；Firefox
`ed3b903cac7a0e34f4ebb6bbe78689d758f666cdbf915e9cb294e2a5c661f8d2`；Canary
`95c958cff0208d9b8d5c29f1f60d6fa7f48b23869a1882fddb6d3425c2ff04ef`；源码
`4fa08dd01c30cb490d130d79023a3cd561356b61406091aa3ea3d0b0bbfc0763`。
版本号修复只证明自动化和隔离运行时兼容，不替代 Windows、Chrome Stable、Edge Stable 人工矩阵。
当前 checkout 连续两次运行商店包和源码包构建，四类产物 SHA-256 均完全一致；该结果补足本机重复构建可复现性证据。

## 当前 checkout Edge 自动兼容性补充（2026-08-24）

官方 Microsoft Edge `151.0.4129.101` 在 Debian amd64 隔离容器中以非 root 用户运行；`./make.js test` 为
`308/308` 单元、`109/109` DOM，增强扩展 E2E 退出码 0，并通过 8 个设计文档 fixture、受限动作页和 Service
Worker 重启。该证据不等同于 Windows Edge Stable 手工矩阵，未据此改变功能矩阵状态。

## 当前 checkout 官方 Linux Chrome Stable 自动基线补充（2026-08-24）

在 Docker `linux/amd64`、Debian 13 隔离容器中安装官方 Google Chrome Stable `151.0.7922.173`，以非 root
用户、`seccomp=unconfined`、临时浏览器 profile 和显式 `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome` 运行：
`./make.js test` 实际通过，单元 `309/309`、DOM `109/109`，总计 `418/418`。

同环境执行设计文档 §18.3 unpacked E2E 时，Chrome Stable 没有出现本项目的 `background_scripts/main.js` 或
`service_worker.js` 目标，目标列表只出现 Chrome 内置 Google Network Speech 组件扩展，因此脚本在扩展页面探针
处超时退出。该结果证明 Chrome Stable 的基线测试通过，但不证明 unpacked 扩展已加载，也不替代 Linux + Chrome
Stable 人工矩阵；功能矩阵和发布检查表继续保留未完成状态。

## 当前 checkout 官方 Chrome Stable CDP 加载补充（2026-08-24）

为保留 Chrome Stable 的真实品牌浏览器覆盖，同时绕开其禁用 `--load-extension` 的命令行行为，E2E 启动器新增
显式环境开关 `OPEN_KEY_MOUSE_E2E_LOAD_UNPACKED_VIA_CDP=true`，通过 Chrome DevTools Protocol 的
`Extensions.loadUnpacked` 加载本地 `dist/vimium`，默认 CFT/Chromium 启动路径不变。

macOS Chrome Stable `151.0.7922.173` 和 Linux amd64 Debian 13 Chrome Stable `151.0.7922.173` 均实际加载
OpenKeyMouse Service Worker，并完成完整 `scripts/e2e_open_key_mouse.js`：核心手势、Super Drag、Wheel、Rocker、
跨 frame、设置导入导出、站点规则、设计文档 fixtures、受限动作页和 Service Worker 重启均退出码 0。Linux
同环境 `./make.js test` 仍为单元 `309/309`、DOM `109/109`，总计 `418/418`。

这是 Chrome Stable 的 CDP 自动化证据，不是 §18.4 的人工平台矩阵；Windows Chrome、Windows Edge、Linux Chrome
Stable 人工操作、认证态站点、屏幕阅读器和完整 Vimium 手工回归仍未验证。

## 当前主机 Windows 与可见 UI 环境探测（2026-08-24）

只读探测确认：Parallels Desktop `26.4.1-57516` 已安装，且本机有一个 Windows ARM64 安装 ISO
(`/Users/yang/Library/Parallels/Downloads/26200.8875.260711-1836.25h2_ge_release_svc_refresh_CLIENTCONSUMER_RET_A64FRE_zh-cn.iso`，约 6.4 GiB)，
但 `prlctl list --all` 没有注册虚拟机，`/Users/yang/Parallels` 没有 `.pvm`，本机 Docker 只有 Linux 镜像；因此仍没有可直接运行的 Windows Chrome/Edge 环境。
本轮未创建、启动或修改虚拟机，也未接触用户浏览器登录态。

另用独立临时 profile 启动 macOS Chrome Stable `151.0.7922.173`，在浏览器级 CDP 通过
`Extensions.loadUnpacked` 实际加载 `dist/vimium`，目标列表出现
`chrome-extension://.../background_scripts/main.js` Service Worker；随后尝试 Computer Use 可见 UI 状态读取，
调用在 30 秒超时，未形成可复核的人工操作证据。临时 Chrome 进程已关闭。

该探测只补充环境事实和 CDP 加载事实，不改变 §18.4 人工矩阵状态。

## OpenKeyMouse 独立 Deno 测试入口（2026-08-24）

设计文档要求的 `deno test -A tests/open_key_mouse/` 原先因目录不存在而失败；新增
`tests/open_key_mouse/deno_test_adapter_test.js` 作为现有 shoulda 单元测试的 Deno 入口，不复制测试逻辑。
实际结果：`1 passed / 0 failed`，适配入口内 shoulda 测试 `64/64`，退出码 0。
