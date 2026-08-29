# 浏览器工具箱功能对照矩阵

本矩阵按产品层组织：`V-*` 是 Vimium 键盘与浏览器工作流基线，`O-*` 是浏览器工具箱自身的模块， `C-*`
只记录 CrxMouse 公开行为在鼠标输入模块中的参考项。`C-*` 不是本项目的整体功能目标，也不是
闭源实现、资产、文案或界面的来源。`BrowserToolbox.*` 仅是当前 checkout 的内部命令命名空间。

状态只能使用 `TODO`、`IN_PROGRESS`、`BLOCKED_BROWSER_LIMITATION`、`DONE`、`NOT_APPLICABLE`。矩阵中的
`DONE` 只表示对应自动测试和当前平台手工验证均有证据。

| 编号  | 来源         | 功能                                    | 公开参考       | 本项目命令          | 自动测试 | 手工测试 | 状态        | 备注                                                                                                                                                                                                                                                                                                                                   |
| ----- | ------------ | --------------------------------------- | -------------- | ------------------- | -------- | -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V-001 | Vimium       | 原有键盘导航                            | Vimium v2.4.2  | 既有命令集合        | PASS     | BASELINE | DONE        | 上游基线保持                                                                                                                                                                                                                                                                                                                           |
| V-002 | Vimium       | 链接提示、Vomnibar、查找、Visual、Marks | Vimium v2.4.2  | 既有命令集合        | PASS     | PENDING  | IN_PROGRESS | 需完成扩展页面手工矩阵                                                                                                                                                                                                                                                                                                                 |
| O-001 | 浏览器工具箱 | 统一 CommandInvocation / Dispatcher     | 本项目设计文档 | 全部新增输入        | PASS     | E2E-CFT  | IN_PROGRESS | CFT 148 真实 E2E 覆盖鼠标、Super Drag、Wheel、Rocker、跨 frame、设置闭环和 Service Worker；完整 Vimium 手工矩阵待测                                                                                                                                                                                                                    |
| O-002 | 浏览器工具箱 | 四向/八向右键轨迹                       | 本项目设计文档 | mouse bindings      | PASS     | E2E-CFT  | IN_PROGRESS | 默认八方向与 15 组手势已落地；当前 checkout E2E 已实测后退、前进、滚动、关闭标签、`UL`/`UR` 斜向、设置手势和阈值旁路，四个斜向有单测；完整人工平台矩阵仍待测                                                                                                                                                                           |
| O-003 | 浏览器工具箱 | 安全超级拖拽                            | 本项目设计文档 | BrowserToolbox.*    | PASS     | E2E-CFT  | IN_PROGRESS | 已实测链接前台/后台、链接文字/URL、图片打开/URL/下载、选择文字、自定义搜索引擎 keyword、Shadow DOM、draggable、配置的旁路修饰键和文件/输入/编辑器保护；完整平台矩阵仍待测                                                                                                                                                              |
| O-004 | 浏览器工具箱 | 滚轮组合与摇杆                          | 本项目设计文档 | wheel / rocker      | PASS     | E2E-CFT  | IN_PROGRESS | 当前 checkout E2E 已实测右/左键滚轮、未绑定中键旁路、独立阈值会话和摇杆正反组合；完整人工平台矩阵及更多手工组合仍待测                                                                                                                                                                                                                  |
| O-005 | 浏览器工具箱 | 设置、迁移、站点规则、导入导出          | 本项目设计文档 | settings repository | PASS     | E2E-CFT  | IN_PROGRESS | 当前 checkout E2E 已实测箭头式轨迹配置与旧 token 兼容、设置保存、同步/本地存储切换、自定义搜索引擎配置、语言持久化、有效/非法导入、导出、Vimium 备份迁移、逐级迁移、运行时站点规则、规则顺序/匹配顺序解释、动作页会话开关和本地 PNG 指针；双存储应用服务、冲突字段提示和参数控件有单测，兼容 JSON 入口有单测与 E2E；完整 UI 矩阵仍待测 |
| O-006 | 浏览器工具箱 | 国际化                                  | Chrome i18n    | 本地 messages.json  | PASS     | PASS     | DONE        | 已实测 zh_CN 展示、English 切换和保存后持久化                                                                                                                                                                                                                                                                                          |
| C-001 | CrxMouse     | 右键左划后退                            | 公开功能描述   | goBack              | PASS     | E2E-CFT  | IN_PROGRESS | clean-room 独立实现；真实 E2E 已覆盖普通页和跨 frame，完整平台矩阵仍待测                                                                                                                                                                                                                                                               |
| C-002 | CrxMouse     | 右键右划前进                            | 公开功能描述   | goForward           | PASS     | E2E-CFT  | IN_PROGRESS | clean-room 独立实现；真实 E2E 已覆盖历史前进，完整平台矩阵仍待测                                                                                                                                                                                                                                                                       |
| C-003 | CrxMouse     | 超级拖拽                                | 公开功能描述   | BrowserToolbox.*    | PASS     | E2E-CFT  | IN_PROGRESS | 真实 E2E 已覆盖链接、图片、文字、下载、Shadow DOM 和原生旁路；不复制闭源代码、资产、文案或界面                                                                                                                                                                                                                                         |

