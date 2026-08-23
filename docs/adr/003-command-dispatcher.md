# ADR-003：统一命令适配层

- 状态：已实施，待完整平台验收
- 日期：2026-08-23

## 决策

未来由键盘、鼠标轨迹、超级拖拽、滚轮和摇杆输入适配器产生标准化 CommandInvocation，再由 Dispatcher
决定页面或浏览器执行位置并返回 CommandResult。输入层不得直接调用浏览器高权限 API。

## 当前边界

`CommandInvocation`、`CommandResult`、Dispatcher、命令注册表和鼠标输入适配器已经实现，并由单元测试和真实
扩展 E2E 覆盖。后续仍必须先写可复现测试再迁移命令，不改变键盘默认绑定；完整跨平台人工矩阵尚未完成。
