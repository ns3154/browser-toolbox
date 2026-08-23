# 权限说明

当前 Manifest V3 只沿用 Vimium v2.4.2 的权限集合并移除版本升级通知所需的 `notifications`：

- `<all_urls>`：在用户允许的网页上运行键盘和鼠标输入模块。浏览器内置页面仍受平台限制。
- `tabs`：执行用户触发的标签页、窗口和 URL 操作。
- `bookmarks`、`history`、`sessions`：保留 Vimium 的 Vomnibar、历史、书签和恢复标签能力。
- `storage`：保存配置和本地指针资源；不上传任何数据。
- `scripting`、`webNavigation`：保留上游内容脚本注入和 URL 状态同步行为。
- `favicon`、`search`：保留上游图标和用户主动搜索行为。

明确不申请：`management`、`cookies`、`webRequest`、`identity`、`nativeMessaging`、`debugger`、`proxy`、`geolocation`、`unlimitedStorage`、`downloads`
等权限。

任何新增权限必须先有公开 ADR、具体用户功能、最小替代方案评估和权限审计结果。