任何未达到 `DONE` 或明确浏览器限制的项目都不能宣称完整覆盖。

2026-08-24 补充证据：设置页键盘导航、ARIA 关联、无名称控件检查、文本替代录入、强制颜色媒体和 480px
窄视口已由 Chrome for Testing 与 Linux ARM64 Chromium 增强 E2E 自动验证；`example.com`、
GitHub、Gmail 登录页、Google Docs 登录页、Notion、YouTube、Reddit challenge、StackBlitz 和 Wikipedia
长列表也完成了隔离内容脚本注入冒烟。上述证据不替代屏幕阅读器、人工高对比度/缩放、登录态
业务流程或设计文档 §18.4 的 Windows、macOS、Linux Chrome Stable、Edge 手工矩阵，因此不改变矩阵状态。

2026-08-24 自动门禁补充：当前 checkout 的单元/DOM 基线为 `308/308`、`109/109`，macOS Chrome for
Testing 148 与 Linux ARM64 Debian Chromium 151 的增强 E2E 均通过；新增算法、配置和 Dispatcher 的
行覆盖率门槛也已实际采集并通过。窗口状态命令补齐了 fullscreen/normal、minimized、maximized 的 浏览器
API 路由。上述自动证据仍不提供 §18.4 所需的 Windows、Edge、Chrome Stable 手工结果，因此
`V-002`、`O-001` 至 `O-005` 和 `C-001` 至 `C-003` 继续保持 `IN_PROGRESS`。

2026-08-24 受限动作页补充证据：动作页现在先确认当前标签页存在内容脚本，再初始化浏览器工具箱控件；
在扩展页面自身这一受限上下文中，CFT 148 与 Linux ARM64 Chromium 151 的增强 E2E
均实际确认限制提示可见、 操作控件隐藏，且提示包含浏览器限制说明。该证据覆盖了“不能静默失效”的 UI
约束，但不改变跨平台手工矩阵状态。

2026-08-24 fixture 补充证据：真实扩展 E2E 通过本地 fixture 服务加载并断言了 `basic-links.html`、
`inputs.html`、`scroll-containers.html`、`iframes.html`、`shadow-dom.html`、`drag-drop-app.html`、
`contenteditable.html`、`images.html` 八个设计文档 §18.2 fixture；该证据增强自动测试覆盖，不替代
§18.4 要求的人工平台矩阵。

2026-08-24 Edge 自动运行补充证据：官方 Microsoft Edge `151.0.4129.101` 在 Debian amd64
隔离容器中完成 `308/308` 单元、`109/109` DOM 和增强扩展 E2E；该结果覆盖 Edge
运行时自动兼容性，不等同于 Windows Edge Stable 人工矩阵，因此所有需要人工矩阵的状态保持不变。

2026-08-24 预发布版本补充证据：将 manifest 版本改为 BrowserToolbox `0.1.0` 后，Vimium
设置迁移兼容版本仍固定为 `2.4.2`；macOS 系统 Chrome、Linux ARM64 Debian Chromium 151 和官方
Microsoft Edge Debian amd64 隔离环境的 当前全量测试均为 `309/309` 单元、`109/109` DOM，总计
`418/418`，增强扩展 E2E 均通过。该证据不替代 Windows、Windows Edge、Linux Chrome Stable、macOS
Chrome Stable 人工矩阵、认证态站点、屏幕阅读器或完整 Vimium 手工回归，因此相关状态继续保持
`IN_PROGRESS`。

2026-08-24 官方 Linux Chrome Stable 补充证据：Google Chrome Stable `151.0.7922.173` 在 Linux amd64
隔离容器 中完成 `309/309` 单元、`109/109` DOM，总计 `418/418`；其命令行 unpacked 扩展未形成项目
Service Worker 目标， 因此不计为 §18.3 E2E 或 §18.4 手工证据，相关状态继续保持 `IN_PROGRESS`。

