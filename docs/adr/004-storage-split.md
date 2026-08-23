# ADR-004：配置存储分层

- 状态：已实施，待完整平台验收
- 日期：2026-08-23

## 决策

未来小型可同步配置进入 chrome.storage.sync；本地大对象和自定义资源进入
chrome.storage.local；会话临时状态进入 chrome.storage.session。不申请 unlimitedStorage，除非另有公开
ADR 证明真实需求。

## 当前边界

鼠标配置 schema、逐级迁移、设置仓库、导入导出格式和本地资源分层已经实现，并由配置测试和设置页 E2E 覆盖。
同步配置仍受大小限制，大对象和自定义指针只进入 `storage.local`；该决策不改变现有 Vimium 键盘设置行为。
