# 功能对照矩阵

状态只能使用 `TODO`、`IN_PROGRESS`、`BLOCKED_BROWSER_LIMITATION`、`DONE`、`NOT_APPLICABLE`。矩阵中的
`DONE` 只表示对应自动测试和当前平台手工验证均有证据。

| 编号  | 来源         | 功能                                    | 公开参考       | 本项目命令          | 自动测试 | 手工测试 | 状态        | 备注                                                     |
| ----- | ------------ | --------------------------------------- | -------------- | ------------------- | -------- | -------- | ----------- | -------------------------------------------------------- |
| V-001 | Vimium       | 原有键盘导航                            | Vimium v2.4.2  | 既有命令集合        | PASS     | BASELINE | DONE        | 上游基线保持                                             |
| V-002 | Vimium       | 链接提示、Vomnibar、查找、Visual、Marks | Vimium v2.4.2  | 既有命令集合        | PASS     | PENDING  | IN_PROGRESS | 需完成扩展页面手工矩阵                                   |
| O-001 | OpenKeyMouse | 统一 CommandInvocation / Dispatcher     | 本项目设计文档 | 全部新增输入        | PASS     | E2E-CFT  | IN_PROGRESS | CFT 148 真实 E2E 覆盖鼠标、Super Drag、Wheel、Rocker、跨 frame、设置闭环和 Service Worker；完整 Vimium 手工矩阵待测 |
| O-002 | OpenKeyMouse | 四向/八向右键轨迹                       | 本项目设计文档 | mouse bindings      | PASS     | E2E-CFT  | IN_PROGRESS | 已实测后退、前进、滚动、关闭标签和阈值旁路；八向及全部绑定仍待测 |
| O-003 | OpenKeyMouse | 安全超级拖拽                            | 本项目设计文档 | OpenKeyMouse.*      | PASS     | E2E-CFT  | IN_PROGRESS | 已实测链接前台/后台、链接文字/URL、图片打开/URL/下载、选择文字、Shadow DOM、draggable、Alt 旁路和文件/输入/编辑器保护；完整平台矩阵仍待测 |
| O-004 | OpenKeyMouse | 滚轮组合与摇杆                          | 本项目设计文档 | wheel / rocker      | PASS     | E2E-CFT  | IN_PROGRESS | 已实测右键滚轮上/下及摇杆正反组合；左/中键滚轮、阈值边界和更多组合仍待测 |
| O-005 | OpenKeyMouse | 设置、迁移、站点规则、导入导出          | 本项目设计文档 | settings repository | PASS     | E2E-CFT  | IN_PROGRESS | 已实测设置保存、语言持久化、有效/非法导入、导出、Vimium 备份迁移、逐级迁移、运行时站点规则和本地 PNG 指针；完整 UI 矩阵仍待测 |
| O-006 | OpenKeyMouse | 国际化                                  | Chrome i18n    | 本地 messages.json  | PASS     | PASS     | DONE        | 已实测 zh_CN 展示、English 切换和保存后持久化            |
| C-001 | CrxMouse     | 右键左划后退                            | 公开功能描述   | goBack              | PASS     | E2E-CFT  | IN_PROGRESS | clean-room 独立实现；真实 E2E 已覆盖普通页和跨 frame，完整平台矩阵仍待测 |
| C-002 | CrxMouse     | 右键右划前进                            | 公开功能描述   | goForward           | PASS     | E2E-CFT  | IN_PROGRESS | clean-room 独立实现；真实 E2E 已覆盖历史前进，完整平台矩阵仍待测 |
| C-003 | CrxMouse     | 超级拖拽                                | 公开功能描述   | OpenKeyMouse.*      | PASS     | E2E-CFT  | IN_PROGRESS | 真实 E2E 已覆盖链接、图片、文字、下载、Shadow DOM 和原生旁路；不复制闭源代码、资产、文案或界面 |

任何未达到 `DONE` 或明确浏览器限制的项目都不能宣称完整覆盖。

2026-08-24 补充证据：设置页键盘导航、ARIA 关联、无名称控件检查、文本替代录入、强制颜色媒体和
480px 窄视口已由 Chrome for Testing 与 Linux ARM64 Chromium 增强 E2E 自动验证；`example.com`、
GitHub、Gmail 登录页、Google Docs 登录页、Notion、YouTube、Reddit challenge、StackBlitz 和
Wikipedia 长列表也完成了隔离内容脚本注入冒烟。上述证据不替代屏幕阅读器、人工高对比度/缩放、登录态
业务流程或设计文档 §18.4 的 Windows、macOS、Linux Chrome Stable、Edge 手工矩阵，因此不改变矩阵状态。

2026-08-24 自动门禁补充：当前 checkout 的单元/DOM 基线为 `308/308`、`109/109`，macOS Chrome for
Testing 148 与 Linux ARM64 Debian Chromium 151 的增强 E2E 均通过；新增算法、配置和 Dispatcher 的
行覆盖率门槛也已实际采集并通过。窗口状态命令补齐了 fullscreen/normal、minimized、maximized 的
浏览器 API 路由。上述自动证据仍不提供 §18.4 所需的 Windows、Edge、Chrome Stable 手工结果，因此
`V-002`、`O-001` 至 `O-005` 和 `C-001` 至 `C-003` 继续保持 `IN_PROGRESS`。
