# 第三方代码与资源声明

本文件记录当前仓库已确认的第三方来源。发布前必须根据最终 checkout、构建脚本和打包内容重新核对。

## Vimium v2.4.2

- 来源：<https://github.com/philc/vimium>
- 固定标签：v2.4.2
- 固定提交：eb737abd
- 许可证：MIT
- 许可证原文：LICENSES/MIT-Vimium.txt
- 原始版权：Phil Crosby、Ilya Sukhar
- 范围：本仓库从 Vimium 保留或修改的代码、页面、图标和测试资产，继续受其原始 MIT
  许可证和版权声明约束。

## shoulda.js

- 来源：<https://github.com/philc/shoulda.js>
- 用途：tests/vendor/shoulda.js 的测试框架
- 许可证：MIT
- 许可证原文：LICENSES/MIT-shoulda.txt
- 版权：Phil Crosby，2023
- 该依赖只用于测试，不进入扩展运行时功能。

## 仅开发/测试使用的包

make.js 和 deno.json 使用 Deno、Drake、Puppeteer、jsdom、json5、deno-dom 及 Deno
标准模块完成构建和测试。这些包不是本扩展的业务运行时依赖；它们的版本与许可证必须在发布构建时从锁文件和实际打包清单重新核对，不能把开发环境下载物当作扩展资产。

## 项目自有内容

OpenKeyMouse 新增的项目文档、治理文件和未来新增代码，除另有明确声明外，按根目录 LICENSE 的
GPL-3.0-or-later 发行。没有从 CrxMouse 复制代码、图片、图标、文案或设置界面。
