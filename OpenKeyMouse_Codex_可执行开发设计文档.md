# OpenKeyMouse 可执行开发设计文档（Codex 实施版）

> **项目代号**：OpenKeyMouse（临时代号，发布前必须完成名称与商标检索）  
> **文档版本**：1.0  
> **编制日期**：2026-08-23  
> **主要目标平台**：Google Chrome、Microsoft Edge 及其他 Chromium 浏览器  
> **扩展规范**：Manifest V3  
> **代码基线**：Vimium `v2.4.2`，提交 `eb737ab`  
> **项目定位**：永久免费、永久开源、无广告、无账户、无订阅、无付费功能、无商业版  
> **项目整体许可证建议**：GPL-3.0-or-later；保留 Vimium 原始 MIT 许可证与版权声明

---

## 0. Codex 必须首先遵守的执行规则

本文件既是产品设计文档，也是 Codex 的施工规范。Codex 在修改代码前必须完整阅读本文件，并遵守以下规则：

1. **不得从零重写 Vimium。** 第一版必须以 Vimium `v2.4.2` 为稳定基线，在不破坏原有键盘能力的前提下增加鼠标能力。
2. **不得一次性大改整个仓库。** 必须按本文阶段逐项实施，每个阶段独立测试、独立提交、可独立回滚。
3. **不得复制或反编译 CrxMouse 的闭源代码、图片、图标、文案和设置界面。** 只允许依据公开功能描述和人工黑盒测试，独立实现等价行为。
4. **不得引入商业化设计。** 禁止付费版、专业版、会员、订阅、广告、推荐返佣、功能锁、试用期、远程授权、登录账户和云端付费服务。
5. **不得加入遥测。** 禁止统计访问网址、搜索内容、键盘输入、鼠标轨迹、页面内容、安装来源、设备指纹和用户行为。
6. **不得加载远程代码。** 禁止远程 JavaScript、`eval`、`new Function`、动态下载后执行代码以及从 CDN 加载运行时代码。
7. **不得为了省事扩大权限。** 新增任何权限前必须新建 ADR，说明必要性、替代方案和隐私影响。
8. **不得删除既有 Vimium 功能来换取鼠标功能。** 所有上游测试必须继续通过。
9. **不得在未运行测试的情况下声称完成。** 每个阶段必须记录实际执行的命令、通过项、失败项和未解决问题。
10. 遇到不明确的实现选择时，优先采用：**最少权限、最少依赖、最小改动、可回滚、可测试、无网络依赖**的方案。

Codex 在仓库中必须建立并持续更新：

```text
docs/codex-progress.md
```

每次完成一个任务后追加：

```markdown
## YYYY-MM-DD / 阶段编号 / 任务编号

- 完成内容：
- 修改文件：
- 新增测试：
- 实际执行命令：
- 测试结果：
- 已知问题：
- 下一步：
- 对应提交：
```

---

## 1. 产品定义

### 1.1 一句话定位

OpenKeyMouse 是一个本地优先的浏览器导航扩展，使用统一命令系统同时支持：

- Vim 风格键盘导航；
- 链接提示与浏览器搜索框；
- 鼠标轨迹手势；
- 超级拖拽；
- 滚轮手势；
- 摇杆手势；
- 标签页、窗口、历史、书签和页面控制；
- 按网站配置和模块化禁用。

### 1.2 Chrome Web Store 单一用途描述

商店单一用途应固定为：

> 使用键盘快捷键和鼠标手势，统一控制网页导航、链接操作、搜索以及浏览器标签页。

不得把 AI 聊天、广告拦截、密码管理、笔记、天气、新闻、购物、代理、下载管理器等不相关能力加入本项目。

### 1.3 核心原则

1. 安装后立即可用，默认配置不要求学习复杂语法。
2. 高级用户可以完全重映射键盘和鼠标动作。
3. 所有输入方式最终调用同一套命令，禁止重复实现业务逻辑。
4. 普通键盘输入、普通右键菜单和网页原生拖放优先受到保护。
5. 扩展空闲时不持续监听高频鼠标移动，不运行定时轮询。
6. 所有配置保存在浏览器本地或用户主动开启的浏览器原生同步中。
7. 项目官方发行物永远提供完整功能，不设计任何付费分层。

### 1.4 明确非目标

第一版不实现以下内容：

- 对 `chrome://`、Chrome Web Store、浏览器地址栏、标签栏或开发者工具进行网页级注入；
- 绕过浏览器安全限制；
- 识别 Canvas、WebGL 或视频流内部的虚拟按钮；
- 录制用户浏览历史用于推荐；
- 用户账户、云同步服务器或跨设备自建后端；
- 从 CrxMouse 安装包中提取源码或资源；
- 在首个版本中把整个 Vimium 代码库迁移到 TypeScript、React、WXT 或其他新框架。

---

## 2. 开源与永久免费政策

### 2.1 许可证结构

推荐使用以下多许可证结构：

```text
LICENSE                         # GPL-3.0-or-later，项目整体发行规则
LICENSES/MIT-Vimium.txt         # Vimium 原始 MIT 许可证原文
THIRD_PARTY_NOTICES.md          # 第三方代码、资源、作者和许可证清单
PROJECT_CHARTER.md              # 永久免费与无商业版项目章程
TRADEMARK.md                    # 官方名称、图标和商标使用规则
```

规则：

- 从 Vimium 保留或修改的文件继续保留其原始版权声明和 MIT 许可说明。
- 全新鼠标模块默认添加：

```text
SPDX-License-Identifier: GPL-3.0-or-later
```

- 直接来源于 Vimium 的文件添加或保留：

```text
SPDX-License-Identifier: MIT
```

- 二进制扩展包作为组合发行物遵守 GPL-3.0-or-later，同时履行 Vimium MIT 的署名和许可证保留义务。

### 2.2 “开源”与“禁止商业使用”的法律边界

符合通行开源定义的许可证通常允许商业使用和有偿再分发，因此不能同时写成“任何人不得收费”并仍称其为标准开源许可证。

本项目采取的实际策略是：

1. 官方仓库、官方安装包和官方商店版本永久免费；
2. 官方不提供商业版、企业版、专业版或订阅版；
3. 所有官方功能均在同一开源代码库中；
4. 使用 GPL 强制分发修改版本时继续公开对应源码；
5. 使用商标政策阻止第三方冒充官方付费版本；
6. 第三方依法再分发时不得使用官方身份误导用户；
7. 官方扩展内不展示捐赠弹窗、广告或购买入口。

### 2.3 PROJECT_CHARTER.md 必须包含的条款

```markdown
# Project Charter

1. OpenKeyMouse 的官方版本永久免费。
2. 官方版本不设置付费功能、订阅、试用期、广告或账户登录。
3. 所有用户可获得相同的完整功能。
4. 主要功能不得迁移到闭源仓库。
5. 不收集浏览记录、页面内容、键盘输入或鼠标轨迹。
6. 项目可以接受无条件捐赠，但捐赠不换取功能、优先权或专属版本。
7. 修改本章程必须经过公开提案、公开讨论和维护者明确记录。
```

---

## 3. 知识产权与实现边界

### 3.1 Vimium

Vimium 使用 MIT License，可以依法复制、修改、合并和分发，但必须保留原始版权和许可文本。

本项目固定以以下基线开始：

```text
Repository: https://github.com/philc/vimium
Tag: v2.4.2
Commit: eb737ab
Release date: 2026-03-07
```

### 3.2 CrxMouse

CrxMouse 仅作为功能行为参考，采用独立实现：

允许：

- 阅读公开商店介绍、官网帮助和用户可见设置；
- 安装正式版本后进行人工黑盒行为测试；
- 记录“输入动作—可见结果—异常情况”；
- 设计不同的代码结构、界面和图标，实现等价功能。

禁止：

- 解包 CRX 并复制、改写或翻译其中代码；
- 复制图标、轨迹图片、界面布局、宣传文案和名称；
- 使用 CrxMouse 或 Vimium 的名称作为本产品主品牌；
- 声称本项目得到原作者官方授权或认可；
- 让 Codex 根据闭源代码生成“不同写法”的衍生代码。

### 3.3 发布前必须具备

- 独立名称与图标；
- `THIRD_PARTY_NOTICES.md`；
- Vimium MIT 许可证原文；
- 项目 GPL 许可证；
- 隐私政策；
- 商店权限说明；
- 无遥测声明；
- 不适用于 Chrome 内置页面的明确说明。

---

## 4. 技术路线与基线初始化

### 4.1 路线决策

采用：

> **Vimium 稳定分支 + 统一命令适配层 + 独立鼠标输入引擎**

不采用首版从零重写，原因：

