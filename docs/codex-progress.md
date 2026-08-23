# Codex 阶段进度

本文件按设计文档规定追加。每个条目必须只记录已经实际执行的命令和结果；未验证内容不得写成完成。

## 2026-08-23 / Phase 0 / P0-001

- 完成内容：建立 Vimium v2.4.2 基线；补齐 GPL/MIT
  许可证链、永久免费章程、隐私、安全、商标、第三方通知、协作规则、基线和 ADR-001 至
  ADR-005；把扩展临时名称和说明改为 OpenKeyMouse；移除仅用于上游品牌升级提示的 notifications
  权限和通知路径；未实现鼠标或 Phase 1 功能。
- 修改文件：manifest.json、README.md、background_scripts/main.js、lib/settings.js、pages/options.html、pages/options.js；新增
  LICENSE、LICENSES/MIT-Vimium.txt、LICENSES/MIT-shoulda.txt、PROJECT_CHARTER.md、PRIVACY.md、SECURITY.md、TRADEMARK.md、THIRD_PARTY_NOTICES.md、AGENTS.md、docs/baseline.md、docs/codex-progress.md、docs/adr/001-fork-vimium.md
  至 docs/adr/005-no-telemetry.md；纳入用户提供的设计文档。
- 新增测试：无；复用上游测试体系，未添加 Phase 1 或后续测试。
- 实际执行命令：

```bash
deno --version
deno fmt --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
git diff --check
```

- 测试结果：Deno 2.9.5；deno fmt --check 退出码 1，仍为基线已有的 14
  个未格式化上游/用户文件；上游单元测试 171/171 通过，DOM 测试 107/107 通过，总计 278/278 通过；git
  diff --check 通过。临时 unpacked 加载确认 Service Worker 出现，但 Options 页面返回
  ERR_FILE_NOT_FOUND，Chrome 日志为 content_verify_job failed、reason:1，Options、帮助、链接提示和
  Vomnibar 的手工正常性未通过验证。
- 已知问题：设计文档原文的 Puppeteer 安装命令缺少 npm: 前缀；默认 Puppeteer Chrome for Testing
  缓存缺少 Framework 文件；当前 Chrome 的 unpacked content verification
  阻塞扩展页面手工验证；这些问题均已写入 docs/baseline.md。
- 下一步：仅列 Phase 1 的第一个可执行任务：先为一个现有无副作用命令编写适配测试并定义
  CommandInvocation/CommandResult；本轮不执行。
- 对应提交：待提交。

## 2026-08-23 / 跨阶段一次性实现 / O-001 至 O-006

- 授权边界：用户在完成 Phase 0 后追加授权，一次性实现全部模块并加入国际化；本条不把历史 Phase 0
  记录改写成已经完成，也不据此声称所有平台手工验收已完成。
- 完成内容：实现统一 CommandInvocation/Result、Dispatcher、跨 frame 手势会话校验、命令注册
  适配器、浏览器命令适配器；实现四向/八向右键手势、超级拖拽、滚轮组合、摇杆、轨迹 Shadow DOM
  覆盖层、站点规则、Vimium 排除规则、设置迁移与会话覆盖、自定义本地 PNG 光标；补齐设置页、手势
  编辑器、导入导出、Tab 列表、隐私与许可证页面；新增 en/zh_CN 本地消息和设置页语言切换；保留 GPL/MIT
  许可证链、免费无商业化、无遥测、无新增危险权限和 clean-room 约束。
- 修改文件：manifest.json、README.md、make.js、background_scripts/main.js、
  background_scripts/all_commands.js、background_scripts/open_key_mouse/；
  content_scripts/mode_normal.js、content_scripts/vimium_frontend.js、content_scripts/mouse/；
  lib/i18n.js、lib/open_key_mouse/；`pages/action.*`、pages/options.html、
  `pages/command_listing.*`、`pages/help_dialog_page.*`、`pages/mouse_options.*`、
  `pages/gesture_editor.*`、pages/onboarding.html、pages/privacy.html、`pages/tab_list.*`；
  _locales/en/messages.json、_locales/zh_CN/messages.json；scripts/权限与网络审计、发布检查；
  tests/unit_tests/open_key_mouse/、tests/dom_tests/open_key_mouse_dom_tests.js、tests/fixtures/；
  docs/baseline.md、docs/codex-progress.md、docs/feature-parity-matrix.md、docs/permissions.md、
  docs/release-checklist.md。
- 安全与合规：新增代码只依赖本项目设计文档、Vimium 既有公开代码和公开行为描述独立实现，未
  复制、反编译或移植 CrxMouse 闭源代码、资产、文案或界面；网络审计未发现新增 fetch、XHR、
  WebSocket、Beacon 或后台网络调用；manifest 未增加 notifications、downloads 或远程脚本。
- 实际执行命令：

```bash
deno --version
deno fmt --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno check background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
./make.js package
git diff --check
```

- 测试结果：Deno 2.9.5；完整单元测试和 DOM 测试在当前系统 Chrome 覆盖下分别为 277/277、
  109/109，通过总计 386/386；权限审计、网络审计、发布检查和打包均通过；git diff --check 通过；deno
  fmt --check 仍只报告基线已有的 14 个上游/用户文件，未覆盖这些文件。
- 浏览器实测：使用独立的 Chrome for Testing 148.0.7778.96 临时 profile，通过扩展管理页进入
  设置页，确认中文侧栏、English 切换及保存后语言持久化；确认命令下拉包含 OpenKeyMouse
  命令；在真实扩展内容页中确认右键移动时轨迹 Shadow DOM 显示、释放后隐藏且无浏览器错误。
