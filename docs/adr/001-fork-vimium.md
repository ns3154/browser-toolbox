# ADR-001：以 Vimium v2.4.2 作为基线

- 状态：已接受
- 日期：2026-08-23

## 决策

OpenKeyMouse 从 Vimium v2.4.2、提交 eb737abd 开始，保留 upstream 指向
<https://github.com/philc/vimium.git>，本地 main 分支只在阶段性提交中演进。保留标签
upstream-vimium-v2.4.2 作为可回滚检查点。

## 原因

Vimium
已经提供成熟的键盘导航、链接提示、Vomnibar、查找、标记、标签页和现有测试体系。从零重写会增加回归和许可证核对风险。

## 约束

不一次性重构、不删除键盘行为；每个阶段独立测试、独立提交、可独立回滚。Phase 0
不实现鼠标输入或统一命令层。