- Vimium 已经覆盖复杂的链接提示、Vomnibar、查找、可视模式、标记、跨 Frame、按键解析、命令重复、站点排除和标签页操作；
- 从零重写会把大量时间耗费在重新发现成熟项目已经解决的边界问题；
- 基于固定上游标签更容易证明功能没有回退；
- 鼠标能力可以作为独立输入适配器逐步加入。

### 4.2 初始化命令

Codex 在用户准备好的空目录中执行：

```bash
git clone https://github.com/philc/vimium.git open-key-mouse
cd open-key-mouse

git remote rename origin upstream
git fetch upstream --tags
git checkout -b main v2.4.2

git tag upstream-vimium-v2.4.2
```

如果用户已创建自己的远程仓库，再执行：

```bash
git remote add origin <USER_REPOSITORY_URL>
git push -u origin main --tags
```

### 4.3 基线验证

安装 Deno 2.9 或兼容的更高稳定版本，然后执行：

```bash
deno --version
deno fmt --check
deno run -A puppeteer browsers install chrome
./make.js test
```

Codex 必须把以下内容写入 `docs/baseline.md`：

- 操作系统；
- Deno 版本；
- Chrome for Testing 版本；
- 上游标签和提交；
- 基线测试总数；
- 通过数和失败数；
- 上游原有失败及完整错误；
- 手工加载扩展的结果。

基线失败时，不得直接修改业务代码掩盖问题。先判断是环境问题还是上游问题，并记录。

### 4.4 第一版技术约束

- 保留上游 Deno、`make.js`、原生 JavaScript 和现有测试体系；
- 新代码优先使用原生 JavaScript ES Module 或与现有内容脚本兼容的普通模块；
- 新文件必须使用 JSDoc 定义输入输出类型；
- 不引入 React、Vue、Svelte、WXT、Webpack 或大型 UI 框架；
- 不增加运行时第三方依赖，除非 ADR 证明无法合理独立实现；
- 保持 `minimum_chrome_version` 至少为上游当前值 `117.0`，不得无理由提高；
- Chrome/Chromium 为主目标，但不得主动破坏 Vimium 已有 Firefox 兼容路径。

---

## 5. 总体架构

### 5.1 统一命令管线

```text
┌────────────────────┐
│ Keyboard Adapter   │──┐
└────────────────────┘  │
                        │
┌────────────────────┐  │
│ Mouse Gesture      │──┤
└────────────────────┘  │
                        │
┌────────────────────┐  │    ┌─────────────────────┐
│ Super Drag         │──┼───>│ Command Invocation  │
└────────────────────┘  │    └──────────┬──────────┘
                        │               │
┌────────────────────┐  │    ┌──────────▼──────────┐
│ Wheel Gesture      │──┤    │ Command Dispatcher  │
└────────────────────┘  │    └───────┬───────┬─────┘
                        │            │       │
┌────────────────────┐  │    ┌───────▼───┐ ┌─▼────────────────┐
│ Rocker Gesture     │──┘    │ Page Exec │ │ Browser Exec     │
└────────────────────┘       │ DOM/Scroll│ │ Tabs/Windows/API │
                             └───────────┘ └──────────────────┘
```

关键要求：

- “关闭当前标签页”只实现一次；
- 键盘 `x`、鼠标轨迹 `↓→`、摇杆手势等只是不同绑定；
- 输入模块不直接调用 `chrome.tabs`；
- 输入模块只产生标准化 `CommandInvocation`；
- Dispatcher 决定命令在当前 Frame、顶层 Frame 或 Service Worker 中执行；
- 所有命令返回标准化 `CommandResult`。

### 5.2 分层职责

#### Input Layer

负责把用户动作识别为标准命令，不负责业务执行：

- Keyboard Adapter：复用 Vimium 现有按键解析；
- Mouse Gesture Adapter：轨迹采样、方向量化和匹配；
- Super Drag Adapter：判断拖拽对象与方向；
- Wheel Adapter：组合按键和滚轮方向；
- Rocker Adapter：左右键按下顺序。

#### Command Layer

- 维护命令元数据；
- 校验参数；
- 处理重复次数；
- 判断执行位置；
- 统一错误码；
- 提供给帮助页和设置页使用的命令列表。

#### Page Execution Layer

运行在内容脚本：

- 页面滚动；
- 链接提示；
- 页面内查找；
- 聚焦输入框；
- 选择和复制；
- 页面标记；
- DOM 链接跟随；
- HUD 和轨迹覆盖层。

#### Browser Execution Layer

运行在 Service Worker：

- 标签页和窗口；
- 历史、书签、会话；
- 缩放、静音、固定；
- 恢复关闭标签页；
- Frame 消息协调；
- 权限和错误处理。

#### Configuration Layer

- 默认配置；
- 浏览器同步配置；
- 本地大对象；
- 配置迁移；
- 站点覆盖规则；
- 导入导出。

---

## 6. 建议新增目录与文件

在保留上游结构的基础上新增：

```text
open-key-mouse/
├── LICENSE
├── LICENSES/
│   └── MIT-Vimium.txt
├── PROJECT_CHARTER.md
├── PRIVACY.md
├── SECURITY.md
├── TRADEMARK.md
├── THIRD_PARTY_NOTICES.md
├── AGENTS.md
├── docs/
│   ├── DEVELOPMENT_DESIGN.md
│   ├── baseline.md
│   ├── codex-progress.md
│   ├── feature-parity-matrix.md
│   ├── permissions.md
│   ├── release-checklist.md
│   └── adr/
│       ├── 001-fork-vimium.md
│       ├── 002-license-policy.md
│       ├── 003-command-dispatcher.md
│       ├── 004-storage-split.md
│       └── 005-no-telemetry.md
│
├── lib/
│   └── open_key_mouse/
│       ├── command_invocation.js
│       ├── command_registry_adapter.js
│       ├── settings_schema.js
│       ├── settings_validator.js
│       ├── site_rule_matcher.js
│       └── message_protocol.js
│
├── content_scripts/
│   └── mouse/
│       ├── mouse_controller.js
│       ├── gesture_session.js
│       ├── path_sampler.js
│       ├── direction_quantizer.js
│       ├── gesture_recognizer.js
│       ├── gesture_overlay.js
│       ├── context_menu_guard.js
│       ├── frame_gesture_bridge.js
│       ├── super_drag_controller.js
│       ├── drag_context_classifier.js
│       ├── wheel_gesture_controller.js
│       ├── rocker_gesture_controller.js
│       └── cursor_controller.js
│
├── background_scripts/
│   └── open_key_mouse/
│       ├── command_dispatcher.js
│       ├── browser_command_adapter.js
│       ├── gesture_frame_coordinator.js
│       ├── settings_repository.js
│       └── settings_migrations.js
│
├── pages/
│   ├── mouse_options.js
│   ├── gesture_editor.js
│   ├── gesture_editor.css
│   ├── privacy.html
│   └── onboarding.html
│
├── tests/
│   └── open_key_mouse/
│       ├── command_dispatcher_test.js
│       ├── direction_quantizer_test.js
│       ├── gesture_recognizer_test.js
│       ├── path_sampler_test.js
│       ├── drag_context_classifier_test.js
│       ├── site_rule_matcher_test.js
│       ├── settings_migrations_test.js
│       └── message_protocol_test.js
│
└── scripts/
    ├── audit_permissions.js
    ├── audit_network_usage.js
    └── build_release.js
```

说明：

- 不要求一次性创建全部文件；按阶段需要创建。
- 新内容脚本的加载顺序必须由 Manifest 明确控制。
- 内容脚本仍处于 isolated world，不把高权限能力暴露给网页脚本。
- 不通过 `window.postMessage` 接收可触发浏览器命令的特权消息。

---

## 7. 统一命令模型

### 7.1 CommandInvocation

在 `lib/open_key_mouse/command_invocation.js` 定义：

```javascript
/**
 * @typedef {Object} CommandInvocation
 * @property {1} protocolVersion
 * @property {string} requestId
 * @property {string} commandName
 * @property {Record<string, unknown>} options
 * @property {number} count
 * @property {InputSource} source
 * @property {CommandContext} context
 */

/**
 * @typedef {Object} InputSource
 * @property {"keyboard"|"mouseGesture"|"superDrag"|"wheel"|"rocker"|"ui"} type
 * @property {string=} bindingId
 * @property {string=} pattern
 */

/**
 * @typedef {Object} CommandContext
 * @property {number=} tabId
 * @property {number=} frameId
 * @property {boolean} topFrame
 * @property {string} pageUrl
 * @property {string=} linkUrl
 * @property {string=} linkText
 * @property {string=} selectedText
 * @property {string=} imageUrl
 * @property {{x:number,y:number}=} pointer
 */
```

约束：

