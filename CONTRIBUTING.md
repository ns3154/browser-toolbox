# 参与浏览器工具箱开发

## 问题反馈

请在[本项目 Issues](https://github.com/ns3154/browser-toolbox/issues)提交问题或功能建议。
复现步骤中写清扩展版本、浏览器与操作系统版本、实际结果和预期结果；截图或日志请先移除个人信息。
安全漏洞请按 [SECURITY.md](SECURITY.md) 中的方式反馈。

## 修改范围

浏览器工具箱基于 Vimium，保留其键盘导航和 MIT 版权链。修改时应：

- 保留既有键盘行为和网页原生输入；为真实故障提供可重复的用例。
- 使用现有命令、设置和工具注册表，避免同一功能出现多套入口逻辑。
- 新增代码注释使用中文，单次修改保持范围清楚。
- 不加入遥测、远程代码或未经评估的权限、依赖和网络行为。
- 保留来源文件的版权和许可证；全新功能遵循本项目的 GPL-3.0-or-later 许可边界。

开发过程中的设计、截图、日志和验收记录放在被 Git 忽略的 `local-development/`，不得提交或打包。
公开文档只保留用户或贡献者需要的稳定说明。开始修改前请阅读 [AGENTS.md](AGENTS.md)。

## 本地准备

1. 安装 [Deno](https://deno.com/)。
2. 准备完整的 Google Chrome for Testing；可用下列命令安装测试浏览器：

   ```sh
   deno run -A npm:puppeteer browsers install chrome
   ```

3. 如自动发现的浏览器不完整或版本不合适，设置 `PUPPETEER_EXECUTABLE_PATH` 指向 Chrome for Testing
   的可执行文件。
4. 在隔离的浏览器 profile 中加载扩展，避免改动日常浏览器配置和个人数据。

## 检查与测试

完整检查入口：

```sh
./make.js verify
```

它运行单元和 DOM 测试、适配测试、本地化校验、权限/网络/技术标识审计、性能检查、临时构建内容校验，
以及浏览器核心功能和快捷工具两套 E2E。失败会返回非零退出码。

需要保存机器可读的结果时：

```sh
deno run -A scripts/verify.js --report local-development/tracking/verify-result.json
```

开发中可以运行 `./make.js test` 检查单元和 DOM，或使用 `deno run -A scripts/verify.js --skip-e2e`
执行不含 E2E 的检查。跳过的项目会标记为 `SKIP`，
不能据此声称完整验收通过。格式检查仅针对本次修改的文件运行 `deno fmt --check <文件路径>`。

自动化通过后，还须将当前构建装入独立 profile 的 headed Google Chrome for Testing，
实际检查修改的交互，并记录浏览器版本、加载目录、操作步骤、结果与未覆盖范围。
自动化不能替代跨平台人工、屏幕阅读器或登录态站点验收。

## 构建

两条命令使用同一个构建实现：

```sh
./make.js package
```

```sh
deno run -A scripts/build_release.js --package
```

产物用途如下，其中 `<版本>` 来自 `manifest.json`：

| 产物                                                        | 用途                                 |
| ----------------------------------------------------------- | ------------------------------------ |
| `dist/browser-toolbox/`                                     | 在扩展管理页中“加载已解压的扩展程序” |
| `dist/chrome-store/browser-toolbox-chrome-store-<版本>.zip` | Chrome 商店包                        |
| `dist/chrome-canary/browser-toolbox-canary-<版本>.zip`      | Chrome Canary 开发包                 |
| `dist/firefox/browser-toolbox-firefox-<版本>.zip`           | Firefox 包                           |
| `dist/browser-toolbox-source-<版本>.zip`                    | 源码包                               |
| `dist/artifacts.json`                                       | 产物校验报告                         |

`deno run -A scripts/build_release.js` 默认只执行静态发布检查。构建成功或生成 Firefox 包，
均不代表浏览器兼容性、人工验收或商店审核已通过；提交发布前须查看完整检查结果和实际验收记录。

## 提交说明

说明具体问题、修改后的行为、复现和验证方法，以及仍待验证的范围。面向本项目提交 PR，
不要把浏览器工具箱特有问题转交给 Vimium 上游。不得提交凭证、个人 profile、测试缓存或本机过程资料。