2026-08-24 Chrome Stable CDP 补充证据：macOS 和 Linux amd64 的 Google Chrome Stable `151.0.7922.173`
均通过 `Extensions.loadUnpacked` 实际加载项目扩展，并完整通过
`scripts/e2e_browser_toolbox.js`；该结果覆盖 §18.3 的 CDP E2E，但不替代 §18.4 的人工矩阵，因此
`V-002`、`O-001` 至 `O-005` 和 `C-001` 至 `C-003` 继续保持 `IN_PROGRESS`。

2026-08-25 当前 checkout 自动证据补充：macOS Chrome Stable 通过 `Extensions.loadUnpacked`
重新运行当前归档的 E2E，新增覆盖八方向 `DR`
轨迹、左右键滚轮路由、无绑定中键滚轮不拦截、独立未达阈值滚轮会话、六个模块同时由
站点规则停用、Glob/正则测试 URL 输入和设置迁移回滚；单元/DOM 为 `324/324`、`109/109`，shoulda 为
`79/79`。 这些是当前自动化证据，不替代 §18.4 的 Windows、macOS、Linux Chrome Stable、Edge
人工矩阵，也不替代屏幕阅读器、 认证态站点和完整 Vimium 手工回归，因此相关状态继续保持
`IN_PROGRESS`。

2026-08-25 当前 checkout 交互收口补充：动作页会话开关 E2E 已确认 Wheel 与 Rocker
同步写入；站点规则设置页 E2E
已确认操作列、规则优先级和中英文规则按钮文案；动作页在后台返回全局开关实际状态时会回显真实勾选状态。
本轮新增单元后单元/DOM 为 `327/327`、`109/109`，总计 `436/436`，shoulda 为 `82/82`。这些仍是当前
checkout 自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点或完整 Vimium 手工回归。

2026-08-25 设置架构与站点规则安全补充：绑定表格已拆为独立编辑器，命令注册表改为从 `all_commands.js`
单一来源
补齐，自定义注册表拒绝重复命令名；正则站点规则增加明显灾难性回溯形态的复杂度拒绝，设置页测试网址显示命中规则
和最终模块状态。重新打包后的 macOS Chrome Stable 隔离 E2E 通过，单元/DOM 为
`327/327`、`109/109`，shoulda 为
`82/82`。这些仍是自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点或完整 Vimium 手工回归。

2026-08-25
设置保存与低动效补充：设置页保存流程增加异步锁、`aria-busy`、保存中/保存完成状态和按钮禁用，且只在持久化、表单回写与指针预览全部完成后报告保存成功；`prefers-reduced-motion: reduce`
下过渡动画自动压缩。当前 macOS Chrome Stable 隔离 E2E
通过保存竞态回归、低动效/高对比度媒体模拟、旧版迁移、网站规则、核心手势和 Service Worker
重启；单元/DOM 为 `327/327`、`109/109`，shoulda 为
`82/82`。这些仍是自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点或完整 Vimium 手工回归。

2026-08-25
导入预览与异步操作锁补充：设置导入现在使用可访问的本地预览对话框，按新增、修改、删除列出变更；取消不会写入，确认后才执行
schema 校验后的持久化。保存、导入、恢复默认和放弃修改共享异步操作锁，主内容区使用
`aria-busy`/`inert` 防止并发编辑；导入语言会即时应用。当前 macOS Chrome Stable 隔离 E2E
通过导入取消/确认、旧版导出迁移、Vimium 备份、设置闭环、核心手势和 Service Worker 重启；单元/DOM 为
`331/331`、`109/109`，shoulda 为
`86/86`。这些仍是自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点或完整 Vimium 手工回归。

2026-08-25 E-053 当前归档补充：标签页搜索现在排除扩展随机 ID及浏览器偶发暴露的扩展 URL 伪标题；Edge
用户态启动后，Windows Chrome、Windows Edge、macOS Chrome Stable 和 Debian amd64 Chromium
151.0.7922.169 均通过当前扩展 E2E。该证据覆盖运行时兼容性和自动化用户路径，不改变 `V-002`、`O-001`
至 `O-005` 和 `C-001` 至 `C-003` 的人工矩阵 `IN_PROGRESS` 状态，也不替代屏幕阅读器、认证态站点、完整
Vimium 手工回归或旧 CRX 安装更新验收。

2026-08-26 E-055 当前归档补充：新增 `lib/browser_toolbox/module_registry.js`
作为模块能力单一来源，站点规则模块清单、会话覆盖键、运行时有效模块默认值/全局停用逻辑、规则编辑器标签和设置页命中解释均从注册表派生；未增加权限、网络行为或产品模块。单元/DOM
为 `347/347`、`109/109`，shoulda 为 `102/102`，macOS Chrome Stable、Debian amd64 Chromium
151.0.7922.169、Windows 11 ARM64 Chrome Stable 151.0.7922.174 和 Windows Edge Stable 151.0.4129.101
当前归档隔离 E2E 均通过。以上仍是自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium
手工回归或真实旧 CRX 安装更新验收。