- `count` 最小为 1；
- 普通命令最大重复 50 次；
- 关闭标签页、关闭窗口等危险命令最大重复 10 次；
- URL 参数只允许 `http:`, `https:`, `file:`, `ftp:`（浏览器支持时）, `mailto:` 及明确允许的扩展内部 URL；
- 默认拒绝 `javascript:`、`data:text/html` 和不明协议；
- 所有调用生成随机 `requestId`，用于错误追踪和去重；
- 输入适配器不得传递任意可执行字符串。

### 7.2 CommandResult

```javascript
/**
 * @typedef {Object} CommandResult
 * @property {boolean} ok
 * @property {string} code
 * @property {string=} message
 * @property {unknown=} data
 */
```

固定错误码至少包括：

```text
OK
UNKNOWN_COMMAND
INVALID_OPTIONS
UNSUPPORTED_PAGE
PERMISSION_DENIED
NO_ACTIVE_TAB
NO_MATCHING_ELEMENT
CLIPBOARD_DENIED
BLOCKED_URL_SCHEME
EXTENSION_CONTEXT_LOST
COMMAND_FAILED
COMMAND_CANCELLED
```

### 7.3 命令兼容策略

第一版继续使用 Vimium 已有命令名作为稳定 ID，例如：

```text
scrollDown
scrollToTop
LinkHints.activateMode
Vomnibar.activate
enterFindMode
goBack
goForward
removeTab
restoreTab
nextTab
previousTab
togglePinTab
toggleMuteTab
zoomIn
zoomOut
```

新命令使用命名空间：

```text
OpenKeyMouse.closeWindow
OpenKeyMouse.newWindow
OpenKeyMouse.toggleKeyboard
OpenKeyMouse.toggleMouseGestures
OpenKeyMouse.toggleSuperDrag
OpenKeyMouse.showTabList
OpenKeyMouse.copySelection
OpenKeyMouse.copyLinkText
OpenKeyMouse.copyImageUrl
OpenKeyMouse.searchSelection
OpenKeyMouse.openLinkForeground
OpenKeyMouse.openLinkBackground
OpenKeyMouse.openImageForeground
OpenKeyMouse.openImageBackground
OpenKeyMouse.downloadImage
OpenKeyMouse.toggleFullscreen
OpenKeyMouse.minimizeWindow
OpenKeyMouse.maximizeWindow
```

### 7.4 Command Registry 元数据

每条命令至少包含：

```javascript
{
  name: "removeTab",
  title: "Close current tab",
  category: "tabs",
  execution: "background",
  repeatable: true,
  dangerous: true,
  supportedInputs: ["keyboard", "mouseGesture", "rocker", "ui"],
  requiredContext: [],
  requiredPermissions: ["tabs"],
}
```

命令注册表是以下功能的唯一数据源：

- 设置页命令下拉框；
- 帮助页；
- 绑定校验；
- 权限提示；
- 导入导出校验；
- 自动化测试参数化。

禁止在设置页手写另一份命令列表。

### 7.5 与 Vimium 现有命令路径的整合步骤

1. 先写适配测试，证明一个现有命令可通过新 Dispatcher 调用；
2. 新增 `command_registry_adapter.js`，读取或包装现有命令元数据；
3. 新增 `command_dispatcher.js`，根据 execution 类型路由；
4. 鼠标模块只调用 Dispatcher；
5. 键盘路径暂时保留原流程；
6. Dispatcher 稳定后，再让键盘路径也使用统一 Invocation；
7. 每次迁移一类命令，不进行一次性重构。

---

## 8. 功能基线与命令覆盖

### 8.1 必须保留的 Vimium 能力

#### 页面导航

- 上、下、左、右滚动；
- 半页、整页滚动；
- 顶部、底部、最左、最右；
- 平滑滚动；
- URL 上一级和根路径；
- 上一页、下一页语义链接；
- 聚焦输入框；
- Insert Mode；
- Pass Next Key；
- 当前 Frame、下一个 Frame、主 Frame；
- 查看页面源码；
- 刷新与强制刷新；
- 复制当前 URL；
- 从剪贴板打开 URL。

#### 链接提示

- 当前标签打开；
- 后台新标签打开；
- 前台新标签打开；
- 多链接队列；
- 复制链接 URL；
- 下载链接；
- 隐身窗口打开；
- Hover；
- Focus；
- 复制链接文字；
- 自定义提示字符；
- 数字过滤提示；
- 自定义提示 CSS；
- 跨 Frame 提示。

#### Vomnibar

- URL、历史、书签综合搜索；
- 当前标签打开；
- 新标签打开；
- 书签专用搜索；
- 编辑当前 URL；
- 标签页搜索；
- 自定义搜索引擎；
- 搜索补全；
- 新标签页目标配置。

#### 查找、选择和标记

- 页面内查找；
- 正向和反向查找；
- 查找选中文字；
- 正则查找选项；
- Visual Mode；
- Visual Line Mode；
- 本地标记；
- 全局标记；
- 跳回上次位置。

#### 标签页和浏览器

- 创建、关闭、恢复、复制标签页；
- 第一、最后、前一、后一标签页；
- 最近访问标签页；
- 左右移动标签页；
- 移到新窗口；
- 关闭左侧、右侧、其他标签页；
- 固定和取消固定；
- 静音当前、其他或全部；
- 缩放、重置缩放；
- 命令重复次数；
- 自定义键位；
- 站点排除规则；
- 设置导入导出；
- 帮助对话框。

### 8.2 必须新增的鼠标能力

- 可配置四向或八向轨迹手势；
- 右键按住绘制轨迹；
- 普通右键仍显示原生菜单；
- 手势轨迹线；
- 当前识别方向和目标命令 HUD；
- 未识别手势提示；
- 手势取消；
- 手势最小距离、采样距离、超时和最大段数；
- 超级拖拽：链接、文字、图片；
- 前台和后台打开；
- 复制文字、URL、图片 URL；
- 使用默认或指定搜索引擎搜索文字；
- 滚轮手势；
- 摇杆手势；
- 自定义鼠标指针；
- 标签页可视列表；
- 按网站禁用单个输入模块；
- 配置导入导出；
- 所有鼠标动作可映射到统一命令注册表中的命令。

### 8.3 功能对照表文件

Codex 必须创建 `docs/feature-parity-matrix.md`：

```markdown
| 编号 | 来源 | 功能 | 公开参考 | 本项目命令 | 自动测试 | 手工测试 | 状态 | 备注 |
|---|---|---|---|---|---|---|---|---|
| V-001 | Vimium | Scroll down | Vimium command docs | scrollDown | PASS | PASS | DONE | |
| C-001 | CrxMouse | Right-hold drag left = back | Store docs | goBack | PASS | PASS | DONE | clean-room |
```

状态只能使用：

```text
TODO
IN_PROGRESS
BLOCKED_BROWSER_LIMITATION
DONE
NOT_APPLICABLE
```

任何功能在矩阵中没有 `DONE` 或浏览器限制说明时，不得宣称达到完整功能覆盖。

---

## 9. 鼠标轨迹手势设计

### 9.1 状态机

```text
IDLE
  └─ right pointer down ─> PENDING

PENDING
  ├─ move < activationDistance ─> PENDING
  ├─ move >= activationDistance ─> ACTIVE
  ├─ pointer up ─> NATIVE_CONTEXT_MENU
  └─ cancel/blur ─> CANCELLED

ACTIVE
  ├─ accepted direction segment ─> ACTIVE
  ├─ pointer up + exact match ─> COMPLETED
  ├─ pointer up + no match ─> UNRECOGNIZED
  ├─ Escape ─> CANCELLED
  ├─ timeout ─> CANCELLED
  └─ extension unloaded ─> CANCELLED
```

### 9.2 默认参数

```javascript
{
  enabled: true,
  triggerButton: 2,
  directionMode: "4-way",
  activationDistancePx: 10,
  sampleDistancePx: 4,
  minimumSegmentDistancePx: 18,
  turnHysteresisDegrees: 18,
  maxSegments: 8,
  maxDurationMs: 2500,
  showTrail: true,
  showCommandHud: true,
  suppressContextMenuAfterActivation: true,
}
```

所有参数必须有合理上下限，导入配置时强制校验。

### 9.3 事件监听规则

使用捕获阶段监听：

```text
pointerdown
pointermove
pointerup
pointercancel
contextmenu
wheel
blur
visibilitychange
keydown（只用于 Escape 取消）
```

要求：

- `pointermove` 的高频处理只在 PENDING 或 ACTIVE 时启用；
- 空闲状态不运行 `requestAnimationFrame` 循环；
- 仅处理 `event.isTrusted === true` 的生产事件；
- 默认只处理 `pointerType === "mouse"`；
- `wheel` 监听必须是 `passive: false`，其他能使用 passive 的监听器应使用 passive；
- 普通点击和普通右键不得调用 `preventDefault()`；
- 达到激活距离后，才拦截后续事件和 `contextmenu`；
- `pointerup`、`pointercancel`、页面隐藏和 Frame 失焦时必须清理监听器与覆盖层。

