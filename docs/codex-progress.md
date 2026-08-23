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