- 浏览器实测补充：上传 icons/icon16.png 后确认内容页注入本地 PNG 光标样式。
- 证据边界：该证据不替代未执行的完整导入导出、超级拖拽、滚轮/摇杆命令链路和跨平台手工矩阵。
- 未验证内容：完整 Vimium 页面手工矩阵、所有手势绑定逐项的真实命令效果、设置导入导出与站点
  规则的浏览器端闭环、Firefox/Safari/Windows/Linux 行为、商店打包安装和无障碍完整回归；不得
  写成已完成。
- 风险：当前 Dispatcher 的会话时效校验已覆盖 mouseGesture；superDrag、wheel、rocker 的真实跨
  frame/页面消息闭环仍需单独 E2E 证据；系统 Chrome 的 unpacked content verification
  限制仍保留在基线记录中。
- 下一步：仅列一个可执行任务：在独立临时浏览器中补充真实扩展消息 E2E，先验证 Super Drag LINK
  前台打开和 Wheel/Rocker 命令路由，再按结果更新功能矩阵。
- 对应提交：本地 main 检查点（最终哈希见 Git 记录，未配置 origin，未推送）。

## 2026-08-23 / 真实扩展消息 E2E 修复与验证 / E-001

- 目标：执行上一条记录指定的真实扩展消息 E2E；使用独立 Chrome for Testing 148.0.7778.96 和全新临时
  profile，不关闭或修改用户现有 Chrome。
- 发现并修复：Super Drag 激活后浏览器仍会先发出原生 `dragstart`，继而触发 `pointercancel`；即使阻止
  `dragstart`，链接还可能在 `pointerup` 后生成默认 click。新增仅在 Super Drag 已激活时阻止
  `dragstart`，并以 500ms 短窗口抑制本次接管产生的 click；同时把 Rocker 的组合识别移到
  `mousedown`/`mouseup`，兼容第二个鼠标按键不产生额外 `pointerdown` 的浏览器事件模型。
- 修改文件：content_scripts/mouse/mouse_controller.js；重新生成 dist/vimium 包。
- 实际执行命令：

```bash
deno fmt content_scripts/mouse/mouse_controller.js
./make.js package
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno check background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
git diff --check
```

- 浏览器实测结果：
  - Super Drag LINK：右拖链接后，原生 `dragstart` 的 `defaultPrevented` 为 true，轨迹层保持
    `block`；释放后新前台标签打开 `https://example.com/`，原 fixture 标签仍保持原 URL。
  - Wheel：通过 CDP 发送右键按住和 `buttons: 2`、`deltaY: -100` 的滚轮事件；事件被阻止，页面
    从滚动位置 1200 回到 0。
  - Rocker：通过 CDP 发送右键按住再按左键；左键 `mousedown`/`mouseup` 被阻止，页面 URL 从 `#two`
    回到 `#one`，确认 `goBack` 路由执行。
  - 三项均在页面错误为空的情况下完成；全量测试为单元 277/277、DOM 109/109。
- 未验证内容：其他 Super Drag 上下文和绑定、Wheel 其他方向、Rocker 反向组合、跨 frame、导入
  导出、站点规则及跨平台行为仍不能写成完成。
- 下一步：仅列一个可执行任务：补齐功能矩阵中剩余的 Super Drag 上下文、Wheel/Rocker 组合和
  设置导入导出/站点规则手工用例，再决定哪些行可以标记 `DONE`。
- 对应提交：本地 main 检查点（未配置 origin，未推送；提交哈希见 Git 记录）。

## 2026-08-23 / 一次性闭环验证与生命周期修复 / E-002

- 授权边界：用户在询问下一步后明确要求“按照建议 一次性完成”；本轮据此完成剩余可执行的
  OpenKeyMouse 闭环验证，但没有把当前 macOS 无法运行的 Windows、Linux、Edge 及真实站点手工矩阵
  写成完成。
- 发现并修复：真实右键手势的 pointerdown 与 pointerup 使用了不同 requestId，导致 Dispatcher 会话
  校验取消命令；改为复用同一手势 requestId。Frame bridge 改为带 requestId 的 runtime message，
  并等待 Service Worker 接受会话；加入请求字段校验。修复 bfcache/`pageshow` 后内容控制器监听器
  丢失和重复安装；设置仓库监听器可移除；修复图片原生拖拽的 `blur`/`pointercancel` 先行路径、
  原生属性恢复和点击旁路。Dispatcher 发往内容脚本的内部协议消息补齐 `handler`，避免 Vimium
  消息监听器拒绝页面命令。
- 修改文件：`background_scripts/main.js`、`background_scripts/open_key_mouse/command_dispatcher.js`、
  `background_scripts/open_key_mouse/settings_repository.js`、`content_scripts/mouse/frame_gesture_bridge.js`、
  `content_scripts/mouse/mouse_controller.js`、`tests/unit_tests/open_key_mouse/command_dispatcher_test.js`、
  `scripts/e2e_open_key_mouse.js`、`docs/baseline.md`、`docs/codex-progress.md`、
  `docs/feature-parity-matrix.md`、`docs/release-checklist.md`。
- 实际执行命令与结果：

```bash
./make.js package
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
PUPPETEER_EXECUTABLE_PATH="/tmp/open-key-mouse-cft-lizqY7/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
deno check background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/frame_gesture_bridge.js background_scripts/open_key_mouse/command_dispatcher.js scripts/e2e_open_key_mouse.js tests/unit_tests/open_key_mouse/command_dispatcher_test.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
deno run -A scripts/build_release.js --package
git diff --check
deno fmt --check
```