### 9.4 轨迹采样算法

1. 记录起点；
2. 新点与最后采样点距离小于 `sampleDistancePx` 时忽略；
3. 计算从当前段起点到新点的向量；
4. 未达到 `minimumSegmentDistancePx` 时不产生方向；
5. 四向模式按主轴量化为 `U/D/L/R`；
6. 八向模式增加 `UL/UR/DL/DR`；
7. 连续相同方向合并；
8. 使用角度滞回避免边界抖动；
9. 超过最大段数立即停止继续追加，并在 HUD 提示；
10. 结束时用标准化 pattern 查询绑定。

### 9.5 Pattern 格式

内部存储使用数组，导出时使用字符串：

```javascript
["D", "R"]
```

导出格式：

```text
D>R
```

禁止用本地化箭头字符作为持久化 ID，界面可显示 `↓ →`。

### 9.6 匹配规则

- Pattern 必须唯一；
- 同一输入上下文内不允许两个启用绑定拥有相同 Pattern；
- 编辑时实时提示冲突；
- ACTIVE 过程中显示：
  - 当前 pattern；
  - 精确匹配命令；
  - 是否仍是其他命令的前缀；
- 松开鼠标时只执行精确匹配；
- 默认不实现“最长前缀自动执行”，防止误操作；
- 未匹配时不执行任何命令。

### 9.7 右键菜单保护

必须满足：

1. 右键按下后不移动，松开：原生菜单正常出现；
2. 移动距离未达到阈值：原生菜单正常出现；
3. 达到阈值并形成手势：不出现原生菜单；
4. ACTIVE 后按 Escape：取消手势且不执行命令；
5. 网页自行阻止右键菜单时，本扩展不尝试恢复网页已禁止的菜单；
6. 在设置中允许用户完全关闭右键手势。

### 9.8 跨 Frame 协调

Manifest 内容脚本继续使用 `all_frames: true`。

安全方案：

- Frame 之间不使用网页可伪造的 `window.postMessage` 触发高权限操作；
- 每个 Frame 只识别本 Frame 中收到的可信 Pointer 事件；
- 手势开始、方向变化、结束通过 `chrome.runtime.connect` 的短生命周期 Port 上报；
- Service Worker 按 `tabId` 维护活动手势的最小状态；
- 只在手势期间保持 Port，结束后立即断开；
- Service Worker 只转发压缩后的方向变化，不转发全部鼠标点；
- 高权限命令最终仍由 Dispatcher 验证来源 Frame 和活动手势状态；
- 跨 Frame 轨迹线可以在各 Frame 分段显示，不要求首版绘制成一条无缝全局线。

任何网页脚本发送的消息都不得直接造成关闭标签页、打开 URL 或读取剪贴板。

### 9.9 默认鼠标手势

以公开可见的 CrxMouse 默认操作为参考，采用独立实现：

| Pattern | 默认命令 | 说明 |
|---|---|---|
| `L` | `goBack` | 后退 |
| `R` | `goForward` | 前进 |
| `D>R` | `removeTab` | 关闭当前标签页 |
| `L>U` | `restoreTab` | 恢复关闭标签页 |
| `R>D` | `scrollToBottom` | 滚动到底部 |
| `R>U` | `scrollToTop` | 滚动到顶部 |
| `U` | `scrollFullPageUp` | 向上整页 |
| `U>D` | `reload` | 刷新 |
| `U>D>U` | `reload {hard:true}` | 强制刷新 |
| `U>L` | `previousTab` | 左侧标签页 |
| `U>R` | `nextTab` | 右侧标签页 |
| `D>R>U` | `OpenKeyMouse.newWindow` | 新建窗口 |
| `D>R>D` | `OpenKeyMouse.closeWindow` | 关闭当前窗口 |

危险命令必须在设置页标识“可能关闭标签页或窗口”。

---

## 10. 超级拖拽设计

### 10.1 支持对象

```text
LINK
SELECTED_TEXT
IMAGE
UNSUPPORTED_NATIVE_DRAG
```

### 10.2 分类优先级

1. 文件拖入、文件上传：始终视为原生拖放，不接管；
2. 页面应用自定义 `draggable=true` 的非链接组件：默认不接管；
3. `a[href]`：链接；
4. `img` 或包含图片 URL 的拖拽：图片；
5. 非空选中文字：文字；
6. 其他：不接管。

分类逻辑必须独立放在 `drag_context_classifier.js` 并进行单元测试。

### 10.3 默认绑定

#### 链接

| 方向 | 命令 |
|---|---|
| `R` | 前台新标签打开链接 |
| `L` | 后台新标签打开链接 |
| `L>D>R` | 复制链接文字 |
| `R>D>L` | 复制链接 URL |

#### 文字

| 方向 | 命令 |
|---|---|
| `R` | 前台新标签搜索文字 |
| `L` | 后台新标签搜索文字 |
| `D` | 复制文字 |

#### 图片

| 方向 | 命令 |
|---|---|
| `R` | 前台新标签打开图片 |
| `L` | 后台新标签打开图片 |
| `D` | 复制图片 URL |
| `D>R` | 下载图片，若浏览器允许 |

### 10.4 防冲突规则

以下情况默认不启动超级拖拽：

- `input[type=file]`；
- `contenteditable` 编辑区域内的内部拖放；
- Monaco、CodeMirror、Ace 等编辑器区域；
- Canvas、WebGL；
- 文件、文件夹或操作系统拖入浏览器；
- 网页明确使用拖放排序且目标不是普通链接、图片或选择文字；
- 用户在站点规则中关闭超级拖拽；
- 用户按住配置的“强制原生拖拽”修饰键。

默认修饰键：

```text
Alt = 强制原生拖拽，不执行超级拖拽
```

### 10.5 搜索行为

- 默认使用 Vimium 现有默认搜索 URL；
- 可为每个拖拽绑定选择自定义搜索引擎 keyword；
- 查询必须使用 `encodeURIComponent`；
- 不允许后台把查询上传到项目服务器；
- 搜索请求仅发送给用户实际选择的搜索引擎。

---

## 11. 滚轮手势和摇杆手势

### 11.1 滚轮手势

支持组合：

```text
RIGHT_BUTTON + WHEEL_UP
RIGHT_BUTTON + WHEEL_DOWN
LEFT_BUTTON + WHEEL_UP
LEFT_BUTTON + WHEEL_DOWN
MIDDLE_BUTTON + WHEEL_UP
MIDDLE_BUTTON + WHEEL_DOWN
```

默认：

| 组合 | 命令 |
|---|---|
| 右键 + 滚轮上 | `scrollToTop` |
| 右键 + 滚轮下 | `scrollToBottom` |
| 左键 + 滚轮上 | `previousTab` |
| 左键 + 滚轮下 | `nextTab` |

规则：

- 只有组合存在启用绑定时才阻止页面滚动；
- 使用累计 `deltaY` 阈值，避免触控板微小噪声；
- 默认一次物理滚动最多触发一次命令；
- 设置冷却时间，默认 180ms；
- 允许配置“连续切换标签页”模式；
- 不得把触控板普通双指滚动误识别为滚轮手势。

### 11.2 摇杆手势

支持：

```text
HOLD_RIGHT_THEN_CLICK_LEFT
HOLD_LEFT_THEN_CLICK_RIGHT
```

默认：

| 组合 | 命令 |
|---|---|
| 按住右键再点左键 | `goBack` |
| 按住左键再点右键 | `goForward` |

规则：

- 完成摇杆手势后抑制对应 click/contextmenu；
- 未形成完整组合时恢复普通鼠标行为；
- 与轨迹手势冲突时，摇杆优先级高于未激活轨迹，低于已经 ACTIVE 的轨迹；
- 允许完全关闭。

---

## 12. 标签页列表与自定义指针

### 12.1 标签页列表

优先复用 Vimium `Vomnibar.activateTabSelection` 的数据和搜索能力，再提供可选的鼠标友好视图：

- 当前窗口或全部窗口；
- 标题、URL、favicon；
- 模糊搜索；
- 键盘上下移动、Enter 切换；
- 鼠标点击切换；
- 中键点击关闭；
- 固定标签页标记；
- 最近使用排序选项；
- 不保存标签页历史到项目服务器。

不得为了显示列表请求 `management` 权限。

### 12.2 自定义指针

