# ADR-004：配置存储分层

- 状态：已记录，待 Phase 3 实施
- 日期：2026-08-23

## 决策

未来小型可同步配置进入 chrome.storage.sync；本地大对象和自定义资源进入
chrome.storage.local；会话临时状态进入 chrome.storage.session。不申请 unlimitedStorage，除非另有公开
ADR 证明真实需求。

## 当前边界

Phase 0 不创建鼠标配置 schema、迁移函数、设置仓库、导入导出格式或新的 storage 代码。该决策不改变现有
Vimium 键盘设置行为。