2026-08-26 E-056 当前归档补充：新增 `lib/browser_toolbox/value_utils.js`
统一设置值的防御性克隆和有界深比较，设置
schema、命令协议、站点规则编辑器、设置草稿、提交协调器和仓库复用同一实现；变更摘要仍保留普通对象专用校验。单元/DOM
为 `350/350`、`109/109`，shoulda 为 `105/105`，权限审计 9 项、网络审计 29
个新增模块、打包均通过；macOS Chrome Stable 和 Debian amd64 Chromium 151.0.7922.169 当前归档隔离 E2E
通过。Windows 隔离 VM 本轮停在 Sysprep/OOBE，未形成当前 checkout 的 Windows Chrome/Edge E2E
证据；以上仍不替代人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或真实旧 CRX
安装更新验收。

2026-08-26 E-057 当前 checkout 补充：设置仓库已拆出 `settings_policy.js` 和
`settings_storage.js`，分别负责有效模块合成与规范/旧存储键兼容；迁移层集中处理规范和旧版导出包装解析，并拒绝未知未来导出版本。单元/DOM
为 `358/358`、`109/109`，shoulda 为 `113/113`，权限审计 9 项、网络审计 31
个新增模块、打包和连续两次发布检查均通过；macOS Chrome Stable 与 Debian amd64 Chromium
151.0.7922.169 当前 checkout 隔离 E2E 均通过旧版导出、旧存储键和指针资源迁移。Windows Chrome/Edge
本轮未重跑，不以前次四运行时自动结果替代；以上仍不替代人工平台矩阵、屏幕阅读器、认证态站点、完整
Vimium 手工回归或真实旧 CRX 安装更新验收。

2026-08-26 E-058 当前 checkout 补充：设置 schema 为 Google Docs、Notion、StackBlitz、CodeSandbox 和
CodePen
提供可编辑/可删除的高冲突站点默认规则，默认停用鼠标、超级拖拽、滚轮、摇杆和自定义指针，键盘仍可用；设置页默认规则说明已完成中英文国际化，macOS
Chrome Stable 与 Debian amd64 Chromium 151.0.7922.169 隔离 E2E
已确认内置规则删除持久化和完整设置/迁移/手势闭环。单元/DOM 为 `359/359`、`109/109`，总计
`468/468`，shoulda 为 `114/114`，权限审计 9 项、网络审计 31
个新增模块、打包和连续两次发布检查均通过。一次 E2E 前置 storage
写入暴露了设置冲突保护的预期行为，测试已通过重载页面后继续，未削弱产品保护。以上仍是自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点、完整
Vimium 手工回归或真实旧 CRX 安装更新验收；`O-005` 继续保持 `IN_PROGRESS`。

2026-08-26 E-059 当前 checkout 补充：设置存储安全预算改用 JSON 序列化后的 UTF-8
字节数，补充中文配置超过 100 KiB 的回归；单元/DOM 为 `360/360`、`109/109`，总计 `469/469`，shoulda
为 `115/115`，权限审计 9 项、网络审计 31 个新增模块、打包和连续两次发布检查均通过。macOS Chrome
Stable 与宿主 arm64 上临时 Debian amd64 Chromium 151.0.7922.169 当前归档隔离 E2E
均通过。以上仍是自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或真实旧
CRX 安装更新验收；`O-005` 继续保持 `IN_PROGRESS`。

2026-08-26 E-060 当前归档补充：使用临时同一 RSA 测试密钥将旧归档与临时版本 `0.1.1`
的当前归档打包为同 ID CRX，在 Debian amd64 Chromium 151.0.7922.169 外部扩展目录中先安装
`0.1.0`，再切换外部 JSON 并通过扩展管理页 Update 控件触发升级；profile 活动目录从 `0.1.0_0` 变为
`0.1.1_0`，Service Worker 扩展 ID 保持不变。该证据只证明隔离外部 CRX
安装/升级语义，不证明生产签名、真实旧用户 profile、商店更新通道或人工验收，因此 `O-005`
以及平台/辅助技术人工门禁继续保持 `IN_PROGRESS`。

