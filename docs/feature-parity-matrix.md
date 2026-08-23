# 功能对照矩阵

状态只能使用 `TODO`、`IN_PROGRESS`、`BLOCKED_BROWSER_LIMITATION`、`DONE`、`NOT_APPLICABLE`。矩阵中的
`DONE` 只表示对应自动测试和当前平台手工验证均有证据。

| 编号  | 来源         | 功能                                    | 公开参考       | 本项目命令          | 自动测试 | 手工测试 | 状态        | 备注                                                     |
| ----- | ------------ | --------------------------------------- | -------------- | ------------------- | -------- | -------- | ----------- | -------------------------------------------------------- |
| V-001 | Vimium       | 原有键盘导航                            | Vimium v2.4.2  | 既有命令集合        | PASS     | BASELINE | DONE        | 上游基线保持                                             |
| V-002 | Vimium       | 链接提示、Vomnibar、查找、Visual、Marks | Vimium v2.4.2  | 既有命令集合        | PASS     | PENDING  | IN_PROGRESS | 需完成扩展页面手工矩阵                                   |
| O-001 | OpenKeyMouse | 统一 CommandInvocation / Dispatcher     | 本项目设计文档 | 全部新增输入        | PASS     | E2E-CFT  | IN_PROGRESS | 真实 E2E 覆盖鼠标、Super Drag、Wheel、Rocker、跨 frame 和 Service Worker；完整 Vimium 手工矩阵待测 |
| O-002 | OpenKeyMouse | 四向/八向右键轨迹                       | 本项目设计文档 | mouse bindings      | PASS     | E2E-CFT  | IN_PROGRESS | 已实测后退、前进、滚动、关闭标签和阈值旁路；八向及全部绑定仍待测 |
| O-003 | OpenKeyMouse | 安全超级拖拽                            | 本项目设计文档 | OpenKeyMouse.*      | PASS     | E2E-CFT  | IN_PROGRESS | 已实测链接前台/后台、图片、选择文字、draggable 保护和 Alt 旁路；搜索、下载、文件上传/编辑器矩阵仍待测 |
| O-004 | OpenKeyMouse | 滚轮组合与摇杆                          | 本项目设计文档 | wheel / rocker      | PASS     | E2E-CFT  | IN_PROGRESS | 已实测右键滚轮上/下及摇杆正反组合；左/中键滚轮、阈值边界和更多组合仍待测 |
| O-005 | OpenKeyMouse | 设置、迁移、站点规则、导入导出          | 本项目设计文档 | settings repository | PASS     | E2E-CFT  | IN_PROGRESS | 已实测设置保存、语言持久化、有效/非法导入、导出和运行时站点规则；迁移版本及完整 UI 矩阵仍待测 |
| O-006 | OpenKeyMouse | 国际化                                  | Chrome i18n    | 本地 messages.json  | PASS     | PASS     | DONE        | 已实测 zh_CN 展示、English 切换和保存后持久化            |
| C-001 | CrxMouse     | 右键左划后退                            | 公开功能描述   | goBack              | PASS     | E2E-CFT  | IN_PROGRESS | clean-room 独立实现；真实 E2E 已覆盖普通页和跨 frame，完整平台矩阵仍待测 |
| C-002 | CrxMouse     | 右键右划前进                            | 公开功能描述   | goForward           | PASS     | E2E-CFT  | IN_PROGRESS | clean-room 独立实现；真实 E2E 已覆盖历史前进，完整平台矩阵仍待测 |
| C-003 | CrxMouse     | 超级拖拽                                | 公开功能描述   | OpenKeyMouse.*      | PASS     | E2E-CFT  | IN_PROGRESS | 真实 E2E 已覆盖链接、图片、文字和原生旁路；不复制闭源代码、资产、文案或界面 |

任何未达到 `DONE` 或明确浏览器限制的项目都不能宣称完整覆盖。