- 验证结果：`./make.js package` 通过；单元测试 `277/277`、DOM 测试 `109/109`，总计 `386/386`；
  隔离 Chrome for Testing E2E 退出码 0，覆盖核心鼠标轨迹、Super Drag 链接/图片/文字/原生旁路、
  Wheel、Rocker、跨 frame、站点规则、设置导入导出/非法导入和 Service Worker 终止后命令；语法检查、
  权限审计、网络审计、发布检查和 `git diff --check` 均通过。定向 `deno fmt` 检查通过；全仓
  `deno fmt --check` 退出码 1，报告既有上游测试/样式和用户设计文档 14 个文件，以及本轮触及的
  3 个 Markdown 证据文档；检查未修改任何文件。
- 安全边界：权限审计仍为 9 项权限且无禁止权限/远程脚本；网络审计扫描 26 个新增模块文件，未发现
  后台或隐式网络调用；本轮没有引入账户、广告、付费入口、遥测、远程代码，也没有复制或移植
  CrxMouse 闭源代码、资产、文案或界面。以上为审计和当前代码证据，不扩大为平台兼容性声明。
- 风险与未验证：系统 Chrome 151 的 unpacked content verification 仍阻塞扩展页面直接手工加载；
  Windows + Chrome、Windows + Edge、Linux + Chrome，以及 GitHub/Gmail/Google Docs/Notion/YouTube/
  Reddit/在线编辑器/长列表等真实站点矩阵、完整 Vimium 原有 E2E 和无障碍回归未执行。功能矩阵中
  对应项目保持 `IN_PROGRESS`，没有标记为 `DONE`。
- 下一步：在独立 Windows + Edge Stable 临时 profile 中运行与本轮相同的手工兼容性矩阵，并将实际
  结果回写 `docs/feature-parity-matrix.md`；本轮不虚构该结果。
- 对应提交：本地 main 检查点已创建；未配置 origin，不推送。

## 2026-08-23 / 发布包纯净性收口与最终基线重跑 / E-003

- 授权边界：用户明确要求“按照建议 一次性完成”；本条只收口当前本机可执行的发布工程和自动验证，
  不把 Windows、Linux、Edge 或真实第三方站点矩阵写成已验证。
- 发现并修复：`rsync` 的发布排除项原先只排除了 Markdown 文件，商店包仍会携带 `docs/` 目录和
  `scripts/` 下的开发脚本。`make.js` 现显式排除这两个源码仓库专用目录；未修改功能代码、权限、
  网络行为或许可证链。
- 修改文件：`make.js`、`docs/release-checklist.md`、`docs/codex-progress.md`。
- 实际执行命令与结果：

```bash
./make.js package
unzip -l dist/chrome-store/vimium-chrome-store-2.4.2.zip | rg '(^|/)(tests|scripts|docs)/|\.md$|debug|personal|e2e|\.log$|\.pem$|\.key$' || true
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
PUPPETEER_EXECUTABLE_PATH="/Users/yang/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
deno check make.js background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/frame_gesture_bridge.js background_scripts/open_key_mouse/command_dispatcher.js scripts/e2e_open_key_mouse.js tests/unit_tests/open_key_mouse/command_dispatcher_test.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
git diff --check
deno fmt --check
```

- 验证结果：商店包生成通过，禁入路径审计无输出；单元测试 `277/277`、DOM 测试 `109/109`，总计
  `386/386`；Chrome for Testing 148.0.7778.96 独立临时 profile 的完整 E2E 退出码 0，页面错误为空；
  `deno check`、权限审计、网络审计、发布检查、源码发布包生成和 `git diff --check` 通过。Chrome
  商店包和源码发布包均已完成 SHA-256 记录；源码包归档审计未发现测试目录、Markdown 或密钥文件。
- 格式边界：`deno fmt --check` 仍以退出码 1 结束，报告 17 个既有上游、测试/样式、设计文档及本轮
  证据 Markdown 文件；检查未修改文件。定向检查的新增 JavaScript 已通过。
- 额外浏览器尝试：Chromium 145.0.7632.6 可执行文件能输出版本，但启动后 10 秒内没有提供 CDP
  `/json/version`；本地 Chromium 152 下载缺少 Framework 文件，连版本启动均失败。两次都未进入功能
  断言，因此不计入 E2E 通过，也不替代 Windows/Linux/Edge 证据。
- 风险与未验证：完整 Vimium 页面手工回归、Windows + Chrome、Windows + Edge、Linux + Chrome、
  Firefox/Safari、真实第三方站点和无障碍矩阵仍未执行；功能矩阵继续保留 `IN_PROGRESS`。
- 对应提交：本轮本地 main 收口提交；无 `origin`，不推送。

## 2026-08-23 / 增强 Super Drag 与设置闭环验证 / E-004

- 授权边界：用户明确要求“按照建议 一次性完成”；本条继续只记录当前可执行的本地闭环，不把
  Windows、Linux、Edge、真实第三方站点或完整 Vimium 手工矩阵写成完成。
- 发现并修复：真实 Shadow DOM 事件在文档监听器中会把 `event.target` 重定向为宿主元素；超级拖拽
  分类器现结合 `event.composedPath()` 识别 Shadow DOM 内的链接，同时保留文件上传、文本输入、
  textarea、contenteditable、draggable 和危险 URL 的原生/安全旁路。
- 新增验证：BrowserCommandAdapter 的安全 URL、搜索 API、会话模块切换单元测试；Shadow DOM 重定向
  分类单元测试；隔离 fixture 的链接文字/URL复制、图片 URL/下载、选择文字、Shadow DOM、原生输入
  保护、内层滚动、普通右键、Vimium 备份未知字段报告、schemaVersion 逐级迁移和本地 PNG 指针闭环。
