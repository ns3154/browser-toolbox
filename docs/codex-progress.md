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
