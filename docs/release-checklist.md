# 发布检查表

## 代码与测试

- [x] `./make.js test` 通过，或所有上游失败项有明确基线证据。当前系统 Chrome 覆盖下为 386/386。
- [x] `deno run -A scripts/audit_permissions.js` 通过。
- [x] `deno run -A scripts/audit_network_usage.js` 通过。
- [x] 新算法、配置、Dispatcher 和关键 UI 流程有自动测试。
- [x] Service Worker 终止后可以重新初始化。

## 隐私与安全

- [x] 无遥测、账户、广告、付费入口和远程配置；已结合源码约束和网络审计核对。
- [x] 无远程脚本、`eval`、`new Function` 和未经审查的权限；权限/网络审计通过。
- [x] 导入配置只接受 JSON，不执行 HTML 或脚本；有效/非法 JSON 导入 E2E 通过。
- [x] 自定义指针只进入 `storage.local`，已有设置页与本地资源验证。
- [x] `docs/feature-parity-matrix.md` 没有未解释的 TODO；未完成项均保留 `IN_PROGRESS` 和说明。

## 开源与产物

- [x] GPL-3.0-or-later、Vimium MIT 和 shoulda MIT 通知完整；发布检查通过。
- [x] 源码、发布包和 SHA-256 对应同一提交；本地检查点提交后已重新生成并核对 Chrome 包 SHA-256，最终值记录在本轮交付报告。
- [ ] 发布包不含测试、调试日志、个人路径、测试密钥或本机凭证；本轮 E2E 脚本仍位于 `scripts/`，暂不宣称发布包就绪。
- [ ] Chrome、Edge、Windows、macOS、Linux 的手工矩阵已记录实际结果。