- 修改文件：`content_scripts/mouse/drag_context_classifier.js`、`content_scripts/mouse/super_drag_controller.js`、
  `scripts/e2e_open_key_mouse.js`、`tests/unit_tests/open_key_mouse/drag_context_classifier_test.js`、
  `tests/unit_tests/open_key_mouse/browser_command_adapter_test.js`。
- 实际执行命令与结果：

```bash
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno check make.js background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/super_drag_controller.js content_scripts/mouse/drag_context_classifier.js content_scripts/mouse/frame_gesture_bridge.js background_scripts/open_key_mouse/command_dispatcher.js background_scripts/open_key_mouse/browser_command_adapter.js scripts/e2e_open_key_mouse.js tests/unit_tests/open_key_mouse/browser_command_adapter_test.js tests/unit_tests/open_key_mouse/drag_context_classifier_test.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
./make.js package
deno run -A scripts/build_release.js --package
PUPPETEER_EXECUTABLE_PATH="/Users/yang/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
git diff --check
```

- 验证结果：单元测试 `282/282`、DOM 测试 `109/109`，总计 `391/391`；权限审计通过 9 项权限，网络
  审计扫描 26 个新增模块且无后台或隐式网络调用；发布检查、商店包/源码包生成、包禁入路径审计和
  `git diff --check` 通过。CFT 148.0.7778.96 独立临时 profile 的增强 E2E 退出码 0，页面错误为空，
  实际覆盖核心手势、Super Drag、Wheel、Rocker、跨 frame、原生安全、站点规则、设置导入导出、
  Vimium 备份迁移、逐级迁移、本地 PNG 指针和 Service Worker 重启。
- 发布包 SHA-256：Chrome 商店包
  `6f4e561c69adaa9c4d7dc13de008efe271e89ff1849413c1f5c7e83d5175b90f`；源码包
  `6962858128eaa13f96661d4db58bb443487208efd1c4f855a9631b0e47a31013`。
- 额外浏览器实际尝试：系统 Chrome 151.0.7922.173 的隔离启动只发现无法提供本项目
  `pages/mouse_options.html` 的扩展目标，脚本在功能断言前退出；不计入通过，也不替代 CFT 148 证据。
  Windows、Linux、Edge、Firefox、Safari 和真实第三方站点仍未验证。
- 格式边界：定向 JavaScript 格式/类型检查通过；全仓 `deno fmt --check` 的既有上游/测试/样式/设计
  文档和证据 Markdown 不作为本轮源码通过依据，也未由检查命令自动改写。
- 风险与未验证：功能矩阵中未达到完整平台手工矩阵的条目继续保持 `IN_PROGRESS`；不能据此声称
  Windows、Linux、Edge、真实站点、完整 Vimium 页面回归或无障碍回归已完成。
- 下一步：在真实 Windows 环境的隔离 Chrome Stable profile 中执行设计文档 §18.4 手工矩阵，并将实际结果回写功能矩阵。
- 对应提交：本轮本地 main 提交；无 `origin`，不推送。

## 2026-08-23 / Linux ARM64 补充基线与扩展 E2E / E-005

- 授权边界：继续执行用户要求的一次性验证；只记录实际可运行的 Linux ARM64 隔离证据，不把它扩大为
  Linux + Chrome Stable、Windows、Edge、真实第三方站点或无障碍人工验收。
- 环境：Docker `linux/arm64`、Debian 13、Chromium `151.0.7922.169`；完整 `make.js` 基线以非 root
  用户运行，并在一次性隔离容器中使用 `--security-opt seccomp=unconfined` 解决 namespace 启动限制。
- 实际执行与结果：

```text
./make.js test
单元测试：282/282
DOM 测试：109/109
总计：391/391，退出码 0

scripts/e2e_open_key_mouse.js
退出码 0；页面错误为空；设置导入导出、站点规则、核心手势、Super Drag、Wheel、Rocker、跨 frame、Service Worker 重启通过
```

- 该证据补足了 Linux 内核/浏览器运行时的自动测试覆盖，但 Chromium 不是设计文档要求的 Chrome Stable，
  也没有执行 Linux 手工真实站点矩阵；对应功能矩阵继续保持 `IN_PROGRESS`。
- 本次最终重建产物 SHA-256：Chrome 商店包
  `0e6b8b5e62a09d61946bd5d2321105e7758e4b309e05afe8db36ee11c600dfc3`；源码包
  `5fe236b81e2cd3c288988261e100aa39e8ce9b130c7097ec7e3c66a0983300f0`。源码包按设计包含审计和 E2E
  开发脚本，但不包含测试目录、Markdown 文件、密钥或个人路径；商店包不包含 `scripts/`、`docs/` 或测试目录。
- 修改文件：`docs/baseline.md`、`docs/release-checklist.md`、`docs/codex-progress.md`。
- 风险与未验证：Windows + Chrome、Windows + Edge、macOS + Chrome Stable 手工矩阵、Linux + Chrome Stable
  手工矩阵、真实第三方站点、完整 Vimium 页面人工回归、屏幕阅读器/高对比度/缩放回归仍无实际证据。
- 对应提交：待本轮文档核对后创建本地提交；无 `origin`，不推送。

## 2026-08-24 / 设置页无障碍、真实站点冒烟与最终本地门禁 / E-006

