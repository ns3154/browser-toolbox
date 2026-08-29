# Browser Toolbox

English is the default language for this README. See the [Chinese section](#浏览器工具箱) below.

Browser Toolbox is a free, open-source, local-first browser toolbox for keyboard and mouse workflows.
It brings keyboard navigation, page actions, search, tab and window control, configurable mouse input,
site rules, and local settings into one Chrome extension.

The project is based on the keyboard-navigation foundation of Vimium v2.4.2, but Browser Toolbox is an
independent project and is not affiliated with Vimium.

## Highlights

- Keyboard navigation for pages, links, forms, scrolling, find mode, visual mode, marks, and frames.
- Vomnibar workflows for URLs, bookmarks, open tabs, history, and user-selected search engines.
- Tab and window commands, including tab search, duplication, movement, pinning, and closed-tab restore.
- Optional mouse workflows: configurable trails, gestures, super drag, wheel gestures, and rocker gestures.
- Site rules that can enable or disable individual modules on selected sites.
- Local custom pointers, settings import/export, migration from compatible Vimium settings, and English/
  Simplified Chinese localization.
- Packaged extension pages with a self-only Content Security Policy and no remote runtime code.

## Privacy and security

Browser Toolbox is designed to process data in the browser. It has no accounts, ads, subscriptions, paid
features, telemetry, project server, or remote JavaScript. It does not upload URLs, browsing history, page
content, selected text, keyboard input, search queries, mouse trails, or pointer resources.

Search queries are sent to the search engine only when the user explicitly starts a search. Browser
permissions are used for the corresponding user-invoked tab, bookmark, history, session, page-action, and
mouse-workflow features. The extension does not request cookies, identity, web requests, native messaging,
debugger, proxy, or geolocation access.

Read the full [privacy policy](PRIVACY.md), [security policy](SECURITY.md), and [permission guide](docs/permissions.md).

## Install

### Chrome Web Store

Version 0.1.0 has been submitted to the Chrome Web Store and is currently under review. It is not yet
available as a public store installation. Once the review is complete, the store listing will be the
recommended installation path.

### From source

1. Clone this repository.
2. Open chrome://extensions in Chrome or Chromium.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the repository directory.
5. Open the extension's options page to configure keyboard and mouse workflows.

Chrome controls access to built-in pages such as chrome:// and the Web Store. Browser Toolbox does not
attempt to bypass those platform restrictions.

## Quick start

The inherited keyboard navigation keeps familiar Vimium-style defaults:

| Key | Action |
| --- | --- |
| ? | Open the help dialog |
| j / k | Scroll down / up |
| f / F | Show link hints in the current / a new tab |
| o / O | Open the Vomnibar in the current / a new tab |
| T | Search open tabs |
| x / X | Close / restore a tab |
| H / L | Go back / forward |

Use ? inside the extension to view the complete command list and customized bindings.

## Development

The project uses JavaScript and [Deno](https://deno.com/). The main development commands are:

~~~sh
./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
~~~

The current verification record, release gates, manual acceptance scope, and known limitations are kept in
the [release checklist](docs/release-checklist.md), [feature matrix](docs/feature-parity-matrix.md), and
[manual acceptance guide](docs/manual-acceptance.md). Automated and isolated-browser evidence must not be
read as a completed cross-platform manual matrix. Linux manual handling is intentionally deferred for now.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development conventions and source installation details.

## Documentation

- [Project charter](PROJECT_CHARTER.md)
- [Design document](BrowserToolbox_Codex_可执行开发设计文档.md)
- [Privacy policy](PRIVACY.md)
- [Security policy](SECURITY.md)
- [Permission guide](docs/permissions.md)
- [Feature matrix](docs/feature-parity-matrix.md)
- [Release checklist](docs/release-checklist.md)
- [Manual acceptance guide](docs/manual-acceptance.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Changelog](CHANGELOG.md)

## Contributing and security reports

Bug reports and feature proposals are welcome. Do not include passwords, cookies, authentication data,
private browsing history, personal data, or access tokens in public issues. Please read
[SECURITY.md](SECURITY.md) before reporting a security concern.

## License

New Browser Toolbox code is released under [GPL-3.0-or-later](LICENSE). Vimium and shoulda.js code and
notices retain their original MIT licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and the
files under LICENSES/ for the license boundary.

---

# 浏览器工具箱

浏览器工具箱是一个免费、开源、本地优先的浏览器工作流工具箱，面向键盘和鼠标操作。它把键盘导航、页面操作、
搜索、标签页与窗口控制、可配置鼠标输入、站点规则和本地设置整合在同一个 Chrome 扩展中。

本项目基于 Vimium v2.4.2 的键盘导航基础，但浏览器工具箱是独立项目，与 Vimium 官方没有隶属或关联关系。

## 主要功能

- 页面、链接、表单、滚动、查找、Visual、Marks 和 frame 的键盘导航。
- 使用 Vomnibar 操作网址、书签、已打开标签页、历史记录和用户选择的搜索引擎。
- 标签页与窗口管理，包括标签搜索、复制、移动、固定和恢复最近关闭的标签页。
- 可选鼠标模块，包括可配置轨迹、手势、超级拖拽、滚轮和摇杆手势。
- 可按站点启用或停用单独模块的站点规则。
- 本地自定义指针、设置导入导出、兼容的 Vimium 设置迁移，以及英文/简体中文界面。
- 扩展页面使用仅允许自身脚本的 Content Security Policy，不加载运行时远程代码。

## 隐私与安全

浏览器工具箱在浏览器本地处理功能所需数据，不提供账户、广告、订阅、付费功能、遥测、项目服务器或远程
JavaScript，也不会上传网址、浏览历史、页面内容、选中文字、键盘输入、搜索词、鼠标轨迹或指针资源。

只有在用户主动发起搜索时，搜索词才会发送给用户选择的搜索引擎。浏览器权限仅用于用户主动调用的标签页、
书签、历史、会话、页面操作和鼠标工作流功能。扩展不申请 cookies、identity、webRequest、nativeMessaging、
debugger、proxy 或 geolocation 权限。

详见[隐私说明](PRIVACY.md)、[安全政策](SECURITY.md)和[权限说明](docs/permissions.md)。

## 安装

### Chrome 应用商店

0.1.0 版本已经提交 Chrome 应用商店审核，目前处于审核中，暂时不能从公开商店安装。审核完成后，商店页面将作为
推荐安装方式。

### 从源码安装

1. 克隆本仓库。
2. 在 Chrome 或 Chromium 中打开 chrome://extensions。
3. 开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本仓库目录。
5. 打开扩展的设置页，配置键盘和鼠标工作流。

Chrome 会限制扩展访问 chrome:// 和应用商店等浏览器内置页面。浏览器工具箱不会尝试绕过这些平台限制。

## 快速开始

继承的键盘导航保留了熟悉的 Vimium 风格默认按键：

| 按键 | 操作 |
| --- | --- |
| ? | 打开帮助弹窗 |
| j / k | 向下 / 向上滚动 |
| f / F | 在当前标签页 / 新标签页显示链接提示 |
| o / O | 在当前标签页 / 新标签页打开 Vomnibar |
| T | 搜索已打开的标签页 |
| x / X | 关闭 / 恢复标签页 |
| H / L | 后退 / 前进 |

在扩展中按 ? 可以查看完整命令列表和自定义按键。

## 开发

项目使用 JavaScript 和 [Deno](https://deno.com/)。主要开发命令如下：

~~~sh
./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
~~~

当前验证记录、发布门禁、人工验收范围和已知限制见[发布检查表](docs/release-checklist.md)、[功能对照矩阵](docs/feature-parity-matrix.md)
和[人工验收清单](docs/manual-acceptance.md)。自动化和隔离浏览器证据不等于跨平台人工矩阵已完成；Linux 人工处理暂缓。

开发约定和源码安装细节见[贡献指南](CONTRIBUTING.md)。

## 文档

- [项目章程](PROJECT_CHARTER.md)
- [设计文档](BrowserToolbox_Codex_可执行开发设计文档.md)
- [隐私说明](PRIVACY.md)
- [安全政策](SECURITY.md)
- [权限说明](docs/permissions.md)
- [功能对照矩阵](docs/feature-parity-matrix.md)
- [发布检查表](docs/release-checklist.md)
- [人工验收清单](docs/manual-acceptance.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)
- [更新日志](CHANGELOG.md)

## 贡献与安全报告

欢迎提交问题和功能建议。不要在公开 issue 中提交密码、Cookie、认证数据、私密浏览历史、个人资料或访问令牌。
报告安全问题前请先阅读[安全政策](SECURITY.md)。

## 许可证

新增的浏览器工具箱代码使用 [GPL-3.0-or-later](LICENSE) 发布。Vimium 和 shoulda.js 的代码及声明继续保留原有
MIT 许可证。许可证边界见[第三方声明](THIRD_PARTY_NOTICES.md)和 LICENSES/ 目录。
