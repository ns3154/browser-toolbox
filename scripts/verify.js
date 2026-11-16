// 所有阶段均实际执行并记录状态；局部检查中的跳过项目不会写成通过。
import * as path from "@std/path";
import { buildArtifacts, commandOutput } from "./release_artifacts.js";
import puppeteer from "npm:puppeteer";
import { prepareLegacyRuntime } from "./legacy_runtime_fixture.js";
import { buildInputCanary } from "./build_runtime_canary.js";

const root = path.dirname(path.dirname(path.fromFileUrl(import.meta.url)));
Deno.chdir(root);
const skipE2e = Deno.args.includes("--skip-e2e");
const reportIndex = Deno.args.indexOf("--report");
if (
  reportIndex >= 0 && (!Deno.args[reportIndex + 1] || Deno.args[reportIndex + 1].startsWith("--"))
) {
  throw new Error("--report 后必须提供 JSON 报告路径");
}
for (let index = 0; index < Deno.args.length; index++) {
  if (Deno.args[index] === "--report") {
    index++;
    continue;
  }
  if (Deno.args[index] !== "--skip-e2e") throw new Error(`未知参数：${Deno.args[index]}`);
}
const reportFile = reportIndex >= 0 ? path.resolve(Deno.args[reportIndex + 1]) : null;
if (reportFile) await Deno.mkdir(path.dirname(reportFile), { recursive: true });
const pageCuaQueue = Deno.env.get("BROWSER_TOOLBOX_PAGE_CUA_LAUNCH_QUEUE") ??
  Deno.env.get("BROWSER_TOOLBOX_CUA_LAUNCH_QUEUE") ?? "";
const report = {
  commit: (await commandOutput("git", ["rev-parse", "HEAD"])).trim(),
  dirty: Boolean((await commandOutput("git", ["status", "--porcelain"])).trim()),
  startedAt: new Date().toISOString(),
  browser: null,
  status: "running",
  stages: [],
};
const executable = Deno.env.get("PUPPETEER_EXECUTABLE_PATH") || puppeteer.executablePath();

async function stage(name, action) {
  console.log(`\n验证阶段：${name}`);
  const start = performance.now();
  try {
    await action();
    report.stages.push({
      name,
      status: "passed",
      durationMs: Math.round(performance.now() - start),
    });
  } catch (error) {
    console.error(`${name} 失败：${error.message}`);
    report.stages.push({
      name,
      status: "failed",
      durationMs: Math.round(performance.now() - start),
      error: error.message,
    });
  }
}

async function run(args, env = {}, timeoutMs = 600000) {
  const child = new Deno.Command(Deno.execPath(), {
    args,
    cwd: root,
    env: { PUPPETEER_EXECUTABLE_PATH: executable, ...env },
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  let timedOut = false;
  let forceTimer;
  const timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGTERM");
    } catch (_) { /* 子进程可能已自行结束。 */ }
    forceTimer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (_) { /* 子进程已经退出。 */ }
    }, 5000);
  }, timeoutMs);
  const status = await child.status.finally(() => {
    clearTimeout(timer);
    clearTimeout(forceTimer);
  });
  if (timedOut) throw new Error(`阶段超过 ${timeoutMs / 1000} 秒，已停止子进程：${args.join(" ")}`);
  if (!status.success) throw new Error(`deno ${args.join(" ")} 退出码 ${status.code}`);
}

await stage("浏览器环境", async () => {
  report.browser = { executable, version: (await commandOutput(executable, ["--version"])).trim() };
  console.log(report.browser.version);
});
for (
  const [name, args] of [
    ["单元测试", ["run", "-A", "make.js", "test-unit"]],
    ["DOM 测试", ["run", "-A", "make.js", "test-dom"]],
    ["BrowserToolbox 适配测试", ["test", "-A", "tests/browser_toolbox/"]],
    ["构建归档测试", ["test", "-A", "tests/build_tests/"]],
    ["本地化一致性", ["run", "--allow-read", "scripts/sync_i18n.js", "--check"]],
    ["静态发布审计", ["run", "-A", "scripts/build_release.js"]],
    ["性能回归", ["run", "-A", "scripts/benchmark_browser_toolbox.js"]],
  ]
) {
  await stage(name, () => run(args));
}