- 授权边界：用户明确要求“按照建议 一次性完成”；本轮继续只收口当前环境可执行的代码、自动化、
  隔离浏览器和发布门禁，不把 Windows、Edge、认证态真实站点、屏幕阅读器或人工跨平台矩阵写成完成。
- 修改文件：`pages/mouse_options.html`、`pages/mouse_options.js`、`pages/gesture_editor.css`、
  `lib/i18n.js`、`_locales/en/messages.json`、`_locales/zh_CN/messages.json`、
  `tests/unit_tests/open_key_mouse/i18n_test.js`、`scripts/e2e_open_key_mouse.js`，以及本记录、
  `docs/baseline.md`、`docs/release-checklist.md`、`docs/feature-parity-matrix.md`。
- 实现内容：设置页补充可访问名称、tab/tablist/tabpanel 语义、键盘导航、文本模式手势录入、焦点可见样式、
  窄视口单列布局和强制颜色/高对比度样式；命令下拉、站点规则和模块开关补充本地化可计算名称。
- 实际执行命令与结果：

```text
macOS Chrome 151.0.7922.173 ./make.js test：单元 282/282，DOM 109/109，总计 391/391，退出码 0
Linux ARM64 Debian 13 Chromium 151.0.7922.169 ./make.js test：单元 282/282，DOM 109/109，总计 391/391，退出码 0
Chrome for Testing 148.0.7778.96 增强扩展 E2E：退出码 0，页面错误为空
Linux ARM64 Chromium 151.0.7922.169 增强扩展 E2E：退出码 0，页面错误为空
deno check（本轮触及 JavaScript）：通过
定向 deno fmt --check（8 个本轮触及文件）：通过
deno run -A scripts/audit_permissions.js：通过，9 项权限
deno run -A scripts/audit_network_usage.js：通过，扫描 26 个新增模块且无后台/隐式网络调用
deno run -A scripts/build_release.js：通过
deno run -A scripts/build_release.js --package：通过，生成源码发布包
商店、Firefox、Canary、源码归档禁入路径审计：无命中
git diff --check：通过
```

- 增强 E2E 新增实际覆盖：11 个 tab/tabpanel 关联、roving tabindex、方向键/Home/End、表单名称、
  `L>R` 文本录入和键盘提交、`forced-colors`/`prefers-contrast` 媒体以及 480px 布局；原有核心手势、
  Super Drag、Wheel、Rocker、跨 frame、站点规则、设置迁移和 Service Worker 重启仍通过。
- 真实站点隔离冒烟：在不使用登录态的独立 profile 中，9 个页面（静态页、GitHub、Gmail 登录页、
  Google Docs 登录页、Notion、YouTube、Reddit challenge、StackBlitz、Wikipedia 长列表）均实际返回
  200、内容脚本 `controller`/`initialized` 为真、监听器为 13、页面错误为空；这只是初始化冒烟，不是
  登录态业务或手工手势验收。
- 全仓格式边界：`deno fmt --check` 退出码 1，报告 18 个既有上游测试/样式、设计文档和证据 Markdown
  文件；本轮触及的代码、JSON 和脚本已通过定向格式检查，未用格式化命令改写上游文件。
- 安全边界：没有新增商业化、账户、广告、遥测、远程代码或远程配置；没有复制或移植 CrxMouse 闭源
  代码、资产、文案或界面。真实站点冒烟脚本只用于本地测试，不进入商店包。
- 风险与未验证：当前宿主为 macOS arm64，无可用 Windows VM 或 Edge 安装；系统 Chrome 151 的 unpacked
  content verification 仍导致本项目扩展页面目标不可用，不能把该次失败写成通过。Linux 证据是 ARM64
  Debian Chromium，不是 §18.4 要求的 Linux + Chrome Stable 手工矩阵。认证态 Gmail/Docs/Notion/在线编辑器、
  屏幕阅读器、人工高对比度/缩放、完整 Vimium 原有 E2E 和四平台手工矩阵仍未验证；矩阵维持原状态。
- 下一步：取得合规的 Windows + Chrome Stable/Edge Stable 测试环境后，按设计文档 §18.4 逐项执行手工矩阵，
  再据实际证据更新 `docs/feature-parity-matrix.md`；在此之前不标记 `DONE`。
- 对应提交：本轮文档核对后创建本地检查点；无 `origin`，不推送。

## 2026-08-24 / 覆盖率门禁、配置仓库与最终跨运行时重跑 / E-007

- 授权边界：继续执行用户明确的“一次性完成”要求；本轮只补齐当前 OpenKeyMouse 实现的可验证缺口，
  不把缺少 Windows、Edge、认证态站点和人工矩阵的部分写成完成，也不改变开源、免费、无商业化、无遥测、
  无远程代码和 clean-room 禁止复制 CrxMouse 闭源代码/资产/文案/界面的约束。
- 代码与测试修改：补充方向量化、手势识别、滚轮、摇杆、光标、超级拖拽、拖拽分类、命令调用、消息协议、
  站点规则、配置校验、命令注册表、配置仓库、帧协调器、浏览器命令适配器和 Dispatcher 的边界/异常测试；
  修复 `BrowserCommandAdapter` 缺失的窗口状态路由，fullscreen 在 fullscreen/normal 间切换，另支持
  minimized 和 maximized，并保留无活动窗口的安全错误返回。
- 覆盖率实际结果：Deno V8 coverage 的 `test-unit` 为 `308/308`；新增纯算法模块行覆盖率均不低于 90%，
  配置模块（schema、validator、migrations、repository）为 `98.1%`–`99.7%`，Dispatcher 为 `100%`，
  本轮纳入范围总计 `97.6%`。这是真实采集结果，不是由单元通过率推定。