- 默认关闭；
- 仅允许用户本地选择 PNG、CUR 或浏览器实际支持的安全图片格式；
- 文件大小、像素尺寸和热点坐标必须限制；
- 图片保存在 `chrome.storage.local`，不进入 `storage.sync`；
- 不上传服务器；
- 不允许 SVG 脚本、HTML 或远程 URL；
- 支持站点规则禁用；
- 提供一键恢复系统指针；
- 注入的 CSS 只能使用项目专属 Shadow DOM 或带前缀的样式标识。

建议限制：

```text
最大文件：256 KiB
最大尺寸：128 × 128
允许格式：PNG；CUR 仅在验证浏览器支持后开启
```

---

## 13. 设置模型与持久化

### 13.1 存储原则

`chrome.storage.sync` 容量有限，只存储小型、可同步配置：

- 键位；
- 鼠标手势绑定；
- 阈值；
- 搜索引擎定义；
- 站点规则；
- 常规开关。

`chrome.storage.local` 存储：

- 自定义指针图片；
- 本地缓存；
- 大型导入数据；
- 无需跨设备同步的设备级选项；
- 迁移备份。

`chrome.storage.session` 存储：

- 临时禁用状态；
- Pass Next Key 等会话数据；
- 当前浏览器会话中的一次性状态。

不得申请 `unlimitedStorage`，除非未来有经过公开 ADR 审核的真实需求。

### 13.2 建议配置结构

```json
{
  "settingsVersion": "1.0.0",
  "schemaVersion": 1,
  "general": {
    "enabled": true,
    "showHud": true,
    "language": "auto",
    "browserSyncEnabled": true
  },
  "keyboard": {
    "enabled": true,
    "keyMappings": "# Vimium compatible mappings"
  },
  "mouse": {
    "enabled": true,
    "directionMode": "4-way",
    "activationDistancePx": 10,
    "sampleDistancePx": 4,
    "minimumSegmentDistancePx": 18,
    "turnHysteresisDegrees": 18,
    "maxSegments": 8,
    "maxDurationMs": 2500,
    "showTrail": true,
    "showCommandHud": true,
    "bindings": [
      {
        "id": "mouse-back",
        "enabled": true,
        "pattern": ["L"],
        "commandName": "goBack",
        "options": {}
      }
    ]
  },
  "superDrag": {
    "enabled": true,
    "nativeBypassModifier": "Alt",
    "bindings": []
  },
  "wheel": {
    "enabled": true,
    "threshold": 80,
    "cooldownMs": 180,
    "bindings": []
  },
  "rocker": {
    "enabled": true,
    "bindings": []
  },
  "cursor": {
    "enabled": false,
    "localAssetId": null,
    "hotspotX": 0,
    "hotspotY": 0
  },
  "siteRules": [],
  "exclusionRules": [],
  "searchEngines": "",
  "privacy": {
    "telemetry": false,
    "remoteConfig": false,
    "backgroundNetwork": false
  }
}
```

`privacy` 三项必须是硬编码不可开启的声明性状态，设置页只显示，不提供开启开关。

### 13.3 站点规则

```json
{
  "id": "rule-google-docs",
  "pattern": "https://docs.google.com/*",
  "enabled": true,
  "modules": {
    "keyboard": false,
    "mouse": true,
    "superDrag": false,
    "wheel": false,
    "rocker": false,
    "cursor": false
  },
  "passKeys": "",
  "notes": "Avoid editor conflicts"
}
```

优先级：

1. 当前会话临时开关；
2. 最具体且最后定义的匹配站点规则；
3. Vimium 原有 exclusion rules；
4. 全局模块开关；
5. 默认配置。

匹配器必须有单元测试，覆盖：

- 通配符；
- http/https；
- 子域名；
- 路径；
- 查询参数；
- 无效 pattern；
- 多规则冲突；
- Frame URL 与顶层 URL 的取舍。

站点启用状态以顶层页面 URL 为主，避免跨域 iframe 绕过顶层禁用规则。

### 13.4 配置迁移

每次 schema 变化必须：

- 增加独立迁移函数；
- 从旧版本逐级迁移，禁止跳跃式覆盖；
- 迁移前在 `storage.local` 保存一次备份；
- 迁移失败时恢复备份并显示可理解错误；
- 不静默丢弃未知字段；
- 单元测试覆盖至少最近三个 schema 版本。

### 13.5 导入导出格式

```json
{
  "format": "open-key-mouse-settings",
  "formatVersion": 1,
  "exportedAt": "2026-08-23T00:00:00.000Z",
  "extensionVersion": "0.1.0",
  "source": "OpenKeyMouse",
  "settings": {},
  "localAssets": []
}
```

要求：

- 导入前完成 JSON 解析、schema 校验和大小限制；
- 显示将新增、修改、删除的摘要；
- 用户明确确认后再写入；
- 导入错误不得覆盖现有配置；
- 导出顺序稳定，便于 Git diff；
- 不导出浏览历史、书签内容、页面内容或临时手势状态。

### 13.6 Vimium 配置迁移

由于新扩展 ID 无法直接读取另一个扩展的数据，采用用户主动导入 Vimium JSON 备份：

- 识别 Vimium 配置结构；
- 导入 keyMappings；
- 导入 searchEngines；
- 导入 exclusionRules；
- 导入 link hint 设置；
- 导入滚动和查找设置；
- 未识别字段列入导入报告，不静默删除。

不得请求 `management` 权限来探测或控制 Vimium/CrxMouse 是否安装。

---

## 14. 设置页与交互设计

### 14.1 设置页导航

在上游 Options 页面基础上增加分页或侧栏：

```text
General
Keyboard
Mouse Gestures
Super Drag
Wheel & Rocker
Site Rules
Search
Appearance
Backup & Restore
Privacy
About & Licenses
```

首版使用原生 HTML、CSS 和 JavaScript，不引入 UI 框架。

### 14.2 鼠标手势编辑器

必须支持：

- 在 Canvas 或普通 SVG 区域画手势；
- 实时显示量化后的方向序列；
- 从统一命令注册表选择命令；
- 编辑命令 options；
- 检测重复 pattern；
- 启用、禁用、删除和恢复默认；
- 按分类筛选命令；
- 危险命令警告；
- 键盘可操作，不依赖拖拽才能完成设置；
- 屏幕阅读器标签；
- 保存前验证全部绑定。

### 14.3 扩展按钮弹窗

当前页面弹窗只提供高频控制：

- 当前网站总开关；
- Keyboard 开关；
- Mouse Gesture 开关；
- Super Drag 开关；
- Wheel/Rocker 开关；
- “仅本次会话禁用”；
- 打开设置；
- 打开帮助；
- 显示当前页面为何不可用。

不得出现：

- 登录；
- 购买；
- 升级专业版；
- 广告；
- 评分弹窗；
- 强制捐赠；
- 与核心功能无关的推荐链接。

### 14.4 帮助页

帮助页同时显示：

- 键盘绑定；
- 鼠标轨迹；
- 超级拖拽；
- 滚轮和摇杆；
- 当前网站禁用状态；
- 浏览器限制；
- 隐私承诺；
- 开源许可证。

帮助内容由 Command Registry 和配置动态生成，避免文档与代码不一致。

---

## 15. Manifest V3 与权限设计

### 15.1 基线权限

优先沿用 Vimium `v2.4.2` 已有权限，不为鼠标轨迹额外增加高权限：

```json
{
  "host_permissions": ["<all_urls>"],
  "permissions": [
    "tabs",
    "bookmarks",
    "history",
    "storage",
    "sessions",
    "scripting",
    "favicon",
    "webNavigation",
    "search"
  ]
}
```

`notifications` 若只用于版本升级提示，应在去除升级打扰后删除。

### 15.2 默认禁止加入的权限

```text
management
cookies
webRequest
webRequestBlocking
identity
nativeMessaging
debugger
proxy
geolocation
unlimitedStorage
topSites
idle
```

`downloads` 只有在确认无法使用现有安全方式完成明确的用户点击下载后，才可通过 ADR 评估是否加入。

### 15.3 内容脚本

继续保持：

```json
{
  "matches": ["<all_urls>"],
  "run_at": "document_start",
  "all_frames": true,
  "match_about_blank": true
}
```

新增鼠标脚本时必须确保加载顺序：

1. shared types；
2. settings；
3. message protocol；
4. command invocation；
5. mouse algorithms；
6. controllers；
7. frontend initializer。

### 15.4 内容安全策略

扩展页面至少使用：

