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

2026-08-24 受限动作页补充证据：动作页现在先确认当前标签页存在内容脚本，再初始化 OpenKeyMouse 控件；
在扩展页面自身这一受限上下文中，CFT 148 与 Linux ARM64 Chromium 151 的增强 E2E 均实际确认限制提示可见、
操作控件隐藏，且提示包含浏览器限制说明。该证据覆盖了“不能静默失效”的 UI 约束，但不改变跨平台手工矩阵状态。

2026-08-24 fixture 补充证据：真实扩展 E2E 通过本地 fixture 服务加载并断言了 `basic-links.html`、
`inputs.html`、`scroll-containers.html`、`iframes.html`、`shadow-dom.html`、`drag-drop-app.html`、
`contenteditable.html`、`images.html` 八个设计文档 §18.2 fixture；该证据增强自动测试覆盖，不替代 §18.4
要求的人工平台矩阵。

2026-08-24 Edge 自动运行补充证据：官方 Microsoft Edge `151.0.4129.101` 在 Debian amd64 隔离容器中完成
`308/308` 单元、`109/109` DOM 和增强扩展 E2E；该结果覆盖 Edge 运行时自动兼容性，不等同于 Windows Edge
Stable 人工矩阵，因此所有需要人工矩阵的状态保持不变。

2026-08-24 预发布版本补充证据：将 manifest 版本改为 OpenKeyMouse `0.1.0` 后，Vimium 设置迁移兼容版本仍固定为
`2.4.2`；macOS 系统 Chrome、Linux ARM64 Debian Chromium 151 和官方 Microsoft Edge Debian amd64 隔离环境的
当前全量测试均为 `309/309` 单元、`109/109` DOM，总计 `418/418`，增强扩展 E2E 均通过。该证据不替代
Windows、Windows Edge、Linux Chrome Stable、macOS Chrome Stable 人工矩阵、认证态站点、屏幕阅读器或完整 Vimium
手工回归，因此相关状态继续保持 `IN_PROGRESS`。