- 当前 checkout 的自动验证：

```text
macOS arm64 系统 Chrome 覆盖 ./make.js test：单元 308/308，DOM 109/109，总计 417/417，退出码 0
macOS arm64 Chrome for Testing 148.0.7778.96 增强扩展 E2E：退出码 0，页面错误为空
Linux arm64 Debian 13 Chromium 151.0.7922.169（非 root 临时容器）./make.js test：单元 308/308，DOM 109/109，总计 417/417，退出码 0
Linux arm64 Debian 13 Chromium 151.0.7922.169 增强扩展 E2E：退出码 0，页面错误为空
```

- 其他门禁：`deno check` 通过；权限审计通过（9 项权限，无禁止权限或远程脚本）；网络审计扫描 26 个新增
  模块且无后台/隐式网络调用；`scripts/build_release.js` 和 `./make.js package` 通过；`git diff --check`
  通过。商店包不包含 `docs/`、`scripts/`、测试目录或 Markdown，源码交付包仍按设计保留开发审计资料。
- 当前重建产物 SHA-256：Chrome 商店包
  `c8af2b604024069ace7e5edd2bbf89b37e783122743649ff0b7b5aa8db7972e6`；Firefox 包
  `c2a02027409c4c4d7f2e6d879a86719a76bc55a5b506abba0efb09a6be09a39a`；Canary 包
  `11af2eacad4b3ea57d530eeae07b4b3b594c38c9eb908bf0e2b2fdc18730bd6e`；源码包
  `ba76e75dda45c2a94b12465c3b4cda59865d4af4713a000e3e8cbc74e7ac96a0`。
- 浏览器边界：系统 Chrome 151 的命令行扩展加载仍明确报告 `--disable-extensions-except is not allowed`
  并忽略加载参数；Windows VM、Edge Stable 不在当前主机可用环境中。Linux Chromium 隔离结果不等同于
  Linux Chrome Stable 手工结果。认证态 Gmail/Docs/Notion/在线编辑器、屏幕阅读器、人工高对比度/缩放、
  完整 Vimium 手工回归和 §18.4 四平台矩阵仍未验证，功能矩阵维持 `IN_PROGRESS`。
- 下一步：只有在取得合规的 Windows + Chrome Stable/Edge Stable 测试环境并实际完成 §18.4 矩阵后，才可
  更新对应矩阵状态；当前本地工作仅创建检查点，不推送、不发布。
- 对应提交：已创建本地 main 检查点；无 `origin`，不推送。

## 2026-08-24 / 受限动作页修复与最终门禁复核 / E-008

- 授权边界：继续执行用户明确的“一次性完成”要求；只修复已由代码审查确认的受限页 UI 缺口，不扩大
  浏览器权限、网络、商业化或 CrxMouse 参考范围。
- 修改文件：`pages/action.html`、`pages/action.js`、`scripts/e2e_open_key_mouse.js`，并同步本记录、发布检查表
  和功能对照矩阵。
- 修复内容：动作页在判断当前标签页是否存在内容脚本前不再显示 OpenKeyMouse 操作控件；受限页统一隐藏操作区，
  使用 `browserRestriction` 与 `pageUnavailable` 本地化文案显示浏览器限制。新增 E2E 断言覆盖扩展页面自身这一
  受限上下文。
- 实际验证：

```text
macOS arm64 Chrome 151 覆盖下 ./make.js test：单元 308/308，DOM 109/109，总计 417/417，退出码 0
macOS arm64 Chrome for Testing 148.0.7778.96：增强扩展 E2E 退出码 0，页面错误为空
Linux arm64 Debian 13 Chromium 151.0.7922.169（非 root 临时容器）：./make.js test 417/417，增强扩展 E2E 退出码 0
动作页受限分支：CFT 148 与 Linux Chromium 151 均确认提示可见、OpenKeyMouse 控件隐藏
Deno V8 coverage：test-unit 308/308；本轮纳入范围行覆盖率 97.6%，新增纯算法模块 95.2%–100%
权限审计：9 项权限通过；网络审计：26 个新增模块通过；deno check、定向 deno fmt、git diff --check 通过
./make.js package 与 deno run -A scripts/build_release.js --package：通过
商店包、Firefox、Canary、源码包禁入路径审计：无命中
```

- 当前重建产物 SHA-256：Chrome 商店 `f2ea61ce0868595371b5c26fa627687e37cf2d5bce7498b7c188193716e1e896`；
  Firefox `b61b49dfca555657a2b4f907a6e14895f1df4d0bee8242d38f2a2d7a8265c6f2`；Canary
  `c83f591d63cb4274654ebf098b05b2dfc39dbbb28279fa137826e12c41637317`；源码包
  `9e7424adfbbd3791161b7155ac9fb56e18f3f5b91a8d7023a3163d2f3fa114cd`。
- 浏览器边界：系统 Chrome 的隔离 UI 尝试实际确认“加载已解压”进入原生文件选择器，Puppeteer/CDP 无法代替
  用户选择目录；命令行扩展加载参数也被 Google Chrome 拒绝。因此没有将系统 Chrome Stable 手工扩展矩阵写成
  通过。Windows、Edge、Linux Chrome Stable、认证态真实站点、屏幕阅读器、人工高对比度/缩放和完整 Vimium
  手工回归仍未验证，功能矩阵继续保持 `IN_PROGRESS`。
- 对应提交：待本轮提交；仓库仅保留本地检查点，无 `origin`，不推送、不发布。

## 2026-08-24 / 设计文档 fixtures 真实扩展冒烟 / E-009

