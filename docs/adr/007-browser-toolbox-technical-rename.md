# ADR-007：BrowserToolbox 技术标识迁移

- 状态：已接受
- 日期：2026-08-24
- 取代：ADR-006 中关于技术标识暂不迁移的部分

## 决策

“浏览器工具箱”（Browser Toolbox）是对外产品名，`BrowserToolbox` 是当前唯一的内部技术标识。
新代码、命令、消息、配置、导出文件、界面 DOM 标识、测试和脚本统一使用以下命名：

- JavaScript 全局对象和命令命名空间：`BrowserToolbox`；
- 协议和消息处理器前缀：`browserToolbox`；
- 同步设置、本地备份、会话覆盖和新指针资源键：`browserToolbox*`；
- 设置导出格式和来源：`browser-toolbox-settings`、`BrowserToolbox`；
- 代码目录：`lib/browser_toolbox`、`background_scripts/browser_toolbox`、`tests/browser_toolbox`；
- E2E 入口：`scripts/e2e_browser_toolbox.js`；
- 施工文档：`BrowserToolbox_Codex_可执行开发设计文档.md`。

本 ADR 初始实施时保留了共享工作区物理路径；用户随后明确要求同步修改目录名，现已将物理路径迁移为 `/Users/yang/project/plugin/browser-toolbox`。
目录迁移只改变文件系统路径，不改变扩展 ID、运行时协议、配置迁移逻辑或 Git 提交历史。

## 升级兼容

兼容层只读接受旧版本已写入的设置键、会话覆盖键、命令名称、导出格式和本地 PNG 指针键，并在首次加载时写入新的规范键。
旧键不删除，避免回滚或用户取回旧版本时丢失数据；新的保存和导出路径不再写入旧键或旧格式。
旧名称不作为消息处理器、命令注册表或新 DOM 标识的别名，避免两套运行时协议长期并存。

迁移仍必须经过现有 schema 校验、大小限制、隐私不变量和本地备份流程；迁移不新增权限、依赖、网络行为、账户、遥测或商业化入口。

## 影响与回滚

本次改动是标识和兼容迁移，不改变 Vimium 键盘行为、鼠标状态机和浏览器权限。出现问题时，可依据 `browserToolboxSettingsMigrationBackup`
恢复规范设置；旧设置键仍保留，便于回退到迁移前版本。自动化测试覆盖规范名称、旧设置键读取、命令迁移和旧导出格式入口；跨版本真实浏览器升级仍需人工验收。