const temporary = await Deno.makeTempDir({ prefix: "browser-toolbox-verify-" });
try {
  let artifacts;
  await stage("产物构建与归档校验", async () => {
    artifacts = await buildArtifacts({ root, output: temporary });
    report.artifacts = artifacts;
  });
  const baselineRuntimeReport = reportFile
    ? reportFile.replace(/\.json$/, "-baseline-runtime.json")
    : path.join(temporary, "baseline-runtime.json");
  if (skipE2e || !artifacts || !report.browser) {
    report.stages.push({
      name: "冻结旧运行时性能基线",
      status: "skipped",
      reason: "浏览器/E2E 或产物未就绪",
    });
  } else {
    await stage("冻结旧运行时性能基线", async () => {
      const legacyPath = await prepareLegacyRuntime(root, temporary);
      await run(["run", "-A", "scripts/e2e_runtime_host.js"], {
        BROWSER_TOOLBOX_E2E_EXTENSION_PATH: legacyPath,
        BROWSER_TOOLBOX_E2E_HEADLESS: "true",
        BROWSER_TOOLBOX_RUNTIME_KEEP_OPEN: "false",
        BROWSER_TOOLBOX_RUNTIME_BASELINE: "true",
        BROWSER_TOOLBOX_RUNTIME_REPORT: baselineRuntimeReport,
      });
    });
  }
  for (
    const [name, script] of [
      ["快捷工具 E2E", "scripts/e2e_quick_tools.js"],
      ["BrowserToolbox E2E", "scripts/e2e_browser_toolbox.js"],
      ["设置引导与站点规则 E2E", "scripts/e2e_settings_guidance.js"],
      ["超级拖拽尺寸调整 E2E", "scripts/e2e_super_drag_resize.js"],
      ["超级拖拽提示 E2E", "scripts/e2e_super_drag_feedback.js"],
      ["运行时适配 E2E 与性能", "scripts/e2e_runtime_host.js"],
      ["配置同 ID 升级与持久恢复 E2E", "scripts/e2e_configuration_migration.js"],
      ["命令身份、组件授权与文档恢复 E2E", "scripts/e2e_command_runtime.js"],
    ]
  ) {
    if (skipE2e || !artifacts || !report.browser) {
      report.stages.push({
        name,
        status: "skipped",
        reason: skipE2e ? "用户指定 --skip-e2e" : "浏览器或产物准备失败",
      });
    } else {
      await stage(name, () =>
        run(["run", "-A", script], {
          BROWSER_TOOLBOX_E2E_EXTENSION_PATH: path.join(temporary, "browser-toolbox"),
          BROWSER_TOOLBOX_E2E_HEADLESS: "true",
          // 完整门禁始终创建隔离浏览器，不继承日常或人工验收的 CDP 会话。
          BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
          BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
          BROWSER_TOOLBOX_RUNTIME_KEEP_OPEN: "false",
          BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
          BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
          BROWSER_TOOLBOX_CONFIGURATION_REPORT: reportFile
            ? reportFile.replace(/\.json$/, "-configuration.json")
            : "",
          BROWSER_TOOLBOX_COMMAND_RUNTIME_REPORT: reportFile
            ? reportFile.replace(/\.json$/, "-command-runtime.json")
            : "",
          BROWSER_TOOLBOX_RUNTIME_REPORT: reportFile
            ? reportFile.replace(/\.json$/, "-runtime.json")
            : "",
        }));
    }
  }
  let inputCanary;
  if (!skipE2e && artifacts && report.browser) {
    await stage("输入 Canary 隔离构建", async () => {
      inputCanary = await buildInputCanary(root, path.join(temporary, "browser-toolbox"));
      report.inputCanary = inputCanary;
    });
  } else {report.stages.push({
      name: "输入 Canary 隔离构建",
      status: "skipped",
      reason: "浏览器/E2E 或产物未就绪",
    });}
  for (
    const [name, script, suffix] of [
      ["输入 Canary 旧新真实按键对照", "scripts/e2e_input_canary.js", "-input-canary"],
      ["输入 Canary 运行时与冻结性能", "scripts/e2e_runtime_host.js", "-canary-runtime"],
      ["输入 Canary 命令与文档恢复", "scripts/e2e_command_runtime.js", "-canary-command-runtime"],
    ]
  ) {
    if (!inputCanary) report.stages.push({ name, status: "skipped", reason: "输入 Canary 未构建" });
    else {await stage(name, () =>
        run(["run", "-A", script], {
          BROWSER_TOOLBOX_E2E_EXTENSION_PATH: inputCanary.extensionPath,
          BROWSER_TOOLBOX_INPUT_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
          BROWSER_TOOLBOX_E2E_HEADLESS: "true",
          BROWSER_TOOLBOX_RUNTIME_CANARY: "true",
          BROWSER_TOOLBOX_RUNTIME_KEEP_OPEN: "false",
          BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
          BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
          BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
          BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
          BROWSER_TOOLBOX_INPUT_REPORT: reportFile
            ? reportFile.replace(/\.json$/, suffix + ".json")
            : "",
          BROWSER_TOOLBOX_RUNTIME_REPORT: reportFile
            ? reportFile.replace(/\.json$/, suffix + ".json")
            : "",
          BROWSER_TOOLBOX_COMMAND_RUNTIME_REPORT: reportFile
            ? reportFile.replace(/\.json$/, suffix + ".json")
            : "",
        }));}
  }
  let findCanary;
  if (inputCanary) {
    await stage("查找 Canary 隔离构建", async () => {
      findCanary = await buildInputCanary(root, path.join(temporary, "browser-toolbox"), {
        find: true,
      });
      report.findCanary = findCanary;
    });
  } else {report.stages.push({
      name: "查找 Canary 隔离构建",
      status: "skipped",
      reason: "输入依赖组或产物未就绪",
    });}
  for (
    const [name, script, suffix] of [
      ["查找 Canary 旧新 HUD 和输入对照", "scripts/e2e_find_canary.js", "-find-canary"],
      ["查找 Canary 完整输入依赖组对照", "scripts/e2e_input_canary.js", "-find-input"],
      ["查找 Canary 运行时与冻结性能", "scripts/e2e_runtime_host.js", "-find-runtime"],
      [
        "查找 Canary 命令、无痕历史与文档恢复",
        "scripts/e2e_command_runtime.js",
        "-find-command-runtime",
      ],
    ]
  ) {
    if (!findCanary) report.stages.push({ name, status: "skipped", reason: "查找 Canary 未构建" });
    else {await stage(name, () =>
        run(["run", "-A", script], {
          BROWSER_TOOLBOX_E2E_EXTENSION_PATH: findCanary.extensionPath,
          BROWSER_TOOLBOX_FIND_COMPAT_PATH: inputCanary.extensionPath,
          BROWSER_TOOLBOX_INPUT_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
          BROWSER_TOOLBOX_INPUT_PLAN_VERSION: "3",
          BROWSER_TOOLBOX_RUNTIME_PLAN_VERSION: "3",
          BROWSER_TOOLBOX_FIND_KEEP_OPEN: "false",
          BROWSER_TOOLBOX_E2E_HEADLESS: "true",
          BROWSER_TOOLBOX_RUNTIME_CANARY: "true",
          BROWSER_TOOLBOX_RUNTIME_KEEP_OPEN: "false",
          BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
          BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
          BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
          BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
          BROWSER_TOOLBOX_FIND_REPORT: reportFile
            ? reportFile.replace(/\.json$/, suffix + ".json")
            : "",
          BROWSER_TOOLBOX_INPUT_REPORT: reportFile
            ? reportFile.replace(/\.json$/, suffix + ".json")
            : "",
          BROWSER_TOOLBOX_RUNTIME_REPORT: reportFile
            ? reportFile.replace(/\.json$/, suffix + ".json")
            : "",
          BROWSER_TOOLBOX_COMMAND_RUNTIME_REPORT: reportFile
            ? reportFile.replace(/\.json$/, suffix + ".json")
            : "",
        }));}
  }
  let visualCanary;
  if (findCanary) {
    await stage("选择 Canary 隔离构建", async () => {
      visualCanary = await buildInputCanary(root, path.join(temporary, "browser-toolbox"), {
        visual: true,
      });
      report.visualCanary = visualCanary;
    });
  } else {report.stages.push({
      name: "选择 Canary 隔离构建",
      status: "skipped",
      reason: "查找依赖组或产物未就绪",
    });}
  for (
    const [name, script, suffix] of [
      ["选择 Canary 旧新原生选区与复制对照", "scripts/e2e_visual_canary.js", "-visual-canary"],
      ["选择 Canary 完整 Find 依赖组对照", "scripts/e2e_find_canary.js", "-visual-find"],
      ["选择 Canary 完整输入依赖组对照", "scripts/e2e_input_canary.js", "-visual-input"],
      ["选择 Canary 运行时与冻结性能", "scripts/e2e_runtime_host.js", "-visual-runtime"],
      [
        "选择 Canary 命令与原生文档恢复",
        "scripts/e2e_command_runtime.js",
        "-visual-command-runtime",
      ],
    ]
  ) {
    if (!visualCanary) {
      report.stages.push({ name, status: "skipped", reason: "选择 Canary 未构建" });
    } else {await stage(name, () =>
        run(["run", "-A", script], {
          BROWSER_TOOLBOX_E2E_EXTENSION_PATH: visualCanary.extensionPath,
          BROWSER_TOOLBOX_VISUAL_COMPAT_PATH: findCanary.extensionPath,
          BROWSER_TOOLBOX_FIND_COMPAT_PATH: inputCanary.extensionPath,
          BROWSER_TOOLBOX_INPUT_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
          BROWSER_TOOLBOX_INPUT_PLAN_VERSION: "4",
          BROWSER_TOOLBOX_FIND_PLAN_VERSION: "4",
          BROWSER_TOOLBOX_RUNTIME_PLAN_VERSION: "4",
          BROWSER_TOOLBOX_VISUAL_KEEP_OPEN: "false",
          BROWSER_TOOLBOX_FIND_KEEP_OPEN: "false",
          BROWSER_TOOLBOX_E2E_HEADLESS: "true",
          BROWSER_TOOLBOX_RUNTIME_CANARY: "true",
          BROWSER_TOOLBOX_RUNTIME_KEEP_OPEN: "false",
          BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
          BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
          BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
          BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
          ...Object.fromEntries(
            ["VISUAL", "FIND", "INPUT", "RUNTIME", "COMMAND_RUNTIME"].map((kind) => [
              `BROWSER_TOOLBOX_${kind}_REPORT`,
              reportFile ? reportFile.replace(/\.json$/, suffix + ".json") : "",
            ]),
          ),
        }));}
  }
  let hintsCanary;
  if (visualCanary) {
    await stage("提示 Canary 隔离构建", async () => {
      hintsCanary = await buildInputCanary(root, path.join(temporary, "browser-toolbox"), { hints: true });
      report.hintsCanary = hintsCanary;
    });
  } else {
    report.stages.push({ name: "提示 Canary 隔离构建", status: "skipped", reason: "选择依赖组或产物未就绪" });
  }
  for (const [name, script, suffix] of [
    ["提示 Canary 冻结旧新原生提示对照", "scripts/e2e_hints_canary.js", "-hints-canary"],
    ["提示 Canary 完整选择依赖组对照", "scripts/e2e_visual_canary.js", "-hints-visual"],
    ["提示 Canary 完整 Find 依赖组对照", "scripts/e2e_find_canary.js", "-hints-find"],
    ["提示 Canary 完整输入依赖组对照", "scripts/e2e_input_canary.js", "-hints-input"],
    ["提示 Canary 运行时与冻结性能", "scripts/e2e_runtime_host.js", "-hints-runtime"],
    ["提示 Canary 命令与原生文档恢复", "scripts/e2e_command_runtime.js", "-hints-command-runtime"],
  ]) {
    if (!hintsCanary) report.stages.push({ name, status: "skipped", reason: "提示 Canary 未构建" });
    else await stage(name, () => run(["run", "-A", script], {
      BROWSER_TOOLBOX_E2E_EXTENSION_PATH: hintsCanary.extensionPath,
      BROWSER_TOOLBOX_HINTS_COMPAT_PATH: visualCanary.extensionPath,
      BROWSER_TOOLBOX_VISUAL_COMPAT_PATH: findCanary.extensionPath,
      BROWSER_TOOLBOX_FIND_COMPAT_PATH: inputCanary.extensionPath,
      BROWSER_TOOLBOX_INPUT_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
      BROWSER_TOOLBOX_INPUT_PLAN_VERSION: "5",
      BROWSER_TOOLBOX_FIND_PLAN_VERSION: "5",
      BROWSER_TOOLBOX_VISUAL_PLAN_VERSION: "5",
      BROWSER_TOOLBOX_RUNTIME_PLAN_VERSION: "5",
      BROWSER_TOOLBOX_HINTS_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_VISUAL_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_FIND_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_E2E_HEADLESS: "true",
      BROWSER_TOOLBOX_RUNTIME_CANARY: "true",
      BROWSER_TOOLBOX_RUNTIME_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
      BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
      BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
      BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
      ...Object.fromEntries(["HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME", "COMMAND_RUNTIME"].map((kind) => [
        `BROWSER_TOOLBOX_${kind}_REPORT`, reportFile ? reportFile.replace(/\.json$/, suffix + ".json") : "",
      ])),
    }));
  }
  let vomnibarCanary;
  if (hintsCanary) {
    await stage("导航与补全 Canary 隔离构建", async () => {
      vomnibarCanary = await buildInputCanary(root, path.join(temporary, "browser-toolbox"), {
        vomnibar: true,
      });
      report.vomnibarCanary = vomnibarCanary;
      report.vomnibarCompatPath = Deno.env.get("BROWSER_TOOLBOX_VOMNIBAR_COMPAT_PATH") ||
        hintsCanary.extensionPath;
    });
  } else {
    report.stages.push({
      name: "导航与补全 Canary 隔离构建", status: "skipped", reason: "提示依赖组或产物未就绪",
    });
  }
  for (const [name, script, suffix] of [
    ["导航与补全 Canary 冻结旧新原生对照", "scripts/e2e_vomnibar_canary.js", "-vomnibar-canary"],
    ["导航与补全 Canary 完整提示依赖组对照", "scripts/e2e_hints_canary.js", "-vomnibar-hints"],
    ["导航与补全 Canary 完整选择依赖组对照", "scripts/e2e_visual_canary.js", "-vomnibar-visual"],
    ["导航与补全 Canary 完整 Find 依赖组对照", "scripts/e2e_find_canary.js", "-vomnibar-find"],
    ["导航与补全 Canary 完整输入依赖组对照", "scripts/e2e_input_canary.js", "-vomnibar-input"],
    ["导航与补全 Canary 运行时与冻结性能", "scripts/e2e_runtime_host.js", "-vomnibar-runtime"],
    ["导航与补全 Canary 命令与原生文档恢复", "scripts/e2e_command_runtime.js", "-vomnibar-command-runtime"],
  ]) {
    if (!vomnibarCanary) report.stages.push({ name, status: "skipped", reason: "导航与补全 Canary 未构建" });
    else await stage(name, () => run(["run", "-A", script], {
      BROWSER_TOOLBOX_E2E_EXTENSION_PATH: vomnibarCanary.extensionPath,
      BROWSER_TOOLBOX_VOMNIBAR_COMPAT_PATH: report.vomnibarCompatPath,
      BROWSER_TOOLBOX_HINTS_COMPAT_PATH: visualCanary.extensionPath,
      BROWSER_TOOLBOX_VISUAL_COMPAT_PATH: findCanary.extensionPath,
      BROWSER_TOOLBOX_FIND_COMPAT_PATH: inputCanary.extensionPath,
      BROWSER_TOOLBOX_INPUT_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
      BROWSER_TOOLBOX_INPUT_PLAN_VERSION: "6",
      BROWSER_TOOLBOX_FIND_PLAN_VERSION: "6",
      BROWSER_TOOLBOX_VISUAL_PLAN_VERSION: "6",
      BROWSER_TOOLBOX_HINTS_PLAN_VERSION: "6",
      BROWSER_TOOLBOX_RUNTIME_PLAN_VERSION: "6",
      BROWSER_TOOLBOX_VOMNIBAR_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_HINTS_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_VISUAL_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_FIND_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_INPUT_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_E2E_HEADLESS: "true",
      BROWSER_TOOLBOX_RUNTIME_CANARY: "true",
      BROWSER_TOOLBOX_RUNTIME_KEEP_OPEN: "false",
      BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
      BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
      BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
      BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
      ...Object.fromEntries(["VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME", "COMMAND_RUNTIME"].map((kind) => [
        `BROWSER_TOOLBOX_${kind}_REPORT`, reportFile ? reportFile.replace(/\.json$/, suffix + ".json") : "",
      ])),
    }));
  }
  let marksCanary;
  if (vomnibarCanary) {
    await stage("标记 Canary 隔离构建", async () => {
      marksCanary = await buildInputCanary(root, path.join(temporary, "browser-toolbox"), { marks: true });
      report.marksCanary = marksCanary;
      report.marksCompatPath = Deno.env.get("BROWSER_TOOLBOX_MARKS_COMPAT_PATH") || vomnibarCanary.extensionPath;
    });
  } else report.stages.push({ name: "标记 Canary 隔离构建", status: "skipped", reason: "导航依赖组或产物未就绪" });
  for (const [name, script, suffix] of [
    ["标记 Canary 冻结旧新原生对照", "scripts/e2e_marks_canary.js", "-marks-canary"],
    ["标记 Canary 完整导航与完成器依赖组对照", "scripts/e2e_vomnibar_canary.js", "-marks-vomnibar"],
    ["标记 Canary 完整提示依赖组对照", "scripts/e2e_hints_canary.js", "-marks-hints"],
    ["标记 Canary 完整选择依赖组对照", "scripts/e2e_visual_canary.js", "-marks-visual"],
    ["标记 Canary 完整 Find 依赖组对照", "scripts/e2e_find_canary.js", "-marks-find"],
    ["标记 Canary 完整输入依赖组对照", "scripts/e2e_input_canary.js", "-marks-input"],
    ["标记 Canary 运行时与冻结性能", "scripts/e2e_runtime_host.js", "-marks-runtime"],
    ["标记 Canary 命令与原生文档恢复", "scripts/e2e_command_runtime.js", "-marks-command-runtime"],
  ]) {
    if (!marksCanary) report.stages.push({ name, status: "skipped", reason: "标记 Canary 未构建" });
    else await stage(name, () => run(["run", "-A", script], {
      BROWSER_TOOLBOX_E2E_EXTENSION_PATH: marksCanary.extensionPath,
      BROWSER_TOOLBOX_MARKS_COMPAT_PATH: report.marksCompatPath,
      BROWSER_TOOLBOX_VOMNIBAR_COMPAT_PATH: report.vomnibarCompatPath,
      BROWSER_TOOLBOX_HINTS_COMPAT_PATH: visualCanary.extensionPath,
      BROWSER_TOOLBOX_VISUAL_COMPAT_PATH: findCanary.extensionPath,
      BROWSER_TOOLBOX_FIND_COMPAT_PATH: inputCanary.extensionPath,
      BROWSER_TOOLBOX_INPUT_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
      ...Object.fromEntries(["VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME"].map((kind) =>
        [`BROWSER_TOOLBOX_${kind}_PLAN_VERSION`, "7"])),
      ...Object.fromEntries(["MARKS", "VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME"].map((kind) =>
        [`BROWSER_TOOLBOX_${kind}_KEEP_OPEN`, "false"])),
      BROWSER_TOOLBOX_E2E_HEADLESS: "true",
      BROWSER_TOOLBOX_RUNTIME_CANARY: "true",
      BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
      BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
      BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
      BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
      ...Object.fromEntries(["MARKS", "VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME", "COMMAND_RUNTIME"].map((kind) =>
        [`BROWSER_TOOLBOX_${kind}_REPORT`, reportFile ? reportFile.replace(/\.json$/, suffix + ".json") : ""])),
    }));
  }
  let uiCanary;
  if (marksCanary) {
    await stage("共享 UI Canary 隔离构建", async () => {
      uiCanary = await buildInputCanary(root, path.join(temporary, "browser-toolbox"), { ui: true });
      report.uiCanary = uiCanary;
      report.uiCompatPath = Deno.env.get("BROWSER_TOOLBOX_UI_COMPAT_PATH") || marksCanary.extensionPath;
    });
  } else {
    report.stages.push({ name: "共享 UI Canary 隔离构建", status: "skipped", reason: "标记依赖组或产物未就绪" });
  }
  for (const [name, script, suffix] of [
    ["共享 UI Canary 组件、HUD、消息会话与框架焦点", "scripts/e2e_ui_canary.js", "-ui-canary"],
    ["共享 UI Canary 完整标记依赖组对照", "scripts/e2e_marks_canary.js", "-ui-marks"],
    ["共享 UI Canary 完整导航与完成器依赖组对照", "scripts/e2e_vomnibar_canary.js", "-ui-vomnibar"],
    ["共享 UI Canary 完整提示依赖组对照", "scripts/e2e_hints_canary.js", "-ui-hints"],
    ["共享 UI Canary 完整选择依赖组对照", "scripts/e2e_visual_canary.js", "-ui-visual"],
    ["共享 UI Canary 完整 Find 依赖组对照", "scripts/e2e_find_canary.js", "-ui-find"],
    ["共享 UI Canary 完整输入依赖组对照", "scripts/e2e_input_canary.js", "-ui-input"],
    ["共享 UI Canary 运行时与冻结性能", "scripts/e2e_runtime_host.js", "-ui-runtime"],
    ["共享 UI Canary 命令与原生文档恢复", "scripts/e2e_command_runtime.js", "-ui-command-runtime"],
  ]) {
    if (!uiCanary) report.stages.push({ name, status: "skipped", reason: "共享 UI Canary 未构建" });
    else await stage(name, () => run(["run", "-A", script], {
      BROWSER_TOOLBOX_E2E_EXTENSION_PATH: uiCanary.extensionPath,
      BROWSER_TOOLBOX_UI_COMPAT_PATH: report.uiCompatPath,
      ...(suffix === "-ui-canary" ? { BROWSER_TOOLBOX_CUA_LAUNCH_QUEUE: pageCuaQueue } : {}),
      // 完整门禁必须运行旧新两组，不继承单组外部连接的调试参数。
      BROWSER_TOOLBOX_UI_GROUP: "both",
      BROWSER_TOOLBOX_UI_BROWSER_URL: "",
      BROWSER_TOOLBOX_UI_PREPARATION_REPORT: "",
      BROWSER_TOOLBOX_UI_FOCUS_HANDSHAKE_DIR: "",
      BROWSER_TOOLBOX_MARKS_COMPAT_PATH: report.marksCompatPath,
      BROWSER_TOOLBOX_VOMNIBAR_COMPAT_PATH: report.vomnibarCompatPath,
      BROWSER_TOOLBOX_HINTS_COMPAT_PATH: visualCanary.extensionPath,
      BROWSER_TOOLBOX_VISUAL_COMPAT_PATH: findCanary.extensionPath,
      BROWSER_TOOLBOX_FIND_COMPAT_PATH: inputCanary.extensionPath,
      BROWSER_TOOLBOX_INPUT_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
      ...Object.fromEntries(["MARKS", "VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME"].map((kind) =>
        [`BROWSER_TOOLBOX_${kind}_PLAN_VERSION`, "8"])),
      ...Object.fromEntries(["UI", "MARKS", "VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME"].map((kind) =>
        [`BROWSER_TOOLBOX_${kind}_KEEP_OPEN`, "false"])),
      BROWSER_TOOLBOX_E2E_HEADLESS: "true",
      BROWSER_TOOLBOX_RUNTIME_CANARY: "true",
      BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
      BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
      BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
      BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
      ...Object.fromEntries(["UI", "MARKS", "VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME", "COMMAND_RUNTIME"].map((kind) =>
        [`BROWSER_TOOLBOX_${kind}_REPORT`, reportFile ? reportFile.replace(/\.json$/, suffix + ".json") : ""])),
    }));
  }
  if (uiCanary) await stage("帮助页独立控制器与旧新键盘页面对照", () => run([
    "run", "-A", "scripts/e2e_help_canary.js",
  ], {
    BROWSER_TOOLBOX_E2E_EXTENSION_PATH: uiCanary.extensionPath,
    BROWSER_TOOLBOX_HELP_COMPAT_PATH: report.uiCompatPath,
    BROWSER_TOOLBOX_CUA_LAUNCH_QUEUE: pageCuaQueue,
    BROWSER_TOOLBOX_HELP_COMPAT_PLAN_VERSION: "7",
    BROWSER_TOOLBOX_HELP_REPORT: reportFile ? reportFile.replace(/\.json$/, "-help-canary.json") : "",
  }));
  else report.stages.push({ name: "帮助页独立控制器与旧新键盘页面对照", status: "skipped", reason: "共享 UI Canary 未构建" });
  const settingsStage = "设置、Vimium 备份与附属说明旧新回退对照";
  if (uiCanary) {
    await stage(settingsStage, async () => {
      const source = path.join(temporary, "browser-toolbox");
      const settings = await buildInputCanary(root, source, { settings: true });
      try {
        await run(["run", "-A", "scripts/e2e_settings_canary.js"], {
          BROWSER_TOOLBOX_E2E_EXTENSION_PATH: settings.extensionPath,
          BROWSER_TOOLBOX_CUA_LAUNCH_QUEUE:
            Deno.env.get("BROWSER_TOOLBOX_SETTINGS_CUA_LAUNCH_QUEUE") ?? pageCuaQueue,
          BROWSER_TOOLBOX_SETTINGS_COMPAT_PATH:
            Deno.env.get("BROWSER_TOOLBOX_SETTINGS_COMPAT_PATH") || uiCanary.extensionPath,
          BROWSER_TOOLBOX_SETTINGS_REPORT:
            reportFile ? reportFile.replace(/\.json$/, "-settings-canary.json") : "",
        });
      } finally {
        await Deno.remove(path.dirname(settings.extensionPath), { recursive: true });
      }
    });
  } else report.stages.push({ name: settingsStage, status: "skipped", reason: "共享 UI Canary 未构建" });
  const pagesBuildStage = "方案 9 页面与新标签整组隔离构建";
  let pagesCanary, pagesCompatPath, builtPagesCompat;
  if (uiCanary) {
    await stage(pagesBuildStage, async () => {
      const source = path.join(temporary, "browser-toolbox");
      const pages = await buildInputCanary(root, source, { pages: true });
      report.pagesCanary = pages;
      pagesCompatPath = Deno.env.get("BROWSER_TOOLBOX_PAGES_COMPAT_PATH");
      if (!pagesCompatPath) {
        builtPagesCompat = await buildInputCanary(root, source, { settings: true });
        pagesCompatPath = builtPagesCompat.extensionPath;
      }
      report.pagesCompatPath = pagesCompatPath;
      report.pagesCompatSource = builtPagesCompat ? "本轮方案 8 对照构建" : "外部冻结对照";
      pagesCanary = pages;
    });
  } else report.stages.push({ name: pagesBuildStage, status: "skipped", reason: "方案 8 构建未就绪" });
  const pagesOutput = (suffix) => reportFile ? reportFile.replace(/\.json$/, suffix + ".json") : "";
  for (const [name, script, suffix] of [
    ["方案 9 新标签、自动 Vomnibar、启动与维护回退", "scripts/e2e_new_tab_canary.js", "-pages-new-tab"],
    ["方案 9 帮助冻结对照与回退", "scripts/e2e_help_canary.js", "-pages-help"],
    ["方案 9 设置、旧 JSON、附属说明与同 ID 回退", "scripts/e2e_settings_canary.js", "-pages-settings"],
    ["方案 9 完整共享 UI 依赖组", "scripts/e2e_ui_canary.js", "-pages-ui"],
    ["方案 9 完整标记依赖组", "scripts/e2e_marks_canary.js", "-pages-marks"],
    ["方案 9 完整导航与完成器依赖组", "scripts/e2e_vomnibar_canary.js", "-pages-vomnibar"],
    ["方案 9 完整提示依赖组", "scripts/e2e_hints_canary.js", "-pages-hints"],
    ["方案 9 完整选择依赖组", "scripts/e2e_visual_canary.js", "-pages-visual"],
    ["方案 9 完整 Find 依赖组", "scripts/e2e_find_canary.js", "-pages-find"],
    ["方案 9 完整输入依赖组", "scripts/e2e_input_canary.js", "-pages-input"],
    ["方案 9 运行时与冻结性能", "scripts/e2e_runtime_host.js", "-pages-runtime"],
    ["方案 9 命令与原生文档恢复", "scripts/e2e_command_runtime.js", "-pages-command-runtime"],
  ]) {
    if (!pagesCanary) report.stages.push({ name, status: "skipped", reason: "方案 9 未构建" });
    else await stage(name, () => run(["run", "-A", script], {
      BROWSER_TOOLBOX_E2E_EXTENSION_PATH: pagesCanary.extensionPath,
      BROWSER_TOOLBOX_NEW_TAB_COMPAT_PATH: pagesCompatPath,
      BROWSER_TOOLBOX_HELP_COMPAT_PATH: pagesCompatPath,
      BROWSER_TOOLBOX_HELP_COMPAT_PLAN_VERSION: "8",
      BROWSER_TOOLBOX_SETTINGS_COMPAT_PATH: pagesCompatPath,
      BROWSER_TOOLBOX_SETTINGS_COMPAT_INDEPENDENT: "true",
      BROWSER_TOOLBOX_CUA_LAUNCH_QUEUE: ["-pages-new-tab", "-pages-help", "-pages-ui"].includes(suffix)
        ? pageCuaQueue : "",
      BROWSER_TOOLBOX_UI_COMPAT_PATH: report.uiCompatPath,
      BROWSER_TOOLBOX_UI_GROUP: "both",
      BROWSER_TOOLBOX_UI_BROWSER_URL: "",
      BROWSER_TOOLBOX_UI_PREPARATION_REPORT: "",
      BROWSER_TOOLBOX_UI_FOCUS_HANDSHAKE_DIR: "",
      BROWSER_TOOLBOX_MARKS_COMPAT_PATH: report.marksCompatPath,
      BROWSER_TOOLBOX_VOMNIBAR_COMPAT_PATH: report.vomnibarCompatPath,
      BROWSER_TOOLBOX_HINTS_COMPAT_PATH: visualCanary.extensionPath,
      BROWSER_TOOLBOX_VISUAL_COMPAT_PATH: findCanary.extensionPath,
      BROWSER_TOOLBOX_FIND_COMPAT_PATH: inputCanary.extensionPath,
      BROWSER_TOOLBOX_INPUT_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
      ...Object.fromEntries(["HELP", "SETTINGS", "UI", "MARKS", "VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME"]
        .map((kind) => [`BROWSER_TOOLBOX_${kind}_PLAN_VERSION`, "9"])),
      ...Object.fromEntries(["UI", "MARKS", "VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME"]
        .map((kind) => [`BROWSER_TOOLBOX_${kind}_KEEP_OPEN`, "false"])),
      BROWSER_TOOLBOX_E2E_HEADLESS: "true",
      BROWSER_TOOLBOX_RUNTIME_CANARY: "true",
      BROWSER_TOOLBOX_RUNTIME_BASELINE: "false",
      BROWSER_TOOLBOX_E2E_BROWSER_URL: "",
      BROWSER_TOOLBOX_E2E_EXTENSION_ID: "",
      BROWSER_TOOLBOX_RUNTIME_BASELINE_REPORT: baselineRuntimeReport,
      ...Object.fromEntries(["NEW_TAB", "HELP", "SETTINGS", "UI", "MARKS", "VOMNIBAR", "HINTS", "VISUAL", "FIND", "INPUT", "RUNTIME", "COMMAND_RUNTIME"]
        .map((kind) => [`BROWSER_TOOLBOX_${kind}_REPORT`, pagesOutput(suffix)])),
    }));
  }
  // 保留原有阶段顺序，在末尾追加动态编辑器对照，避免专项结果脱离完整门禁。
  if (!pagesCanary) {
    report.stages.push({ name: "方案 1 与方案 9 动态编辑器对照", status: "skipped", reason: "方案 9 未构建" });
  } else {
    await stage("方案 1 与方案 9 动态编辑器对照", () =>
      run(["run", "-A", "scripts/e2e_dynamic_editors_canary.js"], {
        BROWSER_TOOLBOX_DYNAMIC_COMPAT_PATH: path.join(temporary, "browser-toolbox"),
        BROWSER_TOOLBOX_DYNAMIC_CANARY_PATH: pagesCanary.extensionPath,
        BROWSER_TOOLBOX_DYNAMIC_REPORT: pagesOutput("-pages-dynamic-editors") ||
          path.join(temporary, "pages-dynamic-editors.json"),
      }));
  }
  if (pagesCanary) await Deno.remove(path.dirname(pagesCanary.extensionPath), { recursive: true });
  if (builtPagesCompat) await Deno.remove(path.dirname(builtPagesCompat.extensionPath), { recursive: true });
  if (uiCanary) await Deno.remove(path.dirname(uiCanary.extensionPath), { recursive: true });
  if (marksCanary) await Deno.remove(path.dirname(marksCanary.extensionPath), { recursive: true });
  if (vomnibarCanary) await Deno.remove(path.dirname(vomnibarCanary.extensionPath), { recursive: true });
  if (hintsCanary) await Deno.remove(path.dirname(hintsCanary.extensionPath), { recursive: true });
  if (visualCanary) {
    await Deno.remove(path.dirname(visualCanary.extensionPath), { recursive: true });
  }
  if (findCanary) await Deno.remove(path.dirname(findCanary.extensionPath), { recursive: true });
  if (inputCanary) await Deno.remove(path.dirname(inputCanary.extensionPath), { recursive: true });
} finally {
  await Deno.remove(temporary, { recursive: true });
}
report.finishedAt = new Date().toISOString();
const failed = report.stages.some((entry) => entry.status === "failed");
const skipped = report.stages.some((entry) => entry.status === "skipped");
report.status = failed ? "failed" : skipped ? "partial" : "passed";
for (const entry of report.stages) {
  console.log(
    `${entry.status.toUpperCase()} ${entry.name}${entry.reason ? `：${entry.reason}` : ""}`,
  );
}
if (reportFile) {
  await Deno.mkdir(path.dirname(reportFile), { recursive: true });
  await Deno.writeTextFile(reportFile, JSON.stringify(report, null, 2) + "\n");
  console.log(`验证报告：${reportFile}`);
}
console.log(
  failed
    ? "验证失败。"
    : skipped
    ? "局部检查结束；存在未执行阶段，不能视为完整门禁通过。"
    : "完整自动化门禁通过；人工平台、屏幕阅读器和商店状态需独立验收。",
);
if (failed) Deno.exit(1);