- 授权边界：继续执行用户明确的“一次性完成”要求；本轮只补齐 §18.2 fixture 的自动化证据，不将其扩大为
  Windows、Edge 或人工平台矩阵完成。
- 修改文件：`scripts/e2e_open_key_mouse.js`，并同步本记录、发布检查表和功能对照矩阵。
- 实际覆盖：通过本地 fixture 服务加载并断言 `basic-links.html`、`inputs.html`、`scroll-containers.html`、
  `iframes.html`、`shadow-dom.html`、`drag-drop-app.html`、`contenteditable.html`、`images.html`；图片资源在
  测试服务内改写为本地 PNG，未引入第三方网络请求。
- 实际结果：macOS Chrome for Testing 148.0.7778.96 与 Linux ARM64 Debian Chromium 151.0.7922.169 的
  增强扩展 E2E 均退出码 0；两者均同时通过动作页受限提示、核心手势、设置闭环和 Service Worker 重启。
  macOS 系统 Chrome 覆盖下 `./make.js test` 仍为单元 `308/308`、DOM `109/109`，总计 `417/417`。
- 重新生成源码包后 SHA-256：`3630fae8e26603f7a093bf141d891612f2b209cbcdbc59b8647057e32bd62c2c`；
  Chrome 商店、Firefox、Canary 包分别保持 `f2ea61ce0868595371b5c26fa627687e37cf2d5bce7498b7c188193716e1e896`、
  `b61b49dfca555657a2b4f907a6e14895f1df4d0bee8242d38f2a2d7a8265c6f2`、
  `c83f591d63cb4274654ebf098b05b2dfc39dbbb28279fa137826e12c41637317`。
- 未完成边界：Windows、Edge、Linux Chrome Stable 与 macOS Chrome Stable 的人工扩展矩阵、认证态真实站点、
  屏幕阅读器、人工高对比度/缩放和完整 Vimium 手工回归仍无可复核证据。

## 2026-08-24 / Edge Linux 隔离运行时补充 / E-010

- 环境：官方 Microsoft Edge `151.0.4129.101`、Debian amd64 隔离容器（ARM 宿主通过 Docker amd64 模拟）、
  非 root 用户、临时 profile；未接触用户浏览器或登录态。
- 实际结果：`./make.js test` 单元 `308/308`、DOM `109/109`，总计 `417/417`；增强扩展 E2E 退出码 0，
  通过核心手势、设置闭环、受限动作页、8 个设计文档 fixture、跨 frame、站点规则、导入导出和 Service
  Worker 重启。
- 边界：这是 Edge 运行时的自动化隔离证据，不是设计文档 §18.4 要求的 Windows Edge Stable 手工结果；
  Windows、Linux Chrome Stable、macOS Chrome Stable 的人工扩展矩阵、认证态真实站点、屏幕阅读器、人工高对比度/
  缩放和完整 Vimium 手工回归仍未验证。

## 2026-08-24 / 最终发布包重建 / E-011

- `./make.js package` 与 `deno run -A scripts/build_release.js --package` 均通过；商店包、Firefox、Canary 和源码
  包禁入路径审计无命中。
- 本次最终重建 SHA-256：Chrome 商店 `ff7bae3401955da6b99a4eb656f2060446c73e617a0bea460f54cae995186e23`；
  Firefox `6b918bbf93cf443f3f4a5e16b94ffba0ecedaafa9d641db6ba2d3c929b85c355`；Canary
  `b51a656cdc6bdefaed42ba128d0034ed55fad281694acdfee7a884fba25d38e8`；源码包
  `9c9e2a157638225a2efd85c1ebb7787a387f80e68cba36b0fffa0a9d43279a5f`。

## 2026-08-24 / 预发布版本与 Vimium 设置迁移兼容 / E-012

- 授权边界：继续执行用户明确的“一次性完成”要求；修正设计文档要求的 `0.x` 预发布版本和当前治理文档事实，
  不改变 Vimium `v2.4.2` 键盘基线，也不放宽开源、免费、无商业化、无遥测和 clean-room 约束。
- 修改内容：`manifest.json` 使用 OpenKeyMouse `0.1.0`；`lib/settings.js` 将上游 `settingsVersion` 与项目发布版本
  分离并固定为 Vimium `2.4.2`；新增 `tests/unit_tests/settings_test.js` 回归测试；同步 `AGENTS.md`、项目章程、
  隐私/安全政策、ADR、CHANGELOG 和发布清单，去除“当前只有 Phase 0、没有鼠标功能”的陈旧描述。
- 实际验证：

```text
无 PUPPETEER_EXECUTABLE_PATH 的 ./make.js test：环境失败，Puppeteer 缓存的 CFT 131 框架文件缺失；未执行 DOM 断言
macOS 系统 Chrome ./make.js test：单元 309/309，DOM 109/109，总计 418/418，退出码 0
macOS Chrome for Testing 148 增强扩展 E2E：退出码 0，页面错误为空
Linux ARM64 Debian 13 Chromium 151（非 root 临时容器）：单元 309/309，DOM 109/109，总计 418/418；增强 E2E 退出码 0
官方 Microsoft Edge 151.0.4129.101 Debian amd64 隔离容器：单元 309/309，DOM 109/109，总计 418/418；增强 E2E 退出码 0
```

- 安全和工程门禁：权限审计 9 项通过；新增模块网络审计扫描 26 个文件通过；定向 `deno fmt --check` 25 个文件、
  `deno check`、`git diff --check` 和源码/商店包禁入路径审计通过。Deno V8 当前新增运行时模块范围汇总行覆盖率为
  `98.8%`；纯算法模块最低 `95.2%`，配置模块最低 `98.1%`，Dispatcher `100%`，均达到设计文档阈值。