2026-08-26 E-061 当前 checkout
补充：设置导航新增本地化分区搜索，按一级分类/二级分区过滤并保持可见结果的键盘焦点循环，Esc
可恢复完整导航；设置页、入门页和隐私页标题统一进入中英文消息资源。单元/DOM 为
`364/364`、`109/109`，总计 `473/473`，shoulda 为 `119/119`，权限审计 9 项、网络审计 31
个新增模块、打包和连续两次发布检查均通过；macOS Chrome Stable 与宿主 arm64 上临时 Debian amd64
Chromium 151.0.7922.169 当前 checkout 隔离 E2E
均通过。以上仍是自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium
手工回归或生产签名/真实用户 profile 的旧 CRX 更新；相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-064
当前 checkout
补充：导入焦点异步补偿仅在焦点仍属于导入流程时执行，不抢占用户已移到其他控件的焦点；完整单元/DOM 为
`365/365`、`109/109`，总计 `474/474`，shoulda 为 `120/120`，权限审计 9 项、网络审计 31
个新增模块、打包和连续两次发布检查均通过；macOS Chrome Stable 与宿主 arm64 上临时 Debian amd64
Chromium 151.0.7922.169 当前 checkout 隔离 E2E
均通过。以上仍是自动化证据，不替代人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium
手工回归或生产签名/真实用户 profile 的旧 CRX 更新；相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-065
当前 checkout
补充：设置分区注册表新增本地化字段搜索关键词，保存前主动重读两个存储域以避免异步变更通知竞态覆盖无关
Vimium 设置；单元/DOM 为 `366/366`、`109/109`，总计 `475/475`，shoulda 为 `121/121`，权限审计 9
项、网络审计 31 个新增模块、打包和连续两次发布检查均通过；macOS Chrome Stable 与临时 Debian amd64
Chromium 151.0.7922.169 当前 checkout 隔离 E2E 已验证字段搜索、设置保存和外部 `scrollStepSize`
保留。以上仍是自动化证据，不替代 Windows/Edge 当前
checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile 的旧
CRX 更新；相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-066 当前 checkout 补充：Vimium
选项页入口、命令列表和帮助弹窗中的 Browser Toolbox 文案统一进入中英文消息资源；单元/DOM 为
`369/369`、`109/109`，总计 `478/478`，shoulda 为 `121/121`，权限审计 9 项、网络审计 31
个新增模块、打包和连续两次发布检查均通过；macOS Chrome Stable 与临时 Debian amd64 Chromium
151.0.7922.169 当前 checkout 隔离 E2E 均通过。以上仍是自动化证据，不替代 Windows/Edge 当前
checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile 的旧
CRX 更新；相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-067 当前 checkout 补充：Vimium
选项页、命令列表和帮助弹窗现在读取浏览器工具箱已保存的 `en`/`zh_CN`
偏好，缺失或非法值回退浏览器界面语言；单元/DOM 为 `370/370`、`109/109`，总计 `479/479`，shoulda 为
`122/122`，权限审计 9 项、网络审计 31 个新增模块、打包和连续两次发布检查均通过；macOS Chrome Stable
与临时 Debian amd64 Chromium 151.0.7922.169 当前 checkout 隔离 E2E
均通过。以上仍是自动化证据，不替代 Windows/Edge 当前
checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile 的旧
CRX 更新；相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-069 当前 checkout
补充：集成页面的语言读取现在复用现有存储兼容层，旧 `openKeyMouseSettings.general.language`
在未触发完整设置仓库时也可被读取，且不触发写入；单元/DOM 为 `371/371`、`109/109`，总计
`480/480`，shoulda 为 `123/123`，权限审计 9 项、网络审计 31
个新增模块、打包和连续两次发布检查均通过；macOS Chrome Stable 与临时 Debian amd64 Chromium
151.0.7922.169 当前 checkout 隔离 E2E 均通过。以上仍是自动化证据，不替代 Windows/Edge 当前
checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile 的旧
CRX 更新；相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-070 当前 checkout 补充：修正 Manifest V3
内容脚本遗漏 `lib/browser_toolbox/regex_safety.js`
的加载顺序，并将顺序纳入权限审计；这样网页运行时的正则站点规则与设置页使用同一复杂度安全边界。单元/DOM
为 `371/371`、`109/109`，总计 `480/480`，shoulda 为
`123/123`，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome Stable 与临时 Debian amd64
Chromium 151.0.7922.169 当前 checkout 隔离 E2E 均通过。以上仍是自动化证据，不替代 Windows/Edge 当前
checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile 的旧
CRX 更新；相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-071 当前 checkout
补充：动作页和标签页列表入口现在显式加载 `regex_safety.js`，并由权限审计检查页面依赖顺序；单元/DOM
为 `371/371`、`109/109`，总计 `480/480`，shoulda 为
`123/123`，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome Stable 当前 checkout 隔离 E2E
通过。Linux 本轮临时 Chromium 安装在 dpkg 阶段未形成新的 E2E 结果，沿用 E-070 的 Linux
证据，不扩大声明范围；以上仍不替代 Windows/Edge 当前
checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile 的旧
CRX 更新，相关状态继续保持 `IN_PROGRESS`。 2026-08-27 E-079 图标替换后当前 checkout 回归：主图标
16/48/128、动作图标 16/32 均为带透明通道的 RGBA PNG；单元/DOM 为 `378/378`、`109/109`，shoulda 为
`130/130`，权限审计 9 项、网络审计扫描 32
个新增模块、打包和按顺序两次发布检查均通过，四个未发布归档哈希保持一致；macOS Chrome Stable 当前隔离
E2E 通过。该证据只说明图标替换后的自动门禁可复现，不替代 Windows/Edge/macOS/Linux
人工矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产 CRX 验收；相关状态仍保持
`IN_PROGRESS`。 2026-08-27 E-078 当前 checkout 门禁复核：单元/DOM 为 `378/378`、`109/109`，shoulda
为 `130/130`，权限审计 9 项、网络审计扫描 32
个新增模块、打包和连续两次发布检查均通过，四个未发布归档哈希保持一致。该证据只说明当前自动门禁可复现，不替代
Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产 CRX
验收；相关状态仍保持 `IN_PROGRESS`。 2026-08-26 E-077 当前 checkout 补充：宿主 arm64 上临时
`denoland/deno:debian` amd64 容器中的 Debian Chromium 151.0.7922.169 完整 E2E
通过，覆盖动作页限制提示、设置页语义、标签页列表、核心输入、超级拖拽、滚轮/摇杆、跨
frame、站点规则、设置导入导出/迁移、Vimium 备份、本地资源、Service Worker 重启和设计文档
fixtures；容器已清理。该证据是隔离自动化，不是 Linux Chrome Stable 人工验收，也不替代
Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产 CRX
验收；相关状态仍保持 `IN_PROGRESS`。 2026-08-26 E-076 当前 checkout 补充：临时 Debian amd64 Chromium
151.0.7922.169 先安装迁移前 `0.1.0` 旧 CRX，再通过 Linux 外部扩展 JSON 和 `chrome://extensions`
Update 控件升级到临时 `0.1.1` 当前 CRX；同 ID 活动目录从 `0.1.0_0` 变为
`0.1.1_0`。旧设置键、旧会话键、旧指针资源和旧命令名均完成当前迁移读取，当前
schemaVersion=4，浏览器重启后 Service Worker 与设置仍可读取。该证据使用临时测试密钥/临时
profile，不是生产签名、真实用户 profile、商店更新通道或人工验收；相关状态仍保持 `IN_PROGRESS`。
2026-08-26 E-075 当前 checkout 补充：动作页和设置页的 Vimium
设置加载、读取、写入、备份迁移和冲突提交路径统一经过可替换适配层，审计禁止这两个 Browser Toolbox
集成页重新直接依赖全局 `Settings`；单元/DOM 为 `378/378`、`109/109`，总计 `487/487`，shoulda 为
`130/130`，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome Stable 当前 checkout 隔离 E2E
通过。Linux 本轮未形成新的 E2E 结果，不扩大声明范围；以上仍不替代 Windows/Edge 当前
checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile 的旧
CRX 更新，相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-074 当前 checkout 补充：新增可替换的 Vimium
设置适配层，`SettingsRepository` 不再直接读取全局 `Settings`，Manifest V3 内容脚本、Service
Worker、动作页、标签页列表和设置页的适配层/仓库加载顺序由权限审计固定；单元/DOM 为
`378/378`、`109/109`，总计 `487/487`，shoulda 为
`130/130`，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome Stable 当前 checkout 隔离 E2E
通过。Linux 本轮未形成新的 E2E 结果，不扩大声明范围；以上仍不替代 Windows/Edge 当前
checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile 的旧
CRX 更新，相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-073 当前 checkout
补充：站点规则编辑器现在按行即时复用正则安全和匹配器校验，错误规则显示本地化提示并设置
`aria-invalid`，同时支持注入 document 以减少全局 DOM 依赖；单元/DOM 为 `376/376`、`109/109`，总计
`485/485`，shoulda 为 `128/128`，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome Stable
当前 checkout 隔离 E2E 通过。Linux 本轮未形成新的 E2E 结果，不扩大声明范围；以上仍不替代
Windows/Edge 当前 checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium
手工回归或生产签名/真实用户 profile 的旧 CRX 更新，相关状态继续保持 `IN_PROGRESS`。 2026-08-26 E-072
当前 checkout 补充：自定义指针本地资源的读写删除现在统一经过 `SettingsStorage` 与
`SettingsRepository`，设置页和鼠标控制器不再直接访问 `chrome.storage.local`；单元/DOM 为
`373/373`、`109/109`，总计 `482/482`，shoulda 为
`125/125`，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome Stable 当前 checkout 隔离 E2E
通过并覆盖本地 PNG 指针及迁移链路。Linux 本轮未形成新的 E2E 结果，不扩大声明范围；以上仍不替代
Windows/Edge 当前 checkout、人工平台矩阵、屏幕阅读器、认证态站点、完整 Vimium
手工回归或生产签名/真实用户 profile 的旧 CRX 更新，相关状态继续保持 `IN_PROGRESS`。 2026-08-27 E-081
当前 checkout 补充：内容脚本新增只读运行时配置客户端，Service Worker
仅广播失效通知；同上下文配置加载去重，单页应用 URL
变化和设置页实时写入均会刷新有效站点规则状态。单元/DOM 为 `393/393`、`109/109`，shoulda 为
`145/145`，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome Stable 当前隔离 E2E
已验证已打开页面同步全局停用状态。该证据仍是自动化结果，不替代 Windows/Edge/macOS/Linux
人工矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产 CRX/真实用户 profile
验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-27 E-082 当前 checkout
补充：站点规则编辑器对完全相同的匹配方式和匹配式显示非阻断重复提示，并在编辑时即时刷新；动作页按模块注册表显示当前实际停用模块，开关状态会随会话写入同步更新；E2E
还修复并验证了动作页旧变量残留导致的开关事件未注册回归。单元/DOM 为 `396/396`、`109/109`，shoulda 为
`148/148`，权限/网络审计、目标文件格式/类型检查、打包和连续两次发布检查均通过；macOS Chrome Stable
当前 checkout 隔离 E2E 退出码 0，覆盖动作页会话开关、站点规则、设置迁移、导入导出、核心手势、跨
frame、fixtures 和 Service Worker 重启。上述仍是自动化证据，不替代 Windows/Edge/macOS/Linux
人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产 CRX/真实用户 profile
验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-27 E-084 当前 checkout
补充：动作页合并的滚轮/摇杆开关现在要求两个模块都有效才显示开启；站点规则只停用摇杆时会显示关闭并列出摇杆。单元/DOM
为 396/396、109/109，shoulda 为 148/148，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome
Stable 当前隔离 E2E 已验证该部分停用场景。该证据仍是自动化结果，不替代 Windows/Edge/macOS/Linux
人工矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或生产 CRX/真实用户 profile
验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-27 E-085 当前 checkout
补充：国际化降级路径补齐重复站点规则提示，迁移后的旧版会话覆盖可以被显式清除且不会再次回退生效，动作页新增/改造控件统一使用消息键。单元/DOM
为 `398/398`、`109/109`，shoulda 为 `150/150`，权限/网络审计、打包和 macOS Chrome Stable 当前隔离
E2E 通过。该证据仍是自动化结果，不替代 Windows/Edge/macOS/Linux
人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产 CRX/真实用户 profile
验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-28 E-086 当前 checkout
补充：轨迹会话在抬键时复核最大持续时间，控制器定时器在完成/取消/销毁路径清理，`ACTIVE`
轨迹期间的左右键不会再启动超级拖拽或摇杆；新增超时和冲突优先级隔离 E2E。单元/DOM 为
`399/399`、`109/109`，shoulda 为 `151/151`，权限/网络审计、打包和连续两次发布检查均通过；macOS
Chrome Stable `Extensions.loadUnpacked` 当前隔离 E2E 退出码 0。该证据仍是自动化结果，不替代
Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产
CRX/真实用户 profile 验收；相关状态继续保持 `IN_PROGRESS`。

