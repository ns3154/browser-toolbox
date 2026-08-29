# ADR-004：配置存储分层

- 状态：已实施，待完整平台验收
- 日期：2026-08-23

## 决策

小型配置默认进入 `chrome.storage.sync`；本地大对象和自定义资源进入
`chrome.storage.local`；会话临时状态进入 `chrome.storage.session`。设置页的
`general.browserSyncEnabled` 允许用户把整份 BrowserToolbox 配置切换到本地存储，仍不申请
`unlimitedStorage`，除非另有公开 ADR 证明真实需求。

切换配置区域时先写入目标区域，再删除另一份规范键；同一规范键不会在两个区域长期并存。
旧 `OpenKeyMouse` 键只读兼容、迁移和回滚，不作为新写入键。

## 当前边界

鼠标配置 schema、逐级迁移、设置仓库、导入导出格式和本地资源分层已经实现，并由配置测试和设置页 E2E 覆盖。
同步配置仍受大小限制，大对象和自定义指针只进入 `storage.local`；同步开关只影响
BrowserToolbox 自有配置，不改变现有 Vimium 键盘设置行为。