- 产物：`./make.js package` 与 `deno run -A scripts/build_release.js --package` 通过；生成 `0.1.0` 商店、Firefox、
  Canary 和源码包。Chrome 商店、Firefox、Canary、源码 SHA-256 分别为
  `24db8ba6bb0e080d65d25f8157c35a1537a09ceb955d254e2d12d209d131f145`、
  `f3e2fa2a11737bff263a742ffa5e0bf00c8ef892b23066b44b9bd1bfe49f294f`、
  `c4342265111d5aec7a96e86d3988a32c0d27d63a0a3f91e19aefdb4479a765e3`、
  `19d25dd658d394da3186d128bc471bd77f9803d9742c8a6680f0abd107f54d59`。
- 未完成边界：Windows、Windows Edge、Linux Chrome Stable、macOS Chrome Stable 人工矩阵，认证态真实站点、
  屏幕阅读器、人工高对比度/缩放和完整 Vimium 手工回归仍没有实际证据；功能矩阵继续保持 `IN_PROGRESS`。
- 本地检查点：已创建提交 `fix: 收口预发布版本与设置迁移兼容`；工作区最终复核应保持干净；未配置新远端，未推送。

## 2026-08-24 / 官方 Linux Chrome Stable 自动基线 / E-013

- 环境：Docker `linux/amd64`、Debian 13，官方 Google Chrome Stable `151.0.7922.173`，非 root 用户，
  `seccomp=unconfined`，临时 profile，显式 `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome`；项目目录只读挂载，
  Deno 使用容器内可写缓存。
- 实际结果：`./make.js test` 通过，单元 `309/309`、DOM `109/109`，总计 `418/418`，退出码 0。
- unpacked E2E 结果：`scripts/e2e_open_key_mouse.js` 未发现项目的 `background_scripts/main.js` 或
  `service_worker.js` 目标，Chrome 目标列表只出现内置 Google Network Speech 组件扩展，故在扩展页面探针处超时；
  这不是 E2E 通过，也不证明官方 Chrome Stable 已加载 OpenKeyMouse。
- 边界：该证据补足官方 Linux Chrome Stable 的测试运行时基线，但不替代 §18.3 unpacked E2E、§18.4 Linux Chrome
  Stable 手工矩阵，也不改变 `V-002`、`O-001` 至 `O-005` 和 `C-001` 至 `C-003` 的 `IN_PROGRESS` 状态。
- 本轮未修改运行时代码；后续仍需真实 Chrome Stable UI 加载扩展，或取得可复核的 Windows/Edge 测试环境。

## 2026-08-24 / Chrome Stable CDP unpacked E2E / E-014

- 修改：`scripts/e2e_open_key_mouse.js` 增加显式环境开关 `OPEN_KEY_MOUSE_E2E_LOAD_UNPACKED_VIA_CDP=true`；开启时
  不使用品牌 Chrome 会忽略的命令行 unpacked 参数，改用浏览器级 `Extensions.loadUnpacked`，默认 CFT/Chromium
  路径保持不变。
- macOS Chrome Stable `151.0.7922.173`：实际加载项目扩展，完整 E2E 退出码 0。
- Linux amd64 Debian 13 Chrome Stable `151.0.7922.173`：非 root、`seccomp=unconfined`、临时 profile 下，
  `./make.js test` 为单元 `309/309`、DOM `109/109`、总计 `418/418`；随后通过 CDP 加载项目扩展，完整 E2E
  退出码 0。
- E2E 覆盖：受限动作页、设置页键盘/无障碍语义、鼠标轨迹、历史、Super Drag、Wheel/Rocker、跨 frame、原生旁路、
  站点规则、设置保存/导入导出、Vimium 备份迁移、逐级迁移、本地 PNG 指针、Service Worker 重启和 8 个 fixtures。
- 边界：这是官方 Chrome Stable 的真实 CDP 自动化证据，不是 §18.4 人工矩阵；Windows Chrome、Windows Edge、
  Linux Chrome Stable 人工操作、认证态站点、屏幕阅读器、人工高对比度/缩放和完整 Vimium 手工回归仍未验证。

## 2026-08-24 / Windows 环境与可见 UI 探测 / E-015

- 环境探测：`prlctl list --all` 返回空列表；Parallels Desktop `26.4.1-57516` 虽已安装，本机也有约 6.4 GiB
  的 Windows ARM64 ISO，但 `/Users/yang/Parallels` 没有 `.pvm`，Docker 仅有 Linux 镜像。本轮没有创建或启动虚拟机，
  没有接触用户浏览器、Cookie、Token 或登录态。
- macOS 隔离 UI 探测：独立临时 Chrome profile 使用浏览器级 `Extensions.loadUnpacked` 加载
  `/Users/yang/project/plugin/open-key-mouse/dist/vimium`，实际出现项目 `background_scripts/main.js` Service Worker
  目标；随后 `@oai/sky` 的 `get_app_state` 在 30 秒内超时，未形成 Computer Use 人工 UI 证据。临时 Chrome 进程已关闭。
- 结论边界：本条只记录环境和加载路径事实，不把 CDP 或超时前的启动结果写成 §18.4 手工矩阵通过；Windows Chrome、
  Windows Edge、认证态真实站点、屏幕阅读器、人工高对比度/缩放和完整 Vimium 手工回归仍未验证。
- 下一步：取得合规的 Windows Chrome Stable/Edge Stable 测试环境后，按设计文档 §18.4 执行并回写实际结果。
