# 功能对照矩阵

状态只能使用 `TODO`、`IN_PROGRESS`、`BLOCKED_BROWSER_LIMITATION`、`DONE`、`NOT_APPLICABLE`。矩阵中的
`DONE` 只表示对应自动测试和当前平台手工验证均有证据。

| 编号  | 来源         | 功能                                    | 公开参考       | 本项目命令          | 自动测试 | 手工测试 | 状态        | 备注                                                     |
| ----- | ------------ | --------------------------------------- | -------------- | ------------------- | -------- | -------- | ----------- | -------------------------------------------------------- |
| V-001 | Vimium       | 原有键盘导航                            | Vimium v2.4.2  | 既有命令集合        | PASS     | BASELINE | DONE        | 上游基线保持                                             |
| V-002 | Vimium       | 链接提示、Vomnibar、查找、Visual、Marks | Vimium v2.4.2  | 既有命令集合        | PASS     | PENDING  | IN_PROGRESS | 需完成扩展页面手工矩阵                                   |
| O-001 | OpenKeyMouse | 统一 CommandInvocation / Dispatcher     | 本项目设计文档 | 全部新增输入        | PASS     | PENDING  | IN_PROGRESS | 需完成真实扩展消息 E2E                                   |
| O-002 | OpenKeyMouse | 四向/八向右键轨迹                       | 本项目设计文档 | mouse bindings      | PASS     | PENDING  | IN_PROGRESS | 算法单测已覆盖                                           |
| O-003 | OpenKeyMouse | 安全超级拖拽                            | 本项目设计文档 | OpenKeyMouse.*      | PASS     | PENDING  | IN_PROGRESS | DOM/E2E 尚待补齐                                         |
| O-004 | OpenKeyMouse | 滚轮组合与摇杆                          | 本项目设计文档 | wheel / rocker      | PASS     | PENDING  | IN_PROGRESS | 算法单测已覆盖                                           |
| O-005 | OpenKeyMouse | 设置、迁移、站点规则、导入导出          | 本项目设计文档 | settings repository | PASS     | PENDING  | IN_PROGRESS | 设置页、语言保存和本地光标已实测；导入导出、站点规则待测 |
| O-006 | OpenKeyMouse | 国际化                                  | Chrome i18n    | 本地 messages.json  | PASS     | PASS     | DONE        | 已实测 zh_CN 展示、English 切换和保存后持久化            |
| C-001 | CrxMouse     | 右键左划后退                            | 公开功能描述   | goBack              | PASS     | PENDING  | IN_PROGRESS | clean-room 独立实现                                      |
| C-002 | CrxMouse     | 右键右划前进                            | 公开功能描述   | goForward           | PASS     | PENDING  | IN_PROGRESS | clean-room 独立实现                                      |
| C-003 | CrxMouse     | 超级拖拽                                | 公开功能描述   | OpenKeyMouse.*      | PASS     | PENDING  | IN_PROGRESS | 不复制闭源代码、资产、文案或界面                         |

任何未达到 `DONE` 或明确浏览器限制的项目都不能宣称完整覆盖。
