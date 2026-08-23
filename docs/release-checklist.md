# 发布检查表

## 代码与测试

- [ ] `./make.js test` 通过，或所有上游失败项有明确基线证据。
- [ ] `deno run -A scripts/audit_permissions.js` 通过。
- [ ] `deno run -A scripts/audit_network_usage.js` 通过。
- [ ] 新算法、配置、Dispatcher 和关键 UI 流程有自动测试。
- [ ] Service Worker 终止后可以重新初始化。

## 隐私与安全

- [ ] 无遥测、账户、广告、付费入口和远程配置。
- [ ] 无远程脚本、`eval`、`new Function` 和未经审查的权限。
- [ ] 导入配置只接受 JSON，不执行 HTML 或脚本。
- [ ] 自定义指针只进入 `storage.local`，不进入 sync。
- [ ] `docs/feature-parity-matrix.md` 没有未解释的 TODO。

## 开源与产物

- [ ] GPL-3.0-or-later、Vimium MIT 和 shoulda MIT 通知完整。
- [ ] 源码、发布包和 SHA-256 对应同一提交。
- [ ] 发布包不含测试、调试日志、个人路径、测试密钥或本机凭证。
- [ ] Chrome、Edge、Windows、macOS、Linux 的手工矩阵已记录实际结果。
