# Codex 阶段进度

本文件按设计文档规定追加。每个条目必须只记录已经实际执行的命令和结果；未验证内容不得写成完成。

## 2026-08-30 / README 双语入口与提交前发布门禁 / E-148

- 授权与范围：用户明确授权提交当前鼠标手势、HUD、八方向、箭头配置和国际化修改并推送远端，同时要求
  README 默认英文并支持中文。没有修改权限、依赖、网络行为、遥测或发布版本号；根目录 `.DS_Store`
  继续排除，不提交测试 profile、Cookie、Token 或浏览数据。
- README 国际化：`README.md` 现在只承载默认英文使用说明，新增 `README.zh-CN.md`
  承载同版简体中文说明；两份文件顶部通过 `English | 简体中文`
  相互切换。两版均覆盖源码安装、快速开始、常用键盘操作、八方向默认鼠标手势、超级拖拽、滚轮/摇杆和设置入口，不把开发审计信息混入用户使用说明。
- 分支与远端：当前仓库为公开仓库 `ns3154/browser-toolbox`，远端默认分支为 `main`，本地基线与
  `origin/main` 同为 `c3ec01d3e3c5471ba4ea368100caef472f33b6e2`。按发布规则从该基线创建
  `feat/mouse-gestures-i18n`，不直接向默认分支写入；GitHub CLI 已确认账号 `ns3154` 登录有效。
- 提交前门禁：相关 `deno fmt --check`、`deno check` 与 `git diff --check` 均退出码
  0；`PUPPETEER_EXECUTABLE_PATH="/Users/yang/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test`
  退出码 0，单元 450/450、DOM 111/111；`deno test -A tests/browser_toolbox/` 退出码
  0，BrowserToolbox shoulda 198/198。权限、网络行为和技术标识审计均退出码 0，仍为 9 项权限、34
  个新增模块文件；`./make.js package` 退出码 0，归档为 current。
- 完整 E2E：使用 CFT `152.0.7977.64` 对当前 `dist/browser-toolbox` 完整重跑，退出码
  0；Vomnibar、标签页列表、设置导入导出、站点规则、右键菜单状态机、HUD
  国际化、八方向手势、超级拖拽、滚轮、摇杆、跨 frame、fixtures 和 Service Worker 重启均继续通过。
- 可见安装：最新构建已通过 `Extensions.loadUnpacked` 加载到 headed CFT `152.0.7977.64` 的独立
  profile `/tmp/browser-toolbox-cft152-push-profile-20260830.7NVVN0`，加载目录
  `/Users/yang/project/plugin/browser-toolbox/dist/browser-toolbox`，扩展 ID
  `nalfnhojdelfpccjnfnbcoedeenocdek`。副屏保留设置页与
  `http://127.0.0.1:8766/browser-toolbox-hud-test-page.html`；隔离运行态为
  `initialized = true`、`locale = zh_CN`、`triggerButton = 2`、`directionMode = 8-way`、15 条绑定。
- 风险边界：这是当前 checkout 在 macOS CFT 隔离 profile 的自动化与可见证据，不等于
  Windows/Edge、Chrome Stable、屏幕阅读器、认证态站点或完整 Vimium 人工矩阵通过。
- 当前状态：功能分支已创建，尚未提交或推送；下一步按精确文件清单暂存并推送该分支。
- 对应提交：待本轮提交。

## 2026-08-30 / 网页右键手势 HUD 国际化同步 / E-147

- 授权与范围：修复普通网站内右键手势 HUD
  未跟随浏览器工具箱语言设置的问题；没有改变既有右键菜单状态机、默认手势、键盘行为或 UI
  样式，没有新增权限、依赖、网络请求、遥测或远程代码，也没有提交、推送或发布。
- 根因与修复：设置页会调用
  `BrowserToolboxI18n.setLocale`，但每个网页内容脚本运行在独立的隔离世界里，原先只读取了有效设置，没有把
  `general.language` 应用给自身的国际化实例，所以 HUD
  实际退回浏览器界面语言。`settings_runtime_client.js` 现在在初次加载和每次
  `browserToolbox.settingsChanged` 热更新后统一同步 `auto`、`en` 或
  `zh_CN`，网页无需刷新即可更新方向读屏名、命令标题、取消和未识别文案。
- 自动化结果：首次 `./make.js test` 的单元测试 450/450 通过，DOM 阶段因 Puppeteer 缓存的 CFT 131
  缺少 Framework 文件而无法启动，不计为产品失败或通过；改用完整 CFT 152 后同一命令退出码 0，单元
  450/450、DOM 111/111。`deno test -A tests/browser_toolbox/` 退出码 0，BrowserToolbox shoulda
  198/198。新增单元测试覆盖中文初始加载和运行时热切换英文。
- 真实网页
  E2E：`PUPPETEER_EXECUTABLE_PATH="/Users/yang/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run -A scripts/e2e_browser_toolbox.js`
  最终退出码 0。右键手势实际断言简体中文
  `向右 / 回到顶部 / 取消`，随后在网页不刷新的情况下切换英文并断言
  `Right / Scroll to top / Cancel`；既有右键菜单、HUD
  时机、Vomnibar、标签列表、超级拖拽、滚轮/摇杆、跨 frame、设置迁移、fixtures 和 Service Worker
  重启继续通过。此前一次运行中产品实际返回
  `向右`，测试却用数组引用相等比较两个相同数组而失败；修正测试断言后完整重跑通过。
- 格式、审计与构建：`deno fmt --check` 首次发现 E2E 新断言需要格式化，执行
  `deno fmt scripts/e2e_browser_toolbox.js` 后，相关 `deno fmt --check`、`deno check` 和
  `git diff --check` 均退出码 0。权限、网络行为和技术标识三项审计均退出码 0；权限仍为 9
  项，网络审计仍扫描 34 个新增模块文件。`./make.js package` 退出码 0，最新 `dist/browser-toolbox`
  与浏览器归档已生成。
- 可见验收：Codex 内置浏览器不能加载当前 checkout 的扩展内容脚本，故按项目门禁使用 headed Google
  Chrome for Testing `152.0.7977.64`。独立 profile 为
  `/tmp/browser-toolbox-cft152-i18n-profile-20260830.jYTBzX`，加载目录为
  `/Users/yang/project/plugin/browser-toolbox/dist/browser-toolbox`，扩展 ID 为
  `nalfnhojdelfpccjnfnbcoedeenocdek`；窗口位于副屏，设置页和
  `http://127.0.0.1:8766/browser-toolbox-hud-test-page.html` 保持打开供用户测试。最终运行态为
  `language = zh_CN`、内容脚本 `locale = zh_CN`、`triggerButton = 2`。
- 截图证据：同一普通网页不刷新完成中文到英文热切换；中文截图实际显示 `向上 / 向下` 方向语义、`刷新`
  和 `取消`，英文截图实际显示 `Up / Down`、`Refresh` 和 `Cancel`。文件分别为
  `/Users/yang/.codex/visualizations/2026/08/29/01a04dfe-74c5-7442-8210-1b28105508b2/browser-toolbox-hud-i18n-zh-cn.png`
  与 `browser-toolbox-hud-i18n-en.png`。
- 风险边界：这是当前 checkout 在 macOS CFT 独立 profile 的自动化与可见证据，不等于
  Windows/Edge、Chrome Stable、屏幕阅读器、认证态站点或完整 Vimium 人工矩阵通过。
- 当前状态：HEAD 仍为
  `c3ec01d3e3c5471ba4ea368100caef472f33b6e2`；共享工作区保留本轮及此前未提交修改，根目录 `.DS_Store`
  未跟踪。
- 对应提交：无。

## 2026-08-30 / 参考默认手势、八方向识别与箭头配置 / E-146

- 授权与范围：按用户提供的参考图复现手势配置语义，不复制参考扩展的闭源代码、图片、图标、文案或设置界面；追加“配置时只显示箭头，不显示方向字母”的要求。没有新增权限、依赖、网络请求、遥测或远程代码，没有覆盖用户已有自定义绑定，没有提交、推送或发布。
- 默认配置：新安装和“恢复默认”现在使用八方向模式，共 15
  组绑定：后退、前进、上下翻页、关闭/恢复标签页、页面底部/顶部、刷新/强制刷新、前后标签页、新建/关闭窗口和打开浏览器工具箱设置。新增
  `scrollFullPageDown` 默认绑定与 `BrowserToolbox.openSettings` 后台命令，关闭窗口轨迹校正为
  `U>R>D`，设置轨迹为 `R>D>L>U`；设置命令只打开本项目 `pages/mouse_options.html`。
- 八方向实现：保留四方向可选项，默认改为八方向；`UL`、`UR`、`DL`、`DR`
  均可作为独立单段方向。修正原先跨扇区不会实际生效的转向迟滞：越过 22.5°
  普通边界后按配置继续保持上一方向，并把迟滞上限限制在半扇区以内，确保光标到达相邻方向中心时一定完成转向。
- 箭头配置：设置页、画布预览、鼠标手势和超级拖拽绑定统一显示
  `↑`、`↓`、`←`、`→`、`↖`、`↗`、`↙`、`↘`，多段轨迹以 `·` 分隔；输入框仍可编辑。旧 `L>R`
  文本、既有存储、导入导出和消息协议继续兼容，界面失焦后规范化为 `← · →`，保存时仍写入稳定方向
  token。每个箭头输入同步保留内部 token 数据属性和本地化无障碍名称。
- 自动化结果：`PUPPETEER_EXECUTABLE_PATH="/Users/yang/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test`
  退出码 0，单元 449/449、DOM 111/111；`deno test -A tests/browser_toolbox/` 退出码
  0，BrowserToolbox shoulda 197/197。最终完整 E2E 退出码 0，实际覆盖 15 条恢复默认值、`R>D>L>U`
  打开本项目设置页、`UL`/`UR` 斜向命令、旧字母输入转箭头、内部 token
  保留，以及既有右键菜单、HUD、Vomnibar、标签列表、超级拖拽、滚轮/摇杆、跨 frame、设置迁移和 Service
  Worker 重启。此前一次 E2E 在未重新打包时按预期发现旧 `dist`
  仍为四方向，一次因测试脚本对内容相同的数组使用引用相等而失败，均修正测试前提后重跑；另一次在无关
  Vomnibar 等待处偶发超时，最终同一完整命令已通过。
- 审计与构建：`deno fmt`/`deno check`、`git diff --check`、权限审计、网络审计和技术标识审计均退出码
  0；权限仍为 9 项，网络审计扫描 34 个新增模块文件。`./make.js package` 退出码 0，最新
  `dist/browser-toolbox` 和浏览器归档已生成。
- 可见验收：Codex 内置浏览器因安全策略不能打开 `chrome-extension://`
  页面，故按项目门禁改用无个人资料的 headed Google Chrome for Testing。最终 CFT `145.0.7632.6`
  使用独立 profile `/tmp/browser-toolbox-cft145-arrow-profile-20260830.eBX7dC`，加载目录
  `/Users/yang/project/plugin/browser-toolbox/dist/browser-toolbox`，扩展 ID
  `nalfnhojdelfpccjnfnbcoedeenocdek`；设置页和本地 HUD 验收页在副屏保持打开。新 profile 运行态读到
  `directionMode = 8-way`、15 条存储/渲染绑定；所有可见值均为箭头，旧 `L>UR` 预览/新增行显示 `← · ↗`
  且内部仍为 `L>UR`，控制台无 error/warn。1500×900 桌面全页与 480×800 窄屏截图分别保存到
  `/Users/yang/.codex/visualizations/2026/08/29/01a04dfe-74c5-7442-8210-1b28105508b2/browser-toolbox-arrow-bindings-desktop.png`
  和 `browser-toolbox-arrow-bindings-mobile.png`；窄屏
  `body.scrollWidth = 465 < 480`，箭头列可读，既有宽表格保持横向浏览策略。
- 风险边界：现有自定义配置不会被这次默认值变化强制替换，用户需要“恢复默认”才会主动采用新集合；这是当前
  checkout 在 macOS CFT 隔离 profile 的自动化与可见证据，不等于 Windows/Edge、Chrome
  Stable、屏幕阅读器、认证态站点或完整 Vimium 人工矩阵通过。
- 当前状态：HEAD 仍为
  `c3ec01d3e3c5471ba4ea368100caef472f33b6e2`；共享工作区保留本轮及此前未提交修改，根目录 `.DS_Store`
  未跟踪。
- 对应提交：无。

## 2026-08-29 / 手势方向 HUD、拖入取消与右键显示时机 / E-145

- 授权与范围：按用户确认的视觉稿实现鼠标手势 HUD，并追加“首次右键不显示
  HUD、真正形成方向后才显示、快速第二次右键不显示 HUD
  或取消”的交互要求。没有新增权限、依赖、网络请求、遥测或远程代码；保留 E-143 的 600ms/12px
  双击右键原生菜单状态机和既有键盘行为，没有提交、推送或发布。
- 视觉与交互：`gesture_overlay.js` 改为 Shadow DOM 内的居中深色玻璃面板，使用 SVG
  方向图标、蓝色连续轨迹、当前方向高亮、本地化命令文字和下方红色取消目标；支持四向/八向与最多 8
  段的自适应尺寸、窄屏缩放、减少动态效果和强制色彩模式。第一次按键只显示取消目标，HUD
  在布局中不可见预留，因此从 PENDING 到 ACTIVE 不跳位且页面不提前变暗；越过 10px 激活距离但尚未达到
  18px 分段距离时仍不显示
  HUD，首个量化方向出现后才展开。拖向取消目标时保留最后一次精确匹配的方向与命令，释放后取消会话而不执行命令。
- 右键边界：E-143 的快速第二次近距离右键仍在创建 GestureSession 前直接返回，因此不会闪现取消目标或
  HUD，并放行原生菜单；第一次右键候选仍只显示取消目标。E2E 显式断言
  PENDING、已激活未形成方向、形成单段方向、拖入取消和快速第二次右键五个状态。
- 国际化与测试：英文和简体中文增加八个方向读屏名称及默认手势命令标题；DOM 测试覆盖取消独显、HUD
  图标/命令、取消命中和悬停态；E2E 增加 R-L-R 图示、“刷新”命令、取消后命令调用次数为
  0，以及第二次右键两层 UI 均隐藏的断言。
- 本轮实际命令与结果：

```text
deno fmt --check content_scripts/mouse/gesture_overlay.js content_scripts/mouse/mouse_controller.js lib/i18n.js scripts/e2e_browser_toolbox.js tests/dom_tests/browser_toolbox_dom_tests.js tests/unit_tests/browser_toolbox/i18n_test.js
deno check content_scripts/mouse/gesture_overlay.js content_scripts/mouse/mouse_controller.js lib/i18n.js scripts/e2e_browser_toolbox.js
git diff --check
  均退出码 0。
PUPPETEER_EXECUTABLE_PATH="/Users/yang/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test
  最终退出码 0；单元 445/445、DOM 111/111。第一次 DOM 尝试使用不完整的 CFT 152 缓存，因缺少 Framework 无法启动，不计为产品失败或通过。
deno test -A tests/browser_toolbox/
  退出码 0；BrowserToolbox shoulda 测试 193/193。
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/audit_technical_rename.js
  均退出码 0；9 项权限、34 个新增模块文件的网络行为和技术标识审计通过。
./make.js package
  退出码 0；最新 `dist/browser-toolbox` 和浏览器归档已生成。
PUPPETEER_EXECUTABLE_PATH="/Users/yang/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  最终退出码 0；可信右键事件验证 PENDING 仅显示取消、12px ACTIVE 无 HUD、120px 形成方向后显示 HUD/命令、拖入取消不执行命令、快速第二次右键不显示取消或 HUD并放行原生菜单；完整 E2E 继续通过设置、Vomnibar、标签列表、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
```

- CFT 安装与视觉验收：最终构建已加载到 headed Google Chrome for Testing `145.0.7632.6` 的独立
  profile `/tmp/browser-toolbox-cft145-hud-profile-20260829`，加载目录为
  `/Users/yang/project/plugin/browser-toolbox/dist/browser-toolbox`，扩展 ID 为
  `nalfnhojdelfpccjnfnbcoedeenocdek`。CFT 148
  的可视模式忽略命令行未打包扩展参数，故改用实际可加载并可见验收的 CFT 145；没有把 CFT 148 的实验
  `Extensions.loadUnpacked` 不可用记为产品失败。副屏窗口已打开
  `http://127.0.0.1:8766/browser-toolbox-hud-test-page.html` 并保持供用户测试，最终设置已恢复为
  `triggerButton = 2`。实际截图确认取消位置在 HUD 前后不跳动、R-L-R
  显示三个方向图标和“刷新”、悬停取消有红色光晕。
- 风险边界：这是当前 checkout 在 macOS CFT 隔离 profile 的自动化、可见渲染和安装运行态证据，不等于
  Windows/Edge、Chrome Stable、屏幕阅读器、认证态站点或完整 Vimium
  人工回归通过；右键手感仍待用户在保留窗口中实测反馈，项目暂不发布。
- 当前状态：HEAD 仍为
  `c3ec01d3e3c5471ba4ea368100caef472f33b6e2`；共享工作区保留本轮与此前未提交修改，根目录 `.DS_Store`
  未跟踪。
- 对应提交：无。

## 2026-08-29 / GitHub README 使用说明收敛 / E-144

- 授权与范围：按用户要求将 README
  改为只面向普通用户的中文使用说明，保留安装、快速开始、常用键盘操作、鼠标手势、超级拖拽、滚轮/摇杆和设置入口；移除技术方案、开发命令、验收记录、设计文档、贡献、许可证等非使用内容。未修改产品代码、权限、依赖、网络行为或其他既有脏文件。
- 本轮实际命令与结果：

```text
./make.js test
  首次退出码 1；单元测试 445/445 通过，DOM 测试因 Puppeteer 缓存的 Chrome for Testing 131 缺少 Framework 文件而无法启动。
PUPPETEER_EXECUTABLE_PATH="/Users/yang/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test
  退出码 0；单元测试 445/445、DOM 测试 109/109 通过。
deno test -A tests/browser_toolbox/
  退出码 0；BrowserToolbox shoulda 测试 193/193 通过。
deno fmt README.md
  退出码 0；README Markdown 表格已按 Deno 格式整理。
deno fmt --check README.md
  退出码 0。
./make.js package
  退出码 0；打包完成，归档为 current。
git diff --check
  退出码 0。
deno eval '通过 CDP 执行 Extensions.loadUnpacked 加载 dist/browser-toolbox'
  退出码 0；返回扩展 ID nalfnhojdelfpccjnfnbcoedeenocdek。
```

- CFT 安装：使用 Google Chrome for Testing `152.0.7977.64` 和独立 profile
  `/tmp/browser-toolbox-manual-cft-profile.Usfv67`，通过 `Extensions.loadUnpacked` 成功加载
  `/Users/yang/project/plugin/browser-toolbox/dist/browser-toolbox`，扩展 ID 为
  `nalfnhojdelfpccjnfnbcoedeenocdek`。设置页标题实际为“浏览器工具箱”；`http://127.0.0.1:8765/basic-links.html`
  已打开并留在 headed 窗口供用户测试。
- 当前状态：本轮未提交、未推送、未发布；Chrome for Testing 窗口继续保持打开。
- 对应提交：无。

## 2026-08-29 / 默认右键手势与双击原生菜单 / E-143

- 授权与交互：用户在 Google Chrome for Testing 实测确认 E-141
  版本的默认右键手势仍失效，并同意改为“第一次右键负责手势候选，未移动激活时在短时间内第二次右键呼出原生菜单”。本轮将窗口固定为
  600ms、同一位置容差固定为 12px；没有新增设置字段、权限、依赖、网络请求或远程代码，没有修改默认
  `mouse.triggerButton = 2`，没有处理 Linux，也没有删除或跟踪根目录 `.DS_Store`。
- 根因：macOS Google Chrome for Testing 152.0.7977.64 的真实顺序为
  `pointerdown → mousedown → contextmenu → pointermove → pointerup`。E-141 产品代码在 PENDING
  的第一枚菜单到达时结束候选，右键无法继续进入 ACTIVE；E-141 headed E2E
  又由页面夹具预先阻止该菜单，因此自动化通过没有覆盖真实安装行为。
- 状态机修改：右键菜单接管开启时，第一次右键进入 PENDING 并启用 provisional guard，提前到达的可信
  `contextmenu` 由产品代码阻止但不会取消手势；随后移动越过阈值进入
  ACTIVE，才显示轨迹/HUD并在释放时执行一次命令。第一次轻点在释放时完整清理
  gesture、timer、bridge、overlay 和 provisional 状态，只留下 600ms 的无定时器原生菜单候选；12px
  内第二次右键消费候选、不创建
  GestureSession并放行原生菜单，菜单关闭后的移动和释放不能延迟激活。超时或远距离第二次右键成为新的手势候选；关闭菜单接管后仍保持第一次右键直接打开原生菜单。左键、中键、摇杆、滚轮、超级拖拽和跨
  frame 的既有路径未改变。
- 测试与文案：删除 `scripts/e2e_browser_toolbox.js` 中 `__browserToolboxE2eDeferEarlyContextMenu`
  测试夹具，默认 ACTIVE 与双击菜单均使用 CFT 真实可信右键事件；新增 provisional guard、600ms/12px
  候选匹配、菜单后不延迟激活以及所有运行时状态清理断言。中英文帮助、设置项说明、入门文案和
  `docs/manual-acceptance.md` 已同步为“双击右键打开原生菜单”。
- 本轮实际命令与结果：

```text
deno fmt content_scripts/mouse/context_menu_guard.js content_scripts/mouse/gesture_session.js content_scripts/mouse/mouse_controller.js tests/unit_tests/browser_toolbox/context_menu_guard_test.js tests/unit_tests/browser_toolbox/gesture_session_test.js scripts/e2e_browser_toolbox.js lib/i18n.js docs/manual-acceptance.md
deno check content_scripts/mouse/context_menu_guard.js content_scripts/mouse/gesture_session.js content_scripts/mouse/mouse_controller.js tests/unit_tests/browser_toolbox/context_menu_guard_test.js tests/unit_tests/browser_toolbox/gesture_session_test.js scripts/e2e_browser_toolbox.js lib/i18n.js
git diff --check
  均退出码 0。
PUPPETEER_EXECUTABLE_PATH="/Users/yang/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test
  退出码 0；单元 445/445、DOM 109/109。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 193/193。
BROWSER_TOOLBOX_E2E_HEADLESS=false PUPPETEER_EXECUTABLE_PATH="/Users/yang/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run -A scripts/e2e_browser_toolbox.js
  第一次退出码 1：E2E 加载尚未重新生成的旧 dist，在默认右键 ACTIVE 断言处实际为 null；该次未记为通过。
./make.js package
  退出码 0；最新 dist 与浏览器归档已生成。
BROWSER_TOOLBOX_E2E_HEADLESS=false PUPPETEER_EXECUTABLE_PATH="/Users/yang/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run -A scripts/e2e_browser_toolbox.js
  最终退出码 0；真实事件记录中第一次右键 contextmenu 为 trusted 且 defaultPrevented=true，随后 pointermove 进入 ACTIVE并只执行一次命令；双击菜单场景的第一枚菜单被产品 guard 阻止、第二枚 trusted 菜单 defaultPrevented=false，菜单后的移动未激活。完整 E2E 继续通过设置、Vomnibar、标签列表、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/audit_technical_rename.js
  均退出码 0；权限 9 项、34 个新增模块文件的网络审计和技术标识审计通过。
deno fmt --check content_scripts/mouse/context_menu_guard.js content_scripts/mouse/gesture_session.js content_scripts/mouse/mouse_controller.js tests/unit_tests/browser_toolbox/context_menu_guard_test.js tests/unit_tests/browser_toolbox/gesture_session_test.js scripts/e2e_browser_toolbox.js lib/i18n.js docs/manual-acceptance.md docs/codex-progress.md
  退出码 1；历史进度文件整体不符合当前 Deno Markdown 格式，本轮没有为通过检查而重排数千行历史记录。
deno fmt --check content_scripts/mouse/context_menu_guard.js content_scripts/mouse/gesture_session.js content_scripts/mouse/mouse_controller.js tests/unit_tests/browser_toolbox/context_menu_guard_test.js tests/unit_tests/browser_toolbox/gesture_session_test.js scripts/e2e_browser_toolbox.js lib/i18n.js
git diff --check
  均退出码 0。
```

- CFT 安装：Codex 内置浏览器不能加载当前 checkout 的未打包扩展，因此按项目门禁使用 headed Google
  Chrome for Testing 独立 profile。实际版本为 152.0.7977.64；通过 `Extensions.loadUnpacked` 重新加载
  `/Users/yang/project/plugin/browser-toolbox/dist/browser-toolbox`，扩展 ID 为
  `nalfnhojdelfpccjnfnbcoedeenocdek`。`http://127.0.0.1:8765/basic-links.html` 隔离 world 实测控制器
  `initialized = true`、`triggerButton = 2`、`suppressContextMenuAfterActivation = true`，页面已置前供用户测试。
- 剩余风险：macOS CFT
  在首次移动前同步派发原生菜单的限制仍存在，本轮用明确的双击右键交互解决冲突，不再宣称单次右键轻点与同一次按住移动可以同时由浏览器原生机制判断。600ms/12px
  尚待用户手感确认；未执行 Windows/Edge、Chrome Stable、屏幕阅读器、认证态站点或完整 Vimium
  人工回归，项目仍暂不发布。
- 当前状态：本轮修改未提交、未推送、未发布；用户人工复测尚待反馈，根目录 `.DS_Store` 仍保持未跟踪。
- 对应提交：无。

## 2026-08-29 / Chrome for Testing 用户测试安装门禁 / E-142

- 协作规则：根目录既有 `AGENTS.md` 已补充强制门禁：每次修改完成后必须把当前 checkout
  的最新构建安装到 headed Google Chrome for Testing 独立 profile 中，并保持窗口交给用户测试；不得以
  Chrome Stable、其他浏览器或仅自动化测试替代。安装后必须报告 CFT
  版本、加载目录和测试入口，受阻时不得声称完成交付。
- 安装环境：使用 Google Chrome for Testing `152.0.7977.64`，独立 profile 为
  `/tmp/browser-toolbox-manual-cft-profile.7ATuCJ`，没有读取或修改日常 Chrome
  profile、Cookie、登录态或个人浏览数据。运行时加载目录为
  `/Users/yang/project/plugin/browser-toolbox/dist/browser-toolbox`。
- 实际操作与结果：`./make.js package` 退出码 0，归档为 current；首次 `deno eval -A`
  在参数解析阶段退出，未连接浏览器也未执行安装。移除无效 `-A` 后，通过 CFT 的
  `Extensions.loadUnpacked` 成功加载扩展，扩展 ID 为
  `nalfnhojdelfpccjnfnbcoedeenocdek`，设置页标题为“浏览器工具箱”。本地测试入口
  `http://127.0.0.1:8765/scroll-containers.html` 的隔离 world 实际读取到鼠标控制器
  `initialized = true`、默认 `triggerButton = 2`；设置页和测试页均留在可见 CFT 窗口供用户操作。
- 结果边界：这是当前 macOS CFT 独立 profile
  的安装与运行态证据，后续手势体验结论由用户实际操作反馈决定；不等于 Chrome/Edge/Windows/Linux
  人工矩阵、屏幕阅读器、认证态站点或完整 Vimium 手工回归通过。
- 当前状态：本轮没有提交、推送或发布；根目录 `.DS_Store` 仍保持未跟踪。
- 对应提交：无。

## 2026-08-29 / 默认右键手势与原生菜单状态机回归修复 / E-141

- 授权边界：按用户要求直接修复默认 `mouse.triggerButton = 2`
  的右键手势回归，只修改鼠标手势状态机、菜单保护、单元测试、隔离 E2E
  和本进度记录；没有修改默认触发键，没有新增权限、依赖、网络请求或远程代码，没有处理
  Linux，也没有删除或跟踪根目录 `.DS_Store`。
- 根因与真实事件：E-140 在 PENDING 阶段收到可信右键 `contextmenu` 后无条件执行
  `cancelAll("native-context-menu")`，并把核心 ACTIVE E2E 改成左键，导致默认右键路径失去覆盖。修复前
  Chrome for Testing 152.0.7977.64 headed 实际记录为
  `pointerdown(button=2) → mousedown → contextmenu(buttons=2) → pointermove(buttons=2) → pointerup → mouseup`；菜单在首次移动前到达时，旧逻辑直接清空候选，所以后续移动无法进入
  ACTIVE。
- 修复内容：`GestureSession.contextMenu()` 现在用 `contextmenu`
  的可信坐标补做一次激活距离判断；已越过阈值转入 ACTIVE，未越过阈值转入终态 `NATIVE_CONTEXT_MENU`
  并清空采样点，终态后的移动不能重新激活。控制器只在 ACTIVE 后显示轨迹/HUD、激活
  guard，并在完成或取消时显式关闭 bridge；`ContextMenuGuard.reset()` 同时清理 active、delayed 和
  seen 状态。普通菜单路径先完成 `PENDING → NATIVE_CONTEXT_MENU` 转换再释放 controller 引用，ACTIVE
  路径仍只执行一次匹配命令。
- 测试覆盖：单元测试新增 `NATIVE_CONTEXT_MENU` 终态不可被后续移动提升、`contextmenu`
  坐标已越阈值时进入 ACTIVE，以及取消后 guard 全量复位。headed E2E 恢复默认右键 trusted
  `pointerdown/pointermove/pointerup`，分别断言 ACTIVE 时的
  overlay、timer、bridge、guard、释放后的命令调用次数为 1
  和全部清理；另覆盖普通右键菜单未被阻止且命令次数为 0、菜单后的移动不延迟激活、ACTIVE 后 trusted
  `contextmenu` 被阻止，以及 `pointerup` 后延迟菜单的一次性保护。
- 本轮实际命令与结果：

```text
./make.js test
  退出码 1；单元 443/443 已通过，但本机 Puppeteer 缓存的 CFT 131 缺少 Framework，DOM 浏览器未能启动；该次不计为完整通过。
PUPPETEER_EXECUTABLE_PATH="/tmp/browser-toolbox-cft-152.0gv6nr/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test
  退出码 0；单元 443/443、DOM 109/109。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 191/191。
./make.js package
  退出码 0；最新 `dist/browser-toolbox` 和三类浏览器归档已重新生成。
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/audit_technical_rename.js
  均退出码 0；权限 9 项、34 个新增模块文件的网络审计和技术标识审计通过。
deno fmt --check content_scripts/mouse/gesture_session.js content_scripts/mouse/context_menu_guard.js content_scripts/mouse/mouse_controller.js tests/unit_tests/browser_toolbox/gesture_session_test.js tests/unit_tests/browser_toolbox/context_menu_guard_test.js scripts/e2e_browser_toolbox.js
deno check content_scripts/mouse/gesture_session.js content_scripts/mouse/context_menu_guard.js content_scripts/mouse/mouse_controller.js tests/unit_tests/browser_toolbox/gesture_session_test.js tests/unit_tests/browser_toolbox/context_menu_guard_test.js scripts/e2e_browser_toolbox.js
git diff --check
  均退出码 0。
BROWSER_TOOLBOX_E2E_HEADLESS=false PUPPETEER_EXECUTABLE_PATH="/tmp/browser-toolbox-cft-152.0gv6nr/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run -A scripts/e2e_browser_toolbox.js
  最终退出码 0；CFT 152 headed 完整 E2E 通过默认右键 ACTIVE/命令一次、普通右键菜单、提前/延迟 contextmenu、状态清理，并继续通过设置、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
```

- 中间失败：本机既有 CFT 缓存缺 Framework，首次 headed 启动在调试端口等待处退出码 1，随后从 Chrome
  for Testing 官方存储下载完整 152.0.7977.64 到明确的临时目录再运行。新增右键 E2E 首次假设
  `clickCount=0` 可避开提前菜单，实际仍得到 `pointerdown → contextmenu → pointermove` 并在 ACTIVE
  断言处退出码 1；改为测试夹具只延后该显式场景的第一枚菜单后，默认右键使用的仍是 trusted CDP
  事件，ACTIVE 后第二枚 trusted 菜单由产品 guard 阻止。其后一轮完整 E2E 因自定义测试 binding
  未恢复而在设置页退出码 1；补回 `resetSettings` 后整套最终通过。
- 结果边界与风险：macOS CFT 152 的 CDP 右键按下会同步生成 `contextmenu`，即使 `clickCount=0`
  也不会产生天然的 `pointerdown → pointermove → pointerup → contextmenu`。为同时验证真实右键 ACTIVE
  和普通原生菜单，headed E2E 只在 ACTIVE 专用场景由 window 捕获夹具阻止第一枚提前菜单，后续指针和
  ACTIVE 后菜单均为
  trusted；普通右键场景没有该夹具，菜单保持未阻止。产品本身不会在菜单已出现后再把同一次输入延迟激活；若浏览器在首次位移前已经显示菜单，该次输入按
  `NATIVE_CONTEXT_MENU` 安全结束，这是 CFT/macOS 的事件顺序限制。未执行
  Windows/Edge、屏幕阅读器、认证态站点或完整 Vimium 人工回归，项目仍暂不发布。
- 当前状态：HEAD 仍为
  `c3ec01d3e3c5471ba4ea368100caef472f33b6e2`；本轮修改未提交、未推送、未发布，根目录 `.DS_Store`
  仍保持未跟踪。
- 对应提交：无。

## 2026-08-29 / 原生右键菜单后的 PENDING 会话清理 / E-140

- 授权边界：用户反馈右键菜单出现后仍留下黑色起点并在松键时误触发手势；本轮只修复右键 PENDING
  会话清理、轨迹显示时机和对应 Chrome for Testing 回归，Linux
  按用户要求暂不处理，没有新增权限、依赖、网络行为或商业化路径。
- 根因：控制器在 `pointerdown` 时就显示手势覆盖层；原生 `contextmenu` 被放行后，尚未越过激活距离的
  `GestureSession` 仍留在控制器中，后续移动可能把它提升为 ACTIVE，松键时继续执行命令。
- 修复内容：轨迹覆盖层改为仅在首次越过激活阈值后显示；对可信且未被其他监听器阻止的原生右键菜单，立即取消
  PENDING 会话、跨 frame bridge
  和定时器，清理覆盖层，防止菜单出现后的移动/松键重新激活；保留右键摇杆的第一键状态，避免破坏既有组合优先级。E2E
  新增“原生菜单出现后再移动”断言，并显式检查 PENDING 阶段不显示轨迹。
- 本轮实际自动门禁：

```text
deno fmt --check content_scripts/mouse/mouse_controller.js scripts/e2e_browser_toolbox.js
deno check content_scripts/mouse/mouse_controller.js scripts/e2e_browser_toolbox.js
git diff --check
  均退出码 0。
PUPPETEER_EXECUTABLE_PATH="/tmp/browser-toolbox-cft-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test
  退出码 0；单元 440/440、DOM 109/109。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 188/188。
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/audit_technical_rename.js
  均退出码 0；权限、网络和技术标识审计通过。
./make.js package
  退出码 0；最终 `dist/browser-toolbox` 产物重新生成。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/tmp/browser-toolbox-cft-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Chrome for Testing 152.0.7977.64 最终产物隔离 E2E 通过，包含原生右键菜单、菜单后的移动、轨迹/摇杆、核心输入、设置迁移、跨 frame、fixtures 和 Service Worker 重启。
```

- 结果边界与风险：Chrome for Testing headless CDP 会在首次右键 `pointermove` 前派发
  `contextmenu`，因此自动化中的“激活后通用轨迹”使用左键触发来隔离状态机，右键专门覆盖原生菜单后的取消安全路径；这不替代可见原生
  GUI 菜单、真实用户 profile、平台/辅助技术矩阵、屏幕阅读器、完整 Vimium 手工回归或商店审核。Linux
  按用户要求保留未处理，项目仍暂不发布。
- 当前状态：代码修复和验证记录已提交并推送到远程 `origin/main`；根目录既有 `.DS_Store`
  未纳入版本控制。
- 对应提交：`3da8d760`（`fix: cancel pending gesture after native context menu`）。

## 2026-08-29 / 产物目录与开发包名称统一 / E-139

- 授权边界：用户指出手工加载路径出现 Vimium 名称；本轮修正构建 staging 目录、归档文件名、开发包
  manifest 和 E2E/手工验收路径，没有改变运行时权限、依赖、网络行为或产品功能，Linux
  按用户要求暂不处理。
- 根因：`make.js` 沿用上游 `dist/vimium` staging 目录，并在生成开发包后把 `Vimium Canary` manifest
  留在该共享目录；因此直接加载该目录时会显示错误品牌。Chrome 商店归档本身使用的是本地化
  `__MSG_extensionName__`，但手工测试目录没有恢复正式 manifest。
- 修复内容：staging 目录改为 `dist/browser-toolbox`，旧目录在打包时清理；Chrome/Firefox/Canary
  归档改用 `browser-toolbox-*` 文件名；开发包改名为 `Browser Toolbox Canary`，打包完成后恢复正式
  Chrome manifest；E2E 默认路径和手工验收说明同步更新。当前 `dist/browser-toolbox` manifest 使用
  `__MSG_extensionName__`，英文资源解析为 `Browser Toolbox`，旧 `dist/vimium` 不再存在。
- 本轮实际命令与结果：

```text
./make.js package
  退出码 0；生成 `dist/browser-toolbox` 和 Browser Toolbox 命名的 Chrome、Firefox、Canary 归档。
PUPPETEER_EXECUTABLE_PATH="/tmp/browser-toolbox-cft-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test
  退出码 0；单元 440/440、DOM 109/109。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 188/188。
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/audit_technical_rename.js
  均退出码 0；权限、网络和技术标识审计通过。
deno fmt --check make.js scripts/e2e_browser_toolbox.js、git diff --check
  均退出码 0。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/tmp/browser-toolbox-cft-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；使用新的默认 `dist/browser-toolbox` 路径完成 Chrome for Testing 152.0.7977.64 隔离 E2E。
```

- 结果边界与风险：本轮证明的是构建产物路径、manifest 和隔离自动化加载路径；不等于原生
  GUI、屏幕阅读器、平台矩阵或真实商店审核。Linux 按用户要求保留未处理。
- 当前状态：产物命名修复已提交，并按用户此前授权推送到远程 `origin/main`；`AGENTS.md` 仍未被跟踪。
- 对应提交：`1620e68a`（`fix: align Browser Toolbox build artifacts`）。

## 2026-08-29 / 右键轻点保留原生菜单 / E-138

- 授权边界：用户要求修复右键手势轻点不显示原生菜单的问题；本轮只调整右键手势的激活时机、菜单保护、相关测试和中英文说明，Linux
  按用户要求暂不处理，没有新增权限、依赖、网络行为或商业化路径。
- 根因：右键 `pointerdown` 时提前激活 `ContextMenuGuard`，并且 `pointerup` 对未激活的 `PENDING`
  会话也留下延迟菜单保护，导致普通右键轻点被扩展捕获。
- 修复内容：菜单保护改为只在轨迹越过激活阈值后激活；只有已完成的 ACTIVE 轨迹才保留 `pointerup`
  到延迟 `contextmenu` 的一次性保护；PENDING
  轻点在结束时清理保护状态。设置项、帮助页、入门页、设计文档和手工验收清单均改为明确说明“轻点/阈值内保留原生菜单，激活后按开关抑制”。E2E
  同时覆盖普通右键未被阻止和激活轨迹对后续菜单事件的拦截。
- 本轮实际命令与结果：

```text
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档重新生成。
PUPPETEER_EXECUTABLE_PATH="/tmp/browser-toolbox-cft-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" ./make.js test
  退出码 0；单元 440/440、DOM 109/109。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 188/188。
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/audit_technical_rename.js
  均退出码 0；权限、网络和技术标识审计通过。
deno fmt --check（本轮涉及的 4 个 JavaScript 文件）、jq empty 两个本地化文件、git diff --check
  均退出码 0。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/tmp/browser-toolbox-cft-152.0.7977.64/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Chrome for Testing 152.0.7977.64 隔离 E2E 的右键菜单策略、核心手势、设置迁移、跨 frame、fixtures 和 Service Worker 重启均通过。
```

- 结果边界与风险：本轮是 Chrome for Testing 隔离自动化，不等于原生 GUI 菜单的人工验收。Chromium
  可能在首次 `pointermove` 前派发 `contextmenu`；PENDING
  阶段必须优先保留轻点菜单，因此若浏览器已经在激活前放行菜单，扩展无法事后撤回。Chrome、Edge、Windows、macOS、Linux
  手工矩阵、屏幕阅读器和真实旧 CRX 更新仍未完成。
- 当前状态：修复代码和相关文档已提交，随后按用户此前授权推送到远程 `origin/main`；没有触发商店发布。
- 对应提交：`a7bf780a`（`fix: preserve native menu for light right clicks`）。

## 2026-08-29 / macOS 操作与 Windows 环境核对 / E-137

- 授权边界：按用户要求继续执行 macOS Chrome 和 Windows 隔离环境操作，Linux 本轮暂不处理；只使用独立
  Chrome for Testing 临时 profile 和现有 `OpenKeyMouse-Windows-Isolated` VM 探测，没有触碰日常浏览器
  profile、登录态、Cookie、Token 或个人浏览数据，没有提交、推送或发布。
- macOS Chrome 操作：现有独立 Chrome for Testing `152.0.7977.64` 在本地 CDP `127.0.0.1:9223`
  可用，实际加载当前 `dist/vimium`，扩展 ID 为
  `fphpoleocahngmcgdaccfnfgkgjjlocn`。通过浏览器可操作入口检查了设置页常规、备份与恢复、关于与许可证，以及
  `privacy.html`、`onboarding.html`、`project_charter.html`、`security.html` 和
  `third_party_notices.html`；中文标题、设置导航、信息页和本地许可证链接均正常呈现。
- Chrome Web Store 操作：打开 `https://chrome.google.com/webstore/devconsole` 后实际跳转到 Google
  账号登录页，当前临时 profile 没有商店登录态；没有输入账号密码，也没有上传归档或触发提交。
- Windows 环境核对：`prlctl start OpenKeyMouse-Windows-Isolated` 成功，来宾地址为
  `10.211.55.4`，但屏幕实际停在旧镜像的 Windows 11 Sysprep 3.14/OOBE
  对话框；`prlctl exec ... --current-user -- cmd.exe /c "echo READY&&ver"` 退出码 2
  且无输出，`10.211.55.4:9231/9232` 不可达。没有强行确认 OOBE、改写镜像或把历史自动化结果前移为当前
  checkout 证据；核对后已停止 VM。
- 结果边界：本轮形成 macOS 临时 profile 的代理 UI smoke-check，不等于日常 profile
  人工验收、VoiceOver、真实商店登录/上传/审核或最终发布；Windows Chrome/Edge 当前 checkout
  本轮未形成运行态证据，Linux 按用户要求保留未处理。项目仍不能标记为最终发布通过。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；本轮只追加记录，未修改运行时代码，没有创建提交或推送。
- 下一步：需要用户在可见浏览器中完成 Google 商店开发者账号登录，并提供公开 HTTPS 隐私政策
  URL；Windows 需要可进入桌面的当前 checkout 隔离环境。最终上传/提交动作仍需用户在确认界面确认。
- 对应提交：无。

## 2026-08-29 / Chrome Web Store 包阻塞修复与信息页 CSP 回归 / E-136

- 授权边界：本轮按用户要求修复当前 checkout
  中已经确认的商店包问题；没有提交、推送、发布，没有新增权限、依赖、网络行为或商业化路径，没有触碰日常浏览器
  profile、登录态、Cookie、Token 或个人浏览数据。
- 修复内容：英文扩展说明压缩到 131 个字符，并同步修正运行时 fallback；隐私页和入门页移除 CSP
  禁止的内联脚本，统一改为本地
  `pages/localized_page.js`；新增可随运行时包发布的项目章程、安全和第三方声明页面；隐私页、设置页不再链接不会进入运行时包的
  Markdown 文件；权限审计新增本地化说明长度、扩展页内联脚本和 Markdown 链接检查；隔离 E2E
  新增五个信息页与 CSP 回归。
- 本轮实际命令与结果：

```text
./make.js package
  退出码 0；Chrome、Firefox、Canary 商店归档均包含新增信息页和外部本地化脚本。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 439/439、DOM 109/109。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 187/187。
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/audit_technical_rename.js
  均退出码 0；权限、描述长度、CSP 内联脚本、Markdown 链接、网络和技术标识审计通过。
deno fmt --check（本轮涉及的 12 个文件）
  退出码 0。
git diff --check
  退出码 0。
deno run -A scripts/build_release.js --package
  退出码 0；运行时包和源码包生成成功。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  第一次在既有窄屏 Vomnibar 聚焦等待处超时；未作为通过证据保留。第二次完整执行退出码 0，新增信息页与 CSP 检查、核心手势、设置迁移、跨 frame 和 Service Worker 重启均通过。
商店 ZIP 临时解包后由 Chrome Stable 通过 Extensions.loadUnpacked 加载
  隐私、入门、项目章程、安全、第三方声明五页均 HTTP 200；`zh-CN` 下均正确本地化；无 CSP 控制台错误；无 Markdown 链接。
```

- 当前发布包：Chrome 商店包由 `dist/chrome-store/vimium-chrome-store-0.1.0.zip` 生成；包内 Manifest
  为合法 JSON，英文说明 131 字符，运行时包不含 Markdown。
- 归档复现：`./make.js package` 连续两次 Chrome 商店包 SHA-256 均为
  `f051cf0c29970a4da52ebada48df9f9221101b78837465d5b249570a8dc43334`；`deno run -A scripts/build_release.js --package`
  连续两次运行时包和源码包 SHA-256 分别为
  `ff7b1c75c18055a395ace5d7ec3af01932b28cd345edf9e81830e3ca0fe0c3d9` 与
  `5102446dadaa7079cab1cdf111f59b1eaf41190284db91124bc25ebe8f203d1a`，均一致。
- 风险与边界：全仓库 `deno fmt --check` 仍因既有 31 个未格式化文件退出码
  1，本轮没有改写无关的用户脏文件；Windows、Edge、Linux、macOS Chrome
  的人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归、真实旧 CRX 更新和公开
  HTTPS 隐私政策 URL 仍未完成，项目仍不能标记为最终发布通过。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有既有及本轮未提交修改，没有创建提交或推送。
- 下一步：在干净发布提交上重新生成并留存最终
  SHA-256，然后完成商店后台隐私披露、权限说明、单一用途说明、公开隐私政策 URL 和人工验收门禁。
- 对应提交：无。

## 2026-08-29 / Vomnibar 搜索浮层与设置侧栏可读性收口 / E-135

- 授权边界：用户指出网页按 `B` 调出的搜索浮层过于粗糙，并要求放大设置页左侧菜单文字；本轮只修改现有
  Vomnibar 的布局、文案、可访问语义、首次样式加载可靠性，以及设置侧栏字号，没有改变 `B`/`b`
  快捷键映射、书签/标签页/综合补全逻辑、搜索目标、权限、依赖或网络行为，没有提交、推送或发布。
- 界面修改：Vomnibar 外层 iframe 从占据页面 80% 宽度改为最大 920px 的居中浮层，并保留 32px
  最小页面边距；浮层统一使用浏览器工具箱的白色表面、蓝色强调色、14px
  圆角和分层阴影。新增本地化模式标题、`新标签页`
  状态、搜索图标、按模式变化的输入提示以及上下键/Enter/Esc 键盘提示；输入字号为桌面 18px、窄屏
  17px，结果标题 15px，选中结果使用蓝色左边线和浅蓝背景。输入补充
  `combobox`、`aria-controls`、`aria-expanded`、`aria-activedescendant`，结果补充 `listbox/option`
  与选中语义。设置页一级分类和二级菜单字号均提高到 15px，搜索标签提高到 13px。
- 首次加载缺陷与修复：新增真实 `B` 键 E2E 后，前两次运行均退出码 1。第一次在 iframe
  尚未激活时过早读取默认壳；修正等待后，第二次仍证明新 profile 首次打开时外层 iframe
  实际为浏览器默认 `300×150`、`position: static`。根因是 `UIComponent` 读取
  `chrome.storage.session.vimiumCSSInChromeStorage` 时可能早于后台完成 CSS
  缓存写入。现改为缓存为空时只读取扩展自身
  `content_scripts/vimium.css`，不访问远程网络；新增单元测试覆盖该首次加载回退。
- 视觉核对：Codex 浏览器在普通本地页面上可看到旧加载实例创建 Vomnibar
  iframe，但该实例保持隐藏，且浏览器策略不允许代理重载扩展管理页，因此没有把它写成最新代码实机截图。改用生产
  `vomnibar_page.css` 和等价结果 DOM 在 `http://127.0.0.1:8766/` 做只读视觉预览；当前浏览器视口仍为
  1523px，临时预览按真实外层约束为 904px，实测标题 13px、输入 18px、结果 15px、3
  条结果、无控制台警告/错误。该预览只证明布局呈现，不等于真实扩展人工验收。
- 本轮实际命令与结果：`deno fmt --check pages/vomnibar_page.html pages/vomnibar_page.css pages/vomnibar_page.js content_scripts/vimium.css content_scripts/ui_component.js pages/gesture_editor.css lib/i18n.js _locales/en/messages.json _locales/zh_CN/messages.json tests/unit_tests/vomnibar_page_test.js tests/unit_tests/ui_component_test.js scripts/e2e_browser_toolbox.js`、对应
  `deno check`、locale `jq empty` 和 `git diff --check` 均退出码
  0；`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  退出码 0，单元 `439/439`、DOM `109/109`；`deno test -A tests/browser_toolbox/` 退出码 0，shoulda
  `187/187`；技术标识、权限和网络审计均退出码 0；`./make.js package` 退出码 0。
- 最终隔离 E2E：基于最新打包目录执行
  `BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js`，最终退出码
  0。新增路径真实按 `B` 打开“Search bookmarks / New tab”，确认输入获得焦点、桌面 iframe 最大
  920px、18px 输入、14px 圆角、输入可编辑、Esc 可关闭；620px 窄屏确认浮层保留 32px
  页面边距且输入至少 17px。设置页 E2E 同时断言一级/二级菜单至少 15px、搜索标签至少
  13px，并继续覆盖设置导入导出、站点规则、旧版迁移、核心手势、右键菜单、超级拖拽、滚轮/摇杆、跨
  frame、fixtures 和 Service Worker 重启。
- 结果边界与风险：本轮新增的是当前 checkout 的视觉预览和 macOS Chrome Stable 临时 profile/CDP
  自动化证据，不是日常 profile 的真实扩展人工操作，也不是 VoiceOver、200%
  缩放、高对比度、低动效或跨平台手工矩阵。结果列表很多、长书签标题、用户自定义 Vomnibar CSS
  和真实中文输入法候选状态仍应在后续人工验收中重点核对；项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，工作区既有未提交修改全部保留，没有创建提交或推送。
- 下一步：先由用户确认新版搜索浮层效果；确认后在手工环境重新加载最新扩展，验证真实书签数据、中文输入法、长结果列表和自定义
  CSS，并继续未完成的平台与辅助技术门禁。
- 对应提交：无。

## 2026-08-29 / 设置页视觉层级与站点规则卡片化收口 / E-134

- 授权边界：用户指出当前设置页“界面太丑、布局混乱”，本轮只整理现有设置页的信息层级、站点规则编辑布局和响应式呈现，没有改变配置
  schema、存储键、权限、依赖、网络行为或既有功能范围；没有提交、推送、发布或修改项目外的持久文件，工作区原有未提交修改全部保留。
- 界面修改：设置页统一为 264px
  多级分类侧栏、轻量页面背景、白色内容表面和蓝色主操作；品牌区加入当前扩展图标，分类展开箭头改为 CSS
  绘制。站点规则保留原 `<table>`、`#site-rules`、`tr[data-rule-id]`
  和全部字段/动作选择器，但视觉上改为全宽规则卡片：顺序与移动/复制/删除位于卡片头部，匹配方式、网址匹配式和启用开关独立成组，停用模块使用网格；添加规则移到页头，网址测试和保存状态各自形成独立区域。720px
  以下改为单列规则字段和单列模块列表；无修改时保存条不再遮挡内容，桌面仅在存在未保存修改时保持悬浮，窄屏始终随文档流显示。
- 视觉核对：先以用户提供截图为问题基线并生成 1600×1024 概念稿，再用当前生产 CSS 和等价站点规则 DOM
  创建只读的本地临时预览。Codex 浏览器连接因安全策略拒绝直接访问 `chrome-extension://`
  设置页，本轮没有绕过；改在 `http://127.0.0.1:8765/` 检查样式。桌面实际视口为
  1523×753；窄屏实际视口为 720×1000，`bodyScrollWidth` 与 `documentScrollWidth` 均为
  705，没有横向溢出，干净状态保存条计算样式为
  `position: static`。该预览只证明布局与响应式样式，不等于真实扩展页人工验收。
- 本轮实际命令与结果：`deno fmt --check pages/mouse_options.html pages/gesture_editor.css pages/site_rules_editor.js pages/settings_navigation.js`、`deno check pages/site_rules_editor.js pages/settings_navigation.js`
  和 `git diff --check` 均退出码
  0；`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  退出码 0，单元 `437/437`、DOM `109/109`；`deno test -A tests/browser_toolbox/` 退出码 0，shoulda
  `187/187`；`deno run -A scripts/audit_technical_rename.js`、`deno run -A scripts/audit_permissions.js`、`deno run -A scripts/audit_network_usage.js`
  均退出码 0；`./make.js package` 退出码 0。
- 隔离 E2E：基于最新打包目录执行
  `BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js`，退出码
  0；覆盖设置页键盘/无障碍语义、保存与放弃、站点规则、导入导出、旧版设置/导出迁移、核心输入、右键菜单策略、超级拖拽、滚轮/摇杆、跨
  frame、fixtures 和 Service Worker 重启。
- 结果边界与风险：本轮取得的是布局预览和 macOS Chrome Stable 临时 profile/CDP
  自动化证据，不是用户日常 profile 的真实扩展页人工操作，也不是屏幕阅读器、高对比度/200%
  缩放、认证态站点或 Windows/Edge/Linux/macOS
  手工矩阵。站点规则卡片在规则很多时会增加纵向长度，后续人工验收应重点核对长列表编辑效率、键盘焦点顺序和窄屏滚动体验；项目仍暂不发布。
- 当前状态：HEAD 仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：先由用户确认当前效果图与信息层级；确认后在可访问的真实扩展设置页继续 VoiceOver、200%
  缩放、高对比度、低动效和长规则列表人工验收，同时保留跨平台、认证态站点和真实旧 CRX
  更新门禁未完成的状态。
- 对应提交：无。

## 2026-08-29 / Chromium 右键轨迹与 contextmenu 冲突修复 / E-133

- 授权边界：本轮只修改当前 checkout
  中已有鼠标轨迹、菜单保护和回归测试路径，未新增权限、依赖、网络行为或商业化功能，没有提交、推送、发布或修改外部路径；工作区原有未提交修改全部保留。
- 缺陷复现：在加入“已激活右键轨迹应阻止原生菜单”的真实 Chrome
  隔离断言后，`BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js`
  曾以退出码 1 失败。事件链实际为 `pointerdown → mousedown → contextmenu → pointermove`，证明
  Chromium 可能在首次移动前就派发 `contextmenu`；只在 ACTIVE 阶段保护已经来不及。
- 缺陷修复：`ContextMenuGuard`
  增加一次性延迟保护、事件已处理标记和过期清理；右键手势会话在按下时按配置接管菜单，`pointerup`
  到延迟 `contextmenu`
  之间继续保护，新的鼠标输入会清理一次性状态。`suppressContextMenuAfterActivation`
  兼容键名保留，但界面文案改为“手势期间抑制原生菜单”；关闭该开关时保留原生菜单，同时明确提示右键轨迹可能冲突。E2E
  事件观测改为在事件传播结束后读取最终 `defaultPrevented`，避免 window
  捕获阶段的误判；滚轮断言只检查实际 wheel 事件。
- 本轮实际命令与结果：`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  退出码 0，单元 `437/437`、DOM `109/109`；`deno test -A tests/browser_toolbox/` 退出码 0，shoulda
  `187/187`；`deno run -A scripts/audit_technical_rename.js`、`deno run -A scripts/audit_permissions.js`、`deno run -A scripts/audit_network_usage.js`
  和 `git diff --check` 均退出码 0；`./make.js package` 退出码 0；随后同一隔离 E2E 命令退出码
  0，覆盖右键菜单抑制开关、核心手势、滚轮/摇杆、跨 frame、设置导入导出、旧版迁移、站点规则、fixtures
  和 Service Worker 重启。
- 结果边界与风险：已取得的是当前 checkout 的 macOS Chrome Stable 临时 profile/CDP
  自动化证据，不是日常 profile、真实旧 CRX 更新、Chrome/Edge/Windows/Linux/macOS
  人工矩阵、屏幕阅读器或完整 Vimium 手工验收；默认右键手势模式会从会话开始抑制 Chromium
  原生菜单，关闭设置可保留原生菜单但可能与右键轨迹冲突。项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送；测试脚本使用的临时浏览器、fixture
  服务和 profile 已由结束路径清理。
- 下一步：待可操作的人工环境中重新加载当前扩展，分别验证默认右键轨迹不弹菜单、关闭菜单抑制后原生右键可用；继续保留平台、辅助技术、认证态站点和真实旧
  CRX 更新门禁未完成的状态。
- 对应提交：无。

## 2026-08-29 / 当前 checkout 旧版设置迁移隔离 E2E 复核 / E-132

- 授权边界：本轮只使用当前 checkout、`Extensions.loadUnpacked`、临时 Chrome profile 和脚本创建的本地
  fixture 服务复核旧版设置/导出迁移，不使用日常浏览器 profile，不登录或读取
  Cookie、Token、密码和个人浏览数据，没有提交、推送、发布或修改外部路径。
- 本轮实际命令与结果：`BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js`
  退出码 0；临时扩展 ID 为 `fphpoleocahngmcgdaccfnfgkgjjlocn`。当前 checkout 隔离 E2E
  通过设置页键盘/导航语义、设置保存与放弃、导出、有效导入取消/确认、非法
  JSON、未知字段、旧版导出格式、旧版存储键与会话覆盖、本地指针资源迁移、网站规则
  Glob/正则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
- 结果边界：这是临时 profile 的 CDP
  隔离自动化证据，明确证明当前代码的旧版设置/导出迁移链可运行；它不等于用户真实 profile 的旧 CRX
  安装更新、不等于人工导入确认、不等于四平台人工矩阵或屏幕阅读器验收。项目仍暂不发布。
- 当前状态：本轮未修改运行时代码；脚本结束路径清理了临时浏览器、fixture
  服务和下载状态，工作区继续保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：保留本轮自动化结果，继续取得真正临时 Chrome profile
  上的人工导入/导出与平台/辅助技术证据；真实旧 CRX 更新门禁仍需可操作的安装确认环境，不能用本轮隔离
  E2E 代替。
- 对应提交：无。

## 2026-08-29 / Computer Use 恢复后的设置页实时 UI 核对与导入边界 / E-131

- 授权边界：用户报告 Computer Use 已修复，并明确允许继续使用当前 Mac
  Chrome；本轮只在可见的浏览器工具箱扩展页和文件选择器中做实时 UI 核对。当前可见 Chrome
  窗口含有已有书签和普通网页标签，因此没有保存设置、导出配置、选择文件、导入配置或读取登录态、Cookie、Token、密码和个人浏览数据，没有提交、推送、发布或修改外部路径。
- 本轮实际操作与结果：按 Computer Use 规范初始化
  `@oai/sky`，`sky.get_app_state({ app: "com.google.Chrome" })`
  成功返回界面树和截图；在普通网页打开浏览器工具箱面板并进入
  `pages/mouse_options.html`。六个一级分类均可展开，导航与键盘包含“常规/键盘导航”，鼠标与拖拽包含“鼠标手势/超级拖拽/滚轮与摇杆”，站点与隐私包含“站点规则/隐私”，备份与关于包含“备份与恢复/关于与许可证”；设置搜索输入“站点规则”后只保留对应分类并可进入站点规则页面。站点规则匹配菜单实际显示“Glob
  通配式”和“正则表达式”，临时选择正则后已通过“放弃修改”恢复；待测试网址
  `https://docs.google.com/document/d/test` 的实时解释命中
  `https://docs.google.com/*`，并列出最终停用模块。备份页实际显示导入/导出入口、未知字段处理说明和“未选择任何文件”；打开系统文件选择器后只检查到选择器，没有选择文件，随后取消，未出现需要点击的扩展文件访问或其他权限提示。
- 隔离边界：曾尝试启动明确的 `/tmp` 临时 Chrome profile，但 Computer Use 仍只返回当前已有 Chrome
  窗口，未将临时窗口作为可操作目标；临时 Chrome 进程和目录已停止、清理。因此本轮没有把当前 profile
  当作临时 profile 执行旧版设置导入，也没有声称 M-10/M-11 已完成人工验收。
- 结果边界：本轮证明设置页多级导航、分区搜索、站点规则 Glob/正则选择、匹配解释和备份入口在 Computer
  Use 实时 UI 中可见可操作；这是代理操作的实时 UI 证据，不是人工手工矩阵、屏幕阅读器、200%
  缩放/高对比度/低动效或真实旧版本 CRX
  更新验收。旧版导出/存储键/指针资源迁移仍以隔离自动化记录为补充，人工导入确认保持未完成，项目仍暂不发布。
- 当前状态：本轮未修改运行时代码；工作区继续保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：需要让 Computer Use 能明确操作真正的临时 Chrome profile 后，再用迁移前设置/导出 fixture
  执行 M-10/M-11
  的上传、取消、确认和回读；随后继续四平台人工矩阵、屏幕阅读器、高对比度/缩放/低动效和真实旧 CRX
  更新门禁。当前不把 E-125/E-122 的隔离自动化结果升级为人工通过。
- 对应提交：无。

## 2026-08-29 / 用户要求再次调用 Computer Use 的版本不匹配复现 / E-130

- 授权边界：用户明确要求直接调用 Computer Use 操作当前 Mac Chrome；本轮只尝试读取 Chrome
  界面状态，没有点击、输入或导航，没有读取或修改 Chrome
  页面数据，也没有提交、推送、发布或修改外部路径。
- 本轮实际操作与结果：按 Computer Use 规范初始化 `@oai/sky` 后调用
  `sky.get_app_state({ app: "com.google.Chrome" })`，仍返回
  `The Computer Use server and client have a version mismatch. To use Computer Use, ask the user to relaunch their ChatGPT app so that the client will be updated to the latest version.`；未获得可操作的界面树或截图，因此没有执行任何
  UI 动作。
- 结果边界：这是同一工具故障的再次实际复现，不是 BrowserToolbox 运行时失败，也不构成 Chrome
  设置页、屏幕阅读器或人工矩阵验收；项目仍暂不发布。
- 当前状态：未修改运行时代码；工作区继续保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：需要更新/重新安装 ChatGPT/Codex 桌面应用或恢复匹配的 Computer Use
  服务端；在工具恢复前，继续使用 Chrome 普通页面连接只能做实时 UI smoke check，不能操作
  `chrome-extension://` 设置页。
- 对应提交：无。

## 2026-08-29 / 用户打开扩展设置页后的扩展 URL 策略拦截 / E-129

- 授权边界：用户明确允许直接使用 Mac Chrome，并已手动打开当前扩展的 Options
  页面；本轮只读取标签页元数据，没有读取或操作其他页面、登录态、Cookie、Token、密码或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 本轮实际操作与结果：Chrome 连接通道读取到精确标签页 `Vimium Options`，URL 为当前扩展的
  `chrome-extension://dllheapdmjnjdjdapmankpdnnnegihmj/pages/options.html`。尝试认领该用户标签页并读取可见
  DOM 时，浏览器返回
  `Browser use rejected this action due to browser security policy`，明确禁止访问该
  `chrome-extension://` 页面；本轮没有点击设置控件，也没有采用 raw CDP、AppleScript、shell
  自动化、内置浏览器或其他绕过方式。
- 结果边界：用户已完成“打开设置页”这一步，但当前 Chrome
  连接无法读取或操作扩展页本身；因此没有形成多级导航、网站规则、正则、导入导出、无障碍或完整人工矩阵证据，项目仍暂不发布。
- 当前状态：未修改运行时代码；工作区继续保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：只能由用户手动完成扩展页内的设置验收，或恢复可访问扩展页的 Computer Use
  客户端/服务端；若恢复后仍受策略限制，继续保持人工门禁未完成，不能把自动化 E2E 结果升级为人工通过。
- 对应提交：无。

## 2026-08-29 / Mac Chrome 扩展加载后的实时 UI smoke check / E-128

- 授权边界：用户明确允许直接使用 Mac Chrome；本轮只在同一 profile 新建的测试标签页中打开本地 fixture
  和测试产生的 `example.com` 标签页，未操作用户原有页面，没有登录、上传、下载、保存密码或读取
  Cookie/Token，也没有提交、推送、发布或修改外部路径。
- 本轮实际操作与结果：通过已恢复的 Chrome 浏览器连接，在 `basic-links.html` 上按 `f`
  后截图确认链接提示可见；使用左向拖动执行 Super Drag，随后新开后台标签页加载
  `https://example.com/`，核对标题后关闭该测试标签页。打开 `inputs.html`，在普通文本框写入
  `safe-test` 后按 `j`，实际值为 `safe-testj`；打开 `contenteditable.html`，写入 `safe-edit` 后按
  `j`，实际内容为 `safe-editj`。打开 `iframes.html`，跨 frame 的链接提示截图可见，按 `Esc`
  后提示消失；其中一次语义按键调用返回 detached
  错误，但后续截图确认页面已进入提示状态，未盲目重复调用。
- 本地测试服务：`python3 -m http.server 8765 --bind 127.0.0.1` 仅服务
  `tests/fixtures/`，本轮结束时已停止，未新增或修改 fixture 文件。
- 结果边界：这是当前 macOS Chrome 实例中的代理操作实时 UI smoke
  check，不是人工手工矩阵；没有形成扩展版本/ID完整记录、设置页完整操作、四平台矩阵、VoiceOver、200%缩放/高对比度/低动效、认证态站点或完整
  Vimium 手工回归证据，不能把本条标为人工通过，项目仍暂不发布。
- 当前状态：未修改运行时代码；工作区保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：若要继续设置页和导入导出人工路径，需要用户在 Chrome 中手动打开当前扩展的 options
  页面（浏览器连接策略不允许代理导航
  `chrome://extensions`）；随后可继续在普通本地页面做可见验证，人工矩阵仍需按清单单独记录。
- 对应提交：无。

## 2026-08-29 / 直接连接 Mac Chrome 后的扩展页策略拦截 / E-127

- 授权边界：用户明确允许本轮直接使用 Mac Chrome；按授权打开了一个 `Default` profile 的空白 Chrome
  窗口，但没有读取或操作已有页面、登录态、Cookie、Token、密码或浏览历史，没有提交、推送、发布或修改外部路径。
- 本轮实际操作与结果：`node scripts/open-chrome-window.js --browser chrome` 退出码 0，打开 `Default`
  profile 的 `about:blank`；Chrome 浏览器连接建立成功并读取到该空白标签页。随后尝试导航到
  `chrome://extensions`
  检查/加载扩展时，被浏览器安全策略拒绝（`Browser use rejected this action due to browser security policy`）；根据策略未改用
  raw CDP、AppleScript、shell 自动化或其他绕过方式，因此没有安装或启用任何扩展，也没有点击权限提示。
- 结果边界：本轮证明 Mac Chrome 连接本身已恢复，但无法通过当前浏览器通道访问 Chrome
  内部扩展管理页；没有形成 BrowserToolbox 的 Chrome
  人工验收、文件导入“允许”提示处理、屏幕阅读器或平台矩阵证据。该连接结果不能写成手工通过，项目仍暂不发布。
- 当前状态：未修改运行时代码；只新增了本条进度记录；工作区保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：需要用户在 Chrome 的扩展管理界面手动完成一次扩展加载/启用，或提供可访问的 Computer Use
  界面；完成后再在当前 Chrome 页面执行可见 UI 验收。未知安全提示、账号、验证码和证书警告仍不点击。
- 对应提交：无。

## 2026-08-29 / 重启后再次尝试 Chrome 临时 profile 人工验收 / E-126

- 授权边界：用户已明确允许本轮使用临时 Chrome profile 继续人工验收；本轮未打开或操作日常 Chrome
  profile，没有触碰登录态、Cookie、Token 或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 本轮实际操作与结果：重置控制内核后再次调用
  `sky.get_app_state({ app: "com.google.Chrome" })`，仍返回
  `The Computer Use server and client have a version mismatch. To use Computer Use, ask the user to relaunch their ChatGPT app so that the client will be updated to the latest version.`；通过
  Chrome 浏览器连接通道调用 `agent.browsers.get("chrome")` 返回
  `Browser is not available: chrome`。随后只读调用 `agent.browsers.list()`，当前仅有 Codex In-app
  Browser；未得到可操作的 Chrome 界面，因此没有点击任何按钮，也没有出现可核对的文件导入“允许”提示。
- 连接诊断实际结果：`node scripts/chrome-is-running.js --browser chrome --check` 退出码 0，Google
  Chrome 正在运行；`node scripts/installed-browsers.js --json` 显示 macOS Chrome
  `152.0.7977.64`；`node scripts/check-extension-installed.js --browser chrome --json` 退出码
  0，ChatGPT 浏览器扩展仅在 Chrome `Default` profile
  中已安装且启用；`node scripts/check-native-host-manifest.js --browser chrome --json` 退出码
  0，原生连接配置正确。`node scripts/open-chrome-window.js --browser chrome --dry-run --json`
  仅显示会打开 `Default` profile，本轮未执行该启动动作，以免把日常 profile 当作临时 profile 使用。
- 文档修改后的最终自动回归：`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  退出码 0，单元 `434/434`、DOM `109/109`；`deno test -A tests/browser_toolbox/` 退出码 0，shoulda
  `184/184`；`deno run -A scripts/audit_technical_rename.js`、`deno run -A scripts/audit_permissions.js`、`deno run -A scripts/audit_network_usage.js`
  和 `git diff --check` 均退出码 0。
- 结果边界：重启后工具版本不匹配问题仍未解除；本轮没有形成 macOS Chrome 临时 profile
  人工矩阵、VoiceOver、人工高对比度/200% 缩放/低动效或完整 Vimium
  手工回归证据，也没有人工处理文件导入权限提示。自动化 E2E
  和连接诊断不能写成手工通过，项目仍暂不发布。
- 当前状态：未修改运行时代码；未产生新的浏览器外部写入；工作区继续保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：需要在 Chrome 临时 profile 中安装并启用可连接的 ChatGPT 浏览器扩展，或恢复可用的 Computer
  Use 客户端/服务端连接；完成连接后再按 `docs/manual-acceptance.md`
  逐项取得实际人工证据。未获得可操作界面前保持人工门禁未完成。
- 对应提交：无。

## 2026-08-29 / 当前归档 macOS Chrome Stable 隔离 E2E 最终复核 / E-125

- 授权边界：本轮只使用当前 checkout、临时 Chrome profile、`Extensions.loadUnpacked` 和本地 fixture
  服务复核当前归档；没有使用日常浏览器 profile、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 本轮实际命令与结果：`BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js`
  退出码 0，临时扩展 ID 为
  `fphpoleocahngmcgdaccfnfgkgjjlocn`；当前归档通过动作页限制提示、设置页键盘/自动化语义、标签页列表、四向/八向轨迹、轨迹超时与摇杆冲突、左右键触发、超级拖拽及自定义搜索、滚轮/摇杆、跨
  frame、原生输入保护、运行时网站规则、全局模块开关、设置保存、有效/非法/未知字段导入、旧版导出格式与存储键/指针资源迁移、Vimium
  备份、逐级迁移、本地 PNG 指针、恢复默认、fixtures 和 Service Worker 重启。
- 文档修改后的最终自动回归：`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  退出码 0，单元 `434/434`、DOM `109/109`；`deno test -A tests/browser_toolbox/` 退出码 0，shoulda
  `184/184`；`deno run -A scripts/audit_technical_rename.js`、`deno run -A scripts/audit_permissions.js`、`deno run -A scripts/audit_network_usage.js`
  和 `git diff --check` 均退出码 0。
- 结果边界：这是当前 checkout 的 Chrome Stable CDP 隔离自动化证据，不是
  Chrome、Edge、Windows、macOS、Linux 人工矩阵，也不是屏幕阅读器、高对比度/缩放、认证态站点、完整
  Vimium 手工回归或真实旧 CRX
  用户环境验收；本轮没有出现文件导入“允许”提示，人工门禁保持未完成，项目仍暂不发布。
- 当前状态：本轮没有运行时代码修改；E2E 使用的临时 profile、fixture
  服务和浏览器进程由脚本结束路径清理；工作区保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有创建提交或推送。
- 下一步：只剩等待可操作的 Computer Use 环境后，按 `docs/manual-acceptance.md`
  完成四平台人工矩阵、屏幕阅读器和真实旧 CRX 更新门禁，不把本轮 CDP 结果升级为人工通过。
- 对应提交：无。

## 2026-08-29 / 当前 checkout 产物重复构建与归档哈希复核 / E-124

- 授权边界：本轮只在当前工作区重新生成本地运行时包、源码包及浏览器目标归档，未发布、上传或修改外部路径，没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人数据。
- 本轮实际命令与结果：`./make.js package` 退出码 0，命令列表与 `dist/vimium` 运行时归档保持
  current；连续两次 `deno run -A scripts/build_release.js --package` 均退出码 0，发布检查通过并生成
  `dist/browser-toolbox-0.1.0.zip` 与 `dist/browser-toolbox-source-0.1.0.zip`。随后使用
  `shasum -a 256` 核对五个 0.1.0 归档，两次构建哈希一致：运行时
  `197e0d03a582701a4ae2f6320084c85eeed33f9d7f2306c7596e50f6de2fd1de`、源码
  `4899fa5fdbe7982a77afa7d8ed854f7076c0646e750c5c59785f8f5ac38203ba`、Chrome
  `b5c97f643b6d52044e1a99935156e16c33fb97e516cda44b4b54bc1f0b81eb3b`、Firefox
  `00b57c6b7c267d65b13ec72643033a77cbb8ecb1dff5d4d1a9bfccf5444f01fc`、Canary
  `7705a8c4c41dd8ef1f86f5081a8d728e35e6acb460f75405b5530a571cd62500`。
- 进度文档修改后的最终复核：`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  退出码 0，单元 `434/434`、DOM `109/109`；`deno test -A tests/browser_toolbox/` 退出码 0，shoulda
  `184/184`；`git diff --check` 退出码 0。
- 结果边界：这是当前未提交 checkout 的可复现构建与内容审计证据，不代表源码、归档和某个提交 SHA
  已固定对应，也不代表生产签名、商店上传、旧用户 profile
  更新或平台/辅助技术人工验收；项目仍暂不发布。
- 当前状态：本轮没有运行时代码修改，没有创建提交或推送；工作区继续保留所有既有未提交修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`。
- 下一步：继续保留当前自动化门禁结果，待 Computer Use
  客户端与服务端匹配后再补做人工平台、屏幕阅读器和真实旧 CRX
  安装更新门禁，不把本轮产物复核升级为人工验收。
- 对应提交：无。

## 2026-08-29 / macOS 人工界面操作尝试与文件访问提示边界 / E-123

- 授权边界：用户明确允许在当前任务中代为处理当前扩展、临时 profile
  的文件访问“允许”提示；该授权不扩展到无法确认来源的安装、账号、密码、验证码、证书或其他安全权限提示，也不构成任务结束后的后台监控授权。本轮未接触日常浏览器
  profile、登录态、Cookie、Token 或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 本轮实际操作与结果：通过 Computer Use 读取本机 Chrome `com.google.Chrome` 的可访问状态，调用
  `sky.get_app_state({ app: "com.google.Chrome" })` 时返回
  `The Computer Use server and client have a version mismatch. To use Computer Use, ask the user to relaunch their ChatGPT app so that the client will be updated to the latest version.`；未得到可操作界面，因此没有点击任何按钮，也没有出现可核对的文件导入“允许”提示。
- 文档修改后实际复核：`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  退出码 0，单元 `434/434`、DOM `109/109`；`deno test -A tests/browser_toolbox/` 退出码 0，shoulda
  `184/184`；`git diff --check` 退出码 0。
- 结果边界：本轮没有形成 macOS Chrome Stable 人工矩阵、VoiceOver、人工高对比度/200%
  缩放/低动效或完整 Vimium 手工回归证据；自动化 E2E、隔离 profile
  和本次工具错误均不能写成手工通过，项目仍暂不发布。
- 当前状态：未修改运行时代码，临时测试状态没有新增外部写入；HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，工作区继续保留所有未提交修改，没有创建提交或推送。
- 下一步：需要重启 Codex/ChatGPT 桌面应用使 Computer Use
  客户端与服务端版本匹配，并在活动任务中重新读取界面；只有确认提示属于当前扩展和临时 profile
  时才可点击，未知安全提示必须停止并记录。任务结束后不能继续后台监控或代点后续弹窗。
- 对应提交：无。

## 2026-08-29 / 当前目录重命名后的旧 CRX 同 ID 升级与持久化设置迁移 / E-122

- 授权边界：本轮只在明确的 `/tmp/browser-toolbox-crx-current.rMbOnC` 临时目录和
  `browser-toolbox-crx-current-rmbonc` 临时容器中验证当前目录重命名后的旧 CRX 同 ID
  升级及持久化设置迁移；没有触碰日常浏览器 profile、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 测试材料：从当前 `dist/open-key-mouse-0.1.0.zip` 和 `dist/browser-toolbox-0.1.0.zip`
  解包；只在临时目录把当前 manifest 版本改为 `0.1.1`，使用临时 RSA 测试密钥分别打包旧/当前 CRX。两份
  CRX 的扩展 ID 均为 `neebbleldenkkhiffomnlopcdejaegnf`，旧/当前测试 CRX SHA-256 分别为
  `25d869b6b78bca63b4062a85bb0b3c5e465a012b36fd6b6c5b6bc3eaeef56312`、`ec27d411b2f7554cf1037c647e8853635ce88926d4174af7bd7401866cc1b3d4`；测试密钥、CRX
  和 profile 均未进入仓库。
- 本轮实际命令与结果：

```text
unzip -q dist/open-key-mouse-0.1.0.zip -d /tmp/browser-toolbox-crx-current.rMbOnC/old
unzip -q dist/browser-toolbox-0.1.0.zip -d /tmp/browser-toolbox-crx-current.rMbOnC/current
perl -0pi -e 's/"version": "0.1.0"/"version": "0.1.1"/' /tmp/browser-toolbox-crx-current.rMbOnC/current/manifest.json
openssl genrsa -traditional -out /tmp/browser-toolbox-crx-current.rMbOnC/test.pem 2048
openssl pkcs8 -topk8 -nocrypt -in /tmp/browser-toolbox-crx-current.rMbOnC/test.pem -out /tmp/browser-toolbox-crx-current.rMbOnC/test-pkcs8.pem
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --pack-extension=/tmp/browser-toolbox-crx-current.rMbOnC/old --pack-extension-key=/tmp/browser-toolbox-crx-current.rMbOnC/test-pkcs8.pem
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --pack-extension=/tmp/browser-toolbox-crx-current.rMbOnC/current --pack-extension-key=/tmp/browser-toolbox-crx-current.rMbOnC/test-pkcs8.pem
  两次退出码均为 0；同一临时测试密钥得到同一扩展 ID。
docker run --name browser-toolbox-crx-current-rmbonc --shm-size=2g -p 9452:9222 -v /tmp/browser-toolbox-crx-current.rMbOnC:/crx debian:trixie-slim sleep infinity
docker exec browser-toolbox-crx-current-rmbonc sh -c 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends chromium curl ca-certificates socat'
  退出码 0；Debian amd64 Chromium 151.0.7922.173 临时环境准备完成。
docker cp /tmp/browser-toolbox-crx-current.rMbOnC/external.json browser-toolbox-crx-current-rmbonc:/usr/share/chromium/extensions/neebbleldenkkhiffomnlopcdejaegnf.json
docker exec -d browser-toolbox-crx-current-rmbonc chromium --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --no-first-run --no-default-browser-check --user-data-dir=/crx/profile-legacy-sequence --remote-debugging-port=9223 about:blank
docker exec -d browser-toolbox-crx-current-rmbonc socat TCP-LISTEN:9222,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9223
  旧 JSON 指向 `old.crx`/`0.1.0` 时，`chrome://extensions-internals` 读取到同 ID 的活动目录 `.../0.1.0_0`。
agent-browser --cdp 9452 open chrome-extension://neebbleldenkkhiffomnlopcdejaegnf/pages/mouse_options.html
agent-browser --cdp 9452 eval --stdin
  在旧包页面写入 `openKeyMouseSettings` schema 0、`openKeyMouseSessionOverrides`、`openKeyMouseCursor-legacy-asset`；退出码 0，写入后旧键/旧资源仍可读取。
  将临时外部 JSON 切换到 `current.crx`/`0.1.1`，停止并重新启动同一个临时 profile；`chrome://extensions-internals` 读取到活动目录 `neebbleldenkkhiffomnlopcdejaegnf/0.1.1_0`，扩展 ID 未改变。
agent-browser --cdp 9452 open chrome-extension://neebbleldenkkhiffomnlopcdejaegnf/pages/mouse_options.html
agent-browser --cdp 9452 eval --stdin
  当前包读取到 `schemaVersion=4`、旧绑定命令 `BrowserToolbox.newWindow` 和旧指针资源 ID；旧设置键仍保留，旧迁移备份 schema 0、当前迁移备份 schema 3 均可读，当前设置已经进入规范键。完整浏览器重启会清空 `chrome.storage.session`，因此本轮没有把旧会话覆盖跨重启记为通过。
docker exec browser-toolbox-crx-current-rmbonc pkill -KILL -f -- '--user-data-dir=/crx/profile-'
docker stop browser-toolbox-crx-current-rmbonc
docker rm browser-toolbox-crx-current-rmbonc
/usr/bin/trash /tmp/browser-toolbox-crx-current.rMbOnC
  临时 Chromium、容器、测试密钥、CRX、profile 和端口均已清理。
```

- 结果边界：这是当前目录重命名后的隔离自动化证据，证明旧包与当前包可用同一测试密钥保持扩展
  ID，并能把持久化旧设置带入当前 schema；导出 JSON 的当前 checkout 迁移仍以 E-121 的真实扩展 E2E
  为证据。临时测试密钥、临时 profile、本地外部扩展 JSON 和浏览器重启路径不代表生产签名
  CRX、真实旧用户 profile、商店更新通道或人工安装更新验收，`O-005` 仍保持 `IN_PROGRESS`。
- 人工检查边界：本轮没有出现文件导入“允许”提示，也没有执行认证态站点、屏幕阅读器、高对比度/200%
  缩放/低动效人工检查、完整 Vimium 手工回归或 Chrome/Edge/Windows/macOS/Linux
  人工矩阵；自动化结果不升级为人工验收，项目仍暂不发布。
- 当前状态：本轮没有运行时代码修改；HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交修改，没有创建提交或推送。
- 下一步：保留当前 post-rename CRX 隔离证据，待取得合规的生产签名旧 CRX/真实迁移 profile
  和可操作的人工验收环境后，再补做生产更新、会话覆盖和平台/辅助技术门禁；在此之前不改变 `O-005`
  或发布状态。
- 对应提交：无。

## 2026-08-29 / 跨存储切换异步回归复核与不安全清理策略撤回 / E-121

- 授权边界：本轮只复核旧设置迁移相关的跨 `storage.local`/`storage.sync`
  行为并补充自动回归断言；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。
- 发现与处理：曾尝试在仓库加载阶段自动清理两个存储区域同时存在的规范配置副本。当前 checkout 的
  Chrome Stable 隔离 E2E
  在“关闭同步后再恢复同步”场景发现该策略会把跨区域写入“先写新区域、再删旧区域”窗口中的旧值写回，导致本地副本无法删除。该运行时策略已在最终验证前撤回，没有保留调试日志或不安全的迁移写入；保留现有跨区域写入/回滚实现，并在仓库单测中等待异步
  `storage.onChanged` 事件后断言旧区域最终为空，防止回归。
- 本轮实际自动门禁：

```text
deno fmt --check background_scripts/browser_toolbox/settings_repository.js background_scripts/browser_toolbox/settings_storage.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/settings_repository_test.js
  退出码 0；4 个目标文件格式检查通过。
deno check background_scripts/browser_toolbox/settings_repository.js background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_repository_test.js scripts/e2e_browser_toolbox.js
  退出码 0。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 434/434、DOM 109/109，总计 543/543。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 184/184。
deno run -A scripts/audit_technical_rename.js
  退出码 0；旧标识仅存在于兼容层、兼容 fixture/测试和历史记录。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 34 个新增模块，通过。
./make.js package
  退出码 0；当前 BrowserToolbox 运行时归档生成完成。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档通过设置保存、同步/本地切换、旧版导出与存储迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、设计文档 fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次退出码均为 0；末次生成归档的 BrowserToolbox、源码、Chrome、Firefox、Canary SHA-256 分别为 `197e0d03a582701a4ae2f6320084c85eeed33f9d7f2306c7596e50f6de2fd1de`、`4899fa5fdbe7982a77afa7d8ed854f7076c0646e750c5c59785f8f5ac38203ba`、`b5c97f643b6d52044e1a99935156e16c33fb97e516cda44b4b54bc1f0b81eb3b`、`00b57c6b7c267d65b13ec72643033a77cbb8ecb1dff5d4d1a9bfccf5444f01fc`、`7705a8c4c41dd8ef1f86f5081a8d728e35e6acb460f75405b5530a571cd62500`。
git diff --check
  退出码 0。
```

- 失败尝试记录：首次包含重复规范副本清理策略的隔离 E2E 在 `scripts/e2e_browser_toolbox.js:1428`
  失败；随后撤回该运行时策略并重新打包、重跑当前归档，最终 E2E 退出码
  0。该失败是本轮识别出的真实竞态风险，不计为通过证据。
- 人工检查边界：本轮没有出现文件导入“允许”提示，也没有执行认证态站点、屏幕阅读器、高对比度/200%
  缩放/低动效人工检查、完整 Vimium 手工回归、真实旧 CRX 安装更新或 Chrome/Edge/Windows/macOS/Linux
  人工矩阵；自动化结果不升级为人工验收，项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：保持跨区域写入的顺序和回滚边界，不再用无事务标记的加载期重复副本清理；待有可操作平台后继续真实旧
  CRX 更新、屏幕阅读器和人工平台矩阵门禁。
- 对应提交：无。

## 2026-08-29 / Windows 隔离验收环境复核 / E-119

- 授权边界：本轮只尝试启动已经存在且明确命名的 Windows 隔离 VM，以判断是否能继续当前 checkout
  的平台验证；没有访问日常浏览器、用户 profile、凭证、Cookie 或外部发布渠道，没有提交、推送或发布。
- 实际执行命令：

  prlctl list -a prlctl start OpenKeyMouse-Windows-Isolated prlctl status
  OpenKeyMouse-Windows-Isolated prlctl exec OpenKeyMouse-Windows-Isolated --current-user -- cmd.exe
  /c ver sleep 10; prlctl status OpenKeyMouse-Windows-Isolated; prlctl exec
  OpenKeyMouse-Windows-Isolated --current-user -- cmd.exe /c ver prlctl stop
  OpenKeyMouse-Windows-Isolated prlctl list -a git diff --check deno run -A
  scripts/audit_technical_rename.js

- 实际结果：VM 可以启动并显示 `running`，但两次来宾 `cmd.exe /c ver` 均无输出，等待后以退出码 2
  返回；来宾执行通道未就绪，未能取得 Windows 版本、浏览器版本或扩展运行态，因此没有运行 Windows
  E2E，也没有形成 Windows 人工验收证据。VM 已正常停止，最终状态为
  `stopped`；技术标识审计和差异检查通过。
- 人工检查边界：本轮没有点击文件导入“允许”或其他系统按钮；Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、高对比度/200% 缩放/低动效、认证态站点、完整 Vimium 手工回归和真实旧 CRX
  更新证据仍未完成，项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：需要来宾 Tools/可用桌面或其他可操作的 Windows 测试环境后，按 `docs/manual-acceptance.md`
  重新执行；在此之前不把 VM 启动成功或历史隔离结果前移为当前平台验收。
- 对应提交：无。

## 2026-08-29 / 技术标识审计负向路径自测 / E-120

- 授权边界：本轮只在仓库根目录创建并删除一个明确的临时哨兵文件，用于验证技术标识审计会拒绝非兼容位置的旧名称；没有修改产品代码、用户数据、外部路径或发布产物，没有提交、推送或发布。
- 实际执行命令：

  deno run -A scripts/audit_technical_rename.js apply_patch：创建
  `.tmp-rename-audit-sentinel`，内容包含旧 `OpenKeyMouse` 标识 deno run -A
  scripts/audit_technical_rename.js apply_patch：删除 `.tmp-rename-audit-sentinel` deno run -A
  scripts/audit_technical_rename.js git diff --check git status --short --branch git rev-parse HEAD
  PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js
  test deno test -A tests/browser_toolbox/ deno run -A scripts/audit_permissions.js deno run -A
  scripts/audit_network_usage.js

- 实际结果：加入哨兵文件后技术标识审计按预期以退出码 1 失败，并报告
  `.tmp-rename-audit-sentinel:1`；删除哨兵后审计以退出码 0 通过，确认旧标识仍只在兼容层、兼容
  fixture/测试和历史记录中出现。随后当前 checkout 的单元测试 `434/434`、DOM 测试 `109/109`、独立
  shoulda `184/184`、权限审计 9 项和网络审计 34 个新增模块均通过。`git diff --check`
  通过，工作区原有未提交修改仍保留，HEAD 仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`。
- 风险与边界：本轮哨兵只验证审计拒绝路径，不新增功能，也不替代单元/DOM/shoulda、平台隔离 E2E、真实旧
  CRX 更新、屏幕阅读器或人工平台矩阵；项目仍暂不发布。本轮没有出现文件导入“允许”提示。
- 下一步：继续等待可操作的真实平台和辅助技术环境，按 `docs/manual-acceptance.md`
  完成剩余人工门禁；在此之前保持发布清单最后一项未勾选。
- 对应提交：无。

## 2026-08-29 / 技术标识边界审计与发布归档复核 / E-118

- 授权边界：本轮只增加技术标识迁移审计并把它接入发布检查；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。
- 缺口与修正：此前只能依靠人工检索确认旧 `OpenKeyMouse` 名称没有扩散到新运行时；现新增
  `scripts/audit_technical_rename.js`，逐文件扫描当前源码树，明确允许旧名称存在于兼容迁移层、兼容测试/fixture
  和历史文档，其他文件一旦出现即失败。`scripts/build_release.js` 在发布检查阶段强制执行该审计。
- 实际执行命令：

  deno fmt scripts/audit_technical_rename.js scripts/build_release.js deno fmt --check
  scripts/audit_technical_rename.js scripts/build_release.js deno check
  scripts/audit_technical_rename.js scripts/build_release.js deno run -A
  scripts/audit_technical_rename.js git diff --check PUPPETEER_EXECUTABLE_PATH="/Applications/Google
  Chrome.app/Contents/MacOS/Google Chrome" ./make.js test deno test -A tests/browser_toolbox/
  ./make.js package deno run -A scripts/build_release.js --package
  BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google
  Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env
  --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js deno run -A
  scripts/build_release.js --package deno run -A scripts/build_release.js --package shasum -a 256
  dist/browser-toolbox-0.1.0.zip dist/browser-toolbox-source-0.1.0.zip
  dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip
  dist/chrome-canary/vimium-canary-0.1.0.zip

- 测试结果：技术标识审计、目标文件格式/类型/差异检查通过；当前 checkout 单元 434/434、DOM
  109/109，总计 543/543，独立 shoulda 测试 184/184。发布检查阶段的权限审计 9 项、网络审计 34
  个新增模块和技术标识审计均通过；打包连续两次归档哈希一致。
- 运行态结果：技术标识审计确认旧名称只出现在兼容迁移层、兼容测试/fixture 和历史文档；最新 macOS
  Chrome Stable `Extensions.loadUnpacked` 隔离 E2E
  通过帮助页无障碍语义、设置导入导出、旧版导出迁移、旧存储键/指针资源迁移、站点规则、核心输入、跨
  frame、fixtures 和 Service Worker 重启。本轮没有出现文件导入“允许”提示。
- 产物结果：连续两次发布检查后的五个归档 SHA-256 为运行时包
  `65ef669da1713a0b183960be1cdc65e38236c4ff7fccc320cd4f3d7076948700`、源码包
  `535f5d406773ceaccf1a6005cdfc4032fdd21e7a28c6c9f90bb2ddfe11d0fec9`、Chrome
  `1033904b256ef3e617e867444a2f7c682a8a02275fd6641c42aee8e5027dc754`、Firefox
  `e5cf62ad8d4f7bf50f43f180fc227cd5a38e040f36df4bf3aa5b0b38220b82e3`、Canary
  `ac55bdb30d2d961f1b36f864a1c7ff07672c8701fc8e96d5f5e03558e287bb10`。
- 人工检查边界：本轮仍未形成 macOS/Windows/Linux/Edge 人工矩阵、VoiceOver/Narrator/NVDA/Orca
  屏幕阅读器、高对比度/200% 缩放/低动效、认证态站点、完整 Vimium 手工回归、真实用户 profile 或真实旧
  CRX 安装更新证据；自动化结果未升级为人工验收。项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：待有可操作的目标平台和辅助技术环境后，按 `docs/manual-acceptance.md`
  记录人工门禁；在此之前维持发布检查表和功能矩阵中的人工待验状态。
- 对应提交：无。

## 2026-08-29 / 帮助页对话框无障碍语义与本地化状态回归 / E-117

- 授权边界：本轮只补齐既有帮助页的对话框无障碍语义和自动化断言；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。
- 缺口与修正：帮助页原来虽然有状态播报和区域标题，但根节点没有明确声明
  `dialog`、模态状态、可访问名称与描述。现为帮助页根节点增加
  `role="dialog"`、`aria-modal`、`aria-labelledby` 和 `aria-describedby`，为标题和介绍补充稳定
  ID；单元测试增加中文语言、关闭控件名称、状态播报和各 section 标题关联断言，Chrome Stable 隔离 E2E
  增加同等语义检查。
- 实际执行命令：

  deno fmt pages/help_dialog_page.html tests/unit_tests/help_dialog_test.js
  scripts/e2e_browser_toolbox.js deno fmt --check pages/help_dialog_page.html
  tests/unit_tests/help_dialog_test.js scripts/e2e_browser_toolbox.js deno check
  pages/help_dialog_page.js tests/unit_tests/help_dialog_test.js scripts/e2e_browser_toolbox.js git
  diff --check PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google
  Chrome" ./make.js test deno test -A tests/browser_toolbox/ deno run -A
  scripts/audit_permissions.js deno run -A scripts/audit_network_usage.js ./make.js test-performance
  ./make.js package deno run -A scripts/build_release.js --package
  BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google
  Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env
  --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js shasum -a 256
  dist/browser-toolbox-0.1.0.zip dist/browser-toolbox-source-0.1.0.zip
  dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip
  dist/chrome-canary/vimium-canary-0.1.0.zip

- 测试结果：目标文件格式/类型/差异检查通过；当前 checkout 单元 434/434、DOM 109/109，总计
  543/543，独立 shoulda 测试 184/184。权限审计 9 项、网络审计 34
  个新增模块、性能回归、打包和发布检查均通过；性能回归确认空闲 pointermove 1000 次无活动手势且无
  requestAnimationFrame，100 次手势 Port 全部断开，剩余监听器和仓库订阅为 0。
- 运行态结果：macOS Chrome Stable `Extensions.loadUnpacked` 隔离 E2E
  通过帮助页标题、当前模块状态、站点规则/隐私说明、dialog/status
  无障碍语义，以及设置导入导出、旧版导出迁移、旧存储键/指针资源迁移、站点规则、核心输入、跨
  frame、fixtures 和 Service Worker 重启。本轮没有出现文件导入“允许”提示。
- 产物结果：本轮重新打包后的五个归档 SHA-256 为运行时包
  `65ef669da1713a0b183960be1cdc65e38236c4ff7fccc320cd4f3d7076948700`、源码包
  `4c73ec8841f111fdbeae9495abc9a6468805ca916749fbe3a677b1a2807fa51e`、Chrome
  `1033904b256ef3e617e8674442f7c682a8a02275fd6641c42aee8e5027dc754`、Firefox
  `e5cf62ad8d4f7bf50f43f180fc227cd5a38e040f36df4bf3aa5b0b38220b82e3`、Canary
  `ac55bdb30d2d961f1b36f864a1c7ff07672c8701fc8e96d5f5e03558e287bb10`。
- 人工检查边界：本轮仍未形成 macOS/Windows/Linux/Edge 人工矩阵、VoiceOver/Narrator/NVDA/Orca
  屏幕阅读器、高对比度/200% 缩放/低动效、认证态站点、完整 Vimium 手工回归、真实用户 profile 或真实旧
  CRX 安装更新证据；自动化结果未升级为人工验收。项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：待有可操作的目标平台和辅助技术环境后，按 `docs/manual-acceptance.md`
  记录人工门禁；旧版本设置/导出文件的自动迁移已有当前隔离 E2E，真实旧 CRX 更新语义仍需独立环境验收。
- 对应提交：无。

## 2026-08-29 / 帮助页当前状态摘要与模块说明 / E-116

- 授权边界：本轮只补齐帮助页对浏览器工具箱模块、当前页面有效状态和网站规则的说明；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。
- 缺口与修正：帮助页原来只列出 Vimium
  键位，没有解释鼠标轨迹、超级拖拽、滚轮/摇杆、逐模块网站规则、隐私边界和浏览器限制。现由顶层内容脚本复用只读运行时配置客户端，向帮助
  iframe 传递有效模块、命中的规则类型与匹配式、Vimium 排除状态；帮助页使用 textContent
  安全展示规则文本，增加可读的状态区、键盘基线说明、中英文消息（包括版本标签）、设置/隐私/许可证入口和响应式两列说明，不改变运行时开关或设置写入路径。
- 实际执行命令：

  deno fmt pages/help_dialog_page.js content_scripts/vimium_frontend.js
  tests/unit_tests/help_dialog_test.js deno fmt scripts/e2e_browser_toolbox.js deno fmt --check
  lib/i18n.js content_scripts/vimium_frontend.js pages/help_dialog_page.js
  scripts/e2e_browser_toolbox.js tests/unit_tests/help_dialog_test.js deno check lib/i18n.js
  content_scripts/vimium_frontend.js pages/help_dialog_page.js scripts/e2e_browser_toolbox.js
  tests/unit_tests/help_dialog_test.js git diff --check ./make.js test-unit
  PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js
  test deno test -A tests/browser_toolbox/ deno run -A scripts/audit_permissions.js deno run -A
  scripts/audit_network_usage.js ./make.js test-performance ./make.js package
  BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google
  Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env
  --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js deno run -A
  scripts/build_release.js --package shasum -a 256 dist/browser-toolbox-0.1.0.zip
  dist/browser-toolbox-source-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip
  dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip

- 测试结果：目标文件格式/类型/差异检查通过；修正一个新增单元测试误把 shoulda 的 assert
  对象当作函数调用后，当前 checkout 单元测试 433/433、DOM 测试 109/109，独立 shoulda 测试
  184/184。权限审计 9 项、网络审计 34 个新增模块、性能回归、./make.js package
  和发布打包检查均通过；性能结果包含空闲 pointermove 1000 次无活动手势且无
  requestAnimationFrame、100 次手势 Port 全部断开、剩余监听器/仓库订阅为 0。
- 运行态结果：当前 macOS Chrome Stable Extensions.loadUnpacked 隔离 E2E
  通过帮助入口、帮助页标题/说明、从顶层页面传入的“自定义指针已停用”状态、原有设置导入导出、旧版迁移、网站规则、核心输入、跨
  frame、fixtures 和 Service Worker 重启。第一次 E2E 断言错误地预期默认配置全部模块开启，实际状态为
  Disabled modules on this page: Custom pointer；已修正测试预期后重新运行，最终退出码为 0。
- 运行态与产物结果：最终重新打包后的五个当前归档 SHA-256 为运行时包
  5fab00b5f5a3d23c382ceb572eccd0389428bb6bd5e279fbea32c7e0c10eb791、源码包
  e31a34f5c8cf1ad403b32d489fe15d3a25cc8da5a1cff3b796e36fa2585bf58a、Chrome
  efb85b341e94f36332f14753b6c615a5f3582315744676fccca68da3b4f00dda、Firefox
  e0cc82afe5a532f836b17c07f48904bc87c176e4d61a12f20d13e82d7163fc70、Canary
  2259b704d58da7a1e1812c7d665ae1ea0802b7676ab0e31172525e02d3276680。
- 人工检查边界：本轮仍未形成 macOS/Windows/Linux/Edge 人工矩阵、VoiceOver/Narrator/NVDA/Orca
  屏幕阅读器、高对比度/200% 缩放/低动效、认证态站点、完整 Vimium 手工回归、真实用户 profile 或真实旧
  CRX 安装更新证据；自动化结果未升级为人工验收。本轮没有出现文件导入“允许”提示。项目仍暂不发布。
- 当前状态：HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：待有可操作的目标平台和辅助技术环境后，按 docs/manual-acceptance.md
  记录人工门禁；旧版本设置/导出文件的自动迁移已有当前隔离 E2E，真实旧 CRX 更新语义仍需独立环境验收。
- 对应提交：无。

## 2026-08-28 / 动作页帮助入口与当前门禁复核 / E-115

- 授权边界：本轮只补齐设计文档 §14.3 要求的动作页“打开帮助”入口及对应
  E2E；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。
- 缺口与修正：动作页原本已有 `openHelp` 本地化消息，但没有可操作入口；现新增
  `#browser-toolbox-open-help` 按钮，通过当前活动标签页顶层 frame 的既有 `runInTopFrame/showHelp`
  路由打开帮助 UI，再关闭动作弹窗。没有直接打开未建立 UIComponent 通道的帮助 iframe 页面。E2E
  同时验证按钮文案、帮助 iframe 可见、弹窗关闭后重新打开动作页以及原有会话开关继续工作。
- 实际执行命令：

```bash
deno fmt pages/action.js scripts/e2e_browser_toolbox.js
deno fmt --check pages/action.js scripts/e2e_browser_toolbox.js
deno check pages/action.js scripts/e2e_browser_toolbox.js
git diff --check
./make.js test-unit
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
./make.js test-performance
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/browser-toolbox-source-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：最终格式/类型/差异检查通过；当前 checkout 单元 `432/432`、DOM `109/109`，独立 shoulda
  `184/184`；性能回归通过（空闲 `pointermove` 1000 次无活动手势且无 `requestAnimationFrame`，100
  次手势 Port 全部断开，剩余监听器/仓库订阅均为 0）；权限审计 9 项、网络审计 34
  个新增模块、打包和连续发布检查均通过。当前 macOS Chrome Stable `Extensions.loadUnpacked` 隔离 E2E
  通过新增帮助入口及全部原有设置、迁移、站点规则、核心输入、跨 frame、fixtures 和 Service Worker
  重启场景。
- 中间情况与修正：首次 E2E 在重新打包前运行，测试入口加载的是修改前的
  `dist/vimium`，因此未发现按钮；重新执行 `./make.js package` 后，第二次 E2E
  暴露测试在动作页关闭后继续使用已分离 Frame，随后让 E2E 重新创建动作页并将 fixture 置前；最终 E2E
  退出码为 0。上述失败均已修正并保留在本轮实际过程，不计作通过证据。
- 运行态与产物结果：连续构建后的五个 SHA-256 为运行时包
  `1ff6cece0d9a88f9a3a8b3443c26ab6ffca213860274a4710304c9ef50cc5dca`、源码包
  `c7b108a192a64f9141387e4c2c61f17eb2703493879f833b2b47b4f662b1b2f6`、Chrome
  `34ab6ce4bd005f8215f78718ea5afe89d1489742eac22a79befd479fcc04351f`、Firefox
  `26c562628c04ccdbe83b85e8f56f19830572eafc4bfcf638fd7dc776094a98df`、Canary
  `01a41dfc9fe41b073683ed50feb534913229e5d465881705e2df203766f1d979`；构建前后再次复核哈希保持一致。归档中的动作页也确认包含
  `#browser-toolbox-open-help` 和 `data-i18n="openHelp"`。
- 人工检查边界：本轮尝试启动 macOS 临时 Chrome profile 做人工检查，但 Computer Use
  客户端与服务端版本不匹配，未能读取辅助功能树；只启动空白临时
  profile，随后已关闭并删除明确的临时目录，没有把它写成人工通过。VoiceOver、Windows/Linux/Edge
  人工矩阵、人工高对比度/200% 缩放/低动效、认证态站点、完整 Vimium 手工回归、真实用户 profile
  和真实旧 CRX 更新仍未完成；本轮没有出现文件导入“允许”提示。项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：待 Computer Use 客户端恢复匹配且有可操作的目标平台后，按 `docs/manual-acceptance.md`
  记录真实人工和辅助技术结果；在此之前不把隔离自动化前移为人工验收。
- 对应提交：无。

## 2026-08-28 / Windows 构建脚本参数分支修正与全量门禁复核 / E-114

- 授权边界：本轮只修正 `make.js` Windows `shell` 分支引用不存在的 `optArray`
  问题，使命令参数正确写入
  `argsArray`；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。
- 缺口与修正：Windows 分支原本在进入 `cmd.exe /c` 包装前会访问未定义变量，导致 Windows
  上的构建、测试和性能命令无法进入实际子进程；现改为对函数参数 `argsArray` 执行
  `unshift("/c", procName)`。通过源码静态断言确认旧变量不存在并确认新分支存在；本机为
  macOS，未把静态断言写成 Windows 实机验证。
- 实际执行命令：

```bash
deno fmt --check make.js
deno check make.js
rg -n 'optArray|argsArray\.unshift' make.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
./make.js test-performance
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/browser-toolbox-source-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno eval 'const s = await Deno.readTextFile("make.js"); if (s.includes("optArray")) throw new Error("旧变量仍存在"); if (!s.includes("argsArray.unshift(\"/c\", procName)")) throw new Error("Windows shell 修复缺失"); console.log("make.js Windows shell 分支静态断言通过");'
prlctl list -a
prlctl start OpenKeyMouse-Windows-Isolated
prlctl exec OpenKeyMouse-Windows-Isolated --current-user -- cmd.exe /c ver
prlctl capture OpenKeyMouse-Windows-Isolated --file /tmp/browser-toolbox-windows-current.png
prlctl stop OpenKeyMouse-Windows-Isolated
```

- 测试结果：格式检查、`deno check`、`git diff --check` 和 Windows 分支静态断言通过；当前 checkout
  `./make.js test` 为单元 `432/432`、DOM `109/109`，独立 shoulda `184/184`，性能回归通过；权限审计 9
  项、网络审计扫描 34 个新增模块、`./make.js package` 和连续两次
  `scripts/build_release.js --package` 均退出码 0。
- 运行态与产物结果：本轮只修改构建脚本，未重复执行 E-112 已通过的 macOS/Windows Chrome/Edge 运行时
  E2E；运行时包 SHA-256 保持为
  `8ec7aac50062bf22b0f1ad3471a5eb88777ca2b49a890002a3f60af61b4d690a`、`821c1ed7ea92edc2632f11ce47d52c849341df8e9e83af12a541c5ebd90bf64e`、`5a60972fbe995a291de37d813b2e18946739b033ee6012a52b7f3eb6c2936ecc`、`f3b4d325e60f2dc81880a5fb1522f84d7b8e0c57eb35bed82cf9f37d878a7e07`；源码包因包含当前源码快照而为
  `9ca45060cb44c6abcb3865b88435c5511ccf11e16940be92bfbe7038c15c8697`。
- 风险与边界：隔离 VM 虽成功启动，但 Parallels Tools 无法建立命令会话；屏幕显示为 Windows
  Sysprep/OOBE 系统准备窗口，因此没有执行或声称 Windows `make.js`
  实机分支通过，也没有点击该未知系统窗口。Windows/Edge/macOS/Linux
  手工矩阵、VoiceOver/Narrator/NVDA/Orca、人工高对比度/200% 缩放/低动效、认证态站点、完整 Vimium
  手工回归、真实用户 profile 和真实旧 CRX
  更新语义仍未完成。项目仍暂不发布，本轮没有出现文件导入“允许”提示；临时 VM 已停止，临时截图已清理。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：待有可操作的 Windows 构建环境时执行 `make.js` 实机分支复核；其余按
  `docs/manual-acceptance.md` 逐项完成人工和辅助技术门禁。
- 对应提交：无。

## 2026-08-28 / 双区域已有副本回滚回归覆盖与当前源码包复核 / E-113

- 授权边界：本轮只为 E-112
  的设置存储双侧回滚补充“两个区域均已有规范键”的可复现回归测试，并重新运行受影响的测试和当前源码/运行时打包；没有修改运行时逻辑、产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。
- 缺口与修正：新增测试先在 `storage.sync` 和 `storage.local` 写入两个不同的规范设置，模拟旧区域
  `remove`
  已删除后才抛错，确认目标区域和旧区域都恢复到操作前值；测试完成后恢复测试桩，避免污染后续用例。
- 实际执行命令：

```bash
deno fmt background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js
deno fmt --check background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js
deno check background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js
./make.js test-unit
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
./make.js package
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标文件格式和类型检查通过；单元测试 `432/432`，DOM 测试 `109/109`，独立 shoulda 测试
  `184/184`；`./make.js package`、连续两次 `scripts/build_release.js --package` 均退出码
  0。此次仅新增测试，未改运行时，因此未重复执行 E-112 已通过的 macOS/Windows Chrome/Edge 运行时
  E2E；其当前运行时归档哈希保持一致。
- 运行态与产物结果：当前源码包 SHA-256 为
  `c65dd54ddfc616b9b7145874b3ddb6436c58633409b93fed4246e558b0a56ad2`；运行时包为
  `8ec7aac50062bf22b0f1ad3471a5eb88777ca2b49a890002a3f60af61b4d690a`；Chrome 为
  `821c1ed7ea92edc2632f11ce47d52c849341df8e9e83af12a541c5ebd90bf64e`；Firefox 为
  `5a60972fbe995a291de37d813b2e18946739b033ee6012a52b7f3eb6c2936ecc`；Chrome Canary 为
  `f3b4d325e60f2dc81880a5fb1522f84d7b8e0c57eb35bed82cf9f37d878a7e07`。
- 风险与边界：本轮证据只增加自动测试覆盖，不改变人工平台矩阵、屏幕阅读器、人工高对比度/200%
  缩放/低动效、认证态站点、完整 Vimium 手工回归、真实用户 profile 和真实旧 CRX
  更新语义仍未完成的状态；项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：保持人工和真实发布门禁未完成状态；待有可访问目标平台/辅助技术环境后，按
  `docs/manual-acceptance.md` 逐项记录实际结果。
- 对应提交：无。

## 2026-08-28 / 跨区域清理异常的双侧回滚与 Windows Chrome/Edge 当前归档复验 / E-112

- 授权边界：本轮只修复已有设置存储适配层在“旧区域清理动作已经删除规范键、随后才报告失败”时的双侧回滚，并补充回归测试；随后重跑当前自动门禁和
  Windows Chrome/Edge 隔离
  E2E。没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。项目仍暂不发布。
- 缺口与修正：`background_scripts/browser_toolbox/settings_storage.js`
  在跨区域写入前同时保存目标区域和另一侧规范键的原值；目标写入或旧区域清理失败时，恢复目标区域和另一侧区域的原状态，避免旧区域清理已产生部分副作用时留下双副本或错误副本。`tests/unit_tests/browser_toolbox/settings_storage_test.js`
  新增“清理先删除后抛错仍恢复旧区域”的回归，覆盖旧区域原值恢复和目标区域不存在两项断言。
- 实际执行命令：

```bash
deno fmt
deno check
git diff --check
./make.js test-unit
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js test-performance
./make.js package
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
python3 -m http.server 59581 --bind 0.0.0.0 --directory /Users/yang/project/plugin/browser-toolbox/dist
prlctl start "OpenKeyMouse-Windows-Isolated"
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_PATH='C:\BrowserToolboxE2E-20260828-storage-rollback\extension' BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E-20260828-storage-rollback\downloads' deno run -A scripts/e2e_browser_toolbox.js
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9232 BROWSER_TOOLBOX_E2E_EXTENSION_PATH='C:\BrowserToolboxE2E-20260828-storage-rollback\extension' BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E-20260828-storage-rollback\downloads' deno run -A scripts/e2e_browser_toolbox.js
prlctl stop "OpenKeyMouse-Windows-Isolated"
```

来宾归档下载、浏览器启动、9231/9232 转发和测试清理命令均通过
`prlctl exec ... powershell.exe -NoProfile -EncodedCommand "$payload"` 执行；`$payload`
是本轮实际使用的 UTF-16LE Base64 PowerShell 脚本，作用域仅限专用 VM 的
`C:\BrowserToolboxE2E-20260828-storage-rollback`。测试结束后使用进程树结束和显式 `rmdir`
删除该目录，并移除来宾 portproxy/防火墙规则。

- 测试结果：格式、类型和差异检查通过；当前 checkout 单元测试 `431/431`，DOM 测试 `109/109`，独立
  shoulda 测试 `183/183`；性能回归通过，包含空闲 `pointermove`、100 次手势的
  DOM/Port/定时器清理、100 次初始化销毁监听器清理、10000 次 wheel、8 个 frame 和 50
  个标签页搜索。权限审计 9 项通过，网络审计扫描 34
  个新增模块文件且无后台或隐式网络调用；打包通过。最新 macOS Chrome Stable `Extensions.loadUnpacked`
  隔离 E2E 通过设置导入导出、旧版迁移、正则网站规则、核心输入、超级拖拽下载、滚轮、摇杆、跨
  frame、设计 fixtures、恢复默认和 Service Worker 重启。
- Windows 运行态结果：Windows 11 ARM64 Chrome Stable `151.0.7922.174` 和 Microsoft Edge Stable
  `151.0.4129.101` 均在临时 profile 中通过远程 CDP `Extensions.loadUnpacked`
  运行当前归档，退出码均为
  `0`；两者均覆盖扩展加载、设置导入导出、旧版存储/导出迁移、正则网站规则、核心鼠标输入、超级拖拽下载、滚轮、摇杆、跨
  frame、设计 fixtures、恢复默认和 Service Worker 重启。远程 CDP
  无法代授剪贴板权限，相关断言明确跳过；这两项是隔离自动化证据，不是 Windows/Edge 人工验收。
- 运行态与产物结果：连续两次 `scripts/build_release.js --package` 均退出码 0；五个归档 SHA-256
  为源码包 `6ed61cfa8be4bab80bc0a745a69c924519100af1ee038daf63c0282e349b709a`、运行时包
  `8ec7aac50062bf22b0f1ad3471a5eb88777ca2b49a890002a3f60af61b4d690a`、Chrome
  `821c1ed7ea92edc2632f11ce47d52c849341df8e9e83af12a541c5ebd90bf64e`、Firefox
  `5a60972fbe995a291de37d813b2e18946739b033ee6012a52b7f3eb6c2936ecc`、Chrome Canary
  `f3b4d325e60f2dc81880a5fb1522f84d7b8e0c57eb35bed82cf9f37d878a7e07`。
- 中间情况与修正：Windows 预处理命令第一次因 `prlctl exec` 的 PowerShell 嵌套引号解析失败，改用
  `-EncodedCommand` 后下载和展开成功；第一次清理因浏览器子进程仍锁定临时 profile，随后只对本轮专用
  VM 使用进程树结束并确认 `ROOT_EXISTS_AFTER_TASKKILL=False`，不计为产品失败。
- 外部状态清理：已停止本轮宿主归档 HTTP 服务，删除明确的
  `C:\BrowserToolboxE2E-20260828-storage-rollback` 来宾目录，移除 9231/9232 portproxy
  和对应防火墙规则，停止专用 Parallels VM；复核时 VM 为 stopped，9231/9232/59581/59582
  无监听。未触碰日常浏览器 profile、登录态、Cookie、Token
  或个人浏览数据。本轮没有出现文件导入“允许”提示。
- 风险与边界：本轮没有把自动化结果写成人工验收、认证站点、屏幕阅读器或跨平台手工矩阵。Windows/Edge/macOS/Linux
  人工矩阵、VoiceOver/Narrator/NVDA/Orca、人工高对比度/200% 缩放/低动效、认证态站点、完整 Vimium
  手工回归、真实用户 profile 和真实旧 CRX 更新语义仍未完成；E-023
  仍只表示物理目录移动，目录移动当时没有重新运行完整测试。本轮证据属于目录已迁移后的后续 E-112
  回归，项目仍暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：保持上述人工和真实发布门禁未完成状态；待有可访问的目标平台/辅助技术环境后，按
  `docs/manual-acceptance.md` 逐项记录人工结果，不把隔离自动化前移为人工通过。
- 对应提交：无。

## 2026-08-28 / 远程来宾扩展路径与 Windows Chrome/Edge 当前归档复验 / E-111

- 授权边界：本轮只增强隔离 E2E 入口以支持远程浏览器使用来宾扩展目录，并在既有 Parallels Windows 11
  ARM64 隔离 VM 中复验当前归档；同时修正 E-024 段落对 E-023
  测试边界的表述。没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改日常浏览器资料。
- 缺口与修正：`scripts/e2e_browser_toolbox.js` 新增 `BROWSER_TOOLBOX_E2E_EXTENSION_PATH`，远程 CDP
  连接在该参数存在且启用 `Extensions.loadUnpacked`
  时使用来宾路径加载当前扩展；本地浏览器仍使用原有宿主机路径，远程模式不再错误检查宿主机上的来宾路径。产品运行时未改变。
- 实际执行命令：

```bash
deno fmt scripts/e2e_browser_toolbox.js
deno check scripts/e2e_browser_toolbox.js
git diff --check
./make.js package
python3 -m http.server 59581 --bind 0.0.0.0 --directory /Users/yang/project/plugin/browser-toolbox/dist
prlctl start "OpenKeyMouse-Windows-Isolated"
prlctl exec "OpenKeyMouse-Windows-Isolated" --current-user powershell.exe -NoProfile -Command "下载并展开当前 chrome-store 归档到 C:\BrowserToolboxE2E-20260828-current"
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_PATH='C:\BrowserToolboxE2E-20260828-current\extension' BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E-20260828-current\downloads' deno run -A scripts/e2e_browser_toolbox.js
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9232 BROWSER_TOOLBOX_E2E_EXTENSION_PATH='C:\BrowserToolboxE2E-20260828-current\extension' BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E-20260828-current\downloads' deno run -A scripts/e2e_browser_toolbox.js
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
prlctl stop "OpenKeyMouse-Windows-Isolated" --kill
```

- 测试结果：格式、类型和差异检查通过；本机单元/DOM 为 `430/430`、`109/109`，独立 shoulda 为
  `182/182`。Windows 11 ARM64 Chrome Stable `151.0.7922.174` 和 Windows Edge Stable `151.0.4129.101`
  当前归档远程 CDP E2E 均退出码
  0，均通过扩展加载、设置导入导出、旧版迁移、正则网站规则、核心鼠标输入、超级拖拽下载、滚轮、摇杆、跨
  frame、设计 fixtures、恢复默认和 Service Worker 重启；远程 CDP
  无法代授剪贴板权限，相关断言明确跳过。
- 中间情况与修正：第一次 Windows Chrome
  远程执行在超级拖拽下载等待处超时；核对来宾下载目录为空后发现环境变量把 Windows
  路径作为双反斜杠传入。重新启动临时 profile、改用单反斜杠路径后 Chrome 和 Edge
  均通过；该失败是测试环境参数错误，不计为产品失败。
- 运行态与产物结果：连续两次 `scripts/build_release.js --package` 均退出码 0；五个归档 SHA-256
  为源码包 `8af164e12fd678dc8c6e001f23be58ca432d1c7640f32c3ef0cb77a0b53cfec0`、运行时包
  `597ba85bede0469fca8c2b717202f5ff66397f02bca7e3f2d592b4eeb495a5ff`、Chrome
  `15356df25ec1c6347455d2aab469667eedbb7b3524fb8703642aea2212705e5c`、Firefox
  `d8f1158cc05c755ffead0b3b2b1bda1238aaad228e74e181cab01eb6eaee3a64`、Chrome Canary
  `c2577156e4f143fd1f77f3c929ad8366dac2816a616539cc6c47624e55d5a6ef`。源码包包含新的远程 E2E
  参数和性能测试入口，运行时包未包含测试脚本或文档。
- 外部状态清理：已停止临时 HTTP 服务，删除明确的 `C:\BrowserToolboxE2E-20260828-current`
  来宾测试目录，移除 `9231/9232` portproxy 和对应防火墙规则，并停止专用 Parallels
  VM；普通停止一次返回操作取消，随后使用 `--kill` 完成停止。未触碰日常浏览器资料。
- 风险与边界：Windows Chrome/Edge 结果是当前归档的隔离自动化证据，不是 Windows/Edge
  人工验收；屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归、真实用户 profile
  和真实旧 CRX 更新仍未完成。E-023
  仍只表示物理目录移动，目录移动当时没有重新运行完整测试；本轮证据属于目录已迁移后的新 E-111
  回归。项目仍暂不发布，本轮没有出现文件导入“允许”提示。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留大量未提交用户修改，没有创建提交或推送。
- 下一步：在可访问的真实平台/辅助技术环境中按 `docs/manual-acceptance.md`
  补人工矩阵；在此之前不把隔离自动化标记为人工完成。
- 对应提交：无。

## 2026-08-28 / 性能回归门禁与标签页事件委托 / E-110

- 授权边界：本轮只补齐设计文档 §17 要求的性能测量入口、100
  次手势资源清理回归和标签页列表事件委托，并修正当前商标说明中对历史内部代号的非必要引用；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺口与修正：新增 `scripts/benchmark_browser_toolbox.js` 和
  `./make.js test-performance`，用可重复的 JSDOM、模拟 Runtime Port 和 50 条本地标签数据记录空闲
  `pointermove`、100 次手势后的 DOM/Port/定时器、初始化销毁监听器、长滚动、多 frame
  和标签页搜索结果。标签页列表改为列表级 `click`/`auxclick`
  事件委托，每个结果按钮不再创建长期闭包监听器；新增标签页搜索单元测试。`TRADEMARK.md`
  现只保留产品名、技术标识和第三方资产边界，不再把历史内部代号写入当前图标说明。性能脚本的环境是合成回归环境，不替代真实平台、屏幕阅读器或人工矩阵。
- 实际执行命令：

```bash
deno fmt pages/tab_list.js tests/unit_tests/browser_toolbox/tab_list_test.js scripts/benchmark_browser_toolbox.js make.js
deno fmt --check pages/tab_list.js tests/unit_tests/browser_toolbox/tab_list_test.js scripts/benchmark_browser_toolbox.js make.js
deno check pages/tab_list.js tests/unit_tests/browser_toolbox/tab_list_test.js scripts/benchmark_browser_toolbox.js make.js
git diff --check
deno run -A scripts/benchmark_browser_toolbox.js
./make.js test-performance
./make.js test-unit
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：格式、类型和差异检查通过；单元测试 `430/430`，DOM 测试 `109/109`，合计 `539/539`；独立
  shoulda 入口 `182/182`；性能回归通过。一次性能测量记录：空闲 `pointermove` `1000` 次耗时
  `5.634 ms`，未创建手势/覆盖层且 `requestAnimationFrame` 调用 `0` 次；100 次手势耗时
  `10.154 ms`、DOM 节点增长 `1`、Port 断开 `100/100`、活动 Port/手势/定时器均为 `false`；100
  次初始化销毁耗时 `3.714 ms`、最大活动监听器 `13`、剩余监听器 `0`、仓库订阅 `0`；长滚动 `10000` 个
  wheel 事件耗时 `1.751 ms` 且状态键数不超过 `1`；8 个模拟 frame 的 Port 全部断开；50
  个标签页搜索耗时 `0.945 ms`，命中标签 `49`。
- 运行态与产物结果：权限审计通过（9 项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；打包和最新 macOS Chrome Stable `Extensions.loadUnpacked`
  隔离 E2E
  通过，覆盖标签页列表、设置导入/导出、旧版迁移、网站规则、核心手势、超级拖拽、滚轮、摇杆、跨
  frame、设计文档 fixtures 和 Service Worker 重启。连续两次 `scripts/build_release.js --package`
  均退出码 0，五个归档 SHA-256 为源码包
  `28d4405c569f182b3ae563a97bf7cf204407948b0c480628faeac687c0f4bbd3`、运行时包
  `597ba85bede0469fca8c2b717202f5ff66397f02bca7e3f2d592b4eeb495a5ff`、Chrome
  `15356df25ec1c6347455d2aab469667eedbb7b3524fb8703642aea2212705e5c`、Firefox
  `d8f1158cc05c755ffead0b3b2b1bda1238aaad228e74e181cab01eb6eaee3a64`、Chrome Canary
  `c2577156e4f143fd1f77f3c929ad8366dac2816a616539cc6c47624e55d5a6ef`。
- 风险与边界：性能结果来自宿主机合成环境，只证明当前实现的资源约束和搜索算法回归；本轮没有出现文件导入“允许”或额外权限提示。自动化隔离
  E2E 不替代 Windows/Edge/Linux Chrome Stable/macOS Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或真实用户 profile
  更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：保持人工门禁未完成状态；在有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按
  `docs/manual-acceptance.md` 逐项记录人工结果，不把性能合成测量写成人工通过。
- 对应提交：无。

## 2026-08-28 / 跨存储区域写入失败回滚与最终自动门禁 / E-109

- 授权边界：本轮只为已有同步/本地设置切换补充写入失败回滚和回归测试，并重跑当前自动门禁；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺口与修正：跨区域切换时先写入目标区域、再清理旧区域；若目标写入后的旧区域清理失败，存储适配层现在恢复目标区域原值（原来不存在则移除），避免新旧规范键同时存在而让下一次读取选中错误副本。新增“旧区域清理失败时回滚目标区域”的单元回归；设置仓库并发加载测试的计数只统计初始化联合读取，不把回滚保护所需的目标键预读误判为重复初始化。
- 中间发现与修正：首次加入目标区域回滚预读后，`./make.js test-unit`
  的一个并发加载测试因测试桩把回滚预读计入初始化读取而失败（期望 `1`、实际
  `2`）；修正测试桩的观测范围后重新运行通过。该次失败未计作通过。
- 实际执行命令：

```bash
deno fmt --check background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
deno check background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
./make.js test-unit
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno fmt --check background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
deno check background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
git diff --check
```

- 测试结果：最终格式/类型检查和 `git diff --check` 通过；单元测试 `428/428`、DOM 测试
  `109/109`，合计 `537/537`；shoulda `180/180`；权限审计通过（9
  项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；打包通过。
- 运行态与产物结果：当前 macOS Chrome Stable 通过 `Extensions.loadUnpacked` 隔离
  E2E，覆盖标签页列表、设置导入/导出、旧版导出格式和旧存储键迁移、网站规则、核心手势、超级拖拽、滚轮、摇杆、跨
  frame、设计文档 fixtures、本地 PNG 指针和 Service Worker 重启。连续两次完整构建的五个归档 SHA-256
  一致：源码包 `98ce889e671f1ca81639f837bb30a404ee7e921c5c900e2665d288fa9f6ed21e`、运行时包
  `a39cc83b51114278aa5b39a4f7f43a92a111e4790538c54824628965ceee22e6`、Chrome
  `df1f8ecc39b194b9f7ba2a9905372f18b62edaf76e3552cb242a433c805037ed`、Firefox
  `a6c1736ade48d159cbbb40dc3db36bd92a145612c6cfba500113b82f59fe3d43`、Chrome Canary
  `edd83be9ccf0470865bc3054d6af872f15f4c54fb63d80478043ad1eae5033ec`。
- 风险与边界：本轮没有出现文件导入“允许”或额外权限提示；自动化隔离 E2E 不替代 Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或真实用户 profile 更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：在有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；继续保持人工门禁未完成状态，不扩大 Phase 范围。
- 对应提交：无。

## 2026-08-28 / 同步与本地存储切换、旁路修饰键和存储事件竞态收口 / E-108

- 授权边界：本轮只把已有 schema/设计字段 `general.browserSyncEnabled`、`general.showHud` 和
  `superDrag.nativeBypassModifier`
  接通到设置页、存储层和运行时，并修复跨存储区域/旧键事件的重载竞态；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺口与修正：设置页现在可以选择是否使用浏览器同步设置；关闭后整份 BrowserToolbox 配置写入
  `storage.local`，重新开启时先写入 `storage.sync`
  再删除本地规范键。存储适配层保留精确的双区域快照供迁移失败回滚，仓库对跨区域事件和旧兼容键事件排队重读，避免默认配置迁移覆盖随后到达的旧版设置。全局
  HUD 开关、可选的 Alt/Control/Meta/Shift 原生拖拽旁路和设置页国际化文案均已接通；Vimium
  原有设置仍保持独立存储和写入路径。
- 中间发现与修正：第一次修改后的隔离 E2E
  在旧存储键迁移处暴露真实竞态：清空规范键后后台仓库先写入默认配置，随后到达的旧键事件因已有重载
  Promise
  被丢弃，导致规范默认值遮蔽旧数据；该失败没有计作通过。随后增加排队重载、旧键事件强制完整重读，并将
  E2E 迁移夹具改为先写旧键再移除规范键；重新打包后完整 E2E 通过。
- 实际执行命令：

```bash
deno fmt background_scripts/browser_toolbox/settings_storage.js background_scripts/browser_toolbox/settings_repository.js lib/browser_toolbox/settings_validator.js content_scripts/mouse/super_drag_controller.js content_scripts/mouse/gesture_overlay.js content_scripts/mouse/mouse_controller.js pages/settings_sections.js tests/unit_tests/browser_toolbox/settings_sections_test.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/super_drag_controller_test.js scripts/e2e_browser_toolbox.js
deno fmt --check background_scripts/browser_toolbox/settings_storage.js background_scripts/browser_toolbox/settings_repository.js lib/browser_toolbox/settings_validator.js content_scripts/mouse/super_drag_controller.js content_scripts/mouse/gesture_overlay.js content_scripts/mouse/mouse_controller.js pages/settings_sections.js tests/unit_tests/browser_toolbox/settings_sections_test.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/super_drag_controller_test.js scripts/e2e_browser_toolbox.js
deno check background_scripts/browser_toolbox/settings_storage.js background_scripts/browser_toolbox/settings_repository.js lib/browser_toolbox/settings_validator.js content_scripts/mouse/super_drag_controller.js content_scripts/mouse/gesture_overlay.js content_scripts/mouse/mouse_controller.js pages/settings_sections.js tests/unit_tests/browser_toolbox/settings_sections_test.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/super_drag_controller_test.js scripts/e2e_browser_toolbox.js
git diff --check
./make.js test-unit
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
coverage_dir=$(mktemp -d -t browser-toolbox-coverage.XXXXXX)
deno run --coverage="$coverage_dir" --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys make.js test-unit
deno coverage "$coverage_dir" --detailed
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标文件格式/类型检查和 `git diff --check` 通过；单元测试 `427/427`、DOM 测试
  `109/109`，合计 `536/536`；shoulda `179/179`；覆盖率审计中 `settings_repository.js` 为
  `93.919%`、`settings_storage.js` 为 `97.845%`、`settings_sections.js` 为
  `98.611%`；权限审计通过（9 项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）。
- 运行态与产物结果：重新打包后的当前 macOS Chrome Stable `Extensions.loadUnpacked` 隔离 E2E 退出码
  0，覆盖同步/本地存储切换、全局
  HUD、旁路修饰键、设置导入导出、旧格式和旧存储键迁移、网站规则、核心手势、跨
  frame、指针资源、fixtures 和 Service Worker 重启。连续两次完整构建的五个归档 SHA-256 一致：源码包
  `564d6919cac4a13b28d217ad6a379d5278930dfbe8dff605405394260bd12afc`、运行时包
  `14486c0ab2c0d44fd2158953708c3d68e3f619f2e21baeea4a856344dd45fb4e`、Chrome
  `2e7feb95380fe3c55f4f24822f669a2d3973339157bbf2ff7cd34b4d79037b88`、Firefox
  `3a1582635efc22814d1f80d0c83a62b0c1791a00ad3d5f7ae5a2c1659be3fdb2`、Chrome Canary
  `71c6b9e3e871d9a37bc4ca520f45526f29c15911e9135c012b1b0186ec6ed631`。
- 风险与边界：本轮没有出现文件导入“允许”或额外权限提示；自动化隔离 E2E 不替代 Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或真实用户 profile 更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：在有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；同步/本地切换和选定旁路修饰键仍需在人工矩阵中复核，不扩大 Phase 范围。
- 对应提交：无。

## 2026-08-28 / 固定网站规则覆盖全部输入模块并复核当前自动门禁 / E-107

- 授权边界：本轮只补充网站规则编辑器对模块注册表的覆盖断言，并重跑受影响的当前本地门禁；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺口与修正：新增单测逐项读取
  `BrowserToolboxModuleRegistry.ids({ siteRule: true })`，确认规则编辑器为键盘、鼠标轨迹、超级拖拽、滚轮、摇杆和自定义指针渲染独立停用开关，避免以后增加模块时
  UI 悄然漏项。没有改变运行逻辑。
- 实际执行命令：

```bash
deno fmt tests/unit_tests/browser_toolbox/site_rules_editor_test.js
deno fmt --check tests/unit_tests/browser_toolbox/site_rules_editor_test.js pages/settings_sections.js scripts/e2e_browser_toolbox.js
deno check tests/unit_tests/browser_toolbox/site_rules_editor_test.js pages/settings_sections.js scripts/e2e_browser_toolbox.js
./make.js test-unit
deno test -A tests/browser_toolbox/
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js --package
sha256sum dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
sha256sum dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
git diff --check
```

- 测试结果：目标文件格式/类型检查和 `git diff --check` 通过；单元测试 `421/421`、DOM 测试
  `109/109`，合计 `530/530`；shoulda `173/173`；权限审计通过（9
  项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；打包、当前 macOS Chrome Stable `Extensions.loadUnpacked`
  隔离 E2E 和连续两次发布检查均通过。E2E 继续覆盖设置导入导出、旧版迁移、网站规则、核心手势、跨
  frame、指针资源、fixtures 和 Service Worker 重启。
- 产物结果：连续两次完整构建的五个归档 SHA-256 一致：源码包
  `8f0dcc5620890370ff248c4b2d07c3ae65e3163aa8698fe7c6a56a134513df99`、运行时包
  `484b34ed4c92363f71706ec80fbb14de77df8462c05e90a58d9e22102d066e87`、Chrome
  `345f9da514e6aa7742ff8e60960b9aedbd77c715361c678b7ec1029b84e15858`、Firefox
  `d674361a880a9177773fc79c9d5d5e08008f33bad1edb41f6c36e690189264e7`、Chrome Canary
  `170ecd3e3e6a71a29973739b61623cca4eeba88bd61dddeccbfb5859a77abfac`。
- 风险与边界：本轮没有出现文件导入“允许”或额外权限提示；自动化隔离 E2E 不替代 Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或真实用户 profile 更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：在有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；继续保持人工门禁未完成状态，不扩大 Phase 范围。
- 对应提交：无。

## 2026-08-28 / 补齐键盘全局开关并复核当前自动门禁 / E-106

- 授权边界：本轮只补齐已有 `keyboard.enabled`
  配置在设置页缺失的可编辑控件和回归断言；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺口与修正：完成审计时发现键盘模块已经存在于
  schema、运行时模块注册表和站点规则，但设置页没有全局启用控件，导致该既有配置无法通过 UI 修改。新增
  `#keyboard-enabled` 复用 `enabled` 本地化文案，并纳入 `settings_sections.js`
  的声明式表单字段；设置页单测和隔离 E2E 均增加存在性/默认状态断言。
- 实际执行命令：

```bash
deno fmt pages/settings_sections.js tests/unit_tests/browser_toolbox/settings_sections_test.js scripts/e2e_browser_toolbox.js
deno fmt --check pages/settings_sections.js tests/unit_tests/browser_toolbox/settings_sections_test.js scripts/e2e_browser_toolbox.js
deno check pages/settings_sections.js tests/unit_tests/browser_toolbox/settings_sections_test.js scripts/e2e_browser_toolbox.js
./make.js test-unit
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
git diff --check
deno fmt --check pages/settings_sections.js tests/unit_tests/browser_toolbox/settings_sections_test.js scripts/e2e_browser_toolbox.js
deno check pages/settings_sections.js tests/unit_tests/browser_toolbox/settings_sections_test.js scripts/e2e_browser_toolbox.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 中间结果：第一次直接运行 E2E 时因 `dist/vimium`
  尚未重新打包，陈旧扩展目录找不到新增控件而失败；随后先运行 `./make.js package`，使用当前 checkout
  归档重新运行并通过。该次陈旧产物失败没有被计作产品通过证据。
- 测试结果：目标文件格式/类型检查和 `git diff --check` 通过；单元测试 `420/420`、DOM 测试
  `109/109`，合计 `529/529`；shoulda `172/172`；权限审计通过（9
  项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；打包、当前 macOS Chrome Stable `Extensions.loadUnpacked`
  隔离 E2E 和连续两次发布检查均通过。E2E
  覆盖新增键盘全局开关存在性以及既有设置导入导出、旧版迁移、网站规则、核心手势、跨
  frame、指针资源、fixtures 和 Service Worker 重启。
- 产物结果：在最终 E2E 脚本版本上连续两次完整构建的五个归档 SHA-256 一致：源码包
  `870ce9999fa469224355f07117ecef25c616d289e05b6880e82797423ba0b110`、运行时包
  `484b34ed4c92363f71706ec80fbb14de77df8462c05e90a58d9e22102d066e87`、Chrome
  `345f9da514e6aa7742ff8e60960b9aedbd77c715361c678b7ec1029b84e15858`、Firefox
  `d674361a880a9177773fc79c9d5d5e08008f33bad1edb41f6c36e690189264e7`、Chrome Canary
  `170ecd3e3e6a71a29973739b61623cca4eeba88bd61dddeccbfb5859a77abfac`。
- 风险与边界：本轮没有出现文件导入“允许”或额外权限提示；自动化隔离 E2E 不替代 Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或真实用户 profile 更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：在有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；继续保持人工门禁未完成状态，不扩大 Phase 范围。
- 对应提交：无。

## 2026-08-28 / 覆盖率缺口补测与最终自动门禁复核 / E-105

- 授权边界：本轮只补齐覆盖率审计发现的正则安全、运行时设置客户端和配置值工具边界测试，并重跑当前本地自动门禁；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 中间发现与修正：首次针对当前 checkout 采集 V8 coverage 时发现 `regex_safety.js` 为
  `86.111%`、`settings_runtime_client.js` 为 `84.034%`、`value_utils.js` 为 `83.810%`，低于设计文档
  §18.5 门槛；补充空值/超长/复杂正则、运行时失效/兜底/并发/销毁、无稳定 ID
  数组/深度/节点预算/循环引用等边界测试。第一次新增测试有两处根路径和预算路径期望与实现语义不一致，单元测试短暂为
  `2/420` 失败；修正断言后重新通过，没有改动产品逻辑。
- 实际执行命令：

```bash
deno fmt --check background_scripts/browser_toolbox/*.js lib/browser_toolbox/*.js pages/binding_editor.js pages/settings_*.js pages/site_rules_editor.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/{binding_editor_test.js,frame_gesture_bridge_test.js,module_registry_test.js,regex_safety_test.js,settings_application_service_test.js,settings_change_summary_test.js,settings_commit_coordinator_test.js,settings_draft_test.js,settings_navigation_test.js,settings_policy_test.js,settings_runtime_client_test.js,settings_sections_test.js,settings_storage_test.js,site_rules_editor_test.js,value_utils_test.js,vimium_settings_adapter_test.js}
deno check background_scripts/browser_toolbox/*.js lib/browser_toolbox/*.js pages/binding_editor.js pages/settings_*.js pages/site_rules_editor.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/{binding_editor_test.js,frame_gesture_bridge_test.js,module_registry_test.js,regex_safety_test.js,settings_application_service_test.js,settings_change_summary_test.js,settings_commit_coordinator_test.js,settings_draft_test.js,settings_navigation_test.js,settings_policy_test.js,settings_runtime_client_test.js,settings_sections_test.js,settings_storage_test.js,site_rules_editor_test.js,value_utils_test.js,vimium_settings_adapter_test.js}
git diff --check
coverage_dir=$(mktemp -d -t browser-toolbox-coverage.XXXXXX)
deno run --coverage="$coverage_dir" --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys make.js test-unit
deno coverage "$coverage_dir" --detailed
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：43 个目标文件格式/类型检查通过，`git diff --check` 通过；V8 coverage 的 `test-unit` 为
  `420/420`，新增正则安全模块 `100%`、运行时设置客户端 `96.639%`、配置值工具
  `96.190%`，其余新增纯算法模块最低 `95.181%`，新增配置/Dispatcher 模块均达到设计文档 §18.5 的 `85%`
  门槛。完整单元测试 `420/420`、DOM 测试 `109/109`，合计 `529/529`；shoulda
  `172/172`；权限审计通过（9 项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；打包和两次发布检查均通过。
- 产物与运行态结果：连续两次完整构建的五个归档 SHA-256 一致：源码包
  `7ea590d5fc8788de654f0db0cd1fc9b9d16b0d0042bdfc45ecece99b72bb4019`、运行时包
  `b0e5bf1394f2fa5ee8c50a9a67f2a897a13553d381cbae0f2208e6b301a54461`、Chrome
  `0866ef9da04b2663c406ed56045062caacfb4c853e433fad8e45b6e8fb66b146`、Firefox
  `31dcac201f0cd9cadd6a7ea4ae7877ea58d79c60ea2032e0754f52b96977b89d`、Chrome Canary
  `f45820a513d2590bce5f8133ac68eca2eabc7eb74f47940c50a73fb54720772c`。macOS Chrome Stable 使用
  `Extensions.loadUnpacked` 的隔离 E2E 退出码
  0，覆盖设置导入/导出、未知字段报告、旧格式和旧存储键迁移、网站规则、核心手势、超级拖拽、滚轮/摇杆、跨
  frame、本地 PNG 指针、恢复默认值、fixtures 和 Service Worker 重启。
- 风险与边界：本轮没有出现文件导入“允许”或额外权限提示；自动化隔离 E2E 不替代 Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或真实用户 profile 更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：在有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；继续保留人工门禁未完成状态，不扩大 Phase 范围。
- 对应提交：无。

## 2026-08-28 / 新增分层 JSDoc 输入输出契约与最终自动门禁复核 / E-104

- 授权边界：本轮只按设计文档 §4.4 为本轮新增或迁移后的 BrowserToolbox 分层、设置页辅助层、隔离 E2E
  和新增测试补充中文 JSDoc
  输入输出说明，并重跑当前本地自动门禁；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 代码质量：为命令调用、消息协议、模块注册表、正则安全、配置值、设置策略/校验/迁移/存储、站点规则、运行时客户端、命令适配、手势协调、设置应用服务和设置页协调器补充公开输入输出类型说明；新增测试文件和隔离
  E2E 入口补充文件级输入输出说明。仅增加注释和测试可读性说明，没有改变运行逻辑。
- 实际执行命令：

```bash
deno fmt background_scripts/browser_toolbox/*.js lib/browser_toolbox/*.js pages/binding_editor.js pages/settings_*.js pages/site_rules_editor.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/{binding_editor_test.js,frame_gesture_bridge_test.js,module_registry_test.js,settings_application_service_test.js,settings_change_summary_test.js,settings_commit_coordinator_test.js,settings_draft_test.js,settings_navigation_test.js,settings_policy_test.js,settings_runtime_client_test.js,settings_sections_test.js,settings_storage_test.js,site_rules_editor_test.js,value_utils_test.js,vimium_settings_adapter_test.js}
deno fmt --check background_scripts/browser_toolbox/*.js lib/browser_toolbox/*.js pages/binding_editor.js pages/settings_*.js pages/site_rules_editor.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/{binding_editor_test.js,frame_gesture_bridge_test.js,module_registry_test.js,settings_application_service_test.js,settings_change_summary_test.js,settings_commit_coordinator_test.js,settings_draft_test.js,settings_navigation_test.js,settings_policy_test.js,settings_runtime_client_test.js,settings_sections_test.js,settings_storage_test.js,site_rules_editor_test.js,value_utils_test.js,vimium_settings_adapter_test.js}
deno check background_scripts/browser_toolbox/*.js lib/browser_toolbox/*.js pages/binding_editor.js pages/settings_*.js pages/site_rules_editor.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/{binding_editor_test.js,frame_gesture_bridge_test.js,module_registry_test.js,settings_application_service_test.js,settings_change_summary_test.js,settings_commit_coordinator_test.js,settings_draft_test.js,settings_navigation_test.js,settings_policy_test.js,settings_runtime_client_test.js,settings_sections_test.js,settings_storage_test.js,site_rules_editor_test.js,value_utils_test.js,vimium_settings_adapter_test.js}
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
./make.js package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
```

- 测试结果：42 个目标文件格式检查通过，`deno check` 无错误，单元测试 `409/409`、DOM 测试
  `109/109`，合计 `518/518`；shoulda `161/161`；权限审计通过（9
  项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；`./make.js package`
  和两次发布检查均通过。连续两次完整构建的五个归档 SHA-256 一致：源码包
  `5c17d9d1d795ff212649277688f8f497a3758b70a55f46a5375893bb16a77e90`、运行时包
  `b0e5bf1394f2fa5ee8c50a9a67f2a897a13553d381cbae0f2208e6b301a54461`、Chrome
  `0866ef9da04b2663c406ed56045062caacfb4c853e433fad8e45b6e8fb66b146`、Firefox
  `31dcac201f0cd9cadd6a7ea4ae7877ea58d79c60ea2032e0754f52b96977b89d`、Chrome Canary
  `f45820a513d2590bce5f8133ac68eca2eabc7eb74f47940c50a73fb54720772c`。macOS Chrome Stable 使用
  `Extensions.loadUnpacked` 的隔离 E2E 退出码
  0，覆盖设置导入/导出、未知字段预览/取消/确认保留、旧格式和旧存储键迁移、网站规则、核心手势、超级拖拽、滚轮/摇杆、跨
  frame、本地 PNG 指针、恢复默认值、fixtures 和 Service Worker 重启。
- 风险与边界：本轮没有出现文件导入“允许”或额外权限提示；自动化隔离 E2E 不替代 Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或真实用户 profile 更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：在有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；继续保留人工门禁未完成状态，不扩大 Phase 范围。
- 对应提交：无。

## 2026-08-28 / 设置导入未知字段报告与源码包可复现性收口 / E-103

- 授权边界：本轮只收口旧版/规范设置导入的未知字段可见性和源码归档重建语义；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：规范导入现在报告包装层字段、设置分区/绑定/站点规则中的未知字段以及带内容的
  `localAssets`；schema
  能安全保留的未知设置字段会在预览和结果提示中单独列出并保留，包装层未知字段和本地二进制资源列为忽略。设置页新增中英文“未识别设置（已保留）”提示，取消导入不写入，确认导入后通过真实存储回读验证保留结果。旧
  Vimium 兼容备份仍只迁移受支持字段，未支持字段沿用兼容层忽略报告。
- 中间发现与修正：第一次隔离 E2E 夹具没有携带已知的
  `mouse.activationDistancePx`，确认导入后按完整设置导入语义回到默认值
  10，暴露了测试断言而非产品失败；夹具随后明确携带该已知字段并重跑通过。首次五包哈希复核还发现源码包从旧归档更新到当前文件集时前后两次不同，而运行时和浏览器包一致；发布脚本现在先删除精确的已有目标归档再生成，随后连续两次完整构建五包哈希一致。
- 实际执行命令：

```bash
deno fmt --check background_scripts/browser_toolbox/settings_migrations.js pages/mouse_options.js pages/mouse_options.html scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/settings_migrations_test.js lib/i18n.js _locales/en/messages.json _locales/zh_CN/messages.json
deno check background_scripts/browser_toolbox/settings_migrations.js pages/mouse_options.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/settings_migrations_test.js lib/i18n.js
deno fmt --check scripts/build_release.js
deno check scripts/build_release.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
```

- 测试结果：目标格式/类型检查和 `git diff --check` 通过；单元测试 `409/409`、DOM 测试
  `109/109`，合计 `518/518`；shoulda `161/161`；权限审计通过（9
  项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；`./make.js package`
  和发布检查均通过。最终连续两次发布检查的五个归档 SHA-256 一致：源码包
  `a928240fdeeb4019e90dbb30ce567de6d61856b331e74ad5e4e2bb6d70568c64`、运行时包
  `1584e1f97538b9a8479c9f57613d0db7341e4e8095e9c0603940ae2361743278`、Chrome
  `eb29f7f671d59bf4835a7e5358bce9dac7399f71d67117a673a5c2dc35c28008`、Firefox
  `0d74cb328589a41347dfaa0cf48f91febd202d60597e87bf403d5dcc2c975e5d`、Chrome Canary
  `e7a8d0c8e3014ebc852680af3209647b93646c66c843aa853ec61138d21c9f7b`。macOS Chrome Stable 使用
  `Extensions.loadUnpacked` 的隔离 E2E 退出码
  0，覆盖未知字段预览/取消/确认保留、规范/旧版导入导出、旧存储键与指针资源迁移、站点规则、核心输入、超级拖拽、滚轮/摇杆、跨
  frame、fixtures 和 Service Worker 重启。
- 风险与边界：源码包可复现性是清洁目标归档后的当前本地证据，不代表源码与产物对应同一提交；工作区仍有大量未提交用户修改，HEAD
  仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。自动化隔离 E2E
  未出现文件导入“允许”或额外权限提示；该结果不替代 Windows/Edge/Linux Chrome Stable/macOS Chrome
  Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或真实用户 profile
  更新。
- 下一步：在有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；继续保留人工门禁未完成状态，不扩大 Phase 范围。
- 对应提交：无。

## 2026-08-28 / 绑定编辑器字符串选项与完整设置页隔离复核 / E-100

- 授权边界：本轮只为设置页绑定编辑器补充字符串选项（`keyword`）的同步回归，并复核现有隔离
  E2E；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷与测试收敛：绑定编辑器单测现在验证字符串控件输入会同步到绑定对象和 JSON 编辑器；隔离 E2E
  进一步通过设置页真实选择 `BrowserToolbox.searchSelection`、填写轨迹、前台打开方式和
  `keyword`、保存，再以选中文字超级拖拽执行本地搜索。早期诊断代码曾因把对象交给标量断言造成异常清理等待，已改为字段级断言后重新验证；早期失败没有作为通过证据保留。
- 实际执行命令：

```bash
deno fmt --check scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/binding_editor_test.js
deno check scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/binding_editor_test.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
```

- 测试结果：目标文件格式/类型检查和 `git diff --check` 通过；单元测试 `408/408`、DOM 测试
  `109/109`，合计 `517/517`；shoulda `160/160`；权限审计通过（9
  项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；打包通过。macOS Chrome Stable 使用
  `Extensions.loadUnpacked` 的隔离 E2E 退出码
  0，覆盖标签页列表、设置保存、设置页绑定编辑器真实配置、自定义搜索引擎、规范/旧版导入导出、旧存储键与指针资源迁移、正则网站规则、核心输入、超级拖拽、滚轮/摇杆、跨
  frame、fixtures 和 Service Worker 重启。
- 中间环境核对：首次直接运行 E2E 时未带项目既定的
  `BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true`，扩展识别超时；随后按上面完整命令重跑并通过。该次调用环境错误不计为产品功能通过或失败。测试期间未出现文件导入“允许”或额外权限提示。
- 风险与边界：完整设置页绑定编辑器链路已有当前 macOS Chrome Stable 隔离 E2E 证据，但自动化结果不替代
  Windows/Edge/Linux Chrome Stable/macOS Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或真实用户 profile
  更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：待有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；保留人工门禁未完成状态，不再扩大 Phase 范围。
- 对应提交：无。

## 2026-08-28 / 当前归档同 ID CRX 更新语义复核 / E-101

- 授权边界：本轮只在临时容器、临时 Chromium profile 和临时 RSA
  测试密钥中复核迁移前归档到当前归档的同 ID 更新语义；没有接触日常浏览器资料、登录态、Cookie、Token
  或个人资料，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 实际准备与结果：从 `dist/open-key-mouse-0.1.0.zip` 和 `dist/browser-toolbox-0.1.0.zip`
  解包临时旧/当前目录，将当前临时 manifest 版本改为 `0.1.1`，用同一临时密钥分别打包 CRX。Debian
  amd64 Chromium `151.0.7922.173` 的隔离 profile 先通过 Linux 外部扩展 JSON 安装旧 CRX，活动版本为
  `0.1.0`；切换外部 JSON 到当前 CRX 后，通过 `chrome://extensions` 的 Update 控件和一次 profile
  重启完成更新，活动路径变为 `kpfmbjhgehfahacmmhehcgcpbkafodbb/0.1.1_0`，Service Worker 仍为同一扩展
  ID `kpfmbjhgehfahacmmhehcgcpbkafodbb`。
- 实际执行命令与结果：

```text
mktemp -d -t browser-toolbox-crx-current.XXXXXX
unzip -q dist/open-key-mouse-0.1.0.zip -d <临时目录>/old
unzip -q dist/browser-toolbox-0.1.0.zip -d <临时目录>/current
openssl genrsa -traditional -out <临时目录>/test.pem 2048
openssl pkcs8 -topk8 -nocrypt -in <临时目录>/test.pem -out <临时目录>/test-pkcs8.pem
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --no-sandbox --no-first-run --user-data-dir=<临时目录>/pack-profile --pack-extension=<临时目录>/old --pack-extension-key=<临时目录>/test-pkcs8.pem
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless=new --no-sandbox --no-first-run --user-data-dir=<临时目录>/pack-profile-current --pack-extension=<临时目录>/current --pack-extension-key=<临时目录>/test-pkcs8.pem
docker run --platform linux/amd64 ... debian:trixie-slim
docker exec ... apt-get install chromium curl nodejs
docker exec ... chromium --headless=new --no-sandbox --remote-debugging-port=9222 --user-data-dir=/tmp/profile-installed about:blank
docker exec ... node /tmp/update_extensions.mjs
docker exec ... node --input-type=module -e '读取 /tmp/profile-installed/Default/Preferences 的扩展 path/version，并核对 /json/list Service Worker'
shasum -a 256 <临时目录>/old.crx <临时目录>/current.crx
```

- 测试结果：两次 Chrome 打包退出码均为 0；外部 JSON 安装旧版本和 Chromium 扩展管理页 Update
  控件调用均成功。旧 CRX SHA-256 为
  `2ad6ea6fe1b46e7e20ae838874fa25f8a62328057e97af9af1d6faed3862a208`，当前临时 `0.1.1` CRX SHA-256
  为 `67b1b6954cf1743dab6784f4a3607f64773e30ff50bbbc6fac478f62d6f6a7a8`；最终 Preferences 和 Service
  Worker 均确认当前版本 `0.1.1` 与同一扩展 ID。
- 清理与边界：临时 Chromium、容器、profile、CRX
  和测试密钥已清理；该结果是隔离更新语义证据，不是生产签名 CRX、真实旧用户 profile、Chrome Web Store
  更新通道或人工安装更新验收，因此平台矩阵、屏幕阅读器、完整 Vimium 手工回归和生产发布门禁仍未完成。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：保留该隔离升级证据，待取得合规生产签名/真实迁移 profile
  和可操作人工环境后再补外部验收；项目暂不发布。
- 对应提交：无。

## 2026-08-28 / 当前归档最终可复现构建复核 / E-102

- 授权边界：本轮只对当前未发布归档重复执行构建和内容核对，没有修改运行时代码、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 实际执行命令：

```bash
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg -n '^docs/manual-acceptance\\.md$'
unzip -p dist/browser-toolbox-0.1.0.zip manifest.json | rg -n -C 1 'content_security_policy|script-src|object-src'
```

- 测试结果：两次构建退出码均为 0，五个归档 SHA-256 两次一致：源码包
  `247abb72a714a9abafa188f517722183a2459003d9888ea6ea6be8475787bf88`、运行时包
  `25dd797f82322bced8d050e348c26d76c3ce338acf83617d738b69ae9c5ad912`、Chrome
  `6fff15ef71d906c71690fb8cf2ab495dc83a4e5694dc050312a1e4aa8526fe2c`、Firefox
  `504dacbf60c8bcc19cb22c90b96f7d483ee5463d05512a729258b2f5a071bc15`、Chrome Canary
  `95511d13411899a9b00a1fce2c3386c2e99d3006df52655c9c1bb485cc8bde02`。源码包确认包含
  `docs/manual-acceptance.md`；运行时包 manifest 确认包含 `script-src 'self'; object-src 'self'`。
- 风险与边界：可复现构建和归档内容审计不代表源码与产物对应一个已提交 SHA，也不替代
  Windows/Edge/Linux Chrome Stable/macOS Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产用户 profile
  更新。工作区仍有大量未提交修改，项目暂不发布。
- 下一步：等待真实可操作平台、辅助技术和发布签名/用户 profile
  环境，继续按人工清单记录；未取得证据前不改变人工门禁状态。
- 对应提交：无。

## 2026-08-28 / 超级拖拽自定义搜索引擎与 Vimium 设置缓存一致性 / E-099

- 授权边界：本轮只补齐现有超级拖拽“搜索选中文字”对 Vimium 自定义搜索引擎 keyword
  的支持，并修复跨设置页读取缓存的竞态；没有新增产品模块、权限、依赖、网络或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：`BrowserToolbox.searchSelection` 现在接受可选 `keyword`，从现有 Vimium
  搜索引擎配置生成并校验 HTTP(S) 搜索 URL；未知 keyword、非 HTTP(S) 模板和超长 keyword
  会被拒绝。设置仓库读取 keyword 前通过 Vimium
  设置适配层刷新配置，避免设置页刚保存时后台仍使用旧缓存。E2E
  使用设置页保存搜索引擎配置，再以中文选区执行超级拖拽，验证最终本地 fixture URL。
- 中间发现：最初直接写入 `chrome.storage.sync.searchEngines` 的隔离 E2E 复现了后台缓存尚未更新导致的
  `INVALID_OPTIONS`；没有把该失败写成通过，改为真实设置页保存并加入读取前刷新后，最终 E2E 通过。
- 实际执行命令：

```bash
deno fmt scripts/e2e_browser_toolbox.js background_scripts/browser_toolbox/settings_repository.js background_scripts/browser_toolbox/browser_command_adapter.js tests/unit_tests/browser_toolbox/settings_repository_test.js
deno check scripts/e2e_browser_toolbox.js background_scripts/browser_toolbox/settings_repository.js background_scripts/browser_toolbox/browser_command_adapter.js tests/unit_tests/browser_toolbox/settings_repository_test.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
./make.js package
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标文件格式/类型检查和 `git diff --check` 通过；单元测试 `407/407`、DOM 测试
  `109/109`，合计 `516/516`；shoulda `159/159`；权限审计通过（9
  项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；打包通过。macOS Chrome Stable `Extensions.loadUnpacked`
  隔离 E2E 退出码 0，覆盖设置页保存自定义搜索引擎、中文选区超级拖拽、自定义
  URL、原有超级拖拽/滚轮/摇杆/跨 frame/迁移/fixtures 和 Service Worker 重启。两次发布检查均退出码
  0，五个归档 SHA-256 两次一致：源码包
  `31cbcb3988a58261259862bc491d7df983503a339565df6f72fc7b52a56291d9`、运行时包
  `25dd797f82322bced8d050e348c26d76c3ce338acf83617d738b69ae9c5ad912`、Chrome
  `6fff15ef71d906c71690fb8cf2ab495dc83a4e5694dc050312a1e4aa8526fe2c`、Firefox
  `504dacbf60c8bcc19cb22c90b96f7d483ee5463d05512a729258b2f5a071bc15`、Chrome Canary
  `95511d13411899a9b00a1fce2c3386c2e99d3006df52655c9c1bb485cc8bde02`。
- 风险与边界：自定义搜索只在本地隔离 fixture
  中验证，未访问外部搜索站点；本轮没有出现文件导入“允许”或额外权限提示。自动化结果不替代
  Windows/Edge/Linux Chrome Stable/macOS Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或真实用户 profile
  更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：待有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；继续保留人工门禁未完成状态。
- 对应提交：无。

## 2026-08-28 / 非法配置与命令上下文防御式校验 / E-098

- 授权边界：本轮只补强设置导入和统一命令调用的非法输入拒绝路径，没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：命令调用校验现在要求 `context` 和 `options`
  都是普通对象并包含可验证的纯数据；绑定校验在处理非数组 `pattern` 时返回验证错误而不是抛出
  `TypeError`。两处均补充了回归测试，保证损坏的导入配置或消息被拒绝且不致使校验器崩溃。
- 实际执行命令：

```bash
deno fmt --check lib/browser_toolbox/command_invocation.js lib/browser_toolbox/settings_validator.js tests/unit_tests/browser_toolbox/command_invocation_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js
deno check lib/browser_toolbox/command_invocation.js lib/browser_toolbox/settings_validator.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标文件格式/类型检查和 `git diff --check` 通过；单元测试 `405/405`、DOM 测试
  `109/109`，合计 `514/514`；shoulda `157/157`；权限审计通过（9
  项权限，无禁止权限或远程脚本）；网络审计通过（扫描 34
  个新增模块文件，无后台或隐式网络调用）；打包通过；macOS Chrome Stable `Extensions.loadUnpacked`
  隔离 E2E 通过，覆盖标签页、设置导入导出与旧版迁移、站点规则、核心手势、超级拖拽、滚轮、摇杆、跨
  frame、设计文档 fixtures 和 Service Worker 重启。两次发布检查均通过，五个归档 SHA-256
  两次一致：源码包 `9939fc337b47fe637747c117825d3fa85f11d86ded8d86aa1f1463fd008ddffb`、运行时包
  `89e0c16fe05216f5d92f12ac02df3c2c1a873b028a9a03aee8349de3417a6ee4`、Chrome
  `33d50ee933ccb50c2ef3f7199800fe716e3c5aafc1301d6c595bf51cd649a3ba`、Firefox
  `be65e367d28fdde9878de5bc1e2e050f21f93217ea76fc37bed0e6d25610c745`、Chrome Canary
  `23baacee4a0b1b18a4b925f17f02bb140bc8a46d70caa69f3da6d931e520e510`。
- 归档复核：源码包包含
  `docs/manual-acceptance.md`；源码包和运行时包旧技术标识路径扫描无匹配；运行时包 `manifest.json`
  包含 `script-src 'self'; object-src 'self'`。
- 风险与边界：本轮没有出现文件导入“允许”或额外权限提示；自动化和本机隔离结果不替代
  Windows/Edge/Linux Chrome Stable/macOS Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或真实用户 profile
  更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：待有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；在此之前保留人工门禁未完成状态。
- 对应提交：无。

## 2026-08-28 / E-096 归档内容与 CSP 复核 / E-097

- 授权边界：本轮只复核 E-096
  之后生成的归档内容，没有修改产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 实际执行命令：

```bash
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg -n '^docs/manual-acceptance\.md$'
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg -n -i 'openkeymouse|open_key_mouse|open-key-mouse'
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg -n -i 'openkeymouse|open_key_mouse|open-key-mouse'
unzip -p dist/browser-toolbox-0.1.0.zip manifest.json | rg -n -C 1 'content_security_policy|script-src|object-src'
```

- 测试结果：源码包中确认存在
  `docs/manual-acceptance.md`；源码包和运行时包旧技术标识路径扫描均无匹配（命令按预期返回
  1）；运行时包 `manifest.json` 确认包含 `script-src 'self'; object-src 'self'`。
- 风险与边界：该复核只证明归档路径和 manifest 内容，不替代 Windows/Edge/Linux Chrome Stable/macOS
  Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或真实用户
  profile 更新。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：待有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；在此之前保留人工门禁未完成状态。
- 对应提交：无。

## 2026-08-28 / Runtime 消息与手势 Port 发送方校验收口 / E-096

- 授权边界：本轮只修复统一 Runtime 消息入口和手势 Port
  入口的发送方信任校验；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：`BrowserToolboxMessageProtocol.isTrustedSender` 现在要求发送方 `id` 严格等于当前
  `chrome.runtime.id`；主消息入口、手势 Port 和 BrowserToolbox 调用均拒绝其他扩展或缺失 ID
  的发送方，符合设计文档 §16.4。
- 实际执行命令：

```bash
deno fmt --check lib/browser_toolbox/message_protocol.js tests/unit_tests/browser_toolbox/message_protocol_test.js background_scripts/main.js
deno check lib/browser_toolbox/message_protocol.js tests/unit_tests/browser_toolbox/message_protocol_test.js background_scripts/main.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标文件格式/类型检查、`git diff --check`、单元 403/403、DOM 109/109、shoulda
  155/155、权限审计 9 项、网络审计 34 个新增模块、打包和 macOS Chrome Stable
  `Extensions.loadUnpacked` 隔离 E2E 均通过。发布检查连续两次退出码 0，五个归档 SHA-256
  两次一致：源码包 `3b019f3871d4244b57ccf5e63d44402de9995187fef03c6951a12cb4ab2afaa6`、运行时包
  `fd837c716930e622e929c60f5d13c976d7289065e43361b7317852355ed19ab0`、Chrome
  `f3db9381936f455e7fef0927737f9380368250229363da1dcae5538b2b3a6f3b`、Firefox
  `662fe352ce70591369474d6b0091f5847a700051910ced7f064f7041c9234fe8`、Chrome Canary
  `9db3cef6176f36550250cd0f5cfde5ac6e2ed1ec40000cb481e32730e66313d8`。
- 风险与边界：本轮没有出现文件导入“允许”或额外权限提示；macOS Chrome
  的界面可访问性工具两次超时，因此没有把该尝试写成人工验收。Windows/Edge/Linux Chrome Stable/macOS
  Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归和生产签名/真实用户 profile 的旧 CRX 更新仍未验证。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：待有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  逐项记录人工结果；在此之前不把自动化结果升级为人工完成。
- 对应提交：无。

## 2026-08-28 / 内容脚本边界与动态代码安全审计收口 / E-095

- 授权边界：本轮只增强现有权限审计，对 Manifest V3 内容脚本的
  `matches`、`run_at`、`all_frames`、`match_about_blank`
  和禁止动态代码执行进行强制校验；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：`scripts/audit_permissions.js` 现在会拒绝不满足设计文档 §15.3
  的主内容脚本注入配置，并扫描仓库 JavaScript/HTML 中的 `eval(` 与 `new Function(`；对 Puppeteer 的
  `$eval` 调用不误报。已有显式 CSP 校验保持不变。
- 实际执行命令：

```bash
deno fmt --check scripts/audit_permissions.js
deno check scripts/audit_permissions.js
deno run -A scripts/audit_permissions.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标脚本格式/类型检查、权限审计和 `git diff --check` 通过；单元 403/403、DOM
  109/109，总计 512/512；shoulda 155/155；网络审计扫描 34 个新增模块；打包和 macOS Chrome Stable
  `Extensions.loadUnpacked` 隔离 E2E 退出码 0。发布检查连续两次退出码 0，五个归档 SHA-256
  两次一致：源码包 `b724103034e16ed751bc33c83c6af645ab8e8a0c6a1c899ecf8fd68f9455d223`、运行时包
  `232d4811cd00cccd055b0cca6d90f48c6b54baba51219e2815c3452068d2d1bb`、Chrome
  `6a308a85d7863c62481da04c85fb1e95cca14f31f80edbd2aca35f26de8dc69e`、Firefox
  `26005176a06525294ba12abd2643a5f383f18ce68c3a3f26c7b981ccef05ab5f`、Chrome Canary
  `a5225e927e1c551873dc8f06734731ec8a6dcad03a11162f93f064977f80d848`。
- 风险与边界：本轮尝试读取本机 Chrome
  可访问性状态时工具两次超时，没有盲点按钮，也没有出现文件导入“允许”或额外权限提示，因此不形成手工验收证据。Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归和生产签名/真实用户 profile 的旧 CRX 更新仍未验证。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：待有可访问且与当前 checkout 对应的真实平台/辅助技术环境后，按 `docs/manual-acceptance.md`
  记录人工结果；在此之前不把自动化结果升级为人工完成。
- 对应提交：无。

## 2026-08-28 / 扩展页面 CSP 明确化与安全审计门禁 / E-094

- 授权边界：本轮只补齐设计文档 §15.4 要求的扩展页面 CSP
  显式声明，并让现有权限审计强制校验该值；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：`manifest.json` 现在显式声明
  `script-src 'self'; object-src 'self'`；`scripts/audit_permissions.js` 不再只检查
  `unsafe-eval`，而是要求扩展页面 CSP 完整匹配该最小策略，避免后续意外放宽扩展页脚本来源。
- 实际执行命令：

```bash
git diff --check
deno fmt --check scripts/audit_permissions.js
deno check scripts/audit_permissions.js
deno run -A scripts/audit_permissions.js
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg -n '^docs/manual-acceptance\\.md$'
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg -n -i 'openkeymouse|open_key_mouse|open-key-mouse'
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg -n -i 'openkeymouse|open_key_mouse|open-key-mouse'
unzip -p dist/browser-toolbox-0.1.0.zip manifest.json | rg -n -C 1 'content_security_policy|script-src|object-src'
```

- 测试结果：`git diff --check`、目标脚本格式/类型检查和权限审计通过；单元 403/403、DOM 109/109，总计
  512/512；shoulda 155/155；网络审计扫描 34 个新增模块；`./make.js package` 通过。macOS Chrome
  Stable `Extensions.loadUnpacked` 隔离 E2E 退出码
  0，覆盖设置导入/迁移、正则站点规则、核心手势、超级拖拽、滚轮/摇杆、跨 frame、设计 fixtures 和
  Service Worker 重启。发布检查连续执行三次均退出码 0；后两次归档 SHA-256 一致：源码包
  `96611d9323557690a3994a358b4640ac1a0e0f74e3d4564c9b74b90b8c5d4c25`、运行时包
  `232d4811cd00cccd055b0cca6d90f48c6b54baba51219e2815c3452068d2d1bb`、Chrome
  `6a308a85d7863c62481da04c85fb1e95cca14f31f80edbd2aca35f26de8dc69e`、Firefox
  `26005176a06525294ba12abd2643a5f383f18ce68c3a3f26c7b981ccef05ab5f`、Chrome Canary
  `a5225e927e1c551873dc8f06734731ec8a6dcad03a11162f93f064977f80d848`；源码包包含人工验收清单，运行时包路径不含旧技术标识，归档内
  manifest 已包含显式 CSP。旧技术标识路径扫描因无匹配返回 1，符合预期。
- 风险与边界：本轮自动化仍只在 macOS Chrome Stable 临时隔离 profile
  中验证，没有出现需要点击的文件导入浏览器确认或权限提示，也没有把自动化写成人工验收。Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归和生产签名/真实用户 profile 的旧 CRX 更新仍未验证。工作区仍有大量未提交用户修改，HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，项目暂不发布。
- 下一步：在可访问且与当前 checkout 对应的真实平台/辅助技术环境中，继续按
  `docs/manual-acceptance.md` 记录人工、无障碍和平台结果；在这些证据产生前保留人工门禁未完成状态。
- 对应提交：无。

## 2026-08-28 / 人工验收操作清单与环境边界核对 / E-093

- 授权边界：本轮补充 §18.4 人工验收操作清单并链接到
  README，核对可复用的本机隔离环境；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部项目路径。项目仍暂不发布。
- 文档与环境：新增
  `docs/manual-acceptance.md`，按平台、功能、站点、无障碍、权限提示和证据记录拆分执行步骤，明确自动化结果不能冒充人工验收。只读环境核对显示宿主为
  macOS 15.7.7 arm64；既有 `OpenKeyMouse-Windows-Isolated` VM 当前停止，挂载的
  `/tmp/open-key-mouse-source.iso` 为 2026-08-24 的旧 ISO，不对应当前 checkout，因此没有启动或修改该
  VM，也没有用它生成当前版本人工证据。
- 实际执行命令：

```bash
ls -l /tmp/open-key-mouse-source.iso
shasum -a 256 /tmp/open-key-mouse-source.iso
prlctl list --all --info
ls -1 /Applications
docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}'
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg -n '^docs/manual-acceptance\\.md$'
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg -n -i 'openkeymouse|open_key_mouse|open-key-mouse'
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg -n -i 'openkeymouse|open_key_mouse|open-key-mouse'
```

- 测试结果：当前 checkout 单元 403/403、DOM 109/109，总计 512/512；shoulda 155/155；权限审计 9
  项、网络审计 34 个新增模块、`./make.js package` 均通过。macOS Chrome Stable
  `Extensions.loadUnpacked` 隔离 E2E 退出码
  0，覆盖设置导入/迁移、正则站点规则、核心手势、超级拖拽、滚轮/摇杆、跨 frame、设计 fixtures 和
  Service Worker 重启。连续两次发布检查通过，五个归档 SHA-256 两次一致：源码包
  `6bf8402ca20c2adaedb1e4e328a740e576d9cf3413e579a3364b85d01fce9956`、运行时包
  `cfc0b6db1a085cd1e987a462e2677caeb463a916f8fc5465015a83348a3e1c4d`、Chrome
  `9deb73e99178fa76048d5bf68417895544094dd88979e23b998dd7653bb72d2c`、Firefox
  `6a6e3d53c8b130f8dad64c32a0cebc92f81df345466ef3055e0242acfa2e274d`、Chrome Canary
  `0142bbfc96c26a84997e5b97faa25fc80b4acaed43b54e203d0a9c347538be41`；源码包包含人工清单，运行时包不包含该文档；两个归档旧技术标识审计均无匹配输出（`rg`
  因无匹配返回 1）。
- 风险与边界：本轮没有出现需要点击的文件导入浏览器确认或权限提示，也没有把文档、环境核对或隔离自动化写成人工验收。Windows/Edge/Linux
  Chrome Stable/macOS Chrome Stable 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归和生产签名/真实用户 profile 的旧 CRX 更新仍未验证。工作区仍有大量未提交用户修改，HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3，项目暂不发布。
- 下一步：在可访问且与当前 checkout 对应的真实平台/辅助技术环境中，按 `docs/manual-acceptance.md`
  逐项记录结果；在此之前保留人工门禁未完成状态。
- 对应提交：无。

## 2026-08-28 / 中文产品名本地化收口与全量门禁复核 / E-092

- 授权边界：本轮只修正中文站点规则“无匹配”提示中的产品名残留，并补充回归断言；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：`lib/i18n.js` 与 `_locales/zh_CN/messages.json` 的 `siteRuleNoMatchingRules`
  现在统一显示“浏览器工具箱”，不再在中文界面写入英文产品名；单元测试覆盖该中文回退文案。
- 实际执行命令：

```bash
deno fmt --check lib/i18n.js tests/unit_tests/browser_toolbox/i18n_test.js
deno check lib/i18n.js tests/unit_tests/browser_toolbox/i18n_test.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg -n -i 'openkeymouse|open_key_mouse|open-key-mouse'
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg -n -i 'openkeymouse|open_key_mouse|open-key-mouse'
```

- 测试结果：目标文件格式/类型检查和 `git diff --check` 通过；`./make.js test` 为单元 403/403、DOM
  109/109，总计 512/512；`deno test -A tests/browser_toolbox/` 为 shoulda 155/155；权限审计 9
  项、网络审计 34 个新增模块、`./make.js package` 均通过。macOS Chrome Stable
  `Extensions.loadUnpacked` 隔离 E2E 最新运行退出码
  0，覆盖设置导入/迁移、正则站点规则、核心鼠标手势、超级拖拽、滚轮/摇杆、跨 frame、设计文档 fixtures
  和 Service Worker 重启。连续两次发布检查均通过，五个归档 SHA-256 两次一致：源码包
  `bf95bcf5649629a14511fab2332845f45a0e099f05f026627864a5c8904f6d34`、运行时包
  `cfc0b6db1a085cd1e987a462e2677caeb463a916f8fc5465015a83348a3e1c4d`、Chrome
  `9deb73e99178fa76048d5bf68417895544094dd88979e23b998dd7653bb72d2c`、Firefox
  `6a6e3d53c8b130f8dad64c32a0cebc92f81df345466ef3055e0242acfa2e274d`、Chrome Canary
  `0142bbfc96c26a84997e5b97faa25fc80b4acaed43b54e203d0a9c347538be41`；源码包和运行时包旧技术标识禁入路径审计均无匹配输出（`rg`
  因无匹配返回 1）。
- 风险与边界：本轮自动化只在 macOS Chrome Stable 临时隔离 profile
  中验证，未把它写成人工验收；没有实际出现需要点击的文件导入浏览器系统确认或权限提示。仍不替代
  Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或生产签名/真实用户 profile 的旧 CRX 更新验收。工作区仍有大量未提交用户修改，HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3，项目暂不发布。
- 下一步：保留未完成的真实平台、辅助技术、完整人工回归和生产升级门禁；待有可操作环境后按检查表记录真实结果。当前没有新的代码范围扩展。
- 对应提交：无。

## 2026-08-28 / about:blank、srcdoc 与子 frame 配置冷启动验收 / E-091

- 授权边界：本轮按设计文档 Phase 6 补充 `about:blank`、`srcdoc` 和跨域 iframe
  的真实内容脚本注入检查，并修复子 frame 配置请求在 Service Worker
  冷启动/并行读取期间过早安全降级的问题；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：设计 fixture 现在同时包含 `srcdoc` 和 `about:blank` frame；隔离 E2E 通过
  `chrome.scripting.executeScript({ allFrames: true, world: "ISOLATED" })` 检查三个 frame 的
  BrowserToolbox 鼠标控制器均实际初始化，而不是只断言 iframe DOM 存在。跨域手势场景增加顶层与子
  frame 控制器就绪等待。内容脚本运行时设置客户端的有限请求窗口由 500ms 调整为 2s；Service Worker
  或配置存储仍不可用时，子 frame 继续 fail-closed，不按自身跨源 URL 兜底。
- 实际执行命令：

```bash
deno fmt scripts/e2e_browser_toolbox.js lib/browser_toolbox/settings_runtime_client.js
deno fmt --check scripts/e2e_browser_toolbox.js lib/browser_toolbox/settings_runtime_client.js
deno check scripts/e2e_browser_toolbox.js lib/browser_toolbox/settings_runtime_client.js tests/unit_tests/browser_toolbox/settings_runtime_client_test.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '(^|/)(dist|\\.git)/|docs/(baseline|codex-progress|release-checklist|feature-parity-matrix)\\.md$|(^|/)[^/]+\\.(pem|key|p12|env)$'
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg '(^|/)(docs|tests|test_harnesses|scripts)/|(^|/)[^/]+\\.md$|(^|/)(make\\.js|deno\\.json|deno\\.lock)'
```

- 测试结果：`./make.js test` 为单元 403/403、DOM 109/109，总计
  512/512；`deno test -A tests/browser_toolbox/` 为 shoulda 155/155；权限审计 9 项、网络审计 34
  个新增模块、`./make.js package` 均通过。中间诊断运行曾真实暴露跨域 frame
  的子客户端安全降级并导致后退等待超时，调整有限请求窗口并加入 frame 控制器就绪等待后，最新源码的
  macOS Chrome Stable `Extensions.loadUnpacked` 隔离 E2E 连续两次退出码
  0，均覆盖旧版导入/迁移、正则站点规则、跨域手势、`about:blank`、`srcdoc` 和 Service Worker
  重启。连续两次发布检查均通过，五个归档 SHA-256 两次一致：源码包
  `d13b5465a463396d8a80ffaa40a4e943bfd54a5218e89614897a3cca458f4b53`、运行时包
  `6b1ae7de0a4f7ebe2ac2855d3d1a85c9efc91d8bb11ff86199db379503c36b0c`、Chrome
  `ab13dc635280f3019e144aa069a9ef729597100d737365df40014c18b3e67b5b`、Firefox
  `7fe53dfa2b62009ff22f2f42dcf0a33a59cb1ff8f83abccfa91a34de54a5ef28`、Chrome Canary
  `25335e9ac488bf6dd4ede4613fc3530467bca2f3004b1cf8b43b89afb93c3d87`；源码包和运行时包禁入路径审计命令均无匹配输出（`rg`
  因无匹配返回 1）。
- 风险与边界：本轮自动化只在 macOS Chrome Stable 临时隔离 profile
  中验证，未把它写成人工验收；没有实际出现需要点击的文件导入浏览器系统确认或权限提示。仍不替代
  Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或生产签名/真实用户 profile 的旧 CRX 更新验收。工作区仍有大量未提交用户修改，HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3，项目暂不发布。
- 下一步：保留未完成的真实平台、辅助技术、完整人工回归和生产升级门禁；待有可操作环境后按检查表记录真实结果。当前没有新的代码范围扩展。
- 对应提交：无。

## 2026-08-28 / 手势短生命周期 Port 与跨 frame 顺序收口 / E-090

- 授权边界：本轮按设计文档 §9.8 将既有跨 frame 手势协调从逐条 runtime message 收口为短生命周期
  `runtime.connect` Port，并修复 Port
  消息异步启动竞态；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：内容脚本在一次手势内复用同一 Port，只发送固定的 start/update/finish/cancel 消息；Service
  Worker 按 Port 逐串处理消息，在连接断开时取消 tab/frame 会话。首次 Port 实现的隔离 E2E
  暴露了异步设置加载期间 update 先于 start 完成、导致跨 frame 第一段方向丢失的问题，现已用每个 Port
  的消息队列修复并复跑通过。新增 Port 建立、方向去重、完成断开和 Service Worker 断连单元测试。
- 实际执行命令：

```bash
deno fmt content_scripts/mouse/frame_gesture_bridge.js background_scripts/main.js tests/unit_tests/browser_toolbox/frame_gesture_bridge_test.js
deno fmt --check content_scripts/mouse/frame_gesture_bridge.js background_scripts/main.js tests/unit_tests/browser_toolbox/frame_gesture_bridge_test.js
deno check content_scripts/mouse/frame_gesture_bridge.js background_scripts/main.js tests/unit_tests/browser_toolbox/frame_gesture_bridge_test.js scripts/e2e_browser_toolbox.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno fmt background_scripts/main.js
deno fmt --check background_scripts/main.js content_scripts/mouse/frame_gesture_bridge.js tests/unit_tests/browser_toolbox/frame_gesture_bridge_test.js
deno check background_scripts/main.js content_scripts/mouse/frame_gesture_bridge.js tests/unit_tests/browser_toolbox/frame_gesture_bridge_test.js
git diff --check
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '(^|/)(dist|\\.git)/|docs/(baseline|codex-progress|release-checklist|feature-parity-matrix)\\.md$|(^|/)[^/]+\\.(pem|key|p12|env)$' || true
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg '(^|/)(docs|tests|test_harnesses|scripts)/|(^|/)[^/]+\\.md$|(^|/)(make\\.js|deno\\.json|deno\\.lock)' || true
```

- 测试结果：首次 Port 版本 E2E 真实退出码 1，失败位置为跨 frame 后退等待，随后定位为 Port
  内并发消息顺序问题；修复并重打包后 macOS Chrome Stable `Extensions.loadUnpacked` 隔离 E2E 退出码
  0。最终完整 `./make.js test` 为单元 403/403、DOM 109/109，总计
  512/512；`deno test -A tests/browser_toolbox/` 为 shoulda 155/155；权限审计 9 项、网络审计扫描 34
  个新增模块、打包均通过。连续两次发布检查均通过，五个归档 SHA-256 两次一致：源码包
  `ba3eba16175fefcea3da289896bd428108c2f94aecc7d259bc55ca0e8ce7c267`、运行时包
  `7eb290c9b30e43d1ddce7995ac81018600a019acdd090095fa1f04c7c8375473`、Chrome
  `da964ccb655ac7291bad0044a7bd5c0e1708313c6e432b38214320d0acec56ae`、Firefox
  `374498b228707485b592e549e836b3915dadc3169a64c85f292706e33354c63b`、Chrome Canary
  `da5d881109e000e59b4281f45947cf5cc73a8c8ee929541b60ff54e788b26956`；源码包和运行时包禁入路径审计无输出。
- 风险与边界：本轮自动化只在 macOS Chrome Stable 临时隔离 profile
  中验证，未把它写成人工验收；没有实际出现需要点击的文件导入浏览器系统确认。仍不替代
  Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或生产签名/真实用户 profile 的旧 CRX 更新验收。工作区仍有大量未提交用户修改，HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3，项目暂不发布。
- 下一步：保留未完成的真实平台、辅助技术、完整人工回归和生产升级门禁；待有可操作环境后按检查表记录真实结果。当前没有新的代码范围扩展。
- 对应提交：无。

## 2026-08-28 / 跨 frame 手势摘要上限安全收口 / E-089

- 授权边界：本轮只收紧既有 GestureFrameCoordinator
  的方向摘要上限；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：Service Worker 收到第 9 个不同方向摘要时立即取消该 tab
  的手势会话，不再保留一个虽已拒绝更新但仍可通过活动状态校验的超长会话；正常 8
  段以内轨迹路径不变，既有单测改为验证超限后不可继续。
- 实际执行命令：

```bash
deno fmt background_scripts/browser_toolbox/gesture_frame_coordinator.js tests/unit_tests/browser_toolbox/gesture_frame_coordinator_test.js
deno fmt --check background_scripts/browser_toolbox/gesture_frame_coordinator.js tests/unit_tests/browser_toolbox/gesture_frame_coordinator_test.js lib/browser_toolbox/settings_runtime_client.js tests/unit_tests/browser_toolbox/settings_runtime_client_test.js scripts/e2e_browser_toolbox.js
deno check background_scripts/browser_toolbox/gesture_frame_coordinator.js tests/unit_tests/browser_toolbox/gesture_frame_coordinator_test.js lib/browser_toolbox/settings_runtime_client.js tests/unit_tests/browser_toolbox/settings_runtime_client_test.js scripts/e2e_browser_toolbox.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
./make.js package
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '(^|/)(dist|\\.git)/|docs/(baseline|codex-progress|release-checklist|feature-parity-matrix)\\.md$|(^|/)[^/]+\\.(pem|key|p12|env)$' || true
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg '(^|/)(docs|tests|test_harnesses|scripts)/|(^|/)[^/]+\\.md$|(^|/)(make\\.js|deno\\.json|deno\\.lock)' || true
```

- 测试结果：目标文件格式/类型检查和 git diff --check 通过；最终 ./make.js test 为单元 401/401、DOM
  109/109，总计 510/510；deno test -A tests/browser_toolbox/ 为 shoulda 153/153；./make.js package
  通过；权限审计 9 项、网络审计扫描 34 个新增模块通过；macOS Chrome Stable `Extensions.loadUnpacked`
  隔离 E2E 退出码 0，正常手势、设置导入导出、迁移、站点规则、超级拖拽、滚轮/摇杆、跨 frame、fixtures
  和 Service Worker 重启均通过。连续两次发布检查均通过，五个归档 SHA-256 两次一致：源码包
  `a8bfd2014fe5cfd9296f20ef281cdc5dad3f0a82047ae4c2136d5ac2c51d112b`、运行时包
  `df558212dfa8e842a0685a1632c24abf0b76c824e8f6a6d8cd92e50827606a7b`、Chrome
  `6956f34d6add8a459bb2510e8ceebc13fd8d7a19217de41751aa1c5ac71fc22e`、Firefox
  `1eebe7299b0458e2fc110f5072bfe2a1edcde35f1d6be48556ab36ee0cdc15ad`、Chrome Canary
  `8333e3da9337040fb59755ba421f6018b8184d3c0f6a31b8aa5f50d065fe855f`；源码包和运行时包禁入路径审计无输出。
- 风险与边界：本轮自动化只在 macOS Chrome Stable 临时隔离 profile
  中验证，未把它写成人工验收；没有实际出现需要点击的文件导入浏览器系统确认。仍不替代
  Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或生产签名/真实用户 profile 的旧 CRX 更新验收。工作区仍有大量未提交用户修改，HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3，项目暂不发布。
- 下一步：保留未完成的真实平台、辅助技术、完整人工回归和生产升级门禁；待有可操作环境后按检查表记录真实结果。当前没有新的代码范围扩展。
- 对应提交：无。

## 2026-08-28 / 子 frame 兜底安全与左键触发验收收口 / E-088

- 授权边界：本轮只修复 Service Worker 不可用时子 frame
  的配置兜底边界，并补充设计文档已有左键触发按键的隔离验收；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：内容脚本运行时客户端在无法取得 Service Worker 有效配置时，只允许顶层页面按当前 URL
  使用本地仓库兜底；子 frame 不再按自身跨源 URL 重新计算站点规则，而是安全降级为全部 BrowserToolbox
  模块关闭。无已加载配置时的读取也保持同一 fail-closed 行为；新增了 child frame 兜底单元测试。隔离
  E2E 新增实际左键触发轨迹，继续覆盖中键和默认右键触发。
- 实际执行命令：

```bash
deno fmt lib/browser_toolbox/settings_runtime_client.js tests/unit_tests/browser_toolbox/settings_runtime_client_test.js scripts/e2e_browser_toolbox.js
deno fmt --check lib/browser_toolbox/settings_runtime_client.js tests/unit_tests/browser_toolbox/settings_runtime_client_test.js scripts/e2e_browser_toolbox.js
deno check lib/browser_toolbox/settings_runtime_client.js tests/unit_tests/browser_toolbox/settings_runtime_client_test.js scripts/e2e_browser_toolbox.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
./make.js package
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '(^|/)(dist|\\.git)/|docs/(baseline|codex-progress|release-checklist|feature-parity-matrix)\\.md$|(^|/)[^/]+\\.(pem|key|p12|env)$' || true
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg '(^|/)(docs|tests|test_harnesses|scripts)/|(^|/)[^/]+\\.md$|(^|/)(make\\.js|deno\\.json|deno\\.lock)' || true
```

- 测试结果：目标文件格式/类型检查和 git diff --check 通过；最终 ./make.js test 为单元 401/401、DOM
  109/109，总计 510/510；deno test -A tests/browser_toolbox/ 为 shoulda 153/153；./make.js package
  通过；权限审计 9 项、网络审计扫描 34 个新增模块通过；macOS Chrome Stable `Extensions.loadUnpacked`
  隔离 E2E 退出码
  0，实际覆盖左键触发轨迹以及既有的中键/右键触发、轨迹超时、输入冲突优先级、设置导入导出、旧版设置/导出迁移、站点规则、超级拖拽、滚轮、跨
  frame、fixtures 和 Service Worker 重启。连续两次发布检查均通过，五个归档 SHA-256 两次一致：源码包
  `e66c9f6ac943686aec1f75f717ea0e0d805c0b80038419784276cd5300fc97b2`、运行时包
  `3bc8f51fe20540ca2fe744659e9f7343867925b71df75654bec9db49428d7e13`、Chrome
  `2ef8018674215187e4639820c216bb909bd4fea86d131d52434ec7986caf4ed6`、Firefox
  `889228666e9549579e885026323967c8b65d5623c5743952c3ca8c0f21a789de`、Chrome Canary
  `35d67eb870b6a5ee1bf72ed6dc324143e1d9353236cdc1fbae82791d4bdb69d6`；源码包和运行时包禁入路径审计无输出。
- 风险与边界：本轮自动化只在 macOS Chrome Stable 临时隔离 profile
  中验证，未把它写成人工验收；没有实际出现需要点击的文件导入浏览器系统确认。仍不替代
  Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归或生产签名/真实用户 profile 的旧 CRX 更新验收。工作区仍有大量未提交用户修改，HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3，项目暂不发布。
- 下一步：保留未完成的真实平台、辅助技术、完整人工回归和生产升级门禁；待有可操作环境后按检查表记录真实结果。当前没有新的代码范围扩展。
- 对应提交：无。

## 2026-08-28 / 触发按键配置贯通与跨层手势时长收口 / E-087

- 授权边界：本轮只补齐设计文档已有的鼠标触发按键配置和跨 frame
  会话时长一致性，并补充设置页与回归测试；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：mouse.triggerButton
  现在由运行时真正读取并支持左键、中键、右键，设置页可编辑且在与超级拖拽/摇杆共用按键时按既有优先级处理；Service
  Worker 的 GestureFrameCoordinator 按有效配置为每个会话保存最大持续时间，gestureStart
  从仓库有效设置读取，不再固定使用
  2500ms。补充了配置字段回读、非法触发按键和自定义会话时长单元覆盖；一次隔离 E2E
  暴露了测试对象引用比较误用和 PENDING 阶段摇杆起点被提前返回的问题，均已修正并复跑通过。
- 实际执行命令：

```bash
deno fmt content_scripts/mouse/mouse_controller.js background_scripts/browser_toolbox/gesture_frame_coordinator.js background_scripts/main.js pages/settings_sections.js pages/mouse_options.html pages/onboarding.html scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/gesture_frame_coordinator_test.js tests/unit_tests/browser_toolbox/settings_sections_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js lib/i18n.js
deno fmt --check content_scripts/mouse/mouse_controller.js background_scripts/browser_toolbox/gesture_frame_coordinator.js background_scripts/main.js pages/settings_sections.js pages/mouse_options.html pages/onboarding.html scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/gesture_frame_coordinator_test.js tests/unit_tests/browser_toolbox/settings_sections_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js lib/i18n.js
deno check content_scripts/mouse/mouse_controller.js background_scripts/browser_toolbox/gesture_frame_coordinator.js background_scripts/main.js pages/settings_sections.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/gesture_frame_coordinator_test.js tests/unit_tests/browser_toolbox/settings_sections_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js lib/i18n.js
node -e 'for (const f of ["_locales/en/messages.json","_locales/zh_CN/messages.json"]) JSON.parse(require("fs").readFileSync(f)); console.log("locale JSON ok")'
git diff --check
deno test -A tests/browser_toolbox/
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '(^|/)(dist|\\.git)/|docs/(baseline|codex-progress|release-checklist|feature-parity-matrix)\\.md$|(^|/)[^/]+\\.(pem|key|p12|env)$' || true
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg '(^|/)(docs|tests|test_harnesses|scripts)/|(^|/)[^/]+\\.md$|(^|/)(make\\.js|deno\\.json|deno\\.lock)' || true
```

- 测试结果：定向格式/类型检查、locale JSON 解析和 git diff --check 通过；最终 ./make.js test 为单元
  400/400、DOM 109/109，总计 509/509；deno test -A tests/browser_toolbox/ 为 shoulda
  152/152；权限审计 9 项、网络审计扫描 34 个新增模块通过；./make.js package 通过。最新打包目录上的
  macOS Chrome Stable Extensions.loadUnpacked 隔离 E2E 退出码 0，实际覆盖 3000ms 配置下按住 2700ms
  仍保持 ACTIVE 并完成命令、非默认中键触发轨迹、ACTIVE
  与摇杆冲突优先级、设置页触发按键保存、旧版设置/导出迁移、站点规则、超级拖拽、滚轮、跨
  frame、fixtures 和 Service Worker 重启。连续两次发布检查均退出码 0，五个归档 SHA-256
  逐次一致：源码包 c0328272013872db9b4f689922683e53374da5dc3be979027a4c5bc97512c875、运行时包
  7cd7257c0abb600f35a994ba920a9e3605eec3af93bb669616da86cfff3e2067、Chrome
  2db8d495020f9832df71e048c52575862c614f300b2868c973c5dd7774149d00、Firefox
  86012b2bd1ff3a1e6f3219c0bc3f5e3d5b665183e18b9109e2e172f230497b57、Chrome Canary
  4226c7baf38692b4e85db90cf29b60d139d418e6c6f0de01a4ece5e07f59d246；源码包和运行时包禁入路径审计无输出。
- 风险与边界：本轮自动化只在 macOS Chrome Stable 临时隔离 profile
  中验证，未把它写成人工验收；仍不替代 Windows/Edge/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新验收。工作区仍有大量未提交用户修改，HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3，项目暂不发布。
- 下一步：保留未完成的真实平台、辅助技术、完整人工回归和生产升级门禁；待有可操作环境后按检查表记录真实结果。当前没有新的代码范围扩展。
- 对应提交：无。

## 2026-08-28 / 轨迹手势超时与输入冲突优先级收口 / E-086

- 授权边界：本轮只修复既有鼠标输入会话的超时安全边界和轨迹/摇杆冲突优先级，并补充对应单元与隔离
  E2E；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：`GestureSession.end(now)` 在抬键时复核 `PENDING`/`ACTIVE` 会话是否已经超过
  `maxDurationMs`；鼠标控制器在轨迹开始时设置定时取消，并在结束、取消和销毁路径清理定时器；`ACTIVE`
  轨迹期间的左右键输入不再启动超级拖拽或摇杆组合；超级拖拽抬键使用事件时间戳，并不会把已超时会话标记为完成。新增回归覆盖“激活后无进一步移动直到超时”和“轨迹激活后按第二个鼠标键”的真实事件顺序。
- 实际执行命令：

```bash
deno fmt content_scripts/mouse/gesture_session.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/super_drag_controller.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/gesture_session_test.js
deno fmt --check content_scripts/mouse/gesture_session.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/super_drag_controller.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/gesture_session_test.js
deno check content_scripts/mouse/gesture_session.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/super_drag_controller.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/gesture_session_test.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true deno run -A scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '(^|/)(dist|\\.git)/|docs/(baseline|codex-progress|release-checklist|feature-parity-matrix)\\.md$|(^|/)[^/]+\\.(pem|key|p12|env)$' || true
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg '(^|/)(docs|tests|test_harnesses|scripts)/|(^|/)[^/]+\\.md$|(^|/)(make\\.js|deno\\.json|deno\\.lock)' || true
```

- 测试结果：目标文件格式检查、`deno check`、`git diff --check`
  和定向轨迹单测通过；`PUPPETEER_EXECUTABLE_PATH` 指向本机 Chrome Stable 后，`./make.js test` 为单元
  `399/399`、DOM `109/109`，总计 `508/508`；`deno test -A tests/browser_toolbox/` 为 shoulda
  `151/151`；权限审计 9 项、网络审计 34 个新增模块通过；`./make.js package` 和基于最新打包目录的
  macOS Chrome Stable `Extensions.loadUnpacked` 隔离 E2E 退出码 0。E2E
  新增覆盖轨迹超时会话/定时器清理和 `ACTIVE`
  轨迹优先于摇杆，并继续覆盖设置导入导出、旧版迁移、站点规则、超级拖拽、滚轮、跨 frame、fixtures 和
  Service Worker 重启。连续两次发布检查均退出码 0，五个归档 SHA-256 逐次一致：源码包
  `c3b8dff28a54b115ea82fa4516177a2e5c77b2a5ad28b005c416a5a21718a9ef`、运行时包
  `db75bc78c70dd65815005bfb09760b3cbd09f96e98891f35e52e6aa176f31a1f`、Chrome
  `86ce85765a355e34f9b72f499bbc94c9f97bc97a3a02708abe09b7e076906de1`、Firefox
  `0824103516eb0f2acd4640d5d42eaf536f16a1d0bd3aceb0534ba7684139aa82`、Chrome Canary
  `042077139325778d39f8417325074551133b41ebb3d99bb9239e8e165dcf358a`；源码包和运行时包禁入路径审计无输出。
- 风险与边界：本轮自动化只在 macOS Chrome Stable 临时隔离 profile
  中验证，未把它写成人工验收；仍不替代 Windows/Edge/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新验收。无 `PUPPETEER_EXECUTABLE_PATH` 时，项目默认 Puppeteer 缓存的 Chrome for
  Testing 因缺失 Framework 文件无法启动；改用项目既有的本机 Chrome Stable
  测试路径后验证通过。工作区仍有未提交修改，项目暂不发布。
- 下一步：保留未完成的真实平台、辅助技术、完整人工回归和生产升级门禁；待有可操作环境后按检查表记录真实结果。当前没有新的代码范围扩展。
- 对应提交：无。

## 2026-08-27 / 国际化回退与旧会话覆盖清除修复 / E-085

- 授权边界：本轮只修复既有设置页国际化降级和旧版会话覆盖清除边界，没有新增产品功能、权限、依赖、网络行为或商业化路径；没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：补齐“重复站点规则”提示在无浏览器 `chrome.i18n`
  测试桩/降级路径下的英文回退；显式清除会话覆盖时同时删除规范会话键和旧版会话键，避免迁移后旧键在下一次读取时重新生效；动作页新增/改造的“添加规则”“取消”“没有修改”控件也统一使用消息键。旧
  `OpenKeyMouse` 标识仍只出现在兼容层和兼容测试中。
- 实际执行命令：

```bash
deno fmt lib/i18n.js background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/i18n_test.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
deno fmt pages/action.html scripts/e2e_browser_toolbox.js
deno fmt --check lib/i18n.js background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/i18n_test.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
deno check lib/i18n.js background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/i18n_test.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
git diff --check
deno test -A tests/browser_toolbox/
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '(^|/)(dist|\.git)/|docs/(baseline|codex-progress|release-checklist|feature-parity-matrix)\.md$|(^|/)[^/]+\.(pem|key|p12|env)$' || true
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg '(^|/)(docs|tests|test_harnesses|scripts)/|(^|/)[^/]+\.md$|(^|/)(make\.js|deno\.json|deno\.lock)' || true
```

- 测试结果：目标文件格式检查、`deno check` 和 `git diff --check`
  通过；`deno test -A tests/browser_toolbox/` 为 shoulda `150/150`；`./make.js test` 为单元
  `398/398`、DOM `109/109`；权限审计 9 项、网络审计 34 个新增模块通过；`./make.js package`
  通过；最新打包目录的 macOS Chrome Stable 隔离 E2E 退出码
  0，覆盖设置页键盘/无障碍语义、动作页新增按钮文案、导入导出、旧版迁移、站点规则、核心手势、跨
  frame、指针和 Service Worker 重启。针对当前代码的连续两次发布检查均退出码 0，五个归档的 SHA-256
  逐次一致：源码包 `0d10dae6f1d599440c5c7d1c95049c4ee16f4c783901d7cb1c889ce020a1f032`、运行时包
  `4196175b1bb9608a634d4cd43d6a9e747ceb52631e66f757e2f25d5f826f0d26`、Chrome
  `396201803922ce9586a317a1a8ebe29f46f459d4f1a7fd5f1692959d7551a543`、Firefox
  `16690700c726c325b59e8f2a946fce40f91d06c61c315058886c626984fe3136`、Chrome Canary
  `5d6b948d55183f7048cff92460ac5a2e2a0dc19ff0b0b5889d5e1023f7bee397`；源码包和运行时包禁入路径审计无输出。
- 风险与边界：本轮只验证自动化和降级路径，仍不替代 Windows/Edge/macOS/Linux
  人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile
  的旧 CRX 更新验收；全仓 `deno fmt --check`
  仍受既有脏文件影响，本轮只执行目标文件检查。工作区仍有未提交修改，项目暂不发布。
- 下一步：保留未完成的真实平台、辅助技术、完整人工回归和生产升级门禁；待有可操作环境后按检查表记录真实结果。当前没有新的代码范围扩展。
- 对应提交：无。

## 2026-08-27 / 站点规则重复诊断、动作页生效状态与回归修复 / E-082

- 授权边界：本轮只优化既有站点规则和动作页会话开关的可理解性，并修复 E2E
  暴露的动作页初始化回归；没有新增产品模块、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 用户体验与架构：`site_rule_matcher.js` 新增只识别完全相同“匹配方式 +
  匹配式”的诊断接口，规则编辑器在重复规则行内显示非阻断提示，并在编辑匹配式时即时刷新提示；不对无法证明的部分重叠进行误报。动作页改为根据模块注册表列出当前实际停用模块，切换滚轮/摇杆或全局会话开关后同步刷新状态，并保留其他模块（例如自定义指针）的真实停用状态。
- 缺陷修复：第一次动作页隔离 E2E 在开关等待处暴露 `modules`
  旧变量残留；重构后该变量已经删除，但初始化循环仍引用它，导致事件处理器未注册、复选框只改变视觉状态而没有写入会话存储。删除残留引用后，第一次恢复开关的断言又暴露测试对“全部模块启用”的假设过严；测试改为验证滚轮/摇杆恢复且仍准确显示其他停用模块。
- 实际执行命令：

```bash
deno fmt lib/browser_toolbox/site_rule_matcher.js pages/site_rules_editor.js pages/action.js pages/gesture_editor.css tests/unit_tests/browser_toolbox/site_rule_matcher_test.js tests/unit_tests/browser_toolbox/site_rules_editor_test.js scripts/e2e_browser_toolbox.js
deno fmt --check lib/browser_toolbox/site_rule_matcher.js pages/site_rules_editor.js pages/action.js pages/gesture_editor.css tests/unit_tests/browser_toolbox/site_rule_matcher_test.js tests/unit_tests/browser_toolbox/site_rules_editor_test.js scripts/e2e_browser_toolbox.js
deno check lib/browser_toolbox/site_rule_matcher.js pages/site_rules_editor.js pages/action.js tests/unit_tests/browser_toolbox/site_rule_matcher_test.js tests/unit_tests/browser_toolbox/site_rules_editor_test.js scripts/e2e_browser_toolbox.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标文件格式检查、`deno check` 和 `git diff --check` 通过；单元 `396/396`、DOM
  `109/109`，总计 `505/505`；shoulda `148/148`；权限审计 9 项通过；网络审计扫描 34
  个新增模块文件通过；`./make.js package` 和基于最新打包目录的 macOS Chrome Stable 隔离 E2E 退出码
  0。E2E 覆盖动作页状态、设置页、多级导航、站点规则、旧版迁移、导入导出、核心手势、跨
  frame、设计文档 fixtures 和 Service Worker 重启。两次串行发布检查均通过且哈希一致：BrowserToolbox
  `e2f7f3de2d499898ec2936a46fc5657977effa0949f256d299d13496cee26c2b`、Chrome
  `ea3be17632e0647568874b49630f4894c5d04030275f25c870452bd09103ffa1`、Firefox
  `5db567318b04aa00353167eb7b98199ad574107efff321543a6f3249c496d9b9`、Chrome Canary
  `9c4a1fe878168151dd24bc45fb9d87a9c81f10e3073018dd1f196061d884daac`。
- 风险与边界：完全相同匹配式的诊断只提示潜在字段覆盖，不替代按具体网址计算的有效规则解释；正则部分重叠仍不做静态猜测。全仓
  `deno fmt --check`
  仍会受到工作区中既有未格式化脏文件影响，本轮没有为格式化而覆盖用户修改；本轮触及文件的定向格式检查已通过。上述浏览器结果仍是隔离自动化，不替代
  Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium
  手工回归或生产签名/真实用户 profile 的旧 CRX 更新验收。工作区仍有未提交修改，项目暂不发布。
- 下一步：代码层面暂不继续扩大重构；保留真实平台、辅助技术、完整人工回归和生产升级门禁，待有可操作环境后按检查表逐项记录实际结果。
- 对应提交：无。

## 2026-08-27 / 动作页滚轮摇杆合并开关状态修复 / E-084

- 授权边界：本轮只修正既有动作页合并开关的生效状态显示，并补充对应隔离回归；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 缺陷修复：动作页的“滚轮/摇杆”开关现在只有在两个模块都有效时才显示开启；站点规则只停用摇杆时会显示关闭，并在状态说明中明确列出摇杆，避免把部分停用误报为完整启用。E2E
  增加了该部分停用场景并在清理阶段恢复原设置。
- 实际执行命令：

```bash
deno fmt pages/action.js scripts/e2e_browser_toolbox.js
deno fmt --check pages/action.js scripts/e2e_browser_toolbox.js
deno check pages/action.js scripts/e2e_browser_toolbox.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
unzip -p dist/browser-toolbox-source-0.1.0.zip pages/action.js | shasum -a 256
unzip -p dist/browser-toolbox-0.1.0.zip pages/action.js | shasum -a 256
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标文件格式/类型检查、`deno check` 和 `git diff --check` 通过；单元 `396/396`、DOM
  `109/109`，总计 `505/505`；shoulda `148/148`；权限审计 9 项、网络审计 34
  个新增模块通过；`./make.js package` 和基于最新打包目录的 macOS Chrome Stable 隔离 E2E 退出码
  0。源码包、运行时包和 Chrome 商店包内的 `pages/action.js` 均与当前工作区哈希
  `7fc424ce11b9a2dd24c939a07626ee9075a2ba33e0181508f17198bdac4a9446` 一致。
- 产物 SHA-256：源码包 `de908230450e00ce55371ebc75d64d9acfe5883ce6ba895716fdb6106fd22315`；运行时包
  `5b691d6ce7fae9883b5051b9f5f0b22cf7ded3fee5ed000fb350bd4946f7b467`；Chrome
  `4aaefaace629273f76cdf8d8c2c091fd661f4c257ced56d6746d3f5922e000e4`；Firefox
  `b6763dfd7c3fc9e77b6129828289e9e6498ea1d7ae14d6aa958492b314169052`；Chrome Canary
  `d51aafcd44ddb05f46765d79a47d81eef96890d0cb3b78ad415fca5990b9a7bb`。源码包和运行时包连续两次构建哈希一致。
- 风险与边界：该场景验证的是动作页状态显示和隔离自动化，不替代 Windows/Edge/macOS/Linux
  人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile
  的旧 CRX 更新验收。工作区仍有未提交修改，项目暂不发布。
- 下一步：保留真实平台、辅助技术、完整人工回归和生产升级门禁，待有可操作环境后按检查表逐项记录实际结果。
- 对应提交：无。

## 2026-08-27 / 独立源码归档与运行时包内容边界 / E-083

- 授权边界：本轮只补齐既有 Phase 8
  的源码归档工程，并明确运行时包与源码包的内容边界；没有新增产品功能、权限、依赖、网络行为或商业化路径，没有提交、推送、发布或修改外部路径。项目仍暂不发布。
- 发布工程：`scripts/build_release.js --package` 现在同时生成运行时包
  `dist/browser-toolbox-0.1.0.zip` 和独立源码包
  `dist/browser-toolbox-source-0.1.0.zip`；运行时包排除文档、测试、fixtures、脚本和隐藏仓库文件，源码包保留代码、测试、fixtures、开发脚本和
  ADR，但排除 `dist`、Git
  数据、会随验收变化的审计记录和敏感文件。发布前秘密文件检查改为递归扫描源码目录，并跳过明确的生成目录。
- 实际执行命令：

```bash
deno fmt scripts/build_release.js
deno fmt --check scripts/build_release.js
deno check scripts/build_release.js
git diff --check
deno run -A scripts/build_release.js --package
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '^(tests/|test_harnesses/|docs/adr/|scripts/|README\\.md$|LICENSE$)'
unzip -Z1 dist/browser-toolbox-source-0.1.0.zip | rg '(^|/)(dist|\\.git)/|docs/(baseline|codex-progress|release-checklist|feature-parity-matrix)\\.md$|(^|/)[^/]+\\.(pem|key|p12|env)$' || true
unzip -Z1 dist/browser-toolbox-0.1.0.zip | rg '(^|/)(docs|tests|test_harnesses|scripts)/|(^|/)[^/]+\\.md$|(^|/)(make\\.js|deno\\.json|deno\\.lock)' || true
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-source-0.1.0.zip dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：目标文件格式/类型检查和 `git diff --check` 通过；单元 `396/396`、DOM `109/109`，总计
  `505/505`；shoulda `148/148`；权限审计 9 项、网络审计 34 个新增模块通过；`./make.js package`
  和基于最新打包目录的 macOS Chrome Stable 隔离 E2E 退出码
  0。运行时包禁入路径和源码包禁入路径审计均无输出；两次
  `deno run -A scripts/build_release.js --package` 的源码包与运行时包哈希一致。
- 产物 SHA-256：源码包 `de908230450e00ce55371ebc75d64d9acfe5883ce6ba895716fdb6106fd22315`；运行时包
  `5b691d6ce7fae9883b5051b9f5f0b22cf7ded3fee5ed000fb350bd4946f7b467`；Chrome
  `ea3be17632e0647568874b49630f4894c5d04030275f25c870452bd09103ffa1`；Firefox
  `5db567318b04aa00353167eb7b98199ad574107efff321543a6f3249c496d9b9`；Chrome Canary
  `9c4a1fe878168151dd24bc45fb9d87a9c81f10e3073018dd1f196061d884daac`。
- 风险与边界：源码包排除了会记录自身哈希的审计记录，因此它是当前源码快照而非固定提交证明；工作区仍有大量未提交修改，不能声称源码与产物对应同一提交。隔离自动化仍不替代
  Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium
  手工回归或生产签名/真实用户 profile 的旧 CRX 更新验收。项目暂不发布。
- 下一步：保留真实平台、辅助技术、完整人工回归和生产升级门禁，待有可操作环境后按检查表逐项记录实际结果。
- 对应提交：无。

## 2026-08-27 / 运行时配置客户端、并发加载去重与实时失效通知 / E-081

- 授权边界：本轮只收敛既有配置读取和运行时刷新链路，不新增产品功能、权限、依赖、网络行为或商业化路径；没有提交、推送、发布，也没有修改外部路径。项目仍暂不发布。
- 架构与可靠性：新增 `lib/browser_toolbox/settings_runtime_client.js`，由 Service Worker
  计算并提供有效配置，内容脚本只读缓存快照；Service Worker 只广播 `browserToolbox.settingsChanged`
  失效通知，不携带完整配置，内容脚本按当前 frame
  生命周期重新读取，避免跨标签页复用站点规则结果。Service Worker
  不可用时保留本地仓库和内存默认值兜底；同一上下文的 `SettingsRepository.ensureLoaded()`
  增加并发加载去重；收到失效通知或单页应用 URL 变化时会丢弃过期 in-flight 结果并刷新站点规则状态。
- 实际执行命令：

```bash
deno fmt lib/browser_toolbox/settings_runtime_client.js background_scripts/browser_toolbox/settings_repository.js content_scripts/mouse/mouse_controller.js content_scripts/vimium_frontend.js background_scripts/main.js tests/unit_tests/browser_toolbox/settings_runtime_client_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js scripts/e2e_browser_toolbox.js scripts/audit_permissions.js
deno check lib/browser_toolbox/settings_runtime_client.js background_scripts/browser_toolbox/settings_repository.js content_scripts/mouse/mouse_controller.js content_scripts/vimium_frontend.js background_scripts/main.js tests/unit_tests/browser_toolbox/settings_runtime_client_test.js scripts/e2e_browser_toolbox.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
```

- 测试结果：`deno check`、`git diff --check` 和 `./make.js package` 通过；单元 `393/393`、DOM
  `109/109`，总计 `502/502`；shoulda `145/145`；权限审计 9 项通过；网络审计扫描 34
  个新增模块文件通过。基于最新打包目录的 macOS Chrome Stable 隔离 E2E 退出码
  0，新增验证设置页写入后已打开页面的运行时客户端和鼠标控制器都收到全局停用状态，并覆盖跨
  frame、Service Worker 重启、旧版迁移、设置页和设计文档
  fixtures。两次串行发布检查均通过且哈希一致：BrowserToolbox
  `be80c04e4779cbbc3d68779cef3e9958db316c0cf55fad31e015de37f7395721`、Chrome
  `5f77bae2b289b56baaf2aef1f41dae0334f3ceed76cd4ce2ab98210be08e2752`、Firefox
  `f80348211f08bf9c150a2af16ee37e6f147fb5972b08892cbc841ec8e2e95d78`、Chrome Canary
  `3642a020126cf9325c6c7beef592955369039613388ce7470c0cab336dbc406e`。
- 风险与边界：广播只负责失效，内容脚本刷新仍受 Service Worker
  和页面生命周期影响；兜底默认值保证初始化形状稳定，但不替代有效配置。运行时客户端及实时通知已由单元和当前
  macOS Chrome Stable 隔离 E2E 验证；自动化结果仍不替代 Windows/Edge/macOS/Linux
  人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile
  的旧 CRX 更新验收。工作区仍有未提交修改，项目暂不发布。
- 下一步：代码层面暂不继续扩大重构；保留待完成的真实平台、辅助技术和人工回归门禁，待有可操作环境后按检查表逐项记录实际结果。
- 对应提交：无。

## 2026-08-27 / 设置应用服务、冲突字段诊断与参数编辑体验 / E-080

- 授权边界：本轮只优化既有设置、站点规则和绑定编辑体验，不新增产品功能、权限、依赖、网络行为或商业化路径；没有提交、推送、发布，也没有修改外部路径。项目仍暂不发布。
- 架构与可靠性：新增
  `lib/browser_toolbox/settings_application_service.js`，将设置页的加载、BrowserToolbox/Vimium
  双存储提交、基线建立、冲突保护、导入导出迁移编排集中到无 DOM
  应用服务；页面继续负责表单校验和交互。`value_utils.js`
  新增有界字段路径差异计算，提交冲突只携带字段路径和截断标志，不携带完整快照或配置值；补充双域提交、外部无关
  Vimium 字段保留和冲突停止测试。
- 用户体验：站点规则编辑器把数组位置明确显示为“配置顺序”，测试解释同时显示“匹配顺序”和“配置顺序”，与现有“匹配度优先、同匹配度后置规则优先”的真实语义一致；已有
  `optionSchema` 的命令在保留高级 JSON 入口的同时增加可视化布尔/枚举/字符串控件，控件与 JSON
  双向同步；新增中英文默认值和冲突字段文案。
- 实际执行命令：

```bash
deno fmt lib/browser_toolbox/value_utils.js pages/settings_commit_coordinator.js lib/browser_toolbox/settings_application_service.js pages/site_rules_editor.js pages/settings_sections.js pages/mouse_options.js pages/binding_editor.js tests/unit_tests/browser_toolbox/value_utils_test.js tests/unit_tests/browser_toolbox/settings_commit_coordinator_test.js tests/unit_tests/browser_toolbox/settings_application_service_test.js tests/unit_tests/browser_toolbox/binding_editor_test.js scripts/e2e_browser_toolbox.js
deno check lib/browser_toolbox/value_utils.js pages/settings_commit_coordinator.js lib/browser_toolbox/settings_application_service.js pages/site_rules_editor.js pages/binding_editor.js pages/settings_sections.js pages/mouse_options.js tests/unit_tests/browser_toolbox/value_utils_test.js tests/unit_tests/browser_toolbox/settings_commit_coordinator_test.js tests/unit_tests/browser_toolbox/settings_application_service_test.js tests/unit_tests/browser_toolbox/binding_editor_test.js scripts/e2e_browser_toolbox.js
git diff --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
```

- 测试结果：`deno check` 和 `git diff --check` 通过；单元 `387/387`、DOM `109/109`，总计
  `496/496`；shoulda `139/139`；权限审计 9 项通过；网络审计扫描 33
  个新增模块文件通过；`./make.js package` 通过。两次串行发布检查均通过且哈希一致：BrowserToolbox
  `fda8de920ca7ab676fdfe5bec40eefa790dc0790ab3f58e1cf52cb8c7b9311b8`、Chrome
  `5b038fc084385dc0024cbc684a906b3df81c3b2df2d6a16a8314bee600769a1e`、Firefox
  `95210dbdf81ae89c2814f766628ebab968020bfeb978364c59ea267401c0793f`、Chrome Canary
  `c6158ef5e9d502a3b4762819960e88f4938194c68c76eeaef618b392fddb26ef`。基于最新打包目录的 macOS
  Chrome Stable 隔离 E2E 退出码 0，完整覆盖设置页、多级导航、参数编辑器兼容 JSON
  入口、导入导出/旧版迁移、网站规则、核心输入、跨 frame、指针资源、fixtures 和 Service Worker 重启。
- 风险与边界：应用服务协调两个存储域并在失败时尽力回滚，但仍不是跨域原子事务；真实外部冲突仍停止保存并要求重新加载，当前只显示字段路径，没有自动合并。第一次使用旧
  `dist/vimium` 的 E2E 尝试因打包目录未更新而被中止，未计入证据；随后已运行 `./make.js package`
  并基于最新源码包重新执行且通过。本条自动化结果仍不替代 Windows/Edge/macOS/Linux
  人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户 profile
  的旧 CRX 更新验收。工作区仍有未提交修改，项目暂不发布。
- 下一步：优先保留现有实现，等待可操作的真实平台与辅助技术环境完成剩余人工门禁；若继续代码优化，下一刀应是把运行时每个
  frame 的设置读取/监听收敛成只读配置客户端，但需先补跨 frame、Service Worker
  重启和存储变更回归，不在本轮扩大范围。
- 对应提交：无。

## 2026-08-27 / Browser Toolbox 独立图标资产与替换后回归 / E-079

- 授权边界：本轮只处理浏览器工具箱产品图标的独立资产收口，不新增功能、权限、依赖或网络行为；没有提交、推送、发布，也没有修改外部路径。项目仍暂不发布。
- 完成内容：将 `icons/` 中的主图标和动作状态图标替换为本项目独立几何设计的 SVG/PNG；PNG
  使用本项目生成的本地图标母图缩放为扩展所需尺寸。图形不包含文字、字母、第三方标志或第三方资产引用；`TRADEMARK.md`
  同步记录了来源边界，并明确不构成商标、著作权或不侵权法律结论。
- 实际执行命令：

```bash
file icons/icon.svg icons/action_enabled.svg icons/action_partial.svg icons/action_disabled.svg icons/icon16.png icons/icon48.png icons/icon128.png icons/action_enabled_16.png icons/action_enabled_32.png icons/action_partial_16.png icons/action_partial_32.png icons/action_disabled_16.png icons/action_disabled_32.png
sips -g pixelWidth -g pixelHeight -g hasAlpha icons/icon16.png icons/icon48.png icons/icon128.png icons/action_enabled_16.png icons/action_enabled_32.png icons/action_partial_16.png icons/action_partial_32.png icons/action_disabled_16.png icons/action_disabled_32.png
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/browser_toolbox/
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
git diff --check
./make.js package
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
deno run -A scripts/build_release.js --package
shasum -a 256 dist/browser-toolbox-0.1.0.zip dist/chrome-store/vimium-chrome-store-0.1.0.zip dist/firefox/vimium-firefox-0.1.0.zip dist/chrome-canary/vimium-canary-0.1.0.zip
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
```

- 测试结果：主图标 16/48/128 和动作图标 16/32 均为带透明通道的 RGBA PNG；单元 `378/378`、DOM
  `109/109`，总计 `487/487`；shoulda `130/130`；权限审计 9 项通过；网络审计扫描 32
  个新增模块通过；`git diff --check`、打包和两次按顺序发布检查均通过。两次构建得到相同归档哈希：BrowserToolbox
  `112c71a2e288745f58f9e1659123f615798a3986e1dddc833c5366024c3c6825`、Chrome
  `f9301c524afd42e64ef217cdbcec837f614d2ba12d2f6d63e7f2d3b58adad478`、Firefox
  `ee25bd6e43bdb2b7ae923e5acba79389c880a06fdc03a8678cc07a93916f4a8e`、Canary
  `f373371df0ab3014e63c057c08d77dd8979e2c6a6d35714e094ae817f61ac9f1`。当前 macOS Chrome Stable 隔离
  E2E 退出码 0，覆盖设置页语义、网站规则、核心输入、导入导出迁移、本地 PNG 指针、跨 frame、fixtures
  和 Service Worker 重启。
- 风险与边界：图标资产已完成当前本地自动检查，但独立设计和生成来源不等于法律上的不侵权结论；正式发布前仍需名称、图标和商标检索。上述浏览器结果仍是隔离自动化，不替代
  Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium
  手工回归或生产签名/真实用户 profile 的旧 CRX 更新验收。工作区仍有未提交修改，项目暂不发布。
- 下一步：继续优先处理真实旧版本 CRX/用户 profile
  更新、人工平台与辅助技术门禁；代码层面暂不因图标变更扩大 Phase 范围。
- 对应提交：无。

## 2026-08-23 / Phase 0 / P0-001

- 完成内容：建立 Vimium v2.4.2 基线；补齐 GPL/MIT
  许可证链、永久免费章程、隐私、安全、商标、第三方通知、协作规则、基线和 ADR-001 至
  ADR-005；把扩展临时名称和说明改为 OpenKeyMouse；移除仅用于上游品牌升级提示的 notifications
  权限和通知路径；未实现鼠标或 Phase 1 功能。
- 修改文件：manifest.json、README.md、background_scripts/main.js、lib/settings.js、pages/options.html、pages/options.js；新增
  LICENSE、LICENSES/MIT-Vimium.txt、LICENSES/MIT-shoulda.txt、PROJECT_CHARTER.md、PRIVACY.md、SECURITY.md、TRADEMARK.md、THIRD_PARTY_NOTICES.md、AGENTS.md、docs/baseline.md、docs/codex-progress.md、docs/adr/001-fork-vimium.md
  至 docs/adr/005-no-telemetry.md；纳入用户提供的设计文档。
- 新增测试：无；复用上游测试体系，未添加 Phase 1 或后续测试。
- 实际执行命令：

```bash
deno --version
deno fmt --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
git diff --check
```

- 测试结果：Deno 2.9.5；deno fmt --check 退出码 1，仍为基线已有的 14
  个未格式化上游/用户文件；上游单元测试 171/171 通过，DOM 测试 107/107 通过，总计 278/278 通过；git
  diff --check 通过。临时 unpacked 加载确认 Service Worker 出现，但 Options 页面返回
  ERR_FILE_NOT_FOUND，Chrome 日志为 content_verify_job failed、reason:1，Options、帮助、链接提示和
  Vomnibar 的手工正常性未通过验证。
- 已知问题：设计文档原文的 Puppeteer 安装命令缺少 npm: 前缀；默认 Puppeteer Chrome for Testing
  缓存缺少 Framework 文件；当前 Chrome 的 unpacked content verification
  阻塞扩展页面手工验证；这些问题均已写入 docs/baseline.md。
- 下一步：仅列 Phase 1 的第一个可执行任务：先为一个现有无副作用命令编写适配测试并定义
  CommandInvocation/CommandResult；本轮不执行。
- 对应提交：待提交。

## 2026-08-23 / 跨阶段一次性实现 / O-001 至 O-006

- 授权边界：用户在完成 Phase 0 后追加授权，一次性实现全部模块并加入国际化；本条不把历史 Phase 0
  记录改写成已经完成，也不据此声称所有平台手工验收已完成。
- 完成内容：实现统一 CommandInvocation/Result、Dispatcher、跨 frame 手势会话校验、命令注册
  适配器、浏览器命令适配器；实现四向/八向右键手势、超级拖拽、滚轮组合、摇杆、轨迹 Shadow DOM
  覆盖层、站点规则、Vimium 排除规则、设置迁移与会话覆盖、自定义本地 PNG 光标；补齐设置页、手势
  编辑器、导入导出、Tab 列表、隐私与许可证页面；新增 en/zh_CN 本地消息和设置页语言切换；保留 GPL/MIT
  许可证链、免费无商业化、无遥测、无新增危险权限和 clean-room 约束。
- 修改文件：manifest.json、README.md、make.js、background_scripts/main.js、
  background_scripts/all_commands.js、background_scripts/open_key_mouse/；
  content_scripts/mode_normal.js、content_scripts/vimium_frontend.js、content_scripts/mouse/；
  lib/i18n.js、lib/open_key_mouse/；`pages/action.*`、pages/options.html、
  `pages/command_listing.*`、`pages/help_dialog_page.*`、`pages/mouse_options.*`、
  `pages/gesture_editor.*`、pages/onboarding.html、pages/privacy.html、`pages/tab_list.*`；
  _locales/en/messages.json、_locales/zh_CN/messages.json；scripts/权限与网络审计、发布检查；
  tests/unit_tests/open_key_mouse/、tests/dom_tests/open_key_mouse_dom_tests.js、tests/fixtures/；
  docs/baseline.md、docs/codex-progress.md、docs/feature-parity-matrix.md、docs/permissions.md、
  docs/release-checklist.md。
- 安全与合规：新增代码只依赖本项目设计文档、Vimium 既有公开代码和公开行为描述独立实现，未
  复制、反编译或移植 CrxMouse 闭源代码、资产、文案或界面；网络审计未发现新增 fetch、XHR、
  WebSocket、Beacon 或后台网络调用；manifest 未增加 notifications、downloads 或远程脚本。
- 实际执行命令：

```bash
deno --version
deno fmt --check
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno check background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
./make.js package
git diff --check
```

- 测试结果：Deno 2.9.5；完整单元测试和 DOM 测试在当前系统 Chrome 覆盖下分别为 277/277、
  109/109，通过总计 386/386；权限审计、网络审计、发布检查和打包均通过；git diff --check 通过；deno
  fmt --check 仍只报告基线已有的 14 个上游/用户文件，未覆盖这些文件。
- 浏览器实测：使用独立的 Chrome for Testing 148.0.7778.96 临时 profile，通过扩展管理页进入
  设置页，确认中文侧栏、English 切换及保存后语言持久化；确认命令下拉包含 OpenKeyMouse
  命令；在真实扩展内容页中确认右键移动时轨迹 Shadow DOM 显示、释放后隐藏且无浏览器错误。
- 浏览器实测补充：上传 icons/icon16.png 后确认内容页注入本地 PNG 光标样式。
- 证据边界：该证据不替代未执行的完整导入导出、超级拖拽、滚轮/摇杆命令链路和跨平台手工矩阵。
- 未验证内容：完整 Vimium 页面手工矩阵、所有手势绑定逐项的真实命令效果、设置导入导出与站点
  规则的浏览器端闭环、Firefox/Safari/Windows/Linux 行为、商店打包安装和无障碍完整回归；不得
  写成已完成。
- 风险：当前 Dispatcher 的会话时效校验已覆盖 mouseGesture；superDrag、wheel、rocker 的真实跨
  frame/页面消息闭环仍需单独 E2E 证据；系统 Chrome 的 unpacked content verification
  限制仍保留在基线记录中。
- 下一步：仅列一个可执行任务：在独立临时浏览器中补充真实扩展消息 E2E，先验证 Super Drag LINK
  前台打开和 Wheel/Rocker 命令路由，再按结果更新功能矩阵。
- 对应提交：本地 main 检查点（最终哈希见 Git 记录，未配置 origin，未推送）。

## 2026-08-23 / 真实扩展消息 E2E 修复与验证 / E-001

- 目标：执行上一条记录指定的真实扩展消息 E2E；使用独立 Chrome for Testing 148.0.7778.96 和全新临时
  profile，不关闭或修改用户现有 Chrome。
- 发现并修复：Super Drag 激活后浏览器仍会先发出原生 `dragstart`，继而触发 `pointercancel`；即使阻止
  `dragstart`，链接还可能在 `pointerup` 后生成默认 click。新增仅在 Super Drag 已激活时阻止
  `dragstart`，并以 500ms 短窗口抑制本次接管产生的 click；同时把 Rocker 的组合识别移到
  `mousedown`/`mouseup`，兼容第二个鼠标按键不产生额外 `pointerdown` 的浏览器事件模型。
- 修改文件：content_scripts/mouse/mouse_controller.js；重新生成 dist/vimium 包。
- 实际执行命令：

```bash
deno fmt content_scripts/mouse/mouse_controller.js
./make.js package
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno check background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
git diff --check
```

- 浏览器实测结果：
  - Super Drag LINK：右拖链接后，原生 `dragstart` 的 `defaultPrevented` 为 true，轨迹层保持
    `block`；释放后新前台标签打开 `https://example.com/`，原 fixture 标签仍保持原 URL。
  - Wheel：通过 CDP 发送右键按住和 `buttons: 2`、`deltaY: -100` 的滚轮事件；事件被阻止，页面
    从滚动位置 1200 回到 0。
  - Rocker：通过 CDP 发送右键按住再按左键；左键 `mousedown`/`mouseup` 被阻止，页面 URL 从 `#two`
    回到 `#one`，确认 `goBack` 路由执行。
  - 三项均在页面错误为空的情况下完成；全量测试为单元 277/277、DOM 109/109。
- 未验证内容：其他 Super Drag 上下文和绑定、Wheel 其他方向、Rocker 反向组合、跨 frame、导入
  导出、站点规则及跨平台行为仍不能写成完成。
- 下一步：仅列一个可执行任务：补齐功能矩阵中剩余的 Super Drag 上下文、Wheel/Rocker 组合和
  设置导入导出/站点规则手工用例，再决定哪些行可以标记 `DONE`。
- 对应提交：本地 main 检查点（未配置 origin，未推送；提交哈希见 Git 记录）。

## 2026-08-23 / 一次性闭环验证与生命周期修复 / E-002

- 授权边界：用户在询问下一步后明确要求“按照建议 一次性完成”；本轮据此完成剩余可执行的 OpenKeyMouse
  闭环验证，但没有把当前 macOS 无法运行的 Windows、Linux、Edge 及真实站点手工矩阵 写成完成。
- 发现并修复：真实右键手势的 pointerdown 与 pointerup 使用了不同 requestId，导致 Dispatcher 会话
  校验取消命令；改为复用同一手势 requestId。Frame bridge 改为带 requestId 的 runtime message，
  并等待 Service Worker 接受会话；加入请求字段校验。修复 bfcache/`pageshow` 后内容控制器监听器
  丢失和重复安装；设置仓库监听器可移除；修复图片原生拖拽的 `blur`/`pointercancel` 先行路径、
  原生属性恢复和点击旁路。Dispatcher 发往内容脚本的内部协议消息补齐 `handler`，避免 Vimium
  消息监听器拒绝页面命令。
- 修改文件：`background_scripts/main.js`、`background_scripts/open_key_mouse/command_dispatcher.js`、
  `background_scripts/open_key_mouse/settings_repository.js`、`content_scripts/mouse/frame_gesture_bridge.js`、
  `content_scripts/mouse/mouse_controller.js`、`tests/unit_tests/open_key_mouse/command_dispatcher_test.js`、
  `scripts/e2e_open_key_mouse.js`、`docs/baseline.md`、`docs/codex-progress.md`、
  `docs/feature-parity-matrix.md`、`docs/release-checklist.md`。
- 实际执行命令与结果：

```bash
./make.js package
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
PUPPETEER_EXECUTABLE_PATH="/tmp/open-key-mouse-cft-lizqY7/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
deno check background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/frame_gesture_bridge.js background_scripts/open_key_mouse/command_dispatcher.js scripts/e2e_open_key_mouse.js tests/unit_tests/open_key_mouse/command_dispatcher_test.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
deno run -A scripts/build_release.js --package
git diff --check
deno fmt --check
```

- 验证结果：`./make.js package` 通过；单元测试 `277/277`、DOM 测试 `109/109`，总计 `386/386`； 隔离
  Chrome for Testing E2E 退出码 0，覆盖核心鼠标轨迹、Super Drag 链接/图片/文字/原生旁路、
  Wheel、Rocker、跨 frame、站点规则、设置导入导出/非法导入和 Service Worker 终止后命令；语法检查、
  权限审计、网络审计、发布检查和 `git diff --check` 均通过。定向 `deno fmt` 检查通过；全仓
  `deno fmt --check` 退出码 1，报告既有上游测试/样式和用户设计文档 14 个文件，以及本轮触及的 3 个
  Markdown 证据文档；检查未修改任何文件。
- 安全边界：权限审计仍为 9 项权限且无禁止权限/远程脚本；网络审计扫描 26 个新增模块文件，未发现
  后台或隐式网络调用；本轮没有引入账户、广告、付费入口、遥测、远程代码，也没有复制或移植 CrxMouse
  闭源代码、资产、文案或界面。以上为审计和当前代码证据，不扩大为平台兼容性声明。
- 风险与未验证：系统 Chrome 151 的 unpacked content verification 仍阻塞扩展页面直接手工加载；
  Windows + Chrome、Windows + Edge、Linux + Chrome，以及 GitHub/Gmail/Google Docs/Notion/YouTube/
  Reddit/在线编辑器/长列表等真实站点矩阵、完整 Vimium 原有 E2E 和无障碍回归未执行。功能矩阵中
  对应项目保持 `IN_PROGRESS`，没有标记为 `DONE`。
- 下一步：在独立 Windows + Edge Stable 临时 profile 中运行与本轮相同的手工兼容性矩阵，并将实际
  结果回写 `docs/feature-parity-matrix.md`；本轮不虚构该结果。
- 对应提交：本地 main 检查点已创建；未配置 origin，不推送。

## 2026-08-23 / 发布包纯净性收口与最终基线重跑 / E-003

- 授权边界：用户明确要求“按照建议 一次性完成”；本条只收口当前本机可执行的发布工程和自动验证， 不把
  Windows、Linux、Edge 或真实第三方站点矩阵写成已验证。
- 发现并修复：`rsync` 的发布排除项原先只排除了 Markdown 文件，商店包仍会携带 `docs/` 目录和
  `scripts/` 下的开发脚本。`make.js` 现显式排除这两个源码仓库专用目录；未修改功能代码、权限、
  网络行为或许可证链。
- 修改文件：`make.js`、`docs/release-checklist.md`、`docs/codex-progress.md`。
- 实际执行命令与结果：

```bash
./make.js package
unzip -l dist/chrome-store/vimium-chrome-store-2.4.2.zip | rg '(^|/)(tests|scripts|docs)/|\.md$|debug|personal|e2e|\.log$|\.pem$|\.key$' || true
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
PUPPETEER_EXECUTABLE_PATH="/Users/yang/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
deno check make.js background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/frame_gesture_bridge.js background_scripts/open_key_mouse/command_dispatcher.js scripts/e2e_open_key_mouse.js tests/unit_tests/open_key_mouse/command_dispatcher_test.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
git diff --check
deno fmt --check
```

- 验证结果：商店包生成通过，禁入路径审计无输出；单元测试 `277/277`、DOM 测试 `109/109`，总计
  `386/386`；Chrome for Testing 148.0.7778.96 独立临时 profile 的完整 E2E 退出码 0，页面错误为空；
  `deno check`、权限审计、网络审计、发布检查、源码发布包生成和 `git diff --check` 通过。Chrome
  商店包和源码发布包均已完成 SHA-256 记录；源码包归档审计未发现测试目录、Markdown 或密钥文件。
- 格式边界：`deno fmt --check` 仍以退出码 1 结束，报告 17 个既有上游、测试/样式、设计文档及本轮 证据
  Markdown 文件；检查未修改文件。定向检查的新增 JavaScript 已通过。
- 额外浏览器尝试：Chromium 145.0.7632.6 可执行文件能输出版本，但启动后 10 秒内没有提供 CDP
  `/json/version`；本地 Chromium 152 下载缺少 Framework 文件，连版本启动均失败。两次都未进入功能
  断言，因此不计入 E2E 通过，也不替代 Windows/Linux/Edge 证据。
- 风险与未验证：完整 Vimium 页面手工回归、Windows + Chrome、Windows + Edge、Linux + Chrome、
  Firefox/Safari、真实第三方站点和无障碍矩阵仍未执行；功能矩阵继续保留 `IN_PROGRESS`。
- 对应提交：本轮本地 main 收口提交；无 `origin`，不推送。

## 2026-08-23 / 增强 Super Drag 与设置闭环验证 / E-004

- 授权边界：用户明确要求“按照建议 一次性完成”；本条继续只记录当前可执行的本地闭环，不把
  Windows、Linux、Edge、真实第三方站点或完整 Vimium 手工矩阵写成完成。
- 发现并修复：真实 Shadow DOM 事件在文档监听器中会把 `event.target` 重定向为宿主元素；超级拖拽
  分类器现结合 `event.composedPath()` 识别 Shadow DOM 内的链接，同时保留文件上传、文本输入、
  textarea、contenteditable、draggable 和危险 URL 的原生/安全旁路。
- 新增验证：BrowserCommandAdapter 的安全 URL、搜索 API、会话模块切换单元测试；Shadow DOM 重定向
  分类单元测试；隔离 fixture 的链接文字/URL复制、图片 URL/下载、选择文字、Shadow DOM、原生输入
  保护、内层滚动、普通右键、Vimium 备份未知字段报告、schemaVersion 逐级迁移和本地 PNG 指针闭环。
- 修改文件：`content_scripts/mouse/drag_context_classifier.js`、`content_scripts/mouse/super_drag_controller.js`、
  `scripts/e2e_open_key_mouse.js`、`tests/unit_tests/open_key_mouse/drag_context_classifier_test.js`、
  `tests/unit_tests/open_key_mouse/browser_command_adapter_test.js`。
- 实际执行命令与结果：

```bash
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno check make.js background_scripts/main.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/super_drag_controller.js content_scripts/mouse/drag_context_classifier.js content_scripts/mouse/frame_gesture_bridge.js background_scripts/open_key_mouse/command_dispatcher.js background_scripts/open_key_mouse/browser_command_adapter.js scripts/e2e_open_key_mouse.js tests/unit_tests/open_key_mouse/browser_command_adapter_test.js tests/unit_tests/open_key_mouse/drag_context_classifier_test.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
deno run -A scripts/build_release.js
./make.js package
deno run -A scripts/build_release.js --package
PUPPETEER_EXECUTABLE_PATH="/Users/yang/Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
git diff --check
```

- 验证结果：单元测试 `282/282`、DOM 测试 `109/109`，总计 `391/391`；权限审计通过 9 项权限，网络
  审计扫描 26 个新增模块且无后台或隐式网络调用；发布检查、商店包/源码包生成、包禁入路径审计和
  `git diff --check` 通过。CFT 148.0.7778.96 独立临时 profile 的增强 E2E 退出码 0，页面错误为空，
  实际覆盖核心手势、Super Drag、Wheel、Rocker、跨 frame、原生安全、站点规则、设置导入导出、 Vimium
  备份迁移、逐级迁移、本地 PNG 指针和 Service Worker 重启。
- 发布包 SHA-256：Chrome 商店包
  `6f4e561c69adaa9c4d7dc13de008efe271e89ff1849413c1f5c7e83d5175b90f`；源码包
  `6962858128eaa13f96661d4db58bb443487208efd1c4f855a9631b0e47a31013`。
- 额外浏览器实际尝试：系统 Chrome 151.0.7922.173 的隔离启动只发现无法提供本项目
  `pages/mouse_options.html` 的扩展目标，脚本在功能断言前退出；不计入通过，也不替代 CFT 148 证据。
  Windows、Linux、Edge、Firefox、Safari 和真实第三方站点仍未验证。
- 格式边界：定向 JavaScript 格式/类型检查通过；全仓 `deno fmt --check` 的既有上游/测试/样式/设计
  文档和证据 Markdown 不作为本轮源码通过依据，也未由检查命令自动改写。
- 风险与未验证：功能矩阵中未达到完整平台手工矩阵的条目继续保持 `IN_PROGRESS`；不能据此声称
  Windows、Linux、Edge、真实站点、完整 Vimium 页面回归或无障碍回归已完成。
- 下一步：在真实 Windows 环境的隔离 Chrome Stable profile 中执行设计文档 §18.4
  手工矩阵，并将实际结果回写功能矩阵。
- 对应提交：本轮本地 main 提交；无 `origin`，不推送。

## 2026-08-23 / Linux ARM64 补充基线与扩展 E2E / E-005

- 授权边界：继续执行用户要求的一次性验证；只记录实际可运行的 Linux ARM64 隔离证据，不把它扩大为
  Linux + Chrome Stable、Windows、Edge、真实第三方站点或无障碍人工验收。
- 环境：Docker `linux/arm64`、Debian 13、Chromium `151.0.7922.169`；完整 `make.js` 基线以非 root
  用户运行，并在一次性隔离容器中使用 `--security-opt seccomp=unconfined` 解决 namespace 启动限制。
- 实际执行与结果：

```text
./make.js test
单元测试：282/282
DOM 测试：109/109
总计：391/391，退出码 0

scripts/e2e_open_key_mouse.js
退出码 0；页面错误为空；设置导入导出、站点规则、核心手势、Super Drag、Wheel、Rocker、跨 frame、Service Worker 重启通过
```

- 该证据补足了 Linux 内核/浏览器运行时的自动测试覆盖，但 Chromium 不是设计文档要求的 Chrome Stable，
  也没有执行 Linux 手工真实站点矩阵；对应功能矩阵继续保持 `IN_PROGRESS`。
- 本次最终重建产物 SHA-256：Chrome 商店包
  `0e6b8b5e62a09d61946bd5d2321105e7758e4b309e05afe8db36ee11c600dfc3`；源码包
  `5fe236b81e2cd3c288988261e100aa39e8ce9b130c7097ec7e3c66a0983300f0`。源码包按设计包含审计和 E2E
  开发脚本，但不包含测试目录、Markdown 文件、密钥或个人路径；商店包不包含 `scripts/`、`docs/`
  或测试目录。
- 修改文件：`docs/baseline.md`、`docs/release-checklist.md`、`docs/codex-progress.md`。
- 风险与未验证：Windows + Chrome、Windows + Edge、macOS + Chrome Stable 手工矩阵、Linux + Chrome
  Stable 手工矩阵、真实第三方站点、完整 Vimium
  页面人工回归、屏幕阅读器/高对比度/缩放回归仍无实际证据。
- 对应提交：待本轮文档核对后创建本地提交；无 `origin`，不推送。

## 2026-08-24 / 设置页无障碍、真实站点冒烟与最终本地门禁 / E-006

- 授权边界：用户明确要求“按照建议 一次性完成”；本轮继续只收口当前环境可执行的代码、自动化、
  隔离浏览器和发布门禁，不把 Windows、Edge、认证态真实站点、屏幕阅读器或人工跨平台矩阵写成完成。
- 修改文件：`pages/mouse_options.html`、`pages/mouse_options.js`、`pages/gesture_editor.css`、
  `lib/i18n.js`、`_locales/en/messages.json`、`_locales/zh_CN/messages.json`、
  `tests/unit_tests/open_key_mouse/i18n_test.js`、`scripts/e2e_open_key_mouse.js`，以及本记录、
  `docs/baseline.md`、`docs/release-checklist.md`、`docs/feature-parity-matrix.md`。
- 实现内容：设置页补充可访问名称、tab/tablist/tabpanel
  语义、键盘导航、文本模式手势录入、焦点可见样式、
  窄视口单列布局和强制颜色/高对比度样式；命令下拉、站点规则和模块开关补充本地化可计算名称。
- 实际执行命令与结果：

```text
macOS Chrome 151.0.7922.173 ./make.js test：单元 282/282，DOM 109/109，总计 391/391，退出码 0
Linux ARM64 Debian 13 Chromium 151.0.7922.169 ./make.js test：单元 282/282，DOM 109/109，总计 391/391，退出码 0
Chrome for Testing 148.0.7778.96 增强扩展 E2E：退出码 0，页面错误为空
Linux ARM64 Chromium 151.0.7922.169 增强扩展 E2E：退出码 0，页面错误为空
deno check（本轮触及 JavaScript）：通过
定向 deno fmt --check（8 个本轮触及文件）：通过
deno run -A scripts/audit_permissions.js：通过，9 项权限
deno run -A scripts/audit_network_usage.js：通过，扫描 26 个新增模块且无后台/隐式网络调用
deno run -A scripts/build_release.js：通过
deno run -A scripts/build_release.js --package：通过，生成源码发布包
商店、Firefox、Canary、源码归档禁入路径审计：无命中
git diff --check：通过
```

- 增强 E2E 新增实际覆盖：11 个 tab/tabpanel 关联、roving tabindex、方向键/Home/End、表单名称、 `L>R`
  文本录入和键盘提交、`forced-colors`/`prefers-contrast` 媒体以及 480px 布局；原有核心手势、 Super
  Drag、Wheel、Rocker、跨 frame、站点规则、设置迁移和 Service Worker 重启仍通过。
- 真实站点隔离冒烟：在不使用登录态的独立 profile 中，9 个页面（静态页、GitHub、Gmail 登录页、 Google
  Docs 登录页、Notion、YouTube、Reddit challenge、StackBlitz、Wikipedia 长列表）均实际返回
  200、内容脚本 `controller`/`initialized` 为真、监听器为 13、页面错误为空；这只是初始化冒烟，不是
  登录态业务或手工手势验收。
- 全仓格式边界：`deno fmt --check` 退出码 1，报告 18 个既有上游测试/样式、设计文档和证据 Markdown
  文件；本轮触及的代码、JSON 和脚本已通过定向格式检查，未用格式化命令改写上游文件。
- 安全边界：没有新增商业化、账户、广告、遥测、远程代码或远程配置；没有复制或移植 CrxMouse 闭源
  代码、资产、文案或界面。真实站点冒烟脚本只用于本地测试，不进入商店包。
- 风险与未验证：当前宿主为 macOS arm64，无可用 Windows VM 或 Edge 安装；系统 Chrome 151 的 unpacked
  content verification 仍导致本项目扩展页面目标不可用，不能把该次失败写成通过。Linux 证据是 ARM64
  Debian Chromium，不是 §18.4 要求的 Linux + Chrome Stable 手工矩阵。认证态
  Gmail/Docs/Notion/在线编辑器、 屏幕阅读器、人工高对比度/缩放、完整 Vimium 原有 E2E
  和四平台手工矩阵仍未验证；矩阵维持原状态。
- 下一步：取得合规的 Windows + Chrome Stable/Edge Stable 测试环境后，按设计文档 §18.4
  逐项执行手工矩阵， 再据实际证据更新 `docs/feature-parity-matrix.md`；在此之前不标记 `DONE`。
- 对应提交：本轮文档核对后创建本地检查点；无 `origin`，不推送。

## 2026-08-24 / 覆盖率门禁、配置仓库与最终跨运行时重跑 / E-007

- 授权边界：继续执行用户明确的“一次性完成”要求；本轮只补齐当前 OpenKeyMouse 实现的可验证缺口，
  不把缺少 Windows、Edge、认证态站点和人工矩阵的部分写成完成，也不改变开源、免费、无商业化、无遥测、
  无远程代码和 clean-room 禁止复制 CrxMouse 闭源代码/资产/文案/界面的约束。
- 代码与测试修改：补充方向量化、手势识别、滚轮、摇杆、光标、超级拖拽、拖拽分类、命令调用、消息协议、
  站点规则、配置校验、命令注册表、配置仓库、帧协调器、浏览器命令适配器和 Dispatcher
  的边界/异常测试； 修复 `BrowserCommandAdapter` 缺失的窗口状态路由，fullscreen 在 fullscreen/normal
  间切换，另支持 minimized 和 maximized，并保留无活动窗口的安全错误返回。
- 覆盖率实际结果：Deno V8 coverage 的 `test-unit` 为 `308/308`；新增纯算法模块行覆盖率均不低于 90%，
  配置模块（schema、validator、migrations、repository）为 `98.1%`–`99.7%`，Dispatcher 为 `100%`，
  本轮纳入范围总计 `97.6%`。这是真实采集结果，不是由单元通过率推定。
- 当前 checkout 的自动验证：

```text
macOS arm64 系统 Chrome 覆盖 ./make.js test：单元 308/308，DOM 109/109，总计 417/417，退出码 0
macOS arm64 Chrome for Testing 148.0.7778.96 增强扩展 E2E：退出码 0，页面错误为空
Linux arm64 Debian 13 Chromium 151.0.7922.169（非 root 临时容器）./make.js test：单元 308/308，DOM 109/109，总计 417/417，退出码 0
Linux arm64 Debian 13 Chromium 151.0.7922.169 增强扩展 E2E：退出码 0，页面错误为空
```

- 其他门禁：`deno check` 通过；权限审计通过（9 项权限，无禁止权限或远程脚本）；网络审计扫描 26
  个新增 模块且无后台/隐式网络调用；`scripts/build_release.js` 和 `./make.js package`
  通过；`git diff --check` 通过。商店包不包含 `docs/`、`scripts/`、测试目录或
  Markdown，源码交付包仍按设计保留开发审计资料。
- 当前重建产物 SHA-256：Chrome 商店包
  `c8af2b604024069ace7e5edd2bbf89b37e783122743649ff0b7b5aa8db7972e6`；Firefox 包
  `c2a02027409c4c4d7f2e6d879a86719a76bc55a5b506abba0efb09a6be09a39a`；Canary 包
  `11af2eacad4b3ea57d530eeae07b4b3b594c38c9eb908bf0e2b2fdc18730bd6e`；源码包
  `ba76e75dda45c2a94b12465c3b4cda59865d4af4713a000e3e8cbc74e7ac96a0`。
- 浏览器边界：系统 Chrome 151 的命令行扩展加载仍明确报告
  `--disable-extensions-except is not allowed` 并忽略加载参数；Windows VM、Edge Stable
  不在当前主机可用环境中。Linux Chromium 隔离结果不等同于 Linux Chrome Stable 手工结果。认证态
  Gmail/Docs/Notion/在线编辑器、屏幕阅读器、人工高对比度/缩放、 完整 Vimium 手工回归和 §18.4
  四平台矩阵仍未验证，功能矩阵维持 `IN_PROGRESS`。
- 下一步：只有在取得合规的 Windows + Chrome Stable/Edge Stable 测试环境并实际完成 §18.4 矩阵后，才可
  更新对应矩阵状态；当前本地工作仅创建检查点，不推送、不发布。
- 对应提交：已创建本地 main 检查点；无 `origin`，不推送。

## 2026-08-24 / 受限动作页修复与最终门禁复核 / E-008

- 授权边界：继续执行用户明确的“一次性完成”要求；只修复已由代码审查确认的受限页 UI 缺口，不扩大
  浏览器权限、网络、商业化或 CrxMouse 参考范围。
- 修改文件：`pages/action.html`、`pages/action.js`、`scripts/e2e_open_key_mouse.js`，并同步本记录、发布检查表
  和功能对照矩阵。
- 修复内容：动作页在判断当前标签页是否存在内容脚本前不再显示 OpenKeyMouse
  操作控件；受限页统一隐藏操作区， 使用 `browserRestriction` 与 `pageUnavailable`
  本地化文案显示浏览器限制。新增 E2E 断言覆盖扩展页面自身这一 受限上下文。
- 实际验证：

```text
macOS arm64 Chrome 151 覆盖下 ./make.js test：单元 308/308，DOM 109/109，总计 417/417，退出码 0
macOS arm64 Chrome for Testing 148.0.7778.96：增强扩展 E2E 退出码 0，页面错误为空
Linux arm64 Debian 13 Chromium 151.0.7922.169（非 root 临时容器）：./make.js test 417/417，增强扩展 E2E 退出码 0
动作页受限分支：CFT 148 与 Linux Chromium 151 均确认提示可见、OpenKeyMouse 控件隐藏
Deno V8 coverage：test-unit 308/308；本轮纳入范围行覆盖率 97.6%，新增纯算法模块 95.2%–100%
权限审计：9 项权限通过；网络审计：26 个新增模块通过；deno check、定向 deno fmt、git diff --check 通过
./make.js package 与 deno run -A scripts/build_release.js --package：通过
商店包、Firefox、Canary、源码包禁入路径审计：无命中
```

- 当前重建产物 SHA-256：Chrome 商店
  `f2ea61ce0868595371b5c26fa627687e37cf2d5bce7498b7c188193716e1e896`； Firefox
  `b61b49dfca555657a2b4f907a6e14895f1df4d0bee8242d38f2a2d7a8265c6f2`；Canary
  `c83f591d63cb4274654ebf098b05b2dfc39dbbb28279fa137826e12c41637317`；源码包
  `9e7424adfbbd3791161b7155ac9fb56e18f3f5b91a8d7023a3163d2f3fa114cd`。
- 浏览器边界：系统 Chrome 的隔离 UI 尝试实际确认“加载已解压”进入原生文件选择器，Puppeteer/CDP
  无法代替 用户选择目录；命令行扩展加载参数也被 Google Chrome 拒绝。因此没有将系统 Chrome Stable
  手工扩展矩阵写成 通过。Windows、Edge、Linux Chrome
  Stable、认证态真实站点、屏幕阅读器、人工高对比度/缩放和完整 Vimium
  手工回归仍未验证，功能矩阵继续保持 `IN_PROGRESS`。
- 对应提交：待本轮提交；仓库仅保留本地检查点，无 `origin`，不推送、不发布。

## 2026-08-24 / 设计文档 fixtures 真实扩展冒烟 / E-009

- 授权边界：继续执行用户明确的“一次性完成”要求；本轮只补齐 §18.2 fixture 的自动化证据，不将其扩大为
  Windows、Edge 或人工平台矩阵完成。
- 修改文件：`scripts/e2e_open_key_mouse.js`，并同步本记录、发布检查表和功能对照矩阵。
- 实际覆盖：通过本地 fixture 服务加载并断言
  `basic-links.html`、`inputs.html`、`scroll-containers.html`、
  `iframes.html`、`shadow-dom.html`、`drag-drop-app.html`、`contenteditable.html`、`images.html`；图片资源在
  测试服务内改写为本地 PNG，未引入第三方网络请求。
- 实际结果：macOS Chrome for Testing 148.0.7778.96 与 Linux ARM64 Debian Chromium 151.0.7922.169 的
  增强扩展 E2E 均退出码 0；两者均同时通过动作页受限提示、核心手势、设置闭环和 Service Worker 重启。
  macOS 系统 Chrome 覆盖下 `./make.js test` 仍为单元 `308/308`、DOM `109/109`，总计 `417/417`。
- 重新生成源码包后 SHA-256：`3630fae8e26603f7a093bf141d891612f2b209cbcdbc59b8647057e32bd62c2c`；
  Chrome 商店、Firefox、Canary 包分别保持
  `f2ea61ce0868595371b5c26fa627687e37cf2d5bce7498b7c188193716e1e896`、
  `b61b49dfca555657a2b4f907a6e14895f1df4d0bee8242d38f2a2d7a8265c6f2`、
  `c83f591d63cb4274654ebf098b05b2dfc39dbbb28279fa137826e12c41637317`。
- 未完成边界：Windows、Edge、Linux Chrome Stable 与 macOS Chrome Stable
  的人工扩展矩阵、认证态真实站点、 屏幕阅读器、人工高对比度/缩放和完整 Vimium
  手工回归仍无可复核证据。

## 2026-08-24 / Edge Linux 隔离运行时补充 / E-010

- 环境：官方 Microsoft Edge `151.0.4129.101`、Debian amd64 隔离容器（ARM 宿主通过 Docker amd64
  模拟）、 非 root 用户、临时 profile；未接触用户浏览器或登录态。
- 实际结果：`./make.js test` 单元 `308/308`、DOM `109/109`，总计 `417/417`；增强扩展 E2E 退出码 0，
  通过核心手势、设置闭环、受限动作页、8 个设计文档 fixture、跨 frame、站点规则、导入导出和 Service
  Worker 重启。
- 边界：这是 Edge 运行时的自动化隔离证据，不是设计文档 §18.4 要求的 Windows Edge Stable 手工结果；
  Windows、Linux Chrome Stable、macOS Chrome Stable
  的人工扩展矩阵、认证态真实站点、屏幕阅读器、人工高对比度/ 缩放和完整 Vimium 手工回归仍未验证。

## 2026-08-24 / 最终发布包重建 / E-011

- `./make.js package` 与 `deno run -A scripts/build_release.js --package`
  均通过；商店包、Firefox、Canary 和源码 包禁入路径审计无命中。
- 本次最终重建 SHA-256：Chrome 商店
  `ff7bae3401955da6b99a4eb656f2060446c73e617a0bea460f54cae995186e23`； Firefox
  `6b918bbf93cf443f3f4a5e16b94ffba0ecedaafa9d641db6ba2d3c929b85c355`；Canary
  `b51a656cdc6bdefaed42ba128d0034ed55fad281694acdfee7a884fba25d38e8`；源码包
  `9c9e2a157638225a2efd85c1ebb7787a387f80e68cba36b0fffa0a9d43279a5f`。

## 2026-08-24 / 预发布版本与 Vimium 设置迁移兼容 / E-012

- 授权边界：继续执行用户明确的“一次性完成”要求；修正设计文档要求的 `0.x`
  预发布版本和当前治理文档事实， 不改变 Vimium `v2.4.2`
  键盘基线，也不放宽开源、免费、无商业化、无遥测和 clean-room 约束。
- 修改内容：`manifest.json` 使用 OpenKeyMouse `0.1.0`；`lib/settings.js` 将上游 `settingsVersion`
  与项目发布版本 分离并固定为 Vimium `2.4.2`；新增 `tests/unit_tests/settings_test.js`
  回归测试；同步 `AGENTS.md`、项目章程、 隐私/安全政策、ADR、CHANGELOG 和发布清单，去除“当前只有
  Phase 0、没有鼠标功能”的陈旧描述。
- 实际验证：

```text
无 PUPPETEER_EXECUTABLE_PATH 的 ./make.js test：环境失败，Puppeteer 缓存的 CFT 131 框架文件缺失；未执行 DOM 断言
macOS 系统 Chrome ./make.js test：单元 309/309，DOM 109/109，总计 418/418，退出码 0
macOS Chrome for Testing 148 增强扩展 E2E：退出码 0，页面错误为空
Linux ARM64 Debian 13 Chromium 151（非 root 临时容器）：单元 309/309，DOM 109/109，总计 418/418；增强 E2E 退出码 0
官方 Microsoft Edge 151.0.4129.101 Debian amd64 隔离容器：单元 309/309，DOM 109/109，总计 418/418；增强 E2E 退出码 0
```

- 安全和工程门禁：权限审计 9 项通过；新增模块网络审计扫描 26 个文件通过；定向 `deno fmt --check` 25
  个文件、 `deno check`、`git diff --check` 和源码/商店包禁入路径审计通过。Deno V8
  当前新增运行时模块范围汇总行覆盖率为 `98.8%`；纯算法模块最低 `95.2%`，配置模块最低
  `98.1%`，Dispatcher `100%`，均达到设计文档阈值。
- 产物：`./make.js package` 与 `deno run -A scripts/build_release.js --package` 通过；生成 `0.1.0`
  商店、Firefox、 Canary 和源码包。Chrome 商店、Firefox、Canary、源码 SHA-256 分别为
  `24db8ba6bb0e080d65d25f8157c35a1537a09ceb955d254e2d12d209d131f145`、
  `f3e2fa2a11737bff263a742ffa5e0bf00c8ef892b23066b44b9bd1bfe49f294f`、
  `c4342265111d5aec7a96e86d3988a32c0d27d63a0a3f91e19aefdb4479a765e3`、
  `19d25dd658d394da3186d128bc471bd77f9803d9742c8a6680f0abd107f54d59`。
- 未完成边界：Windows、Windows Edge、Linux Chrome Stable、macOS Chrome Stable
  人工矩阵，认证态真实站点、 屏幕阅读器、人工高对比度/缩放和完整 Vimium
  手工回归仍没有实际证据；功能矩阵继续保持 `IN_PROGRESS`。
- 本地检查点：已创建提交
  `fix: 收口预发布版本与设置迁移兼容`；工作区最终复核应保持干净；未配置新远端，未推送。

## 2026-08-24 / 官方 Linux Chrome Stable 自动基线 / E-013

- 环境：Docker `linux/amd64`、Debian 13，官方 Google Chrome Stable `151.0.7922.173`，非 root 用户，
  `seccomp=unconfined`，临时 profile，显式
  `PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome`；项目目录只读挂载， Deno 使用容器内可写缓存。
- 实际结果：`./make.js test` 通过，单元 `309/309`、DOM `109/109`，总计 `418/418`，退出码 0。
- unpacked E2E 结果：`scripts/e2e_open_key_mouse.js` 未发现项目的 `background_scripts/main.js` 或
  `service_worker.js` 目标，Chrome 目标列表只出现内置 Google Network Speech
  组件扩展，故在扩展页面探针处超时； 这不是 E2E 通过，也不证明官方 Chrome Stable 已加载
  OpenKeyMouse。
- 边界：该证据补足官方 Linux Chrome Stable 的测试运行时基线，但不替代 §18.3 unpacked E2E、§18.4
  Linux Chrome Stable 手工矩阵，也不改变 `V-002`、`O-001` 至 `O-005` 和 `C-001` 至 `C-003` 的
  `IN_PROGRESS` 状态。
- 本轮未修改运行时代码；后续仍需真实 Chrome Stable UI 加载扩展，或取得可复核的 Windows/Edge
  测试环境。

## 2026-08-24 / Chrome Stable CDP unpacked E2E / E-014

- 修改：`scripts/e2e_open_key_mouse.js` 增加显式环境开关
  `OPEN_KEY_MOUSE_E2E_LOAD_UNPACKED_VIA_CDP=true`；开启时 不使用品牌 Chrome 会忽略的命令行 unpacked
  参数，改用浏览器级 `Extensions.loadUnpacked`，默认 CFT/Chromium 路径保持不变。
- macOS Chrome Stable `151.0.7922.173`：实际加载项目扩展，完整 E2E 退出码 0。
- Linux amd64 Debian 13 Chrome Stable `151.0.7922.173`：非 root、`seccomp=unconfined`、临时 profile
  下， `./make.js test` 为单元 `309/309`、DOM `109/109`、总计 `418/418`；随后通过 CDP
  加载项目扩展，完整 E2E 退出码 0。
- E2E 覆盖：受限动作页、设置页键盘/无障碍语义、鼠标轨迹、历史、Super Drag、Wheel/Rocker、跨
  frame、原生旁路、 站点规则、设置保存/导入导出、Vimium 备份迁移、逐级迁移、本地 PNG 指针、Service
  Worker 重启和 8 个 fixtures。
- 边界：这是官方 Chrome Stable 的真实 CDP 自动化证据，不是 §18.4 人工矩阵；Windows Chrome、Windows
  Edge、 Linux Chrome Stable 人工操作、认证态站点、屏幕阅读器、人工高对比度/缩放和完整 Vimium
  手工回归仍未验证。

## 2026-08-24 / Windows 环境与可见 UI 探测 / E-015

- 环境探测：`prlctl list --all` 返回空列表；Parallels Desktop `26.4.1-57516` 虽已安装，本机也有约
  6.4 GiB 的 Windows ARM64 ISO，但 `/Users/yang/Parallels` 没有 `.pvm`，Docker 仅有 Linux
  镜像。本轮没有创建或启动虚拟机， 没有接触用户浏览器、Cookie、Token 或登录态。
- macOS 隔离 UI 探测：独立临时 Chrome profile 使用浏览器级 `Extensions.loadUnpacked` 加载
  `/Users/yang/project/plugin/open-key-mouse/dist/vimium`，实际出现项目 `background_scripts/main.js`
  Service Worker 目标；随后 `@oai/sky` 的 `get_app_state` 在 30 秒内超时，未形成 Computer Use 人工
  UI 证据。临时 Chrome 进程已关闭。
- 结论边界：本条只记录环境和加载路径事实，不把 CDP 或超时前的启动结果写成 §18.4
  手工矩阵通过；Windows Chrome、 Windows Edge、认证态真实站点、屏幕阅读器、人工高对比度/缩放和完整
  Vimium 手工回归仍未验证。
- 下一步：取得合规的 Windows Chrome Stable/Edge Stable 测试环境后，按设计文档 §18.4
  执行并回写实际结果。

## 2026-08-24 / 修复发布包重复构建哈希漂移 / E-017

- 修改文件：`make.js`、`scripts/build_release.js`、`docs/baseline.md`、`docs/release-checklist.md`、
  `docs/codex-progress.md`。
- 原因：原 `rsync -r` 会把发布目录文件时间更新为当前时间，重复 `zip` 的 SHA-256 会漂移；这与设计文档
  Phase 8 的 可复现构建要求不符。
- 修复：发布同步改为保留源文件时间，生成的各版本 `manifest.json` 恢复源 manifest 时间，ZIP
  排除额外文件属性； 源码归档排除会记录自身哈希的三份审计日志，避免归档自引用。
- 实际结果：连续两次 `./make.js package` 的 Chrome/Firefox/Canary SHA-256 分别稳定为
  `162c01666c97320ece953ab0d5388a1f1b39ef05f7546e504b633d37c9f3c5d`、
  `ed3b903cac7a0e34f4ebb6bbe78689d758f666cdbf915e9cb294e2a5c661f8d2`、
  `95c958cff0208d9b8d5c29f1f60d6fa7f48b23869a1882fddb6d3425c2ff04ef`；连续两次源码包 SHA-256 均为
  `4fa08dd01c30cb490d130d79023a3cd561356b61406091aa3ea3d0b0bbfc0763`。
- 边界：这是本机同一 checkout 的重复构建证据，不替代跨机器干净 checkout 重建或 §18.4 人工矩阵。

## 2026-08-24 / 补齐独立 OpenKeyMouse Deno 测试入口 / E-016

- 修改文件：`tests/open_key_mouse/deno_test_adapter_test.js`、`docs/baseline.md`、`docs/release-checklist.md`、
  `docs/codex-progress.md`。
- 原因：设计文档 §20 明确要求
  `deno test -A tests/open_key_mouse/`，但此前目录不存在；新增入口只负责发现并 导入
  `tests/unit_tests/open_key_mouse/` 的现有 shoulda 测试，再由一个 Deno test
  汇总结果，不复制测试逻辑。
- 实际结果：`deno fmt --check tests/open_key_mouse/deno_test_adapter_test.js` 通过；独立命令
  `deno test -A
  tests/open_key_mouse/` 通过，Deno `1 passed / 0 failed`，shoulda `64/64`，退出码
  0。
- 边界：该入口补齐独立自动测试命令，不改变 Windows/Edge/真实站点认证态或 §18.4 人工矩阵未验证状态。

## 2026-08-24 / 隔离 Windows 11 ARM64 + Chrome 可见 UI 与公开页冒烟 / E-018

- 授权边界：用户明确授权创建并启动隔离 Parallels Windows VM，并确认接受 Windows EULA。本轮只在该隔离
  VM 中安装官方 Windows Chrome 和加载本项目源码；没有创建微软账号，没有输入凭证、Cookie、Token
  或个人资料。
- 环境与隔离：Parallels Desktop `26.4.1-57516`、Apple Silicon 宿主；VM 名称为
  `OpenKeyMouse-Windows-Isolated`，Windows 11 ARM64 Audit Mode
  Administrator。宿主文件夹、共享配置文件、 剪贴板、云同步、打印机/相机/位置等共享均关闭；源码以只读
  ISO 挂载为 Windows `D:\`，不写入宿主仓库。
- 实际 Windows Chrome 证据：
  - 从官方 Chrome 下载页取得 ARM64
    独立安装程序；下载页中的“自动发送使用情况统计信息和崩溃报告”选项在下载前 明确取消。安装后在
    Windows 开始菜单实际出现 Google Chrome；未登录 Google 账号，也未设为默认浏览器。
  - Chrome `chrome://extensions` 开发者模式下实际加载只读 ISO 根目录的未打包扩展；卡片显示
    `OpenKeyMouse 0.1.0`、中文永久免费/无遥测描述和扩展 ID
    `eifkndaeohpehhbflaibgpmgekcndpml`，开关为启用。
  - 从扩展详情页的“扩展程序选项”入口实际打开
    `pages/options.html`，再打开项目自己的鼠标设置入口，中文设置页和
    鼠标手势页均渲染成功；使用键盘焦点与方向键切换到“鼠标手势”“隐私”“关于与许可证”，可见无遥测、GPL-3.0-or-later
    和 clean-room 说明。此项只证明页面可打开与键盘导航可操作，没有把 Windows
    设置保存/导入导出写成已完成。
  - 从扩展详情页打开 `background_scripts/main.js` 的 Service Worker 调试器，控制台实际执行
    `chrome.runtime.id` 并返回上述扩展 ID；观察到控制台无新增错误。扩展卡片同时显示了
    `Service Worker（无效）` 字样，因此 Service Worker 重启的 Windows 人工验收仍不标记为通过。
  - 在未登录的公开 `https://example.com` 页面按 `f` 实际出现链接提示；在公开 `https://iana.org`
    页面按 `j` 实际滚动。 这两项是内容脚本与原有 Vimium 键盘行为的可见冒烟，不是完整 Vimium
    页面矩阵。
  - 按
    [Parallels 官方虚拟键码表](https://docs.parallels.com/landing/parallels-desktop-developers-guide/command-line-interface-utility/manage-virtual-machines-from-cli/general-virtual-machine-management/send-a-keyboard-event-to-a-virtual-machine/list-of-parallels-keyboard-key-codes)
    使用 `prlctl send-key-event`
    发送右键按住/左移和右键滚轮事件；页面没有发生后退、滚动或其他可见命令效果。 该结果只能说明当前
    VM/CLI 输入通道未形成可复核鼠标证据，不据此判定运行时代码正确或错误。
  - 直接在地址栏输入 `chrome-extension://.../pages/options.html` 得到
    `ERR_BLOCKED_BY_CLIENT`，但从扩展详情页的官方选项
    入口可正常打开；该浏览器行为作为限制记录，不把直接地址栏路径写成通过。
- 本轮实际自动测试（当前 checkout、无运行时代码修改）：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 309/309，DOM 109/109，总计 418/418。
deno test -A tests/open_key_mouse/
  退出码 0；Deno 1 passed / 0 failed，shoulda 64/64。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
git diff --check
  退出码 0。
```

- 修改文件：仅追加本条
  `docs/codex-progress.md`；本轮没有修改运行时代码、manifest、权限或依赖。当前代码 SHA 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；本条记录尚未创建新的本地提交，也没有推送。
- 风险与未验证：Windows Chrome 的精确版本号本轮未从“关于 Chrome”页面取得；Windows Edge Stable
  尚未安装或验证； Parallels CLI 未能提供可复核的连续鼠标输入，因此真实右键轨迹、Super
  Drag、Wheel、Rocker、原生上下文菜单阈值和 鼠标命令效果仍未验证。认证态 Gmail/Google
  Docs/Notion/在线编辑器、屏幕阅读器、高对比度/缩放、完整 Vimium 人工回归， 以及 macOS、Linux Chrome
  Stable 的 §18.4 手工矩阵仍无本轮新证据。功能矩阵和发布清单继续保留未完成状态。
- 下一步：在 Windows VM 中取得实际 GUI 鼠标输入能力后，按 §18.3 逐项复核鼠标/拖拽/滚轮/摇杆/Service
  Worker；随后按 §18.4 补齐 Windows Chrome 与 Windows Edge 的公开站点矩阵，再据逐项证据更新
  `docs/feature-parity-matrix.md`，不提前 标记 `DONE`。
- 对应提交：无（仅文档工作区变更，当前 SHA 保持不变）。

## 2026-08-24 / 隔离 Windows 重启后复核与完整自动门禁 / E-019

- 环境动作：在用户授权的 `OpenKeyMouse-Windows-Isolated` 中从官方 Parallels Tools ARM ISO 启动
  `PTAgent` 安装；安装器实际显示完成后重启 Windows。重启完成后 `prlctl list --info` 实际报告
  `GuestTools: state=installed version=26.4.1-57516`，并用 `prlctl exec` 实际返回
  `desktop-str8u79\administrator`。随后将项目只读源码 ISO 重新挂载为 Windows
  `D:\`；没有写入宿主仓库， 没有输入账号、密码、Cookie、Token 或个人资料。
- Windows Chrome 重启后复核：`chrome://extensions` 实际仍显示并启用 `OpenKeyMouse 0.1.0`，扩展 ID 为
  `eifkndaeohpehhbflaibgpmgekcndpml`；在公开 `https://example.com` 按 `f` 实际出现链接提示，在公开
  `https://iana.org` 按 `j`
  实际滚动。该结果证明本轮重启后的公开页键盘/内容脚本冒烟，不替代完整手工矩阵。
- Windows Edge 重启后复核：Windows 内置 Microsoft Edge 实际启动并保留从 `D:\` 加载的扩展；开发者模式
  警告选择“在浏览器重启时提醒”，随后在公开 `https://example.com` 按 `f` 实际出现链接提示，在公开
  `https://iana.org` 按 `j` 实际滚动。Edge 的精确版本号本轮未取得，因此不宣称某个具体 Stable
  版本通过。
- 鼠标输入边界：Parallels Tools 安装后，使用官方 `prlctl send-key-event` 发送右键按住并连续左移 30
  次，
  页面仍没有发生后退、滚动或其他可见命令效果。当前环境仍没有可复核的坐标级真实鼠标输入，因此右键轨迹、
  Super
  Drag、Wheel、Rocker、原生右键阈值和鼠标命令效果继续保持未验证；没有据此判定运行时代码正确或错误。
- 本轮实际自动门禁（当前 checkout、运行时代码未修改）：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 309/309，DOM 109/109，总计 418/418。
deno fmt --check tests/open_key_mouse/deno_test_adapter_test.js
  退出码 0；Checked 1 file。
deno test -A tests/open_key_mouse/
  退出码 0；Deno 1 passed / 0 failed，shoulda 64/64。
deno check（覆盖当前新增运行时、E2E、审计和发布脚本模块）
  退出码 0。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
./make.js package
  退出码 0；三类浏览器包均报告 Archive is current。
deno run -A scripts/build_release.js --package
  退出码 0；生成 dist/open-key-mouse-0.1.0.zip，发布检查通过。
OPEN_KEY_MOUSE_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
  退出码 0；OpenKeyMouse E2E 通过，覆盖核心手势、Super Drag、滚轮、摇杆、跨 frame、设置导入导出、站点规则、
  设计文档 fixtures、本地 PNG 指针和 Service Worker 重启。
git diff --check
  退出码 0。
```

- 修改文件：仅追加本条 `docs/codex-progress.md`；没有修改运行时代码、manifest、权限或依赖。当前代码
  SHA 仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；没有创建新提交，也没有推送。
- 风险与未验证：Windows Chrome/Edge 精确版本号、认证态 Gmail/Google
  Docs/Notion/在线编辑器、屏幕阅读器、 高对比度/缩放、完整 Vimium 人工回归和设计文档 §18.4
  的全部平台/浏览器手工矩阵仍无完整证据；功能矩阵与发布 清单继续保留未完成状态。当前隔离 VM
  仍在运行，Guest Tools 已安装，源码 ISO 仍挂载为 `D:\`。
- 下一步：本机已完成当前可代办的自动门禁、隔离 Windows Chrome/Edge
  公开页复核和证据记录；剩余工作需要可复核
  的坐标级真实鼠标输入以及未覆盖的人工/认证站点验收，不能由现有
  CLI、自动化或无凭证环境代替。不得据此把 `docs/feature-parity-matrix.md` 或发布清单标记为 `DONE`。
- 对应提交：无（仅文档工作区变更，当前 SHA 保持不变）。

## 2026-08-24 / 浏览器工具箱产品定位与命名边界 / E-020

- 完成内容：将对外工作名从 `OpenKeyMouse` 调整为“浏览器工具箱”（Browser
  Toolbox），明确产品是浏览器工作流
  工具箱，而不是鼠标手势扩展；重新组织键盘/命令、页面与浏览器工作流、鼠标输入、本地配置与安全边界四类功能。
  同时明确 CrxMouse 只作为鼠标输入模块的公开行为参考，不是整体产品定义、代码、资产、文案或界面来源。
- 技术兼容边界：保留 `OpenKeyMouse`
  作为仓库目录、命令命名空间、消息协议、存储键、配置导出字段和测试标识； 未进行批量重命名、扩展 ID
  迁移、运行时代码重构，也未新增功能、权限、依赖或网络行为。人工验收保持暂停。
- 修改文件：`AGENTS.md`、`README.md`、`PROJECT_CHARTER.md`、`PRIVACY.md`、`SECURITY.md`、`TRADEMARK.md`、
  `THIRD_PARTY_NOTICES.md`、`CHANGELOG.md`、`manifest.json`、`_locales/en/messages.json`、
  `_locales/zh_CN/messages.json`、`lib/i18n.js`、`pages/action.html`、`pages/command_listing.html`、
  `pages/help_dialog_page.html`、`pages/mouse_options.html`、`pages/onboarding.html`、`pages/options.html`、
  `pages/privacy.html`、`pages/tab_list.html`、`OpenKeyMouse_Codex_可执行开发设计文档.md`、`docs/baseline.md`、
  `docs/feature-parity-matrix.md`、`docs/release-checklist.md`、`docs/adr/006-browser-toolbox-positioning.md`、
  `docs/codex-progress.md`。
- 新增测试：无；本轮只同步定位、治理文档、本地化和用户可见 fallback 文案。
- 实际执行命令：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno fmt --check lib/i18n.js tests/open_key_mouse/deno_test_adapter_test.js
deno test -A tests/open_key_mouse/
deno check（覆盖当前新增运行时、E2E、审计和发布脚本模块）
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
OPEN_KEY_MOUSE_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
git diff --check
```

- 测试结果：最终基线退出码 0；`./make.js test` 为单元 `309/309`、DOM `109/109`，总计 `418/418`；独立
  Deno 测试为 `1 passed / 0 failed`，适配的 shoulda 测试
  `64/64`；定向格式检查、`deno check`、权限审计（9 项）、 网络审计（26 个新增模块）和
  `git diff --check` 均通过；`./make.js package` 和发布检查均通过，生成
  `dist/open-key-mouse-0.1.0.zip`；Chrome Stable CDP 隔离 E2E 退出码 0，覆盖核心手势、Super
  Drag、滚轮/摇杆、 跨 frame、设置导入导出、站点规则、设计文档 fixtures、本地 PNG 指针和 Service
  Worker 重启。
- 已知问题：正式品牌、图标和商标尚未检索确认；内部 `OpenKeyMouse`
  标识仍存在，未来正式改名需要单独设计兼容迁移。 Windows/Edge/Chrome Stable/macOS Chrome Stable
  的人工矩阵、认证态站点、屏幕阅读器、人工高对比度/缩放和完整 Vimium
  手工回归仍不能由本轮自动测试代替；功能矩阵和发布检查表中的人工未完成项未被改为 `DONE`。
- 下一步：先确定正式品牌和是否进行技术标识迁移；在此之前继续以“浏览器工具箱”作为产品范围，以当前测试、矩阵和
  运行态为事实源，不因 CrxMouse 的单个功能参考提前扩大产品范围。
- 对应提交：无（当前 SHA 保持 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有推送）。

## 2026-08-24 / 确定正式对外产品名 / E-021

- 决策：正式采用“浏览器工具箱”（Browser Toolbox）作为对外产品名，不再仅称为工作名；`OpenKeyMouse`
  继续保留为 仓库、命令、消息协议、存储键、配置字段和测试中的内部技术标识。
- 边界：本轮没有进行技术标识批量迁移、扩展 ID
  迁移、运行时代码重构或功能开发；图标归属、商标可用性和法律结论
  仍须单独检索确认。人工验收继续暂停，功能矩阵和发布清单的未完成项没有改为 `DONE`。
- 修改文件：`AGENTS.md`、`README.md`、`PROJECT_CHARTER.md`、`TRADEMARK.md`、`manifest.json`、
  `_locales/en/messages.json`、`_locales/zh_CN/messages.json`、`docs/baseline.md`、
  `docs/adr/006-browser-toolbox-positioning.md`、`OpenKeyMouse_Codex_可执行开发设计文档.md`、`docs/codex-progress.md`。
- 新增测试：无；本轮只更新命名状态、治理说明和本地化元数据。
- 实际执行命令：

```text
git diff --check
node -e 'const fs=require("fs"); for (const p of ["_locales/zh_CN/messages.json","_locales/en/messages.json"]) JSON.parse(fs.readFileSync(p)); console.log("locales JSON 通过")'
deno fmt --check lib/i18n.js tests/open_key_mouse/deno_test_adapter_test.js
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno test -A tests/open_key_mouse/
deno check（覆盖当前新增运行时、E2E、审计和发布脚本模块）
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
OPEN_KEY_MOUSE_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_open_key_mouse.js
git diff --check
```

- 测试结果：全部命令退出码 0；`./make.js test` 为单元 `309/309`、DOM `109/109`、总计 `418/418`；独立
  Deno 测试为 `1 passed / 0 failed`，shoulda `64/64`；格式检查、`deno check`、权限审计 9
  项、网络审计 26 个新增模块、 打包、发布检查和最终 `git diff --check` 均通过；Chrome Stable CDP
  隔离 E2E 通过。
- 风险与未验证：正式名称已确定不等于商标可用；内部技术标识尚未迁移。Windows、Edge、认证态站点、屏幕阅读器、
  人工高对比度/缩放和完整 Vimium 手工回归仍不能由本轮自动测试替代。
- 下一步：如需改名，单独制定 `OpenKeyMouse` 技术标识兼容迁移
  ADR；在迁移前继续保持现有内部命名和键盘行为。
- 对应提交：无（当前 SHA 保持 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，没有推送）。

## 2026-08-24 / BrowserToolbox 技术标识迁移与旧配置兼容 / E-022

- 授权边界：用户明确要求将 `OpenKeyMouse`
  也重命名。本轮只做技术标识迁移和兼容性收口，不新增功能、权限、依赖、网络行为、商业化入口或遥测；人工验收仍未代办。
- 决策：正式产品名为“浏览器工具箱”（Browser Toolbox），内部技术标识统一为
  `BrowserToolbox`。运行时全局对象、命令/消息命名空间、配置键、导出格式、DOM
  标识、脚本、测试目录和施工文档已切换；共享工作区物理路径
  `/Users/yang/project/plugin/open-key-mouse` 保持不动。
- 兼容边界：旧设置键、旧会话覆盖键、旧命令名、旧导出格式和旧本地 PNG
  指针键只在迁移读取路径接受，首次加载写入新规范键；旧键不删除，新保存和导出不再写旧命名。兼容代码集中在
  `background_scripts/browser_toolbox/settings_repository.js`、`background_scripts/browser_toolbox/settings_migrations.js`
  和 `lib/browser_toolbox/settings_validator.js`。
- 主要修改文件：重命名
  `BrowserToolbox_Codex_可执行开发设计文档.md`、`lib/browser_toolbox/**`、`background_scripts/browser_toolbox/**`、`tests/unit_tests/browser_toolbox/**`、`tests/browser_toolbox/**`、`tests/dom_tests/browser_toolbox_dom_tests.js`、`scripts/e2e_browser_toolbox.js`；同步
  manifest、主后台、内容脚本、页面、国际化、审计脚本和治理文档；新增
  `docs/adr/007-browser-toolbox-technical-rename.md`。
- 实际执行命令：

```text
git status --short --branch && git rev-parse HEAD
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno fmt --check lib/i18n.js lib/settings.js lib/browser_toolbox background_scripts/browser_toolbox pages/action.js pages/command_listing.js pages/gesture_editor.js pages/mouse_options.js pages/tab_list.js scripts/audit_network_usage.js scripts/audit_permissions.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox tests/dom_tests/browser_toolbox_dom_tests.js tests/unit_tests/browser_toolbox tests/unit_tests/test_chrome_stubs.js
deno test -A tests/browser_toolbox/
deno check background_scripts/main.js pages/action.js pages/command_listing.js pages/gesture_editor.js pages/tab_list.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox/deno_test_adapter_test.js tests/dom_tests/browser_toolbox_dom_tests.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
git diff --check
```

- 测试结果：上述最终检查项均退出码 0。单元 `311/311`、DOM `109/109`，总计 `420/420`；独立 Deno 入口
  `1 passed / 0 failed`，shoulda `66/66`；格式检查 `45` 个文件、`deno check`、权限审计 `9`
  项、网络审计 `26` 个新增模块均通过；打包和发布检查通过，生成
  `dist/browser-toolbox-0.1.0.zip`；新命名 Chrome Stable CDP 隔离 E2E 退出码
  0，覆盖设置导入导出、站点规则、核心手势、超级拖拽、滚轮、摇杆、跨 frame、fixture、本地 PNG 指针和
  Service Worker 重启；`git diff --check` 通过。
- 包内容审计：发布包路径中未发现旧代码目录或旧脚本文件名；旧标识仅作为兼容输入常量、兼容测试 fixture
  和历史记录保留。
- 风险与未验证：本次未移动共享工作区根目录；旧配置兼容已由单元测试验证，但从迁移前真实安装升级到新版本的人工浏览器验收尚未执行。Windows、Edge、Linux
  Chrome Stable、macOS Chrome Stable 人工矩阵、认证态站点、屏幕阅读器、人工高对比度/缩放和完整
  Vimium 手工回归仍不能由本轮自动化结果替代；商标可用性仍未检索确认。
- 隐私与开源复核：未新增权限、依赖或网络调用；无账户、订阅、广告、付费功能、遥测、远程代码；未复制或改写
  CrxMouse 闭源代码、资产、文案或界面；Vimium MIT 与新代码 GPL-3.0-or-later 边界保持不变。
- 对应提交：无；当前 SHA 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，工作区保留用户已有未提交修改，没有推送。

## 2026-08-25 / 授权后再次执行 CRX 安装更新门禁 / E-027

- 授权边界：用户明确授权继续执行本项本地 CRX 安装更新验收并给予最高操作权限。本轮仍严格限制在一次性
  `/tmp` 临时目录、临时签名、隔离 Chrome profile 和临时原生拖拽进程；没有操作用户日常
  Chrome，没有输入账户、密码、 Cookie、Token 或个人资料，没有授予 ChatGPT
  新的系统控制权限，没有提交、推送或修改外部项目路径。
- 实际准备：从当前 `dist/open-key-mouse-0.1.0.zip` 与 `dist/browser-toolbox-0.1.0.zip`
  解包临时副本；将当前副本版本 临时改为 `0.1.1`；使用同一个临时 PEM 通过 `crx3` 生成旧版 `old.crx`
  和当前版 `current.crx`。临时版本和签名均未写回仓库。
- 实际操作：在 Chrome Stable `151.0.7922.174` 的独立 profile 打开 `chrome://extensions`
  并启用开发者模式；执行 CDP `Input.dispatchDragEvent`（网页可观察到 `Files` 和 `old.crx` 文件大小
  `302241`），随后调用 `chrome.developerPrivate.installDroppedFile`；又执行 Finder
  的系统级拖放和临时 AppKit `NSDraggingSession` 原生拖放。
- 实际结果：三条路径的回调/拖放动作均未产生已安装扩展；随后通过
  `chrome.developerPrivate.getExtensionsInfo({})` 实际核对，
  返回空数组，扩展页没有旧版卡片，因而没有进入当前版更新、扩展 ID
  不变或迁移快照断言。该门禁仍为“未验证”，没有把同签名 打包成功写成安装更新通过。
- 实际执行命令与结果：

```text
npm install --prefix /tmp/browser-toolbox-crx-test-20260825 --no-save --ignore-scripts crx3@2.0.0
/tmp/browser-toolbox-crx-test-20260825/node_modules/.bin/crx3 -p /tmp/browser-toolbox-crx-test-20260825/browser-toolbox-test.pem -o /tmp/browser-toolbox-crx-test-20260825/old.crx /tmp/browser-toolbox-crx-test-20260825/old
/tmp/browser-toolbox-crx-test-20260825/node_modules/.bin/crx3 -p /tmp/browser-toolbox-crx-test-20260825/browser-toolbox-test.pem -o /tmp/browser-toolbox-crx-test-20260825/current.crx /tmp/browser-toolbox-crx-test-20260825/current
agent-browser --cdp 9345 open chrome://extensions
Chrome DevTools Protocol -> Input.dispatchDragEvent(dragEnter/dragOver/drop) + chrome.developerPrivate.installDroppedFile()
Chrome DevTools Protocol -> chrome.developerPrivate.getExtensionsInfo({}) 结果为 []
Finder 系统级拖放；临时 Swift AppKit NSDraggingSession 拖放
```

- 清理：隔离 Chrome 已停止；临时 CRX、同签名 PEM、profile、Finder
  窗口和截图已移入系统废纸篓（可恢复），没有留在 `/tmp`； 用户日常 Chrome 未关闭或重启。
- 风险与未验证：当前 macOS Chrome 的本地 CRX 原生安装通道仍未能在隔离 profile
  中完成，因此真实旧安装到当前安装的自动更新 语义仍未验证。这不改变 E-025 已通过的真实 Chrome
  storage 迁移和旧导出导入结果，也不改变 Windows、Edge、Linux Chrome Stable、 macOS Chrome Stable
  人工矩阵、认证态站点、屏幕阅读器、高对比度/缩放和完整 Vimium 手工回归的未完成状态。
- 下一步：要关闭该门禁，需要可复核的迁移前真实安装包和允许本地扩展安装的受控 Chrome
  安装/发布通道（例如项目实际采用的 安装更新流程）；在获得该环境前不修改运行时、不绕过 Chrome
  安全策略，也不宣称发布验收完成。
- 对应提交：无；当前 SHA 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，工作区保留用户已有未提交修改，没有推送。
- 下一步：只剩外部人工门禁，优先验证“旧版本设置/导出文件升级到新版本”以及目标浏览器与无障碍矩阵；在这些证据产生前不宣称发布验收完成。

## 2026-08-24 / 物理工作区目录重命名 / E-023

- 用户明确要求同步修改目录名；已将 `/Users/yang/project/plugin/open-key-mouse` 重命名为
  `/Users/yang/project/plugin/browser-toolbox`。
- 目标目录此前不存在；目录移动后重新确认 `git status`、仓库根路径、HEAD 和关键代码路径均正常，HEAD
  仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`。
- 目录移动动作本身只改变物理路径，没有修改代码、扩展
  ID、权限、依赖、网络行为或配置迁移逻辑；随后已将当前 AGENTS、章程和 ADR
  同步为新路径，历史基线中的旧绝对路径保留为历史记录。
- 测试：目录移动不改变文件内容；E-022 已实际完成 `420/420` 基线、独立 Deno
  `66/66`、权限/网络审计、打包和隔离 Chrome
  E2E。目录移动后未重复运行完整测试，不能把本条目录核对等同于重新测试。
- 风险：外部脚本、IDE 工作区或快捷方式若硬编码旧路径，需要改用
  `/Users/yang/project/plugin/browser-toolbox`；旧路径当前已不存在。
- 对应提交：无；未推送。下一步是更新任何外部硬编码路径，并按需要进行旧配置升级的人工验收。

## 2026-08-24 / 目录迁移后完整回归与旧配置升级验收 / E-024

- 授权边界：继续收口 E-023 后的当前 checkout
  和旧配置兼容门禁；本轮不新增产品功能、权限、依赖、网络行为、商业化入口或遥测，不提交、不推送、不修改外部路径。
- 完成内容：在 `/Users/yang/project/plugin/browser-toolbox` 重新执行 E-022
  同口径完整本地回归；在真实隔离 Chrome 临时 profile
  中补验旧版导出格式、旧设置键、旧会话覆盖键、旧命令命名空间和旧本地 PNG
  指针资源，确认迁移后写入规范键、保留旧键、保存本地备份且旧指针仍能在页面中生效。
- 缺陷修复：增强旧版 `gestureBindings` 验收后发现原迁移测试使用默认首项 `L` 造成假阳性；修复
  `settings_migrations.js` 先保留原始输入再逐级迁移、最后补齐默认值，并将单元断言改为使用 `R` 与
  `OpenKeyMouse.newWindow` 验证真实转换。E2E 中的 Vimium 备份提示断言同步兼容中英文本地化文本。
- 修改文件：`background_scripts/browser_toolbox/settings_migrations.js`、`tests/unit_tests/browser_toolbox/settings_migrations_test.js`、`scripts/e2e_browser_toolbox.js`、`docs/codex-progress.md`；其中前三项均位于当前用户已有技术标识迁移工作区内。
- 实际执行命令：

```text
git status --short --branch
git rev-parse --show-toplevel
git rev-parse HEAD
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
deno fmt --check lib/i18n.js lib/settings.js lib/browser_toolbox background_scripts/browser_toolbox pages/action.js pages/command_listing.js pages/gesture_editor.js pages/mouse_options.js pages/tab_list.js scripts/audit_network_usage.js scripts/audit_permissions.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox tests/dom_tests/browser_toolbox_dom_tests.js tests/unit_tests/browser_toolbox tests/unit_tests/test_chrome_stubs.js
deno test -A tests/browser_toolbox/
deno check background_scripts/main.js pages/action.js pages/command_listing.js pages/gesture_editor.js pages/tab_list.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox/deno_test_adapter_test.js tests/dom_tests/browser_toolbox_dom_tests.js
deno run -A scripts/audit_permissions.js
deno run -A scripts/audit_network_usage.js
./make.js package
deno run -A scripts/build_release.js --package
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
git diff --check
```

- 测试结果：目录迁移后的主测试单元 `311/311`、DOM `109/109`，总计 `420/420`；独立 Deno 入口
  `1 passed / 0 failed`，shoulda `66/66`；格式检查 `45` 个文件、`deno check`、权限审计 `9`
  项、网络审计 `26` 个新增模块、打包、发布检查和最终 `git diff --check` 均通过。增强后的隔离 Chrome
  E2E 最终退出码 0，覆盖旧版导出导入、旧设置/会话键迁移、旧 PNG
  指针实际页面应用、设置导入导出、站点规则、核心手势、超级拖拽、滚轮、摇杆、跨 frame、fixtures 和
  Service Worker 重启。
- 失败与复核：第一次增强 E2E 在旧版导出 `R` 绑定处超时，实际暴露默认配置遮蔽 `gestureBindings`
  的迁移缺陷；修复后主测试和 E2E 通过。发布包对应的一次完整 E2E 在所有迁移断言通过后于设计文档
  fixture 控制器等待处出现单次时序超时，原命令立即重跑通过；该时序稳定性仍作为风险保留。
- 风险与未验证：本轮是基于旧格式/旧键真实 fixture 的隔离 Chrome
  验收，不等同于从迁移前真实安装包或真实 Chrome 用户 profile 升级；Windows、Edge、Linux Chrome
  Stable、macOS Chrome Stable 人工矩阵、认证态站点、屏幕阅读器、人工高对比度/缩放和完整 Vimium
  手工回归仍未完成。不得据此宣称发布验收完成。
- 隐私与开源复核：未新增权限、依赖或网络调用；无账户、订阅、广告、付费功能、遥测或远程代码；旧名称仅出现在兼容迁移逻辑和兼容
  E2E fixture 中。
- 对应提交：无；当前 SHA 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，工作区继续保留用户已有未提交修改，没有推送。
- 下一步：在可用的迁移前实际构建或安装包基础上，于一次性临时 profile
  完成真实旧版本导出/当前版本导入验收；若无可用历史安装包，则保持该项为未验证，再进入目标浏览器和无障碍人工矩阵。

## 2026-08-24 / 真实 Chrome storage 迁移与旧包导出导入验收 / E-025

- 授权边界：用户明确授权代为执行旧配置升级验收。本轮只使用 `/tmp`
  下的一次性旧版源码归档、临时发布包、隔离 Chrome profile 和临时 Deno 验收脚本；没有触碰用户 Chrome
  profile、没有输入账号/密码、Cookie、Token 或个人资料， 没有提交、推送或修改外部路径。所有临时
  profile、旧版归档、导出文件和脚本已在验收后按精确路径清理。
- 代码修复：`background_scripts/browser_toolbox/settings_repository.js`
  新增递归的实际值比较，迁移判定不再依赖 `JSON.stringify` 的对象键顺序；这样 Chrome storage
  重排规范配置时，不会把已迁移配置覆盖到本地迁移备份。新增
  `tests/unit_tests/browser_toolbox/settings_repository_test.js`
  覆盖键顺序变化不应创建备份，以及旧设置迁移前原始对象 必须保留为备份。
- 旧版真实导出：从当前 HEAD
  的一次性旧源码归档重新执行旧包打包，实际打开旧版设置页并点击导出，得到旧格式文件； 文件实际确认
  `format=open-key-mouse-settings`、`source=OpenKeyMouse`，内容含 `OpenKeyMouse.*`
  命令名。该文件随后 被当前 BrowserToolbox 设置页实际上传导入，导入后的规范配置不含旧命令命名空间。
- 当前包真实 Chrome storage 迁移：在隔离 Chrome 中加载当前 `dist/vimium`，通过当前扩展页真实调用
  `chrome.storage.sync/local/session` 写入 schema 0、旧设置键、旧会话覆盖键和旧本地 PNG；关闭 Chrome
  后使用同一 profile、同一扩展 ID 重启当前包，再由当前设置页读取迁移结果。实际快照为：规范键
  `schemaVersion=3`，`R` 绑定命令为 `BrowserToolbox.newWindow`，旧设置键仍为 schema
  0，`browserToolboxSettingsMigrationBackup` 仍为 schema 0 原始值， 旧 `openKeyMouseCursor-*` PNG
  在真实页面应用成功。Chrome 重启后 `storage.session` 按浏览器生命周期清空，未把它
  写成持久迁移失败；E-024 的同进程隔离 E2E 已覆盖规范/旧会话键同时存在和旧键保留。
- 当前包新导出：导入旧包实际导出后再次从当前设置页导出，实际确认 `format=browser-toolbox-settings`、
  `source=BrowserToolbox`，内容不含 `OpenKeyMouse`。
- 本轮实际自动门禁（当前 checkout）：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 312/312、DOM 109/109，总计 421/421。
deno fmt --check lib/i18n.js lib/settings.js lib/browser_toolbox background_scripts/browser_toolbox pages/action.js pages/command_listing.js pages/gesture_editor.js pages/mouse_options.js pages/tab_list.js scripts/audit_network_usage.js scripts/audit_permissions.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox tests/dom_tests/browser_toolbox_dom_tests.js tests/unit_tests/browser_toolbox tests/unit_tests/test_chrome_stubs.js
  退出码 0；Checked 45 files。
deno test -A tests/browser_toolbox/
  退出码 0；Deno 1 passed / 0 failed，shoulda 67/67。
deno check background_scripts/main.js pages/action.js pages/command_listing.js pages/gesture_editor.js pages/tab_list.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox/deno_test_adapter_test.js tests/dom_tests/browser_toolbox_dom_tests.js
  退出码 0。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
./make.js package
  退出码 0；当前 BrowserToolbox 归档更新完成。
deno run -A scripts/build_release.js --package
  退出码 0；发布检查通过，生成 dist/browser-toolbox-0.1.0.zip。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；命名版 Chrome E2E 通过。
临时当前包 Chrome storage/旧导出导入脚本（脚本和 profile 已清理）
  退出码 0；真实迁移快照、旧 PNG 页面应用、旧包实际导出导入和当前规范导出均通过。
git diff --check
  退出码 0。
```

- 真实升级边界：本轮也尝试让旧包和当前包在同一隔离 profile、同一扩展 ID 下通过 unpacked/CDP
  重载切换；Chrome 对 unpacked 扩展复用旧 Service
  Worker/安装实例，无法形成可证明的“旧安装版本自动更新到新安装版本”语义。该尝试的
  结果只记录为环境/加载方式限制，不把它写成项目升级失败，也不把当前包写入旧键后的真实 storage
  重启验收冒充真实 安装包升级。要关闭这项门禁，仍需真实迁移前安装包或可复核的 Chrome
  扩展安装更新流程。
- 风险与未验证：本轮不改变 Windows、Edge、Linux Chrome Stable、macOS Chrome Stable
  人工矩阵、认证态站点、屏幕 阅读器、高对比度/缩放和完整 Vimium
  手工回归的未完成状态；不据自动化结果宣称人工验收、认证站点或无障碍认证完成。
- 隐私与开源复核：未新增权限、依赖或网络行为；无账户、广告、订阅、付费功能、遥测、远程代码、`eval`/`new Function`；
  未复制或改写 CrxMouse 闭源代码、资产、文案或界面；旧名称仍只出现在兼容迁移、兼容 fixture
  和历史记录中。
- 当前状态：当前 HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留用户已有未提交修改以及本轮
  代码/测试/文档修改，没有创建提交或推送。
- 下一步：取得可复核的迁移前真实安装包后重做“安装版本自动升级”门禁；在此之前保持该项边界为“当前包真实
  storage 迁移和旧导出导入已通过，真实安装更新语义未验证”，再处理剩余平台、无障碍和人工回归门禁。
- 对应提交：无。

## 2026-08-24 / 迁移前 CRX 同签名安装更新门禁尝试 / E-026

- 授权边界：用户明确授权代为继续执行旧版本升级验收。本轮只在 `/tmp`
  使用一次性旧版归档、当前发布包的临时副本、 同签名 CRX、隔离 Chrome profile 和临时 Finder/Chrome
  窗口；没有触碰用户 Chrome profile，没有输入账户、密码、Cookie、 Token
  或个人资料，没有提交、推送或修改外部路径。
- 实际准备：核对旧版与当前发布包的 manifest、版本和代码目录；在临时副本中将当前包版本递增为
  `0.1.1`，使用 Chrome 的 `chrome.developerPrivate.packDirectory` 以同一个临时 PEM
  分别生成旧包与当前包 CRX。该版本修改仅存在于 `/tmp`，未改动仓库。
- 实际验收：启动独立的 Chrome Stable profile，打开 `chrome://extensions` 并启用开发者模式；分别尝试
  CDP 的文件拖放事件、 Finder 到 Chrome 的系统级拖放，以及 Chrome 内部 `installDroppedFile`
  所依赖的扩展页拖放流程。扩展页曾显示拖放遮罩， 但旧 CRX 没有被安装，因而无法继续验证“同一扩展 ID
  下旧版本安装后更新为当前版本”的真实更新语义。
- 实际执行命令与调用：

```text
npm pack crx3
npm install --prefix /tmp/browser-toolbox-crx-test.esAIp2 --no-save --ignore-scripts crx3@2.0.0
Chrome DevTools Protocol -> chrome.developerPrivate.packDirectory(oldDir, "", 0/1)
Chrome DevTools Protocol -> chrome.developerPrivate.packDirectory(currentDir, oldPem, 0/1)
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/browser-toolbox-native-ui.1hhUvf --remote-debugging-port=9335 --no-first-run --no-default-browser-check --disable-background-networking --disable-component-update chrome://extensions
Chrome DevTools Protocol -> Input.dispatchDragEvent(... old.crx ...)
git diff --check
```

- 结果：CRX 打包和同签名准备成功；CDP
  与系统级拖放均未产生已安装扩展，未产生可复核的旧版本到当前版本更新结果，
  因此本条门禁保持“未验证”，没有把拖放遮罩或打包成功写成升级通过。临时 Chrome、Finder
  窗口、旧包、CRX 和临时 PEM 已按精确路径停止并清理；未授予 ChatGPT 控制 Finder 的 macOS 权限。
- 当前 checkout 自动检查：文档追加后重新执行
  `PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`，
  应记录为单元 `312/312`、DOM `109/109`，总计 `421/421`；`git diff --check` 通过。
- 风险与未验证：真实旧版本安装包自动更新门禁仍未关闭；这不是设置迁移失败，而是当前可用的隔离 Chrome
  自动化路径未能完成 原生 CRX 拖放安装。Windows、Edge、Linux Chrome Stable、macOS Chrome Stable
  人工矩阵、认证态站点、屏幕阅读器、高对比度/缩放 和完整 Vimium
  手工回归仍未完成；不得据此宣称发布验收完成。
- 下一步：需要一个可复核的迁移前真实安装包和能执行 Chrome
  原生扩展安装拖放的人工/受控浏览器窗口，完成旧 CRX 安装、当前 CRX 更新、扩展 ID
  不变、迁移快照与旧键备份断言；若不具备该环境，保持本条未验证，转入平台与无障碍人工门禁清单，不修改运行时。
- 对应提交：无；当前 SHA 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，工作区保留用户已有未提交修改，没有推送。

## 2026-08-25 / 网站规则支持 Glob/正则与逐模块停用 / E-028

- 授权边界：用户明确要求网站规则覆盖浏览器工具箱的每个现有功能模块，并支持正则表达式。本轮只修改当前工作区内的
  配置 schema、迁移、匹配器、设置页、国际化和测试；没有提交、推送、发布或修改外部路径。
- 功能实现：配置 schema 升至 4；旧规则迁移时默认 `matchType=glob` 和
  `enabled=true`，保留既有规则字段；设置页新增 Glob/正则
  选择、正则输入提示、站点总开关，以及键盘、鼠标手势、超级拖拽、滚轮、摇杆、自定义指针六个模块的逐项“在此站点停用”选项。
  Glob 继续使用原有全匹配和匹配度排序；正则使用不执行脚本的 `RegExp(pattern, "i")`，长度限制仍为
  2048，非法正则由校验拒绝。 规则总开关停用时，当前已知模块的有效状态全部为停用；站点 URL
  仍由顶层页面统一决定所有 frame 的有效状态。
- 测试覆盖：新增正则匹配、非法正则、规则总开关、schema 3 到 4
  迁移、仓库正则解析和设置页正则/模块保存断言；没有新增权限、依赖或网络行为。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 313/313、DOM 109/109，总计 422/422。
deno test -A tests/browser_toolbox/
  退出码 0；Deno 1 passed / 0 failed，shoulda 68/68。
deno check background_scripts/main.js pages/action.js pages/command_listing.js pages/gesture_editor.js pages/tab_list.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox/deno_test_adapter_test.js tests/dom_tests/browser_toolbox_dom_tests.js
  退出码 0。
./make.js package
  退出码 0；当前工作区归档更新完成。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 通过 Extensions.loadUnpacked 加载当前归档，设置页正则/模块保存、运行时正则站点规则、迁移、核心手势、跨 frame 和 Service Worker 重启均通过。
deno fmt --check lib/i18n.js lib/browser_toolbox/settings_schema.js lib/browser_toolbox/settings_validator.js lib/browser_toolbox/site_rule_matcher.js background_scripts/browser_toolbox/settings_migrations.js pages/mouse_options.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/site_rule_matcher_test.js tests/unit_tests/browser_toolbox/settings_migrations_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
  退出码 0；Checked 11 files。
jq empty _locales/en/messages.json _locales/zh_CN/messages.json
  退出码 0；两份本地化 JSON 有效。
git diff --check
  退出码 0。
```

- 风险与未验证：以上是自动化和隔离 Chrome 证据，不等同于 Windows、Edge、Linux Chrome Stable、macOS
  Chrome Stable 的人工矩阵， 也不等同于认证态站点、屏幕阅读器、人工高对比度/缩放或完整 Vimium
  手工回归；这些门禁仍未完成。真实旧安装包自动更新语义仍按 E-025/E-026 保持未验证。项目暂不发布。
- 隐私与开源复核：没有新增权限、依赖、后台网络、遥测、账户、广告、订阅、付费功能、远程代码、`eval`
  或 `new Function`；没有复制 CrxMouse
  闭源代码、资产、文案或界面。旧名称仍只出现在兼容迁移层、兼容测试 fixture 和历史记录中。
- 当前状态：当前 HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区继续保留用户已有未提交修改以及本轮代码、测试和文档修改，
  没有创建提交或推送。
- 下一步：实现用户已确认的多级设置导航，把网站规则作为独立一级分类下的二级设置页；随后继续剩余平台、无障碍和人工回归门禁。
- 对应提交：无。

## 2026-08-25 / 多级设置导航 / E-029

- 授权边界：用户确认多级设置页面效果后要求进入下一步。本轮只修改当前工作区内的设置页导航、样式、国际化和隔离
  E2E 断言；没有提交、推送、发布或修改外部路径。
- 功能实现：设置页改为六个一级分类——导航与键盘、鼠标与拖拽、搜索与标签、外观与行为、站点与隐私、备份与关于；现有
  11
  个设置面板作为二级页面归入分类。点击二级页面只显示对应主面板，切换时自动展开所属分类并收起其他分类；保留既有
  `data-section`
  选择器，网站规则位于“站点与隐私”下。一级分类和二级页面均支持键盘焦点、方向键、Home/End，二级
  tablist、tabpanel、`aria-expanded` 和 `aria-controls` 语义同步更新。
- 界面与本地化：新增六个分类的中英文文案；补充层级缩进、展开箭头、选中态、窄视口单列布局和高对比度样式。没有新增权限、依赖或网络行为。
- 测试覆盖：E2E 设置页断言覆盖 6 个一级分类、6 个垂直二级 tablist、11 个二级 tab、11
  个面板、分类展开/收起、跨分类键盘移动和一级分类点击选中首项；原有设置保存、备份、网站规则、鼠标手势及迁移流程保持覆盖。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 313/313、DOM 109/109，总计 422/422。
deno test -A tests/browser_toolbox/
  退出码 0；Deno 1 passed / 0 failed，shoulda 68/68。
./make.js package
  退出码 0；当前 BrowserToolbox 归档更新完成。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable 通过 Extensions.loadUnpacked 加载当前归档，设置页层级导航、网站规则正则/模块保存、迁移、核心手势、跨 frame 和 Service Worker 重启均通过。
deno check background_scripts/main.js pages/action.js pages/command_listing.js pages/gesture_editor.js pages/mouse_options.js pages/tab_list.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox/deno_test_adapter_test.js tests/dom_tests/browser_toolbox_dom_tests.js
  退出码 0。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
deno fmt --check lib/i18n.js lib/browser_toolbox/settings_schema.js lib/browser_toolbox/settings_validator.js lib/browser_toolbox/site_rule_matcher.js background_scripts/browser_toolbox/settings_migrations.js pages/mouse_options.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/site_rule_matcher_test.js tests/unit_tests/browser_toolbox/settings_migrations_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js pages/mouse_options.html pages/gesture_editor.css
  退出码 0；Checked 13 files。
jq empty _locales/en/messages.json _locales/zh_CN/messages.json
  退出码 0；两份本地化 JSON 有效。
git diff --check
  退出码 0。
```

- 可视化与验收边界：曾尝试使用 Codex 内置浏览器直接打开本地扩展 `file://` 设置页，但被浏览器本地文件
  URL 策略拒绝；没有绕过该限制。随后使用项目既有的隔离 Chrome CDP E2E
  完成真实设置页加载和交互验证；这仍是自动化证据，不写成人工验收、屏幕阅读器验收或无障碍认证。
- 风险与未验证：以上自动化结果不等同于 Windows、Edge、Linux Chrome Stable、macOS Chrome Stable
  人工矩阵、认证态站点、屏幕阅读器、人工高对比度/缩放或完整 Vimium
  手工回归；这些门禁仍未完成。真实旧安装包自动更新语义仍按 E-025/E-026 保持未验证。项目暂不发布。
- 隐私与开源复核：没有新增权限、依赖、后台网络、遥测、账户、广告、订阅、付费功能、远程代码、`eval`
  或 `new Function`；没有复制 CrxMouse
  闭源代码、资产、文案或界面。旧名称仍只出现在兼容迁移层、兼容测试 fixture 和历史记录中。
- 当前状态：当前 HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区继续保留用户已有未提交修改以及本轮代码、测试和文档修改，没有创建提交或推送。
- 下一步：保持项目不发布，优先取得可复核的迁移前真实安装包并完成旧版本安装更新门禁；若外部环境仍不可用，则继续整理平台、无障碍和人工回归清单，不把自动化结果升级为人工完成。
- 对应提交：无。

## 2026-08-25 / 设置页架构收口与网站规则编辑体验 / E-030

- 授权边界：用户明确要求一次性完成合理的代码、架构分层和用户体验优化。本轮只修改当前工作区内的设置页模块、
  网站规则编辑器、命令能力校验、匹配器缓存、国际化、测试和 E2E
  脚本；没有提交、推送、发布或修改外部路径。
- 架构实现：新增 pages/settings_draft.js、pages/settings_navigation.js 和
  pages/site_rules_editor.js，将设置页拆为草稿状态、
  层级导航和规则编辑器三个边界；主控制器只负责表单同步、持久化和运行时联动。设置页现在区分已保存快照与当前草稿，
  保存按钮、放弃修改、beforeunload 提示和导入后的基线同步均由草稿状态统一驱动。
- 保存与迁移：两个存储域的保存改为单次合并写入；任一写入失败时尽力恢复提交前的 Vimium 与 Browser
  Toolbox 快照。 Vimium 旧版导入字段仍完整保留，Browser Toolbox
  导入不会携带本地指针二进制资源。验证错误增加中英文格式化，避免把
  原始英文校验字符串直接作为中文界面错误。
- 网站规则体验：规则编辑器改为事件委托，支持规则上移、下移、复制、删除、空状态、当前页面命中测试、Glob/正则和六个
  模块的独立停用；规则 ID 在进入草稿前稳定补齐。正则和 Glob 编译增加 256
  项有界缓存，不改变原有匹配优先级和顶层 页面控制所有 frame 的语义。
- 命令联动：设置页按 supportedInputs 过滤命令选项；配置校验复用命令注册表的
  validateBinding，阻止未来把不支持
  某类输入的命令写入对应绑定。危险命令元数据继续来自唯一注册表，没有在设置页维护第二份命令清单。
- 界面与本地化：保存栏改为窄视口可用的 sticky
  操作区，规则表在窄视口保持可横向阅读；一级分类支持更明确的展开/收起 键盘行为和 hash
  深链接；新增操作按钮、空状态、当前站点测试结果和校验错误的中英文文案。没有新增权限、依赖或网络行为。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 316/316、DOM 109/109，总计 425/425。
deno test -A tests/browser_toolbox/
  退出码 0；Deno 1 passed / 0 failed，shoulda 71/71。
deno check background_scripts/main.js pages/action.js pages/command_listing.js pages/gesture_editor.js pages/mouse_options.js pages/settings_draft.js pages/settings_navigation.js pages/site_rules_editor.js pages/tab_list.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox/deno_test_adapter_test.js tests/dom_tests/browser_toolbox_dom_tests.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0。
deno fmt --check lib/i18n.js lib/settings.js lib/browser_toolbox background_scripts/browser_toolbox pages/action.js pages/command_listing.js pages/gesture_editor.js pages/mouse_options.js pages/settings_draft.js pages/settings_navigation.js pages/site_rules_editor.js pages/tab_list.js scripts/audit_network_usage.js scripts/audit_permissions.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox tests/dom_tests/browser_toolbox_dom_tests.js tests/unit_tests/browser_toolbox tests/unit_tests/test_chrome_stubs.js
  退出码 0；Checked 49 files。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
./make.js package
  退出码 0；当前 BrowserToolbox 归档更新完成。
deno run -A scripts/build_release.js --package
  退出码 0；发布检查通过并生成本地 dist/browser-toolbox-0.1.0.zip；未发布。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable 通过 Extensions.loadUnpacked 加载当前归档，放弃草稿、网站规则当前页测试、复制/排序/删除、旧版导入迁移、设置保存、核心手势、跨 frame、设计 fixtures 和 Service Worker 重启均通过。
jq empty _locales/en/messages.json _locales/zh_CN/messages.json
  退出码 0；两份本地化 JSON 有效。
git diff --check
  退出码 0。
```

- 验收边界：上述是单元、DOM、审计、打包和隔离 Chrome 自动化证据，不等同于 Windows、Edge、Linux
  Chrome Stable、 macOS Chrome Stable
  的人工矩阵，不等同于认证态站点、屏幕阅读器、人工高对比度/缩放或完整 Vimium 手工回归；
  这些门禁仍未完成。真实旧安装包自动更新语义仍按 E-025/E-026 保持未验证，项目暂不发布。
- 隐私与开源复核：没有新增权限、依赖、后台网络、遥测、账户、广告、订阅、付费功能、远程代码、eval 或
  new Function； 没有复制 CrxMouse 闭源代码、资产、文案或界面。旧名称仍只出现在兼容迁移层、兼容测试
  fixture 和历史记录中。
- 当前状态：当前 HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留用户已有未提交修改以及本轮
  代码、测试和文档修改，没有创建提交或推送。
- 下一步：保持项目不发布；剩余安全门禁是取得可复核的迁移前真实安装包并完成真实安装更新语义，以及由人工/可访问环境执行
  平台、屏幕阅读器、认证态站点和完整手工回归。没有这些外部条件时，不把本轮自动化结果升级为人工完成。
- 对应提交：无。

## 2026-08-25 / 命令元数据闭环与绑定编辑门禁 / E-031

- 授权边界：用户要求一次性完成合理的代码、架构分层和用户体验优化。本轮只在当前工作区补齐命令能力校验、
  设置页绑定编辑和对应测试；没有提交、推送、发布或修改外部路径。
- 架构收口：`CommandInvocation` 现在统一校验 `supportedInputs`、`requiredContext` 和注册表提供的有限
  `optionSchema`；Dispatcher
  进入执行前会拒绝缺少链接、图片或选中文本上下文的调用。注册表危险标记同时复用
  固定危险命令集合和重复上限，设置页不再维护第二份危险命令清单。
- 设置体验：鼠标手势、超级拖拽、滚轮和摇杆绑定均可单独启停；绑定可展开编辑 JSON options，非法 JSON
  或 不符合命令 schema
  的内容在保存前被拒绝；需要链接/图片/选中文本的命令按拖拽上下文过滤，危险命令显示可能
  关闭标签页或窗口的可见警告。新增“恢复默认”只重置 Browser Toolbox 配置，保留 Vimium
  键位、搜索引擎和 exclusion rules，并清理旧本地指针资源。
- 测试覆盖：新增 Invocation 上下文/输入能力/options 校验单元测试；E2E 新增危险警告、options
  默认值与写回、 上下文命令过滤和恢复默认值断言。没有新增权限、依赖或网络行为。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 317/317、DOM 109/109，总计 426/426。
deno test -A tests/browser_toolbox/
  退出码 0；Deno 1 passed / 0 failed，shoulda 72/72。
deno check background_scripts/main.js pages/action.js pages/command_listing.js pages/gesture_editor.js pages/mouse_options.js pages/settings_draft.js pages/settings_navigation.js pages/site_rules_editor.js pages/tab_list.js scripts/audit_permissions.js scripts/audit_network_usage.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox/deno_test_adapter_test.js tests/dom_tests/browser_toolbox_dom_tests.js tests/unit_tests/browser_toolbox/command_invocation_test.js tests/unit_tests/browser_toolbox/command_registry_adapter_test.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0。
deno fmt --check lib/i18n.js lib/settings.js lib/browser_toolbox background_scripts/browser_toolbox pages/action.js pages/command_listing.js pages/gesture_editor.js pages/mouse_options.js pages/settings_draft.js pages/settings_navigation.js pages/site_rules_editor.js pages/tab_list.js scripts/audit_network_usage.js scripts/audit_permissions.js scripts/build_release.js scripts/e2e_browser_toolbox.js tests/browser_toolbox tests/dom_tests/browser_toolbox_dom_tests.js tests/unit_tests/browser_toolbox tests/unit_tests/test_chrome_stubs.js
  退出码 0；Checked 49 files。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块文件，未发现后台或隐式网络调用。
./make.js package
  退出码 0；重新生成本地 BrowserToolbox 归档。
deno run -A scripts/build_release.js --package
  退出码 0；发布检查通过并生成本地 dist/browser-toolbox-0.1.0.zip；未发布。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable 通过 Extensions.loadUnpacked 加载当前归档，新增命令警告、上下文过滤、options 编辑写回、恢复默认值，以及既有设置迁移、站点规则、核心手势、超级拖拽、滚轮、摇杆、跨 frame、fixtures 和 Service Worker 重启均通过。
jq empty _locales/en/messages.json _locales/zh_CN/messages.json
  退出码 0；两份本地化 JSON 有效。
git diff --check
  退出码 0。
```

- 验收边界：以上是当前 checkout 的自动测试、审计、打包和隔离 Chrome 自动化证据，不等同于
  Windows、Edge、 Linux Chrome Stable、macOS Chrome Stable
  人工矩阵，不等同于认证态站点、屏幕阅读器、人工高对比度/缩放或 完整 Vimium
  手工回归；这些门禁仍未完成。真实旧安装包自动更新语义仍按 E-025/E-026 保持未验证，项目暂不发布。
- 隐私与开源复核：没有新增权限、依赖、后台网络、遥测、账户、广告、订阅、付费功能、远程代码、`eval`
  或 `new Function`；没有复制 CrxMouse
  闭源代码、资产、文案或界面。旧名称仍只出现在兼容迁移层、兼容测试 fixture 和历史记录中。
- 当前状态：当前 HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区继续保留用户已有未提交修改以及
  本轮代码、测试和文档修改，没有创建提交或推送。
- 下一步：保持项目不发布；剩余门禁是取得可复核的迁移前真实安装包并完成真实安装更新语义，以及由人工/可访问环境
  执行平台、屏幕阅读器、认证态站点和完整手工回归。没有这些外部条件时，不把本轮自动化结果升级为人工完成。
- 对应提交：无。

## 2026-08-25 / 绑定编辑、严格配置校验与迁移回滚 / E-032

- 授权边界：用户要求继续完成合理的代码、架构分层和用户体验优化。本轮只修改当前工作区内的配置校验、兼容迁移、设置仓库、鼠标/超级拖拽/滚轮/摇杆绑定编辑、国际化、测试和
  E2E 脚本；没有提交、推送、发布或修改外部路径。
- 架构与数据安全：配置校验增加有限深度的纯数据检查、分区布尔/字符串/数值校验、绑定输入/上下文/命令能力校验和站点规则模块白名单；迁移会为旧绑定补齐缺失的
  `options`，但不会吞掉显式非法值。设置仓库在规范化写入前保留当前快照，迁移或写入失败时尽力恢复
  canonical 原始值和内存快照；未知旧版 session 字段只在读取时忽略，兼容旧键继续保留以支持回滚。
- 设置体验：鼠标设置补齐轨迹采样距离、最小线段距离、转向迟滞、最大线段数、最长手势时长和激活后右键菜单策略；滚轮补齐连续切换开关。超级拖拽支持编辑上下文和正则/Glob
  模式，滚轮支持编辑按钮/方向，摇杆支持编辑按住顺序；三类绑定均支持启停、命令、options
  和删除，并提供新增绑定入口。命令选择仍由注册表能力过滤，未新增第二份命令清单。
- 运行时与本地化：鼠标激活后的右键菜单抑制改为可配置；新增字段均补齐中英文文案。曾尝试从设置页查询当前浏览器活动标签页
  URL，但在隔离扩展页面中会导致点击流程悬挂，已撤回该行为；当前“测试当前站点”保持对设置页当前 URL
  的确定性测试，不宣称其覆盖用户正在浏览的认证站点。
- 测试覆盖：新增严格 malformed scalar/binding metadata 校验、旧绑定 options
  迁移、设置仓库写入失败快照保持测试；隔离 E2E 新增超级拖拽 pattern
  编辑及新增/删除、滚轮新增/删除断言。没有新增权限、依赖或网络行为。
- 本轮实际自动门禁：

```text
./make.js test
  退出码 1；单元 319/319 通过，DOM 测试未启动，原因是本机 Puppeteer 缓存的 Chrome for Testing 缺少 Framework 文件；没有代码断言失败。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 319/319、DOM 109/109，总计 428/428。
deno test -A tests/browser_toolbox/
  退出码 0；Deno 1 passed / 0 failed，shoulda 74/74。
deno check pages/mouse_options.js lib/browser_toolbox/settings_validator.js background_scripts/browser_toolbox/settings_repository.js background_scripts/browser_toolbox/settings_migrations.js content_scripts/mouse/mouse_controller.js scripts/e2e_browser_toolbox.js
  退出码 0。
deno fmt --check pages/mouse_options.js lib/browser_toolbox/settings_validator.js background_scripts/browser_toolbox/settings_repository.js background_scripts/browser_toolbox/settings_migrations.js content_scripts/mouse/mouse_controller.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/settings_migrations_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
  退出码 0；Checked 9 files。
jq empty _locales/en/messages.json _locales/zh_CN/messages.json
  退出码 0；两份本地化 JSON 有效。
./make.js package
  退出码 0；当前 BrowserToolbox 归档更新完成。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable 通过 Extensions.loadUnpacked 加载当前归档，设置保存、旧版导出/存储键迁移、网站规则、绑定编辑、核心手势、跨 frame、设计 fixtures 和 Service Worker 重启均通过。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
deno run -A scripts/build_release.js --package
  退出码 0；发布检查通过并生成本地 dist/browser-toolbox-0.1.0.zip；未发布。
git diff --check
  退出码 0。
```

- 验收边界：以上是 E-024 在已重命名目录中的当前 checkout 自动测试、审计、打包和隔离 Chrome
  自动化证据，不等同于 E-023 目录移动当时的完整测试，也不等同于 Windows、Edge、Linux Chrome
  Stable、macOS Chrome Stable 人工矩阵、认证态站点、屏幕阅读器、人工高对比度/缩放或完整 Vimium
  手工回归；这些门禁仍未完成。真实旧安装包自动更新语义仍按 E-025/E-026 保持未验证，项目暂不发布。
- 隐私与开源复核：没有新增权限、依赖、后台网络、遥测、账户、广告、订阅、付费功能、远程代码、`eval`
  或 `new Function`；没有复制 CrxMouse
  闭源代码、资产、文案或界面。旧名称仍只出现在兼容迁移层、兼容测试 fixture 和历史记录中。
- 当前状态：当前 HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区继续保留用户已有未提交修改以及本轮代码、测试和文档修改，没有创建提交或推送。
- 下一步：保持项目不发布；剩余门禁是取得可复核的迁移前真实安装包并完成真实安装更新语义，以及由人工/可访问环境执行平台、屏幕阅读器、认证态站点和完整手工回归。没有这些外部条件时，不把本轮自动化结果升级为人工完成。
- 对应提交：无。

## 2026-08-25 / 运行时边界、安全合并与规则测试体验 / E-033

- 授权边界：用户要求一次性完成合理的代码、架构分层和用户体验优化。本轮只修改当前工作区内的配置合并安全、滚轮生命周期、全局模块开关、命令注册表
  fallback 元数据、网站规则 Glob/正则匹配和设置页 URL 测试体验，以及对应测试、E2E
  和验收文档；没有提交、推送、发布或修改外部路径。
- 运行时修复：滚轮控制器在物理按键释放、无按键滚动和取消路径清理累计值/冷却状态，避免两个独立的未达阈值会话合并误触发；`general.enabled=false`
  在仓库层强制覆盖所有模块，即使 session override 尝试重新打开子模块也不会绕过全局开关。
- 安全与架构：设置 schema 合并忽略 `__proto__`、`prototype` 和 `constructor` 危险键，阻止导入 JSON
  改变配置对象原型；session 清除改为写入成功后再更新内存快照。命令注册表 fallback
  对链接、图片、选中文本命令补齐 super-drag
  输入和真实上下文元数据，避免未来缺少上游命令条目时绕过能力过滤。
- 网站规则与体验：Glob 编译正确把 `?` 当作字面量；设置页将容易误测设置页自身的“当前站点”改为显式 URL
  测试，加入 URL 校验、结果中的测试 URL、中英文文案、无障碍标签和不参与保存状态的输入框。E2E
  新增八方向 `DR`、独立未达阈值滚轮、左/中键滚轮、六个模块规则停用、全局开关和输入 URL
  命中/未命中断言。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 324/324、DOM 109/109，总计 433/433。
deno test -A tests/browser_toolbox/
  退出码 0；Deno 1 passed / 0 failed，shoulda 79/79。
deno check background_scripts/main.js background_scripts/browser_toolbox/command_registry_adapter.js background_scripts/browser_toolbox/settings_repository.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/wheel_gesture_controller.js lib/browser_toolbox/settings_schema.js lib/browser_toolbox/site_rule_matcher.js pages/mouse_options.js scripts/e2e_browser_toolbox.js
  退出码 0。
deno fmt --check background_scripts/main.js background_scripts/browser_toolbox/command_registry_adapter.js background_scripts/browser_toolbox/settings_repository.js content_scripts/mouse/mouse_controller.js content_scripts/mouse/wheel_gesture_controller.js lib/browser_toolbox/settings_schema.js lib/browser_toolbox/site_rule_matcher.js pages/mouse_options.js pages/mouse_options.html pages/gesture_editor.css lib/i18n.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/command_registry_adapter_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/site_rule_matcher_test.js tests/unit_tests/browser_toolbox/wheel_gesture_controller_test.js
  退出码 0；Checked 17 files。
jq empty _locales/en/messages.json _locales/zh_CN/messages.json
  退出码 0；两份本地化 JSON 有效。
./make.js package
  退出码 0；当前 BrowserToolbox 归档保持更新。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable 通过 Extensions.loadUnpacked 加载当前归档，设置页语义、八方向轨迹、鼠标轨迹、超级拖拽、滚轮/摇杆、左/中键滚轮边界、跨 frame、原生安全、六模块站点规则、全局开关、显式 URL 规则测试、迁移、导入导出、设计 fixtures 和 Service Worker 重启均通过。
deno run -A scripts/audit_permissions.js
  退出码 0；9 项权限通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
deno run -A scripts/build_release.js --package
  退出码 0；连续两次运行结果一致，当前未发布 BrowserToolbox 包 SHA-256 为 `4f8154c68823439bc974b571a7646240aa7ed3f14dcb9de726f5120c18c3609e`。
git diff --check
  退出码 0。
```

- 验收边界：以上是当前 checkout 的自动测试、审计、可复现打包和隔离 Chrome 自动化证据，不等同于
  Windows、Edge、Linux Chrome Stable、macOS Chrome Stable
  人工矩阵，不等同于认证态站点、屏幕阅读器、人工高对比度/缩放或完整 Vimium
  手工回归；这些门禁仍未完成。显式 URL
  测试也只验证用户输入的网址，不宣称覆盖认证态当前标签页。真实旧安装包自动更新语义仍按 E-025/E-026
  保持未验证，项目暂不发布。
- 隐私与开源复核：没有新增权限、依赖、后台网络、遥测、账户、广告、订阅、付费功能、远程代码、`eval`
  或 `new Function`；没有复制 CrxMouse
  闭源代码、资产、文案或界面。旧名称仍只出现在兼容迁移层、兼容测试 fixture 和历史记录中。
- 当前状态：当前 HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区继续保留用户已有未提交修改以及本轮代码、测试和文档修改，没有创建提交或推送。
- 下一步：保持项目不发布；剩余门禁是取得可复核的迁移前真实安装包并完成真实安装更新语义，以及由人工/可访问环境执行平台、屏幕阅读器、认证态站点和完整手工回归。没有这些外部条件时，不把本轮自动化结果升级为人工完成。
- 对应提交：无。

## 2026-08-25 / 动作页状态回显、规则 UI 语义与国际化收口 / E-034

- 授权边界：本轮只修改当前工作区内的动作页会话开关、命令层实际状态回显、站点规则
  UI、本地化、标签页列表、兼容迁移健壮性、测试、E2E 和验收文档；没有提交、推送、发布或修改外部路径。
- 用户体验与架构：Wheel & Rocker
  开关同步控制两个模块；动作页根据后台返回的实际状态回显，全球停用或网站规则阻止启用时不显示虚假勾选。站点规则增加明确的操作列、优先级和
  Add rule 语义；标签页列表补齐无标题文案和搜索框可访问名称，并修复重复搜索框/重复 `id` 回归。旧
  malformed bindings 留给严格校验器处理，避免迁移阶段类型错误。没有新增权限、依赖或网络行为。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 326/326、DOM 109/109，总计 435/435。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 81/81。
deno check pages/action.js pages/tab_list.js pages/site_rules_editor.js background_scripts/browser_toolbox/browser_command_adapter.js background_scripts/browser_toolbox/settings_migrations.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/browser_command_adapter_test.js tests/unit_tests/browser_toolbox/settings_migrations_test.js
  退出码 0；deno fmt、jq 本地化校验、git diff --check 均通过。
./make.js package
  退出码 0；归档为最新状态。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable 的动作页 Wheel/Rocker、站点规则操作列/优先级/中英文文案、迁移、设置保存、核心手势、跨 frame、fixtures 和 Service Worker 重启均通过。
deno run -A scripts/audit_permissions.js && deno run -A scripts/audit_network_usage.js
  退出码 0；权限 9 项通过，网络审计扫描 26 个新增模块通过。
deno run -A scripts/build_release.js --package
  退出码 0；连续两次构建一致，生成本地包；BrowserToolbox `cdb27a9b286420f219c4da8d4f160414f516ea2136836dbc0fef9ca5e711994c`，Chrome `2cb8073606d16ede6c0ccb83253fc460df2fde7f8f1a931008094e02d8def301`，Firefox `e1b10be987596e166ef7dc16d39a82c97cbd03bbd9c6abb01d5c805bbdffdc08`，Canary `02b566e58b4524f6cccfb9bc14c2ed22b55043090c3a23b5874bb5cfbed22e4`；未发布。
```

- 验收边界：以上仍是自动化和当前 macOS Chrome Stable 隔离证据，不等同于 Windows、Edge、Linux Chrome
  Stable、macOS Chrome Stable 人工矩阵、认证态站点、屏幕阅读器或完整 Vimium
  手工回归；真实旧安装包自动更新语义仍按 E-025/E-026
  未验证，项目暂不发布。中间一次英文断言与中文隔离界面不匹配，已改为中英文断言并以最终 E2E 退出码 0
  为准。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；保留所有既有脏工作区修改，无提交、推送或发布。下一步仍是取得外部人工验收环境后逐项回写实际结果。
- 对应提交：无。

## 2026-08-25 / 动作页国际化与本地产物复核 / E-035

- 授权边界：本轮只补齐 BrowserToolbox
  动作页的中英文界面语义、本地化加载和本地产物复核；没有提交、推送、发布或修改外部路径，没有新增权限、依赖或网络行为。
- 用户体验与架构：动作页标题、Firefox
  权限提示、页面状态、排除规则表头/输入框/操作按钮、页脚链接和无障碍名称统一进入 i18n
  消息；动作页启动时从 canonical `browserToolboxSettings` 读取语言，旧 `openKeyMouseSettings`
  仅作为迁移读取回退，不新增旧键写入。动态新增的排除规则行复用同一套本地化消息，避免首屏与后续编辑行语言不一致。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 326/326、DOM 109/109，总计 435/435。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 81/81。
deno check lib/i18n.js pages/action.js pages/exclusion_rules_editor.js tests/unit_tests/browser_toolbox/i18n_test.js
  退出码 0；deno fmt、jq 本地化 JSON 校验、git diff --check 均通过。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 26 个新增模块，未发现后台或隐式网络调用。
./make.js package
  退出码 0；归档为当前源码状态。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable E2E 通过动作页中英文标题、语言属性、状态文案、Wheel/Rocker、站点规则、迁移、设置保存、核心手势、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
  退出码 0；连续两次运行一致；BrowserToolbox `5167ada4f2c3dc74c78330805b953dd87325676c81d9caf4b8522767fae3e9f1`，Chrome `0657595f0e7920d497d3ee41ced29cf15b17fb52ad0d5957ee96889cc9dc52df`，Firefox `046a775628e8f1620f1b178cb3815bd013a39342c934309cb48db5fdbe0f301d`，Canary `14f02232a1a94c6d6f59b0ab4f3f3be55d5a0185acbe19f3ada0ba7d4fb8629e`；未发布。
```

- 风险与边界：本轮只覆盖动作页新增/改造的 BrowserToolbox 文案；Vimium
  继承页面中的历史英文帮助内容没有借此宣称已完成全站国际化。以上 E2E 仍是隔离 macOS Chrome Stable
  自动化证据，不等同于 Windows、Edge、Linux Chrome
  Stable、屏幕阅读器、认证态站点、人工高对比度/缩放或完整 Vimium
  手工回归；真实旧安装包自动更新语义仍按 E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区继续保留用户已有未提交修改以及本轮修改，没有创建提交或推送。
- 下一步：在不增加 Phase
  外功能的前提下，优先收口设置页多级导航与网站规则的可理解性、键盘/屏幕阅读器/缩放门禁和真实迁移前置条件；有可访问的外部浏览器或辅助技术环境后，再逐项记录人工结果。
- 对应提交：无。

## 2026-08-25 / 设置页架构、命令元数据与站点规则安全收口 / E-036

- 授权边界：本轮落实现有设置页和站点规则的架构/体验优化，没有增加新的产品模块或 Phase
  外功能；没有提交、推送、发布或修改外部路径。
- 架构调整：新增
  `pages/binding_editor.js`，把鼠标、超级拖拽、滚轮和摇杆绑定表格的渲染、字段同步、命令筛选、参数编辑和危险命令提示从
  `mouse_options.js`
  拆出；主控制器保留设置草稿、保存、导入导出、指针资源和页面生命周期职责。绑定编辑器通过
  `getSettings/getRegistry/markDirty` 注入依赖，后续增加输入模块不需要继续扩大主控制器。
- 命令元数据：删除适配器中的第二份 BrowserToolbox 位置参数命令清单，产品命令统一从
  `background_scripts/all_commands.js`
  读取；自定义测试注册表仍会从同一来源补齐产品命令，并拒绝重复命令名，避免出现设置页、帮助页和后台
  Dispatcher 看到不同命令定义。
- 网站规则与体验：新增正则复杂度检查，拒绝明显的嵌套量词/过度复杂表达式；匹配器新增解释结果，设置页测试网址现在显示命中规则、最终模块状态和被停用模块；站点规则模块开关补充可访问说明。Glob、显式
  regex、优先级和旧配置兼容行为保持不变。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 327/327、DOM 109/109，总计 436/436。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 82/82。
deno check lib/browser_toolbox/regex_safety.js lib/browser_toolbox/site_rule_matcher.js lib/browser_toolbox/settings_validator.js pages/binding_editor.js pages/mouse_options.js background_scripts/browser_toolbox/command_registry_adapter.js scripts/e2e_browser_toolbox.js
  退出码 0；deno fmt、jq 本地化 JSON 校验、git diff --check 均通过。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；重新打包后隔离 macOS Chrome Stable E2E 通过绑定编辑器、设置保存、正则站点规则、命中解释/停用模块说明、迁移、核心手势、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 27 个新增模块，未发现后台或隐式网络调用。
deno run -A scripts/build_release.js --package
  退出码 0；连续两次运行一致；BrowserToolbox `5009d77bbd1c0f9d8c11e48ffc4e26efa4f7062c957f77ff3c54e72a759db1e1`，Chrome `b1e76a3482ee340f99a32d281ba3efff20f36009ee575f4a581a97633d54437a`，Firefox `a9ecb7797458d65fa0a8313ac115e8a39d3a281a5c2872aa5348f8a71984ee41`，Canary `62f82c8caf50bc01e0f721e38d0aec27b64197100dc36592aa21feaeb35c1f79`；未发布。
```

- 过程记录：有一次在未重新打包的旧 `dist/vimium` 上运行新 E2E
  脚本，因产物与源码不一致被手动终止，不计入通过证据；随后重新执行 `./make.js package`
  后再运行，最终 E2E 退出码为 0。
- 风险与边界：正则复杂度检查是静态启发式防护，不等同于任意正则都具备严格的时间上界；站点规则解释覆盖当前设置草稿的全局/模块状态，不把自动化解释升级为认证态站点人工验收。平台人工矩阵、屏幕阅读器、人工高对比度/缩放、完整
  Vimium 手工回归和真实旧安装包自动更新语义仍按 E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有既有未提交修改以及本轮修改，没有创建提交或推送。
- 下一步：继续处理外部验收门禁；在获得可访问的辅助技术或其他浏览器环境前，不虚构平台、屏幕阅读器和人工矩阵结果。
- 对应提交：无。

## 2026-08-25 / 设置保存并发反馈与低动效门禁 / E-037

- 授权边界：本轮只收口设置页保存流程的状态反馈和低动效体验，并修正对应的隔离 E2E
  等待语义；没有新增产品模块、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 用户体验与可靠性：保存开始时设置主区域标记
  `aria-busy="true"`，保存和放弃按钮在异步保存期间禁用，状态依次显示“正在保存……”/“Saving…”和保存完成文案；只有配置持久化、表单回写和指针预览均完成后才宣布“已保存”，异常仍清理临时指针资源并恢复可操作状态。设置页增加
  `prefers-reduced-motion: reduce`
  样式，自动验证过渡动画被压缩、强制颜色/高对比度媒体和窄视口布局仍可用。
- 测试等待修正：首次加入“正在保存……”后，E2E
  辅助函数原先把任意非空状态误判为保存完成，实际暴露出持久化完成前读取存储的竞态；已将等待条件收窄为
  `Saved`/`已保存`，并保留错误优先返回。该失败过程不计入通过证据，修正后重新执行完整 E2E。
- 本轮实际自动门禁：

```text
deno fmt --check lib/i18n.js pages/mouse_options.js pages/gesture_editor.css scripts/e2e_browser_toolbox.js _locales/en/messages.json _locales/zh_CN/messages.json
  退出码 0；6 个文件格式检查通过。
deno check pages/mouse_options.js scripts/e2e_browser_toolbox.js && jq empty _locales/en/messages.json _locales/zh_CN/messages.json && git diff --check
  退出码 0；脚本类型检查、本地化 JSON 和差异空白检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 327/327、DOM 109/109，总计 436/436。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 82/82。
./make.js package
  退出码 0；归档产物与当前已打包源码一致。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable E2E 通过低动效/高对比度语义、保存状态闭环、旧版导出与旧存储键迁移、网站规则、指针资源、核心手势、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 27 个新增模块，未发现后台或隐式网络调用。
deno run -A scripts/build_release.js --package
  退出码 0；连续两次运行一致；BrowserToolbox `2d91b80bc18367e1ca7a4de90e67a93a13e2a56e82290340cd6c89c39967bb38`，Chrome `4bc361710111d78d046f406ec8c6903031f3aa29b5343b6f0c661fdf1b552e24`，Firefox `38171c5d24b55356b36fb46362fff52d620d18ca587fb42585408ca35abc540f`，Canary `76c8d2dd32332bf8bb5646ce4b0abb7db219b99df5f1553e1ceac1c3ec90bf59`；未发布。
```

- 风险与边界：低动效、强制颜色、对比度和窄视口目前只有自动化媒体模拟证据，不等同于人工视觉检查或屏幕阅读器验收；保存锁覆盖设置页主保存流程，恢复默认值、导入等其他异步流程仍保持原有行为。平台人工矩阵、屏幕阅读器、认证态站点、完整
  Vimium 手工回归和真实旧安装包自动更新语义仍按 E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有既有未提交修改以及本轮修改，没有创建提交或推送。
- 下一步：继续完成外部平台、屏幕阅读器和人工回归门禁；在获得相应环境前只保留自动化证据，不把它们标记为完成。
- 对应提交：无。

## 2026-08-25 / 导入预览与设置页异步操作锁 / E-038

- 授权边界：本轮继续收口 Phase 3/7
  已有设置功能的可靠性、导入升级验收和无障碍体验，没有新增产品模块、权限、依赖或网络行为；没有提交、推送、发布或修改外部路径。
- 架构与用户体验：新增 `pages/settings_change_summary.js` 作为纯数据变更摘要层，能够按稳定 ID
  区分设置项/绑定的新增、修改和删除，并限制预览条目数量；设置页新增原生本地 `<dialog>`
  导入预览，用户取消时不写入，确认后才进入现有 schema
  校验和跨存储回滚流程。保存、导入、恢复默认和放弃修改统一使用异步操作锁，主区域标记 `aria-busy`
  并暂时 `inert`，避免异步期间继续编辑；导入或恢复语言后立即应用本地化，不需刷新。
- 旧版升级边界：旧格式导入仍通过现有兼容迁移层读取 `open-key-mouse-settings`、旧命令命名空间和
  schema 0 配置；新增预览不改变旧键只读保留、新键写入和迁移备份规则。E-025 的真实 Chrome
  storage/旧版导出导入证据继续有效，E-026 的真实旧 CRX 安装更新语义仍未验证。
- 本轮实际自动门禁：

```text
deno fmt pages/settings_change_summary.js tests/unit_tests/browser_toolbox/settings_change_summary_test.js pages/mouse_options.js pages/mouse_options.html pages/gesture_editor.css scripts/e2e_browser_toolbox.js lib/i18n.js _locales/en/messages.json _locales/zh_CN/messages.json
  退出码 0；相关 9 个文件格式化通过。
deno check pages/settings_change_summary.js pages/mouse_options.js scripts/e2e_browser_toolbox.js && jq empty _locales/en/messages.json _locales/zh_CN/messages.json && git diff --check
  退出码 0；类型检查、本地化 JSON 和差异空白检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 331/331、DOM 109/109，总计 440/440。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 86/86。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档均包含导入预览模块。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable E2E 通过导入预览取消/确认、非法导入不覆盖、旧版导出格式、旧存储键/指针迁移、Vimium 备份、语言/设置闭环、核心手势、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过，未发现禁止权限或远程脚本。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 27 个新增模块，未发现后台或隐式网络调用。
deno run -A scripts/build_release.js --package
  退出码 0；连续两次运行一致；BrowserToolbox `6aa62bf3994be1e13e7e2901ccb88b0d727da0b892a95192e6820127a5a077a5`，Chrome `2c6b23673736fc3ee3535572985d4b2ec64ad17707c79b3e1a5ccd34d45908ab`，Firefox `83f6499ac48b969ff6cdbb8b857a4cb2c14b6f6f1f0298db0efcf3ae63b4a91c`，Canary `c29bafd1de4663f34b99e95ff8ee73d9d408eba1e00885ac3ba02cbc5b0d7263`；未发布。
```

- 风险与边界：变更摘要对没有稳定 ID 的数组按整体变更显示，且预览最多显示 100
  条细项；这是防止大配置拖垮设置页的 UX 限制，不影响写入校验。对话框、`aria-busy`、`inert`
  和低动效目前只有自动化媒体/DOM
  证据，不等同于屏幕阅读器或人工可访问性认证。Windows/Edge/Linux/macOS 人工矩阵、认证态站点、完整
  Vimium 手工回归和真实旧 CRX 自动更新仍按 E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有既有未提交修改以及本轮修改，没有创建提交或推送。
- 下一步：继续完成外部平台、屏幕阅读器和人工回归门禁；有可访问环境后逐项回写实际结果，不把自动化证据升级为人工验收。
- 对应提交：无。

## 2026-08-25 / 远程浏览器 E2E 接入核对与 Windows 隔离尝试 / E-039

- 授权边界：本轮只扩展 E2E 测试脚本的远程 CDP/fixture
  主机参数，并核对已完成的导入预览改动；没有新增产品模块、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 测试基础设施：`scripts/e2e_browser_toolbox.js` 现在支持通过环境变量连接已启动的远程 Chrome
  CDP、指定 fixture 服务监听地址和显式扩展
  ID；默认本机路径保持原有行为。该能力只服务隔离测试，不改变扩展运行时。
- 本轮实际自动门禁：

```text
deno fmt scripts/e2e_browser_toolbox.js && deno check pages/settings_change_summary.js pages/mouse_options.js scripts/e2e_browser_toolbox.js
  退出码 0；E2E 脚本与设置页相关脚本格式化、类型检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 331/331、DOM 109/109，总计 440/440。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 86/86。
./make.js package
  退出码 0；归档产物与当前已打包源码一致。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable E2E 通过设置导入预览取消/确认、旧版导出与存储键迁移、站点规则、核心手势、跨 frame、fixtures 和 Service Worker 重启。
```

- Windows 隔离尝试：已启动既有 Parallels Windows 11 隔离虚拟机，传入当前 `dist` 归档并尝试通过远程
  Chrome CDP 运行同一套 E2E。Chrome 扩展 Service Worker 目标曾短暂出现，但导航到
  `chrome-extension://.../pages/mouse_options.html` 返回 `ERR_FILE_NOT_FOUND`，随后 Worker
  生命周期也不稳定；失败发生在产品断言前，因此不计为 Windows E2E
  通过，也不据此判定产品功能失败。Edge 未安装，未形成 Edge 证据。
- 外部状态清理：已停止测试用 Chrome 进程，删除明确的 `C:\BrowserToolboxE2E` 临时目录，移除本次使用的
  host portproxy 和防火墙规则，并停止隔离虚拟机；未触碰用户登录态、Cookie、Token 或个人浏览数据。
- 风险与边界：远程 CDP 接入目前只能证明测试脚本具备连接参数，不能替代可正常加载扩展的
  Windows/Edge/Linux Chrome Stable 实机或隔离环境。Windows、Edge、Linux、macOS
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和真实旧 CRX
  自动更新语义仍未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有既有未提交修改以及本轮修改，没有创建提交或推送。
- 下一步：获得可正常加载当前归档的 Windows/Edge/Linux
  浏览器环境后，重新执行对应自动化与人工门禁；在此之前继续维护自动化证据与未验证清单，不把本次
  Windows 加载失败写成平台验收完成。
- 对应提交：无。

## 2026-08-25 / Windows Chrome 自动化闭环与远程 E2E 隔离修正 / E-040

- 授权边界：本轮只修正远程 E2E 的跨主机 fixture、下载、上传、动态站点规则和远程标签清理，并在既有
  Windows
  隔离虚拟机中复跑当前产品归档；没有新增产品模块、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 测试基础设施修正：远程浏览器使用 Browser CDP 下载事件和浏览器侧下载目录；静态 JSON/PNG fixture
  在远程页面通过 `DataTransfer` 注入，动态导出文件使用 Windows 侧路径；站点规则正则按当前 fixture
  origin 动态生成；每次远程运行前关闭残留测试标签，避免多个同 URL 标签干扰 Service Worker
  重启断言。本机模式保持原有文件上传、临时目录和剪贴板权限流程。
- E-039 结果更正：此前记录的 `fignfifoniblkonapihmkfakmlgkbkcf` 实际是 Chrome 内置 Google Network
  Speech 扩展 ID，不是 BrowserToolbox；因此此前 `ERR_FILE_NOT_FOUND` 是错误扩展 ID
  导航造成的加载诊断，不能作为浏览器工具箱页面失败证据。当前 Windows 复跑使用 Chrome
  `Extensions.loadUnpacked` 返回的 BrowserToolbox ID 和规范化 Chrome Store 归档，结果如下。
- 本轮实际自动门禁：

```text
deno fmt scripts/e2e_browser_toolbox.js && deno check scripts/e2e_browser_toolbox.js && git diff --check
  退出码 0；远程 E2E 脚本格式、类型和差异空白检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 331/331、DOM 109/109，总计 440/440。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 86/86。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 27 个新增模块，通过。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable E2E 通过设置导入预览、旧版迁移、站点规则、核心手势、跨 frame、fixtures 和 Service Worker 重启；本机剪贴板断言保留并通过。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档均为当前源码状态。
deno run -A scripts/build_release.js --package
  退出码 0；发布检查、权限/网络审计和 BrowserToolbox 0.1.0 本地产物生成通过；连续两次 BrowserToolbox SHA-256 为 `c9a14adfc7ba02bc2be331156a178586052288f5a5a813c70f0e086cff77295b`。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_ID=<当前 Extensions.loadUnpacked 返回的 BrowserToolbox ID> BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Windows 11 ARM64 Chrome Stable `151.0.7922.174` 远程自动 E2E 通过设置迁移、正则站点规则、核心鼠标输入、超级拖拽下载、滚轮/摇杆、跨 frame、fixtures、恢复默认和 Service Worker 重启；远程 CDP 无法代授剪贴板权限，剪贴板相关断言明确跳过。
```

- 外部状态清理：Windows 测试 Chrome 进程为 0，明确的 `C:\BrowserToolboxE2E`
  临时目录已删除，9223/9225/9231 portproxy 和对应防火墙规则已移除，Parallels
  隔离虚拟机已停止；未触碰用户登录态、Cookie、Token 或个人浏览数据。
- 风险与边界：Windows Chrome 这次是隔离自动化证据，不是 Windows 人工验收；剪贴板权限无法在远程 CDP
  当前上下文中代授，因此不能把剪贴板项写成 Windows 自动通过。Windows/Edge/Linux/macOS
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和真实旧 CRX
  自动更新语义仍未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有既有未提交修改以及本轮修改，没有创建提交或推送。
- 下一步：继续取得可访问的
  Edge/Linux/辅助技术或人工环境，逐项完成手工门禁；保留自动化与人工证据分界，不把 Windows 自动 E2E
  升级为人工矩阵完成。
- 对应提交：无。

## 2026-08-25 / 当前运行时标识清理与归档复验 / E-041

- 授权边界：本轮继续处理当前 checkout
  的架构一致性和验收收口；没有新增产品模块、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 架构清理：将当前运行时 UI、动作页、设置页、多级导航、绑定编辑器、网站规则编辑器、轨迹 HUD、CSS 和
  E2E 选择器中的 `okm-*` 旧缩写统一改为 `browser-toolbox-*`；设计文档中的对应 CSS 规范同步更新。旧
  OpenKeyMouse 全名和旧键仍只保留在兼容迁移、兼容测试
  fixture、兼容读取和历史记录范围内，当前运行时新写入键和命令名不变，继续使用 `BrowserToolbox`。
- 真实回归结果：第一次 E2E 在重命名后使用尚未重新打包的 `dist`
  归档，因旧归档没有新选择器而失败；随后运行 `./make.js package` 刷新归档，再次运行同一 E2E
  完整通过。该失败归因于陈旧测试产物，不作为产品行为通过证据。
- 本轮实际自动门禁：

```text
deno fmt content_scripts/mouse/gesture_overlay.js pages/action.js pages/binding_editor.js pages/mouse_options.js pages/settings_navigation.js pages/site_rules_editor.js scripts/e2e_browser_toolbox.js && deno check content_scripts/mouse/gesture_overlay.js pages/action.js pages/binding_editor.js pages/mouse_options.js pages/settings_navigation.js pages/site_rules_editor.js scripts/e2e_browser_toolbox.js && git diff --check
  退出码 0；7 个相关脚本格式化、类型检查和差异空白检查通过。
rg -n "okm-" --glob '!docs/codex-progress.md' --glob '!docs/adr/**' --glob '!dist/**' .
  无匹配；当前运行时代码、样式和测试选择器不再使用旧 `okm-*` 标识。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 331/331、DOM 109/109，总计 440/440。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 86/86。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 27 个新增模块，通过。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档刷新为当前源码。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0（刷新归档后）；隔离 macOS Chrome Stable E2E 通过设置页、核心手势、站点规则、导入迁移、跨 frame、设计文档 fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
  退出码 0；BrowserToolbox 0.1.0 本地产物生成和发布检查通过；当前 SHA-256 为 BrowserToolbox `2b1e84f77ced8c7e496e699cafc61cbcb7aee8f5b65a713b939d14bad17c874d`、Chrome `801eb873c32babf1b7255052c393c1369f4ad8130e35ef5c6f34f0a6edf76262`、Firefox `380534fa2dee21c8adfafbef3b459cc94b35679755342dcef70b873e72609c71`、Canary `477b3f77300beaeaf7a63965924cc5df853024f0569d2d4d9febc76da49de72c`。
```

- 风险与边界：这是运行时标识和归档一致性清理，不改变旧配置迁移语义；当前 E2E
  仍是隔离自动化证据，不等同于 Windows、Edge、Linux、macOS
  人工矩阵、认证态站点、屏幕阅读器、人工高对比度/缩放或完整 Vimium 手工回归。真实旧 CRX
  安装更新语义仍按 E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在不继续扩大产品范围的前提下，优先取得真实人工/辅助技术环境完成剩余外部门禁；若没有新环境，继续保持自动化证据与人工验收边界，不修改为虚假完成状态。
- 对应提交：无。

## 2026-08-25 / 兼容读取下沉设置仓库与可复现归档复验 / E-042

- 授权边界：本轮只做兼容读取分层和当前产物复验，没有新增产品模块、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 架构改进：新增
  `SettingsRepository.getStoredLocale()`，由设置仓库统一处理规范设置键优先、旧设置键回退；动作页和标签页不再直接读取
  `openKeyMouseSettings`，标签页改为模块入口并加载同一仓库依赖。新增单元测试覆盖规范语言优先和旧语言回退，旧键继续只读，不改变迁移备份和新键写入规则。
- 构建复验：连续两次执行发布检查后，四个当前归档 SHA-256
  完全一致；之前重命名后的哈希变化来自源码变化，不是归档时间不稳定。当前产物哈希已同步发布清单。
- 本轮实际自动门禁：

```text
deno fmt background_scripts/browser_toolbox/settings_repository.js pages/action.js pages/tab_list.js tests/unit_tests/browser_toolbox/settings_repository_test.js && deno check background_scripts/browser_toolbox/settings_repository.js pages/action.js pages/tab_list.js tests/unit_tests/browser_toolbox/settings_repository_test.js && git diff --check
  退出码 0；4 个相关文件格式化、类型检查和差异空白检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 333/333、DOM 109/109，总计 442/442。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 88/88。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 27 个新增模块，通过。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档刷新为当前源码。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable E2E 通过动作页、标签/设置依赖加载、设置迁移、网站规则、核心手势、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
  连续执行两次均退出码 0，四个当前归档 SHA-256 一致：BrowserToolbox `8291040aa70c3b322fde2a29091ec497f1e37a61c18fd814e04b072fabff6e73`、Chrome `e4026fffafa00258a3eb7fdcc3f5447c1069358b0f1f61851f55efa14c1bb5da`、Firefox `dd3bea484011ff11726a02f1a3b29b4c28fdd80250ba08c7a6a44578c40d93a1`、Canary `69dc7bee327c799e9511908ac5f0df295ce8f6339643e5ac3415b2014b906ba7`。
```

- 风险与边界：兼容旧键仍需保留只读入口，不能将其从迁移层删除；标签页现在加载设置仓库依赖，增加了本地模块初始化链路，但已由当前扩展
  E2E 覆盖。以上仍是隔离自动化证据，不等同于 Windows、Edge、Linux、macOS
  人工矩阵、认证态站点、屏幕阅读器、人工高对比度/缩放或完整 Vimium 手工回归；真实旧 CRX
  安装更新语义仍按 E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：继续取得真实人工/辅助技术和迁移前安装包环境，逐项关闭外部验收门禁；没有新证据时不改变
  `IN_PROGRESS` 状态。
- 对应提交：无。

## 2026-08-25 / Windows Chrome 最新重构版隔离自动 E2E / E-043

- 授权边界：用户此前已授权在既有 Parallels Windows 隔离虚拟机中继续执行本地自动验收。本轮只使用当前
  Chrome Store 归档、一次性 `C:\BrowserToolboxE2E` 临时目录、临时 profile、host fixture 服务和远程
  CDP；没有触碰用户登录态、Cookie、Token 或个人浏览数据，没有提交、推送、发布或修改外部项目路径。
- 目标环境：Windows 11 ARM64，Chrome Stable `151.0.7922.174`；使用 `Extensions.loadUnpacked`
  加载当前归一化归档，实际返回 BrowserToolbox 扩展 ID；远程 fixture
  使用当前脚本的固定主机/端口参数。
- 实际结果：第一次以有界面模式启动 Chrome 时，Chrome 在创建第一个标签页前退出，CDP 返回
  `Target.createTarget: Failed to open a new tab`，不计为产品失败。改用既有隔离无头模式后，当前最新代码完整通过动作页受限提示、设置页、多级导航、正则站点规则、核心鼠标输入、超级拖拽下载、滚轮/摇杆、跨
  frame、导入迁移、恢复默认和 Service Worker 重启；远程 CDP 无法代授剪贴板权限，剪贴板断言明确跳过。
- 本轮实际命令与结果：

```text
./make.js package
  退出码 0；生成当前 Chrome Store 归一化归档。
Windows PowerShell：下载当前归档至 C:\BrowserToolboxE2E，展开到 C:\BrowserToolboxE2E\extension；启动 Chrome Stable `151.0.7922.174` 隔离 profile；通过 `Extensions.loadUnpacked` 返回 BrowserToolbox ID。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_ID=<当前 Extensions.loadUnpacked 返回的 BrowserToolbox ID> BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  无头 Chrome 重跑退出码 0；Windows Chrome 隔离自动 E2E 通过设置迁移、正则站点规则、核心输入、超级拖拽下载、滚轮/摇杆、跨 frame、fixtures、恢复默认和 Service Worker 重启；剪贴板断言跳过。
```

- 外部状态清理：已停止 Windows 测试 Chrome，删除明确的 `C:\BrowserToolboxE2E` 临时目录，移除本轮
  `9231` portproxy 和对应防火墙规则，停止 Parallels 隔离 VM；host fixture 服务也已停止，端口
  `59581/59582` 无监听。未触碰用户日常浏览器资料。
- 风险与边界：这是与当前 checkout 对应的 Windows Chrome 隔离自动化证据，不是 Windows
  人工验收；仍不能替代 Windows/Edge/Linux/macOS
  手工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点或完整 Vimium 手工回归。Edge 未在该 VM
  形成当前证据，真实旧 CRX 安装更新语义仍按 E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：只剩需要真实人工/辅助技术或迁移前安装通道的外部门禁；有新环境后逐项回写实际结果，继续保持自动化与人工证据边界。
- 对应提交：无。

## 2026-08-25 / 标签页列表真实扩展 E2E 补齐 / E-044

- 授权边界：本轮只补充已有 `BrowserToolbox.showTabList`
  用户路径的自动化覆盖，没有新增产品模块、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 覆盖内容：E2E 现在真实打开 `pages/tab_list.html`，确认标签页列表加载、当前 English
  文案、包含目标标签的模糊筛选和无匹配结果；标签页脚本改为模块入口后，设置仓库依赖链也在真实扩展上下文中执行。该测试不把列表筛选自动化结果写成人工回归。
- 本轮实际自动门禁：

```text
deno fmt scripts/e2e_browser_toolbox.js && deno check scripts/e2e_browser_toolbox.js && git diff --check
  退出码 0。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档均为当前源码状态。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable E2E 新增通过标签页列表加载、本地化、模糊筛选和空结果，并继续通过设置迁移、站点规则、核心手势、跨 frame、fixtures 和 Service Worker 重启。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 333/333、DOM 109/109，总计 442/442。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 88/88。
deno check scripts/e2e_browser_toolbox.js && git diff --check
  退出码 0。
```

- 风险与边界：本轮补齐的是扩展自动化路径，不替代 Windows、Edge、Linux、macOS
  人工矩阵、屏幕阅读器、认证态站点、高对比度/缩放或完整 Vimium 手工回归；真实旧 CRX 安装更新语义仍按
  E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：继续保持当前自动化证据，只有获得真实人工/辅助技术或迁移前安装环境后，才关闭剩余外部门禁。
- 对应提交：无。

## 2026-08-25 / Windows Chrome 当前脚本标签页列表复验 / E-045

- 授权边界：本轮继续使用既有 Parallels Windows 隔离 VM 和一次性测试目录复验当前 E2E
  脚本；没有新增产品模块、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 当前证据：Windows 11 ARM64 Chrome Stable `151.0.7922.174` 通过 `Extensions.loadUnpacked` 加载当前
  Chrome Store 归档；当前 `scripts/e2e_browser_toolbox.js`
  的新增标签页列表测试实际通过加载、本地化、模糊筛选和空结果，随后既有设置迁移、正则网站规则、核心输入、下载、跨
  frame、fixtures、恢复默认和 Service Worker 重启也全部通过。远程 CDP
  无法代授剪贴板权限，相关断言跳过。
- 本轮实际命令与结果：

```text
./make.js package
  退出码 0；当前 Chrome Store 归一化归档可供 Windows 隔离环境下载。
Windows PowerShell：下载并展开当前归档到 C:\BrowserToolboxE2E\extension，使用隔离 profile 启动 Chrome Stable `151.0.7922.174`，通过 `Extensions.loadUnpacked` 返回 BrowserToolbox 扩展 ID。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_ID=<当前 Extensions.loadUnpacked 返回的 BrowserToolbox ID> BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Windows Chrome 隔离自动 E2E 通过标签页列表、设置迁移、站点规则、核心鼠标输入、超级拖拽下载、滚轮/摇杆、跨 frame、fixtures、恢复默认和 Service Worker 重启；剪贴板断言跳过。
```

- 外部状态清理：已停止 Windows 测试 Chrome，删除明确的 `C:\BrowserToolboxE2E` 临时目录，移除 `9231`
  portproxy 和防火墙规则，停止 Parallels VM；host fixture 服务停止，`59581/59582` 无监听。
- 风险与边界：这是当前版本的 Windows Chrome 隔离自动化证据，不是人工平台验收；仍不能替代
  Windows/Edge/Linux/macOS 手工矩阵、屏幕阅读器、认证态站点、高对比度/缩放或完整 Vimium
  手工回归。真实旧 CRX 安装更新语义仍按 E-025/E-026 未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：继续等待真实人工/辅助技术或迁移前安装环境；没有新证据时不改变外部门禁状态。
- 对应提交：无。

## 2026-08-25 / 设置页注册表重构与网站规则命中解释 / E-046

- 授权边界：本轮继续处理当前 Phase
  内的设置页可扩展架构和网站规则可理解性；没有新增产品模块、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。运行时输入模块、BrowserToolbox
  命令命名空间和旧版兼容读取边界保持不变。
- 架构与体验：新增 `pages/settings_sections.js`，集中注册 6 个一级分类、11
  个二级设置页，并以声明式字段绑定统一标量设置的 DOM 读写；`pages/settings_navigation.js`
  根据注册表生成导航。规则匹配器的 `resolve()` 与 `explain()`
  使用同一覆盖顺序，设置页测试结果现在列出全部命中规则、配置顺序、匹配类型、规则级停用模块和最终模块状态。新增中英文文案与真实
  E2E 断言。
- 中间失败与修正：第一次 macOS 隔离 E2E 因动态导航渲染保护错误读取注册表对象 `.length`
  而使导航为空；修正为检查 `SECTIONS.length`，重新打包后最终 E2E 退出码 0。中间失败不计为通过证据。
- 本轮实际自动门禁：

```text
./make.js test
  退出码 0；单元 337/337、DOM 109/109，总计 446/446。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 92/92。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；扫描 27 个新增模块文件通过。
./make.js package
  退出码 0；归档包含 `pages/settings_sections.js`。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；隔离 macOS Chrome Stable E2E 通过动态多级导航、网站规则完整解释、标签页列表、迁移、核心手势、跨 frame、fixtures 和 Service Worker 重启。
Windows 11 ARM64 Chrome Stable `151.0.7922.174` 远程 CDP E2E
  退出码 0；当前归档通过动态导航、网站规则解释、标签页列表、设置迁移、核心输入、下载、跨 frame、fixtures 和 Service Worker 重启；剪贴板断言因远程权限无法代授而跳过。
deno run -A scripts/build_release.js --package
  连续执行两次退出码 0；四个当前归档 SHA-256 一致：BrowserToolbox `cbed5fad566dfdbea9ec8d2d1e7fb8f8785873948ace566773a443f97452f57c`，Chrome `94378c84c2d36c824d832bf46f3ef5e92efc206a72ffb7e306a15d482854b976`，Firefox `62b2e32243d4d200bbb1e5d66a8db9b40c6764b3a8310456c3738b596171141d`，Canary `3d0ee686e3cb68ff3d1bce5789ee27744cbaefaba5dd41abbcb59789f34c7170`。
```

- 外部状态清理：Windows 测试 Chrome、`C:\BrowserToolboxE2E`、`9231` portproxy、防火墙规则、Parallels
  隔离 VM 和 host `59581/59582` 服务均已清理；未触碰用户日常浏览器资料。
- 风险与边界：以上 macOS/Windows 仍是隔离自动化，不是人工平台验收；Windows、Edge、Linux Chrome
  Stable、macOS Chrome Stable 人工矩阵，屏幕阅读器，高对比度/缩放人工检查，认证态站点，完整 Vimium
  手工回归和真实旧 CRX 安装更新语义仍未完成。项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留既有未提交修改以及本轮修改，没有创建提交或推送。
- 下一步：保持自动化与人工证据分界，继续取得真实辅助技术/平台人工环境和迁移前安装包；代码层下一项可抽取跨
  Vimium/BrowserToolbox 存储域的提交协调器，并为失败恢复增加契约测试。
- 对应提交：无。

## 2026-08-25 / 跨存储域设置提交协调器与保存安全性 / E-047

- 授权边界：本轮继续处理当前 Phase
  内的设置保存一致性、旧版配置升级验收和设置页可扩展架构；没有新增产品功能、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。浏览器工具箱仍永久免费、无账户、无广告、无遥测、无远程代码。
- 架构与体验：新增 `pages/settings_commit_coordinator.js`，把 Vimium 设置域和 BrowserToolbox
  设置域的保存统一为“先检查外部变更、再串行写入、部分失败按逆序恢复”的协调流程；冲突会停止写入并显示本地化提示，若外部值已经等于当前页面待写值则允许幂等完成。设置草稿的深比较增加循环引用配对记录和
  10000
  节点上限，避免异常对象导致页面卡死。自定义指针资源改为提交前失败清理、提交后旧资源尽力回收，避免清理失败反而删除新资源。
- 本轮实际自动门禁：

```text
deno fmt pages/settings_commit_coordinator.js pages/settings_draft.js pages/mouse_options.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/settings_commit_coordinator_test.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0；6 个文件格式检查通过。
deno check pages/settings_commit_coordinator.js pages/settings_draft.js pages/settings_sections.js pages/settings_navigation.js tests/unit_tests/browser_toolbox/settings_commit_coordinator_test.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0。
git diff --check
  退出码 0。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 343/343、DOM 109/109，总计 452/452。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 98/98。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 27 个新增模块，通过。
./make.js package
  退出码 0；归档包含本轮设置提交协调器。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 隔离 E2E 通过设置保存、旧版导入迁移、网站规则、核心手势、超级拖拽、滚轮/摇杆、跨 frame、设计文档 fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
  连续执行两次退出码 0；BrowserToolbox 归档 SHA-256 为 `8a0839d961704f9062120f7b18e821a862b83fb2937eec7ebc8cda1290f60c2f`。当前 Chrome、Firefox、Canary 归档 SHA-256 分别为 `0ee2ab0cc6ffdc8f55c91be77ebe8502e54475adb0f396d118bdad3a99d22154`、`9a639fb8819354dea082cfb3d5240b5d01d54c6afe0b1a8b2b9cdb6806ee5f56`、`47cee7b334ce6041f1ffadcd26e1b554b52c1ca3a2624324e1e375447b385562`。
```

- 中间情况：未设置 `PUPPETEER_EXECUTABLE_PATH` 的首次完整测试曾因 Puppeteer 缓存的 Chrome for
  Testing Framework 缺失退出；改用项目已验证的系统 Chrome
  路径后通过，该环境问题不计为产品失败。首次协调器 E2E
  还暴露出测试在外部写配置后未刷新设置页基线的问题，修正测试基线后当前 macOS 隔离 E2E
  通过；没有通过放宽冲突保护来规避该问题。
- 风险与边界：Vimium 与 BrowserToolbox
  仍是两个浏览器存储域，协调器提供失败恢复而非跨域原子事务；发生真实外部冲突时仍需用户重新加载并确认，尚未实现字段级合并。当前没有在
  E-047 变更后重跑 Windows 隔离 E2E，因此不能把 E-046 的 Windows
  自动证据写成当前版本通过；Windows、Edge、Linux Chrome Stable、macOS Chrome Stable
  人工矩阵，屏幕阅读器，高对比度/缩放人工检查，认证态站点，完整 Vimium 手工回归和真实旧 CRX
  安装更新语义仍未完成。项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在获得可操作环境后，先针对 E-047 归档重跑 Windows Chrome 隔离 E2E，再执行
  Windows/Edge/Linux/macOS 人工矩阵、屏幕阅读器和旧 CRX
  安装更新门禁；继续保持自动化证据与人工证据分开记录。
- 对应提交：无。

## 2026-08-25 / E-047 变更后的 Windows Chrome 隔离复验 / E-048

- 授权边界：本轮使用用户已授权的 Parallels Windows 11 ARM64 隔离 VM、临时 Chrome profile、一次性
  C:\BrowserToolboxE2E 目录和远程 CDP，复验 E-047 的存储提交协调器与设置页变更；没有触碰用户日常
  Chrome、登录态、Cookie、Token 或个人浏览数据，没有提交、推送、发布或修改外部项目路径。
- 目标环境：Windows 11 ARM64，Chrome Stable 151.0.7922.174；通过当前 Chrome Store 归一化归档和
  Extensions.loadUnpacked 加载扩展，实际扩展 ID 为 dgnlplafmckkmaajhojdjcjkpjghemil。测试期间 host
  fixture 监听 10.211.55.2:59582，Windows Chrome 通过临时 9231 portproxy 暴露 CDP。
- 本轮实际自动门禁：

```text
prlctl start "OpenKeyMouse-Windows-Isolated"
  退出码 0；Windows VM 启动。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档均报告 Archive is current。
Windows PowerShell：在 C:\BrowserToolboxE2E 下载并展开当前归档，启动 Chrome Stable 151.0.7922.174 的临时 profile，通过 Extensions.loadUnpacked 返回 BrowserToolbox ID。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_ID=dgnlplafmckkmaajhojdjcjkpjghemil BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  修正临时下载目录和 Windows 路径后退出码 0；通过标签页列表、设置保存、旧版设置/导出迁移、正则网站规则、核心鼠标输入、超级拖拽下载、滚轮/摇杆、跨 frame、fixtures、恢复默认和 Service Worker 重启；剪贴板断言因远程权限无法代授而跳过。
```

- 中间情况：第一次运行因未预创建
  C:\BrowserToolboxE2E\downloads，第二次运行因环境变量误传双反斜杠，均在超级拖拽下载等待处超时；创建明确的临时下载目录并使用单反斜杠路径后重跑通过。两次中间失败均为测试环境前提，不计为产品失败。
- 外部状态清理：已停止 Windows 测试 Chrome，删除明确的 C:\BrowserToolboxE2E 临时目录，移除 9231
  portproxy 和对应防火墙规则，停止 Parallels 隔离 VM；host 归档 HTTP 服务和 fixture
  服务均已停止，未留下测试进程。
- 风险与边界：这是 E-047 变更后的 Windows Chrome 隔离自动化证据，不是 Windows 人工验收；Edge、Linux
  Chrome Stable、macOS Chrome Stable 人工矩阵，屏幕阅读器，高对比度/缩放人工检查，认证态站点，完整
  Vimium 手工回归和真实旧 CRX 安装更新语义仍未完成。项目暂不发布。
- 当前状态：HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：继续执行 Edge/Linux/人工辅助技术和旧 CRX
  安装更新门禁；若没有可访问的真实人工环境，保持这些项目为未完成，不用自动化结果替代人工证据。
- 对应提交：无。

## 2026-08-25 / Windows Edge 当前环境探测 / E-049

- 授权边界：本轮只在已授权的 Parallels Windows 隔离 VM 中探测当前 Edge
  自动化入口，没有触碰用户日常浏览器资料，没有修改产品代码、权限、依赖或网络行为，没有提交、推送或发布。
- 环境事实：Windows Edge 可执行文件存在，版本为 151.0.4129.101。使用临时 profile 分别尝试
  headless=new、旧 headless 和可见模式启动，并指定远程调试端口；每次进程均在建立 CDP
  监听前退出，未产生 Edge E2E 产品断言。因此本轮不把 Edge
  自动或人工验收写成通过，也不据此判定产品失败。
- 实际命令与结果：

```text
prlctl start "OpenKeyMouse-Windows-Isolated"
  退出码 0；Windows VM 启动。
Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
  True。
Get-Item 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe' | 读取 ProductVersion
  151.0.4129.101。
Edge headless=new、旧 headless 和可见模式 + 临时 profile + 远程调试端口
  进程均立即退出，未建立 CDP 监听。
```

- 外部状态清理：已删除明确的 C:\BrowserToolboxE2E 临时目录，停止 host 归档 HTTP 服务，确认没有测试
  Edge 进程，并停止 Parallels 隔离 VM。
- 风险与边界：Edge 仍缺少当前版本的隔离自动 E2E 和人工矩阵证据；当前阻塞条件是 Edge 在该隔离 VM
  的非交互启动环境中退出，不是产品断言失败。后续需要可交互的 Windows Edge 环境再继续，仍不能把旧
  E-019 的人工结果升级为当前版本证据。
- 当前状态：HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：继续寻找可操作的 Edge/Linux/辅助技术环境；在环境改变前保持
  Edge、Linux、屏幕阅读器、认证态站点、完整人工回归和旧 CRX 安装更新为未完成。
- 对应提交：无。

## 2026-08-25 / 设置草稿脏状态回归修正 / E-050

- 授权边界：本轮修正设置页已有交互状态的 UX
  缺陷，没有新增产品功能、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 代码与体验：设置草稿由永久 dirtyHint 改为可失效缓存；每次输入事件统一计算
  changedKeys，用户把值改回已保存值时，保存/放弃按钮和未保存提示会恢复为干净状态，同时避免 isDirty
  与 changedKeys 对同一配置重复深比较。新增回归测试覆盖“修改后还原”。
- 本轮实际自动门禁：

```text
deno fmt pages/settings_draft.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0；2 个文件格式检查通过。
deno check pages/settings_draft.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 344/344、DOM 109/109，总计 453/453。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 99/99。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 27 个新增模块，通过。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档刷新为当前源码。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 隔离 E2E 通过设置保存、导入/导出迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
  连续执行两次退出码 0；BrowserToolbox、Chrome、Firefox、Canary 当前归档 SHA-256 分别为 6f33e3e6dd560ae67d2d23582d01ae50060e969ad9080fe1acbc6646ae0f3110、df8af5985b2d0f048e679eea2938c2b5cbc0732c47d858491288842643b303cf、b755dfa3cea216a4f36395553ded57e56469e9b2a575b03c15dea023815b6570、31b1b990cc2c909cccb56f43a06da33f36c3532f4a6436a8937ca12fd1e559e1。
```

- 风险与边界：该修正只改变设置页 dirty 状态计算，不改变
  schema、迁移或写入协议；跨存储域仍不是原子事务。E-048 的 Windows Chrome 隔离 E2E 早于本轮 E-050
  变更，尚未针对 E-050 重跑；当前 macOS 自动化通过仍不等同于 Windows/Edge/Linux/macOS
  人工矩阵、屏幕阅读器、认证态站点、完整 Vimium 手工回归或旧 CRX 安装更新。
- 当前状态：HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：继续等待可操作的 Edge/Linux/辅助技术和旧 CRX 安装更新环境；代码层暂不新增 Phase 外功能。
- 对应提交：无。

## 2026-08-25 / 设置草稿待保存资源脏状态回归修正与 Windows 复验 / E-051

- 授权边界：本轮修正 E-050 暴露的设置页已有交互状态缺陷，并重跑当前归档的 Windows Chrome 隔离
  E2E；没有新增产品功能、权限、依赖或网络行为，没有提交、推送、发布或修改外部路径。
- 代码与体验：设置草稿继续使用可失效的 dirtyHint，同时增加独立的 forcedDirty
  状态。普通字段改回已保存值时，保存/放弃按钮和未保存提示恢复为干净状态；本地 PNG 指针这类尚未写入
  settings 的待保存资源通过 markDirty(true) 保持可保存；replace、markSaved 和 reset
  会清除强制脏状态。这样同时覆盖了“编辑后还原”和“仅有待保存资源”两条路径。
- 本轮实际自动门禁：

```text
deno fmt pages/settings_draft.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0；2 个文件格式检查通过。
deno check pages/settings_draft.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 345/345、DOM 109/109，总计 454/454。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 100/100。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 27 个新增模块，通过。
./make.js package
  退出码 0；当前归档包含待保存资源脏状态修正。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 隔离 E2E 通过设置保存、导入/导出迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
Windows 11 ARM64 Chrome Stable 151.0.7922.174 远程 CDP 隔离 E2E，使用当前归档、Extensions.loadUnpacked 和临时 profile
  退出码 0；通过设置保存、旧版导出格式迁移、旧版存储键与指针资源迁移、正则网站规则、核心输入、超级拖拽下载、滚轮/摇杆、跨 frame、fixtures、恢复默认和 Service Worker 重启；远程 CDP 无法代授剪贴板权限，相关断言跳过。
deno run -A scripts/build_release.js --package
  连续执行两次退出码 0；四个当前归档 SHA-256 一致：BrowserToolbox bf327455a374816d0b3ad62a42c8f72237619deaaa351862da7dc2183322caa4，Chrome 47ffbcb076d3b245f8a5b57d8c6ccb5b48b6f587b8c279960f6fde3954fc94c7，Firefox 5025f4072b3b74e07f99cbc89859ff01d77a050073a486b96ff0c17f5d0ad2b3，Canary 1741477c934c049e045e75a5345c270e8ef51cf9a40891472de46869ce12c7ae。
```

- 中间情况：E-050 的第一次 dirtyHint 修正已通过本地与 macOS 自动化，但 Windows 隔离 E2E 在“本地 PNG
  指针”保存处暴露了待保存资源没有改变 settings、却需要保持可保存的问题；本轮增加 forcedDirty
  并补充单元回归测试后，Windows
  当前归档完整重跑通过。该中间失败是本轮真实发现的产品回归，不计为通过证据。
- 外部状态清理：已停止 Windows 测试 Chrome，删除明确的 C:\BrowserToolboxE2E 临时目录，移除 9231
  portproxy 和防火墙规则，停止 Parallels 隔离 VM；host 归档服务和 fixture
  服务均已停止，未留下测试进程。
- 风险与边界：设置保存仍跨 Vimium 与 BrowserToolbox
  两个存储域，协调器提供失败恢复而非跨域原子事务；以上 macOS/Windows 仍是隔离自动化，不是
  Windows、Edge、Linux、macOS 人工矩阵、屏幕阅读器、高对比度/缩放、认证态站点、完整 Vimium
  手工回归或真实旧 CRX 安装更新验收。项目暂不发布。
- 当前状态：HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：继续取得可操作的 Edge/Linux/辅助技术和旧 CRX
  安装更新环境；在这些外部证据缺失时保持门禁未完成，不用自动化结果替代人工验收。
- 对应提交：无。

## 2026-08-25 / 标签页搜索边界、设置初始化同步与三平台隔离复验 / E-052

- 授权边界：本轮处理当前 Phase 内的标签页搜索误命中和设置页自动化初始化竞态，并在用户已授权的
  Parallels Windows 隔离 VM、临时 Linux Docker
  浏览器中复验当前归档；没有新增产品模块、权限、依赖或网络行为，没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 代码与体验：`pages/tab_list.js` 为语言偏好读取增加 500ms
  有界回退，存储读取变慢时不阻塞标签页列表；模糊搜索改为标题、URL
  主机、路径、查询参数和哈希分别匹配，取最佳分数，避免扩展 ID、URL
  路径和标题跨边界拼出假命中。`pages/mouse_options.js`
  增加仅供外部同步判断的初始化完成标记，`scripts/e2e_browser_toolbox.js`
  等待设置页完整初始化后再清理、重载和断言；没有改变设置协议或产品权限。
- 中间情况与修正：Linux 首次当前 E2E 在标签页列表渲染后因测试用 `one` 查询跨 URL
  边界得到两个合法但不应作为唯一结果的匹配而超时；macOS 首次复验进一步确认 `Tabs` 也可因扩展 ID
  与路径跨边界被误命中。该中间失败暴露了搜索评分边界问题，不计为通过证据；改为按 URL
  组件独立匹配后，三平台当前归档复验通过。
- 本轮实际自动门禁：

```text
deno fmt --check pages/tab_list.js pages/mouse_options.js scripts/e2e_browser_toolbox.js pages/settings_draft.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0；5 个文件格式检查通过。
deno check pages/tab_list.js pages/mouse_options.js scripts/e2e_browser_toolbox.js pages/settings_draft.js tests/unit_tests/browser_toolbox/settings_draft_test.js
  退出码 0。
git diff --check
  退出码 0。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 345/345、DOM 109/109，总计 454/454。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 100/100。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 27 个新增模块，通过。
./make.js package
  退出码 0；当前 BrowserToolbox、Chrome、Firefox、Canary 归档可用。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 隔离 E2E 通过标签页列表、设置保存、导入/导出迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
docker exec browser-toolbox-linux-debug su deno -s /bin/bash -c 'export HOME=/tmp/deno-home DENO_DIR=/tmp/deno-cache PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium; deno run --allow-all scripts/e2e_browser_toolbox.js'
  退出码 0；Debian amd64 Chromium 151.0.7922.169 临时容器隔离 E2E 通过同一套标签页、迁移、网站规则、核心输入、跨 frame、fixtures 和 Service Worker 重启路径。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_ID=dgnlplafmckkmaajhojdjcjkpjghemil BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Windows 11 ARM64 Chrome Stable 151.0.7922.174 远程 CDP 隔离 E2E 通过标签页列表、设置保存、旧版导出/存储键与指针资源迁移、正则网站规则、核心输入、超级拖拽下载、滚轮/摇杆、跨 frame、fixtures、恢复默认和 Service Worker 重启；远程 CDP 无法代授剪贴板权限，相关断言跳过。
deno run -A scripts/build_release.js --package
  连续执行两次退出码 0；当前四个未发布归档 SHA-256 一致，BrowserToolbox、Chrome、Firefox、Canary 分别为 `5dd0e8f7c69a784b58f3e24999787a298c6223459eaec18153fe8258fa7fe224`、`a431268b909d1d9072eec7eacf8de0146b55f7a7ee8b612f99eab37ba28222a7`、`1c4c548347c7b5c69220863dd112db7481dc331d10151ceac0e26e2adf42661a`、`9aaaab92edbc13a86db2eb95b4c1533c26d007d6da3964119e56c9cd2d778a4c`。
```

- 外部状态清理：已停止 Windows 测试 Chrome，删除明确的 `C:\BrowserToolboxE2E` 临时目录，移除 `9231`
  portproxy 和防火墙规则，停止 Parallels 隔离 VM；已停止 host 归档/fixture 服务，删除本轮命名的
  `browser-toolbox-linux-debug` 容器和临时镜像；未留下本轮测试进程。
- 风险与边界：以上 macOS、Windows、Linux 结果均为隔离自动化，不是
  Chrome、Edge、Windows、macOS、Linux 的人工矩阵；屏幕阅读器、人工高对比度/缩放、认证态站点、完整
  Vimium 手工回归、真实旧 CRX 安装更新语义仍未完成。Edge 当前仍只有 E-049 的环境探测：Edge
  151.0.4129.101 在该隔离 VM 的非交互启动环境中退出，未形成当前 Edge E2E 证据。项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在用户可操作真实环境后，按发布检查表逐项完成人工平台矩阵、屏幕阅读器/高对比度/缩放、认证态站点和旧
  CRX 安装更新门禁；在此之前不把当前自动化结果升级为人工验收，也不发布。
- 对应提交：无。

## 2026-08-26 / 集成页面旧语言偏好兼容读取 / E-069

- 授权边界：本轮只补齐 Vimium
  命令列表和帮助弹窗读取旧版本语言偏好的兼容路径，不增加产品模块、权限、依赖、网络行为或存储格式；只读复用现有
  `settings_storage.js`，没有触发迁移写入，没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构与用户体验：`BrowserToolboxI18n.applyStoredLocale()` 现在按“设置仓库 → 存储兼容适配器 →
  规范键回退”读取语言。命令列表和帮助弹窗导入现有 `BrowserToolboxSettingsStorageInstance` 后，旧
  `openKeyMouseSettings.general.language`
  也能在用户首次打开集成页面时生效；新写入键、运行时技术标识和迁移边界没有改变。
- 回归覆盖：新增旧存储语言偏好单元测试；保留规范键语言测试，完整 E2E
  继续覆盖旧版导出、旧存储键/命令/指针迁移、站点规则、设置保存、核心输入、跨 frame、fixtures 和
  Service Worker 重启。
- 本轮实际自动门禁：

```text
deno fmt lib/i18n.js pages/command_listing.js pages/help_dialog_page.js tests/unit_tests/browser_toolbox/i18n_test.js
deno check lib/i18n.js pages/command_listing.js pages/help_dialog_page.js tests/unit_tests/browser_toolbox/i18n_test.js
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  以上命令退出码均为 0；单元 371/371、DOM 109/109，总计 480/480。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 123/123。
deno fmt --check lib/i18n.js pages/command_listing.js pages/help_dialog_page.js tests/unit_tests/browser_toolbox/i18n_test.js
git diff --check
  以上命令退出码均为 0。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；当前归档包含集成页面兼容读取改动。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档隔离 E2E 通过。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；宿主 arm64 上临时 Debian amd64 Chromium 151.0.7922.169 当前归档隔离 E2E 通过；容器已删除。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次均退出码 0；BrowserToolbox、Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `87f083dbdc7257b74dceaef63a648a06f1191f6d4d130a4665f4b9f948b14519`、
  `d4eec474be66ea5e85835018d6526e0e53ade6362086e88734f9917561aa7dfa`、
  `fb54e729df63126a324cb3e2992d7a038b7e4f26715a82c8ebb8024c66ad1a0d`、
  `8271a0bb06a6d0fe3b122fbb47ec5bd43339afabd8d3d0ec6cac71a21c9d8fa0`。
```

- 外部状态清理：Linux 临时容器已停止并删除；Windows 隔离 VM 仍因 E-068 的 Sysprep/OOBE
  状态保持停止；没有留下本轮浏览器进程、测试 profile 或监听服务。
- 风险与边界：以上仍是自动化隔离证据，不替代 Windows/Edge 当前
  checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新；项目暂不发布，相关功能矩阵继续保持 `IN_PROGRESS`。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：保留当前兼容读取边界；剩余工作依赖可操作的真实平台/辅助技术环境，不继续扩大 Phase 范围。
- 对应提交：无。

## 2026-08-26 / 正则安全模块进入内容脚本加载序列 / E-070

- 授权边界：本轮只修复站点规则正则安全检查在真实内容脚本运行时的加载顺序，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 真实缺陷：`regex_safety.js` 已由 Service Worker 和设置页加载，但 Manifest V3
  的网页内容脚本序列此前遗漏该文件。这样设置页能拒绝明显复杂正则，内容脚本在模块缺失时却会回退到只调用
  `RegExp` 的兼容分支，不能保证运行时与设置校验使用同一安全边界。
- 架构修正：将 `lib/browser_toolbox/regex_safety.js` 放入 `manifest.json` 的 `settings_schema.js`
  之后、`settings_validator.js` 之前；同时把该顺序加入 `scripts/audit_permissions.js`
  的必需加载序列，使后续删除或错排会直接被审计拦截。没有改变 Glob/正则匹配语义，也没有放宽正则能力。
- 本轮实际自动门禁：

```text
deno fmt --check scripts/audit_permissions.js
deno check scripts/audit_permissions.js
deno run -A scripts/audit_permissions.js
  以上命令退出码均为 0；权限审计 9 项，内容脚本加载顺序通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 371/371、DOM 109/109，总计 480/480。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 123/123。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；当前 Chrome、Firefox、Canary 归档包含更新后的 Manifest 加载序列。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 隔离 E2E 通过。
docker exec -d -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug sh -lc 'deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js > /tmp/browser-toolbox-e2e.log 2>&1; echo $? > /tmp/browser-toolbox-e2e.exit'
  退出码 0；临时 Debian amd64 Chromium 151.0.7922.169 当前 checkout 隔离 E2E 通过，最终 `/tmp/browser-toolbox-e2e.exit` 为 `0`。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次均退出码 0；BrowserToolbox、Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `d85d73bf16d3b1fabf2faecb55dd4aacdf9a5d59149d53af5c256ecbf8ad9566`、
  `afa47f222599c1a46dc97677a535c1f9fe38e5d0c42b90408e3235a6ab5d94db`、
  `257d46a06ab92ac161a4967c5bcda695edfa5422d4e1c10ad8bc25c493aa4c0d`、
  `37d4ae193c03d30eba32a99567289886c40843abd00609033d3644b076e14587`。
git diff --check
  退出码 0；HEAD 仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`。
```

- 外部状态清理：Linux 临时容器 `browser-toolbox-linux-debug` 已停止并删除；没有留下测试浏览器、测试
  profile、监听服务或安装中的临时容器。
- 风险与边界：本轮修复保证了当前 Manifest 内容脚本也加载正则安全分析，但 macOS/Linux
  结果仍是隔离自动化，不替代 Windows/Edge 当前 checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新；项目暂不发布，功能矩阵继续保持 `IN_PROGRESS`。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：取得可操作的真实 Windows/Edge 与辅助技术环境，按发布检查表补做人工门禁；代码层暂不扩大
  Phase 范围。
- 对应提交：无。

## 2026-08-27 / 当前 checkout 门禁复核与归档可复现性 / E-078

- 授权边界：本轮只复核当前 checkout 的本地测试、审计、打包和未发布归档，不接触日常浏览器
  profile、登录态、Cookie、Token 或个人浏览数据，不提交、推送、发布或修改外部路径。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 378/378，DOM 109/109，总计 487/487。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 130/130。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 32 个新增模块，通过。
./make.js package
  退出码 0；归档内容检查通过，产物未发布。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次退出码均为 0；BrowserToolbox、Chrome、Firefox、Canary 归档 SHA-256 分别为
  `d0599ae7dda34963685332f0982d4ccbd0d85962cdc912bd111b3128ab3fb3d2`、
  `1157b04b6cf8e92c9de75b925c4dfa221c7ef3a7ab0963c69af1534a6f8f31a6`、
  `c9891eef7aa055affb24558ea8a09a367537be129a6b089e700ea31e39d73f2f`、
  `65fcac5007a78d9470bcd16ba5fd4b9f5be9785571afd3b92da6aaa543b9179b`。
git diff --check
  退出码 0。
```

- 风险与边界：这些结果是当前 checkout
  的自动门禁，不是人工平台矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点或完整 Vimium
  手工回归；生产签名/真实用户 profile 的 CRX 更新也未完成，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：取得可操作的真实 Windows/Edge 与辅助技术环境后，按发布检查表逐项补人工门禁；在此之前不改变
  `IN_PROGRESS` 状态。
- 对应提交：无。

## 2026-08-26 / 当前 checkout 的 Linux amd64 Chromium 完整回归 / E-077

- 授权边界：本轮只在临时 Docker 容器中用当前 checkout 和当前 `dist/vimium` 运行隔离 E2E；容器使用
  `denoland/deno:debian` 的 amd64 镜像并临时安装 Debian Chromium，没有接触日常浏览器
  profile、登录态、Cookie、Token 或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 实际环境：宿主机 arm64 通过 Docker 运行 Debian amd64；Chromium 版本为 `151.0.7922.169`。E2E
  只启动本地 fixture 服务和临时浏览器 profile，未访问项目服务器。
- 本轮实际命令与结果：

```text
docker run -d --name browser-toolbox-linux-current --shm-size=2g -v /Users/yang/project/plugin/browser-toolbox:/work denoland/deno:debian sleep infinity
  退出码 0；创建临时 amd64 Deno 容器。
docker exec browser-toolbox-linux-current sh -lc 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends chromium ca-certificates'
  退出码 0；安装 Debian Chromium 151.0.7922.169。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-current deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；当前 checkout 完整 BrowserToolbox E2E 通过：动作页受限提示、设置页键盘/语义、标签页列表、鼠标轨迹、八方向、会话开关、超级拖拽、滚轮/摇杆、跨 frame、原生旁路、运行时网站规则、全局开关、设置保存、规范/旧版导入、旧存储/指针资源迁移、Vimium 备份迁移、逐级迁移、本地 PNG 指针、恢复默认值、Service Worker 重启和设计文档 fixtures。
docker stop browser-toolbox-linux-current && docker rm browser-toolbox-linux-current
  退出码均为 0；临时容器已停止并删除，未留下本轮 Linux 测试容器。
git diff --check
  退出码 0。
```

- 风险与边界：本轮补充的是当前 checkout 的 Linux amd64 Chromium 隔离自动化证据，不是 Linux Chrome
  Stable 人工验收，也不替代 Windows/Edge/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产 CRX 验收。Computer
  Use 读取本机 Chrome UI 两次超时，不能据此声称人工 UI 门禁已完成；项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在可操作的真实 Windows/Edge
  与辅助技术环境中补人工平台矩阵、屏幕阅读器和高对比度/缩放门禁；代码层暂不扩大 Phase
  范围，除非人工验收暴露真实缺陷。
- 对应提交：无。

## 2026-08-26 / 迁移前旧 CRX、旧存储与当前版本升级链 / E-076

- 授权边界：本轮只在明确的临时 `/tmp` 目录、临时测试密钥、临时 Debian amd64 Chromium 容器和临时
  profile 中验证迁移前旧 CRX 到当前 CRX 的同 ID 更新及旧设置迁移；没有接触日常浏览器
  profile、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。临时目录结束后已移入系统废纸篓，容器已停止并删除。
- 升级材料：旧包使用当前 `dist/open-key-mouse-0.1.0.zip`，当前包使用当前
  `dist/browser-toolbox-0.1.0.zip`；只在临时解包目录把当前 manifest 版本改为
  `0.1.1`，两版使用同一临时 PKCS#8 RSA 测试密钥打包，扩展 ID 均为
  `ggenifmboiojfflejhdkpnkddgdifnad`。旧 CRX SHA-256 为
  `9912b079a09a81bf4b3ea89fe39688e1364db51483b2a0dc9554021cb8060a54`，临时 `0.1.1` 当前 CRX SHA-256
  为 `3f53ec62e589a1b9c417a74942274147662682823850ca67f9e7f988f0d904ef`。
- 实际升级结果：Debian amd64 Chromium `151.0.7922.169` 先从 Linux 外部扩展 JSON 的
  `external_crx`/`external_version` 安装旧 CRX，profile 活动目录为
  `ggenifmboiojfflejhdkpnkddgdifnad/0.1.0_0`；旧版本页面实际写入
  `openKeyMouseSettings`、`openKeyMouseSessionOverrides` 和
  `openKeyMouseCursor-legacy-asset`。切换外部 JSON 后重启临时浏览器，再通过 `chrome://extensions` 的
  Update 控件触发升级，活动目录变为 `ggenifmboiojfflejhdkpnkddgdifnad/0.1.1_0`，扩展 ID 保持不变。
- 迁移结果：当前 `0.1.1` 页面读取到 `browserToolboxSettings.schemaVersion=4`，旧
  `OpenKeyMouse.newWindow` 已变为
  `BrowserToolbox.newWindow`；旧设置键仍保留用于回滚，旧会话键已迁移，旧指针资源仍可读取，迁移备份的
  schemaVersion 为 3，设置页 `data-settings-ready=true`。重启浏览器后再次读取仍为 `0.1.1`/schema
  4，并实际发现当前 Service Worker target；浏览器重启后 session 覆盖不再存在属于
  `chrome.storage.session` 的会话生命周期语义，不作为持久化失败。
- 本轮实际命令与结果：

```text
unzip -q dist/open-key-mouse-0.1.0.zip -d /tmp/browser-toolbox-crx-current.MNxncr/old
unzip -q dist/browser-toolbox-0.1.0.zip -d /tmp/browser-toolbox-crx-current.MNxncr/current
perl -0pi -e 's/"version": "0.1.0"/"version": "0.1.1"/' /tmp/browser-toolbox-crx-current.MNxncr/current/manifest.json
openssl genrsa -traditional -out /tmp/browser-toolbox-crx-current.MNxncr/test.pem 2048
openssl pkcs8 -topk8 -nocrypt -in /tmp/browser-toolbox-crx-current.MNxncr/test.pem -out /tmp/browser-toolbox-crx-current.MNxncr/test-pkcs8.pem
Chrome --pack-extension=/tmp/browser-toolbox-crx-current.MNxncr/old --pack-extension-key=/tmp/browser-toolbox-crx-current.MNxncr/test-pkcs8.pem
Chrome --pack-extension=/tmp/browser-toolbox-crx-current.MNxncr/current --pack-extension-key=/tmp/browser-toolbox-crx-current.MNxncr/test-pkcs8.pem
  两次退出码均为 0；同一测试公钥对应扩展 ID ggenifmboiojfflejhdkpnkddgdifnad。
docker run --name browser-toolbox-crx-linux --shm-size=2g -p 9451:9222 -v /tmp/browser-toolbox-crx-current.MNxncr:/crx debian:trixie-slim sleep infinity
docker exec browser-toolbox-crx-linux apt-get install chromium curl ca-certificates socat
  Chromium 151.0.7922.169 安装成功；通过临时 socat 仅把容器内 CDP 转发到 127.0.0.1:9451。
旧版 profile：chrome://extensions Update 前读取到版本 0.1.0、活动目录 ggenifmboiojfflejhdkpnkddgdifnad/0.1.0_0。
旧版扩展页：实际写入旧 sync/session/local 键并读取确认版本 0.1.0。
切换 external_crx=/crx/current.crx、external_version=0.1.1，重启临时 Chromium，再点击 chrome://extensions 的 Update 控件。
  退出码 0；活动目录变为 ggenifmboiojfflejhdkpnkddgdifnad/0.1.1_0，扩展 ID 未变。
当前扩展页：读取 schemaVersion=4、commandName=BrowserToolbox.newWindow、旧键保留/迁移备份/旧指针资源均符合预期，data-settings-ready=true。
重启临时 Chromium 后再次读取：版本 0.1.1、schemaVersion=4、BrowserToolbox.newWindow，Service Worker target 为 chrome-extension://ggenifmboiojfflejhdkpnkddgdifnad/background_scripts/main.js。
docker stop browser-toolbox-crx-linux && docker rm browser-toolbox-crx-linux
/usr/bin/trash /tmp/browser-toolbox-crx-current.MNxncr /tmp/browser-toolbox-pack-old.log /tmp/browser-toolbox-pack-current.log
  退出码均为 0；临时容器已删除，临时 profile、CRX 和测试密钥已移入废纸篓。
```

- 证据边界：本轮形成了当前 checkout 对迁移前归档、旧设置键、旧会话键、旧本地资源、同 ID CRX 更新和
  Service Worker 重启的隔离自动证据；官方 Linux 外部 CRX 字段依据
  [Chrome 扩展官方安装文档](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)。这仍不是生产签名、真实旧用户
  profile、Chrome Web Store 更新通道、Windows/Edge/macOS/Linux 人工矩阵、屏幕阅读器或完整 Vimium
  手工回归，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：继续取得真实迁移前安装包/用户 profile 与可操作的
  Windows/Edge、辅助技术环境，补人工平台、认证态网站和发布 CRX
  门禁；不把本轮隔离自动化写成人工或生产验收。
- 对应提交：无。

## 2026-08-26 / Browser Toolbox 集成页外部设置访问完全适配化 / E-075

- 授权边界：本轮只完成 Browser Toolbox 集成页对 Vimium
  设置的适配层收口，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构优化：动作页和设置页现在通过 `BrowserToolboxVimiumSettingsAdapterInstance` 访问 Vimium
  设置，包含加载、读取、写入、备份迁移和冲突提交路径；页面源码不再直接依赖全局
  `Settings`。适配层补充显式 `load()` 与 `isAvailable()`，权限审计增加边界检查，后续替换 Vimium
  设置源或隔离测试环境时不需要改动页面业务逻辑。
- 用户体验与可靠性：动作页保存现在等待 Vimium 设置写入完成后再显示已保存；设置页的 Vimium/Browser
  Toolbox 双存储域提交、冲突检查和回滚语义保持不变。Vimium
  原有选项页、命令列表、帮助页等上游页面不在本轮重写范围。
- 本轮实际自动门禁：

```text
deno fmt --check background_scripts/browser_toolbox/vimium_settings_adapter.js pages/action.js pages/mouse_options.js scripts/audit_permissions.js tests/unit_tests/browser_toolbox/vimium_settings_adapter_test.js
deno check background_scripts/browser_toolbox/vimium_settings_adapter.js pages/action.js pages/mouse_options.js scripts/audit_permissions.js tests/unit_tests/browser_toolbox/vimium_settings_adapter_test.js
  退出码均为 0；格式和类型检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 378/378、DOM 109/109，总计 487/487。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 130/130。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过，并确认动作页/设置页不直接依赖全局 Settings。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 32 个新增模块，通过。
./make.js package
  退出码 0；三个浏览器归档包含适配层收口后的动作页、设置页和加载顺序。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 隔离 E2E 通过动作页会话开关、设置保存、旧版导出/存储键与指针资源迁移、Vimium 备份迁移、站点规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次均退出码 0；四个当前未发布归档 SHA-256 一致：BrowserToolbox d0599ae7dda34963685332f0982d4ccbd0d85962cdc912bd111b3128ab3fb3d2、Chrome 1157b04b6cf8e92c9de75b925c4dfa221c7ef3a7ab0963c69af1534a6f8f31a6、Firefox c9891eef7aa055affb24558ea8a09a367537be129a6b089e700ea31e39d73f2f、Canary 65fcac5007a78d9470bcd16ba5fd4b9f5be9785571afd3b92da6aaa543b9179b。
git diff --check
  退出码 0；文档更新后的工作区差异检查通过，HEAD 仍为 bcbab167c7db99c510111c41e60ae11b4fee8ad3。
```

- 外部状态清理：没有创建或保留临时 Linux 容器；Windows VM 保持停止；没有留下测试浏览器、测试
  profile、监听服务或资源缓存。
- 风险与边界：本轮只证明适配化自动化、打包和当前 macOS Chrome 隔离结果；Linux 本轮没有新的 E2E
  结果，Windows/Edge 当前 checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和生产签名/真实用户
  profile 的旧 CRX 更新仍未完成。项目暂不发布，功能矩阵继续保持 IN_PROGRESS。
- 当前状态：HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：网站规则已有“输入 URL 后预览命中规则、优先级和受影响模块”的本地化解释与 E2E
  覆盖，本轮不重复实现；下一步回到真实旧
  CRX/迁移环境、Windows/Edge、辅助技术和人工回归门禁，不把自动化结果写成人工完成。
- 对应提交：无。

## 2026-08-26 / Vimium 设置适配层与仓库外部依赖收口 / E-074

- 授权边界：本轮只收口 Browser Toolbox 与现有 Vimium
  设置对象之间的架构边界，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构优化：新增 `vimium_settings_adapter.js` 作为可替换的 Vimium 设置适配层；`SettingsRepository`
  读取 `exclusionRules` 时不再直接依赖全局 `Settings`，可通过注入源测试和替换。Manifest V3
  内容脚本、Service
  Worker、动作页、标签页列表和设置页均按“适配层先于仓库”加载，并由权限审计固定顺序；这为后续隔离上游设置读写、替换测试源和降低全局耦合保留了稳定边界。
- 测试补充：新增适配层委托与 Vimium 设置源缺失回退测试；没有改变站点规则优先级、Glob/Regex
  匹配、迁移语义、Vimium 键盘行为或任何新写入键。
- 本轮实际自动门禁：

```text
deno fmt --check background_scripts/browser_toolbox/vimium_settings_adapter.js background_scripts/browser_toolbox/settings_repository.js pages/action.js pages/tab_list.js scripts/audit_permissions.js tests/unit_tests/browser_toolbox/vimium_settings_adapter_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
deno check background_scripts/browser_toolbox/vimium_settings_adapter.js background_scripts/browser_toolbox/settings_repository.js pages/action.js pages/tab_list.js scripts/audit_permissions.js tests/unit_tests/browser_toolbox/vimium_settings_adapter_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
  退出码均为 0；格式和类型检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 378/378、DOM 109/109，总计 487/487。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 130/130。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 32 个新增模块，通过。
./make.js package
  退出码 0；三个浏览器归档包含适配层及正确的依赖加载顺序。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 隔离 E2E 通过标签页列表、设置导入导出、旧版设置/存储键与指针资源迁移、站点规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、设计文档 fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次均退出码 0；四个未发布归档 SHA-256 一致：BrowserToolbox fe47ddbd7a3ef7d7b394a086ef47a184d76c07df4eaca51d901aeea7e5dd36ba、Chrome b458b0409c81d46f1eb81475b238185edc2794972bdebe922423d4856d5da7d2、Firefox 3b7790e3d5520a397110144cd8e0f3613c362949de262e882b018d1a427e960b、Canary eb0c1272846742886c09fc039ef27c9ff42fb0d115ed611a6e3dd227f8d2a242。
git diff --check
  退出码 0；HEAD 仍为 bcbab167c7db99c510111c41e60ae11b4fee8ad3。
```

- 外部状态清理：没有创建或保留临时 Linux 容器；Windows VM 保持停止；没有留下测试浏览器、测试
  profile、监听服务或资源缓存。
- 风险与边界：本轮只证明适配层自动化、打包和当前 macOS Chrome 隔离结果；Linux 本轮没有新的 E2E
  结果，Windows/Edge 当前 checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和生产签名/真实用户
  profile 的旧 CRX 更新仍未完成。项目暂不发布，功能矩阵继续保持 IN_PROGRESS。
- 当前状态：HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在不扩大产品范围的前提下，可继续把动作页和设置页中仍属 Browser Toolbox 集成路径的 Vimium
  设置读写逐步改为适配层调用，并为旧版本设置/导出升级补做真实安装升级和人工门禁；取得可操作的真实
  Windows/Edge 与辅助技术环境后，继续剩余人工验收，不把自动化结果写成人工完成。
- 对应提交：无。

## 2026-08-26 / 站点规则行级正则反馈与设置页 DOM 解耦 / E-073

- 授权边界：本轮只改善已有站点规则编辑体验和编辑器可测试性，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 用户体验与架构：SiteRulesEditor 现在在规则行内复用正式的 regex_safety.js 与 site_rule_matcher.js
  校验；正则语法错误、明显复杂度风险和无效规则会在编辑时即时显示本地化提示，并设置
  aria-invalid，不必等到点击保存才定位问题。编辑器改为使用注入的 documentRef，不再依赖全局
  document/Node，保存时的最终 settings_validator 仍保留为唯一写入门禁。
- 测试补充：新增规则编辑器测试，覆盖复杂正则即时提示、修正后清除错误、合法 Glob
  和非法正则；没有改变站点规则优先级、Glob/Regex 匹配或迁移语义。
- 本轮实际自动门禁：

```text
deno fmt pages/site_rules_editor.js tests/unit_tests/browser_toolbox/site_rules_editor_test.js
deno fmt --check pages/site_rules_editor.js tests/unit_tests/browser_toolbox/site_rules_editor_test.js
deno check pages/site_rules_editor.js tests/unit_tests/browser_toolbox/site_rules_editor_test.js
  退出码均为 0；格式和类型检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 376/376、DOM 109/109，总计 485/485。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 128/128。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；三个浏览器归档包含行级规则反馈修正。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 隔离 E2E 通过设置页无障碍语义、设置保存、旧版导出/存储键与指针资源迁移、本地 PNG 指针、站点规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次均退出码 0；四个未发布归档 SHA-256 一致：BrowserToolbox fcc57893940320cf33c9bb65a80f11ee7845fa14a1826b4ba268ce0045cb50dd、Chrome 4f30eb70a1ef186cfdf7ea83a64cede052e70244f3bfbbf4e18bbd46b8e70671、Firefox 1767d3d84f1f46fb946f5d7c606ae7aa025e673adad2c89c3cf1eb5aee17fe91、Canary 7731af252fe34e6a7fa9b1e24ae784e481dd405cb4b793025cac38b745006798。
git diff --check
  退出码 0；HEAD 仍为 bcbab167c7db99c510111c41e60ae11b4fee8ad3。
```

- 外部状态清理：没有创建或保留临时 Linux 容器；Windows VM 保持停止；没有留下测试浏览器、测试
  profile、监听服务或资源缓存。
- 风险与边界：本轮只证明规则编辑器的自动化和当前 macOS Chrome 隔离结果；Linux 本轮没有新的 E2E
  结果，Windows/Edge 当前 checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和生产签名/真实用户
  profile 的旧 CRX 更新仍未完成。项目暂不发布，功能矩阵继续保持 IN_PROGRESS。
- 当前状态：HEAD 仍为
  bcbab167c7db99c510111c41e60ae11b4fee8ad3；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：保留行级提示与最终保存校验的双层门禁；取得可操作的真实 Windows/Edge
  与辅助技术环境后，继续剩余人工与旧版本安装升级门禁，不把自动化结果写成人工完成。
- 对应提交：无。

## 2026-08-26 / 本地资源存储边界收口与设置运行时回归 / E-072

- 授权边界：本轮只收口已有自定义指针资源的存储分层，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构优化：`SettingsStorage` 统一负责 Browser Toolbox 本地资源的读、写、删，`SettingsRepository`
  提供稳定的资源门面；设置页和鼠标控制器不再直接调用 `chrome.storage.local`。配置仍按原有
  sync/local/session 分层，指针资源键、迁移兼容和删除失败回滚语义均未改变。
- 测试补充：新增 Storage 适配层和 Repository 门面测试，覆盖本地资源读写、删除、空 ID
  防护和资源读取缺失；浏览器运行时继续通过同一个 Repository 读取指针资源。
- 本轮实际自动门禁：

```text
deno fmt --check background_scripts/browser_toolbox/settings_storage.js background_scripts/browser_toolbox/settings_repository.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
deno check background_scripts/browser_toolbox/settings_storage.js background_scripts/browser_toolbox/settings_repository.js pages/mouse_options.js content_scripts/mouse/mouse_controller.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
  退出码均为 0；格式和类型检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 373/373、DOM 109/109，总计 482/482。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 125/125。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；三个浏览器归档包含本地资源存储分层修正。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 隔离 E2E 通过设置保存、旧版导出/存储键与指针资源迁移、本地 PNG 指针、站点规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次均退出码 0；四个未发布归档 SHA-256 一致：BrowserToolbox `0849c841b824d58765005b4dbc8f7d46785edea448f9cc2aeb70bffc4779b06a`、Chrome `48d7241385694b9756ec6f4770529052fb57ec934ad1e2f08515616552edd4f4`、Firefox `5200e67ba736e37159a8c336f6e320db8807827abe37439f26162428b6a92950`、Canary `e293c5c7869e8b42732b8bd7cdc1c1e4d64b956cbd7994f5b9522a24660a0411`。
git diff --check
  退出码 0；HEAD 仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`。
```

- 外部状态清理：没有创建或保留临时 Linux 容器；Windows VM 保持停止；没有留下测试浏览器、测试
  profile、监听服务或资源缓存。
- 风险与边界：本轮只证明资源分层没有破坏当前 macOS Chrome 隔离自动化；Linux 本轮没有新的 E2E
  结果，Windows/Edge 当前 checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和生产签名/真实用户
  profile 的旧 CRX 更新仍未完成。项目暂不发布，功能矩阵继续保持 `IN_PROGRESS`。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在代码层保持资源访问经由存储门面；取得可操作的真实 Windows/Edge
  与辅助技术环境后，继续剩余人工与旧版本安装升级门禁，不把自动化结果写成人工完成。
- 对应提交：无。

## 2026-08-26 / 扩展页面正则安全依赖收口 / E-071

- 授权边界：本轮继续修复已有站点规则/设置加载链路的依赖顺序，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 真实缺陷：`pages/action.js` 和 `pages/tab_list.js`
  都会加载设置校验与站点规则匹配模块，但此前没有显式加载
  `regex_safety.js`。它们在独立扩展页面上下文中会因此退回不带复杂度分析的兼容分支，和内容脚本/设置页的安全边界不一致。
- 架构修正：两个页面入口现在在 `settings_validator.js` 之前显式加载
  `regex_safety.js`；`scripts/audit_permissions.js`
  新增页面依赖顺序检查，后续遗漏会在审计阶段失败。没有改变站点规则匹配语义或正则表达能力。
- 本轮实际自动门禁：

```text
deno fmt --check pages/action.js pages/tab_list.js scripts/audit_permissions.js
deno check pages/action.js pages/tab_list.js scripts/audit_permissions.js
deno run -A scripts/audit_permissions.js
  以上命令退出码均为 0；页面依赖顺序和 Manifest 权限审计通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 371/371、DOM 109/109，总计 480/480。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 123/123。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；三个浏览器归档包含两个页面入口的依赖修正。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 隔离 E2E 通过动作页、标签页列表、设置迁移、正则站点规则、核心输入、跨 frame、fixtures 和 Service Worker 重启。
docker create/start browser-toolbox-linux-debug、Debian Chromium 安装
  本次安装一度卡在 dpkg 解包；确认 Chromium 可执行文件出现后终止了未进入 E2E 的临时安装流程，未把它写成 Linux E2E 通过；容器已删除。E-070 的 Linux 当前 checkout E2E 证据仍保持有效。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次均退出码 0，四个归档 SHA-256 均一致：BrowserToolbox
  `acc85d510b0593473aba4f6e38c23552d19f3ee09f0e4f583e71cf0f5cf7d602`、Chrome
  `89abaa5267153a31ec0faabf75cdea7a9b9926229832674483f8e27e14d2a34c`、Firefox
  `667b36be208bfdc3a284abea7b315471f2218568849bd75ff59145597f2d9e82`、Canary
  `4ca2c9f00b641b17e6fc76abb207512c6eb4ac4d1628554234062a737ae5ff66`。
git diff --check
  退出码 0；HEAD 仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`。
```

- 外部状态清理：临时 `browser-toolbox-linux-debug` 容器已删除；没有留下浏览器进程、测试
  profile、监听服务或临时容器。
- 风险与边界：页面依赖缺口已修复并由审计固定，但本轮没有形成新的 Linux E2E 结果；macOS
  自动化仍不替代 Windows/Edge 当前 checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新。项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：取得可操作的真实 Windows/Edge 与辅助技术环境，按发布检查表补做人工门禁；代码层暂不扩大
  Phase 范围。
- 对应提交：无。

## 2026-08-26 / Windows 隔离 VM OOBE 输入通道再核对 / E-068

- 授权边界：本轮只启动、读取和停止已存在的 `OpenKeyMouse-Windows-Isolated` 隔离 VM，核对 Windows
  平台门禁是否恢复可操作；没有修改 VM 配置、磁盘、快照、源码
  ISO、宿主仓库或日常浏览器资料，没有提交、推送或发布。
- 环境结果：`prlctl start OpenKeyMouse-Windows-Isolated` 退出码 0；VM 状态为 `running`，Guest Tools
  为 `26.4.1-57516`，来宾地址为
  `10.211.55.4`。`prlctl exec OpenKeyMouse-Windows-Isolated --current-user -- cmd.exe /c "echo READY&&ver"`
  仍退出码 2 且无输出。
- 可视核对：`prlctl capture OpenKeyMouse-Windows-Isolated --file /tmp/browser-toolbox-windows-current.png`
  退出码 0；屏幕仍显示 Windows 11 中文 Sysprep 3.14
  对话框，系统清理器为“进入系统全新体验(OOBE)”、关机选项为“重新启动”，不是可执行浏览器测试的桌面。Escape、Alt+F4
  和 Tab 的 `prlctl send-key-event` 调用均返回 0，但连续截图没有任何 UI 变化；没有强行确认
  OOBE、修改镜像或绕过该状态。
- 清理：`prlctl stop OpenKeyMouse-Windows-Isolated` 退出码 0，VM 已停止；未留下 Windows
  浏览器进程、监听端口或仓库外的持久修改。当前 checkout HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`，本轮没有运行时代码修改。
- 文档变更后的本地复核：`git diff --check` 退出码
  0；`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  退出码 0，单元 `370/370`、DOM `109/109`。
- 风险与未验证：本轮没有形成当前 checkout 的 Windows Chrome/Edge
  E2E、人工平台矩阵、屏幕阅读器或高对比度/缩放证据；不把 E-055、E-053
  等历史隔离结果前移，也不把这次输入通道失败写成产品失败。项目仍暂不发布，`V-002`、`O-001` 至
  `O-005` 和 `C-001` 至 `C-003` 的人工矩阵继续保持 `IN_PROGRESS`。
- 下一步：需要可操作的 Windows 桌面/重新准备好的隔离 VM 后，再加载当前归档执行 Chrome/Edge E2E
  和人工矩阵；在环境修复前继续以 macOS/Linux 自动化证据作为唯一当前平台自动证据，不绕过 OOBE。
- 对应提交：无。

## 2026-08-26 / Vimium 集成页面跟随用户语言偏好 / E-067

- 授权边界：本轮只让已有 Vimium
  选项页、命令列表和帮助弹窗读取浏览器工具箱设置中的用户语言偏好，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 用户体验与架构：`lib/i18n.js` 新增统一的 `applyStoredLocale()`。页面优先使用现有
  `BrowserToolboxSettingsRepository` 的规范读取入口；页面单独加载时仅回退读取规范
  `browserToolboxSettings` 键。有效的 `en`/`zh_CN`
  偏好会覆盖浏览器界面语言，缺失、非法或读取失败则继续使用浏览器界面语言；没有新增旧名称运行时标识或新写入键。这样设置页选择中文后，从
  Vimium 选项页进入的命令列表和帮助弹窗不会恢复成英文。
- 回归覆盖：选项页、命令列表和帮助弹窗的现有文案国际化测试改为等待已保存语言偏好；新增 i18n
  读取规范设置并应用中文的单元回归。命令解析、键位展示、设置保存、导入迁移、站点规则和运行时输入链路没有改变。
- 本轮实际自动门禁：

```text
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 370/370、DOM 109/109，总计 479/479。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 122/122。
deno fmt --check lib/i18n.js pages/options.js pages/command_listing.js pages/help_dialog_page.js tests/unit_tests/browser_toolbox/i18n_test.js tests/unit_tests/command_listing_test.js tests/unit_tests/help_dialog_test.js
deno check lib/i18n.js pages/options.js pages/command_listing.js pages/help_dialog_page.js tests/unit_tests/browser_toolbox/i18n_test.js tests/unit_tests/command_listing_test.js tests/unit_tests/help_dialog_test.js
git diff --check
  以上命令退出码均为 0；7 个 JavaScript 文件格式检查通过。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；Chrome、Firefox、Chrome Canary 归档已更新到当前代码。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档完整隔离 E2E 通过设置语言、设置搜索、保存、导入/导出迁移、站点规则、核心手势、跨 frame、fixtures 和 Service Worker 重启。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；宿主 arm64 上临时 Debian amd64 Chromium 151.0.7922.169 当前归档完整隔离 E2E 通过同一路径。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次均退出码 0；BrowserToolbox、Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `b9395f2a3e5808d1586521be64ffd96aefe977f0dc9faee6a2edad10dfaee88d`、
  `802649eba638c2fa4d8f6c84cc269e9d783c123fc59ae81f93af3151804d58ec`、
  `bb24a595f982b3dcf04ad6936d5d36920a22789c7a6b77363704380f864a6c25`、
  `81c3100c0178a31bd8dacccec8f8ed77147113438c817ddf7bbe8a4866cfd512`。
```

- 外部状态清理：临时 Debian 容器已停止并删除；未留下本轮测试进程、测试
  profile、测试密钥或监听服务；Windows 隔离 VM 保持停止状态。
- 风险与边界：本轮结果仍是自动化隔离证据，不替代 Windows/Edge 当前
  checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新；相关功能矩阵继续保持 `IN_PROGRESS`，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：代码层的集成页面语言偏好同步已收口；剩余工作是取得真实人工验收环境后按发布检查表完成平台、辅助技术、认证态站点和生产
  CRX 门禁，不把自动化结果升级为人工验收。
- 对应提交：无。

## 2026-08-26 / Vimium 集成页面 Browser Toolbox 文案国际化 / E-066

- 授权边界：本轮只补齐已有 Vimium 选项页、命令列表和帮助弹窗中的 Browser Toolbox
  文案国际化，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 用户体验与国际化：新增 `openBrowserToolboxSettings` 和 `browserToolboxSettings`
  中英文消息；`pages/options.html` 的 Browser Toolbox 设置入口、`pages/command_listing.html`
  的命令分组标题和 `pages/help_dialog_page.html`
  的帮助分组标题统一使用消息键。命令列表和帮助弹窗在渲染前调用统一 i18n 适配层，Vimium
  原有命令解析、键位展示和执行逻辑不变。
- 回归覆盖：增加选项页入口、命令列表分组标题和帮助弹窗分组标题的简体中文断言；英文/中文资源键数量一致，设置页现有多级导航、字段搜索、导入迁移和保存保护路径保持不变。
- 本轮实际自动门禁：

```text
deno fmt --check lib/i18n.js pages/options.js pages/command_listing.js pages/help_dialog_page.js tests/unit_tests/options_page_test.js tests/unit_tests/command_listing_test.js tests/unit_tests/help_dialog_test.js
  退出码 0；7 个 JavaScript 文件格式检查通过。
deno check lib/i18n.js pages/options.js pages/command_listing.js pages/help_dialog_page.js tests/unit_tests/options_page_test.js tests/unit_tests/command_listing_test.js tests/unit_tests/help_dialog_test.js
  退出码 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 121/121。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 369/369、DOM 109/109，总计 478/478。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；Chrome、Firefox、Chrome Canary 归档已更新到当前代码。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档完整隔离 E2E 通过扩展页面、设置页、迁移、站点规则、核心手势、跨 frame 和 Service Worker 重启。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；临时 Debian amd64 Chromium 151.0.7922.169 当前归档完整隔离 E2E 通过；测试后已删除容器。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次均退出码 0；BrowserToolbox、Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `14e12d3c1a46988b9b960fc61ac8607aa718163b9cf522f87b2cff7adde11b59`、
  `4856c0542c88b569547cc68ebdddabc26d12602c9910a4eb4d65f77d124d7344`、
  `e9d88f5807824bc8c1f8ff1b7d853e8262761ca480ab8663017ae3578f9e0976`、
  `32e5b93c453cb5059ccaa8df6832ea9e95b45f39624d79632674723fc0b6de16`。
git diff --check
  退出码 0。
```

- 外部状态清理：临时 Debian 容器已删除；Windows 隔离 VM 保持停止状态；未留下本轮测试进程、测试
  profile、测试密钥或监听服务。
- 风险与边界：本轮结果仍是自动化隔离证据，不替代 Windows/Edge 当前
  checkout、Chrome/Edge/Windows/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新；相关功能矩阵继续保持 `IN_PROGRESS`，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：代码层的 Browser Toolbox 新增文案已统一进入
  i18n；剩余工作是取得真实人工验收环境后按发布检查表完成外部门禁，不把自动化结果升级为人工验收。
- 对应提交：无。

## 2026-08-26 / 设置搜索可扩展性与跨页面保存保护 / E-065

- 授权边界：本轮只优化已有设置页导航和保存协调器，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构与用户体验：`pages/settings_sections.js` 为每个二级分区登记本地化
  `searchKeys`，`pages/settings_navigation.js`
  从分区注册表构建稳定搜索索引；设置搜索现在可以通过“激活距离”等具体字段定位分区，同时不会把用户当前输入、规则内容或长说明文案污染搜索结果。`pages/mouse_options.js`
  在保存前主动重读 Vimium 与 BrowserToolbox 两个存储域，再由提交协调器执行冲突保护，避免异步
  `storage.onChanged` 通知尚未到达时用旧内存快照覆盖其他页面/设备刚修改的无关 Vimium 字段。
- 回归覆盖：单元测试增加字段标签搜索；macOS Chrome Stable 完整隔离 E2E 增加中英文字段搜索和外部修改
  `scrollStepSize` 后保存 BrowserToolbox 设置的保护断言，确认外部值保持为 `123`。本轮没有扩大 Phase
  范围，也没有改变旧名称兼容层、站点规则或导入格式。
- Windows 环境核对：`OpenKeyMouse-Windows-Isolated` 可启动且 Guest Tools、Chrome/Edge
  安装状态可见，但其只读光盘仍是 8 月 24 日旧源码 ISO，不是当前 checkout；本轮没有改写 VM
  配置或外部路径，没有把旧 ISO 运行结果写成当前 Windows 证据，核对后已停止 VM。
- 本轮实际自动门禁：

```text
deno fmt --check pages/settings_sections.js pages/settings_navigation.js pages/mouse_options.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/settings_navigation_test.js
  退出码 0；5 个文件格式检查通过。
deno check pages/settings_sections.js pages/settings_navigation.js pages/mouse_options.js scripts/e2e_browser_toolbox.js
  退出码 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 121/121。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 366/366、DOM 109/109，总计 475/475。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；当前 BrowserToolbox、Chrome、Firefox、Canary 归档可用且无需额外更新。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档完整隔离 E2E 通过字段搜索、设置保存、导入/导出迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；临时 Debian amd64 Chromium 151.0.7922.169 当前归档完整隔离 E2E 通过同一套字段搜索、设置保存、迁移、网站规则、核心输入、跨 frame、fixtures 和 Service Worker 重启路径；测试后已删除容器。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次均退出码 0；BrowserToolbox、Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `0e0fb654cf7751e55a912862af305f31279c5d73ad69ea248d9e5a480044bd48`、
  `f38e0fa33d117bbe9ce0cbcecca33e7241f14f62cc888bb897e85a06354d6524`、
  `665f077f05cec16bb0e5b624687783669cd3ee33591abd3d59a21a1f068c867f`、
  `080b894382913e5bb97f52b80c50054628fff97894f68a56443c9ceff7c752bd`。
git diff --check
  退出码 0。
```

- 风险与边界：本轮重新验证了 macOS Chrome Stable 和临时 Debian amd64 Chromium
  隔离自动化；Windows/Edge 当前
  checkout、人工平台矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium
  手工回归和生产签名/真实用户 profile 的旧 CRX 更新仍未完成，不以前次平台证据替代。项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在取得可操作的真实平台与辅助技术环境后，按发布检查表完成剩余人工门禁；代码层继续保持当前注册表、冲突停止和本地化边界。
- 对应提交：无。

## 2026-08-26 / 导入焦点竞态保护与最终隔离回归 / E-064

- 授权边界：本轮只收口已有导入焦点恢复的竞态，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 用户体验：导入完成后只在焦点仍由导入流程持有时恢复文件控件焦点；如果用户已主动移到其他控件，异步补偿任务不会抢回焦点。这样同时覆盖原生
  `<dialog>` 的关闭回退和用户后续操作。
- 本轮实际自动门禁：

```text
deno fmt --check pages/mouse_options.js scripts/e2e_browser_toolbox.js pages/settings_navigation.js tests/unit_tests/browser_toolbox/settings_navigation_test.js
deno check pages/mouse_options.js scripts/e2e_browser_toolbox.js pages/settings_navigation.js tests/unit_tests/browser_toolbox/settings_navigation_test.js
  退出码均为 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 120/120。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 365/365、DOM 109/109，总计 474/474。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；归档已更新到当前代码。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次最新运行退出码均为 0；BrowserToolbox SHA-256 为
  `2a161b8cc36dfbe7bf6572439aa59f759f94541b2fbc2f946fa127fb9cfc0f39`；当前 Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `6715c3623d497417df7c0ae7e1debc71c26b913538c63261118c58d09477496a`、
  `d6bfe63b97b9019a9476e7d946c3a244f625b7601ea1bc70ca6fed9feef50a97`、
  `a6dd084b300bd97ebbc7b11bad22eb082215a2c19f11f4940424b7a100e8d086`。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档完整 E2E 通过。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；宿主 arm64 上临时 Debian amd64 Chromium 151.0.7922.169 当前归档完整 E2E 通过。
git diff --check
  退出码 0。
```

- 验证过程中的测试修正：焦点恢复先修正了隐藏备份面板测试前置条件，再增加了用户已移动焦点时不抢焦点的保护；最终
  macOS/Linux E2E 均退出码 0，没有放宽产品断言。
- 外部状态清理：Linux 隔离 E2E 使用的 `browser-toolbox-linux-debug`
  临时容器已删除；未留下临时监听端口、测试 profile 或临时审计文件。
- 风险与未验证：本轮结果仍是自动化隔离证据，不替代 Windows、Edge、macOS、Linux Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新；`O-005` 及相关功能矩阵继续保持 `IN_PROGRESS`，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：代码层当前设置搜索、多级导航键盘焦点和导入对话框焦点竞态已收口；待取得可操作的真实环境后完成人工、辅助技术、生产
  CRX 和平台门禁；不把本轮自动化结果升级为人工验收。
- 对应提交：无。

## 2026-08-26 / 导入预览焦点恢复与搜索导航语义收口 / E-063

- 授权边界：本轮只收口已有设置页的无障碍焦点与语义，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构与用户体验：`requestImportConfirmation()` 保存导入入口焦点，使用 settled guard
  清理确认、取消、原生 `cancel` 和外部 `close`
  事件；导入业务锁解除后用稳定的文件控件引用恢复焦点，并在下一任务队列再确认一次，以覆盖原生
  `<dialog>` 的焦点回退。设置搜索输入新增
  `aria-controls`/`aria-describedby`，明确关联多级导航和结果播报。
- 回归覆盖：E2E 在真实可见的“备份与恢复”二级页面中断言取消导入后焦点回到 `#import-settings`；上传
  helper 仅在显式 `checkFocus`
  场景验证焦点，兼容迁移场景仍可从其他面板触发，不把隐藏面板脚本上传误当成用户路径。
- 本轮实际自动门禁：

```text
deno fmt --check pages/mouse_options.js scripts/e2e_browser_toolbox.js pages/settings_navigation.js tests/unit_tests/browser_toolbox/settings_navigation_test.js
deno check pages/mouse_options.js scripts/e2e_browser_toolbox.js pages/settings_navigation.js tests/unit_tests/browser_toolbox/settings_navigation_test.js
  退出码均为 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 120/120。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 365/365、DOM 109/109，总计 474/474。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；归档已更新或确认与当前代码一致。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次最新运行退出码均为 0；BrowserToolbox SHA-256 为
  `58dff830db544a5dc02e9b271e0b2e9c29629e6959f58c4ff6a4ede79e1728f2`；当前 Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `3498ba8c17407d381facefaa1b27d161a163290ce672a24a99e7dc5ca816a5b0`、
  `b9c8c17a92d67256712c72fdc4d267ecdc5b2814ecabd29f88725d6c0bde101f`、
  `37482777573220d3268fa26cd5aac2d0f92d6345591cebb2c953eec449dd4725`。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档完整 E2E 通过，包含导入取消焦点和搜索导航关联。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；宿主 arm64 上临时 Debian amd64 Chromium 151.0.7922.169 当前归档完整 E2E 通过。
git diff --check
  退出码 0。
```

- 验证过程中的测试修正：第一次焦点断言从鼠标面板触发，暴露了测试通过脚本给隐藏备份面板上传文件的前置条件错误；已改为先打开备份页面，仅对可见用户路径断言焦点。期间保留了失败时的活动元素、disabled、inert、aria-busy
  和错误状态诊断，最终当前 macOS/Linux E2E 均退出码 0；没有放宽产品断言。
- 外部状态清理：Linux 隔离 E2E 使用的 `browser-toolbox-linux-debug`
  临时容器已删除；未留下临时监听端口、测试 profile 或临时审计文件。
- 风险与未验证：本轮结果仍是自动化隔离证据，不替代 Windows、Edge、macOS、Linux Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新；`O-005` 及相关功能矩阵继续保持 `IN_PROGRESS`，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：代码层当前设置搜索、多级导航键盘焦点和导入对话框焦点闭环已完成；待取得可操作的真实环境后完成人工、辅助技术、生产
  CRX 和平台门禁；不把本轮自动化结果升级为人工验收。
- 对应提交：无。

## 2026-08-26 / 多级导航焦点分层与跨分类键盘展开 / E-062

- 授权边界：本轮只收口已有多级设置导航的键盘焦点语义，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构与用户体验：`pages/settings_navigation.js`
  将“搜索后仍匹配的按钮”和“当前展开子导航中可直接停靠的按钮”分成 `visibleButtons()` 与
  `focusableButtons()`；搜索、分类隐藏和 roving `tabindex`
  只使用当前可聚焦集合，Home/End/方向键仍可跨一级分类，`activate()`
  会先展开目标分类再把焦点移入，避免键盘用户落到折叠内容中。
- 回归覆盖：扩展
  `tests/unit_tests/browser_toolbox/settings_navigation_test.js`，验证清空搜索后的焦点停靠、跨分类方向键移动和目标子导航自动展开；既有设置搜索、Esc
  清空、标题国际化和完整 BrowserToolbox E2E 路径保持通过。
- 本轮实际自动门禁：

```text
deno fmt --check pages/settings_navigation.js tests/unit_tests/browser_toolbox/settings_navigation_test.js
deno check pages/settings_navigation.js tests/unit_tests/browser_toolbox/settings_navigation_test.js
  退出码均为 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 120/120。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 365/365、DOM 109/109，总计 474/474。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；BrowserToolbox、Chrome、Firefox、Canary 归档均更新到当前代码。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  连续两次最新运行退出码均为 0；BrowserToolbox SHA-256 为
  `74530d69a2e77f75db2f5ddb1c298de6458f9bb7a3238de373d8522a2a5dfac9`；当前 Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `bd3eff9960523a9fcef4ff597c9c2dd42c4b52e401682cd820bdb5288cbfbf5d`、
  `07bcefb146444346e5846ddf81871f2e324e91e6090c092d5aa0571fd67b66a7`、
  `8750d88b6c63a06b80be8792e28248b90d2cd300e7c83e9e8f1fd18b1139f521`。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档完整 E2E 通过。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；宿主 arm64 上临时 Debian amd64 Chromium 151.0.7922.169 当前归档完整 E2E 通过。
git diff --check
  退出码 0。
```

- 验证过程中的测试修正：初次新增单元测试使用了项目未提供的 `assert.isAbove` 和 Deno 全局不存在的
  `KeyboardEvent`，已改为现有布尔断言与 jsdom 窗口构造器；一次只加载旧归档的 macOS E2E
  在导航行为调整期间超时，修正为“跨分类时由 `activate()` 自动展开”后从重新打包的当前归档重跑并退出码
  0。上述修正没有放宽产品断言。
- 外部状态清理：Linux 隔离 E2E 使用的 `browser-toolbox-linux-debug`
  临时容器已删除；未留下临时监听端口、测试 profile 或临时审计文件。
- 风险与未验证：本轮结果仍是自动化隔离证据，不替代 Windows、Edge、macOS、Linux Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新；`O-005` 及相关功能矩阵继续保持 `IN_PROGRESS`，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：代码层当前多级导航的搜索、国际化和键盘焦点收口已完成；待取得可操作的真实环境后完成人工、辅助技术、生产
  CRX 和平台门禁；不把本轮自动化结果升级为人工验收。
- 对应提交：无。

## 2026-08-26 / 设置分区搜索与产品页标题国际化 / E-061

- 授权边界：本轮只优化已有设置页导航的可扩展性和 Browser Toolbox
  新页面的标题国际化，不增加产品模块、权限、依赖、网络行为或存储格式；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 用户体验与架构：`pages/settings_navigation.js` 在既有分区注册表之上新增本地
  `filter()`，按当前本地化后的一级分类/二级分区名称筛选，自动隐藏无匹配分类并展开匹配分类；筛选期间
  Home/End、方向键和 Tab 停靠点只考虑可见结果，Esc
  清空搜索后恢复全部分区和当前焦点停靠点。设置页新增可访问的“搜索设置”输入框和结果状态，不改变配置保存、迁移或运行时命令链路。
- 国际化：`pages/mouse_options.html`、`pages/onboarding.html` 和 `pages/privacy.html` 的标题改为走
  `BrowserToolboxI18n`；新增设置搜索和隐私标题的中英文消息，locale JSON 与内置 fallback 保持同键。
- 测试覆盖：新增
  `tests/unit_tests/browser_toolbox/settings_navigation_test.js`，覆盖英文分类/分区过滤、清空后恢复焦点停靠点、中文分区搜索和标题本地化；E2E
  覆盖搜索结果、可访问状态、Esc 清空和窄视口/低动效既有路径。
- 本轮实际自动门禁：

```text
deno fmt --check pages/settings_navigation.js pages/mouse_options.js tests/unit_tests/browser_toolbox/settings_navigation_test.js lib/i18n.js scripts/e2e_browser_toolbox.js
deno check pages/settings_navigation.js pages/mouse_options.js tests/unit_tests/browser_toolbox/settings_navigation_test.js lib/i18n.js scripts/e2e_browser_toolbox.js
  退出码均为 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 119/119。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 364/364、DOM 109/109，总计 473/473。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；BrowserToolbox、Chrome、Firefox、Canary 归档均更新到当前代码。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次退出码均为 0；BrowserToolbox、Chrome、Firefox、Canary 归档 SHA-256 分别为
  `4ff113341c801917215391ede03de058c7bdd446fc91cc7c5483e1843b398093`、
  `ff7bae3401955da6b99a4eb656f2060446c73e617a0bea460f54cae995186e23`、
  `6b918bbf93cf443f3f4a5e16b94ffba0ecedaafa9d641db6ba2d3c929b85c355`、
  `b51a656cdc6bdefaed42ba128d0034ed55fad281694acdfee7a884fba25d38e8`。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 通过设置分区搜索、标题本地化、设置保存、导入/导出迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；宿主 arm64 上临时 Debian amd64 Chromium 151.0.7922.169 当前 checkout 完整 E2E 通过。
git diff --check
  退出码 0。
```

- 验证过程中的测试修正：第一次 E2E 在重新打包前加载了旧 `dist`，因而找不到新搜索框；重新执行
  `./make.js package` 后，宿主中文界面暴露了测试只接受英文标题的问题，随后又修正了 E2E
  数组严格引用比较。以上均为测试准备/断言问题，最终两种浏览器隔离 E2E 均重新从当前归档通过。
- 外部状态清理：已停止并删除 `browser-toolbox-linux-debug` 临时容器，未留下临时监听端口、测试
  profile 或临时审计文件；Windows VM 仍因 Sysprep/OOBE 不可操作，未写成当前 Windows 验证通过。
- 风险与未验证：本轮结果仍是自动化隔离证据，不替代 Windows、Edge、macOS、Linux Chrome Stable
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归或生产签名/真实用户
  profile 的旧 CRX 更新；`O-005` 及相关功能矩阵继续保持 `IN_PROGRESS`，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：代码层先保持当前设置导航和国际化改进，待取得可操作的真实环境后完成人工、辅助技术、生产 CRX
  和平台门禁；不把本轮自动化结果升级为人工验收。
- 对应提交：无。

## 2026-08-26 / 同 ID 外部 CRX 安装与升级语义隔离验证 / E-060

- 授权边界：本轮只验证旧归档与当前归档在 Chrome 外部扩展机制下的同 ID
  安装/升级语义，不改变运行时代码、版本策略、权限、依赖或网络行为；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 测试材料：从 `dist/open-key-mouse-0.1.0.zip` 和 `dist/browser-toolbox-0.1.0.zip`
  分别解包出旧/当前目录；仅在 `/tmp` 生成临时 RSA 测试密钥，并把当前测试目录的 manifest 版本临时改为
  `0.1.1`。两个 CRX 使用同一临时密钥打包，得到相同扩展 ID
  `dohfifllaefpfoenfjpnelagejeniaaj`；测试密钥、CRX、profile 和容器均未进入仓库。
- 安装与升级结果：Debian amd64 Chromium `151.0.7922.169` 隔离容器先通过 Linux 外部扩展 JSON 安装旧
  CRX，profile 活动目录为 `0.1.0_0`；将外部 JSON 切换为当前测试 CRX 和 `external_version: 0.1.1`
  后，通过 `chrome://extensions` 的 Update 控件触发检查，profile 活动目录变为 `0.1.1_0`，Service
  Worker 仍为同一扩展 ID。旧/当前测试 CRX SHA-256 分别为
  `6dbff9e7ecc05e70e706e7f7c88225d0deae42645b7140662d0dd37608c3a609`、`131270699acd4d4ffca56fd962d1afb4d3fd44c480502228c39a463f2056e16b`。
- 本轮实际命令与结果：

```text
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --pack-extension=/tmp/browser-toolbox-crx-update.Oc4Mnq/old --pack-extension-key=/tmp/browser-toolbox-crx-update.Oc4Mnq/test.pem
/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --pack-extension=/tmp/browser-toolbox-crx-update.Oc4Mnq/current --pack-extension-key=/tmp/browser-toolbox-crx-update.Oc4Mnq/test.pem
  两次退出码均为 0；同一测试公钥对应扩展 ID dohfifllaefpfoenfjpnelagejeniaaj。
docker exec browser-toolbox-crx-linux deno eval 'const r = await fetch("http://127.0.0.1:9451/json/list"); console.log(await r.text());'
docker exec browser-toolbox-crx-linux deno eval 'const value = JSON.parse(await Deno.readTextFile("/crx/profile-installed/Default/Preferences")); const setting = value.extensions.settings.dohfifllaefpfoenfjpnelagejeniaaj; console.log(JSON.stringify({ path: setting.path, version: setting.manifest.version }, null, 2));'
  读取到同一扩展 ID 的 Service Worker target；旧 CRX 安装后 profile 活动版本为 0.1.0。
通过一次性 Deno CDP 脚本打开 chrome://extensions，查找 id=updateNow 的 Update 控件并 click；随后重复读取 profile Preferences。
  读取到活动路径 dohfifllaefpfoenfjpnelagejeniaaj/0.1.1_0，Service Worker target 的扩展 ID 保持不变；相关命令退出码均为 0。
  临时 Chromium、容器、测试密钥和 profile 已清理。
```

- 证据边界：这是使用临时测试密钥、临时测试版本和自动化扩展管理页的隔离语义验证，不是生产签名
  CRX、真实旧用户 profile、商店更新通道或人工安装更新验收；因此 `O-005` 仍保持
  `IN_PROGRESS`，项目仍暂不发布。Windows/Edge/macOS/Linux
  人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点和完整 Vimium 手工回归也未被本轮结果覆盖。
- 文档追加后的本地复核：`git diff --check` 退出码 0；`deno test -A tests/browser_toolbox/` 为
  shoulda
  `115/115`；`PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test`
  为单元 `360/360`、DOM `109/109`，总计 `469/469`。本轮没有运行时代码变更。
- 当前状态：本轮没有运行时代码修改；HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：保留当前自动化回归结果，待取得合规的生产签名旧 CRX/真实迁移 profile
  和可操作的人工验收环境后，再按发布检查表补做生产更新与平台/辅助技术门禁；在此前不将隔离升级实验写成发布完成。
- 对应提交：无。

## 2026-08-26 / 设置同步配额 UTF-8 字节修正与当前归档回归 / E-059

- 授权边界：本轮只修正现有设置存储层的安全大小计算，不增加产品模块、权限、依赖或网络行为；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 代码修正：`background_scripts/browser_toolbox/settings_storage.js` 的 `serializedSize` 改为对 JSON
  序列化结果使用 `TextEncoder` 计算 UTF-8 字节数，并对 `JSON.stringify` 返回 `undefined`
  的值安全返回 0；中文、表情和其他非 ASCII 设置不再按 JavaScript 字符数低估 `chrome.storage.sync`
  的安全预算。
- 回归覆盖：新增 storage 单元测试验证 ASCII 字节数、中文 UTF-8 字节数和 40,000 个中文字符会超过 100
  KiB 安全预算。第一次新增断言错误地忽略了 JSON 字符串的双引号，shoulda 出现
  `114/115`；修正断言为序列化后的 3/5 字节后重新执行，失败属于测试断言问题，不是产品实现通过。
- 本轮实际自动门禁：

```text
deno fmt --check background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js
deno check background_scripts/browser_toolbox/settings_storage.js tests/unit_tests/browser_toolbox/settings_storage_test.js
  退出码均为 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 115/115。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 360/360、DOM 109/109，总计 469/469。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；三个浏览器归档更新了 settings_storage.js。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 完整隔离 E2E 通过。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；宿主 arm64 上临时 Debian amd64 Chromium 151.0.7922.169 当前 checkout 完整隔离 E2E 通过。
deno run -A scripts/build_release.js --package
  连续执行两次均退出码 0；最终 BrowserToolbox、Chrome、Firefox、Chrome Canary 归档 SHA-256 分别为
  `e60f0e07bcc329cea28f942288278b323104964b7ef7f10147366d431b818748`、
  `ff7bae3401955da6b99a4eb656f2060446c73e617a0bea460f54cae995186e23`、
  `6b918bbf93cf443f3f4a5e16b94ffba0ecedaafa9d641db6ba2d3c929b85c355`、
  `b51a656cdc6bdefaed42ba128d0034ed55fad281694acdfee7a884fba25d38e8`。
git diff --check
  退出码 0。
```

- 外部状态清理：已停止并删除 `browser-toolbox-linux-debug`
  临时容器，未留下本轮测试进程或监听端口；Windows VM 仍因 Sysprep/OOBE
  对话框不可操作，已停止，不把它写成当前验证通过。
- 风险与未验证：本轮 macOS/Linux 结果仍是隔离自动化，不是 Chrome、Edge、Windows、macOS、Linux
  人工矩阵；屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和真实旧 CRX 同 ID
  安装更新仍未完成，项目暂不发布。
- 当前状态：HEAD 仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；没有创建提交或推送。
- 下一步：继续寻找可操作的真实迁移前安装环境和人工/辅助技术环境；代码层保留当前配额修正，不扩大
  Phase 范围。
- 对应提交：无。

## 2026-08-26 / 高冲突站点默认规则与当前目录最终回归 / E-058

- 授权边界：本轮继续收口现有站点规则、旧版设置升级和当前 checkout 的自动验收，不增加 Phase
  之外的产品功能、权限、依赖或网络行为；没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 默认规则与用户体验：`lib/browser_toolbox/settings_schema.js` 新增可编辑的高冲突站点默认规则，覆盖
  `https://docs.google.com/*`、`https://*.notion.so/*`、`https://stackblitz.com/*`、`https://codesandbox.io/*`
  和 `https://codepen.io/*`。这些规则默认只停用
  `mouse`、`superDrag`、`wheel`、`rocker`、`cursor`，键盘模块仍保持可用；设置页以中英文本地化文案解释“内置规则可编辑/删除”，E2E
  已确认删除 Google Docs 内置规则并保存后不再恢复。既有 Glob/正则网站规则能力和模块级配置保持不变。
- 并发保护复核：E2E 在设置闭环中发现，前置场景通过另一页面直接写入 storage
  后，原设置页草稿会被冲突保护正确拒绝；这是产品的预期安全行为，不是保存逻辑失败。修正
  `scripts/e2e_browser_toolbox.js` 在这些外部 fixture
  写入后重新加载设置页，再继续编辑，保留冲突停止语义，没有放宽或绕过产品保护。
- 网络审计说明：新增默认 URL 只是 `settings_schema.js`
  中的配置数据字面量；`scripts/audit_network_usage.js` 仅对这五个精确文件/文本做窄 allowlist，后台
  `fetch`、XHR、WebSocket、远程脚本和隐式网络检查仍保持原有范围并通过。
- 本轮实际自动门禁：

```text
deno fmt --check（本轮运行时、设置页、E2E、审计和测试相关 22 个文件）
deno check（本轮运行时、设置页、E2E、审计和测试相关 JavaScript 文件）
  两条命令退出码均为 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 114/114。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 359/359、DOM 109/109，总计 468/468。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；当前 BrowserToolbox、Chrome、Firefox、Canary 归档均为最新。
deno run -A scripts/build_release.js --package
  连续执行两次均退出码 0；最终 BrowserToolbox、Chrome、Firefox、Canary 归档 SHA-256 分别为
  `61a34a016d726b8ebbd6b85865c9fa8f33ad29a8f1283aecf133e24eaee90f34`、
  `ff7bae3401955da6b99a4eb656f2060446c73e617a0bea460f54cae995186e23`、
  `6b918bbf93cf443f3f4a5e16b94ffba0ecedaafa9d641db6ba2d3c929b85c355`、
  `b51a656cdc6bdefaed42ba128d0034ed55fad281694acdfee7a884fba25d38e8`。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 隔离 E2E 通过默认规则删除、设置保存、规范/旧版导入导出、旧存储键与指针资源迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；宿主 arm64 上临时 Debian amd64 容器内的 Chromium 151.0.7922.169 当前 checkout 隔离 E2E 通过同一套路径。
git diff --check
  退出码 0。
```

- E-023 边界：E-023 原记录仍然只表示物理目录从 `open-key-mouse` 移到
  `browser-toolbox`，目录移动当时没有重新运行完整测试；本轮是在已经重命名后的
  `/Users/yang/project/plugin/browser-toolbox` current checkout 重新执行了上述测试，属于 E-058
  当前证据，不回溯改写 E-023 的验收事实。
- 外部状态清理：已停止并删除 `browser-toolbox-linux-debug`
  临时容器，未留下本轮测试进程或监听端口；工作区仍保留用户已有未提交修改。
- 风险与未验证：macOS Chrome Stable 与 Debian amd64 Chromium 结果是当前 checkout
  的隔离自动化证据，不是 Chrome、Edge、Windows、macOS、Linux 人工矩阵；Windows Chrome/Edge
  本轮未重跑。屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和真实旧 CRX 同 ID
  安装更新仍未完成，项目暂不发布。
- 当前状态：HEAD 仍为 `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；没有创建提交或推送。
- 下一步：在可操作的 Windows/浏览器环境中完成旧 CRX 同 ID
  安装更新、屏幕阅读器和人工平台矩阵；在这些证据产生前不把自动化结果写成人工验收，也不发布。
- 对应提交：无。

## 2026-08-26 / 设置策略与存储分层、旧版导出升级回归 / E-057

- 授权边界：本轮只收敛现有设置系统的代码分层和旧版配置升级验收，不增加产品模块、权限、依赖或网络行为；使用临时
  macOS/Linux 浏览器 profile 和临时 Debian amd64 Docker
  环境，没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构与行为：新增 `lib/browser_toolbox/settings_policy.js`，集中处理会话覆盖校验、站点规则/Vimium
  排除规则/全局开关的有效模块合成；新增
  `background_scripts/browser_toolbox/settings_storage.js`，集中处理规范存储键、旧存储键只读兼容、迁移备份、回滚、会话存储和
  sync 安全大小限制。`settings_repository.js`
  现在负责编排迁移、校验、存储和事件，不再重复实现有效策略与存储键细节。
- 旧版升级收敛：`settings_migrations.js` 新增导出 payload 构造、解析和迁移入口；规范导出格式与
  `open-key-mouse-settings` 兼容格式都可读取，缺省历史 `formatVersion` 仍按 1
  处理，未知未来版本和非法 settings 结构会在写入前拒绝。设置页改用该入口，旧
  schema、旧命令命名空间、旧存储键、旧 session 键和旧指针资源的兼容路径保持不变；新写入仍只使用
  `BrowserToolbox` 键和命名空间。
- 本轮新增单测：策略层优先级、会话覆盖边界、存储键优先级/回滚/备份隔离/sync
  大小限制、规范和旧版导出包装解析；原有仓库迁移测试继续覆盖迁移失败时恢复原始值。
- 本轮实际自动门禁：

```text
deno fmt lib/browser_toolbox/settings_policy.js background_scripts/browser_toolbox/settings_storage.js background_scripts/browser_toolbox/settings_repository.js background_scripts/browser_toolbox/settings_migrations.js pages/mouse_options.js tests/unit_tests/browser_toolbox/settings_policy_test.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_migrations_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
  退出码 0；目标文件格式检查通过。
deno check lib/browser_toolbox/settings_policy.js background_scripts/browser_toolbox/settings_storage.js background_scripts/browser_toolbox/settings_repository.js background_scripts/browser_toolbox/settings_migrations.js pages/mouse_options.js tests/unit_tests/browser_toolbox/settings_policy_test.js tests/unit_tests/browser_toolbox/settings_storage_test.js tests/unit_tests/browser_toolbox/settings_migrations_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
  退出码 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 113/113。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 358/358、DOM 109/109，总计 467/467。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 31 个新增模块，通过。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档包含 settings_policy.js 和 settings_storage.js 及其加载入口。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次退出码均为 0；BrowserToolbox、Chrome、Firefox、Canary 归档 SHA-256 分别为 `b7a321bcd0cc15f2dbeeb90b0fa4679f9d9c943d9f890d594c3aa8f5b472acf5`、`397edb87aa7a07b7d0e583336c71fce01dca28d6399877e9e65d93bd5d126186`、`fabb4e699c0469f6a08865b9ece3c42a693159bd8a3c5f999181a169d6cff0c6`、`4a78aa6fd11afc741086792be73c0177f95c538572a16b95e1cfdf211d97b609`。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前 checkout 通过设置保存、规范/旧版导入导出、旧存储键与指针资源迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
docker exec -e HOME=/tmp/deno-home -e DENO_DIR=/tmp/deno-cache -e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium -w /work browser-toolbox-linux-debug deno run --allow-all scripts/e2e_browser_toolbox.js
  退出码 0；Debian amd64 Chromium 151.0.7922.169 当前 checkout 通过同一套完整 BrowserToolbox E2E。
git diff --check
  退出码 0。
```

- 外部状态清理：已停止并删除 `browser-toolbox-linux-debug` 临时容器；未留下本轮测试进程或监听端口。
- 风险与边界：macOS Chrome Stable 和 Debian amd64 Chromium 结果是当前 checkout
  的隔离自动化证据，不是 Chrome、Edge、Windows、macOS、Linux 人工矩阵；Windows Chrome/Edge
  本轮未重跑，E-056 的 Sysprep/OOBE 环境阻塞仍是最后一次 Windows
  当前证据边界。屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和真实旧 CRX
  安装更新仍未完成，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在可操作的 Windows 隔离环境中重跑当前 checkout 的 Chrome/Edge E2E；之后完成真实旧 CRX 同
  ID 更新、屏幕阅读器和人工平台矩阵门禁。代码层不再扩大 Phase 范围，除非验收暴露真实缺陷。
- 对应提交：无。

## 2026-08-26 / 共享配置值工具收敛与可用运行时回归 / E-056

- 授权边界：本轮只抽取现有配置值的防御性克隆和有界深比较，不增加产品模块、权限、依赖或网络行为；使用临时
  macOS/Linux 浏览器 profile、临时归档服务和隔离 Docker/Parallels
  环境完成当前归档复验，没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构与行为：新增 `lib/browser_toolbox/value_utils.js`，集中提供 `clone`、`equalValues` 和
  `MAX_COMPARISON_NODES`。设置
  schema、命令协议、站点规则编辑器、设置草稿、提交协调器和设置仓库复用同一实现；草稿/提交协调器继续导出原有
  API 名称作为兼容别名。深比较仍支持循环引用并限制为 10,000
  个节点，配置仓库因此不会因异常深度数据无限递归；设置变更摘要仍保留普通对象专用校验，不放宽导入数据边界。所有运行时入口和测试入口均补齐共享脚本加载顺序，旧
  OpenKeyMouse 名称没有新增写入或运行时标识。
- 本轮实际自动门禁：

```text
deno fmt lib/browser_toolbox/value_utils.js lib/browser_toolbox/settings_schema.js lib/browser_toolbox/command_invocation.js pages/settings_draft.js pages/settings_commit_coordinator.js pages/site_rules_editor.js background_scripts/browser_toolbox/settings_repository.js background_scripts/main.js pages/action.js pages/tab_list.js scripts/audit_permissions.js tests/dom_tests/dom_tests.html tests/unit_tests/browser_toolbox/value_utils_test.js tests/unit_tests/browser_toolbox/browser_command_adapter_test.js tests/unit_tests/browser_toolbox/command_dispatcher_test.js tests/unit_tests/browser_toolbox/command_invocation_test.js tests/unit_tests/browser_toolbox/drag_context_classifier_test.js tests/unit_tests/browser_toolbox/message_protocol_test.js tests/unit_tests/browser_toolbox/settings_commit_coordinator_test.js tests/unit_tests/browser_toolbox/settings_draft_test.js tests/unit_tests/browser_toolbox/settings_migrations_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/site_rule_matcher_test.js tests/unit_tests/browser_toolbox/super_drag_controller_test.js
  退出码 0；25 个文件格式检查通过。
deno check lib/browser_toolbox/value_utils.js lib/browser_toolbox/settings_schema.js lib/browser_toolbox/command_invocation.js pages/settings_draft.js pages/settings_commit_coordinator.js pages/site_rules_editor.js background_scripts/browser_toolbox/settings_repository.js
deno check tests/unit_tests/browser_toolbox/value_utils_test.js tests/unit_tests/browser_toolbox/settings_draft_test.js tests/unit_tests/browser_toolbox/settings_commit_coordinator_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js
  两条命令均退出码 0。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 105/105。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 350/350、DOM 109/109，总计 459/459。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 29 个新增模块，通过。
./make.js package
  退出码 0；归档包含共享值工具及其加载入口。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次退出码均为 0；当前 BrowserToolbox、Chrome、Firefox、Canary 归档 SHA-256 分别为 `d2af6f254e10cd7cb818e7b04c32ff8f0806c77644f6583fe942004bb3f259fb`、`a40a273388543008ab5d81cd8718e2c991c2341d4b60f3495d8377ecd74dbed1`、`03028a6a937c3278bbad9a335fd6d45664e85a66cacd253c2bb688e80d341535`、`75132d62d4228f3271db6402948a998ee5a4092b4cedf114e5c5981205fb83ef`。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档通过标签页列表、设置保存、导入/导出迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
docker exec -w /work browser-toolbox-linux-debug sh -lc 'export HOME=/tmp/deno-home DENO_DIR=/tmp/deno-cache PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium; deno run --allow-all scripts/e2e_browser_toolbox.js'
  退出码 0；Debian amd64 Chromium 151.0.7922.169 当前归档通过同一套完整 BrowserToolbox E2E。
git diff --check
  退出码 0。
```

- Windows 隔离环境结果：启动 `OpenKeyMouse-Windows-Isolated`
  后，`prlctl exec OpenKeyMouse-Windows-Isolated --current-user -- cmd.exe /c ver` 退出码 2
  且无输出，`10.211.55.4` 的
  CDP/远程端口连接超时；`prlctl capture OpenKeyMouse-Windows-Isolated --file /tmp/browser-toolbox-windows-vm.png`
  显示来宾停在 Sysprep/OOBE
  对话框。宿主机辅助功能权限拒绝自动点击，未绕过该状态，也没有执行或声称当前 checkout 的 Windows
  Chrome/Edge E2E 通过。随后已停止并清理明确的 Parallels VM、Docker 容器、归档服务、端口和诊断截图。
- 风险与边界：macOS Chrome Stable 和 Debian amd64 Chromium 结果是当前 checkout
  的自动化证据，不是人工平台矩阵；Windows Chrome、Windows Edge
  本轮未验证，屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归和真实旧 CRX
  安装更新仍未完成。项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：恢复可操作的 Windows 隔离环境后，重跑当前归档的 Windows Chrome/Edge E2E；随后继续旧 CRX
  安装更新、屏幕阅读器和人工平台矩阵门禁。代码层下一轮可在模块注册表和共享值工具基础上拆分设置仓库的迁移、存储和有效策略职责，但不扩展
  Phase 范围。
- 对应提交：无。

## 2026-08-26 / 模块能力注册表收敛与四运行时回归 / E-055

- 授权边界：本轮只收敛现有模块清单的架构来源，不增加产品模块、权限、依赖或网络行为；使用临时
  macOS/Linux/Windows 浏览器 profile、临时归档服务和隔离 Docker/Parallels
  环境完成当前归档自动复验，没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 架构与体验：新增 `lib/browser_toolbox/module_registry.js`，集中描述模块
  ID、设置路径、国际化标签、站点规则能力和会话覆盖能力。设置校验器、站点规则匹配器、设置仓库、规则编辑器、设置页命中解释和
  E2E
  均从注册表派生；未来新增模块不再需要分别修改多份重复清单。`BrowserToolboxModuleRegistry.enabledDefaults()`
  和 `disableAll()` 保持全局开关、站点规则和会话覆盖的既有优先级不变。旧 OpenKeyMouse
  名称仍只存在于兼容迁移、fixture/兼容测试和历史记录中，本轮没有新增旧名称写入。
- 本轮实际自动门禁：

```text
deno fmt lib/browser_toolbox/module_registry.js lib/browser_toolbox/settings_validator.js lib/browser_toolbox/site_rule_matcher.js background_scripts/browser_toolbox/settings_repository.js pages/site_rules_editor.js pages/mouse_options.js pages/action.js pages/tab_list.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/module_registry_test.js tests/unit_tests/browser_toolbox/command_invocation_test.js tests/unit_tests/browser_toolbox/settings_migrations_test.js tests/unit_tests/browser_toolbox/settings_repository_test.js tests/unit_tests/browser_toolbox/settings_validator_test.js tests/unit_tests/browser_toolbox/site_rule_matcher_test.js
deno check lib/browser_toolbox/module_registry.js lib/browser_toolbox/settings_validator.js lib/browser_toolbox/site_rule_matcher.js background_scripts/browser_toolbox/settings_repository.js pages/site_rules_editor.js pages/mouse_options.js pages/action.js pages/tab_list.js scripts/e2e_browser_toolbox.js tests/unit_tests/browser_toolbox/module_registry_test.js
  退出码 0；格式和类型检查通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 347/347、DOM 109/109，总计 456/456。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 102/102。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 28 个新增模块，通过。
./make.js package
  退出码 0；Chrome、Firefox、Canary 归档包含模块注册表及其加载顺序。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档通过标签页列表、设置迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
docker exec -w /work browser-toolbox-linux-debug sh -lc 'export HOME=/tmp/deno-home DENO_DIR=/tmp/deno-cache PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium; deno run --allow-all scripts/e2e_browser_toolbox.js'
  退出码 0；Debian amd64 Chromium 151.0.7922.169 当前归档 E2E 通过。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_ID=dgnlplafmckkmaajhojdjcjkpjghemil BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Windows 11 ARM64 Chrome Stable 151.0.7922.174 当前归档 E2E 通过；远程 CDP 无法代授剪贴板权限，相关断言跳过。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9232 BROWSER_TOOLBOX_E2E_EXTENSION_ID=iclgncogejliopnbeancnlbeojiefcke BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E-Edge\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Windows Edge Stable 151.0.4129.101 当前归档 E2E 通过；远程 CDP 无法代授剪贴板权限，相关断言跳过。
deno run -A scripts/build_release.js --package
deno run -A scripts/build_release.js --package
  两次退出码均为 0；当前 BrowserToolbox、Chrome、Firefox、Canary 归档 SHA-256 分别为 `699a905ec003ad2f4ef88f5979e667905ae06e3179b0372936ace1e9cb244fce`、`2540e10545fc681323979636d746770c03480f42c22c17d87ff2f1dd26cb050d`、`93ab0dcd1c1d6e379a81438ea74640e95eb0c0bd04be77fac715ce0548892811`、`d394ce7e091f1202bfda0f97b7246476e382392ed7b099b210073774c572ab34`。
```

- 中间情况：Windows 临时归档首次下载命令因 shell 变量转义错误写入了明确的
  `C:\current.zip`、`C:\downloads` 和 `C:\extension`，随后已逐项核对并删除，再用正确的
  `C:\BrowserToolboxE2E`/`C:\BrowserToolboxE2E-Edge`
  临时目录重跑；该情况是测试环境命令问题，不计为产品失败。Linux 容器首次准备 Chromium 需要安装
  Debian amd64 Chromium，安装完成后 E2E 退出码为 0。
- 外部状态清理：已停止 Windows Chrome/Edge，删除明确的 `C:\BrowserToolboxE2E` 与
  `C:\BrowserToolboxE2E-Edge`，移除 `9231/9232` portproxy 与防火墙规则，停止 Parallels 隔离
  VM；已停止归档服务并删除 `browser-toolbox-linux-debug`
  临时容器，当前未留下本轮测试进程或监听端口。
- 风险与边界：四个运行时结果均为隔离自动化，不是 Chrome、Edge、Windows、macOS、Linux
  的人工矩阵；屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归、真实旧 CRX
  安装更新语义仍未完成。真实旧 CRX 门禁仍按 E-054 保持未验证，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在用户可操作真实环境后完成旧 CRX
  安装更新、屏幕阅读器和人工平台矩阵；代码层下一轮可在该注册表基础上继续拆分设置仓库的迁移/存储/有效策略职责，但本轮不扩大
  Phase 范围。
- 对应提交：无。

## 2026-08-25 / 迁移前 CRX 同 ID 更新链复核尝试 / E-054

- 授权边界：本轮只在明确的 `/tmp/browser-toolbox-crx.wh0tee` 临时目录中验证迁移前
  `open-key-mouse-0.1.0.zip` 与当前 `browser-toolbox-0.1.0.zip` 的 CRX 打包前提，没有接触日常 Chrome
  profile，没有安装到用户浏览器，没有提交、推送或发布。
- 实际结果：使用临时 PKCS#8 RSA 私钥分别打包旧包和临时版本号为 `0.1.1` 的当前包，Chrome
  打包命令均成功生成 CRX；临时版本号只用于测试 Chrome 的版本递增要求，不是发布产物。Chrome 151 的
  `--install-from-file` 在无头和可见临时 profile 中没有形成已安装扩展；可见 `chrome://extensions`
  页面只显示扩展管理界面，未出现可由 CDP 完成的文件安装控件或 Service Worker 目标，Computer Use
  可访问树在约 90 秒内无返回后停止。因此本轮没有形成“旧 CRX 安装后更新到当前 CRX”的真实同 ID 证据。
- 本轮实际命令与结果：

```text
unzip -q dist/open-key-mouse-0.1.0.zip -d /tmp/browser-toolbox-crx.wh0tee/old
unzip -q dist/browser-toolbox-0.1.0.zip -d /tmp/browser-toolbox-crx.wh0tee/current
openssl genrsa -traditional -out /tmp/browser-toolbox-crx.wh0tee/test.pem 2048
openssl pkcs8 -topk8 -nocrypt -in /tmp/browser-toolbox-crx.wh0tee/test.pem -out /tmp/browser-toolbox-crx.wh0tee/test-pkcs8.pem
  退出码 0；生成临时测试私钥。
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox --no-first-run --user-data-dir=/tmp/browser-toolbox-crx.wh0tee/pack-profile --pack-extension=/tmp/browser-toolbox-crx.wh0tee/old --pack-extension-key=/tmp/browser-toolbox-crx.wh0tee/test-pkcs8.pem
  退出码 0；生成旧 CRX。
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox --no-first-run --user-data-dir=/tmp/browser-toolbox-crx.wh0tee/pack-profile-current --pack-extension=/tmp/browser-toolbox-crx.wh0tee/current --pack-extension-key=/tmp/browser-toolbox-crx.wh0tee/test-pkcs8.pem
  退出码 0；生成临时升版本当前 CRX。
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --no-sandbox --no-first-run --user-data-dir=/tmp/browser-toolbox-crx.wh0tee/install-profile --install-from-file=/tmp/browser-toolbox-crx.wh0tee/old.crx about:blank
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --no-first-run --no-default-browser-check --disable-gpu --user-data-dir=/tmp/browser-toolbox-crx.wh0tee/ui-profile --remote-debugging-port=9333 '--remote-allow-origins=*' --install-from-file=/tmp/browser-toolbox-crx.wh0tee/old.crx
  无头/可见临时 profile 均未形成扩展安装；不计为通过。
Computer Use：读取隔离可见 Chrome 的扩展安装页
  约 90 秒无可访问性树返回后停止；未继续点击或绕过浏览器安装确认。
```

- 外部状态清理：已停止临时 Chrome，删除 `/tmp/browser-toolbox-crx.wh0tee` 及临时日志；未触碰用户
  Chrome、用户 profile 或外部路径。
- 风险与边界：旧导出 JSON、旧存储键、旧命令命名空间和旧指针资源的兼容迁移仍有当前自动 E2E
  证据；真实旧 CRX 安装更新语义仍未验证，不能把同私钥打包成功或兼容 fixture
  当作更新通过。平台人工矩阵、屏幕阅读器、人工高对比度/缩放、认证态站点和完整 Vimium
  手工回归也仍未完成，项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：需要可操作的 Chrome 扩展安装确认界面或真实迁移前 CRX
  安装环境后，再执行旧版本安装、写入旧设置、更新当前 CRX、重启 Service Worker
  和读取迁移结果；在此之前保持该门禁未完成。
- 对应提交：无。

## 2026-08-25 / Edge 用户态隔离启动、扩展页搜索边界与四运行时复验 / E-053

- 授权边界：本轮继续处理当前 Phase 内的标签页搜索平台兼容性，并使用已授权的 Parallels Windows 隔离
  VM、临时 Linux Docker
  浏览器和临时归档服务完成当前归档复验；没有新增产品模块、权限、依赖或网络行为，没有触碰日常浏览器资料、登录态、Cookie、Token
  或个人浏览数据，没有提交、推送、发布或修改外部路径。
- 代码与体验：标签页搜索忽略 `*-extension:` URL 的随机 hostname；当浏览器把扩展 URL 原样返回为
  `tab.title` 时也忽略该伪标题，只保留正常扩展页标题和路径。这样用户搜索标签页时不会被随机扩展
  ID误导，普通网页仍按标题、主机、路径、查询参数和哈希分别模糊匹配。设置页初始化同步、语言读取有界回退和
  E2E 等待逻辑保持不变。
- 中间情况与修正：Edge 使用 `prlctl exec` 默认的 `NT AUTHORITY\\SYSTEM` 启动时立即退出；改用
  `prlctl exec ... --current-user` 后 Edge Stable 151.0.4129.101 稳定监听 CDP。随后 Edge
  首次搜索复验发现扩展 ID和偶发伪标题造成额外命中，补充过滤后，Edge、Windows Chrome、macOS Chrome 和
  Linux Chromium 当前归档均通过。中间失败均保留为环境/真实兼容性发现，不计为通过证据。
- 本轮实际自动门禁：

```text
deno fmt pages/tab_list.js && deno check pages/tab_list.js && git diff --check && ./make.js package
  退出码 0；标签页搜索修正格式、类型检查和归档更新通过。
PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ./make.js test
  退出码 0；单元 345/345、DOM 109/109，总计 454/454。
deno test -A tests/browser_toolbox/
  退出码 0；shoulda 100/100。
deno run -A scripts/audit_permissions.js
  退出码 0；权限审计 9 项通过。
deno run -A scripts/audit_network_usage.js
  退出码 0；网络审计扫描 27 个新增模块，通过。
BROWSER_TOOLBOX_E2E_LOAD_UNPACKED_VIA_CDP=true PUPPETEER_EXECUTABLE_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；macOS Chrome Stable 当前归档通过标签页列表、迁移、网站规则、核心输入、超级拖拽、滚轮/摇杆、跨 frame、fixtures 和 Service Worker 重启。
docker exec -w /work browser-toolbox-linux-debug su deno -s /bin/bash -c 'export HOME=/tmp/deno-home DENO_DIR=/tmp/deno-cache PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium; deno run --allow-all scripts/e2e_browser_toolbox.js'
  退出码 0；Debian amd64 Chromium 151.0.7922.169 当前归档 E2E 通过。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9232 BROWSER_TOOLBOX_E2E_EXTENSION_ID=iclgncogejliopnbeancnlbeojiefcke BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E-Edge\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Windows Edge Stable 151.0.4129.101 当前归档 E2E 通过；远程 CDP 无法代授剪贴板权限，相关断言跳过。
BROWSER_TOOLBOX_E2E_BROWSER_URL=http://10.211.55.4:9231 BROWSER_TOOLBOX_E2E_EXTENSION_ID=dgnlplafmckkmaajhojdjcjkpjghemil BROWSER_TOOLBOX_E2E_FIXTURE_HOST=10.211.55.2 BROWSER_TOOLBOX_E2E_FIXTURE_PORT=59582 BROWSER_TOOLBOX_E2E_REMOTE_DOWNLOAD_PATH='C:\BrowserToolboxE2E\downloads' deno run --allow-read --allow-write --allow-env --allow-net --allow-run --allow-sys scripts/e2e_browser_toolbox.js
  退出码 0；Windows 11 ARM64 Chrome Stable 151.0.7922.174 当前归档 E2E 通过；远程 CDP 无法代授剪贴板权限，相关断言跳过。
deno run -A scripts/build_release.js --package
  连续执行两次退出码 0；当前四个未发布归档 SHA-256 一致，BrowserToolbox、Chrome、Firefox、Canary 分别为 `97e930fbb93bb65634ded9ed7c4b71eed53d776f439e309fbf98b02b0d48a2d0`、`b099eeb0a406c21fa07454c66da260713f2dce4dad3877c8f2d3c0708bdd33d2`、`4cb27b4548fc2ca9bc4b414dae4c16ce8afc44216188112f0e4163e286ecfc8d`、`61376ed450484855127619051368368c6080980592c10a97771c27750e3ad0d5`。
```

- 外部状态清理：已停止 Edge/Chrome 测试进程，删除明确的 `C:\BrowserToolboxE2E` 与
  `C:\BrowserToolboxE2E-Edge` 临时目录，移除 `9231/9232` portproxy 和防火墙规则，停止 Parallels 隔离
  VM；已删除本轮 Linux 临时容器，停止 host 归档/fixture 服务；未留下本轮测试进程。
- 风险与边界：四个运行时结果均为隔离自动化，不是 Chrome、Edge、Windows、macOS、Linux
  的人工矩阵；屏幕阅读器、人工高对比度/缩放、认证态站点、完整 Vimium 手工回归、真实旧 CRX
  安装更新语义仍未完成。项目暂不发布。
- 当前状态：HEAD 仍为
  `bcbab167c7db99c510111c41e60ae11b4fee8ad3`；工作区保留所有未提交修改，没有创建提交或推送。
- 下一步：在用户可操作真实环境后，按发布检查表逐项完成人工平台矩阵、屏幕阅读器/高对比度/缩放、认证态站点和旧
  CRX 安装更新门禁；在此之前不把当前自动化结果升级为人工验收，也不发布。
- 对应提交：无。
