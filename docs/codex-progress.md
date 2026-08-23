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