```json
{
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

禁止：

- `unsafe-eval`；
- 远程脚本；
- CDN UI 库；
- 远程字体；
- 在扩展页面执行导入文件中的 HTML；
- 把用户提供的字符串插入 `innerHTML`。

### 15.5 New Tab 行为

第一版保留 Vimium 基线行为，不偷偷劫持用户通过 Ctrl+T 打开的原生新标签页。

如未来决定使用 `chrome_url_overrides.newtab`，必须单独建立 ADR，并满足：

- 商店页面明确披露；
- 安装后明确说明；
- 不通过后台脚本偷偷跳转；
- 提供本地、无追踪的新标签页；
- 不加入搜索返佣或广告；
- 充分评估无法运行时关闭该覆盖的产品影响。

---

## 16. 隐私与安全设计

### 16.1 零遥测要求

禁止发送：

- 当前 URL；
- 浏览历史；
- 书签；
- 页面标题和正文；
- 用户选中文字；
- 搜索词；
- 键盘按键；
- 鼠标路径和手势；
- 指针图片；
- 配置文件；
- 唯一设备 ID；
- 安装 ID；
- 崩溃日志到第三方平台。

### 16.2 允许的网络行为

仅允许：

1. 用户主动打开网页；
2. 用户使用 Vomnibar 或超级拖拽向其选择的搜索引擎发送查询；
3. 用户主动打开项目仓库、帮助或许可证链接；
4. Chrome Web Store 自己执行扩展更新。

禁止扩展启动、页面加载或鼠标操作后自动请求项目服务器。

### 16.3 网络调用审计

创建 `scripts/audit_network_usage.js`，扫描：

```text
fetch(
XMLHttpRequest
WebSocket
EventSource
sendBeacon
importScripts(
http://
https://
```

允许项必须位于明确白名单文件并有注释。CI 中执行该审计。

### 16.4 消息安全

- 所有 runtime 消息包含 `protocolVersion` 和类型；
- Service Worker 检查 `sender.id === chrome.runtime.id`；
- 涉及标签页的调用使用 `sender.tab.id`，不信任内容脚本自报 tabId；
- Frame ID 使用浏览器提供的 sender 信息；
- 对消息对象执行白名单 schema 校验；
- 不执行消息中提供的函数名、脚本字符串或任意 URL；
- 高权限命令验证当前活动手势会话；
- 重复 requestId 不重复执行危险命令；
- Service Worker 重启后不恢复未完成的危险手势。

### 16.5 页面攻击面

- 只响应可信用户事件；
- 所有覆盖层使用 Shadow DOM；
- CSS 类统一使用 `okm-` 前缀；
- 不读取页面密码输入框内容；
- 超级拖拽不处理密码输入框选区；
- 不把选中文字写入日志；
- URL 打开前执行协议校验；
- 自定义 CSS 导入需阻止或警告远程 `@import` 和远程 `url()`；
- 自定义图片必须验证真实 MIME、大小和尺寸。

### 16.6 Service Worker 生命周期

Service Worker 可能随时终止：

- 不在全局变量中保存不可恢复的重要配置；
- 每个事件处理器可以独立初始化所需状态；
- 设置读入后允许缓存，但缓存丢失时能重建；
- 活动手势仅是短生命周期状态，Worker 消失时安全取消；
- E2E 必须测试 Worker 被终止后命令仍能再次正常执行。

---

## 17. 性能约束

新鼠标模块必须满足：

- 空闲时没有持续 `mousemove`/`pointermove` 重计算；
- 空闲时没有持续 `requestAnimationFrame`；
- 不为鼠标功能增加全页面 MutationObserver；
- 每个活动手势最多保存 512 个采样点；
- 方向变化消息只在方向真正变化时发送；
- 轨迹覆盖层每个 Frame 只有一个实例；
- 手势结束后清空数组、Port、定时器和 DOM；
- Settings 初始化最多一次完整 storage 读取，后续使用缓存和变更事件；
- 设置页大列表使用事件委托；
- 不在 `pointermove` 中执行 storage、书签、历史或 tabs API；
- 不在高频事件中创建大量临时 DOM 节点；
- 所有性能优化必须先有可复现测试或测量，不做难以维护的过早优化。

性能测试至少记录：

- 空闲页面事件处理；
- 100 次手势后的 DOM 节点数量；
- 100 次手势后的监听器和 Port 清理；
- 长页面滚动；
- 多 iframe 页面；
- 50 个标签页下标签搜索响应。

---

## 18. 测试设计

### 18.1 单元测试

#### 手势算法

- 水平左、右；
- 垂直上、下；
- 多段手势；
- 小抖动；
- 边界角度；
- 连续同方向合并；
- 八方向模式；
- 最大段数；
- 最短距离；
- 超时；
- 完全相同路径在不同 DPI 下标准化结果一致。

#### 配置

- 默认配置通过 schema；
- 超范围参数拒绝；
- 重复 pattern 拒绝；
- 未知命令拒绝；
- 老版本逐级迁移；
- 迁移失败不覆盖；
- 导入文件大小限制；
- Vimium 备份映射；
- 稳定导出顺序。

#### Dispatcher

- page 命令路由；
- background 命令路由；
- 未知命令；
- 非法参数；
- 重复次数；
- 危险命令上限；
- URL 协议；
- 重复 requestId；
- Service Worker 重启后的初始化。

#### 超级拖拽

- 普通链接；
- 图片链接；
- 选择文字；
- 文件拖放；
- contenteditable；
- draggable 看板卡片；
- 嵌套 anchor；
- Shadow DOM target；
- 非法 URL；
- 密码框。

#### 站点规则

- 规则优先级；
- 顶层 URL；
- iframe；
- 通配符；
- 临时禁用；
- 单模块禁用；
- 多规则冲突。

### 18.2 DOM 集成测试

建立本地测试页面：

```text
tests/fixtures/basic-links.html
tests/fixtures/inputs.html
tests/fixtures/scroll-containers.html
tests/fixtures/iframes.html
tests/fixtures/shadow-dom.html
tests/fixtures/drag-drop-app.html
tests/fixtures/contenteditable.html
tests/fixtures/images.html
```

验证：

- 普通右键菜单；
- 手势后菜单被抑制；
- 输入框键盘不被误拦；
- 超级拖拽不破坏文件上传；
- 内层滚动容器；
- iframe；
- Shadow DOM；
- 页面卸载清理；
- 扩展更新后旧内容脚本失效时安全退出。

### 18.3 E2E 测试

延续上游 Puppeteer 测试体系，增加：

- 加载 unpacked 扩展；
- 在测试页用真实 CDP 鼠标事件画 `L`、`R`、`D>R`；
- 验证后退、前进和关闭标签页；
- 验证未达到阈值时原生右键行为；
- 验证设置修改即时生效；
- 验证站点禁用；
- 验证超级拖拽打开前台/后台标签；
- 验证滚轮和摇杆；
- 验证设置导出和恢复；
- 强制终止 Service Worker 后再次执行命令；
- 验证所有 Vimium 原有 E2E 仍通过。

### 18.4 手工兼容性矩阵

至少覆盖：

```text
Windows + Chrome Stable
macOS + Chrome Stable
Linux + Chrome Stable
Windows + Edge Stable
```

典型站点：

```text
普通静态网页
GitHub
Gmail
Google Docs
Notion
YouTube
Reddit
在线代码编辑器
带跨域 iframe 的网页
长列表和无限滚动网页
```

对 Google Docs、在线编辑器等高冲突站点，允许通过默认站点规则关闭部分模块，但必须在矩阵中说明。

### 18.5 覆盖率要求

- 新增纯算法模块：行覆盖率不低于 90%；
- 新增配置和 Dispatcher：行覆盖率不低于 85%；
- 新增 UI 代码：关键保存、校验和导入流程必须有 E2E；
- 不以无意义测试追求数字；
- 所有修复的 bug 必须先新增可复现测试。

---

## 19. 分阶段施工计划

> Codex 每次只实施一个阶段。阶段验收未通过时不得进入下一阶段。

### Phase 0：仓库、许可证和基线

任务：

- [ ] 从 Vimium `v2.4.2` 创建项目分支；
- [ ] 运行并记录全部基线测试；
- [ ] 修改项目临时名称和说明，但不急于大规模替换内部 `Vimium` 命名；
- [ ] 添加 GPL 许可证；
- [ ] 保留 Vimium MIT 许可证；
- [ ] 创建 `THIRD_PARTY_NOTICES.md`；
- [ ] 创建 `PROJECT_CHARTER.md`；
- [ ] 创建 `PRIVACY.md`、`SECURITY.md`、`TRADEMARK.md`；
- [ ] 创建 `AGENTS.md` 和 `docs/codex-progress.md`；
- [ ] 创建 ADR-001 至 ADR-005；
- [ ] 去除或改造任何与上游品牌绑定的升级通知；
- [ ] 不改变键盘行为。

验收：

- 上游测试结果不低于基线；
- 扩展可手动加载；
- Options、帮助、链接提示和 Vomnibar 正常；
- 仓库包含完整许可证链；
- 没有新增权限和网络请求。

建议提交：

```text
chore: establish open source project baseline
```

### Phase 1：统一命令 Invocation 和 Dispatcher

任务：

- [ ] 定义 `CommandInvocation`、`CommandResult`；
- [ ] 建立消息协议；
- [ ] 建立现有 Vimium 命令适配器；
- [ ] 建立 page/background 路由；
- [ ] 先接入无副作用命令，例如滚动；
- [ ] 再接入标签页命令；
- [ ] 添加参数、URL、count 和 requestId 校验；
- [ ] 建立命令注册表供设置页读取；
- [ ] 不改变现有键盘默认绑定。

验收：

- 单元测试可通过 Dispatcher 执行滚动和标签页命令；
- 直接键盘命令行为不变；
- 未知命令和非法 URL 被拒绝；
- 危险命令具有重复上限；
- Service Worker 重启后 Dispatcher 可自恢复。

建议提交：

```text
feat: add unified command invocation and dispatcher
```

### Phase 2：基础鼠标轨迹引擎

任务：

- [ ] 实现状态机；
- [ ] 实现 path sampler；
- [ ] 实现四向量化；
- [ ] 实现 exact pattern matcher；
- [ ] 实现右键菜单保护；
- [ ] 实现 Escape 取消；
- [ ] 实现 Shadow DOM 轨迹层和 HUD；
- [ ] 首批接入 `goBack`、`goForward`、`reload`、滚动；
- [ ] 再接入关闭/恢复/切换标签页；
- [ ] 添加全部核心单元测试和 E2E。

验收：

- 普通右键菜单无回退；
- 默认手势可执行；
- 未识别手势不执行命令；
- 输入框和网页按钮仍正常；
- 100 次手势后无残留覆盖层和活动 Port；
- Vimium 全部原有测试继续通过。

建议提交：

```text
feat: add configurable mouse gesture engine
```

### Phase 3：设置模型和可视手势编辑器

任务：

- [ ] 扩展设置 schema；
- [ ] 实现 storage.sync/local 分层；
- [ ] 实现迁移与回滚；
- [ ] 扩展 Options 导航；
- [ ] 实现画手势和 pattern 预览；
- [ ] 实现命令选择、搜索和冲突校验；
- [ ] 实现恢复默认；
- [ ] 实现导入导出新格式；
- [ ] 实现 Vimium 备份导入；
- [ ] 增加无遥测与许可证页面。

验收：

- 保存后无需刷新即可生效；
- 冲突配置无法保存；
- 导入失败不改变现有配置；
- 大型本地图片不写入 sync；
- 配置导出稳定可 diff；
- 设置页仅使用本地资源。

建议提交：

```text
feat: add gesture settings and visual editor
```

### Phase 4：超级拖拽

任务：

- [ ] 实现拖拽上下文分类；
- [ ] 实现链接、文字、图片动作；
- [ ] 实现前台/后台打开；
- [ ] 实现复制文字和 URL；
- [ ] 实现搜索引擎选择；
- [ ] 实现原生拖拽旁路修饰键；
- [ ] 实现编辑器、文件上传和 draggable 组件保护；
- [ ] 实现按上下文独立绑定；
- [ ] 增加单元、DOM 和 E2E 测试。

验收：

- 文件上传不被破坏；
- 看板排序默认不被接管；
- 普通链接和选择文字拖拽正确；
- 非法 URL 不会打开；
- 密码输入不被读取；
- 搜索内容只发送给用户选择的搜索引擎。

建议提交：

```text
feat: add safe super drag actions
```

### Phase 5：滚轮、摇杆、标签列表和指针

任务：

- [ ] 实现滚轮组合与阈值；
- [ ] 实现摇杆状态机；
- [ ] 复用 Vomnibar 标签数据构建鼠标友好标签列表；
- [ ] 实现自定义指针本地存储和校验；
- [ ] 实现模块独立开关；
- [ ] 完成对应测试。

验收：

- 普通滚轮不被误拦；
- 触控板滚动不误触默认绑定；
- 普通左右点击不受影响；
- 标签列表支持键盘和鼠标；
- 指针资源不联网、不进 sync、可一键恢复。

建议提交：

```text
feat: add wheel rocker tab list and cursor features
```

### Phase 6：站点规则和跨 Frame 强化

任务：

- [ ] 实现模块级站点规则；
- [ ] 实现 Popup 当前站点控制；
- [ ] 以顶层 URL 统一决定状态；
- [ ] 实现短生命周期 Frame Port；
- [ ] 实现跨 Frame 方向协调；
- [ ] 增加 about:blank、srcdoc 和跨域 iframe 测试；
- [ ] 添加默认高冲突站点规则，并保持可删除。

验收：

- 当前站点可单独关闭键盘或鼠标；
- iframe 不绕过顶层禁用；
- 跨 Frame 手势不会重复执行；
- Service Worker 中断时安全取消；
- Popup 准确说明内置页面不可用原因。

建议提交：

```text
feat: add module site rules and frame coordination
```

### Phase 7：功能对齐、兼容性和无障碍

任务：

- [ ] 完成全部功能对照矩阵；
- [ ] 检查每个 Vimium 命令仍可用；
- [ ] 对 CrxMouse 公开功能逐项黑盒验证；
- [ ] 修复 Windows、macOS、Linux 差异；
- [ ] 修复 Chrome、Edge 差异；
- [ ] 完成键盘无障碍操作；
- [ ] 完成屏幕阅读器标签；
- [ ] 完成高对比度和缩放测试；
- [ ] 审计权限、网络、CSP 和第三方许可证。

验收：

- 矩阵不存在未解释的 TODO；
- 所有浏览器限制有明确文案；
- 新 UI 可全键盘操作；
- 没有远程代码和遥测；
- 没有未经 ADR 的权限。

建议提交：

```text
fix: complete feature parity and compatibility hardening
```

### Phase 8：发布工程

任务：

- [ ] 使用 `0.x` 版本完成预发布；
- [ ] 建立可复现构建；
- [ ] 生成 store zip；
- [ ] 生成 source archive；
- [ ] 生成 SHA-256；
- [ ] 创建完整 CHANGELOG；
- [ ] 更新隐私政策；
- [ ] 审查商店截图和文案；
- [ ] 明确披露 `<all_urls>`；
- [ ] 明确披露内置页面限制；
- [ ] 完成发布检查表；
- [ ] 建立上游 Vimium 更新流程。

验收：

- 全部自动测试通过；
- 全部手工发布检查通过；
- 源码与商店包对应；
- 商店包不含测试密钥、调试日志、个人路径或未使用资源；
- 官方版本没有付费入口、广告、账户和遥测。

建议提交：

```text
chore: prepare reproducible open source release
```

---

## 20. CI 与代码质量

CI 至少执行：

```bash
deno fmt --check
./make.js test
deno test -A tests/open_key_mouse/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
```

建议检查：

- Manifest JSON 合法；
- 没有新增危险权限；
- 没有远程脚本；
- 许可证头；
- 导出配置 schema；
- store zip 中没有源码之外的秘密；
- 构建产物可从干净 checkout 重现。

代码规范：

- 保持上游 100 字符行宽；
- 使用 `deno fmt`；
- 函数职责单一；
- 高风险分支明确错误处理；
- 不使用空 catch；
- 不在生产代码留下选中文字、URL 或鼠标点日志；
- 新纯逻辑优先写无 DOM 的可测试函数；
- 对难懂状态机写状态转换注释，不写重复代码含义的废话注释。

---

## 21. 版本和上游同步策略

### 21.1 版本

```text
0.1.0  基线和命令适配
0.2.0  基础鼠标手势
0.3.0  设置与编辑器
0.4.0  超级拖拽
0.5.0  滚轮、摇杆、标签列表和指针
0.6.0  站点规则与 Frame 强化
0.9.0  功能对齐预发布
1.0.0  第一版稳定发行
```

版本号是功能状态，不代表商业套餐。

### 21.2 上游同步

保留：

```text
upstream = philc/vimium
origin   = 用户自己的 OpenKeyMouse 仓库
```

每次上游同步：

1. 获取新标签；
2. 阅读 Vimium CHANGELOG；
3. 建立专用分支；
4. 先运行旧基线；
5. 合并上游；
6. 解决冲突时优先保留上游键盘修复；
7. 运行全部键盘和鼠标测试；
8. 更新 `THIRD_PARTY_NOTICES.md` 和基线记录；
9. 不在同一个提交中顺便重构鼠标模块。

---

## 22. 第一版发布验收标准

只有全部满足才可标记 1.0：

### 功能

- [ ] Vimium `v2.4.2` 的全部既有命令没有已知功能回退；
- [ ] 键盘映射、数字重复、模式、链接提示、Vomnibar、查找、Visual、Marks 正常；
- [ ] 四向鼠标手势可配置；
- [ ] 八向模式可选；
- [ ] 普通右键菜单正常；
- [ ] 轨迹、HUD、取消和未识别反馈正常；
- [ ] 超级拖拽支持链接、文字和图片；
- [ ] 滚轮和摇杆手势正常；
- [ ] 标签页列表正常；
- [ ] 自定义指针正常且完全本地；
- [ ] 站点规则可分别控制各模块；
- [ ] 设置导入导出和 Vimium 迁移正常；
- [ ] 全部动作使用统一命令注册表。

### 安全与隐私

- [ ] 无遥测；
- [ ] 无项目服务器请求；
- [ ] 无远程代码；
- [ ] 无 `eval` 和 `new Function`；
- [ ] 无账号；
- [ ] 无广告；
- [ ] 无付费入口；
- [ ] 无多余权限；
- [ ] 消息经过 schema 和 sender 校验；
- [ ] 非法 URL 协议被拒绝；
- [ ] 导入配置不会执行 HTML 或脚本；
- [ ] 自定义资源不上传。

### 质量

- [ ] 上游测试全部通过或失败项有明确上游基线证明；
- [ ] 新算法覆盖率达标；
- [ ] E2E 覆盖核心手势；
- [ ] Service Worker 终止测试通过；
- [ ] Windows、macOS、Linux 基本测试完成；
- [ ] Chrome 和 Edge 基本测试完成；
- [ ] 功能矩阵没有未解释 TODO；
- [ ] 所有已知浏览器限制已写进帮助与商店说明。

### 开源

- [ ] GPL 许可证存在；
- [ ] Vimium MIT 许可证和版权存在；
- [ ] 第三方通知完整；
- [ ] 官方发布源码与二进制对应；
- [ ] 项目章程明确永久免费和无商业版；
- [ ] 所有官方功能都在公开仓库。

---

## 23. 已知浏览器硬限制

以下情况属于平台限制，不应伪装为可解决的普通 bug：

- `chrome://` 页面通常无法注入内容脚本；
- Chrome Web Store 页面无法正常注入；
- 浏览器地址栏和顶部标签栏不是网页 DOM；
- 浏览器开发者工具不是普通网页；
- 部分内置 PDF 页面受限；
- Canvas/WebGL 内部控件无法通过 DOM 链接提示识别；
- 跨域 iframe 的轨迹覆盖层难以无缝拼接；
- 用户未允许“访问文件网址”时，`file://` 页面无法运行；
- 隐身模式需要用户主动允许扩展；
- 网页可能自己禁止右键或拖放，扩展不保证恢复网页已破坏的原生行为；
- 原生 Ctrl+T 新标签页是否可控取决于是否声明 new tab override，第一版不偷偷接管。

UI 需显示“受浏览器限制”，而不是无提示失效。

---

## 24. 主要风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 一次性重构 Vimium | 大量键盘回退 | 固定上游标签，小步适配，不首版迁移框架 |
| 右键菜单冲突 | 用户无法正常浏览 | PENDING 阶段不拦截，越过阈值后才激活 |
| 超级拖拽破坏网页应用 | 排序、上传失效 | 分类器、旁路修饰键、站点规则、默认排除 |
| 跨 Frame 重复执行 | 关闭多个标签页 | tabId 活动会话、requestId 去重、短 Port |
| Service Worker 被终止 | 状态丢失 | 重要数据持久化，活动手势安全取消 |
| sync 配额超限 | 设置保存失败 | 小配置进 sync，大对象进 local，大小校验 |
| 功能列表失控 | 项目不可维护 | 单一用途、命令注册表、功能矩阵、阶段验收 |
| 权限过多导致审核风险 | 商店拒绝或用户不信任 | 权限审计、ADR、禁止默认危险权限 |
| 闭源代码侵权 | 法律和下架风险 | clean-room 独立实现，不解包、不复制资产 |
| 第三方冒充官方收费 | 用户混淆 | GPL + 商标政策 + 官方免费声明 |
| Codex 宣称完成但未测试 | 隐藏缺陷 | progress 日志、强制测试命令、DoD |
| 上游更新难合并 | 安全修复落后 | 避免无意义格式化和大规模改名，保留 upstream |

---

## 25. Codex 每轮输出格式

Codex 每完成一轮工作，必须输出：

```markdown
## 本轮完成

- 阶段：
- 任务：
- 修改文件：
- 核心设计：

## 验证

- 执行命令：
- 通过：
- 失败：
- 未执行及原因：

## 风险与遗留

- 已知问题：
- 是否影响进入下一阶段：

## Git

- 分支：
- 提交：
- 工作区是否干净：

## 下一步

- 仅列下一阶段的第一个可执行任务。
```

禁止只输出“已完成”“应该可以”或未附测试结果的结论。

---

## 26. 可直接粘贴给 Codex 的启动提示词

```text
你正在维护一个 Chrome Manifest V3 浏览器扩展项目，目标是把 Vimium 的全部键盘导航能力与独立实现的鼠标手势、超级拖拽、滚轮手势和摇杆手势整合到同一个扩展中。

请先完整阅读仓库中的《OpenKeyMouse 可执行开发设计文档（Codex 实施版）》以及 AGENTS.md。

不可违反的要求：
1. 项目永久开源且全部功能免费，不设计商业版、付费版、订阅、广告、账户或功能锁。
2. 无遥测，不上传 URL、历史、页面内容、按键、选择文字或鼠标轨迹。
3. 不加载远程代码。
4. 以 Vimium v2.4.2 / commit eb737ab 为基线，不从零重写，不删除现有功能。
5. 保留 Vimium MIT 许可证和版权；项目新增代码按 GPL-3.0-or-later。
6. 不解包、复制或改写 CrxMouse 的闭源代码和资产，只做 clean-room 等价实现。
7. 不一次性实现全部功能，只执行文档中的 Phase 0。
8. 修改前先运行并记录基线测试。
9. 每个任务必须有测试；未运行测试不得声称完成。
10. 不新增权限或依赖，除非先写 ADR 并证明必要性。

现在执行以下工作：
- 检查当前 Git 状态和上游基线；
- 运行 Phase 0 要求的基线测试；
- 创建 docs/baseline.md 和 docs/codex-progress.md；
- 创建许可证、项目章程、隐私、安全、商标、第三方通知和 ADR 文件；
- 不改变键盘行为；
- 完成后按文档规定的“Codex 每轮输出格式”报告结果；
- 保持工作区可审查，使用一个清晰提交完成本阶段。
```

完成 Phase 0 后，下一次给 Codex 的指令只需是：

```text
读取最新 docs/codex-progress.md，确认 Phase 0 的验收结果，然后只实施设计文档中的 Phase 1。不得提前实施 Phase 2。
```

---

## 27. 参考资料

### Vimium

- 项目仓库：<https://github.com/philc/vimium>
- `v2.4.2` 标签：<https://github.com/philc/vimium/releases/tag/v2.4.2>
- 命令列表：<https://vimium.github.io/commands/>
- Manifest：<https://github.com/philc/vimium/blob/master/manifest.json>
- MIT License：<https://github.com/philc/vimium/blob/master/MIT-LICENSE.txt>
- 贡献与源码安装：<https://github.com/philc/vimium/blob/master/CONTRIBUTING.md>

### Chrome Extensions 官方文档

- Manifest V3：<https://developer.chrome.com/docs/extensions/develop/migrate/what-is-mv3>
- Service Worker：<https://developer.chrome.com/docs/extensions/develop/concepts/service-workers>
- Content Scripts：<https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>
- Storage API：<https://developer.chrome.com/docs/extensions/reference/api/storage>
- Content Script Manifest：<https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts>
- Web Store Policies：<https://developer.chrome.com/docs/webstore/program-policies/policies>
- Manifest V3 Additional Requirements：<https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements>
- Service Worker 终止测试：<https://developer.chrome.com/docs/extensions/how-to/test/test-serviceworker-termination-with-puppeteer>

### CrxMouse 公开功能参考

- Chrome Web Store：<https://chromewebstore.google.com/detail/crxmouse-mouse-gestures/jlgkpaicikihijadgifklkbpdajbkhjo>
- 官网：<https://crxmouse.com/>

---

## 28. 最终施工原则

本项目不应被实现成“把两个扩展的代码粗暴拼在一起”，而应实现成：

> 一个以 Vimium 成熟键盘能力为基线、以统一命令系统为核心、所有鼠标能力独立实现、本地优先、零遥测、永久免费且可持续维护的开源浏览器导航扩展。

Codex 的首要目标不是最快写出最多代码，而是：

1. 保住 Vimium 的成熟行为；
2. 建立统一命令边界；
3. 用可测试的状态机实现鼠标输入；
4. 不破坏原生浏览器与网页交互；
5. 让每个阶段都可以运行、验证和回滚；
6. 保证官方版本始终完整、免费和开源。
