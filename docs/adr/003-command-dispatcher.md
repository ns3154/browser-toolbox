# ADR-003：统一命令适配层

- 状态：已记录，待 Phase 1 实施
- 日期：2026-08-23

## 决策

未来由键盘、鼠标轨迹、超级拖拽、滚轮和摇杆输入适配器产生标准化 CommandInvocation，再由 Dispatcher
决定页面或浏览器执行位置并返回 CommandResult。输入层不得直接调用浏览器高权限 API。

## 当前边界

Phase 0 只记录接口方向，不创建
CommandInvocation、CommandResult、Dispatcher、命令注册表或任何鼠标模块。Phase 1
必须先写适配测试，再逐类迁移，不改变键盘默认绑定。