2026-08-28 E-087 当前 checkout 补充：设计文档已有的 mouse.triggerButton 已贯通
schema、设置页和运行时，左键/中键/右键均有隔离 E2E；GestureFrameCoordinator
按有效配置保存每个会话的最大持续时间，3000ms 会话在按住 2700ms 后仍可执行命令。单元/DOM 为
`400/400`、`109/109`，shoulda 为 `152/152`，权限/网络审计、打包和连续两次发布检查均通过；macOS
Chrome Stable `Extensions.loadUnpacked` 当前隔离 E2E 退出码 0。该证据仍是自动化结果，不替代
Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产
CRX/真实用户 profile 验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-28 E-088 当前 checkout
补充：内容脚本运行时客户端在 Service Worker 不可用时只允许顶层页面使用本地 URL 兜底，子 frame
无法确认顶层配置时安全关闭全部模块；新增 child frame fail-closed 单元测试。macOS Chrome Stable
`Extensions.loadUnpacked` 当前隔离 E2E 新增左键触发轨迹，并与中键/右键触发、迁移、站点规则和跨 frame
场景一起通过；单元/DOM 为 `401/401`、`109/109`，shoulda 为
`153/153`，权限/网络审计、打包和连续两次发布检查均通过。该证据仍是自动化结果，不替代
Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产
CRX/真实用户 profile 验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-28 E-089 当前 checkout
补充：GestureFrameCoordinator 现在在方向摘要超过 8
段时立即取消会话，避免拒绝更新后仍保留可用活动状态；8 段以内正常轨迹和现有左/中/右触发 E2E
均通过。单元/DOM 为 `401/401`、`109/109`，shoulda 为
`153/153`，权限/网络审计、打包和连续两次发布检查均通过。该证据仍是自动化结果，不替代
Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产
CRX/真实用户 profile 验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-28 E-090 当前 checkout 补充：跨
frame 手势桥接改为设计文档要求的短生命周期 `runtime.connect` Port，Service Worker 对同一 Port 的
start/update/finish/cancel 串行处理，并在断开时取消会话；首次 E2E
暴露的启动/方向消息竞态已修复。单元/DOM 为 `403/403`、`109/109`，shoulda 为
`155/155`，权限/网络审计、打包和连续两次发布检查均通过；macOS Chrome Stable 当前隔离 E2E 退出码
0。该证据仍是自动化结果，不替代 Windows/Edge/macOS/Linux
人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产 CRX/真实用户 profile
验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-28 E-091 当前 checkout 补充：设计文档 Phase 6 fixture
新增 `about:blank` frame，隔离 E2E 使用 `chrome.scripting.executeScript` 的 `allFrames`/`ISOLATED`
结果确认顶层、`srcdoc` 和 `about:blank` frame 的 BrowserToolbox 控制器均完成初始化；跨域 iframe
手势增加控制器就绪等待。子 frame 运行时配置请求窗口调整为有限 2 秒，配置不可取得时仍
fail-closed。单元/DOM 为 `403/403`、`109/109`，shoulda 为 `155/155`，权限/网络审计、打包和 macOS
Chrome Stable 当前隔离 E2E 连续两次退出码 0；两次发布检查归档哈希一致。该证据仍是自动化结果，不替代
Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产
CRX/真实用户 profile 验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-28 E-092 当前 checkout
补充：中文站点规则无匹配提示已统一使用“浏览器工具箱”，并由单元断言守护；单元/DOM 为
`403/403`、`109/109`，shoulda 为 `155/155`，权限/网络审计、打包和 macOS Chrome Stable 当前隔离 E2E
通过，连续两次发布检查五个归档 SHA-256
一致，源码包和运行时包旧技术标识禁入路径审计无匹配。该证据仍是自动化结果，不替代
Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产
CRX/真实用户 profile 验收；相关状态继续保持 `IN_PROGRESS`。 2026-08-28 E-115 当前 checkout
补充：动作页新增“打开帮助”入口，使用当前活动标签页顶层既有 `runInTopFrame/showHelp` 路由建立帮助 UI
通道，并由 macOS Chrome Stable 隔离 E2E 验证帮助显示及动作页关闭后的会话开关；单元/DOM 为
`432/432`、`109/109`，shoulda 为
`184/184`，性能、权限/网络审计、打包和连续构建哈希复核通过。Computer Use
客户端与服务端版本不匹配，未形成 macOS 人工或 VoiceOver 证据；因此 `O-005`
及其他需要人工矩阵的项目继续保持 `IN_PROGRESS`。 2026-08-29 E-116 当前 checkout
补充：帮助页补齐浏览器工具箱模块说明、当前页面有效状态、命中网站规则、隐私/许可证入口和中英文本地化；顶层内容脚本只传递状态摘要，帮助页以
textContent 渲染规则文本。单元/DOM 为 `433/433`、`109/109`，shoulda 为
`184/184`，权限/网络审计、性能、打包和 macOS Chrome Stable 当前 checkout 隔离 E2E
均通过；平台/辅助技术/认证站点/真实 profile 人工门禁继续保持 `IN_PROGRESS`。 2026-08-29 E-117 当前
checkout 补充：帮助页根节点增加 `dialog`、模态状态、可访问名称/描述和 `status` 播报语义，单元与
macOS Chrome Stable 隔离 E2E
增加中文控件及区域标题关联断言；这些是自动化无障碍证据，不替代屏幕阅读器、平台人工矩阵或完整 Vimium
手工回归，相关项目继续保持 `IN_PROGRESS`。 2026-08-29 E-118 当前 checkout
补充：技术标识审计接入发布检查，确认旧标识仅保留在兼容层、兼容测试/fixture
和历史文档；该审计不改变功能矩阵状态，平台/辅助技术/认证站点/真实 profile 人工门禁继续保持
`IN_PROGRESS`。
