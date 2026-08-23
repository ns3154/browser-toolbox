# 发布检查表

## 代码与测试

- [x] `./make.js test` 通过，或所有上游失败项有明确基线证据。当前 macOS 环境为单元 309/309、DOM 109/109，总计 418/418。
- [x] `deno run -A scripts/audit_permissions.js` 通过。
- [x] `deno run -A scripts/audit_network_usage.js` 通过。
- [x] 新算法、配置、Dispatcher 和关键 UI 流程有自动测试。
- [x] Service Worker 终止后可以重新初始化。
- [x] 独立 Chrome for Testing 148.0.7778.96 临时 profile 的增强扩展 E2E 通过，覆盖核心手势、Super Drag、原生安全、跨 frame、设置迁移、键盘无障碍语义、高对比度媒体和窄视口布局。
- [x] 动作页在扩展页面自身等受限上下文中显示本地化浏览器限制提示，并隐藏 OpenKeyMouse 操作控件；CFT 148 与 Linux ARM64 Chromium E2E 均实际断言通过。
- [x] 设计文档 §18.2 的 8 个仓库 fixture 均由真实扩展 E2E 加载并完成结构断言。
- [x] Linux ARM64 Debian Chromium 151 隔离环境的完整基线 `418/418` 和增强扩展 E2E 通过；该项不替代 Linux + Chrome Stable 手工矩阵。
- [x] 官方 Microsoft Edge Linux 151.0.4129.101 amd64 隔离环境的完整基线 `418/418` 和增强扩展 E2E 通过；该项不替代 Windows Edge 手工矩阵。
- [x] 覆盖率门槛通过：新增纯算法模块行覆盖率均不低于 90%，配置模块和 Dispatcher 行覆盖率均不低于 85%；当前新增运行时模块范围汇总行覆盖率 98.8%。
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
- [x] 预发布版本使用 `0.1.0`；Vimium `2.4.2` 仅作为键盘与设置迁移兼容基线。
- [x] 源码、发布包和 SHA-256 对应同一提交；本地检查点提交后已重新生成并核对 Chrome 包 SHA-256，最终值记录在本轮交付报告。
- [x] 当前 `0.1.0` 重建产物 SHA-256：Chrome 商店 `d59749f042f3f989109489838a409d6acf00cd747f14003d8275fca0ccb80c3a`；Firefox `18868d7d868bcfc445aa9589111020ba044c62a5ad493a5ba4eedd3ccb3d84a5`；Canary `8204c189a1236fb33229984a8a1a18a99e7ed26c3ee3fbe1e8666f0dacd84f9a`；源码 `a46ee9d1db1fd516b843208fb0d22a3eccd156d59da1efe8ad67adbd6e8dcb8d`。
- [x] 发布包不含测试、调试日志、个人路径、测试密钥或本机凭证；`make.js` 已排除 `docs/` 和
      `scripts/`，并通过 `unzip -l dist/chrome-store/vimium-chrome-store-0.1.0.zip` 的禁入路径审计。
- [ ] Chrome、Edge、Windows、macOS、Linux 的手工矩阵已记录实际结果。
