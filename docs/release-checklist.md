# 发布检查表

## 代码与测试

- [x] `./make.js test` 通过，或所有上游失败项有明确基线证据。当前 macOS 环境为单元 308/308、DOM 109/109，总计 417/417。
- [x] `deno run -A scripts/audit_permissions.js` 通过。
- [x] `deno run -A scripts/audit_network_usage.js` 通过。
- [x] 新算法、配置、Dispatcher 和关键 UI 流程有自动测试。
- [x] Service Worker 终止后可以重新初始化。
- [x] 独立 Chrome for Testing 148.0.7778.96 临时 profile 的增强扩展 E2E 通过，覆盖核心手势、Super Drag、原生安全、跨 frame、设置迁移、键盘无障碍语义、高对比度媒体和窄视口布局。
- [x] Linux ARM64 Debian Chromium 151 隔离环境的完整基线 `417/417` 和增强扩展 E2E 通过；该项不替代 Linux + Chrome Stable 手工矩阵。
- [x] 覆盖率门槛通过：新增纯算法模块行覆盖率均不低于 90%，配置模块和 Dispatcher 行覆盖率均不低于 85%；本轮最高范围汇总行覆盖率 97.6%。
- [x] 设置页自动化无障碍语义、键盘替代录入、强制颜色和窄视口冒烟通过；不替代屏幕阅读器和人工可访问性验收。
- [x] 9 个真实站点的隔离内容脚本注入冒烟通过；该项不替代登录态业务流程和 §18.4 手工矩阵。

## 隐私与安全

- [x] 无遥测、账户、广告、付费入口和远程配置；已结合源码约束和网络审计核对。
- [x] 无远程脚本、`eval`、`new Function` 和未经审查的权限；权限/网络审计通过。
- [x] 导入配置只接受 JSON，不执行 HTML 或脚本；有效/非法 JSON 导入 E2E 通过。
- [x] 自定义指针只进入 `storage.local`，已有设置页与本地资源验证。
- [x] `docs/feature-parity-matrix.md` 没有未解释的 TODO；未完成项均保留 `IN_PROGRESS` 和说明。

## 开源与产物

- [x] GPL-3.0-or-later、Vimium MIT 和 shoulda MIT 通知完整；发布检查通过。
- [x] `deno run -A scripts/build_release.js --package` 已生成源码发布包，并完成归档内容审计。
- [x] 源码、发布包和 SHA-256 对应同一提交；本地检查点提交后已重新生成并核对 Chrome 包 SHA-256，最终值记录在本轮交付报告。
- [x] 当前重建产物 SHA-256：Chrome 商店 `c8af2b604024069ace7e5edd2bbf89b37e783122743649ff0b7b5aa8db7972e6`；Firefox `c2a02027409c4c4d7f2e6d879a86719a76bc55a5b506abba0efb09a6be09a39a`；Canary `11af2eacad4b3ea57d530eeae07b4b3b594c38c9eb908bf0e2b2fdc18730bd6e`；源码 `ba76e75dda45c2a94b12465c3b4cda59865d4af4713a000e3e8cbc74e7ac96a0`。
- [x] 发布包不含测试、调试日志、个人路径、测试密钥或本机凭证；`make.js` 已排除 `docs/` 和
      `scripts/`，并通过 `unzip -l dist/chrome-store/vimium-chrome-store-2.4.2.zip` 的禁入路径审计。
- [ ] Chrome、Edge、Windows、macOS、Linux 的手工矩阵已记录实际结果。
